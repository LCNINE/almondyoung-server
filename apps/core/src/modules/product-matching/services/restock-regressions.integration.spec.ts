import { createModel3dProjectionStub } from './__fixtures__/model3d-projection.stub';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
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
import { InboundReceiptKernel } from '../../inventory/inbound/kernel/inbound-receipt.kernel';
import { buildWiring, Database, inRollbackTx } from '../../inventory/inbound/services/__fixtures__/inbound-harness';
import { ProductMatchingService } from './product-matching.service';
import { ProductSkuMappingService } from './product-sku-mapping.service';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('재입고 일정 회귀 (PostgreSQL integration)', () => {
  let client: postgres.Sql;
  let db: Database;

  beforeAll(() => {
    client = postgres(process.env.DATABASE_URL!, { max: 1 });
    db = drizzle(client, { schema: mergedSchema });
  });

  afterAll(async () => {
    await client.end();
  });

  async function seed(tx: DbTx) {
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: randomUUID(), type: 'domestic', isSellable: true })
      .returning();
    const [holder] = await tx.insert(wmsTables.holders).values({ name: randomUUID() }).returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'restock-regression', code: randomUUID(), holderId: holder.id })
      .returning();
    const [master] = await tx.insert(productMasters).values({}).returning();
    const [version] = await tx
      .insert(productMasterVersions)
      .values({ masterId: master.id, status: 'active' })
      .returning();
    const [variant] = await tx.insert(productVariants).values({ variantName: 'restock-regression' }).returning();

    await tx
      .insert(productMasterVariants)
      .values({ masterId: master.id, versionId: version.id, variantId: variant.id });

    const [matching] = await tx
      .insert(wmsTables.productMatchings)
      .values({ variantId: variant.id, masterId: master.id, status: 'matched', strategy: 'variant', isResolved: true })
      .returning();

    await tx.insert(wmsTables.productVariantSkuLinks).values({ productMatchingId: matching.id, skuId: sku.id });
    await tx.insert(wmsTables.salesVariantPolicies).values({
      variantId: variant.id,
      availabilityOverride: 'manual_out_of_stock',
      restockDate: '2099-01-01',
      restockApproximate: true,
    });

    return { warehouse, sku, master, variant, matching };
  }

  it('매칭 목록의 정책으로 SKU 구성을 수정해도 수동 재입고 일정이 보존된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seed(tx);
      const wiring = buildWiring(db);
      const matching = new ProductMatchingService(
        wiring.dbService,
        wiring.sellable,
        {} as never,
        {} as never,
        {} as never,
        createModel3dProjectionStub(),
      );
      const mappings = new ProductSkuMappingService(
        wiring.dbService as never,
        wiring.sellable,
        { wakeBacklogsWaitingForVariant: () => Promise.resolve(0) } as never,
        { resolve: (links: Array<{ skuId: string; quantity: number }>) => Promise.resolve(links) } as never,
        createModel3dProjectionStub(),
      );
      const result = await matching.getMatchings({}, tx);
      const row = result.data.find((item) => item.variantId === fixture.variant.id)!;

      expect(row.stockPolicy).toMatchObject({ restockDate: '2099-01-01', restockApproximate: true });

      await mappings.upsert(
        fixture.variant.id,
        {
          masterId: fixture.master.id,
          links: [{ skuId: fixture.sku.id, quantity: 2 }],
          policy: row.stockPolicy,
        },
        tx,
      );

      const [policy] = await tx
        .select()
        .from(wmsTables.salesVariantPolicies)
        .where(eq(wmsTables.salesVariantPolicies.variantId, fixture.variant.id));

      expect(policy).toMatchObject({ restockDate: '2099-01-01', restockApproximate: true });
    });
  });

  it('수동 품절 중 입고되면 재입고 일정만 해제하고 판매 차단은 유지한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seed(tx);
      const wiring = buildWiring(db);

      await wiring.sellable.recalculateAndPublishForVariant(fixture.variant.id, tx);

      const kernel = new InboundReceiptKernel(wiring.command, wiring.location, wiring.eventStore, wiring.guard);

      await kernel.recordArrival(
        {
          source: 'direct',
          method: 'simple',
          warehouseId: fixture.warehouse.id,
          reason: 'simple_inbound',
          lines: [{ skuId: fixture.sku.id, quantity: 1, eventKey: randomUUID() }],
        },
        tx,
      );

      const [policy] = await tx
        .select()
        .from(wmsTables.salesVariantPolicies)
        .where(eq(wmsTables.salesVariantPolicies.variantId, fixture.variant.id));
      const projection = await wiring.sellable.getByVariantId(fixture.variant.id, tx);

      expect(policy).toMatchObject({
        restockDate: null,
        restockApproximate: false,
        availabilityOverride: 'manual_out_of_stock',
      });
      expect(projection).toMatchObject({
        stockBoundQuantity: 1,
        sellableQuantity: 0,
        isSellable: false,
        inboundDate: null,
        reason: 'MANUAL_OUT_OF_STOCK',
      });
    });
  });
});
