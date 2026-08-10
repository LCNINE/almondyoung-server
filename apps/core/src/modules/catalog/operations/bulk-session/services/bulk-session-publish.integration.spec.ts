// jest moduleNameMapper 는 `@packages/event-contracts/(.*)$` 서브패스만 매핑한다 — bare
// `@packages/event-contracts`(catalog.module.ts / product-masters.service.ts 등이 이렇게
// 임포트한다)는 안 걸려 jest 환경에서 module-not-found 로 죽는다. 레포 상시 debt 이고
// bulk-session.module.spec.ts / bulk-session-draft.integration.spec.ts 가 같은 우회를 쓴다.
//
// **이 스위트도 스텁이 아니라 진짜 모듈을 되돌린다.** `publishVersion`/`cancel`/`queuePublish`
// /`purgeDrafts` 를 진짜로 부르고, 그 경로가 `INVENTORY_STREAM.topic.topic` 까지 실제로
// 읽는다(product-sellable-quantity.service.ts) — 손으로 적은 스텁이면 그 자리에서
// `undefined.topic` 으로 죽는다.
jest.mock(
  '@packages/event-contracts',
  () => jest.requireActual<typeof import('@packages/event-contracts')>('@packages/event-contracts/index'),
  { virtual: true },
);

import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { eq, inArray, sql } from 'drizzle-orm';
import type { TestingModule } from '@nestjs/testing';
import type { DbService } from '@app/db';
import { outbox_events } from '@app/events';
import {
  type PimSchema,
  pricingRules,
  productBulkItems,
  productBulkSessions,
  productMasterPricingRules,
  productMasterVariants,
  productMasterVersions,
  productMasters,
  productVariants,
} from '../../../schema/catalog.schema';
// 정리 전용 임포트. `publishVersion` 이 남기는 두 행 모두 catalog 쪽 CASCADE 가 닿지 않는다
// (투영은 product_variants 에 FK 가 없고, 아웃박스는 애초에 FK 가 없다) — 4단계 스위트와
// 같은 이유·같은 형태다. 아웃박스는 공용 `event.outbox_events` 다 — 6-C-2 가 적재를 그리로
// 옮겼고 6-C-4 가 옛 `public.outbox_events` 를 지웠다.
import {
  productSellableQuantityProjections,
  salesVariantPolicies,
} from '../../../../inventory/schema/inventory.schema';
import type { DbTransaction } from '../../../catalog.types';
import type { BulkBaseSnapshot, BulkItemInput, BulkItemPayload, FlatFields, PrefillRow } from './bulk-session.types';

/**
 * 5단계(일괄 발행·재시도·제외·정리)를 **실 Postgres + 실 Nest DI** 로 구동한다.
 *
 * 앞선 열한 개 태스크는 전부 페이크 객체 위에서만 검증됐다. 여기서 못 박는 것은 여덟 가지다
 * (브리프 6 + 이 태스크가 더한 2):
 *
 *   1. 발행 시점에 남이 먼저 발행했으면 그 행만 실패한다 (`publishOne` 관문 ③)
 *   2. 취소가 커밋된 뒤 시작된 행은 발행되지 않는다 (`publishOne` 관문 ① — 진짜 두 커넥션 경합)
 *   3. 발행에 성공한 버전은 bulk_session_id 가 비워져 롤백 발행이 가능하다 (관문 ④)
 *   4. 제외한 행의 draft 는 잠금이 풀려 개별 발행이 열린다 (`excludeItem`)
 *   5. 이미 발행된 행을 다시 큐에 넣어도 두 번 발행되지 않는다 (`queuePublish` + `publishOne` 두 층의 멱등)
 *   6. 취소 세션 정리는 신규는 master 까지, 수정은 draft 만, 발행된 행은 미접촉이다 (`purgeDrafts`)
 *   7. 품목코드 중복 사전검사의 3테이블 조인이 실제로 돈다 (`BulkVariantCodeChecker`, Task 11 이
 *      실 DB 로 한 번도 실행해 보지 못한 경로)
 *   8. `purgeDrafts` 가 다른 세션의 행을 건드리지 않는다 (`eq(sessionId)` 술어)
 *
 * **모듈 부트스트랩**: `Test.createTestingModule` 로 `CatalogModule` 을 통째로 띄운다 — 선례는
 * `bulk-session.module.spec.ts`/`bulk-session-draft.integration.spec.ts` 이고 거기 있는
 * 우회 둘(가상 모듈, `KAFKA_BOOTSTRAP_TOPICS=false`)을 그대로 쓴다. `.compile()` 은
 * `onModuleInit` 을 부르지 않으므로(@nestjs/testing 의 문서화된 동작) `@Cron` 워커·이미지
 * 정리 스윕이 뜨지 않는다 — 이 스위트가 만든 데이터를 크론이 뒤에서 건드릴 위험이
 * 구조적으로 없다.
 *
 * **실행**: 전용 scratch DB(`bulk_stage5_scratch`)에 core 마이그레이션을 올린 뒤 그 DB 를
 * 가리키는 DATABASE_URL 로 돌린다. `dev_core` 를 쓰지 않는다.
 *
 * **격리**: 롤백도 임시 스키마도 쓰지 않는다 — 4단계 스위트와 같은 이유(케이스 2의 두 커넥션
 * 경합은 커밋된 상태 전이를 요구하고, 롤백 트랜잭션 안에서는 그 경합 자체가 성립하지 않는다).
 * 대신 전용 scratch DB 의 public 에 커밋하고 `afterAll` 이 이 스위트가 만든
 * master·세션·variant·가격룰을 지운다.
 *
 * **픽스처는 반드시 서비스로 만든다**(`createMaster` → `updateVersion` → `replaceVersionRules`
 * → `publishVersion`). 손으로 INSERT 하면 실제 쓰기 경로가 만드는 행 모양과 갈라져 거짓
 * 초록이 된다. 세션·아이템 행은 직접 INSERT 한다: 그건 앞 단계(업로드·검증·drafting)의
 * 산물이고 이 태스크의 검증 대상이 아니다 — `jobManager.runDraftSlice` 로 실제 draft 생성
 * 경로를 태워 만든다.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_BULK_SESSION_DB === '1' && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the bulk session publish integration suite.');
}

/**
 * **대상 DB 가드.** 이 스위트는 롤백이 아니라 **커밋**한다(위 헤더의 '격리' 참조) — 그래서
 * DB 를 잘못 잡으면 개발용 DB 에 진짜 상품 master·version·variant 가 생겼다 지워지고,
 * 도중에 크래시하면 **남는다**.
 *
 * 이름 패턴을 `bulk_stage<N>_scratch` 로 넓게 잡는 이유: `test:bulk-session:integration`
 * 이 2·3·4·5단계 스위트를 **한 DATABASE_URL 로** 함께 돌린다(각 스위트 헤더가 저마다
 * 다른 stage 이름을 적어 뒀다). 5단계 전용으로 좁히면 다른 네 스위트의 정상 실행을 이
 * 가드가 막는다.
 */
if (DATABASE_URL && !/bulk_stage\d+_scratch/.test(DATABASE_URL)) {
  throw new Error(
    '이 스위트는 커밋하므로 전용 scratch DB(bulk_stage<N>_scratch)에서만 돌린다. ' +
      // 자격증명이 오류 메시지·CI 로그로 새지 않게 마스킹한다.
      `현재 DATABASE_URL 이 가리키는 곳: ${DATABASE_URL.replace(/\/\/[^@]*@/, '//***@')}`,
  );
}

const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** 픽스처 상품 하나. 발행까지 끝난 상태다. */
interface ProductFixture {
  masterId: string;
  /** 발행된 active 버전. 아이템의 `base_version_id` 가 이 값이다. */
  versionId: string;
  /** active 버전에 매달린 유일한 variant(옵션 없는 상품 — F3 계약상 조합키는 빈 문자열). */
  variantId: string;
}

describeIfDb('일괄 세션 발행·제외·정리 레인 (실 Postgres + 실 Nest DI)', () => {
  jest.setTimeout(180_000);

  let moduleRef: TestingModule;
  let db: DbService<PimSchema>;
  let masters: import('../../../core/products/services/product-masters.service').ProductMastersService;
  let versions: import('../../../core/products/services/product-versions.service').ProductVersionsService;
  let variants: import('../../../core/products/services/product-variants.service').ProductVariantsService;
  let pricing: import('../../../core/pricing/pricing.service').PricingService;
  let snapshotReader: import('./form-export.snapshot.reader').FormExportSnapshotReader;
  let jobManager: import('./bulk-session-job.manager').BulkSessionJobManager;
  let sessionManager: import('./bulk-session.manager').BulkSessionManager;
  let checker: import('./bulk-variant-code.checker').BulkVariantCodeChecker;
  let createImageKeyAllocator: typeof import('./form-export.types').createImageKeyAllocator;

  /** 이 스위트가 만든 것들. `afterAll` 이 이 목록만 지운다 — scratch DB 를 통째로 비우지 않는다. */
  const createdMasterIds = new Set<string>();
  const createdSessionIds = new Set<string>();

  beforeAll(async () => {
    // CatalogModule 이 EventsModule.forApp({enableOutbox:true}) 를 정적으로 물고 있어 없으면
    // kafkajs 설정 생성 자체가 던진다 — 실제 브로커에 붙지는 않으므로 값은 아무 host:port 나
    // 상관없다(bulk-session.module.spec.ts 와 같은 이유·같은 값).
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? 'bulk-session-publish-spec-test-secret';
    process.env.KAFKA_BROKERS = process.env.KAFKA_BROKERS ?? 'localhost:9092';
    process.env.KAFKA_BOOTSTRAP_TOPICS = process.env.KAFKA_BOOTSTRAP_TOPICS ?? 'false';
    // FulfillmentWorkflowGate(ProductsModule → ProductSellableQuantityModule 경유)가 부팅 시
    // 이 값을 강제한다.
    process.env.FULFILLMENT_WORKFLOW_MODE = process.env.FULFILLMENT_WORKFLOW_MODE ?? 'maintenance';

    // 무거운 CatalogModule 을 정적 import 하면 DATABASE_URL 없이 스킵할 때도 모듈 로드
    // 시점에 곧장 끌려들어온다(그리고 위 env 세팅보다 먼저 평가된다 — import 는 호이스팅된다).
    // 동적 import 로만 불러오는 것이 모듈 스펙이 세운 선례다.
    const { Test } = await import('@nestjs/testing');
    const { ConfigModule } = await import('@nestjs/config');
    const { DbModule, DbService } = await import('@app/db');
    const { AuthorizationModule } = await import('@app/authorization');
    const { mergedSchema } = await import('../../../../../platform/database/merged-schema');
    const { ALL_SCOPES, ALL_ROLE_MAPPINGS } = await import('../../../../../platform/auth/merged-scopes');
    const { CatalogModule } = await import('../../../catalog.module');
    const { ProductMastersService } = await import('../../../core/products/services/product-masters.service');
    const { ProductVersionsService } = await import('../../../core/products/services/product-versions.service');
    const { ProductVariantsService } = await import('../../../core/products/services/product-variants.service');
    const { PricingService } = await import('../../../core/pricing/pricing.service');
    const { FormExportSnapshotReader } = await import('./form-export.snapshot.reader');
    const { BulkSessionJobManager } = await import('./bulk-session-job.manager');
    const { BulkSessionManager } = await import('./bulk-session.manager');
    const { BulkVariantCodeChecker } = await import('./bulk-variant-code.checker');
    ({ createImageKeyAllocator } = await import('./form-export.types'));

    moduleRef = await Test.createTestingModule({
      // AppModule(apps/core/src/app.module.ts) 과 같은 순서로 배선한다.
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

    // 전부 `{ strict: false }` 로 꺼낸다 — 대부분 모듈 export 목록에 없는 내부 provider 다.
    db = moduleRef.get<DbService<PimSchema>>(DbService, { strict: false });
    masters = moduleRef.get(ProductMastersService, { strict: false });
    versions = moduleRef.get(ProductVersionsService, { strict: false });
    variants = moduleRef.get(ProductVariantsService, { strict: false });
    pricing = moduleRef.get(PricingService, { strict: false });
    snapshotReader = moduleRef.get(FormExportSnapshotReader, { strict: false });
    jobManager = moduleRef.get(BulkSessionJobManager, { strict: false });
    sessionManager = moduleRef.get(BulkSessionManager, { strict: false });
    checker = moduleRef.get(BulkVariantCodeChecker, { strict: false });
  });

  afterAll(async () => {
    try {
      if (db) {
        // 세션을 지우기 **전에** 아이템이 가리키는 master 를 걷는다 — 신규 행이 만든 master 는
        // 이 경로로만 알 수 있고, 세션을 먼저 지우면 items 가 CASCADE 로 함께 사라져 고아가 된다.
        const sessionIds = [...createdSessionIds];
        if (sessionIds.length > 0) {
          const rows = await db.run((trx) =>
            trx
              .select({ masterId: productBulkItems.masterId })
              .from(productBulkItems)
              .where(inArray(productBulkItems.sessionId, sessionIds)),
          );
          for (const row of rows) if (row.masterId) createdMasterIds.add(row.masterId);
        }

        const masterIds = [...createdMasterIds];
        // product_variants / pricing_rules 는 master 를 지워도 CASCADE 가 닿지 않는다(정션만
        // 지워진다) — 정션이 살아 있는 동안 id 를 걷어 둔다.
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
          if (sessionIds.length > 0) {
            await trx.delete(productBulkSessions).where(inArray(productBulkSessions.id, sessionIds));
          }
          if (masterIds.length > 0) {
            await trx.delete(productMasters).where(inArray(productMasters.id, masterIds));
          }
          if (variantIds.length > 0) {
            await trx
              .delete(productSellableQuantityProjections)
              .where(inArray(productSellableQuantityProjections.variantId, variantIds));
            // sales_variant_policies 도 product_variants 에 FK 가 없어 catalog CASCADE 가
            // 닿지 않는다 — 위 두 테이블과 같은 이유(파일 상단 정리 전용 임포트 주석 참조).
            await trx.delete(salesVariantPolicies).where(inArray(salesVariantPolicies.variantId, variantIds));
            await trx.delete(productVariants).where(inArray(productVariants.id, variantIds));
          }
          if (pricingRuleIds.length > 0) {
            await trx.delete(pricingRules).where(inArray(pricingRules.id, pricingRuleIds));
          }
          // 아웃박스 행. `publishVersion` 이 master 당 `ProductMasterActiveVersionChanged` 를,
          // `recalculateAndPublishForVariant` 가 variant 당 `ProductSellableQuantityChanged` 를
          // 쌓는다 — FK 가 없어 어떤 CASCADE 도 닿지 않으므로 실행마다(롤백 발행 포함) 단조
          // 증가한다. `aggregate_id` 로 **이 스위트가 만든 것만** 지운다(테이블을 비우지 않는다).
          const aggregateIds = [...new Set([...masterIds, ...variantIds])];
          if (aggregateIds.length > 0) {
            await trx.delete(outbox_events).where(inArray(outbox_events.aggregateId, aggregateIds));
          }
        });
      }
    } finally {
      await moduleRef?.close();
    }
  });

  // ─────────────────────────── 픽스처 헬퍼 ───────────────────────────

  /**
   * 발행까지 끝난 상품 하나를 **서비스 경로로만** 만든다. 4단계 스위트의 같은 이름 헬퍼와
   * 동일하다 — 손으로 INSERT 하지 않는 이유는 파일 헤더에 있다.
   */
  async function seedActiveProduct(opts: {
    name: string;
    brand: string;
    basePrice: number;
    variantCode?: string;
  }): Promise<ProductFixture> {
    const owner = randomUUID();
    const draft = await masters.createMaster(owner);
    createdMasterIds.add(draft.masterId);

    await masters.updateVersion(draft.id, {
      name: opts.name,
      brand: opts.brand,
      // productCode 는 active 끼리 유일해야 한다(publishVersion 의 게이트) — 매번 새로 만든다.
      productCode: `SKU-${randomUUID().slice(0, 8)}`,
      seller: '본사',
      productType: 'regular_sale',
      fulfillmentKind: 'physical',
    });

    const [mapping] = await db.run((trx) =>
      trx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(eq(productMasterVariants.versionId, draft.id)),
    );
    if (!mapping) throw new Error('createMaster 가 기본 variant 매핑을 만들지 않았다 — 픽스처 전제가 깨졌다');

    if (opts.variantCode !== undefined) {
      await variants.bulkUpdateVariantsInDraft(draft.masterId, draft.id, [
        { id: mapping.variantId, variantCode: opts.variantCode },
      ]);
    }

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
      membershipPriceRules: [],
      tieredPriceRules: [],
    });

    await versions.publishVersion(draft.id);

    return { masterId: draft.masterId, versionId: draft.id, variantId: mapping.variantId };
  }

  /** 아이템의 `base_snapshot` — **현재 active 를 `renderMaster` 로 그린 것**이다(4단계와 동일). */
  async function renderSnapshot(masterId: string): Promise<BulkBaseSnapshot> {
    const bundle = await db.run((trx: DbTransaction) =>
      snapshotReader.renderMaster(trx, masterId, createImageKeyAllocator(), new Map()),
    );
    if (!bundle) throw new Error(`active 버전이 없어 스냅샷을 그릴 수 없다: ${masterId}`);
    return { ...bundle, pricingEditable: true };
  }

  /**
   * 아이템의 `input`(notNull). 이 스위트의 행은 옵션이 없는 상품뿐이라 항상 빈 옵션 시트다.
   *
   * (Task 8) 조합 시트 행은 비어 있지 않을 수 있다 — 발행의 정책 추출이 차분뿐 아니라
   * **시트 원본**도 읽기 때문이다(`판매상태재정의`/`출시예정일` 은 한 단위라 안 바뀐 짝 칸의
   * 값이 시트에만 있다).
   */
  function inputWith(options: PrefillRow[], variants: PrefillRow[] = []): BulkItemInput {
    return {
      bundle: { product: {}, options, variants, categories: [], constraint: null },
      present: { products: [], options: [], variants: [], categories: [], constraints: [] },
      errors: [],
    };
  }

  interface SeedItem {
    rowNumber: number;
    kind: 'create' | 'update';
    masterId?: string;
    baseVersionId?: string;
    baseSnapshot?: BulkBaseSnapshot;
    fields: FlatFields;
    /** (Task 8) 조합 시트 원본 행. 정책 칸을 실은 케이스만 채운다. */
    variantRows?: PrefillRow[];
  }

  /**
   * `phase='drafting'` 세션 하나 + 아이템들. lease 토큰을 행에 심는다 — 4단계 스위트와
   * 같은 이유(`runDraftSlice` 의 첫 렌 renewLease CAS 가 이 값에 걸린다).
   */
  async function seedSession(
    items: SeedItem[],
  ): Promise<{ sessionId: string; leaseToken: string; uploaderId: string }> {
    const sessionId = randomUUID();
    const leaseToken = randomUUID();
    const uploaderId = randomUUID();

    await db.run(async (trx) => {
      await trx.insert(productBulkSessions).values({
        id: sessionId,
        name: '발행 레인 시나리오',
        exportId: null,
        uploadedBy: uploaderId,
        fileName: '양식.xlsx',
        sourceFileId: randomUUID(),
        phase: 'drafting',
        leaseToken,
        leaseUntil: new Date(Date.now() + 60_000),
        totalRows: items.length,
      });

      await trx.insert(productBulkItems).values(
        items.map((item) => ({
          sessionId,
          rowNumber: item.rowNumber,
          rowKey: `P-${String(item.rowNumber).padStart(6, '0')}`,
          kind: item.kind,
          masterId: item.masterId ?? null,
          baseVersionId: item.baseVersionId ?? null,
          baseSnapshot: item.baseSnapshot ?? null,
          input: inputWith([], item.variantRows ?? []),
          payload: { fields: item.fields } satisfies BulkItemPayload,
          // 'pending' 이어야 슬라이스가 집는다.
          status: 'pending' as const,
        })),
      );
    });

    createdSessionIds.add(sessionId);
    return { sessionId, leaseToken, uploaderId };
  }

  async function readItems(sessionId: string) {
    return db.run((trx) =>
      trx
        .select()
        .from(productBulkItems)
        .where(eq(productBulkItems.sessionId, sessionId))
        .orderBy(productBulkItems.rowNumber),
    );
  }

  async function readItemById(itemId: string) {
    const [row] = await db.run((trx) => trx.select().from(productBulkItems).where(eq(productBulkItems.id, itemId)));
    if (!row) throw new Error(`일괄 세션 행을 찾지 못했다: ${itemId}`);
    return row;
  }

  async function readVersion(versionId: string) {
    const [row] = await db.run((trx) =>
      trx.select().from(productMasterVersions).where(eq(productMasterVersions.id, versionId)),
    );
    return row;
  }

  /**
   * (Task 8) 이 master 에 달린 버전 수. "정책만 바뀐 행은 **버전을 만들지 않는다**"는
   * 실 DB 로만 볼 수 있는 사실이고, 이 수가 그 유일한 증거다.
   */
  async function countVersions(masterId: string): Promise<number> {
    const rows = await db.run((trx) =>
      trx
        .select({ id: productMasterVersions.id })
        .from(productMasterVersions)
        .where(eq(productMasterVersions.masterId, masterId)),
    );
    return rows.length;
  }

  async function readMaster(masterId: string) {
    const [row] = await db.run((trx) => trx.select().from(productMasters).where(eq(productMasters.id, masterId)));
    if (!row) throw new Error(`master 를 찾지 못했다: ${masterId}`);
    return row;
  }

  async function readSessionRow(sessionId: string) {
    const [row] = await db.run((trx) =>
      trx.select().from(productBulkSessions).where(eq(productBulkSessions.id, sessionId)),
    );
    if (!row) throw new Error(`세션을 찾지 못했다: ${sessionId}`);
    return row;
  }

  /**
   * 발행 워커가 lease 를 쥔 상태를 흉내낸다 — `claim()` 을 쓰지 않는 이유: `claim()` 은
   * "가장 오래된 claimable 세션"을 전역으로 집으므로, 이 스위트의 여러 케이스가 만드는
   * 세션들 사이에서 서로의 lease 를 가로챌 위험이 있다(케이스마다 세션이 남기는 종단
   * phase 가 제각각이라 완전히 배제하기 어렵다). 대신 이 세션 하나만 지정해 lease 를 심는다.
   */
  async function grantLease(sessionId: string, leaseToken: string, ms = 60_000): Promise<void> {
    await db.run((trx) =>
      trx
        .update(productBulkSessions)
        .set({ leaseToken, leaseUntil: new Date(Date.now() + ms) })
        .where(eq(productBulkSessions.id, sessionId)),
    );
  }

  /**
   * `runDraftSlice` 한 번은 남은 대상 행이 있을 때만 그 행들을 draft 로 만들고 lease 를
   * 놓을 뿐이다 — phase 를 'drafted' 로 미는 `finishDrafting` 은 그 **다음** 호출이 대상
   * 행 0개를 보는 순간에만 탄다(`runPublishSlice`/`finishPublishing` 과 같은 두 단계
   * 구조). `queuePublish`/`excludeItem` 은 phase 가 'drafted'(또는 'published')이어야
   * 하므로, drafting 을 마무리하는 모든 케이스가 이 두 번째 호출을 거쳐야 한다.
   */
  async function finishDraftingPhase(sessionId: string): Promise<void> {
    const finishToken = randomUUID();
    await grantLease(sessionId, finishToken);
    await jobManager.runDraftSlice({ sessionId, leaseToken: finishToken, phase: 'drafting' });
    const session = await readSessionRow(sessionId);
    expect(session.phase).toBe('drafted');
  }

  /** draft 만 만든 행 하나(수정 kind). 세션은 draft 완료 후 자연히 `drafted` 로 넘어간다. */
  async function draftRow(
    fx: ProductFixture,
    fields: FlatFields,
  ): Promise<{ sessionId: string; uploaderId: string; itemId: string; draftVersionId: string; masterId: string }> {
    const { sessionId, leaseToken, uploaderId } = await seedSession([
      {
        rowNumber: 1,
        kind: 'update',
        masterId: fx.masterId,
        baseVersionId: fx.versionId,
        baseSnapshot: await renderSnapshot(fx.masterId),
        fields,
      },
    ]);

    await jobManager.runDraftSlice({ sessionId, leaseToken, phase: 'drafting' });

    const [item] = await readItems(sessionId);
    expect(item.status).toBe('drafted');
    expect(item.draftVersionId).toBeTruthy();

    await finishDraftingPhase(sessionId);

    return {
      sessionId,
      uploaderId,
      itemId: item.id,
      draftVersionId: item.draftVersionId as string,
      masterId: fx.masterId,
    };
  }

  /** draft 후 발행 대기(`publishStatus='pending'`)까지 큐잉하고, 워커 lease 를 심어 둔다. */
  async function queueRow(
    fx: ProductFixture,
    fields: FlatFields,
  ): Promise<{
    sessionId: string;
    uploaderId: string;
    itemId: string;
    draftVersionId: string;
    masterId: string;
    leaseToken: string;
  }> {
    const drafted = await draftRow(fx, fields);
    await sessionManager.queuePublish(drafted.sessionId, drafted.uploaderId);
    const leaseToken = randomUUID();
    await grantLease(drafted.sessionId, leaseToken);
    return { ...drafted, leaseToken };
  }

  /**
   * `runPublishSlice` 도 drafting 과 같은 두 단계 구조다 — 대상 행이 남아 있는 호출은 그
   * 행들을 발행하고 lease 를 놓을 뿐이고, phase 를 'published' 로 미는 `finishPublishing`
   * 은 그 다음 호출이 대상 0개를 보는 순간에만 탄다. `queuePublish` 재호출(멱등 케이스)이
   * phase 를 'drafted' 또는 'published' 로 요구하므로 이 두 번째 호출로 확정한다.
   */
  async function finishPublishingPhase(sessionId: string): Promise<void> {
    const finishToken = randomUUID();
    await grantLease(sessionId, finishToken);
    await jobManager.runPublishSlice({ sessionId, leaseToken: finishToken, phase: 'publishing' });
    const session = await readSessionRow(sessionId);
    expect(session.phase).toBe('published');
  }

  /** 큐잉 + 실제 발행 슬라이스 실행까지 끝낸 행 하나. */
  async function publishRow(
    fx: ProductFixture,
    fields: FlatFields,
  ): Promise<{
    sessionId: string;
    uploaderId: string;
    itemId: string;
    draftVersionId: string;
    masterId: string;
    leaseToken: string;
  }> {
    const queued = await queueRow(fx, fields);
    await jobManager.runPublishSlice({
      sessionId: queued.sessionId,
      leaseToken: queued.leaseToken,
      phase: 'publishing',
    });
    await finishPublishingPhase(queued.sessionId);
    const item = await readItemById(queued.itemId);
    expect(item.publishStatus).toBe('published');
    return queued;
  }

  /**
   * 케이스 2 전용. Postgres 의 대기중(`NOT granted`) 잠금 요청 수를 센다 — 이 스위트가 만든
   * `raceConn` 의 `SELECT … FOR UPDATE` 뒤에 다른 커넥션이 줄섰는지 관측하는 유일한 방법이다
   * (postgres.js 자체는 대기 상태를 노출하지 않는다). 전용 scratch DB 라 이 시점엔 이
   * 스위트 말고 다른 쿼리가 없다고 가정한다 — 넓게 카운트해도 안전하다.
   *
   * `expected` 에 못 미친 채 타임아웃해도 **던지지 않는다**: 역검증(관문 ① 의 `FOR UPDATE`
   * 제거)에서는 발행 워커의 SELECT 가 애초에 잠금을 기다리지 않고 곧장 통과해버려 대기자가
   * 2 에 닿지 못한다 — 그건 역검증이 노리는 정확한 차이이지 이 헬퍼의 실패가 아니다.
   */
  async function waitForBlockedBackends(expected: number, timeoutMs = 2000): Promise<void> {
    const start = Date.now();
    for (;;) {
      const rows = await db.run((trx) =>
        trx.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM pg_locks WHERE NOT granted`),
      );
      const [row] = rows as unknown as Array<{ count: number }>;
      if ((row?.count ?? 0) >= expected) return;
      if (Date.now() - start >= timeoutMs) return;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }

  // ─────────────────────────── 케이스 ───────────────────────────

  it('발행 시점에 남이 먼저 발행했으면 그 행만 실패한다', async () => {
    const fxRace = await seedActiveProduct({ name: '경합 상품', brand: 'ACME', basePrice: 10000 });
    const fxCalm = await seedActiveProduct({ name: '평온한 상품', brand: 'ACME', basePrice: 20000 });

    const {
      sessionId,
      leaseToken: draftLease,
      uploaderId,
    } = await seedSession([
      {
        rowNumber: 1,
        kind: 'update',
        masterId: fxRace.masterId,
        baseVersionId: fxRace.versionId,
        baseSnapshot: await renderSnapshot(fxRace.masterId),
        fields: { 'product.name': '경합 상품 v2' },
      },
      {
        rowNumber: 2,
        kind: 'update',
        masterId: fxCalm.masterId,
        baseVersionId: fxCalm.versionId,
        baseSnapshot: await renderSnapshot(fxCalm.masterId),
        fields: { 'product.name': '평온한 상품 v2' },
      },
    ]);

    await jobManager.runDraftSlice({ sessionId, leaseToken: draftLease, phase: 'drafting' });
    const drafted = await readItems(sessionId);
    expect(drafted.map((i) => i.status)).toEqual(['drafted', 'drafted']);
    const raceItemId = drafted[0].id;
    const raceDraftVersionId = drafted[0].draftVersionId as string;
    const calmItemId = drafted[1].id;
    await finishDraftingPhase(sessionId);

    // 세션과 무관한 경로로 남이 경합 상품을 먼저 발행한다 — parentVersionId 가 어긋난다.
    const otherDraft = await versions.createDraftVersion(fxRace.versionId, randomUUID(), true);
    await masters.updateVersion(otherDraft.id, { brand: 'BETA' });
    await versions.publishVersion(otherDraft.id);

    await sessionManager.queuePublish(sessionId, uploaderId);
    const publishLease = randomUUID();
    await grantLease(sessionId, publishLease);
    await jobManager.runPublishSlice({ sessionId, leaseToken: publishLease, phase: 'publishing' });

    const raceItem = await readItemById(raceItemId);
    expect(raceItem.publishStatus).toBe('failed');
    expect(raceItem.publishError).toContain('기준이 변경');
    // 롤백돼 draft 는 여전히 세션 잠금이 걸린 draft 상태다 — 남의 발행이 훔쳐가지 않았다.
    const raceDraft = await readVersion(raceDraftVersionId);
    expect(raceDraft.status).toBe('draft');
    expect(raceDraft.bulkSessionId).toBe(sessionId);

    const calmItem = await readItemById(calmItemId);
    expect(calmItem.publishStatus).toBe('published');
  });

  /**
   * **취소 레이스의 마지막 방어선**(`publishOne` 관문 ①). 진짜 두 커넥션 경합이 필요한
   * 이유: 관문 ①(`SELECT … FOR UPDATE`)이 세션 행을 잠그는 동안 취소의 UPDATE 가 같은
   * 잠금 뒤에 줄서야만 "취소가 커밋된 뒤에야 관문 ① 이 그 상태를 본다"는 순서를 강제할 수
   * 있다 — 하나의 물리 커넥션(max:1)이면 postgres.js 가 두 호출을 알아서 직렬화해 이 창이
   * 관측되지 않는다(부록 B.4, `bulk-session-lease.integration.spec.ts` 선례).
   *
   * 그래서 세 번째 커넥션(`raceConn`)을 **오직 교통정리 용도**로 쓴다: 세션 행을 먼저 잠가
   * 붙들고, 취소(`sessionManager`, Nest DI 풀에서 커넥션 하나를 빌린다)와 발행 워커
   * (`jobManager`, 같은 풀에서 **다른** 커넥션을 빌린다 — postgres.js 는 열린 트랜잭션마다
   * 별도 물리 커넥션을 배정한다)가 그 잠금 뒤에 순서대로 줄서게 만든 뒤 풀어준다.
   *
   * `renewLease` 만 목이다: 그 값싼 필터가 이미 커밋된 취소를 먼저 관측해 버리면 관문 ①
   * 자체가 시험대에 오르지 못한다(4단계 C.11 통합 케이스와 같은 이유). DB·트랜잭션·applier
   * 는 전부 진짜다.
   */
  it('취소가 커밋된 뒤 시작된 행은 발행되지 않는다', async () => {
    const fx = await seedActiveProduct({ name: '발행 레이스', brand: 'ACME', basePrice: 10000 });
    const { sessionId, uploaderId, itemId, draftVersionId, leaseToken } = await queueRow(fx, {
      'product.name': '발행 레이스 v2',
    });

    const renewLease = jest.spyOn(jobManager as never as { renewLease: unknown }, 'renewLease' as never);
    (renewLease as unknown as jest.SpyInstance).mockResolvedValue({ owned: true, canceled: false });

    const raceConn = postgres(DATABASE_URL as string, { max: 1, prepare: false });
    let releaseLock: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    try {
      const lockHeld = raceConn.begin(async (raceTx) => {
        // `postgres.js` 의 `TransactionSql` 타입은 `Omit<Sql, 'begin'|...>` 로 정의돼 있어
        // (types/index.d.ts:718) TS 의 `Omit` 이 콜 시그니처를 보존하지 못하는 알려진 한계로
        // 태그드 템플릿 호출이 "not callable" 이 된다 — 런타임엔 완전한 `Sql` 인스턴스라
        // 안전한 캐스팅이다(`fulfillment-invariant.integration.spec.ts` 의 `tx as unknown as
        // DbTx` 와 같은 성질의 우회).
        const raceSql = raceTx as unknown as postgres.Sql;
        await raceSql`SELECT id FROM product_bulk_sessions WHERE id = ${sessionId} FOR UPDATE`;
        await released;
      });
      // raceConn 은 max:1 이라 위 SELECT 는 잠금을 잡은 뒤 콜백 안에서 곧바로 대기에
      // 들어간다 — 아주 짧은 여유만 줘 그 왕복이 끝났음을 보장한다.
      await new Promise((resolve) => setTimeout(resolve, 30));

      const cancelPromise = sessionManager.cancel(sessionId, uploaderId);
      await waitForBlockedBackends(1); // cancel() 의 UPDATE 가 raceConn 뒤에 줄섰다.

      const publishPromise = jobManager.runPublishSlice({ sessionId, leaseToken, phase: 'publishing' });
      // 정상 코드라면 이 SELECT 도 같은 잠금 뒤에 줄선다. 역검증(관문 ① 의 FOR UPDATE 제거)
      // 에서는 줄서지 않고 곧장 낡은(취소 전) 상태를 읽어 발행까지 끝내버리므로, 여기서
      // 두 번째 대기자를 강제로 요구하지 않는다 — 그러면 역검증 실행이 헬퍼 타임아웃으로
      // 죽는다. 대신 로컬 DB 왕복 하나가 끝나기에 넉넉한 여유만 준다.
      await waitForBlockedBackends(2, 500);
      await new Promise((resolve) => setTimeout(resolve, 100));

      releaseLock();
      await lockHeld;
      await cancelPromise;
      await publishPromise;
    } finally {
      (renewLease as unknown as jest.SpyInstance).mockRestore();
      await raceConn.end();
    }

    const item = await readItemById(itemId);
    // 손대지 않은 그대로다 — 'failed' 도 아니다(취소된 세션의 행은 실패가 아니다, 4단계와
    // 같은 규약).
    expect(item.publishStatus).toBe('pending');
    expect(item.publishError).toBeNull();
    const version = await readVersion(draftVersionId);
    expect(version.status).toBe('draft');
    const session = await readSessionRow(sessionId);
    expect(session.phase).toBe('canceled');
  });

  it('발행에 성공한 버전은 bulk_session_id 가 비워져 롤백 발행이 가능하다', async () => {
    const fx = await seedActiveProduct({ name: '롤백 대상', brand: 'ACME', basePrice: 10000 });
    const { draftVersionId } = await publishRow(fx, { 'product.name': '롤백 대상 v2' });

    const published = await readVersion(draftVersionId);
    expect(published.status).toBe('active');
    expect(published.bulkSessionId).toBeNull();

    // 그 버전을 inactive 로 만든다 — 새 draft 를 발행해 자연스럽게 밀어낸다.
    const newer = await versions.createDraftVersion(draftVersionId, randomUUID(), true);
    await masters.updateVersion(newer.id, { name: '최신본' });
    await versions.publishVersion(newer.id);
    const superseded = await readVersion(draftVersionId);
    expect(superseded.status).toBe('inactive');

    // bulk_session_id 가 비어 있어야 이 롤백 발행이 '일괄 등록 세션이 관리하는' 409 없이
    // 통과한다 — 비지 않았다면 여기서 ConflictError 가 던져진다.
    await expect(versions.publishVersion(draftVersionId)).resolves.not.toThrow();
    const rolledBack = await readVersion(draftVersionId);
    expect(rolledBack.status).toBe('active');
  });

  it('제외한 행의 draft 는 잠금이 풀려 개별 발행이 열린다', async () => {
    const fx = await seedActiveProduct({ name: '제외 대상', brand: 'ACME', basePrice: 10000 });
    const { sessionId, uploaderId, itemId, draftVersionId } = await draftRow(fx, {
      'product.name': '제외 대상 v2',
    });

    const locked = await readVersion(draftVersionId);
    expect(locked.bulkSessionId).toBe(sessionId);

    await sessionManager.excludeItem(sessionId, itemId, uploaderId);

    const excludedItem = await readItemById(itemId);
    expect(excludedItem.status).toBe('excluded');
    const unlocked = await readVersion(draftVersionId);
    expect(unlocked.bulkSessionId).toBeNull();

    await expect(versions.publishVersion(draftVersionId)).resolves.not.toThrow();
    const publishedAfterExclude = await readVersion(draftVersionId);
    expect(publishedAfterExclude.status).toBe('active');
  });

  it('이미 발행된 행을 다시 큐에 넣어도 두 번 발행되지 않는다', async () => {
    const fx = await seedActiveProduct({ name: '멱등 발행', brand: 'ACME', basePrice: 10000 });
    const { sessionId, uploaderId, itemId, draftVersionId, masterId } = await publishRow(fx, {
      'product.name': '멱등 발행 v2',
    });

    // 층 1: queuePublish 는 이미 발행된 행을 대상에서 뺀다 — 큐잉할 행이 없다.
    await expect(sessionManager.queuePublish(sessionId, uploaderId)).rejects.toThrow('발행할 행이 없습니다');
    const stillPublished = await readItemById(itemId);
    expect(stillPublished.publishStatus).toBe('published');

    // 층 2: publishOne 자체의 멱등 — 재시도 도중 크래시(발행은 끝났는데 아이템에 도장을
    // 못 찍은 상태)를 흉내낸다. publishStatus 만 되돌린다 — status·draftVersionId 는 그대로다.
    await db.run((trx) =>
      trx
        .update(productBulkItems)
        .set({ publishStatus: 'pending', updatedAt: new Date() })
        .where(eq(productBulkItems.id, itemId)),
    );
    const retryLease = randomUUID();
    await grantLease(sessionId, retryLease);
    await jobManager.runPublishSlice({ sessionId, leaseToken: retryLease, phase: 'publishing' });

    const finalItem = await readItemById(itemId);
    expect(finalItem.publishStatus).toBe('published');

    // 버전이 다시 발행되며 새 버전이 생기지 않았다 — master 에 버전이 정확히 둘(원래 active
    // 였다가 밀려난 것 + 우리 draft)뿐이다.
    const versionsForMaster = await db.run((trx) =>
      trx
        .select({ id: productMasterVersions.id })
        .from(productMasterVersions)
        .where(eq(productMasterVersions.masterId, masterId)),
    );
    expect(versionsForMaster).toHaveLength(2);
    expect(versionsForMaster.map((v) => v.id)).toContain(draftVersionId);
  });

  it('취소 세션 정리는 신규는 master 까지, 수정은 draft 만, 발행된 행은 미접촉이다', async () => {
    const fxPublish = await seedActiveProduct({ name: '정리-발행분', brand: 'ACME', basePrice: 10000 });
    const fxUpdate = await seedActiveProduct({ name: '정리-수정분', brand: 'ACME', basePrice: 20000 });

    const {
      sessionId,
      leaseToken: draftLease,
      uploaderId,
    } = await seedSession([
      {
        rowNumber: 1,
        kind: 'update',
        masterId: fxPublish.masterId,
        baseVersionId: fxPublish.versionId,
        baseSnapshot: await renderSnapshot(fxPublish.masterId),
        fields: { 'product.name': '정리-발행분 v2' },
      },
      { rowNumber: 2, kind: 'create', fields: { 'product.name': '정리-신규분', 'product.basePrice': '5000' } },
      {
        rowNumber: 3,
        kind: 'update',
        masterId: fxUpdate.masterId,
        baseVersionId: fxUpdate.versionId,
        baseSnapshot: await renderSnapshot(fxUpdate.masterId),
        fields: { 'product.name': '정리-수정분 v2' },
      },
    ]);

    await jobManager.runDraftSlice({ sessionId, leaseToken: draftLease, phase: 'drafting' });
    const draftedRows = await readItems(sessionId);
    expect(draftedRows.map((r) => r.status)).toEqual(['drafted', 'drafted', 'drafted']);
    const [publishRowFixture, createRowFixture, updateRowFixture] = draftedRows;
    const newMasterId = createRowFixture.masterId as string;
    const newDraftVersionId = createRowFixture.draftVersionId as string;
    const updateDraftVersionId = updateRowFixture.draftVersionId as string;
    const publishDraftVersionId = publishRowFixture.draftVersionId as string;
    await finishDraftingPhase(sessionId);

    await sessionManager.queuePublish(sessionId, uploaderId);

    // rowNumber=1(발행분)만 이번 발행 슬라이스에 담기게 슬라이스 크기를 1로 좁힌다 — 나머지
    // 두 행은 이 정리 케이스가 필요로 하는 "아직 발행 전" 상태로 남아야 한다.
    const previousSlice = process.env.PRODUCT_BULK_PUBLISH_SLICE;
    process.env.PRODUCT_BULK_PUBLISH_SLICE = '1';
    try {
      const publishLease = randomUUID();
      await grantLease(sessionId, publishLease);
      await jobManager.runPublishSlice({ sessionId, leaseToken: publishLease, phase: 'publishing' });
    } finally {
      if (previousSlice === undefined) delete process.env.PRODUCT_BULK_PUBLISH_SLICE;
      else process.env.PRODUCT_BULK_PUBLISH_SLICE = previousSlice;
    }

    const afterPublishOne = await readItemById(publishRowFixture.id);
    expect(afterPublishOne.publishStatus).toBe('published');
    const stillPending = await readItemById(createRowFixture.id);
    expect(stillPending.publishStatus).toBe('pending');

    await sessionManager.cancel(sessionId, uploaderId);

    const result = await sessionManager.purgeDrafts(sessionId, uploaderId);
    expect(result).toMatchObject({ failed: 0, remaining: 0 });
    expect(result.purged).toBe(2);

    // 신규 행: master 까지 지운다.
    const newItem = await readItemById(createRowFixture.id);
    expect(newItem.draftVersionId).toBeNull();
    const newMaster = await readMaster(newMasterId);
    expect(newMaster.deletedAt).not.toBeNull();
    expect(await readVersion(newDraftVersionId)).toBeUndefined();

    // 수정 행: draft 만 지운다 — 원래 active 는 멀쩡하다.
    const updateItem = await readItemById(updateRowFixture.id);
    expect(updateItem.draftVersionId).toBeNull();
    expect(await readVersion(updateDraftVersionId)).toBeUndefined();
    const originalActive = await readVersion(fxUpdate.versionId);
    expect(originalActive.status).toBe('active');

    // 발행된 행: 미접촉이다.
    const publishedItem = await readItemById(publishRowFixture.id);
    expect(publishedItem.draftVersionId).toBe(publishDraftVersionId);
    const publishedVersion = await readVersion(publishDraftVersionId);
    expect(publishedVersion.status).toBe('active');
  });

  /**
   * Task 11 의 `BulkVariantCodeChecker.checkSession` 은 `productVariants` ←
   * `productMasterVariants` ← `productMasterVersions`(status='active') 3테이블 조인으로
   * "다른 master 의 active 버전이 이 코드를 쓰는가"를 본다. 기존 통합 스펙들은
   * `claims.size === 0` 에서 단락해 이 조인이 실 DB 에서 한 번도 실행되지 않았다.
   */
  it('품목코드 중복 사전검사의 3테이블 조인이 실 DB 에서 돈다', async () => {
    const suffix = randomUUID().slice(0, 8);
    const dupCode = `DUP-CODE-${suffix}`;
    const selfCode = `SELF-CODE-${suffix}`;
    // 다른 master 의 active 버전이 코드를 이미 쓴다 — 신규 행이 같은 코드를 주장하면 걸린다.
    await seedActiveProduct({ name: '코드 소유자', brand: 'ACME', basePrice: 10000, variantCode: dupCode });
    const { sessionId: dupSessionId } = await seedSession([
      {
        rowNumber: 1,
        kind: 'create',
        fields: {
          'product.name': '중복 신규',
          'product.basePrice': '10000',
          'variant:.variantCode': dupCode,
        },
      },
    ]);
    const flaggedDup = await checker.checkSession(dupSessionId);
    expect(flaggedDup).toBe(1);
    const [dupItem] = await readItems(dupSessionId);
    expect(dupItem.status).toBe('invalid');
    expect(dupItem.errorMessage).toContain('이미 사용 중인 상품');

    // 자기 master 의 active 버전이 쓰는 코드는 통과한다 — 수정 행이 자기 조합끼리 코드를
    // 옮기는 것은 정상 업무다.
    const selfOwner = await seedActiveProduct({
      name: '자기 코드',
      brand: 'ACME',
      basePrice: 10000,
      variantCode: selfCode,
    });
    const { sessionId: selfSessionId } = await seedSession([
      {
        rowNumber: 1,
        kind: 'update',
        masterId: selfOwner.masterId,
        baseVersionId: selfOwner.versionId,
        baseSnapshot: await renderSnapshot(selfOwner.masterId),
        fields: { 'variant:.variantCode': selfCode },
      },
    ]);
    const flaggedSelf = await checker.checkSession(selfSessionId);
    expect(flaggedSelf).toBe(0);
    const [selfItem] = await readItems(selfSessionId);
    expect(selfItem.status).toBe('pending');
    expect(selfItem.errorMessage).toBeNull();
  });

  /**
   * 단위 픽스처에는 다른 세션의 행이 없어 `purgeDrafts` 의 `eq(productBulkItems.sessionId,
   * sessionId)` 술어가 무방비였다. 세션 둘을 만들어 하나만 취소·정리하고, 다른 세션의
   * draft 가 그대로 남아 있는지를 본다.
   */
  it('purgeDrafts 는 다른 세션의 draft 를 건드리지 않는다', async () => {
    const fxA = await seedActiveProduct({ name: '격리-A', brand: 'ACME', basePrice: 10000 });
    const fxB = await seedActiveProduct({ name: '격리-B', brand: 'ACME', basePrice: 20000 });

    const rowA = await draftRow(fxA, { 'product.name': '격리-A v2' }); // 취소해서 정리할 세션
    const rowB = await draftRow(fxB, { 'product.name': '격리-B v2' }); // 무관한 다른 세션

    await sessionManager.cancel(rowA.sessionId, rowA.uploaderId);

    const result = await sessionManager.purgeDrafts(rowA.sessionId, rowA.uploaderId);
    expect(result).toMatchObject({ purged: 1, failed: 0, remaining: 0 });

    const itemA = await readItemById(rowA.itemId);
    expect(itemA.draftVersionId).toBeNull();
    expect(await readVersion(rowA.draftVersionId)).toBeUndefined();

    // 세션 B 는 취소되지도 않았고, purgeDrafts(A) 가 건드려서도 안 된다.
    const itemB = await readItemById(rowB.itemId);
    expect(itemB.draftVersionId).toBe(rowB.draftVersionId);
    const versionB = await readVersion(rowB.draftVersionId);
    expect(versionB.status).toBe('draft');
    expect(versionB.bulkSessionId).toBe(rowB.sessionId);
  });

  /**
   * ADR-0004 의 CoW(변형 draft 편집 시 variantId 가 갈리는 것)와 `publishVersion` 의
   * `_reconcileMatchingsAfterPublish` 사이의 구멍을 잠근다. 매칭(`product_matchings`)은
   * 이전 active 의 같은 옵션 조합 variant 로부터 인계되지만, `sales_variant_policies`(수동
   * 품절·출시 예정)는 인계되지 않아 CoW 를 겪은 품목은 발행 즉시 정책이 조용히 풀렸다.
   */
  it('CoW 로 variantId 가 갈려도 판매정책이 새 품목으로 인계된다', async () => {
    // ① active 버전 + 품목 하나를 만든다
    const fx = await seedActiveProduct({ name: 'CoW 정책 인계', brand: 'ACME', basePrice: 10000 });

    // ② 그 품목에 수동 품절을 건다 (화면이 하는 것과 같은 경로)
    await db.run((trx) =>
      trx.insert(salesVariantPolicies).values({
        variantId: fx.variantId,
        inventoryManagement: true,
        preStockSellable: false,
        alwaysSellableZeroStock: false,
        availabilityOverride: 'manual_out_of_stock',
      }),
    );

    // ③ draft 를 떠서 품목코드를 바꾼다 → CoW 가 새 variantId 를 만든다 (active 버전이 이미
    // 그 variantId 를 물고 있는 상태에서 draft 의 매핑만 갈아치우는 것이 CoW 의 발동 조건이다).
    const draft = await versions.createDraftVersion(fx.versionId, randomUUID(), true);
    const cow = await variants.updateVariantInDraft(fx.masterId, draft.id, fx.variantId, {
      variantCode: `CHANGED-${randomUUID().slice(0, 8)}`,
    });
    expect(cow.cowed).toBe(true);
    expect(cow.variantId).not.toBe(fx.variantId);

    // ④ 발행
    await versions.publishVersion(draft.id);

    // ⑤ 새 variantId 가 정책을 이어받았는가
    const [policy] = await db.run((trx) =>
      trx.select().from(salesVariantPolicies).where(eq(salesVariantPolicies.variantId, cow.variantId)),
    );
    expect(policy?.availabilityOverride).toBe('manual_out_of_stock');
  });

  /**
   * (Task 8) 품목 판매정책은 상품 버전에 담기지 않는다(설계 스펙 §2). 그래서 정책만 바꾼 행은
   * **버전 없이** 정책만 적용돼야 한다 — 4단계 applier 가 draft 를 아예 만들지 않고(`Task 6`),
   * 발행 레인이 현재 active 를 대상으로 정책을 건다.
   *
   * 페이크 위에서는 잡을 수 없는 것 셋을 여기서 못 박는다: (1) 조합키 `''`(옵션 없는 상품의
   * F3 계약)가 실제 `product_master_variants` 조회로 풀리는지, (2) `updateVariantStockPolicy`
   * 가 발행 트랜잭션 안에서 `sales_variant_policies` 에 실제로 커밋되는지, (3) 그 과정에서
   * 버전이 하나도 늘지 않는지.
   */
  it('정책만 바뀐 행은 새 버전 없이 정책만 적용된다', async () => {
    const fx = await seedActiveProduct({ name: '정책만 수정', brand: 'ACME', basePrice: 10000 });
    const beforeCount = await countVersions(fx.masterId);

    const { sessionId, leaseToken, uploaderId } = await seedSession([
      {
        rowNumber: 1,
        kind: 'update',
        masterId: fx.masterId,
        baseVersionId: fx.versionId,
        baseSnapshot: await renderSnapshot(fx.masterId),
        // 옵션 없는 상품은 조합키가 빈 문자열이다(F3) — `variant:.<키>` 형태가 된다.
        fields: { 'variant:.availabilityOverride': '품절' },
        variantRows: [{ combination: '', availabilityOverride: '품절', comingSoonDate: '' }],
      },
    ]);

    await jobManager.runDraftSlice({ sessionId, leaseToken, phase: 'drafting' });
    const [drafted] = await readItems(sessionId);
    expect(drafted.status).toBe('drafted');
    // 버전 필드 변경분이 비어 draft 자체가 없다 — 이 태스크가 닫은 구멍의 입구다.
    expect(drafted.draftVersionId).toBeNull();
    await finishDraftingPhase(sessionId);

    await sessionManager.queuePublish(sessionId, uploaderId);
    const publishLease = randomUUID();
    await grantLease(sessionId, publishLease);
    await jobManager.runPublishSlice({ sessionId, leaseToken: publishLease, phase: 'publishing' });

    const published = await readItemById(drafted.id);
    expect(published.publishStatus).toBe('published');
    expect(published.publishError).toBeNull();

    // 버전이 안 늘었다.
    expect(await countVersions(fx.masterId)).toBe(beforeCount);

    const [policy] = await db.run((trx) =>
      trx.select().from(salesVariantPolicies).where(eq(salesVariantPolicies.variantId, fx.variantId)),
    );
    expect(policy?.availabilityOverride).toBe('manual_out_of_stock');
  });

  /**
   * (Task 8) 조합키가 안 풀리면 **조용히 건너뛰지 않는다** — 정책이 안 걸렸는데 '발행됨'으로
   * 보이는 것이 이 기능에서 가장 나쁜 침묵이다. 실 DB 로 보는 이유: 해석 실패가 그 행의
   * 트랜잭션을 통째로 롤백시켜야 하고(정책이 절반만 걸린 행이 남으면 안 된다), 그 롤백이
   * 옆 행의 성공을 되돌리지 않아야 한다.
   */
  it('조합키가 안 풀리면 그 행만 실패한다', async () => {
    const fxBad = await seedActiveProduct({ name: '조합 미해석', brand: 'ACME', basePrice: 10000 });
    const fxGood = await seedActiveProduct({ name: '옆 행', brand: 'ACME', basePrice: 20000 });

    const { sessionId, leaseToken, uploaderId } = await seedSession([
      {
        rowNumber: 1,
        kind: 'update',
        masterId: fxBad.masterId,
        baseVersionId: fxBad.versionId,
        baseSnapshot: await renderSnapshot(fxBad.masterId),
        // 이 상품에 존재하지 않는 조합키다 — 옵션이 없어 실제 조합키는 `''` 뿐이다.
        fields: { 'variant:없는조합.availabilityOverride': '품절' },
        variantRows: [{ combination: '없는조합', availabilityOverride: '품절', comingSoonDate: '' }],
      },
      {
        rowNumber: 2,
        kind: 'update',
        masterId: fxGood.masterId,
        baseVersionId: fxGood.versionId,
        baseSnapshot: await renderSnapshot(fxGood.masterId),
        fields: { 'variant:.availabilityOverride': '품절' },
        variantRows: [{ combination: '', availabilityOverride: '품절', comingSoonDate: '' }],
      },
    ]);

    await jobManager.runDraftSlice({ sessionId, leaseToken, phase: 'drafting' });
    const draftedRows = await readItems(sessionId);
    expect(draftedRows.map((r) => r.status)).toEqual(['drafted', 'drafted']);
    await finishDraftingPhase(sessionId);

    await sessionManager.queuePublish(sessionId, uploaderId);
    const publishLease = randomUUID();
    await grantLease(sessionId, publishLease);
    await jobManager.runPublishSlice({ sessionId, leaseToken: publishLease, phase: 'publishing' });

    const badRow = await readItemById(draftedRows[0].id);
    expect(badRow.publishStatus).toBe('failed');
    expect(badRow.publishError).toContain('조합');
    // 실패 행의 정책은 하나도 커밋되지 않았다.
    const badPolicies = await db.run((trx) =>
      trx.select().from(salesVariantPolicies).where(eq(salesVariantPolicies.variantId, fxBad.variantId)),
    );
    expect(badPolicies).toHaveLength(0);

    // 옆 행은 멀쩡히 발행됐다 — 한 행의 롤백이 다른 행을 되돌리지 않는다.
    const goodRow = await readItemById(draftedRows[1].id);
    expect(goodRow.publishStatus).toBe('published');
    const [goodPolicy] = await db.run((trx) =>
      trx.select().from(salesVariantPolicies).where(eq(salesVariantPolicies.variantId, fxGood.variantId)),
    );
    expect(goodPolicy?.availabilityOverride).toBe('manual_out_of_stock');
  });

  /**
   * (리뷰 Finding 3) **계약 2(b) 를 실 DB 로 잠근다** — "수정 행은 CoW 인계를 받은 뒤라야
   * 작업자가 적은 값이 인계값을 이긴다".
   *
   * 유닛의 순서 단언은 페이크 위 상대 위치만 본다. 실 DB 에서만 잡히는 것은 따로 있다:
   * `publishVersion` 이후 `resolveExisting(masterId, draftVersionId)` 가 CoW 로 **새로 갈린**
   * variantId 를 돌려주는가. 옛 variantId 를 돌려주면 정책이 활성 버전과 무관한 품목에 붙고
   * 행은 '발행됨' 으로 보이며 **예외조차 안 난다**.
   *
   * 위 `CoW 로 variantId 가 갈려도 판매정책이 새 품목으로 인계된다`(Task 1)는 레인이 아니라
   * `versions.publishVersion` 을 직접 불러서 이 결합을 안 덮는다. 여기서는 draft + 정책 +
   * CoW 를 **한 행에** 태운다: 품목코드 변경이 버전 필드라 draft 가 생기고 CoW 가 일어나며,
   * 같은 조합에 정책도 적혀 있다.
   *
   * 인계값(`coming_soon`)과 작업자 값(`manual_out_of_stock`)을 **서로 다르게** 잡는 것이
   * 이 단언의 전부다 — 같으면 인계만 돌아도 초록이 된다.
   */
  it('CoW 로 갈린 새 품목에 작업자가 적은 정책이 인계값을 이긴다', async () => {
    const fx = await seedActiveProduct({
      name: 'CoW + 정책',
      brand: 'ACME',
      basePrice: 10000,
      variantCode: `ORIG-${randomUUID().slice(0, 8)}`,
    });

    // 인계될 옛 값. Task 1 의 `_reconcileMatchingsAfterPublish` 가 이것을 새 variantId 로 옮긴다.
    await db.run((trx) =>
      trx.insert(salesVariantPolicies).values({
        variantId: fx.variantId,
        inventoryManagement: true,
        preStockSellable: false,
        alwaysSellableZeroStock: false,
        availabilityOverride: 'coming_soon',
        comingSoonDate: '2026-12-01',
      }),
    );

    const changedCode = `CHANGED-${randomUUID().slice(0, 8)}`;
    const { sessionId, leaseToken, uploaderId } = await seedSession([
      {
        rowNumber: 1,
        kind: 'update',
        masterId: fx.masterId,
        baseVersionId: fx.versionId,
        baseSnapshot: await renderSnapshot(fx.masterId),
        fields: {
          // 버전 필드 — draft 를 만들고, 포크한 draft 에서 CoW 를 일으킨다.
          'variant:.variantCode': changedCode,
          // 정책 필드 — 작업자가 적은 값. 인계값(출시예정)과 다르다.
          'variant:.availabilityOverride': '품절',
        },
        variantRows: [{ combination: '', variantCode: changedCode, availabilityOverride: '품절', comingSoonDate: '' }],
      },
    ]);

    await jobManager.runDraftSlice({ sessionId, leaseToken, phase: 'drafting' });
    const [drafted] = await readItems(sessionId);
    expect(drafted.status).toBe('drafted');
    const draftVersionId = drafted.draftVersionId as string;
    expect(draftVersionId).toBeTruthy();
    await finishDraftingPhase(sessionId);

    await sessionManager.queuePublish(sessionId, uploaderId);
    const publishLease = randomUUID();
    await grantLease(sessionId, publishLease);
    await jobManager.runPublishSlice({ sessionId, leaseToken: publishLease, phase: 'publishing' });

    expect((await readItemById(drafted.id)).publishStatus).toBe('published');

    // 발행된 버전의 variant — CoW 로 원래 것과 갈렸어야 한다(안 갈렸으면 이 케이스가 아무
    // 결합도 시험하지 않은 것이다).
    const [mapping] = await db.run((trx) =>
      trx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(eq(productMasterVariants.versionId, draftVersionId)),
    );
    expect(mapping.variantId).not.toBe(fx.variantId);

    const [policy] = await db.run((trx) =>
      trx.select().from(salesVariantPolicies).where(eq(salesVariantPolicies.variantId, mapping.variantId)),
    );
    // 작업자가 적은 값이 인계값(coming_soon)을 이긴다 — 순서가 뒤집히면 여기가 coming_soon 이다.
    expect(policy?.availabilityOverride).toBe('manual_out_of_stock');
    // 출시예정이 아니게 됐으므로 날짜도 함께 정리된다(짝 칸 규약).
    expect(policy?.comingSoonDate).toBeNull();
  });
});
