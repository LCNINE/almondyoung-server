import { createModel3dProjectionStub } from './__fixtures__/model3d-projection.stub';
import { randomUUID } from 'crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { mergedSchema } from '../../../platform/database/merged-schema';
import {
  productMasters,
  productMasterVersions,
  productMasterVariants,
  productVariants,
} from '../../catalog/schema/catalog.schema';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  buildWiring,
  Database,
  makeInboundService,
} from '../../inventory/inbound/services/__fixtures__/inbound-harness';
import { ProductSkuMappingService } from './product-sku-mapping.service';
import { ProductMatchingService } from './product-matching.service';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

describeIfDb('입고와 재입고 정책 저장의 PostgreSQL 잠금 순서', () => {
  jest.setTimeout(30_000);

  const policySession = `restock-policy-${randomUUID()}`;
  let client: postgres.Sql;
  let policyClient: postgres.Sql;
  let probe: postgres.Sql;
  const fixtures: Array<{
    masterId: string;
    variantId: string;
    skuId: string;
    warehouseId: string;
    holderId: string;
    idempotencyKey: string;
  }> = [];

  beforeAll(() => {
    const url = process.env.DATABASE_URL!;
    client = postgres(url, { max: 1 });
    policyClient = postgres(url, { max: 1, connection: { application_name: policySession } });
    probe = postgres(url, { max: 1 });
  });

  afterAll(async () => {
    await Promise.all([client.end(), policyClient.end(), probe.end()]);
  });

  afterEach(async () => {
    const db = drizzle(client, { schema: mergedSchema });

    for (const fixture of fixtures.splice(0)) {
      await db.transaction(async (tx) => {
        const receipts = await tx
          .select({ journalId: wmsTables.inboundReceipts.journalId })
          .from(wmsTables.inboundReceipts)
          .where(eq(wmsTables.inboundReceipts.warehouseId, fixture.warehouseId));
        const journalIds = receipts.map((row) => row.journalId).filter((id): id is string => id !== null);

        await tx
          .delete(wmsTables.inboundWorkLogs)
          .where(eq(wmsTables.inboundWorkLogs.warehouseId, fixture.warehouseId));
        await tx.delete(wmsTables.inboundReceiptLines).where(eq(wmsTables.inboundReceiptLines.skuId, fixture.skuId));
        await tx
          .delete(wmsTables.inboundReceipts)
          .where(eq(wmsTables.inboundReceipts.warehouseId, fixture.warehouseId));
        await tx
          .delete(wmsTables.inventoryIdempotencyRequests)
          .where(eq(wmsTables.inventoryIdempotencyRequests.key, fixture.idempotencyKey));
        await tx.delete(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.skuId, fixture.skuId));
        await tx.delete(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, fixture.skuId));

        if (journalIds.length > 0) {
          await tx.delete(wmsTables.stockJournals).where(inArray(wmsTables.stockJournals.id, journalIds));
        }

        await tx
          .delete(wmsTables.productSellableQuantityProjections)
          .where(eq(wmsTables.productSellableQuantityProjections.variantId, fixture.variantId));
        await tx
          .delete(wmsTables.salesVariantPolicies)
          .where(eq(wmsTables.salesVariantPolicies.variantId, fixture.variantId));
        await tx.delete(wmsTables.productMatchings).where(eq(wmsTables.productMatchings.variantId, fixture.variantId));
        await tx.delete(productMasters).where(eq(productMasters.id, fixture.masterId));
        await tx.delete(productVariants).where(eq(productVariants.id, fixture.variantId));
        await tx.delete(wmsTables.skus).where(eq(wmsTables.skus.id, fixture.skuId));
        await tx.delete(wmsTables.locations).where(eq(wmsTables.locations.warehouseId, fixture.warehouseId));
        await tx.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, fixture.warehouseId));
        await tx.delete(wmsTables.holders).where(eq(wmsTables.holders.id, fixture.holderId));
        await tx.execute(
          sql`DELETE FROM event.outbox_events WHERE payload::text LIKE ${`%${fixture.variantId}%`} OR payload::text LIKE ${`%${fixture.skuId}%`}`,
        );
      });
    }
  });

  it.each(['variant', 'matching'] as const)('%s 정책 저장과 재고 0→양수 입고가 모두 커밋된다', async (route) => {
    const db = drizzle(client, { schema: mergedSchema });
    const policyDb = drizzle(policyClient, { schema: mergedSchema });
    const fixture = await db.transaction(async (tx) => {
      const [warehouse] = await tx
        .insert(wmsTables.warehouses)
        .values({ name: randomUUID(), type: 'domestic', isSellable: true })
        .returning();
      const [holder] = await tx.insert(wmsTables.holders).values({ name: randomUUID() }).returning();

      const [sku] = await tx
        .insert(wmsTables.skus)
        .values({ name: 'lock-test', code: randomUUID(), holderId: holder.id })
        .returning();

      const [master] = await tx.insert(productMasters).values({}).returning();

      const [version] = await tx
        .insert(productMasterVersions)
        .values({ masterId: master.id, status: 'active' })
        .returning();

      const [variant] = await tx.insert(productVariants).values({ variantName: 'lock-test' }).returning();

      await tx
        .insert(productMasterVariants)
        .values({ masterId: master.id, versionId: version.id, variantId: variant.id });

      const [matching] = await tx
        .insert(wmsTables.productMatchings)
        .values({
          variantId: variant.id,
          masterId: master.id,
          status: 'matched',
          strategy: 'variant',
          isResolved: true,
          preStockSellable: false,
        })
        .returning();

      await tx.insert(wmsTables.productVariantSkuLinks).values({ productMatchingId: matching.id, skuId: sku.id });
      await tx
        .insert(wmsTables.salesVariantPolicies)
        .values({ variantId: variant.id, preStockSellable: false, restockDate: '2099-01-01' });

      return { warehouse, holder, master, sku, variant, matching };
    });

    const idempotencyKey = randomUUID();
    fixtures.push({
      masterId: fixture.master.id,
      variantId: fixture.variant.id,
      skuId: fixture.sku.id,
      warehouseId: fixture.warehouse.id,
      holderId: fixture.holder.id,
      idempotencyKey,
    });

    const receiptWiring = buildWiring(db as unknown as Database);
    const policyWiring = buildWiring(policyDb as unknown as Database);
    const variantPolicy = new ProductSkuMappingService(
      policyWiring.dbService as never,
      policyWiring.sellable,
      {} as never,
      {} as never,
      createModel3dProjectionStub(),
    );
    const matchingPolicy = new ProductMatchingService(
      policyWiring.dbService as never,
      policyWiring.sellable,
      {} as never,
      {} as never,
      {} as never,
      createModel3dProjectionStub(),
    );

    await receiptWiring.sellable.recalculateAndPublishForVariant(fixture.variant.id);

    const receiptLocked = deferred();
    const proceedWithReceipt = deferred();
    const receipt = db.transaction(async (tx) => {
      // 재계산이 품목 잠금을 획득한 순간부터 두 커넥션을 의도적으로 겹친다.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${fixture.variant.id}))`);
      receiptLocked.resolve();
      await proceedWithReceipt.promise;

      return makeInboundService(db as unknown as Database).simpleInbound(
        {
          warehouseId: fixture.warehouse.id,
          items: [{ skuId: fixture.sku.id, quantity: 1 }],
          idempotencyKey,
        },
        tx as unknown as DbTx,
      );
    });

    await receiptLocked.promise;

    const edit = policyDb.transaction(async (tx) => {
      const policy = { restockDate: '2099-02-01', restockApproximate: true };

      return route === 'variant'
        ? variantPolicy.updateVariantStockPolicy(fixture.variant.id, policy, tx)
        : matchingPolicy.updateStockPolicy(fixture.matching.id, policy, tx as unknown as DbTx);
    });
    const completed = Promise.allSettled([receipt, edit]);

    try {
      // 단순 시간 지연 대신 실제 PostgreSQL 잠금 대기를 확인한다.
      const deadline = Date.now() + 5_000;
      let waiting = false;

      while (Date.now() < deadline) {
        const [state] =
          await probe`SELECT wait_event_type FROM pg_stat_activity WHERE application_name = ${policySession}`;

        if (state?.wait_event_type === 'Lock') {
          waiting = true;
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      expect(waiting).toBe(true);
    } finally {
      proceedWithReceipt.resolve();
      // 대기 관찰이 실패해도 두 트랜잭션 종료까지 기다린 뒤 픽스처를 정리한다.
      await completed;
    }

    const outcomes = await completed;

    expect(
      outcomes.map((result) =>
        result.status === 'fulfilled'
          ? result.status
          : {
              status: result.status,
              error: result.reason.cause?.message ?? result.reason.message,
            },
      ),
    ).toEqual(['fulfilled', 'fulfilled']);

    const projection = await receiptWiring.sellable.getByVariantId(fixture.variant.id);
    const [policy] = await db
      .select()
      .from(wmsTables.salesVariantPolicies)
      .where(eq(wmsTables.salesVariantPolicies.variantId, fixture.variant.id));

    expect(projection.stockBoundQuantity).toBe(1);
    expect(projection.inboundDate).toBeNull();
    expect(policy.restockDate).toBe('2099-02-01');
    expect(policy.restockApproximate).toBe(true);
  });
});
