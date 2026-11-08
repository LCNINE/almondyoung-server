import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { BadRequestException } from '@nestjs/common';
import type { DbService } from '@app/db';
import { BadRequestError } from '@app/shared';
import { DbTransaction } from '../../catalog.types';
import {
  catalogSchema,
  type PimSchema,
  pricingRules,
  productMasterPricingRules,
  productMasterQuantityDiscounts,
  productMasters,
  productMasterVariants,
  productOptionGroups,
  productOptionValueDisplays,
  productOptionValues,
  productMasterVersions,
  productQuantityDiscounts,
  productVariants,
  variantOptionValues,
} from '../../schema/catalog.schema';
import { PricingCalculatorService } from './pricing-calculator.service';
import { QuantityDiscountReader } from './quantity-discount.reader';
import { QuantityDiscountManager } from './quantity-discount.manager';
import { PricingService } from './pricing.service';
import { PricingValidatorService } from './pricing-validator.service';
import { PricingLayer, PricingOperationType, PricingScopeType } from './dto';

/**
 * 실행: `npx dotenv -e apps/core/.env -- npx jest quantity-discount.manager.integration`
 * 격리: 테스트마다 트랜잭션을 열고 항상 롤백한다.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

const tier = (minQuantity: number, regularPct: number, membershipPct: number) => ({
  minQuantity,
  regularRateBp: regularPct * 100,
  membershipRateBp: membershipPct * 100,
});

describeIfDb('수량 할인 구간표 저장 (실 Postgres)', () => {
  jest.setTimeout(60_000);

  let sql: postgres.Sql;
  let db: DbService<PimSchema>;
  let manager: QuantityDiscountManager;
  let reader: QuantityDiscountReader;
  let pricing: PricingService;
  let calculator: PricingCalculatorService;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    const drizzleDb = drizzle(sql, { schema: catalogSchema });
    db = {
      db: drizzleDb,
      run: <T>(fn: (t: DbTransaction) => Promise<T>, tx?: DbTransaction): Promise<T> =>
        tx ? fn(tx) : drizzleDb.transaction((t) => fn(t)),
    } as unknown as DbService<PimSchema>;
    reader = new QuantityDiscountReader(db);
    calculator = new PricingCalculatorService(db, reader);
    manager = new QuantityDiscountManager(db, reader, calculator);
    pricing = new PricingService(db, new PricingValidatorService(db, calculator), calculator, manager);
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

  async function addRule(
    tx: DbTransaction,
    masterId: string,
    versionId: string,
    layer: 'base_price' | 'membership_price',
    amount: number,
  ) {
    const [rule] = await tx
      .insert(pricingRules)
      .values({ layer, order: 1, scopeType: 'all_variants', operationType: 'override', operationValue: amount })
      .returning({ id: pricingRules.id });
    await tx.insert(productMasterPricingRules).values({ masterId, versionId, pricingRuleId: rule.id });
  }

  async function seedVersion(
    tx: DbTransaction,
    opts: { status?: 'draft' | 'active'; basePrice?: number; membershipPrice?: number } = {},
  ): Promise<{ masterId: string; versionId: string; variantId: string }> {
    const masterId = randomUUID();
    await tx.insert(productMasters).values({ id: masterId, createdBy: null });
    const [version] = await tx
      .insert(productMasterVersions)
      .values({ masterId, name: `구간-${masterId.slice(0, 8)}`, status: opts.status ?? 'draft' })
      .returning({ id: productMasterVersions.id });
    const variantId = randomUUID();
    await tx.insert(productVariants).values({ id: variantId, isDefault: true });
    await tx.insert(productMasterVariants).values({ masterId, variantId, versionId: version.id });
    await addRule(tx, masterId, version.id, 'base_price', opts.basePrice ?? 10000);
    await addRule(tx, masterId, version.id, 'membership_price', opts.membershipPrice ?? 8000);
    return { masterId, versionId: version.id, variantId };
  }

  async function addVersionSharing(tx: DbTransaction, masterId: string, fromVersionId: string): Promise<string> {
    const [version] = await tx
      .insert(productMasterVersions)
      .values({ masterId, name: '다음 버전', status: 'draft', version: 2 })
      .returning({ id: productMasterVersions.id });
    await manager.copyMapping(masterId, fromVersionId, version.id, tx);
    return version.id;
  }

  type Override = { combination: string; tiers: ReturnType<typeof tier>[] };
  const input = (
    tiers: ReturnType<typeof tier>[],
    extra: Partial<{ enabled: boolean; startsOn: string | null; endsOn: string | null; variantOverrides: Override[] }> = {},
  ) => ({
    enabled: true,
    startsOn: null,
    endsOn: null,
    tiers,
    variantOverrides: [] as Override[],
    ...extra,
  });

  /** 옵션 그룹 하나(값 여러 개)와 값마다 옵션 하나를 가진 draft 버전. 조합 키 = 옵션값 id(그룹 하나라 결합 없음). */
  async function seedOptionVersion(
    tx: DbTransaction,
    valueCount: number,
  ): Promise<{ masterId: string; versionId: string; variants: { variantId: string; valueId: string }[] }> {
    const masterId = randomUUID();
    await tx.insert(productMasters).values({ id: masterId, createdBy: null });
    const [version] = await tx
      .insert(productMasterVersions)
      .values({ masterId, name: `옵션-${masterId.slice(0, 8)}`, status: 'draft' })
      .returning({ id: productMasterVersions.id });
    const [group] = await tx.insert(productOptionGroups).values({}).returning({ id: productOptionGroups.id });
    const variants: { variantId: string; valueId: string }[] = [];
    for (let i = 0; i < valueCount; i += 1) {
      const [value] = await tx
        .insert(productOptionValues)
        .values({ optionGroupId: group.id })
        .returning({ id: productOptionValues.id });
      await tx
        .insert(productOptionValueDisplays)
        .values({ optionValueId: value.id, masterId, versionId: version.id, displayName: `색${i + 1}` });
      variants.push({ variantId: await addOptionVariant(tx, masterId, version.id, value.id), valueId: value.id });
    }
    await addRule(tx, masterId, version.id, 'base_price', 10000);
    await addRule(tx, masterId, version.id, 'membership_price', 9000);
    return { masterId, versionId: version.id, variants };
  }

  async function addOptionVariant(tx: DbTransaction, masterId: string, versionId: string, valueId: string): Promise<string> {
    const variantId = randomUUID();
    await tx.insert(productVariants).values({ id: variantId, isDefault: false });
    await tx.insert(productMasterVariants).values({ masterId, variantId, versionId });
    await tx.insert(variantOptionValues).values({ variantId, optionValueId: valueId });
    return variantId;
  }

  it('saves the table sorted by minimum quantity and reads it back', async () => {
    await inRollbackTx(async (tx) => {
      const { masterId, versionId } = await seedVersion(tx);

      await manager.upsertForDraft(masterId, versionId, input([tier(5, 10, 15), tier(3, 5, 10)], { startsOn: '2026-11-10' }), tx);

      const saved = await reader.findForVersion(masterId, versionId, tx);
      expect(saved).toMatchObject({
        enabled: true,
        startsOn: '2026-11-10',
        endsOn: null,
        tiers: [tier(3, 5, 10), tier(5, 10, 15)],
      });
    });
  });

  it('refuses to edit a version that is not a draft', async () => {
    await inRollbackTx(async (tx) => {
      const { masterId, versionId } = await seedVersion(tx, { status: 'active' });

      await expect(manager.upsertForDraft(masterId, versionId, input([tier(3, 5, 10)]), tx)).rejects.toThrow(
        BadRequestError,
      );
      expect(await reader.findForVersion(masterId, versionId, tx)).toBeNull();
    });
  });

  it('rejects a table that makes the member price higher than the regular price and saves nothing', async () => {
    await inRollbackTx(async (tx) => {
      const { masterId, versionId, variantId } = await seedVersion(tx, { basePrice: 10000, membershipPrice: 9000 });

      const error = await manager.upsertForDraft(masterId, versionId, input([tier(3, 20, 5)]), tx).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        errors: [{ code: 'MEMBER_PRICE_ABOVE_REGULAR', variantId, regularPrice: 8000, membershipPrice: 8550 }],
      });
      expect(await reader.findForVersion(masterId, versionId, tx)).toBeNull();
    });
  });

  it('treats an empty table as removing it', async () => {
    await inRollbackTx(async (tx) => {
      const { masterId, versionId } = await seedVersion(tx);
      await manager.upsertForDraft(masterId, versionId, input([tier(3, 5, 10)]), tx);

      await manager.upsertForDraft(masterId, versionId, input([]), tx);

      expect(await reader.findForVersion(masterId, versionId, tx)).toBeNull();
      const leftovers = await tx.select().from(productMasterQuantityDiscounts).where(eq(productMasterQuantityDiscounts.versionId, versionId));
      expect(leftovers).toEqual([]);
    });
  });

  it('lets a copied version read the same table', async () => {
    await inRollbackTx(async (tx) => {
      const { masterId, versionId } = await seedVersion(tx);
      await manager.upsertForDraft(masterId, versionId, input([tier(3, 5, 10)]), tx);

      const nextVersionId = await addVersionSharing(tx, masterId, versionId);

      expect(await reader.findForVersion(masterId, nextVersionId, tx)).toMatchObject({ tiers: [tier(3, 5, 10)] });
    });
  });

  it('copies on write: editing a shared table leaves the other version unchanged', async () => {
    await inRollbackTx(async (tx) => {
      const { masterId, versionId } = await seedVersion(tx);
      await manager.upsertForDraft(masterId, versionId, input([tier(3, 5, 10)]), tx);
      const nextVersionId = await addVersionSharing(tx, masterId, versionId);

      await manager.upsertForDraft(masterId, nextVersionId, input([tier(4, 7, 12)]), tx);

      expect(await reader.findForVersion(masterId, versionId, tx)).toMatchObject({ tiers: [tier(3, 5, 10)] });
      expect(await reader.findForVersion(masterId, nextVersionId, tx)).toMatchObject({ tiers: [tier(4, 7, 12)] });
    });
  });

  it('removing a shared table from one version keeps it for the other', async () => {
    await inRollbackTx(async (tx) => {
      const { masterId, versionId } = await seedVersion(tx);
      await manager.upsertForDraft(masterId, versionId, input([tier(3, 5, 10)]), tx);
      const nextVersionId = await addVersionSharing(tx, masterId, versionId);

      await manager.deleteForVersion(masterId, nextVersionId, tx);

      expect(await reader.findForVersion(masterId, versionId, tx)).toMatchObject({ tiers: [tier(3, 5, 10)] });
      expect(await reader.findForVersion(masterId, nextVersionId, tx)).toBeNull();
    });
  });

  it('deletes the table row once no version points at it', async () => {
    await inRollbackTx(async (tx) => {
      const { masterId, versionId } = await seedVersion(tx);
      await manager.upsertForDraft(masterId, versionId, input([tier(3, 5, 10)]), tx);
      const saved = await reader.findForVersion(masterId, versionId, tx);

      await manager.deleteForVersion(masterId, versionId, tx);

      const rows = await tx.select().from(productQuantityDiscounts).where(eq(productQuantityDiscounts.id, saved?.id ?? ''));
      expect(rows).toEqual([]);
    });
  });

  it('re-checks the table against new prices and refuses prices that break it', async () => {
    await inRollbackTx(async (tx) => {
      const { masterId, versionId } = await seedVersion(tx, { basePrice: 10000, membershipPrice: 8000 });
      await manager.upsertForDraft(masterId, versionId, input([tier(3, 20, 5)]), tx);
      await expect(manager.assertCompatibleWithPrices(masterId, versionId, tx)).resolves.toBeUndefined();

      await tx.delete(productMasterPricingRules).where(eq(productMasterPricingRules.versionId, versionId));
      await addRule(tx, masterId, versionId, 'base_price', 10000);
      await addRule(tx, masterId, versionId, 'membership_price', 9000);

      await expect(manager.assertCompatibleWithPrices(masterId, versionId, tx)).rejects.toThrow(BadRequestException);
    });
  });
  it('refuses a price rule change that would make the saved table charge members more', async () => {
    await inRollbackTx(async (tx) => {
      const { masterId, versionId } = await seedVersion(tx, { basePrice: 10000, membershipPrice: 8000 });
      await manager.upsertForDraft(masterId, versionId, input([tier(3, 20, 5)]), tx);
      const rule = (layer: PricingLayer, amount: number) => ({
        layer,
        order: 1,
        scopeType: PricingScopeType.ALL_VARIANTS,
        operationType: PricingOperationType.OVERRIDE,
        operationValue: amount,
      });

      await expect(
        pricing.replaceVersionRules(
          versionId,
          {
            basePriceRules: [rule(PricingLayer.BASE_PRICE, 10000)],
            membershipPriceRules: [rule(PricingLayer.MEMBERSHIP_PRICE, 9000)],
          } as never,
          tx,
        ),
      ).rejects.toThrow('3개 이상 구간에서 멤버십 회원가 8,550원이 일반가 8,000원보다 비쌉니다');
    });
  });
  it('refuses a save that waited behind a publish of the same version, instead of editing the now-active version', async () => {
    let fixture: { masterId: string; versionId: string } | undefined;
    await db.run(async (tx) => {
      fixture = await seedVersion(tx);
    });
    const { masterId, versionId } = fixture as { masterId: string; versionId: string };
    const publisher = postgres(DATABASE_URL as string, { max: 1 });
    try {
      // 발행처럼: 마스터를 잠그고 버전을 active 로 바꾼 채 잠깐 버틴 뒤 커밋한다.
      let finishPublish!: () => void;
      const published = new Promise<void>((resolveStarted) => {
        void publisher.begin(async (p) => {
          await p.unsafe('select id from product_masters where id = $1 for update', [masterId]);
          await p.unsafe(`update product_master_versions set status = 'active' where id = $1`, [versionId]);
          resolveStarted();
          await new Promise<void>((r) => (finishPublish = r));
        });
      });
      await published;

      const saving = manager.upsertForDraft(masterId, versionId, input([tier(3, 5, 10)])).then(
        () => 'saved',
        (e: unknown) => e,
      );
      await new Promise((r) => setTimeout(r, 200));
      finishPublish();

      expect(await saving).toBeInstanceOf(BadRequestError);
      await db.run(async (tx) => {
        expect(await reader.findForVersion(masterId, versionId, tx)).toBeNull();
      });
    } finally {
      await publisher.end();
      await db.run(async (tx) => {
        const ruleIds = await tx
          .select({ id: productMasterPricingRules.pricingRuleId })
          .from(productMasterPricingRules)
          .where(eq(productMasterPricingRules.masterId, masterId));
        const discountIds = await tx
          .select({ id: productMasterQuantityDiscounts.quantityDiscountId })
          .from(productMasterQuantityDiscounts)
          .where(eq(productMasterQuantityDiscounts.masterId, masterId));
        await tx.delete(productMasters).where(eq(productMasters.id, masterId));
        for (const { id } of ruleIds) await tx.delete(pricingRules).where(eq(pricingRules.id, id));
        for (const { id } of discountIds) await tx.delete(productQuantityDiscounts).where(eq(productQuantityDiscounts.id, id));
      });
    }
  });

  describe('price set with the table', () => {
    it('computes regular tiers from the base price and member tiers from the membership price per variant', async () => {
      await inRollbackTx(async (tx) => {
        const { masterId, versionId, variantId } = await seedVersion(tx, { basePrice: 10000, membershipPrice: 8000 });
        await manager.upsertForDraft(masterId, versionId, input([tier(3, 5, 10), tier(5, 10, 15)]), tx);

        const [single] = await calculator.calculateVariantPriceSetMany(versionId, [variantId], tx);
        const one = await calculator.calculateVariantPriceSet(versionId, variantId, tx);

        const expected = {
          basePrice: 10000,
          membershipPrice: 8000,
          tieredPrices: [
            { minQuantity: 3, price: 9500 },
            { minQuantity: 5, price: 9000 },
          ],
          membershipTieredPrices: [
            { minQuantity: 3, price: 7200 },
            { minQuantity: 5, price: 6800 },
          ],
        };
        expect(single).toEqual(expected);
        expect(one).toEqual(expected);
      });
    });

    it('saves a members-only table and prices only members by quantity', async () => {
      await inRollbackTx(async (tx) => {
        const { masterId, versionId, variantId } = await seedVersion(tx, { basePrice: 10000, membershipPrice: 9000 });
        await manager.upsertForDraft(masterId, versionId, input([tier(3, 0, 10), tier(6, 0, 20)]), tx);

        const set = await calculator.calculateVariantPriceSet(versionId, variantId, tx);
        expect(set.tieredPrices).toEqual([]);
        expect(set.membershipTieredPrices).toEqual([
          { minQuantity: 3, price: 8100 },
          { minQuantity: 6, price: 7200 },
        ]);

        const regular = await calculator.calculateVariantPriceByVersion(versionId, variantId, 6, 'regular', tx);
        const member = await calculator.calculateVariantPriceByVersion(versionId, variantId, 6, 'membership', tx);
        expect(regular.price).toBe(10000);
        expect(member.price).toBe(7200);
      });
    });

    it('sends no tier prices while the table is switched off', async () => {
      await inRollbackTx(async (tx) => {
        const { masterId, versionId, variantId } = await seedVersion(tx);
        await manager.upsertForDraft(masterId, versionId, input([tier(3, 5, 10)], { enabled: false }), tx);

        const one = await calculator.calculateVariantPriceSet(versionId, variantId, tx);

        expect(one.tieredPrices).toEqual([]);
        expect(one.membershipTieredPrices).toEqual([]);
      });
    });

    it('prices a quantity with the table for both customer types, the same as the price set', async () => {
      await inRollbackTx(async (tx) => {
        const { masterId, versionId, variantId } = await seedVersion(tx, { basePrice: 10000, membershipPrice: 8000 });
        await manager.upsertForDraft(masterId, versionId, input([tier(3, 5, 10), tier(5, 10, 15)]), tx);

        const price = async (quantity: number, type: 'regular' | 'membership') =>
          (await calculator.calculateVariantPriceByVersion(versionId, variantId, quantity, type, tx)).price;

        expect([await price(1, 'regular'), await price(3, 'regular'), await price(5, 'regular')]).toEqual([10000, 9500, 9000]);
        expect([await price(1, 'membership'), await price(3, 'membership'), await price(5, 'membership')]).toEqual([8000, 7200, 6800]);
        expect(await price(2, 'membership')).toBe(8000);
      });
    });

    it('prices a quantity with no tier while the table is off', async () => {
      await inRollbackTx(async (tx) => {
        const { masterId, versionId, variantId } = await seedVersion(tx, { basePrice: 10000, membershipPrice: 8000 });
        await manager.upsertForDraft(masterId, versionId, input([tier(3, 5, 10)], { enabled: false }), tx);

        const result = await calculator.calculateVariantPriceByVersion(versionId, variantId, 3, 'membership', tx);

        expect(result.price).toBe(8000);
      });
    });
  });

  describe('option overrides', () => {
    it('prices each option with its own override and the rest with the default table', async () => {
      await inRollbackTx(async (tx) => {
        const { masterId, versionId, variants } = await seedOptionVersion(tx, 3);
        const [red, yellow, blue] = variants;
        await manager.upsertForDraft(
          masterId,
          versionId,
          input([tier(3, 10, 15)], {
            variantOverrides: [
              { combination: yellow.valueId, tiers: [tier(3, 5, 6)] },
              { combination: blue.valueId, tiers: [] },
            ],
          }),
          tx,
        );

        const sets = await calculator.calculateVariantPriceSetMany(
          versionId,
          variants.map((v) => v.variantId),
          tx,
        );
        expect(sets.map((x) => [x.tieredPrices, x.membershipTieredPrices])).toEqual([
          [[{ minQuantity: 3, price: 9000 }], [{ minQuantity: 3, price: 7650 }]],
          [[{ minQuantity: 3, price: 9500 }], [{ minQuantity: 3, price: 8460 }]],
          [[], []],
        ]);
        const quantity = async (variantId: string) =>
          (await calculator.calculateVariantPriceByVersion(versionId, variantId, 3, 'regular', tx)).price;
        expect([await quantity(red.variantId), await quantity(yellow.variantId), await quantity(blue.variantId)]).toEqual([
          9000, 9500, 10000,
        ]);
      });
    });

    it('rejects an override where members would pay more and marks its option', async () => {
      await inRollbackTx(async (tx) => {
        const { masterId, versionId, variants } = await seedOptionVersion(tx, 2);
        const error = await manager
          .upsertForDraft(
            masterId,
            versionId,
            input([tier(3, 10, 15)], { variantOverrides: [{ combination: variants[1].valueId, tiers: [tier(3, 20, 5)] }] }),
            tx,
          )
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toMatchObject({
          message:
            '수량 할인 표와 맞지 않습니다: 색2: 3개 이상 구간에서 멤버십 회원가 8,550원이 일반가 8,000원보다 비쌉니다. 멤버십 %를 올리거나 정가·멤버십가를 확인해 주세요.',
          errors: [
            { code: 'MEMBER_PRICE_ABOVE_REGULAR', variantId: variants[1].variantId, combination: variants[1].valueId },
          ],
        });
      });
    });

    it('drops overrides for options the version does not have when saving', async () => {
      await inRollbackTx(async (tx) => {
        const { masterId, versionId, variants } = await seedOptionVersion(tx, 1);
        await manager.upsertForDraft(
          masterId,
          versionId,
          input([tier(3, 10, 15)], {
            variantOverrides: [
              { combination: variants[0].valueId, tiers: [tier(4, 5, 6)] },
              { combination: randomUUID(), tiers: [tier(3, 1, 2)] },
            ],
          }),
          tx,
        );

        const saved = await reader.findForVersion(masterId, versionId, tx);
        expect(saved?.variantOverrides).toEqual([{ combination: variants[0].valueId, tiers: [tier(4, 5, 6)] }]);
      });
    });

    it('keeps an override on its option after the option row is copied into the next version', async () => {
      await inRollbackTx(async (tx) => {
        const { masterId, versionId, variants } = await seedOptionVersion(tx, 2);
        await manager.upsertForDraft(
          masterId,
          versionId,
          input([tier(3, 10, 15)], { variantOverrides: [{ combination: variants[1].valueId, tiers: [] }] }),
          tx,
        );
        const nextVersionId = await addVersionSharing(tx, masterId, versionId);
        const copied = [
          await addOptionVariant(tx, masterId, nextVersionId, variants[0].valueId),
          await addOptionVariant(tx, masterId, nextVersionId, variants[1].valueId),
        ];
        await addRule(tx, masterId, nextVersionId, 'base_price', 10000);
        await addRule(tx, masterId, nextVersionId, 'membership_price', 9000);

        const sets = await calculator.calculateVariantPriceSetMany(nextVersionId, copied, tx);
        expect(sets.map((x) => x.tieredPrices)).toEqual([[{ minQuantity: 3, price: 9000 }], []]);
      });
    });

    it('ignores an override for an option value the version no longer sells', async () => {
      await inRollbackTx(async (tx) => {
        const { masterId, versionId, variants } = await seedOptionVersion(tx, 2);
        await manager.upsertForDraft(
          masterId,
          versionId,
          input([tier(3, 10, 15)], { variantOverrides: [{ combination: variants[1].valueId, tiers: [] }] }),
          tx,
        );
        const nextVersionId = await addVersionSharing(tx, masterId, versionId);
        const kept = await addOptionVariant(tx, masterId, nextVersionId, variants[0].valueId);
        await addRule(tx, masterId, nextVersionId, 'base_price', 10000);
        await addRule(tx, masterId, nextVersionId, 'membership_price', 9000);

        const [set] = await calculator.calculateVariantPriceSetMany(nextVersionId, [kept], tx);
        expect(set.tieredPrices).toEqual([{ minQuantity: 3, price: 9000 }]);
        await manager.assertCompatibleWithPrices(masterId, nextVersionId, tx);

        await manager.upsertForDraft(
          masterId,
          nextVersionId,
          input([tier(3, 10, 15)], { variantOverrides: [{ combination: variants[1].valueId, tiers: [] }] }),
          tx,
        );
        expect((await reader.findForVersion(masterId, nextVersionId, tx))?.variantOverrides).toEqual([]);
      });
    });

    it('keeps a product without overrides priced exactly as before', async () => {
      await inRollbackTx(async (tx) => {
        const { masterId, versionId, variants } = await seedOptionVersion(tx, 2);
        await manager.upsertForDraft(masterId, versionId, input([tier(3, 5, 10), tier(5, 10, 15)]), tx);

        const sets = await calculator.calculateVariantPriceSetMany(
          versionId,
          variants.map((v) => v.variantId),
          tx,
        );
        for (const set of sets) {
          expect(set).toEqual({
            basePrice: 10000,
            membershipPrice: 9000,
            tieredPrices: [
              { minQuantity: 3, price: 9500 },
              { minQuantity: 5, price: 9000 },
            ],
            membershipTieredPrices: [
              { minQuantity: 3, price: 8100 },
              { minQuantity: 5, price: 7650 },
            ],
          });
        }
      });
    });
  });
  it('ignores a tieredPriceRules key that an older client still sends', async () => {
    await inRollbackTx(async (tx) => {
      const { versionId } = await seedVersion(tx, { basePrice: 15900, membershipPrice: 15900 });
      const rule = (layer: PricingLayer, amount: number) => ({
        layer,
        order: 1,
        scopeType: PricingScopeType.ALL_VARIANTS,
        operationType: PricingOperationType.OVERRIDE,
        operationValue: amount,
      });

      const saved = await pricing.replaceVersionRules(
        versionId,
        {
          basePriceRules: [rule(PricingLayer.BASE_PRICE, 16900)],
          membershipPriceRules: [rule(PricingLayer.MEMBERSHIP_PRICE, 15900)],
          tieredPriceRules: [],
        } as never,
        tx,
      );

      expect(saved.basePriceRules.map((r) => r.operationValue)).toEqual([16900]);
      expect(saved).not.toHaveProperty('tieredPriceRules');
    });
  });
});
