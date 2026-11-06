import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { BadRequestException } from '@nestjs/common';
import type { DbService } from '@app/db';
import { NotFoundError } from '@app/shared';
import { DbTransaction } from '../../catalog.types';
import {
  catalogSchema,
  type PimSchema,
  pricingRules,
  productBundleOffers,
  productMasterPricingRules,
  productMasters,
  productMasterVariants,
  productMasterVersions,
  productVariants,
} from '../../schema/catalog.schema';
import { PricingCalculatorService } from './pricing-calculator.service';
import { QuantityDiscountReader } from './quantity-discount.reader';
import { BundleOfferReader } from './bundle-offer.reader';
import { BundleOfferManager } from './bundle-offer.manager';
import { BundleOfferInput } from './bundle-offer.math';

/**
 * 실행: `npx dotenv -e apps/core/.env -- npx jest bundle-offer.manager.integration`
 * 격리: 테스트마다 트랜잭션을 열고 항상 롤백한다.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

describeIfDb('함께 구매 구성품 저장 (실 Postgres)', () => {
  jest.setTimeout(60_000);

  let sql: postgres.Sql;
  let db: DbService<PimSchema>;
  let reader: BundleOfferReader;
  let manager: BundleOfferManager;
  const enqueued: Array<{ eventType: string; aggregateId: string; payload: any }> = [];

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    const drizzleDb = drizzle(sql, { schema: catalogSchema });
    db = {
      db: drizzleDb,
      run: <T>(fn: (t: DbTransaction) => Promise<T>, tx?: DbTransaction): Promise<T> =>
        tx ? fn(tx) : drizzleDb.transaction((t) => fn(t)),
    } as unknown as DbService<PimSchema>;
    const calculator = new PricingCalculatorService(db, new QuantityDiscountReader(db));
    reader = new BundleOfferReader(db, calculator);
    const publisher = { enqueue: async (event: any) => void enqueued.push(event) };
    manager = new BundleOfferManager(db, reader, publisher as any);
  });

  beforeEach(() => {
    enqueued.length = 0;
  });

  afterAll(async () => {
    await sql?.end();
  });

  async function inRollbackTx(fn: (tx: DbTransaction) => Promise<void>): Promise<void> {
    await expect(
      db.run(async (tx) => {
        await fn(tx);
        throw new Rollback('rollback');
      }),
    ).rejects.toThrow(Rollback);
  }

  async function addRule(tx: DbTransaction, masterId: string, versionId: string, layer: 'base_price' | 'membership_price', amount: number) {
    const [rule] = await tx
      .insert(pricingRules)
      .values({ layer, order: 1, scopeType: 'all_variants', operationType: 'override', operationValue: amount })
      .returning({ id: pricingRules.id });
    await tx.insert(productMasterPricingRules).values({ masterId, versionId, pricingRuleId: rule.id });
  }

  async function seedProduct(
    tx: DbTransaction,
    opts: { status?: 'draft' | 'active'; membershipPrice?: number; fulfillmentKind?: 'physical' | 'digital' } = {},
  ): Promise<{ masterId: string; variantId: string }> {
    const masterId = randomUUID();
    await tx.insert(productMasters).values({ id: masterId, createdBy: null });
    const [version] = await tx
      .insert(productMasterVersions)
      .values({
        masterId,
        name: `구성-${masterId.slice(0, 8)}`,
        status: opts.status ?? 'active',
        ...(opts.fulfillmentKind ? { fulfillmentKind: opts.fulfillmentKind } : {}),
      })
      .returning({ id: productMasterVersions.id });
    const variantId = randomUUID();
    await tx.insert(productVariants).values({ id: variantId, isDefault: true });
    await tx.insert(productMasterVariants).values({ masterId, variantId, versionId: version.id });
    await addRule(tx, masterId, version.id, 'base_price', 10000);
    await addRule(tx, masterId, version.id, 'membership_price', opts.membershipPrice ?? 8000);
    return { masterId, variantId };
  }

  const offer = (addonMasterId: string, over: Partial<BundleOfferInput> = {}): BundleOfferInput => ({
    addonMasterId,
    allowedVariantIds: null,
    regularRateBp: 1000,
    membershipRateBp: 1500,
    enabled: true,
    startsOn: null,
    endsOn: null,
    label: null,
    ...over,
  });

  it('saves offers in the given order, reads them back and enqueues the full list', async () => {
    await inRollbackTx(async (tx) => {
      const a = await seedProduct(tx);
      const b = await seedProduct(tx);
      const c = await seedProduct(tx);

      const saved = await manager.replaceForMaster(a.masterId, [offer(c.masterId), offer(b.masterId, { label: '  같이 쓰면 좋아요 ' })], tx);

      expect(saved.map((o) => [o.addonMasterId, o.sort, o.label])).toEqual([
        [c.masterId, 0, null],
        [b.masterId, 1, '같이 쓰면 좋아요'],
      ]);
      expect(saved[0].addonName).toMatch(/^구성-/);
      expect(enqueued).toHaveLength(1);
      expect(enqueued[0]).toMatchObject({ eventType: 'ProductBundleOffersChanged', aggregateId: a.masterId });
      expect(enqueued[0].payload.offers.map((o: any) => o.addonMasterId)).toEqual([c.masterId, b.masterId]);
    });
  });

  it('replaces the whole list, and an empty list removes everything and still announces it', async () => {
    await inRollbackTx(async (tx) => {
      const a = await seedProduct(tx);
      const b = await seedProduct(tx);
      const c = await seedProduct(tx);
      await manager.replaceForMaster(a.masterId, [offer(b.masterId), offer(c.masterId)], tx);

      await manager.replaceForMaster(a.masterId, [offer(c.masterId, { regularRateBp: 0 })], tx);
      expect((await reader.findForMaster(a.masterId, tx)).map((o) => [o.addonMasterId, o.regularRateBp])).toEqual([[c.masterId, 0]]);

      await manager.replaceForMaster(a.masterId, [], tx);
      expect(await reader.findForMaster(a.masterId, tx)).toEqual([]);
      expect(enqueued.at(-1)?.payload.offers).toEqual([]);
    });
  });

  it('rejects an add-on that is not on sale or is digital, and keeps the previous list', async () => {
    await inRollbackTx(async (tx) => {
      const a = await seedProduct(tx);
      const ok = await seedProduct(tx);
      const draftOnly = await seedProduct(tx, { status: 'draft' });
      const digital = await seedProduct(tx, { fulfillmentKind: 'digital' });
      await manager.replaceForMaster(a.masterId, [offer(ok.masterId)], tx);
      enqueued.length = 0;

      const attempt = manager.replaceForMaster(a.masterId, [offer(draftOnly.masterId), offer(digital.masterId)], tx);
      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      await expect(manager.replaceForMaster(a.masterId, [offer(draftOnly.masterId)], tx)).rejects.toMatchObject({
        response: { message: expect.stringContaining('판매 중인 상품이 아닙니다') },
      });
      expect((await reader.findForMaster(a.masterId, tx)).map((o) => o.addonMasterId)).toEqual([ok.masterId]);
      expect(enqueued).toEqual([]);
    });
  });

  it('checks member price against regular price with the add-on prices from its active version', async () => {
    await inRollbackTx(async (tx) => {
      const a = await seedProduct(tx);
      const pricey = await seedProduct(tx, { membershipPrice: 9900 });
      await expect(
        manager.replaceForMaster(a.masterId, [offer(pricey.masterId, { regularRateBp: 2000, membershipRateBp: 0 })], tx),
      ).rejects.toMatchObject({ response: { errors: [expect.objectContaining({ code: 'MEMBER_PRICE_ABOVE_REGULAR' })] } });
    });
  });

  it('fails for a product that does not exist', async () => {
    await expect(manager.replaceForMaster(randomUUID(), [])).rejects.toBeInstanceOf(NotFoundError);
  });

  it('detaches a deleted product: removes it from every product that offered it and announces each changed list', async () => {
    await inRollbackTx(async (tx) => {
      const a1 = await seedProduct(tx);
      const a2 = await seedProduct(tx);
      const b = await seedProduct(tx);
      const c = await seedProduct(tx);
      await manager.replaceForMaster(a1.masterId, [offer(b.masterId), offer(c.masterId)], tx);
      await manager.replaceForMaster(a2.masterId, [offer(b.masterId)], tx);
      await manager.replaceForMaster(b.masterId, [offer(c.masterId)], tx);
      enqueued.length = 0;

      await manager.detachMaster(b.masterId, tx);

      expect((await reader.findForMaster(a1.masterId, tx)).map((o) => [o.addonMasterId, o.sort])).toEqual([[c.masterId, 0]]);
      expect(await reader.findForMaster(a2.masterId, tx)).toEqual([]);
      expect(await reader.findForMaster(b.masterId, tx)).toEqual([]);
      expect(enqueued.map((e) => [e.aggregateId, e.payload.offers.length]).sort()).toEqual(
        [[a1.masterId, 1], [a2.masterId, 0]].sort(),
      );
    });
  });

  it('stamps the rows with the time the event announces, so a publication snapshot carries the same revision', async () => {
    await inRollbackTx(async (tx) => {
      const a = await seedProduct(tx);
      const b = await seedProduct(tx);
      const c = await seedProduct(tx);
      await manager.replaceForMaster(a.masterId, [offer(b.masterId), offer(c.masterId)], tx);
      const saved = enqueued[0].payload.changedAt;
      expect((await reader.revisionFor(a.masterId, tx))?.toISOString()).toBe(saved);

      enqueued.length = 0;
      await manager.detachMaster(b.masterId, tx);
      const detached = enqueued.find((e) => e.aggregateId === a.masterId)?.payload.changedAt;
      expect(detached >= saved).toBe(true);
      expect((await reader.revisionFor(a.masterId, tx))?.toISOString()).toBe(detached);
      expect(await reader.revisionFor(b.masterId, tx)).toBeNull();
    });
  });

  it('does nothing for a product that nobody offers', async () => {
    await inRollbackTx(async (tx) => {
      const lone = await seedProduct(tx);
      await manager.detachMaster(lone.masterId, tx);
      expect(enqueued).toEqual([]);
    });
  });

  it('drops the rows when the add-on product is deleted', async () => {
    await inRollbackTx(async (tx) => {
      const a = await seedProduct(tx);
      const b = await seedProduct(tx);
      await manager.replaceForMaster(a.masterId, [offer(b.masterId)], tx);
      await tx.delete(productMasters).where(eq(productMasters.id, b.masterId));
      expect(await tx.select().from(productBundleOffers).where(eq(productBundleOffers.masterId, a.masterId))).toEqual([]);
    });
  });
});
