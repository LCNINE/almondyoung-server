import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
// `sql` (구 postgres.Sql 커넥션 변수, 아래 describe 안)와 이름이 겹쳐 별칭을 쓴다.
import { sql as drizzleSql, DrizzleQueryError } from 'drizzle-orm';
import { DbService } from '@app/db';
import { DbTransaction } from '../../../catalog.types';
import {
  catalogSchema,
  type PimSchema,
  productMasters,
  productMasterVersions,
  productCategories,
  productMasterCategories,
  productOptionGroups,
  productOptionGroupDisplays,
  productOptionValues,
  productOptionValueDisplays,
  productMasterOptionGroups,
  productVariants,
  variantOptionValues,
  productMasterVariants,
  productImages,
  productPurchaseConstraints,
  productMasterPurchaseConstraints,
  pricingRules,
  productMasterPricingRules,
} from '../../../schema/catalog.schema';
import { ProductVersionReadLoader } from '../../../core/products/loaders/product-version-read.loader';
import { OptionReadLoader } from '../../../core/products/loaders/option-read.loader';
import { TagReadLoader } from '../../../core/products/loaders/tag-read.loader';
import { ProjectionSnapshotAssembler } from '../../../core/products/assemblers/projection-snapshot.assembler';
import { PricingService } from '../../../core/pricing/pricing.service';
import { PricingValidatorService } from '../../../core/pricing/pricing-validator.service';
import { PricingCalculatorService } from '../../../core/pricing/pricing-calculator.service';
import { VariantPriceCacheService } from '../../../core/pricing/variant-price-cache.service';
import { ProductCategoriesService } from '../../../core/categories/categories.service';
import { OutboxPublisher } from '@app/events';
import { ProductSkuMappingService } from '../../../../product-matching/services/product-sku-mapping.service';
import { PRICING_SENTINEL } from './form-export.sheets';
import { FormExportSnapshotReader } from './form-export.snapshot.reader';
import { createImageKeyAllocator } from './form-export.types';

/**
 * FormExportSnapshotReader 는 기존 로더 5~6개를 조합만 하는 어댑터라 목으로 단위 테스트를
 * 쓰면 "목이 맞다고 답한 것"만 검증하게 된다 — 실제로 위험한 지점(반환 필드명, 조합 id
 * 정렬, 가격 센티넬)은 전부 실 Postgres 에 물어봐야 드러난다. `product-import-payload-
 * roundtrip.integration.spec.ts` 의 환경변수 가드 + 실 DATABASE_URL 패턴을 따른다.
 *
 * **실행**: 이 스위트 전용 scratch DB(`sdd_stage1_scratch`)에 core 마이그레이션을 올린
 * 뒤 그 DB를 가리키는 DATABASE_URL 로 돌린다 — dev_core 에는 이 태스크와 무관한 보류 중인
 * destructive 마이그레이션이 있어 여기서 마이그레이션을 실행하면 안 된다.
 *
 * **격리**: 스키마 복제 대신 각 테스트가 자신만의 트랜잭션을 열어 픽스처를 넣고
 * buildPrefill 을 부른 뒤 항상 롤백한다(선례: inventory-command.service.adjust.
 * integration.spec.ts 의 rollback-only 패턴). 테스트끼리도, 재실행 사이에도 DB에
 * 아무 것도 남지 않는다.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_FORM_EXPORT_DB === '1' && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the form-export snapshot integration suite.');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

describeIfDb('FormExportSnapshotReader (실 Postgres)', () => {
  jest.setTimeout(120_000);

  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof catalogSchema>;
  let reader: FormExportSnapshotReader;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: catalogSchema });

    // 선례(product-import-job-lease.integration.spec.ts, inventory-command.service.adjust.
    // integration.spec.ts)를 따라 DbService 를 Nest DI 로 부트스트랩하지 않고 `db`+`run`
    // 만 채운 가짜를 쓴다. 이 스위트가 부르는 모든 서비스 메서드는 tx 를 항상 명시로
    // 받으므로 run(fn, tx) 의 `tx ?`분기만 타서, 진짜 SQL 이 진짜 Postgres 에 그대로 간다.
    const dbService = {
      db,
      run: <T>(fn: (t: DbTransaction) => Promise<T>, tx?: DbTransaction): Promise<T> =>
        tx ? fn(tx) : db.transaction((t) => fn(t)),
    } as unknown as DbService<PimSchema>;

    const calculator = new PricingCalculatorService(dbService);
    const validator = new PricingValidatorService(dbService, calculator);
    const pricing = new PricingService(dbService, validator, calculator);

    const priceCache = new VariantPriceCacheService(dbService, calculator);
    const versionLoader = new ProductVersionReadLoader();
    const optionLoader = new OptionReadLoader();
    const tagLoader = new TagReadLoader();
    // ProductCategoriesService.getCategoryTree()(이 스위트가 실제로 부르는 유일한 메서드)는
    // productReadAssembler/projectionSnapshotAssembler/outboxPublisher 중 어느 것도 건드리지
    // 않는다 — 그래도 생성자 그래프를 채우려면 실 인스턴스가 필요하다(any/as 스텁 대신).
    const snapshotAssembler = new ProjectionSnapshotAssembler(versionLoader, optionLoader, tagLoader, priceCache);
    // OutboxPublisher 는 스키마 제네릭을 받지 않는(기본값 Record<string, never>) DbService 를
    // 받는다 — 우리 dbService 의 실제 동작(db/run)엔 무관하고 순수 타입 불일치라 캐스팅한다.
    const outbox = new OutboxPublisher(dbService as unknown as DbService);
    const categories = new ProductCategoriesService(dbService, snapshotAssembler, outbox);
    // 이 스위트는 필드명/가격 센티넬/이미지 키 등 리더 자체의 매핑을 검증하지, 품목 판매정책
    // 우선순위(그건 product-sku-mapping.service.spec.ts 와 form-export.snapshot.reader.spec.ts
    // 의 renderMaster 스위트 몫이다)를 검증하지 않는다. 실 ProductSkuMappingService 는
    // inventory BC 의 무거운 의존성 그래프를 끌고 오므로 여기서는 빈 배치 응답 스텁만 채운다.
    const skuMapping = {
      getVariantMatchingBatch: () => Promise.resolve({ data: [] }),
    } as unknown as ProductSkuMappingService;

    reader = new FormExportSnapshotReader(versionLoader, optionLoader, pricing, categories, skuMapping);
  });

  afterAll(async () => {
    await sql?.end();
  });

  /** 트랜잭션 안에서 픽스처를 만들고 buildPrefill 을 부른 뒤 항상 롤백한다. */
  async function inRollbackTx<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
    let captured!: T;
    await expect(
      db.transaction(async (tx) => {
        captured = await fn(tx);
        throw new Rollback('intentional rollback');
      }),
    ).rejects.toThrow(Rollback);
    return captured;
  }

  // 색상(returned 먼저, sortOrder=1)이 사전식으로 더 크고, 사이즈(returned 나중,
  // sortOrder=2)가 더 작다 — getVariantOptionValues() 의 반환 순서(그룹 sortOrder 순:
  // 색상→사이즈)와 정렬 순서(사이즈→색상)가 서로 반대가 되도록 고정한다. randomUUID() 를
  // 쓰면 둘의 순서가 우연히 같을 확률이 50%라 "정렬한다"는 주장을 증명하지 못한다.
  const RED_VALUE_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const SIZE_M_VALUE_ID = '00000000-0000-4000-8000-000000000000';

  type RichProductFixture = {
    masterId: string;
    versionId: string;
    variantId: string;
    colorGroupId: string;
    sizeGroupId: string;
    redValueId: string;
    sizeMValueId: string;
    parentCategoryId: string;
    childCategoryId: string;
    primaryFileId: string;
    additionalFileId: string;
  };

  /**
   * 스칼라·카테고리·옵션·조합·이미지·구매제약·가격규칙(전체 override + variant 하나
   * override)을 모두 갖춘 "정상" 상품. 여러 단정 포인트를 한 번에 검증하려고 하나로 묶었다.
   */
  async function createRichProduct(tx: DbTransaction): Promise<RichProductFixture> {
    const masterId = randomUUID();
    const versionId = randomUUID();

    await tx.insert(productMasters).values({ id: masterId });
    await tx.insert(productMasterVersions).values({
      id: versionId,
      masterId,
      version: 1,
      status: 'active',
      name: '겨울 니트',
      description: '따뜻한 니트',
      brand: '브랜드A',
      productCode: 'SKU-001',
      alternativeName: '니트별칭',
      material: '울 100%',
      marketPrice: 39000,
      supplyPrice: 15000,
      productType: 'regular_sale',
      fulfillmentKind: 'physical',
      salesClassification: '일반판매',
      purchaseClassification: '단독구매',
      ageRestriction: 0,
      minQuantity: 1,
      maxQuantity: 10,
      seller: '본사',
      isOverseas: false,
      isVisibleToMembersOnly: false,
      hideMembershipPriceForNonMembers: false,
      isWholesaleOnly: false,
      seoTitle: 'SEO제목',
      seoDescription: 'SEO설명',
      seoKeywords: ['니트', '겨울'],
      salesStartDate: new Date('2026-07-31T15:00:00.000Z'), // KST 2026-08-01 00:00
      salesEndDate: new Date('2026-08-31T14:59:00.000Z'), // KST 2026-08-31 23:59
    });

    const parentCategoryId = randomUUID();
    const childCategoryId = randomUUID();
    const suffix = randomUUID().slice(0, 8);
    await tx.insert(productCategories).values([
      { id: parentCategoryId, name: '여성패션', slug: `women-${suffix}`, level: 0, path: parentCategoryId },
      {
        id: childCategoryId,
        name: '니트',
        slug: `knit-${suffix}`,
        parentId: parentCategoryId,
        level: 1,
        path: `${parentCategoryId}/${childCategoryId}`,
      },
    ]);
    await tx
      .insert(productMasterCategories)
      .values({ masterId, categoryId: childCategoryId, versionId, isPrimary: true });

    // 옵션 그룹을 두 개(색상/사이즈) 두고 variant 를 둘 다에 연결한다 — combination 이
    // optionValueId 를 "정렬해서" 잇는지(반환 순서를 그대로 잇는 게 아니라) 증명하려면
    // 축이 최소 2개 있어야 한다. 축이 하나면 정렬 여부와 무관하게 문자열이 우연히 같다.
    const colorGroupId = randomUUID();
    const sizeGroupId = randomUUID();
    await tx.insert(productOptionGroups).values([{ id: colorGroupId }, { id: sizeGroupId }]);
    await tx.insert(productOptionGroupDisplays).values([
      { optionGroupId: colorGroupId, masterId, versionId, locale: 'ko-KR', displayName: '색상', sortOrder: 1 },
      { optionGroupId: sizeGroupId, masterId, versionId, locale: 'ko-KR', displayName: '사이즈', sortOrder: 2 },
    ]);
    await tx.insert(productMasterOptionGroups).values([
      { masterId, optionGroupId: colorGroupId, versionId },
      { masterId, optionGroupId: sizeGroupId, versionId },
    ]);

    const redValueId = RED_VALUE_ID;
    const blueValueId = randomUUID();
    const sizeMValueId = SIZE_M_VALUE_ID;
    await tx.insert(productOptionValues).values([
      { id: redValueId, optionGroupId: colorGroupId },
      { id: blueValueId, optionGroupId: colorGroupId },
      { id: sizeMValueId, optionGroupId: sizeGroupId },
    ]);
    await tx.insert(productOptionValueDisplays).values([
      // colorCode 를 레드에만 채워 넣어 로더/리더가 그 컬럼을 실제로 실어 나르는지(Important 5)
      // 와, 안 채운 값(M)은 빈 문자열로 나오는지(널이 그대로 새지 않는지)를 같이 본다.
      {
        optionValueId: redValueId,
        masterId,
        versionId,
        locale: 'ko-KR',
        displayName: '레드',
        colorCode: '#FF0000',
        sortOrder: 1,
      },
      { optionValueId: blueValueId, masterId, versionId, locale: 'ko-KR', displayName: '블루', sortOrder: 2 },
      { optionValueId: sizeMValueId, masterId, versionId, locale: 'ko-KR', displayName: 'M', sortOrder: 1 },
    ]);

    const variantId = randomUUID();
    await tx.insert(productVariants).values({ id: variantId, variantCode: 'AY-RED-M', displayOrder: 1 });
    await tx.insert(variantOptionValues).values([
      { variantId, optionValueId: redValueId },
      { variantId, optionValueId: sizeMValueId },
    ]);
    await tx.insert(productMasterVariants).values({ masterId, variantId, versionId });

    const primaryFileId = randomUUID();
    const additionalFileId = randomUUID();
    await tx.insert(productImages).values([
      { versionId, fileId: primaryFileId, isPrimary: true, sortOrder: 0 },
      { versionId, fileId: additionalFileId, isPrimary: false, sortOrder: 1 },
    ]);

    const constraintId = randomUUID();
    await tx
      .insert(productPurchaseConstraints)
      .values({ id: constraintId, requiresMembership: true, lifetimeQuantityLimit: 2 });
    await tx
      .insert(productMasterPurchaseConstraints)
      .values({ masterId, versionId, purchaseConstraintId: constraintId });

    // base_price/membership_price 는 전체 override 만 — isPricingEditable=true 를 유지한다.
    // base_price 에는 추가로 variantId 하나만 겨냥한 override 를 얹어 "이 축은 오버라이드가
    // 있고 저 축은 없다"를 같은 variant 에서 동시에 관찰한다(널 렌더링 회귀 검증용).
    const baseRuleId = randomUUID();
    const membershipRuleId = randomUUID();
    const variantOverrideRuleId = randomUUID();
    await tx.insert(pricingRules).values([
      {
        id: baseRuleId,
        layer: 'base_price',
        order: 1,
        scopeType: 'all_variants',
        operationType: 'override',
        operationValue: 29000,
      },
      {
        id: membershipRuleId,
        layer: 'membership_price',
        order: 1,
        scopeType: 'all_variants',
        operationType: 'override',
        operationValue: 26000,
      },
      {
        id: variantOverrideRuleId,
        layer: 'base_price',
        order: 2,
        scopeType: 'variants',
        scopeTargetIds: [variantId],
        operationType: 'override',
        operationValue: 27000,
      },
    ]);
    await tx.insert(productMasterPricingRules).values([
      { masterId, versionId, pricingRuleId: baseRuleId },
      { masterId, versionId, pricingRuleId: membershipRuleId },
      { masterId, versionId, pricingRuleId: variantOverrideRuleId },
    ]);

    return {
      masterId,
      versionId,
      variantId,
      colorGroupId,
      sizeGroupId,
      redValueId,
      sizeMValueId,
      parentCategoryId,
      childCategoryId,
      primaryFileId,
      additionalFileId,
    };
  }

  async function createTieredProduct(tx: DbTransaction): Promise<{ masterId: string; versionId: string }> {
    const masterId = randomUUID();
    const versionId = randomUUID();
    await tx.insert(productMasters).values({ id: masterId });
    await tx
      .insert(productMasterVersions)
      .values({ id: versionId, masterId, version: 1, status: 'active', name: '도매 전용 니트' });

    const tieredRuleId = randomUUID();
    await tx.insert(pricingRules).values({
      id: tieredRuleId,
      layer: 'tiered_price',
      order: 1,
      scopeType: 'all_variants',
      operationType: 'override',
      operationValue: 20000,
      minQuantity: 10,
    });
    await tx.insert(productMasterPricingRules).values({ masterId, versionId, pricingRuleId: tieredRuleId });

    return { masterId, versionId };
  }

  /** 이미지 시트가 워크북 전역으로 키를 매기는지 보려고 이미지만 최소로 갖춘 상품. */
  async function createProductWithImages(
    tx: DbTransaction,
    opts: { name: string; primaryFileId: string; additionalFileId?: string },
  ): Promise<{ masterId: string; versionId: string }> {
    const masterId = randomUUID();
    const versionId = randomUUID();
    await tx.insert(productMasters).values({ id: masterId });
    await tx
      .insert(productMasterVersions)
      .values({ id: versionId, masterId, version: 1, status: 'active', name: opts.name });

    const rows = [{ versionId, fileId: opts.primaryFileId, isPrimary: true, sortOrder: 0 }];
    if (opts.additionalFileId) {
      rows.push({ versionId, fileId: opts.additionalFileId, isPrimary: false, sortOrder: 1 });
    }
    await tx.insert(productImages).values(rows);

    return { masterId, versionId };
  }

  /** 옵션 그룹이 아예 없는 상품 — 기본 variant 하나만 있고 variantOptionValues 행이 없다. */
  async function createOptionlessProduct(
    tx: DbTransaction,
  ): Promise<{ masterId: string; versionId: string; variantId: string }> {
    const masterId = randomUUID();
    const versionId = randomUUID();
    await tx.insert(productMasters).values({ id: masterId });
    await tx
      .insert(productMasterVersions)
      .values({ id: versionId, masterId, version: 1, status: 'active', name: '단일 옵션없는 상품' });

    const variantId = randomUUID();
    await tx
      .insert(productVariants)
      .values({ id: variantId, variantCode: 'AY-SINGLE', displayOrder: 1, isDefault: true });
    await tx.insert(productMasterVariants).values({ masterId, variantId, versionId });

    return { masterId, versionId, variantId };
  }

  it('active 버전의 스칼라를 워크북 행으로 옮긴다', async () => {
    const { fx, out } = await inRollbackTx(async (tx) => {
      const fx = await createRichProduct(tx);
      const out = await reader.buildPrefill(tx, [fx.masterId], 'exp-scalar');
      return { fx, out };
    });

    expect(out.data.products).toHaveLength(1);
    const row = out.data.products[0];
    expect(row.rowKey).toBe('P-000001');
    expect(row.name).toBe('겨울 니트');
    expect(row.productCode).toBe('SKU-001');
    expect(row.brand).toBe('브랜드A');
    // 브리프는 productMasterVersions.seller 가 없을 수 있다고 보고 빈칸으로 남겼지만
    // 실제로는 존재하는 컬럼이다 — 채워진다.
    expect(row.seller).toBe('본사');
    expect(row.salesStartDate).toBe('2026-08-01 00:00');
    expect(row.salesEndDate).toBe('2026-08-31 23:59');
    expect(row.seoKeywords).toBe('니트|겨울');
    expect(row.isOverseas).toBe('N');

    expect(out.items).toEqual([
      {
        masterId: fx.masterId,
        versionId: fx.versionId,
        rowKey: 'P-000001',
        pricingEditable: true,
        snapshot: expect.any(Object) as unknown,
      },
    ]);
  });

  it('대표/부가 이미지를 productImages.isPrimary 로 가른다 — thumbnail 컬럼은 죽은 컬럼이다', async () => {
    const { fx, out } = await inRollbackTx(async (tx) => {
      const fx = await createRichProduct(tx);
      const out = await reader.buildPrefill(tx, [fx.masterId], 'exp-images');
      return { fx, out };
    });

    const row = out.data.products[0];
    expect(row.thumbnailImageKey).toBe('IMG-1');
    expect(row.additionalImageKeys).toBe('IMG-2');
    expect(out.data.images).toEqual([
      { imageKey: 'IMG-1', sourceValue: fx.primaryFileId },
      { imageKey: 'IMG-2', sourceValue: fx.additionalFileId },
    ]);
  });

  it('가격이 표현 가능하면 전체가는 판매가/멤버십가로, variant 오버라이드는 조합 행에 반영된다', async () => {
    const out = await inRollbackTx(async (tx) => {
      const fx = await createRichProduct(tx);
      return reader.buildPrefill(tx, [fx.masterId], 'exp-price');
    });

    const row = out.data.products[0];
    expect(row.basePrice).toBe('29000');
    expect(row.membershipPrice).toBe('26000');

    expect(out.data.variants).toHaveLength(1);
    const variantRow = out.data.variants[0];
    expect(variantRow.basePrice).toBe('27000');
    // 오버라이드가 없는 축은 base 를 상속한다는 뜻이고, 셀은 빈 문자열이어야 한다 —
    // extractSimplePrices 가 null 을 주는 것을 str() 이 'null' 문자열로 바꿔버리면 안 된다.
    expect(variantRow.membershipPrice).toBe('');
    expect(out.items[0].pricingEditable).toBe(true);
  });

  it('조합 참조가 optionValueId 정렬 결합이다 — 이름이 아니다', async () => {
    let fx!: RichProductFixture;
    const out = await inRollbackTx(async (tx) => {
      fx = await createRichProduct(tx);
      return reader.buildPrefill(tx, [fx.masterId], 'exp-combo');
    });

    const combo = out.data.variants[0].combination;
    expect(combo).toMatch(/^[0-9a-f-]{36}\+[0-9a-f-]{36}$/);
    // redValueId 는 'ffff...', sizeMValueId 는 '0000...' 로 고정했다(사전식 순서가 반환
    // 순서(색상→사이즈)와 반대가 되도록) — 반환 순서를 그대로 이었다면 여기서 걸린다.
    expect(combo).toBe([fx.redValueId, fx.sizeMValueId].sort().join('+'));
    expect(combo).toBe(`${fx.sizeMValueId}+${fx.redValueId}`);
    // 조합명(참고용)은 사람이 읽는 라벨이라 그룹 sortOrder 순(색상→사이즈)을 그대로 따른다 —
    // combination(식별자)과 combinationLabel(표시용)은 서로 다른 정렬 규칙을 쓴다.
    expect(out.data.variants[0].combinationLabel).toBe('색상=레드;사이즈=M');
  });

  it('옵션 시트가 그룹/값 키와 색상코드를 담고, combination 이 참조하는 id 는 전부 옵션 시트에 실존한다', async () => {
    let fx!: RichProductFixture;
    const out = await inRollbackTx(async (tx) => {
      fx = await createRichProduct(tx);
      return reader.buildPrefill(tx, [fx.masterId], 'exp-options');
    });

    expect(out.data.options).toHaveLength(3); // 레드, 블루, M

    const redRow = out.data.options.find((o) => o.optionValueKey === fx.redValueId);
    // optionKey 는 그룹 id 지 값 id 가 아니다 — 여기가 뒤바뀌면 combination 참조가
    // 조용히 어긋난다(값 id 인 척하는 그룹 id).
    expect(redRow).toMatchObject({
      optionKey: fx.colorGroupId,
      optionValueKey: fx.redValueId,
      optionValueName: '레드',
      colorCode: '#FF0000',
    });

    const sizeRow = out.data.options.find((o) => o.optionValueKey === fx.sizeMValueId);
    expect(sizeRow).toMatchObject({
      optionKey: fx.sizeGroupId,
      optionValueKey: fx.sizeMValueId,
      optionValueName: 'M',
      colorCode: '', // 색 없는 값은 null → 빈 문자열, 'null' 문자열이 아니다.
    });

    // combination 문자열이 가리키는 모든 id 가 옵션 시트에 실존해야 한다 — optionKey 나
    // optionGroupId 를 값 id 자리에 잘못 넣으면(둘 다 uuid 라 타입으로는 안 잡힌다)
    // 조합 참조가 존재하지 않는 옵션값을 가리키게 되는데, 지금까지의 스위트는 이걸
    // 한 번도 확인하지 않았다.
    const optionValueKeys = new Set(out.data.options.map((o) => o.optionValueKey));
    for (const variantRow of out.data.variants) {
      for (const id of variantRow.combination.split('+').filter(Boolean)) {
        expect(optionValueKeys.has(id)).toBe(true);
      }
    }
  });

  it('카테고리 경로가 이름 기반 경로다 — getCategories()의 ID materialized path 가 아니다', async () => {
    const out = await inRollbackTx(async (tx) => {
      const fx = await createRichProduct(tx);
      return reader.buildPrefill(tx, [fx.masterId], 'exp-category');
    });

    expect(out.data.categories).toHaveLength(1);
    expect(out.data.categories[0].categoryPath).toBe('여성패션>니트');
    expect(out.data.categories[0].isPrimary).toBe('Y');
    expect(out.data.categoryPaths).toContain('여성패션>니트');
    expect(out.data.categoryPaths).toContain('여성패션');
  });

  it('구매제약이 있으면 구매제약 시트 행이 생긴다', async () => {
    const out = await inRollbackTx(async (tx) => {
      const fx = await createRichProduct(tx);
      return reader.buildPrefill(tx, [fx.masterId], 'exp-constraint');
    });

    expect(out.data.constraints).toHaveLength(1);
    expect(out.data.constraints[0].requiresMembership).toBe('Y');
    expect(out.data.constraints[0].lifetimeQuantityLimit).toBe('2');
  });

  it('복합 가격규칙(tiered) 상품은 가격 칸이 센티넬이고 pricingEditable 이 false 다', async () => {
    const out = await inRollbackTx(async (tx) => {
      const fx = await createTieredProduct(tx);
      return reader.buildPrefill(tx, [fx.masterId], 'exp-tiered');
    });

    expect(out.data.products[0].basePrice).toBe(PRICING_SENTINEL);
    expect(out.data.products[0].membershipPrice).toBe(PRICING_SENTINEL);
    expect(out.items[0].pricingEditable).toBe(false);
  });

  it('active 버전이 없는 masterId 는 건너뛴다 — 잡 전체를 실패시키지 않는다', async () => {
    const out = await inRollbackTx(async (tx) => {
      const fx = await createRichProduct(tx);
      return reader.buildPrefill(tx, [fx.masterId, randomUUID()], 'exp-skip');
    });

    expect(out.data.products).toHaveLength(1);
    expect(out.items).toHaveLength(1);
  });

  it('활성 버전 미존재 외의 에러는 삼키지 않는다 — aborted 트랜잭션이 빈 성공으로 위장하지 않는다', async () => {
    // Rollback 던지기 전에 실패해야 하므로 inRollbackTx 를 쓰지 않는다 — buildPrefill 자체가
    // 던지는 게 이 테스트의 단정이다(drizzle 트랜잭션은 콜백이 던지면 알아서 롤백한다).
    let caught: unknown;
    await db
      .transaction(async (tx) => {
        const fx = await createRichProduct(tx);
        // 트랜잭션을 고의로 abort 시킨다 — 이후 모든 쿼리(getCategoryTree/getActiveVersion
        // 포함)가 "current transaction is aborted" 로 실패한다. catch 를 NotFoundException
        // 만 잡게 좁히지 않았다면, 이 에러도 삼켜져 buildPrefill 이 { products: [] } 를
        // 반환하며 "성공"해버린다.
        await tx.execute(drizzleSql`SELECT 1/0`).catch(() => undefined);
        await reader.buildPrefill(tx, [fx.masterId], 'exp-aborted');
      })
      .catch((err: unknown) => {
        caught = err;
      });

    // drizzle 이 원본 postgres 에러를 DrizzleQueryError.cause 로 감싼다 — 상위 message 는
    // "Failed query: ..." 라 여기서 대신 cause 로 실제 postgres 에러(aborted transaction,
    // 코드 25P02)를 직접 확인한다. 메시지 텍스트가 아니라 "삼켜지지 않고 올라왔다"가 핵심.
    expect(caught).toBeInstanceOf(DrizzleQueryError);
    expect((caught as DrizzleQueryError).cause?.message).toMatch(/current transaction is aborted/i);
  });

  it('이미지키는 워크북 전역이다 — 상품마다 IMG-1 부터 다시 시작하지 않는다', async () => {
    const fileA = randomUUID();
    const fileShared = randomUUID();
    const fileB = randomUUID();

    const out = await inRollbackTx(async (tx) => {
      // 상품1 의 부가이미지와 상품2 의 대표이미지가 같은 파일(fileShared)을 가리키게
      // 해서, 파일 공유 시 키가 하나로 합쳐지는지도 같은 테스트에서 본다.
      const p1 = await createProductWithImages(tx, {
        name: '상품1',
        primaryFileId: fileA,
        additionalFileId: fileShared,
      });
      const p2 = await createProductWithImages(tx, {
        name: '상품2',
        primaryFileId: fileShared,
        additionalFileId: fileB,
      });
      return reader.buildPrefill(tx, [p1.masterId, p2.masterId], 'exp-multi-image');
    });

    expect(out.data.products).toHaveLength(2);
    const [row1, row2] = out.data.products;

    // imageKeyByFileId 를 상품 루프 안에서 새로 만드는 회귀가 있으면 둘 다 'IMG-1' 이
    // 되고, 상품2의 대표이미지가 상품1의 파일을 가리키는 것처럼 보인다.
    expect(row1.thumbnailImageKey).not.toBe(row2.thumbnailImageKey);

    const imageByKey = new Map(out.data.images.map((img) => [img.imageKey, img.sourceValue]));
    expect(imageByKey.get(row1.thumbnailImageKey)).toBe(fileA);
    expect(imageByKey.get(row2.thumbnailImageKey)).toBe(fileShared);

    // 상품1의 부가이미지(fileShared)와 상품2의 대표이미지(fileShared)는 같은 파일이라
    // 같은 키 하나로 합쳐진다 — 이미지 시트에 fileShared 행이 중복 등장하지 않는다.
    expect(row1.additionalImageKeys).toBe(row2.thumbnailImageKey);
    expect(out.data.images.filter((img) => img.sourceValue === fileShared)).toHaveLength(1);
    expect(out.data.images).toHaveLength(3); // fileA, fileShared, fileB — 중복 없음
  });

  it('옵션 없는 상품은 조합이 빈 문자열인 기본 variant 하나를 낸다 — 결측이 아니라 계약이다', async () => {
    const out = await inRollbackTx(async (tx) => {
      const fx = await createOptionlessProduct(tx);
      const result = await reader.buildPrefill(tx, [fx.masterId], 'exp-optionless');
      return { fx, result };
    });

    expect(out.result.data.variants).toHaveLength(1);
    const variantRow = out.result.data.variants[0];
    // 빈 combination 은 파싱 오류가 아니라 "옵션 없는 상품의 단일 기본 variant"라는
    // 계약이다(스펙 오너 확정, form-export.snapshot.reader.ts 조합 필드 코멘트 참조) —
    // 그 상품은 옵션 축이 없으니 조합으로 식별할 게 없고 variantCode 로 유일하다.
    expect(variantRow.combination).toBe('');
    expect(variantRow.combinationLabel).toBe('');
    expect(variantRow.variantCode).toBe('AY-SINGLE');
    expect(out.result.items[0].masterId).toBe(out.fx.masterId);
  });

  it('items.snapshot 에 워크북에 찍힌 것과 같은 행이 담긴다', async () => {
    const { data, items } = await inRollbackTx(async (tx) => {
      const fx = await createRichProduct(tx);
      return reader.buildPrefill(tx, [fx.masterId], 'exp-snapshot-value');
    });

    const item = items[0];
    expect(item.snapshot.product.name).toBe(data.products[0].name);
    expect(item.snapshot.product.basePrice).toBe(data.products[0].basePrice);
    // 워크북 행에는 rowKey 가 있고 스냅샷에는 없다 — 그 하나만 다르다.
    expect(item.snapshot.product.rowKey).toBeUndefined();
  });

  it('snapshot.images 는 그 상품이 참조하는 키만 담는다', async () => {
    const fileA = randomUUID();
    const fileB = randomUUID();
    const fileBAdditional = randomUUID();

    const { items, masterIdA } = await inRollbackTx(async (tx) => {
      // A 는 대표이미지만(부가 없음), B 는 대표+부가 둘 다 — A 의 snapshot.images 가
      // B 의 참조를 섞어 담지 않는지(상품별로 정확히 자기 것만 담는지)를 본다.
      const pA = await createProductWithImages(tx, { name: '상품A', primaryFileId: fileA });
      const pB = await createProductWithImages(tx, {
        name: '상품B',
        primaryFileId: fileB,
        additionalFileId: fileBAdditional,
      });
      const out = await reader.buildPrefill(tx, [pA.masterId, pB.masterId], 'exp-snapshot-images');
      return { items: out.items, masterIdA: pA.masterId };
    });

    const a = items.find((i) => i.masterId === masterIdA)!;
    expect(Object.keys(a.snapshot.images)).toEqual([a.snapshot.product.thumbnailImageKey]);
  });

  it('renderMaster 를 seed 된 할당기로 다시 부르면 같은 이미지 키가 나온다', async () => {
    const fileA = randomUUID();
    const fileB = randomUUID();

    // renderMaster 재호출은 같은 상품이 여전히 존재해야 하므로(재조회), 픽스처 생성과
    // 재호출을 **같은** 롤백 트랜잭션 안에서 한다 — 트랜잭션 밖에서 부르면 이미
    // 롤백되어 사라진 masterId 를 찾다 null 을 돌려받는다.
    const { snapshot, again } = await inRollbackTx(async (tx) => {
      const fx = await createProductWithImages(tx, {
        name: '상품A',
        primaryFileId: fileA,
        additionalFileId: fileB,
      });
      const out = await reader.buildPrefill(tx, [fx.masterId], 'exp-snapshot-reseed');
      const snapshot = out.items[0].snapshot;
      const again = await reader.renderMaster(tx, fx.masterId, createImageKeyAllocator(snapshot.images), new Map());
      return { snapshot, again };
    });

    expect(again!.product.thumbnailImageKey).toBe(snapshot.product.thumbnailImageKey);
    expect(again!.product.additionalImageKeys).toBe(snapshot.product.additionalImageKeys);
  });
});
