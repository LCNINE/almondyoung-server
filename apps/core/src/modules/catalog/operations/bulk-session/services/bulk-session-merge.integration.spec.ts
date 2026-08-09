// 이 스위트는 `ProductBulkService` 를 **진짜로** 부른다(§F1 회귀 잠금). 그 파일이 정적으로
// 끌어오는 `product-versions.service.ts`/`product-masters.service.ts` 가 bare
// `@packages/event-contracts` 를 import 하는데, 루트 jest 설정의 moduleNameMapper 에는
// `^@packages/event-contracts/(.*)$`(하위 경로)만 있고 bare 경로 항목이 없어 해석되지
// 않는다 — 레포 상시 debt 다. 레포에 이미 있는 선례(product-versions.service.spec.ts:1-7)와
// **같은 모양**으로 가상 모듈을 세운다. 값이 필요한 곳은 클래스 정의 시점에 평가되는
// `@InjectPublisher(PRODUCT_STREAM)` 데코레이터 인자뿐이고(그 안에서 `stream.topic.topic` 만 읽는다), 이 스위트는
// 그 두 서비스를 인스턴스화하지도 부르지도 않는다(아래 bulkService 생성 코멘트 참조).
jest.mock(
  '@packages/event-contracts',
  () => ({
    PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product', events: {} },
  }),
  { virtual: true },
);

import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import * as ExcelJS from 'exceljs';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { OutboxPublisher, StreamPublisher } from '@app/events';
import { PRODUCT_STREAM } from '@packages/event-contracts';
import { DbTransaction } from '../../../catalog.types';
import {
  catalogSchema,
  type PimSchema,
  productMasters,
  productMasterVersions,
  productCategories,
  productMasterCategories,
  productMasterVariants,
  productVariants,
  productImages,
  productFormExports,
  productFormExportItems,
  productBulkSessions,
  productBulkItems,
  pricingRules,
  productMasterPricingRules,
  productPurchaseConstraints,
  productMasterPurchaseConstraints,
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
import { ProductBulkService } from '../../bulk/product-bulk.service';
import { ProductSkuMappingService } from '../../../../product-matching/services/product-sku-mapping.service';
import { FormExportSnapshotReader } from './form-export.snapshot.reader';
import { buildFormWorkbook } from './form-export.workbook';
import { BulkSessionJobManager } from './bulk-session-job.manager';
import { BulkVariantCodeChecker } from './bulk-variant-code.checker';
import type { PrefillRow, PrefillWorkbookData } from './form-export.types';

/**
 * **이 단계의 핵심 주장**을 실 Postgres 에 대고 못 박는다 — 설계 스펙 §8:
 * "작업자가 A필드를, 남이 B필드를 바꿨을 때 발행 후 둘 다 살아있는가."
 *
 * ⚠️ **2단계가 증명할 수 있는 것은 그 절반이다.** *발행*(포크-후-diff 적용 → draft →
 * publish)은 4·5단계 몫이라 이 브랜치에 코드가 없다. 여기서 증명하는 것은
 * **"payload 가 A 만 담고 B 를 안 건드린다"**까지다 — 즉 4단계가 남의 값을 보존할 수 있는
 * *입력*을 2단계가 정확히 만들어 준다는 것. "정말로 둘 다 살아남았다"는 4·5단계가 생긴 뒤에야
 * 검증된다. 이 스위트의 어떤 단정도 그 이상을 주장하지 않는다.
 *
 * **실행**: `bulk_stage2_scratch` 같은 scratch DB 를 가리키는 DATABASE_URL 로 돌린다 —
 * `dev_core` 에는 이 브랜치와 무관한 보류 중인 마이그레이션이 있어 거기서 마이그레이션을
 * 실행하면 안 되고, 이 스위트는 실 상품 테이블에 픽스처를 넣는다.
 *
 * **격리**: 롤백 전용이다. 각 테스트가 트랜잭션 하나를 열어 픽스처 생성 → 양식 조립 →
 * 남의 편집 → 워크북 편집 → 파싱/검증 슬라이스까지 전부 그 안에서 돌리고 항상 롤백한다
 * (선례: form-export-snapshot.integration.spec.ts:53-57). 그래서 이 스위트는
 * `claim()` 을 **한 번도 부르지 않는다** — claim 은 세션을 골라내는 필터가 없어(가장 오래된
 * 자격 세션을 집는 게 본래 동작이다) 남의 대기 세션을 집을 수 있다. lease 토큰은 픽스처가
 * 직접 심고, lease 소유권 자체는 `bulk-session-lease.integration.spec.ts` 가 격리 스키마에서
 * 따로 증명한다.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_BULK_SESSION_DB === '1' && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the bulk session merge integration suite.');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

/** 워크북 시트/헤더 상수를 문자열로 다시 적지 않는다 — 라벨이 바뀌면 여기가 같이 깨져야 한다. */
const PRODUCT_SHEET = '상품';
const BRAND_LABEL = '브랜드';

interface ProductFixture {
  masterId: string;
  versionId: string;
  variantId: string;
  categoryId: string;
  categoryPath: string;
  primaryFileId: string;
  additionalFileId: string;
}

describeIfDb('일괄 세션 병합 시나리오 (실 Postgres)', () => {
  jest.setTimeout(180_000);

  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof catalogSchema>;
  let reader: FormExportSnapshotReader;
  let categories: ProductCategoriesService;
  let bulkService: ProductBulkService;
  let manager: BulkSessionJobManager;
  let download: jest.Mock<Promise<Buffer>, []>;
  /** 이 테스트가 열어 둔 롤백 트랜잭션. 매니저의 `db.run(fn)`(tx 없는 호출)이 여기에 합류한다. */
  let ambientTx: DbTransaction | null = null;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: catalogSchema });

    // 선례(form-export-snapshot.integration.spec.ts:78-86)를 따라 DbService 를 Nest DI 로
    // 부트스트랩하지 않고 `db`+`run` 만 채운 가짜를 쓴다. 단, 여기서는 `run` 이 **앰비언트
    // 트랜잭션**으로 폴백한다 — BulkSessionJobManager 는 tx 를 인자로 받지 않는 서비스라
    // `db.run(fn)` 을 tx 없이 여러 번 부르는데, 그때마다 새 트랜잭션을 열면 롤백 격리 밖으로
    // 새고(커밋된 행이 DB 에 남는다) 같은 커넥션(max:1)에서 픽스처도 못 본다.
    const dbService = {
      db,
      run: <T>(fn: (t: DbTransaction) => Promise<T>, tx?: DbTransaction): Promise<T> => {
        const target = tx ?? ambientTx;
        return target ? fn(target) : db.transaction((t) => fn(t));
      },
    } as unknown as DbService<PimSchema>;

    const calculator = new PricingCalculatorService(dbService);
    const validator = new PricingValidatorService(dbService, calculator);
    const pricing = new PricingService(dbService, validator, calculator);
    const priceCache = new VariantPriceCacheService(dbService, calculator);
    const versionLoader = new ProductVersionReadLoader();
    const optionLoader = new OptionReadLoader();
    const tagLoader = new TagReadLoader();
    const snapshotAssembler = new ProjectionSnapshotAssembler(versionLoader, optionLoader, tagLoader, priceCache);
    // OutboxPublisher 는 스키마 제네릭을 받지 않는(기본값 Record<string, never>) DbService 를
    // 받는다 — 우리 dbService 의 실제 동작(db/run)엔 무관하고 순수 타입 불일치라 캐스팅한다.
    // 카테고리 서비스는 이제 아웃박스가 아니라 publisher 를 받는다 (ADR-0029 §5) —
    // `enqueue` 는 transport 를 쓰지 않으므로 전송 스텁으로 충분하다.
    const outbox = new OutboxPublisher(dbService as unknown as DbService);
    const productPublisher = new StreamPublisher(
      { send: async () => undefined },
      PRODUCT_STREAM,
      'core-integration-spec',
      undefined,
      undefined,
      undefined,
      outbox,
    );
    categories = new ProductCategoriesService(dbService, snapshotAssembler, productPublisher);
    // 이 스위트는 §F1(브랜드/셀러 병합) 회귀 잠금이지 품목 판매정책 프리필 검증이 아니다
    // — 실 ProductSkuMappingService 는 inventory BC 의 무거운 의존성 그래프(SharedModule
    // 등)를 끌고 오므로, 여기서는 빈 배치 응답 스텁만 채운다. base/current 양쪽 renderMaster
    // 호출이 같은 스텁을 공유해 항상 같은 기본값을 내므로, 이 스위트가 보는 diff(§F1 필드)에
    // 정책 필드가 잡음으로 끼어들지 않는다.
    const skuMapping = {
      getVariantMatchingBatch: () => Promise.resolve({ data: [] }),
    } as unknown as ProductSkuMappingService;
    reader = new FormExportSnapshotReader(versionLoader, optionLoader, pricing, categories, skuMapping);

    // `ProductBulkService.bulkUpdate` 의 brand/seller 경로(§F1 회귀 잠금)는 dto.status 가
    // 없으면 productVersionsService/productMastersService 를 **한 번도** 부르지 않는다
    // (product-bulk.service.ts:70-114 — status 분기 두 개를 지나면 getClient(tx) 로 직접
    // UPDATE 한다). 그 두 협력자는 스트림 퍼블리셔·재고 seam 까지 딸린 10-의존성 그래프라,
    // 이 스위트가 검증하려는 경로와 무관한 것을 세우지 않으려고 비워 둔다. 이 경로 밖을
    // 부르면 즉시 TypeError 로 터지므로 조용히 잘못될 수 없다.
    bulkService = new ProductBulkService(dbService, undefined as never, undefined as never);

    download = jest.fn<Promise<Buffer>, []>(() => Promise.resolve(Buffer.alloc(0)));
    // (Task 8) BulkSessionJobManager 생성자에 BulkDraftApplier 가 늘었다 — 이 스위트는 병합
    // (파싱→검증) 경로만 보고 drafting 슬라이스는 부르지 않으므로, bulkService 위의 두
    // 협력자와 같은 이유로 실제 applier 를 세우지 않는다(부르면 즉시 TypeError 로 터진다).
    // (Task 3) ProductVersionsService 도 같은 이유로 `undefined as never` 다 — 이 스위트는
    // 발행 슬라이스를 부르지 않는다.
    // (Task 11) BulkVariantCodeChecker 는 이 스위트가 실제로 부르는 검증 슬라이스의 마감
    // 분기에서 매번 불린다 — `undefined as never` 를 넘기면 TypeError 로 죽는다. 이 스위트의
    // 워크북 픽스처는 조합 시트의 품목코드 열을 채우지 않으므로(변경분에 `variant:*.variantCode`
    // 가 잡히지 않는다) 매 호출이 항상 0건으로 끝난다 — 같은 dbService 에 물린 진짜 인스턴스를
    // 쓴다.
    manager = new BulkSessionJobManager(
      dbService,
      { download } as never,
      reader,
      categories,
      undefined as never,
      undefined as never,
      new ConfigService({ PRODUCT_BULK_LEASE_MS: '30000', PRODUCT_BULK_VALIDATE_SLICE: '50' }),
      new BulkVariantCodeChecker(dbService),
      // (Task 8) 조합키 해석기·판매정책 서비스는 발행 슬라이스 전용이다 — 이 스위트는 그
      // 슬라이스를 부르지 않으므로 위 applier·versions 와 같은 이유로 비워 둔다.
      undefined as never,
      undefined as never,
    );
  });

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(() => {
    // `download` 는 `beforeAll` 에서 한 번 만들어 매니저에 박히므로 테스트끼리 공유된다.
    // `runLane` 이 `mockResolvedValueOnce` 로 워크북을 예약하는데, 어떤 테스트가 그 값을
    // 소비하기 전에 던지면(픽스처 오류 등) **다음 테스트가 남의 버퍼를 파싱한다** — 초록인
    // 채로 틀린 것을 검증하게 된다. `mockClear` 로는 부족하다: 호출 이력만 지우고 예약된
    // once 값은 그대로 남는다(jest 문서 — 구현/큐를 지우는 건 `mockReset` 뿐이다).
    // lease 스펙의 `beforeEach` 가 같은 사고를 같은 방식으로 막는다.
    //
    // 리셋 후 기본 구현은 **던진다**. 빈 버퍼를 돌려주면 파서가 그걸 "유효한 엑셀이 아님"
    // 으로 읽어 세션을 조용히 failed 로 만들고, 그 뒤 `fieldsOf` 가 payload NULL 로 터져
    // 원인이 한 단계 멀어진다. 예약 없이 불린 순간 그 자리에서 이유를 말하게 한다.
    download.mockReset().mockImplementation(() => {
      throw new Error('워크북 예약 없이 download 가 불렸다 — runLane 이 mockResolvedValueOnce 를 세우기 전에 호출됐다');
    });
  });

  /** 트랜잭션 안에서 전부 돌리고 항상 롤백한다. `ambientTx` 로 매니저의 tx 없는 호출도 끌어들인다. */
  async function inRollbackTx<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
    let captured!: T;
    await expect(
      db.transaction(async (tx) => {
        ambientTx = tx;
        try {
          captured = await fn(tx);
        } finally {
          ambientTx = null;
        }
        throw new Rollback('intentional rollback');
      }),
    ).rejects.toThrow(Rollback);
    return captured;
  }

  /**
   * 발행된 상품 하나. 옵션 축이 없어 기본 variant 하나(빈 조합)를 가지며, 대표+부가 이미지와
   * 카테고리 배정, 그리고 임포트가 표현할 수 있는 가격 룰(all_variants override) 하나를 갖는다.
   */
  async function createPublishedProduct(
    tx: DbTransaction,
    opts: { name: string; brand: string; variantCode: string; lifetimeQuantityLimit?: number },
  ): Promise<ProductFixture> {
    const masterId = randomUUID();
    const versionId = randomUUID();
    await tx.insert(productMasters).values({ id: masterId });
    await tx.insert(productMasterVersions).values({
      id: versionId,
      masterId,
      version: 1,
      status: 'active',
      name: opts.name,
      brand: opts.brand,
      productCode: `SKU-${opts.variantCode}`,
      seller: '본사',
      productType: 'regular_sale',
      fulfillmentKind: 'physical',
    });

    const parentId = randomUUID();
    const categoryId = randomUUID();
    const suffix = randomUUID().slice(0, 8);
    await tx.insert(productCategories).values([
      { id: parentId, name: `여성패션-${suffix}`, slug: `women-${suffix}`, level: 0, path: parentId },
      {
        id: categoryId,
        name: `니트-${suffix}`,
        slug: `knit-${suffix}`,
        parentId,
        level: 1,
        path: `${parentId}/${categoryId}`,
      },
    ]);
    await tx.insert(productMasterCategories).values({ masterId, categoryId, versionId, isPrimary: true });

    const variantId = randomUUID();
    await tx.insert(productVariants).values({ id: variantId, variantCode: opts.variantCode, displayOrder: 1 });
    await tx.insert(productMasterVariants).values({ masterId, variantId, versionId });

    const primaryFileId = randomUUID();
    const additionalFileId = randomUUID();
    await tx.insert(productImages).values([
      { versionId, fileId: primaryFileId, isPrimary: true, sortOrder: 0 },
      { versionId, fileId: additionalFileId, isPrimary: false, sortOrder: 1 },
    ]);

    // 구매제약은 옵션이다 — '구매제약' 시트 행이 생기는 픽스처가 필요할 때만 붙인다.
    if (opts.lifetimeQuantityLimit !== undefined) {
      const constraintId = randomUUID();
      await tx
        .insert(productPurchaseConstraints)
        .values({ id: constraintId, requiresMembership: true, lifetimeQuantityLimit: opts.lifetimeQuantityLimit });
      await tx
        .insert(productMasterPurchaseConstraints)
        .values({ masterId, versionId, purchaseConstraintId: constraintId });
    }

    const ruleId = randomUUID();
    await tx.insert(pricingRules).values({
      id: ruleId,
      layer: 'base_price',
      order: 1,
      scopeType: 'all_variants',
      operationType: 'override',
      operationValue: 29000,
    });
    await tx.insert(productMasterPricingRules).values({ masterId, versionId, pricingRuleId: ruleId });

    return {
      masterId,
      versionId,
      variantId,
      categoryId,
      categoryPath: `여성패션-${suffix}>니트-${suffix}`,
      primaryFileId,
      additionalFileId,
    };
  }

  /**
   * **남이 정상 경로로 바꾼다** — 새 버전을 만들어 발행한다(draft → publish 의 최종 상태).
   * 자식 행(이미지·조합·카테고리·가격규칙)을 새 버전으로 복사해 `renderMaster` 가 그리는
   * '현재 active' 가 이름/브랜드만 다른 온전한 상품이 되게 한다.
   */
  async function publishNewVersion(
    tx: DbTransaction,
    fx: ProductFixture,
    patch: { name?: string; brand?: string },
  ): Promise<string> {
    const [old] = await tx.select().from(productMasterVersions).where(eq(productMasterVersions.id, fx.versionId));
    const newVersionId = randomUUID();
    await tx
      .update(productMasterVersions)
      .set({ status: 'inactive' })
      .where(eq(productMasterVersions.id, fx.versionId));
    await tx.insert(productMasterVersions).values({
      ...old,
      id: newVersionId,
      version: old.version + 1,
      status: 'active',
      name: patch.name ?? old.name,
      brand: patch.brand ?? old.brand,
    });

    await tx.insert(productImages).values([
      { versionId: newVersionId, fileId: fx.primaryFileId, isPrimary: true, sortOrder: 0 },
      { versionId: newVersionId, fileId: fx.additionalFileId, isPrimary: false, sortOrder: 1 },
    ]);
    await tx
      .insert(productMasterVariants)
      .values({ masterId: fx.masterId, variantId: fx.variantId, versionId: newVersionId });
    await tx
      .insert(productMasterCategories)
      .values({ masterId: fx.masterId, categoryId: fx.categoryId, versionId: newVersionId, isPrimary: true });
    const rules = await tx
      .select()
      .from(productMasterPricingRules)
      .where(eq(productMasterPricingRules.versionId, fx.versionId));
    for (const rule of rules) {
      await tx
        .insert(productMasterPricingRules)
        .values({ masterId: fx.masterId, versionId: newVersionId, pricingRuleId: rule.pricingRuleId });
    }
    return newVersionId;
  }

  /** 1단계 양식 잡 한 건을 만든다 — export 행 + items(스냅샷을 **값으로** 저장) + 워크북 데이터. */
  async function buildExport(tx: DbTransaction, masterIds: string[]): Promise<PrefillWorkbookData> {
    const exportId = randomUUID();
    await tx.insert(productFormExports).values({
      id: exportId,
      requestedBy: randomUUID(),
      requestedMasterIds: masterIds,
      status: 'completed',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const { data, items } = await reader.buildPrefill(tx, masterIds, exportId);
    for (const item of items) {
      await tx.insert(productFormExportItems).values({
        exportId,
        masterId: item.masterId,
        versionId: item.versionId,
        rowKey: item.rowKey,
        pricingEditable: item.pricingEditable,
        snapshot: item.snapshot,
      });
    }
    return data;
  }

  /** 업로드 세션 하나. lease 토큰을 직접 심어 claim() 을 거치지 않는다(헤더 코멘트 참조). */
  async function seedSession(tx: DbTransaction, exportId: string | null): Promise<string> {
    const sessionId = randomUUID();
    await tx.insert(productBulkSessions).values({
      id: sessionId,
      name: '병합 시나리오',
      exportId,
      uploadedBy: randomUUID(),
      fileName: '양식.xlsx',
      sourceFileId: randomUUID(),
      phase: 'uploaded',
    });
    return sessionId;
  }

  /** 파싱 → 검증을 끝까지 돌린다. 각 단계 앞에서 lease 토큰을 심어 CAS 를 만족시킨다. */
  async function runLane(tx: DbTransaction, sessionId: string, buffer: Buffer): Promise<void> {
    download.mockResolvedValueOnce(buffer);

    const parseToken = randomUUID();
    await tx
      .update(productBulkSessions)
      .set({ leaseToken: parseToken, leaseUntil: new Date(Date.now() + 60_000) })
      .where(eq(productBulkSessions.id, sessionId));
    await manager.runParseSlice({ sessionId, leaseToken: parseToken, phase: 'uploaded' });

    // 검증 슬라이스는 남은 행이 없을 때만 review 로 민다 — 한 번 더 돌려 마감까지 본다.
    for (let pass = 0; pass < 2; pass += 1) {
      const token = randomUUID();
      await tx
        .update(productBulkSessions)
        .set({ leaseToken: token, leaseUntil: new Date(Date.now() + 60_000) })
        .where(eq(productBulkSessions.id, sessionId));
      await manager.runValidateSlice({ sessionId, leaseToken: token, phase: 'validating' });
    }
  }

  async function readItems(tx: DbTransaction, sessionId: string) {
    return tx
      .select()
      .from(productBulkItems)
      .where(eq(productBulkItems.sessionId, sessionId))
      .orderBy(productBulkItems.rowNumber);
  }

  async function readSession(tx: DbTransaction, sessionId: string) {
    const [row] = await tx.select().from(productBulkSessions).where(eq(productBulkSessions.id, sessionId));
    return row;
  }

  /** 워크북의 특정 상품 행 한 셀만 고친 데이터. "작업자가 엑셀에서 그 칸만 고쳤다"의 코드 표현. */
  function editCell(data: PrefillWorkbookData, rowKey: string, key: string, value: string): PrefillWorkbookData {
    return {
      ...data,
      products: data.products.map((row) => (row.rowKey === rowKey ? { ...row, [key]: value } : row)),
    };
  }

  /** 작업자가 엑셀에서 열 하나를 통째로 지운 파일. 라벨로 찾아 지운다(파서도 라벨로 읽는다). */
  async function dropColumn(buffer: Buffer, sheetName: string, headerLabel: string): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    // exceljs 의 앰비언트 Buffer shim 과 @types/node 의 Buffer 가 병합돼 호출부에서 TS2345 가
    // 나므로 메서드 타입만 지역에서 다시 선언한다(bulk-upload.parser.ts:126-131 과 같은 우회).
    const xlsx = wb.xlsx as unknown as { load(b: Buffer): Promise<ExcelJS.Workbook> };
    await xlsx.load(buffer);
    const ws = wb.getWorksheet(sheetName);
    if (!ws) throw new Error(`시트를 찾을 수 없다: ${sheetName}`);
    let target = -1;
    ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
      if (String(cell.text ?? '').trim() === headerLabel) target = col;
    });
    if (target < 0) throw new Error(`헤더를 찾을 수 없다: ${headerLabel}`);
    ws.spliceColumns(target, 1);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  const fieldsOf = (payload: unknown): Record<string, string> => {
    // payload 는 jsonb 왕복 값이라 `unknown` 이다. 단정 직전에 shape 을 한 번만 좁힌다.
    const value = payload as { fields: Record<string, string> } | null;
    if (!value) throw new Error('payload 가 NULL 이다 — 검증이 끝나지 않았다');
    return value.fields;
  };

  it('작업자가 A필드를, 남이 B필드를 바꿨으면 충돌이 없고 payload 에 A 만 남는다', async () => {
    const { items, session } = await inRollbackTx(async (tx) => {
      const fx = await createPublishedProduct(tx, { name: '티셔츠', brand: 'ACME', variantCode: 'AY-TEE' });
      const data = await buildExport(tx, [fx.masterId]);

      // 남: 정상 draft→publish 경로로 **브랜드**를 바꾼다.
      await publishNewVersion(tx, fx, { brand: 'NEWCO' });

      // 작업자: 받은 워크북에서 **상품명** 한 칸만 고친다.
      const buffer = await buildFormWorkbook(editCell(data, 'P-000001', 'name', '티셔츠 v2'));

      const sessionId = await seedSession(tx, data.exportId);
      await runLane(tx, sessionId, buffer);
      return { items: await readItems(tx, sessionId), session: await readSession(tx, sessionId) };
    });

    expect(session.phase).toBe('review');
    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item.kind).toBe('update');
    expect(item.status).toBe('pending');
    expect(item.conflict).toBeNull();

    const fields = fieldsOf(item.payload);
    // **`product.brand` 가 없는 것이 이 테스트의 요점이다** — 4단계의 포크-후-적용이 남의
    // 값을 보존할 수 있는 것은 2단계가 안 건드린 필드를 payload 에서 빼 주기 때문이다.
    // (여기까지가 2단계가 증명할 수 있는 전부다 — 헤더 코멘트의 ⚠️ 참조.)
    expect(Object.keys(fields)).toEqual(['product.name']);
    expect(fields['product.name']).toBe('티셔츠 v2');
    expect('product.brand' in fields).toBe(false);
  });

  it('둘이 같은 필드를 바꿨으면 base·mine·current 세 값이 담긴 충돌로 잡힌다', async () => {
    const item = await inRollbackTx(async (tx) => {
      const fx = await createPublishedProduct(tx, { name: '티셔츠', brand: 'ACME', variantCode: 'AY-TEE2' });
      const data = await buildExport(tx, [fx.masterId]);

      await publishNewVersion(tx, fx, { name: '남이 바꾼 이름' });

      const buffer = await buildFormWorkbook(editCell(data, 'P-000001', 'name', '작업자가 바꾼 이름'));
      const sessionId = await seedSession(tx, data.exportId);
      await runLane(tx, sessionId, buffer);
      const [row] = await readItems(tx, sessionId);
      return row;
    });

    expect(item.conflict).toEqual({
      'product.name': { base: '티셔츠', mine: '작업자가 바꾼 이름', current: '남이 바꾼 이름' },
    });
    // 충돌이 났다고 변경분을 지우지 않는다 — 결정(overwrite/skip)은 사람이 하고,
    // Task 10 의 승인 게이트가 미결정 충돌을 막는다.
    expect(fieldsOf(item.payload)['product.name']).toBe('작업자가 바꾼 이름');
  });

  it('남이 brand 를 active 행에 인플레이스로 바꿔도 충돌로 잡힌다 (§F1 회귀 잠금)', async () => {
    const { item, fx } = await inRollbackTx(async (tx) => {
      const fx = await createPublishedProduct(tx, { name: '티셔츠', brand: 'ACME', variantCode: 'AY-TEE3' });
      const data = await buildExport(tx, [fx.masterId]);

      // 남: **새 버전을 만들지 않는** 경로. 운영 화면의 일괄 브랜드 변경이 active 행을
      // 그대로 UPDATE 한다(product-bulk.service.ts:94-98). 진짜 서비스를 부른다.
      const result = await bulkService.bulkUpdate(
        { productIds: [fx.masterId], brand: '인플레이스브랜드' },
        randomUUID(),
        tx,
      );
      expect(result.updated).toBe(1);

      const buffer = await buildFormWorkbook(editCell(data, 'P-000001', 'brand', '작업자브랜드'));
      const sessionId = await seedSession(tx, data.exportId);
      await runLane(tx, sessionId, buffer);
      const [row] = await readItems(tx, sessionId);
      return { item: row, fx };
    });

    // 이 경로의 사고 모양: versionId 는 **그대로다**. "다운로드 시점 versionId ≠ 현재
    // versionId 면 남이 바꾼 것"이라는 재구성 설계였다면 여기서 조용히 통과해, 4단계가
    // 남의 브랜드를 되돌려 놓는다. 스냅샷을 **값으로** 저장하는 설계(§F1)라야 잡힌다.
    expect(item.baseVersionId).toBe(fx.versionId);
    expect(item.conflict).toEqual({
      'product.brand': { base: 'ACME', mine: '작업자브랜드', current: '인플레이스브랜드' },
    });
    expect(fieldsOf(item.payload)['product.brand']).toBe('작업자브랜드');
  });

  it('이미지 키 seed — 안 건드린 행은 변경 0건이고, 키를 맞바꾼 행도 충돌이 아니다', async () => {
    const items = await inRollbackTx(async (tx) => {
      // 상품이 둘이어야 이미지 키가 IMG-1..4 로 갈린다. 하나면 재렌더가 seed 없이도
      // 우연히 IMG-1 을 다시 배정해 회귀가 드러나지 않는다.
      const a = await createPublishedProduct(tx, { name: '상품A', brand: 'ACME', variantCode: 'AY-A' });
      const b = await createPublishedProduct(tx, { name: '상품B', brand: 'ACME', variantCode: 'AY-B' });
      const data = await buildExport(tx, [a.masterId, b.masterId]);

      const second = data.products.find((row) => row.rowKey === 'P-000002')!;
      expect(second.thumbnailImageKey).toBe('IMG-3');
      expect(second.additionalImageKeys).toBe('IMG-4');

      // 작업자: 상품A 는 손대지 않고, 상품B 의 대표/부가 이미지 키만 맞바꾼다.
      let edited = editCell(data, 'P-000002', 'thumbnailImageKey', 'IMG-4');
      edited = editCell(edited, 'P-000002', 'additionalImageKeys', 'IMG-3');
      const buffer = await buildFormWorkbook(edited);

      const sessionId = await seedSession(tx, data.exportId);
      await runLane(tx, sessionId, buffer);
      return readItems(tx, sessionId);
    });

    expect(items).toHaveLength(2);
    const [first, second] = items;

    // 손대지 않은 행: 변경 0건. 그래도 payload 는 **non-null** 이다 — NULL 이면 그 행이
    // 영원히 다시 검증된다.
    expect(first.payload).not.toBeNull();
    expect(fieldsOf(first.payload)).toEqual({});
    expect(first.conflict).toBeNull();

    // 맞바꾼 행: 두 이미지 필드만 변경으로 뜨고 **충돌은 없다**. seed 를 빼면 재렌더가
    // 상품B 에 IMG-1/IMG-2 를 다시 배정해, 아무도 안 건드린 이미지가 남이 바꾼 것처럼
    // 보이고 두 필드가 통째로 충돌로 뜬다.
    expect(Object.keys(fieldsOf(second.payload)).sort()).toEqual([
      'product.additionalImageKeys',
      'product.thumbnailImageKey',
    ]);
    expect(second.conflict).toBeNull();
    expect(second.status).toBe('pending');
  });

  it('열을 통째로 지운 파일은 그 필드를 비우지 않는다', async () => {
    const item = await inRollbackTx(async (tx) => {
      const fx = await createPublishedProduct(tx, { name: '티셔츠', brand: 'ACME', variantCode: 'AY-TEE4' });
      const data = await buildExport(tx, [fx.masterId]);

      // 작업자가 상품명은 고치고 '브랜드' 열은 통째로 지웠다.
      const full = await buildFormWorkbook(editCell(data, 'P-000001', 'name', '티셔츠 v2'));
      const buffer = await dropColumn(full, PRODUCT_SHEET, BRAND_LABEL);

      const sessionId = await seedSession(tx, data.exportId);
      await runLane(tx, sessionId, buffer);
      const [row] = await readItems(tx, sessionId);
      return row;
    });

    const fields = fieldsOf(item.payload);
    // 열 부재를 "비움"으로 읽으면 파일 하나가 전 상품의 브랜드를 날린다.
    expect(Object.keys(fields)).toEqual(['product.name']);
    expect('product.brand' in fields).toBe(false);
    // 근거가 `present` 에 실제로 실려 있는지도 본다 — jsonb 왕복 후에도 남아야 한다.
    const input = item.input as { present: { products: string[] } };
    expect(input.present.products).toContain('name');
    expect(input.present.products).not.toContain('brand');
  });

  // ─── 하위 시트에서 **행**만 지운 파일 ───
  //
  // 열을 지우는 것(바로 위 테스트)과는 다른 축이고, 실제로는 이쪽이 훨씬 흔하다: 1,000행
  // 양식에서 자기가 손댈 30건만 남기려고 하위 시트를 필터·삭제한다. 그러면 시트와 헤더는
  // 그대로고 `present` 에도 열이 전부 들어 있으므로, "열 삭제 ≠ 비움" 규칙이 이 경우를
  // 막아주지 못한다. 카테고리를 전량 해제하는 payload 가 만들어지면 4단계가 그것을 적용해
  // **상품의 노출 위치가 사라진다** — 발행 후에나 발견되는 부류다.
  //
  // 순수 함수 테스트(bulk-session.fields.spec.ts)가 같은 사실을 더 좁게 덮지만, 이 경로는
  // 파서의 `present` 계산 → 접합 → 검증까지를 다 지나야 성립하므로 실 DB 로도 못 박는다.
  it('하위 시트에서 행만 지운 파일은 카테고리·구매제약을 해제하지 않는다', async () => {
    const item = await inRollbackTx(async (tx) => {
      const fx = await createPublishedProduct(tx, {
        name: '티셔츠',
        brand: 'ACME',
        variantCode: 'AY-TEE5',
        lifetimeQuantityLimit: 3,
      });
      const data = await buildExport(tx, [fx.masterId]);
      // 프리필이 실제로 두 하위 시트를 채웠는지 먼저 확인한다 — 픽스처가 비어 있으면 이
      // 테스트는 아무것도 증명하지 못한 채 초록이 된다.
      expect(data.categories).toHaveLength(1);
      expect(data.constraints).toHaveLength(1);

      // 작업자: 상품명을 고치고, 하위 시트에서는 **행을 지웠다**(시트·헤더는 그대로).
      const edited = editCell(data, 'P-000001', 'name', '티셔츠 v2');
      const buffer = await buildFormWorkbook({ ...edited, categories: [], constraints: [] });

      const sessionId = await seedSession(tx, data.exportId);
      await runLane(tx, sessionId, buffer);
      const [row] = await readItems(tx, sessionId);
      return row;
    });

    // 열은 그대로 있었다는 것이 이 케이스의 전제다 — 아니면 위 '열 삭제' 테스트와 같아진다.
    const input = item.input as { present: { categories: string[]; constraints: string[] } };
    expect(input.present.categories).toContain('categoryPath');
    expect(input.present.constraints).toContain('lifetimeQuantityLimit');

    // 변경분은 상품명 하나뿐이다.
    expect(Object.keys(fieldsOf(item.payload))).toEqual(['product.name']);

    // 검증도 통과해야 한다. 예전에는 `category.set: ''` 가 변경분에 들어가면서
    // `resolveCategories` 의 0행 조기 return 이 "대표 카테고리는 정확히 1개" 게이트까지
    // 건너뛰어, 전량 해제가 **유효한(pending)** payload 로 굳었다.
    expect(item.status).toBe('pending');
    expect(item.errorMessage).toBeNull();

    // 4단계가 읽는 자리에도 해제 신호가 남아 있으면 안 된다.
    const payload = item.payload as { categoryIds?: string[]; primaryCategoryId?: string };
    expect(payload.categoryIds).toBeUndefined();
    expect(payload.primaryCategoryId).toBeUndefined();
  });

  it('0행 양식(productCount 0)도 정상이다 — 전 행이 create 로 진행된다', async () => {
    const { items, session } = await inRollbackTx(async (tx) => {
      // draft 만 있는 상품을 고르면 renderMaster 가 조용히 건너뛰어 items 0행짜리 양식이
      // 정상 completed 된다(form-export.snapshot.reader.ts:125). 그 양식으로 신규 등록을
      // 하는 것은 사고가 아니라 설계된 사용법이다.
      const masterId = randomUUID();
      await tx.insert(productMasters).values({ id: masterId });
      await tx
        .insert(productMasterVersions)
        .values({ id: randomUUID(), masterId, version: 1, status: 'draft', name: '아직 발행 안 한 상품' });

      const data = await buildExport(tx, [masterId]);
      expect(data.products).toHaveLength(0);

      const newRow: PrefillRow = { rowKey: 'N-1', name: '손으로 적은 신규 상품', basePrice: '15000' };
      const buffer = await buildFormWorkbook({ ...data, products: [newRow] });

      const sessionId = await seedSession(tx, data.exportId);
      await runLane(tx, sessionId, buffer);
      return { items: await readItems(tx, sessionId), session: await readSession(tx, sessionId) };
    });

    // 세션이 "양식을 더 이상 찾을 수 없다"로 실패하면 안 된다 — 멀쩡한 양식이다.
    expect(session.phase).toBe('review');
    expect(session.phaseError).toBeNull();
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('create');
    expect(items[0].masterId).toBeNull();
    expect(items[0].baseSnapshot).toBeNull();
    expect(items[0].status).toBe('pending');
    expect(fieldsOf(items[0].payload)['product.name']).toBe('손으로 적은 신규 상품');
  });
});
