// jest moduleNameMapper 가 bare `@packages/event-contracts` 를 못 잡아 module-not-found 로 죽는다.
// 매핑되는 서브패스로 requireActual 하는 것이 이 레포의 상시 우회다
// (bulk-session-draft.integration.spec.ts 헤더 참고).
jest.mock(
  '@packages/event-contracts',
  () => jest.requireActual<typeof import('@packages/event-contracts')>('@packages/event-contracts/index'),
  { virtual: true },
);

import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import type { TestingModule } from '@nestjs/testing';
import type { DbService } from '@app/db';
import {
  type PimSchema,
  pricingRules,
  productMasterPricingRules,
  productMasterVariants,
  productMasters,
  productOptionValues,
  productOptionValueDisplays,
  productOptionGroupDisplays,
  productVariants,
  variantOptionValues,
} from '../../../schema/catalog.schema';
import { outboxEvents, productSellableQuantityProjections } from '../../../../inventory/schema/inventory.schema';

/**
 * 목록 API 의 **품목 미리보기**(`ProductSummaryDto.variantPreviews`)를 실 Postgres + 실 Nest DI 로 구동한다.
 *
 * 이 경로는 단위 스펙으로 잠글 수 없다 — 검증 대상이 SQL 그 자체(윈도우 상한, 표시명 조인 범위)라
 * DB 를 목으로 바꾸면 아무것도 확인하지 못한다. 특히 3번 케이스는 **옵션 값 행을 공유하는 두 상품이
 * 같은 페이지에 있을 때** 표시명이 섞이지 않는지를 본다: `product_option_groups`/`product_option_values`
 * 는 master 스코프가 없는 식별자 행이고 이름은 `(master, version)` 별 display 테이블에만 있으므로,
 * 표시명 조인을 페이지의 versionIds 전체로 걸면 남의 상품 이름이 붙는다.
 *
 * 실행: `npm run test:variant-preview:integration`
 * (전용 scratch DB `variant_preview_scratch` — 이 스위트는 롤백이 아니라 커밋한다)
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_VARIANT_PREVIEW_DB === '1' && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the variant preview integration suite.');
}

// 커밋하는 스위트라 대상 DB 를 이름으로 못 박는다 — 개발용 DB 를 잡으면 진짜 상품이 생겼다 지워지고,
// 도중에 크래시하면 남는다.
if (DATABASE_URL && !/variant_preview_scratch/.test(DATABASE_URL)) {
  throw new Error(
    '이 스위트는 커밋하므로 전용 scratch DB(variant_preview_scratch)에서만 돌린다. ' +
      `현재 DATABASE_URL 이 가리키는 곳: ${DATABASE_URL.replace(/\/\/[^@]*@/, '//***@')}`,
  );
}

const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('상품 목록 품목 미리보기 (실 Postgres)', () => {
  jest.setTimeout(180_000);

  let moduleRef: TestingModule;
  let db: DbService<PimSchema>;
  let masters: import('./product-masters.service').ProductMastersService;
  let versions: import('./product-versions.service').ProductVersionsService;
  let pricing: import('../../pricing/pricing.service').PricingService;

  const createdMasterIds = new Set<string>();

  beforeAll(async () => {
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? 'variant-preview-spec-secret';
    process.env.KAFKA_BROKERS = process.env.KAFKA_BROKERS ?? 'localhost:9092';
    process.env.KAFKA_BOOTSTRAP_TOPICS = process.env.KAFKA_BOOTSTRAP_TOPICS ?? 'false';
    process.env.FULFILLMENT_WORKFLOW_MODE = process.env.FULFILLMENT_WORKFLOW_MODE ?? 'maintenance';

    const { Test } = await import('@nestjs/testing');
    const { ConfigModule } = await import('@nestjs/config');
    const { DbModule, DbService } = await import('@app/db');
    const { AuthorizationModule } = await import('@app/authorization');
    const { mergedSchema } = await import('../../../../../platform/database/merged-schema');
    const { ALL_SCOPES, ALL_ROLE_MAPPINGS } = await import('../../../../../platform/auth/merged-scopes');
    const { CatalogModule } = await import('../../../catalog.module');
    const { ProductMastersService } = await import('./product-masters.service');
    const { ProductVersionsService } = await import('./product-versions.service');
    const { PricingService } = await import('../../pricing/pricing.service');

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        DbModule.forRootAsync({
          useFactory: (configService) => ({
            connectionString: configService.get<string>('DATABASE_URL') ?? '',
          }),
          schema: mergedSchema,
        }),
        AuthorizationModule.forRoot({
          microserviceName: 'almondyoung',
          scopes: ALL_SCOPES,
          roleMappings: ALL_ROLE_MAPPINGS,
        }),
        CatalogModule,
      ],
    }).compile();

    db = moduleRef.get<DbService<PimSchema>>(DbService, { strict: false });
    masters = moduleRef.get(ProductMastersService, { strict: false });
    versions = moduleRef.get(ProductVersionsService, { strict: false });
    pricing = moduleRef.get(PricingService, { strict: false });
  });

  afterAll(async () => {
    if (db) {
      const masterIds = [...createdMasterIds];
      let variantIds: string[] = [];
      let pricingRuleIds: string[] = [];
      if (masterIds.length > 0) {
        variantIds = (
          await db.run((trx) =>
            trx
              .select({ variantId: productMasterVariants.variantId })
              .from(productMasterVariants)
              .where(inArray(productMasterVariants.masterId, masterIds)),
          )
        ).map((row) => row.variantId);
        pricingRuleIds = (
          await db.run((trx) =>
            trx
              .select({ pricingRuleId: productMasterPricingRules.pricingRuleId })
              .from(productMasterPricingRules)
              .where(inArray(productMasterPricingRules.masterId, masterIds)),
          )
        ).map((row) => row.pricingRuleId);
      }

      await db.run(async (trx) => {
        if (masterIds.length > 0) {
          await trx.delete(productMasters).where(inArray(productMasters.id, masterIds));
        }
        if (variantIds.length > 0) {
          await trx
            .delete(productSellableQuantityProjections)
            .where(inArray(productSellableQuantityProjections.variantId, variantIds));
          await trx.delete(productVariants).where(inArray(productVariants.id, variantIds));
        }
        if (pricingRuleIds.length > 0) {
          await trx.delete(pricingRules).where(inArray(pricingRules.id, pricingRuleIds));
        }
        const aggregateIds = [...new Set([...masterIds, ...variantIds])];
        if (aggregateIds.length > 0) {
          await trx.delete(outboxEvents).where(inArray(outboxEvents.aggregateId, aggregateIds));
        }
      });
    }
    await moduleRef?.close();
  });

  // ─────────────────────────── 픽스처 ───────────────────────────

  /**
   * 발행까지 끝난 상품 하나를 **서비스 경로로만** 만든다. 옵션 그룹을 주면 조합만큼 품목이 생긴다.
   * 손으로 INSERT 하면 실제 쓰기 경로가 만드는 행 모양과 갈라져 거짓 초록이 된다.
   */
  async function seedProduct(opts: {
    name: string;
    basePrice: number;
    membershipPrice?: number;
    options?: Array<{ group: string; values: string[] }>;
  }): Promise<{ masterId: string; versionId: string }> {
    const draft = await masters.createMaster(randomUUID());
    createdMasterIds.add(draft.masterId);

    await masters.updateVersion(draft.id, {
      name: opts.name,
      brand: '테스트브랜드',
      productCode: `SKU-${randomUUID().slice(0, 8)}`,
      seller: '본사',
      productType: 'regular_sale',
      fulfillmentKind: 'physical',
      ...(opts.options
        ? {
            optionDiff: {
              add: opts.options.map((group, groupIndex) => ({
                displayName: group.group,
                sortOrder: groupIndex,
                values: group.values.map((value, valueIndex) => ({
                  displayName: value,
                  sortOrder: valueIndex,
                })),
              })),
            },
          }
        : {}),
    });

    await pricing.replaceVersionRules(draft.id, {
      basePriceRules: [
        {
          layer: 'base_price',
          order: 1,
          scopeType: 'all_variants',
          operationType: 'override',
          operationValue: opts.basePrice,
        },
      ],
      membershipPriceRules:
        opts.membershipPrice === undefined
          ? []
          : [
              {
                layer: 'membership_price',
                order: 1,
                scopeType: 'all_variants',
                operationType: 'override',
                operationValue: opts.membershipPrice,
              },
            ],
      tieredPriceRules: [],
    });

    await versions.publishVersion(draft.id);

    return { masterId: draft.masterId, versionId: draft.id };
  }

  /**
   * 품목 이름을 비운다. 쓰기 경로는 `variant_name` 을 채워 두지만(예: '블루 × 100ml'),
   * cafe24 이관분처럼 이름이 비어 있는 상품이 목록의 다수다 — 그 경우에만 옵션 표시명 조인이
   * 돌아가므로, 그 경로를 검증하려면 이름을 비운 상태를 만들어야 한다.
   */
  async function clearVariantNames(versionId: string): Promise<void> {
    const rows = await db.run((trx) =>
      trx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(eq(productMasterVariants.versionId, versionId)),
    );
    await db.run((trx) =>
      trx
        .update(productVariants)
        .set({ variantName: null })
        .where(
          inArray(
            productVariants.id,
            rows.map((row) => row.variantId),
          ),
        ),
    );
  }

  async function listPreviews(masterIds: string[]) {
    const result = await masters.getMasters({ page: 1, limit: 50, ids: masterIds, mode: 'all' });
    return new Map(
      result.data.map((item) => [
        item.product.id,
        { aggregate: item.aggregate, name: item.product.version.name },
      ]),
    );
  }

  // ─────────────────────────── 케이스 ───────────────────────────

  it('옵션 상품은 품목명과 품목별 판매가·멤버십가를 함께 내려준다', async () => {
    const product = await seedProduct({
      name: '미리보기 색상 상품',
      basePrice: 69000,
      membershipPrice: 62000,
      options: [{ group: '색상', values: ['샴페인 골드', '크림슨 레드', '메탈 퍼플'] }],
    });

    const previews = (await listPreviews([product.masterId])).get(product.masterId)!.aggregate;

    expect(previews.variantCount).toBe(3);
    expect(previews.variantPreviews.map((v) => v.name).sort()).toEqual(
      ['메탈 퍼플', '샴페인 골드', '크림슨 레드'].sort(),
    );
    for (const variant of previews.variantPreviews) {
      expect(variant.basePrice).toBe(69000);
      expect(variant.membershipPrice).toBe(62000);
      expect(variant.status).toBe('active');
    }
  });

  it('품목명이 비어 있으면 옵션 표시명을 그룹 정렬 순서대로 이어 만든다', async () => {
    const product = await seedProduct({
      name: '미리보기 2축 상품',
      basePrice: 15000,
      options: [
        { group: '색상', values: ['블루'] },
        { group: '용량', values: ['100ml', '200ml'] },
      ],
    });
    await clearVariantNames(product.versionId);

    const previews = (await listPreviews([product.masterId])).get(product.masterId)!.aggregate;

    expect(previews.variantCount).toBe(2);
    expect(previews.variantPreviews.map((v) => v.name).sort()).toEqual(
      ['블루 / 100ml', '블루 / 200ml'].sort(),
    );
  });

  it('옵션 값 행을 공유하는 다른 상품이 같은 페이지에 있어도 표시명이 섞이지 않는다', async () => {
    // 두 상품을 같은 페이지에서 조회하고, 두 번째 상품이 첫 번째의 옵션 값 행을 **재사용**하게 만든다.
    // 스키마상 허용되는 모양이다(옵션 값에는 master 스코프가 없다). 이 상태에서 표시명 조인을
    // versionIds 전체로 걸면 A 품목에 B 의 표시명이 붙어 이름이 중복·오표기된다.
    const productA = await seedProduct({
      name: '표시명 공유 A',
      basePrice: 10000,
      options: [{ group: '색상', values: ['빨강'] }],
    });
    const productB = await seedProduct({
      name: '표시명 공유 B',
      basePrice: 20000,
      options: [{ group: '색상', values: ['파랑'] }],
    });

    // 이름이 비어 있어야 표시명 조인이 돈다 — 이 케이스가 검증하려는 경로다.
    await clearVariantNames(productA.versionId);
    await clearVariantNames(productB.versionId);

    const [sharedValue] = await db.run((trx) =>
      trx
        .select({ optionValueId: productOptionValueDisplays.optionValueId })
        .from(productOptionValueDisplays)
        .where(eq(productOptionValueDisplays.versionId, productA.versionId)),
    );
    const [valueOfB] = await db.run((trx) =>
      trx
        .select({
          optionValueId: productOptionValueDisplays.optionValueId,
          id: productOptionValueDisplays.id,
        })
        .from(productOptionValueDisplays)
        .where(eq(productOptionValueDisplays.versionId, productB.versionId)),
    );
    const [groupOfB] = await db.run((trx) =>
      trx
        .select({
          optionGroupId: productOptionGroupDisplays.optionGroupId,
          id: productOptionGroupDisplays.id,
        })
        .from(productOptionGroupDisplays)
        .where(eq(productOptionGroupDisplays.versionId, productB.versionId)),
    );

    // B 의 품목이 A 의 옵션 값 행을 가리키게 바꾸고, B 의 표시명도 그 값·그 그룹에 달아 준다.
    // → 하나의 option_value_id 에 A 버전용 '빨강', B 버전용 '파랑' 표시명이 동시에 존재한다.
    const [sharedGroup] = await db.run((trx) =>
      trx
        .select({ optionGroupId: productOptionValues.optionGroupId })
        .from(productOptionValues)
        .where(eq(productOptionValues.id, sharedValue.optionValueId)),
    );
    await db.run(async (trx) => {
      await trx
        .update(variantOptionValues)
        .set({ optionValueId: sharedValue.optionValueId })
        .where(eq(variantOptionValues.optionValueId, valueOfB.optionValueId));
      await trx
        .update(productOptionValueDisplays)
        .set({ optionValueId: sharedValue.optionValueId })
        .where(eq(productOptionValueDisplays.id, valueOfB.id));
      await trx
        .update(productOptionGroupDisplays)
        .set({ optionGroupId: sharedGroup.optionGroupId })
        .where(eq(productOptionGroupDisplays.id, groupOfB.id));
    });

    const listed = await listPreviews([productA.masterId, productB.masterId]);
    const namesOfA = listed.get(productA.masterId)!.aggregate.variantPreviews.map((v) => v.name);
    const namesOfB = listed.get(productB.masterId)!.aggregate.variantPreviews.map((v) => v.name);

    expect(namesOfA).toEqual(['빨강']);
    expect(namesOfB).toEqual(['파랑']);
    // 그룹 표시명도 같은 이유로 상품별로 좁혀져야 한다.
    expect(groupOfB.optionGroupId).toBeTruthy();
  });

  it('품목이 상한을 넘으면 잘라서 내려주되 variantCount 는 전체 개수를 유지한다', async () => {
    const { VARIANT_PREVIEW_LIMIT } = await import('./product-masters.service');
    const values = Array.from({ length: VARIANT_PREVIEW_LIMIT + 5 }, (_, i) => `색상${i + 1}`);
    const product = await seedProduct({
      name: '미리보기 상한 상품',
      basePrice: 1000,
      options: [{ group: '색상', values }],
    });

    const previews = (await listPreviews([product.masterId])).get(product.masterId)!.aggregate;

    expect(previews.variantCount).toBe(values.length);
    expect(previews.variantPreviews).toHaveLength(VARIANT_PREVIEW_LIMIT);
  });

  it('옵션 없는 단일상품은 품목 하나에 이름이 비어 있다', async () => {
    const product = await seedProduct({ name: '미리보기 단일상품', basePrice: 13500 });

    const aggregate = (await listPreviews([product.masterId])).get(product.masterId)!.aggregate;

    expect(aggregate.optionGroupNames).toEqual([]);
    expect(aggregate.variantPreviews).toHaveLength(1);
    expect(aggregate.variantPreviews[0].name).toBe('');
  });

  it('page 없이 전량 조회하면 미리보기를 만들지 않는다', async () => {
    const product = await seedProduct({
      name: '미리보기 전량조회 상품',
      basePrice: 5000,
      options: [{ group: '색상', values: ['화이트', '블랙'] }],
    });

    const result = await masters.getMasters({ ids: [product.masterId], mode: 'all' });
    const aggregate = result.data.find((item) => item.product.id === product.masterId)!.aggregate;

    expect(aggregate.variantCount).toBe(2);
    expect(aggregate.variantPreviews).toEqual([]);
  });
});
