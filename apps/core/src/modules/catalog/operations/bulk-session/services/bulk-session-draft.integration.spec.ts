// jest moduleNameMapper 는 `@packages/event-contracts/(.*)$` 서브패스만 매핑한다 — bare
// `@packages/event-contracts`(catalog.module.ts / product-masters.service.ts 등이 이렇게
// 임포트한다)는 안 걸려 jest 환경에서 module-not-found 로 죽는다. 레포 상시 debt 이고
// bulk-session.module.spec.ts / product-versions.service.spec.ts 가 같은 우회를 쓴다.
//
// **다만 이 스위트는 스텁이 아니라 진짜 모듈을 되돌린다.** 선례들은 `PRODUCT_STREAM` 하나만
// 손으로 적어 넣는데, 그 스펙들은 `.compile()` 까지만 하거나 그 상수를 읽는 코드를 아예
// 부르지 않는다. 이 스위트는 `publishVersion` 을 진짜로 부르고, 그 경로가
// `INVENTORY_STREAM.topic.topic`(product-sellable-quantity.service.ts) 까지 실제로 읽는다 —
// 손으로 적은 스텁이면 그 자리에서 `undefined.topic` 으로 죽는다. 매핑되는 서브패스로
// requireActual 하면 진짜 계약이 그대로 돌아오므로 "무엇을 더 적어야 하는가"를 영원히
// 추적하지 않아도 된다.
jest.mock(
  '@packages/event-contracts',
  // 제네릭을 박아 `any` 반환(no-unsafe-return)을 피한다 — 진짜 모듈을 되돌리는 것이므로
  // 타입도 진짜 모듈의 것이 맞다.
  () => jest.requireActual<typeof import('@packages/event-contracts')>('@packages/event-contracts/index'),
  { virtual: true },
);

import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
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
// (투영은 product_variants 에 FK 가 없고, 아웃박스는 애초에 FK 가 없다) — 이 스위트가 만든
// 행이므로 이 스위트가 치운다. 적재 대상은 공용 `event.outbox_events` 다 — 6-C-2 가 catalog
// 호출자를 그리로 회수했고 6-C-4 가 옛 `public.outbox_events` 를 지웠다.
import { productSellableQuantityProjections } from '../../../../inventory/schema/inventory.schema';
import type { DbTransaction } from '../../../catalog.types';
import type { BulkBaseSnapshot, BulkItemInput, BulkItemPayload, FlatFields, PrefillRow } from './bulk-session.types';

/**
 * 4단계(엑셀 행 → 상품 draft)를 **실 Postgres + 실 Nest DI** 로 구동한다.
 *
 * 앞선 열 개 태스크는 전부 페이크 객체 위에서만 검증됐다. 여기서 못 박는 것은 이 단계의
 * 핵심 주장 하나다:
 *
 *   **"작업자가 A필드를, 그 사이 남이 B필드를 바꿨을 때 생성된 draft 안에 둘 다 살아있다."**
 *
 * 그 주장이 draft 를 다운로드 시점 스냅샷이 아니라 **현재 active 에서 포크**하는 설계의
 * 존재 이유다(스펙 §3.6 — `publishVersion` 은 병합이 아니라 통째 교체라 스냅샷에서
 * 포크하면 남의 변경이 발행 순간 통째로 사라진다). 단위 스펙은 이걸 잡을 수 없다 —
 * `createDraftVersion`/`getActiveVersion` 이 목이면 어느 버전에서 포크했든 목이 시킨 대로
 * 답하기 때문이다.
 *
 * **모듈 부트스트랩**: `Test.createTestingModule` 로 `CatalogModule` 을 통째로 띄운다 —
 * 검증 대상이 catalog core 의 실제 쓰기 경로(포크·CoW·가격 replace)라 그 그래프가 진짜여야
 * 한다. 선례는 `bulk-session.module.spec.ts` 이고 거기 있는 우회 둘(가상 모듈,
 * `KAFKA_BOOTSTRAP_TOPICS=false`)을 그대로 쓴다. `.compile()` 은 `onModuleInit` 을 부르지
 * 않으므로(@nestjs/testing 의 문서화된 동작) `@Cron` 워커·이미지 정리 스윕이 뜨지 않는다 —
 * 이 스위트가 만든 데이터를 크론이 뒤에서 건드릴 위험이 구조적으로 없다.
 *
 * **실행**: 전용 scratch DB(`bulk_stage4_scratch`)에 core 마이그레이션을 올린 뒤 그 DB 를
 * 가리키는 DATABASE_URL 로 돌린다. `dev_core` 를 쓰지 않는다 — 이 브랜치와 무관한 보류
 * 마이그레이션이 있고, 이 스위트는 **커밋한다**(롤백 격리가 아니다).
 *
 * **격리**: 롤백도 임시 스키마도 쓰지 않는다. 롤백 트랜잭션 안에서는 `draftOne` 의 "행
 * 하나가 트랜잭션 하나" 자체를 관찰할 수 없고(6번 케이스의 22001 격리가 그 위에서만
 * 성립한다), `LIKE` 복제 임시 스키마로는 스무 개 가까운 catalog 테이블의 FK 그래프를
 * 재현할 수 없다. 대신 전용 scratch DB 의 public 에 커밋하고 `afterAll` 이 이 스위트가
 * 만든 master·세션·variant·가격룰을 지운다.
 *
 * **픽스처는 반드시 서비스로 만든다**(`createMaster` → `updateVersion` →
 * `replaceVersionRules` → `publishVersion`). 손으로 INSERT 하면 실제 쓰기 경로가 만드는 행
 * 모양과 갈라져 거짓 초록이 된다 — 예컨대 `createMaster` 가 만드는 기본 variant 매핑이
 * 없으면 5번 케이스의 CoW 는 애초에 발화하지 않는다. 세션·아이템 행은 직접 INSERT 한다:
 * 그건 앞 단계(업로드·검증)의 산물이고 이 태스크의 검증 대상이 아니다.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_BULK_SESSION_DB === '1' && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the bulk session drafting integration suite.');
}

/**
 * **대상 DB 가드.** 이 스위트는 롤백이 아니라 **커밋**한다(위 헤더의 '격리' 참조) — 그래서
 * DB 를 잘못 잡으면 개발용 DB 에 진짜 상품 master·version·variant 가 생겼다 지워지고,
 * 도중에 크래시하면 **남는다**.
 *
 * 관례로는 못 막는다: 유일한 진입점(`npm run test:bulk-session:integration`)이 대상 DB 를
 * 고정하지 않고 `dotenv -e apps/core/.env` 를 태우는데, 메인 체크아웃의 그 파일은
 * `DATABASE_URL=…/dev_core` 다(이 워크트리엔 `.env` 가 없어 지금은 무증상일 뿐이다).
 * `REQUIRE_BULK_SESSION_DB=1` 은 URL **부재**만 막지 어느 DB 인지는 보지 않는다.
 *
 * 이름 패턴을 `bulk_stage<N>_scratch` 로 넓게 잡는 이유: 그 진입점이 2·3·4단계 스위트를
 * **한 DATABASE_URL 로** 함께 돌린다(각 스위트 헤더가 저마다 다른 stage 이름을 적어 뒀다).
 * 4단계 전용으로 좁히면 다른 세 스위트의 정상 실행을 이 가드가 막는다.
 *
 * `DATABASE_URL` 이 아예 없으면 던지지 않는다 — 그 경로는 아래에서 `describe.skip` 이고,
 * DB 없이 도는 개발자의 전체 jest 실행을 이 가드가 깨면 안 된다.
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

describeIfDb('일괄 세션 drafting 레인 (실 Postgres + 실 Nest DI)', () => {
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
  let optionLoader: import('../../../core/products/loaders/option-read.loader').OptionReadLoader;
  let createImageKeyAllocator: typeof import('./form-export.types').createImageKeyAllocator;

  /** 이 스위트가 만든 것들. `afterAll` 이 이 목록만 지운다 — scratch DB 를 통째로 비우지 않는다. */
  const createdMasterIds = new Set<string>();
  const createdSessionIds = new Set<string>();

  beforeAll(async () => {
    // CatalogModule 이 EventsModule.forRoot({enableOutbox:true}) 를 정적으로 물고 있어 없으면
    // kafkajs 설정 생성 자체가 던진다 — 실제 브로커에 붙지는 않으므로 값은 아무 host:port 나
    // 상관없다(bulk-session.module.spec.ts:39-49 와 같은 이유·같은 값).
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? 'bulk-session-draft-spec-test-secret';
    process.env.KAFKA_BROKERS = process.env.KAFKA_BROKERS ?? 'localhost:9092';
    // 토픽 부트스트랩(admin.connect + createTopics)을 끈다 — 이 플래그가 없어도 실패하진
    // 않지만(try/catch 로 절대 rethrow 하지 않는다) kafkajs 의 bounded retry backoff 만큼
    // 느려진다(모듈 스펙 실측 11초→1.2초).
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
    const { OptionReadLoader } = await import('../../../core/products/loaders/option-read.loader');
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
    optionLoader = moduleRef.get(OptionReadLoader, { strict: false });
  });

  afterAll(async () => {
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
          await trx.delete(productVariants).where(inArray(productVariants.id, variantIds));
        }
        if (pricingRuleIds.length > 0) {
          await trx.delete(pricingRules).where(inArray(pricingRules.id, pricingRuleIds));
        }
        // 아웃박스 행. `publishVersion` 이 master 당 `ProductMasterActiveVersionChanged` 를,
        // `recalculateAndPublishForVariant` 가 variant 당 `ProductSellableQuantityChanged` 를
        // 쌓는다 — FK 가 없어 어떤 CASCADE 도 닿지 않으므로 실행마다 단조 증가한다.
        // `aggregate_id` 로 **이 스위트가 만든 것만** 지운다(테이블을 비우지 않는다).
        const aggregateIds = [...new Set([...masterIds, ...variantIds])];
        if (aggregateIds.length > 0) {
          await trx.delete(outbox_events).where(inArray(outbox_events.aggregateId, aggregateIds));
        }
      });
    }
    await moduleRef?.close();
  });

  // ─────────────────────────── 픽스처 헬퍼 ───────────────────────────

  /**
   * 발행까지 끝난 상품 하나를 **서비스 경로로만** 만든다.
   *
   * 손으로 INSERT 하지 않는 이유는 헤더 코멘트에 있다 — 특히 `createMaster` 가 만드는
   * 기본 variant + `product_master_variants` 매핑이 없으면 5번 케이스의 CoW 가 발화하지
   * 않아 그 테스트가 아무것도 검증하지 못한 채 초록이 된다.
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

  /**
   * 아이템의 `base_snapshot` — **현재 active 를 `renderMaster` 로 그린 것**이다.
   *
   * 손으로 조립하지 않는 이유: 파싱 슬라이스가 싣는 것이 정확히 이 함수의 출력이므로
   * (`buildPrefill` → `items[].snapshot`), 다른 모양을 심으면 4단계가 실제로 받는 값과
   * 갈라진다. `pricingEditable` 만 얹는다 — 그게 `BulkBaseSnapshot` 이 `PrefillBundle` 에
   * 더하는 유일한 필드다(권위 있는 원본은 `product_form_export_items.pricing_editable`).
   */
  async function renderSnapshot(masterId: string): Promise<BulkBaseSnapshot> {
    const bundle = await db.run((trx: DbTransaction) =>
      snapshotReader.renderMaster(trx, masterId, createImageKeyAllocator(), new Map()),
    );
    if (!bundle) throw new Error(`active 버전이 없어 스냅샷을 그릴 수 없다: ${masterId}`);
    return { ...bundle, pricingEditable: true };
  }

  /**
   * 아이템의 `input`(notNull). 4단계는 신규 행의 **옵션 그룹 귀속**에만 이걸 읽는다
   * (`draftOne` → `DraftInput.optionRows`) — 그래서 옵션 시트 행만 실어 주면 된다.
   */
  function inputWith(options: PrefillRow[]): BulkItemInput {
    return {
      bundle: { product: {}, options, variants: [], categories: [], constraint: null },
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
    /**
     * 업로드 원본의 옵션 시트 행. 신규 행에서 **그룹 귀속의 유일한 권위 있는 출처**다
     * (bulk-draft.options.ts 의 `parseOptionSheet`) — `fields` 로는 복원할 수 없다.
     */
    optionRows?: PrefillRow[];
  }

  /**
   * `phase='drafting'` 세션 하나 + 아이템들. **lease 토큰을 행에 심는 것이 핵심이다** —
   * `runDraftSlice` 는 행마다 `renewLease` 로 토큰 CAS 를 하므로, 세션 행의 `lease_token` 과
   * 넘긴 토큰이 다르면 첫 행에서 "lease 를 잃었다"며 조용히 멈춘다. 그러면 이 스위트의
   * 모든 단정이 **아무것도 검증하지 않은 채** 초록이 된다.
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
        name: 'drafting 시나리오',
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
          input: inputWith(item.optionRows ?? []),
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

  async function readVersion(versionId: string) {
    const [row] = await db.run((trx) =>
      trx.select().from(productMasterVersions).where(eq(productMasterVersions.id, versionId)),
    );
    return row;
  }

  /**
   * 수정 행 하나짜리 세션을 drafting 까지 돌린 결과. 잠금(2·3·4번) 케이스가 공유한다 —
   * 세 케이스가 보는 것은 draft 를 만든 방법이 아니라 **만들어진 draft 에 걸린 잠금**이다.
   */
  async function draftOneRow(): Promise<{
    sessionId: string;
    uploaderId: string;
    draftVersionId: string;
    masterId: string;
  }> {
    const fx = await seedActiveProduct({ name: '잠금 픽스처', brand: 'ACME', basePrice: 10000 });
    const { sessionId, leaseToken, uploaderId } = await seedSession([
      {
        rowNumber: 1,
        kind: 'update',
        masterId: fx.masterId,
        baseVersionId: fx.versionId,
        baseSnapshot: await renderSnapshot(fx.masterId),
        fields: { 'product.name': '잠금 픽스처 v2' },
      },
    ]);

    await jobManager.runDraftSlice({ sessionId, leaseToken, phase: 'drafting' });

    const [item] = await readItems(sessionId);
    expect(item.status).toBe('drafted');
    expect(item.draftVersionId).toBeTruthy();
    return { sessionId, uploaderId, draftVersionId: item.draftVersionId as string, masterId: fx.masterId };
  }

  // ─────────────────────────── 케이스 ───────────────────────────

  /**
   * **이 단계의 핵심 주장.** 스펙 §3.6 의 포크-후-적용 설계 전체가 이 한 케이스에 걸려 있다 —
   * `applyUpdate` 가 `getActiveVersion` 대신 스냅샷 버전에서 포크하도록 회귀하면 여기서만
   * 빨개진다(단위 스펙은 그 두 호출이 전부 목이라 못 잡는다).
   */
  it('작업자가 판매가를, 남이 브랜드를 바꿨을 때 draft 에 둘 다 살아있다', async () => {
    // ① active 상품 하나 (브랜드 ACME, 판매가 10000)
    const fx = await seedActiveProduct({ name: '티셔츠', brand: 'ACME', basePrice: 10000 });

    // ② 그 시점 스냅샷으로 세션 아이템 하나 — 작업자는 판매가만 고쳤다.
    const baseSnapshot = await renderSnapshot(fx.masterId);
    expect(baseSnapshot.product.brand).toBe('ACME');
    const { sessionId, leaseToken } = await seedSession([
      {
        rowNumber: 1,
        kind: 'update',
        masterId: fx.masterId,
        baseVersionId: fx.versionId,
        baseSnapshot,
        fields: { 'product.basePrice': '12000' },
      },
    ]);

    // ③ 그 사이 남이 **브랜드만** 바꿔 새 active 를 발행한다(정상 draft→publish 경로).
    const otherDraft = await versions.createDraftVersion(fx.versionId, randomUUID(), true);
    await masters.updateVersion(otherDraft.id, { brand: 'BETA' });
    await versions.publishVersion(otherDraft.id);
    const republished = await versions.getActiveVersion(fx.masterId);
    expect(republished.id).toBe(otherDraft.id);
    expect(republished.brand).toBe('BETA');

    // ④ drafting 레인
    await jobManager.runDraftSlice({ sessionId, leaseToken, phase: 'drafting' });

    // ⑤ 둘 다 살아있어야 한다.
    const [item] = await readItems(sessionId);
    expect(item.errorMessage).toBeNull();
    expect(item.status).toBe('drafted');
    expect(item.draftVersionId).toBeTruthy();

    const draft = await readVersion(item.draftVersionId as string);
    expect(draft.status).toBe('draft');
    // 남의 변경이 살아남았다. 스냅샷에서 포크했다면 여기서 'ACME' 가 나온다.
    expect(draft.brand).toBe('BETA');
    // 내 변경도 적용됐다.
    const rules = await pricing.getVersionRules(draft.id);
    expect(rules.basePriceRules).toHaveLength(1);
    expect(rules.basePriceRules[0].operationValue).toBe(12000);
    // 남이 만든 active 는 그대로다 — draft 는 포크이지 인플레이스 편집이 아니다.
    const stillActive = await readVersion(otherDraft.id);
    expect(stillActive.status).toBe('active');
    const activeRules = await pricing.getVersionRules(otherDraft.id);
    expect(activeRules.basePriceRules[0].operationValue).toBe(10000);
  });

  it('세션이 잠근 draft 는 개별 발행이 거부된다', async () => {
    const { draftVersionId } = await draftOneRow();

    // 잠금은 값으로 실려 있어야 한다 — 거부 문구만 보면 다른 이유로 던져도 통과한다.
    const draft = await readVersion(draftVersionId);
    expect(draft.bulkSessionId).toBeTruthy();

    await expect(versions.publishVersion(draftVersionId)).rejects.toThrow('일괄 등록 세션');
  });

  it('세션이 잠근 draft 는 my-drafts 에 나오지 않는다', async () => {
    const { uploaderId, draftVersionId } = await draftOneRow();

    const list = await versions.getMyDraftVersions(uploaderId, { page: 1, limit: 50 });
    expect(list.data.map((d) => d.versionId)).not.toContain(draftVersionId);
  });

  it('취소하면 잠금이 풀려 my-drafts 에 다시 나온다', async () => {
    const { sessionId, uploaderId, draftVersionId } = await draftOneRow();

    // 취소 전에는 안 보인다 — 이 단정이 없으면 아래 toContain 이 "원래 늘 보였다"와 구분되지 않는다.
    const before = await versions.getMyDraftVersions(uploaderId, { page: 1, limit: 50 });
    expect(before.data.map((d) => d.versionId)).not.toContain(draftVersionId);

    await sessionManager.cancel(sessionId, uploaderId);

    const after = await versions.getMyDraftVersions(uploaderId, { page: 1, limit: 50 });
    expect(after.data.map((d) => d.versionId)).toContain(draftVersionId);
    // draft 자체는 지우지 않는다 — 잠금만 푼다(스펙 §3.12).
    const draft = await readVersion(draftVersionId);
    expect(draft.bulkSessionId).toBeNull();
    expect(draft.status).toBe('draft');
  });

  it('수정 행의 variantCode 변경이 active variant 를 건드리지 않는다', async () => {
    // ADR-0004 의 CoW 가 실제로 도는지 본다. v3 방식(productVariants 직접 UPDATE)으로
    // 회귀하면 active 의 variantCode 가 함께 바뀌어 여기서 빨개진다.
    const fx = await seedActiveProduct({ name: '조합 픽스처', brand: 'ACME', basePrice: 10000, variantCode: 'OLD' });
    const { sessionId, leaseToken } = await seedSession([
      {
        rowNumber: 1,
        kind: 'update',
        masterId: fx.masterId,
        baseVersionId: fx.versionId,
        baseSnapshot: await renderSnapshot(fx.masterId),
        // 옵션 없는 상품의 단일 기본 조합은 조합키가 빈 문자열이다(F3 계약).
        fields: { 'variant:.variantCode': 'NEW' },
      },
    ]);

    await jobManager.runDraftSlice({ sessionId, leaseToken, phase: 'drafting' });

    const [item] = await readItems(sessionId);
    expect(item.errorMessage).toBeNull();
    expect(item.status).toBe('drafted');

    const [activeVariant] = await db.run((trx) =>
      trx.select().from(productVariants).where(eq(productVariants.id, fx.variantId)),
    );
    expect(activeVariant.variantCode).toBe('OLD');

    // 그리고 draft 쪽은 **새 variant** 로 갈라져 'NEW' 를 들고 있어야 한다 — 위 단정만으로는
    // "아무 일도 안 일어났다"와 구분되지 않는다.
    const [draftMapping] = await db.run((trx) =>
      trx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(eq(productMasterVariants.versionId, item.draftVersionId as string)),
    );
    expect(draftMapping.variantId).not.toBe(fx.variantId);
    const [draftVariant] = await db.run((trx) =>
      trx.select().from(productVariants).where(eq(productVariants.id, draftMapping.variantId)),
    );
    expect(draftVariant.variantCode).toBe('NEW');
  });

  /**
   * **취소 레이스의 마지막 방어선**(최종 리뷰 ①). `renewLease` 의 취소 검사와 draft
   * 트랜잭션의 커밋 사이에 취소가 커밋되면, 그 행의 draft 가 `bulk_session_id` 를 단 채
   * 커밋된다 — `cancel()` 의 해제 UPDATE 는 그 미커밋 행을 못 보고, 나중에 그 값을 지우는
   * 경로가 레포에 없어(claim 은 취소된 세션을 안 집고 cancel 은 canceled 에 409) draft 가
   * 발행·삭제·재취소 전부 막힌 **영구 미아**가 된다.
   *
   * **`renewLease` 를 목으로 덮는 이유**: 그 창은 두 커넥션의 커밋 순서로만 열리는데,
   * `renewLease` 자체가 세션 행을 UPDATE 하므로 어떤 순서로 짜도 그 값싼 필터가 먼저
   * 취소를 관측해 버린다(취소 트랜잭션의 행 잠금 때문에 renewLease 가 그 커밋을 기다린다).
   * 즉 "취소를 못 본 renewLease" 는 목으로만 재현된다. 목은 그 **필터 하나**뿐이고 DB·
   * 트랜잭션·applier 는 전부 진짜라, 이 케이스가 잠그는 것은 정확히 트랜잭션 안의
   * `SELECT … FOR UPDATE` 재확인이다.
   */
  it('취소가 커밋된 뒤 시작된 행은 draft 를 만들지 않는다 — 미아 draft 방지', async () => {
    const fx = await seedActiveProduct({ name: '취소 레이스', brand: 'ACME', basePrice: 10000 });
    const { sessionId, leaseToken, uploaderId } = await seedSession([
      {
        rowNumber: 1,
        kind: 'update',
        masterId: fx.masterId,
        baseVersionId: fx.versionId,
        baseSnapshot: await renderSnapshot(fx.masterId),
        fields: { 'product.name': '취소 레이스 v2' },
      },
    ]);

    // 실제 취소 경로 그대로 — phase 를 canceled 로 찍고 cancel_requested_at 을 남긴다.
    await sessionManager.cancel(sessionId, uploaderId);

    // 이 파일의 다른 캐스팅(`as string`)과 달리 private 메서드 접근이라 `as any` 가 불가피하다 —
    // 레포 선례(product-versions.service.spec.ts:503)와 같은 형태다.
    const renewLease = jest.spyOn(jobManager as any, 'renewLease').mockResolvedValue({
      owned: true,
      canceled: false,
    });
    try {
      await jobManager.runDraftSlice({ sessionId, leaseToken, phase: 'drafting' });
    } finally {
      renewLease.mockRestore();
    }

    // 행은 손대지 않은 그대로다 — 'failed' 도 아니다(취소된 세션의 행은 실패가 아니다).
    const [item] = await readItems(sessionId);
    expect(item.status).toBe('pending');
    expect(item.draftVersionId).toBeNull();
    expect(item.errorMessage).toBeNull();

    // 이 세션 이름으로 잠긴 draft 가 하나도 없다.
    const locked = await db.run((trx) =>
      trx
        .select({ id: productMasterVersions.id })
        .from(productMasterVersions)
        .where(eq(productMasterVersions.bulkSessionId, sessionId)),
    );
    expect(locked).toHaveLength(0);

    // 포크 자체가 없었다 — master 에는 여전히 발행된 버전 하나뿐이다.
    const allVersions = await db.run((trx) =>
      trx
        .select({ id: productMasterVersions.id })
        .from(productMasterVersions)
        .where(eq(productMasterVersions.masterId, fx.masterId)),
    );
    expect(allVersions).toHaveLength(1);
  });

  /**
   * **이 단계에서 가장 복잡한 경로**: 옵션이 있는 신규 행. 옵션 생성 → 이름으로 되읽어
   * 조합키↔variantId 매칭(F7) → 조합별 가격·variantCode 가 한 줄에 다 걸려 있다.
   *
   * 옵션 시트 행을 **그룹이 번갈아 나오도록** 짠 것이 핵심이다 — Task 4 가 고친 결함(그룹
   * 귀속을 `fields` 의 키 삽입 순서로 추론하던 것)은 행이 그룹별로 뭉쳐 있으면 발화하지
   * 않는다. (색상,빨강) → (사이즈,S) → (색상,파랑) 순서면 옛 구현은 '파랑' 을 '사이즈' 에
   * 붙여, 조합 `V-BLUE+V-S` 가 존재하지 않는 variant 를 가리키게 되고 행이 통째로 실패한다.
   */
  it('옵션이 번갈아 적힌 신규 행에서 조합별 값·가격·품목코드가 제 variant 에 붙는다', async () => {
    const optionRows: PrefillRow[] = [
      {
        rowKey: 'P-000001',
        optionKey: 'G-COLOR',
        optionName: '색상',
        optionValueKey: 'V-RED',
        optionValueName: '빨강',
      },
      { rowKey: 'P-000001', optionKey: 'G-SIZE', optionName: '사이즈', optionValueKey: 'V-S', optionValueName: 'S' },
      {
        rowKey: 'P-000001',
        optionKey: 'G-COLOR',
        optionName: '색상',
        optionValueKey: 'V-BLUE',
        optionValueName: '파랑',
      },
    ];

    const { sessionId, leaseToken } = await seedSession([
      {
        rowNumber: 1,
        kind: 'create',
        optionRows,
        fields: {
          'product.name': '번갈아 옵션 티셔츠',
          'product.basePrice': '10000',
          'optionGroup:G-COLOR.optionName': '색상',
          'optionGroup:G-COLOR.optionSortOrder': '1',
          'optionGroup:G-SIZE.optionName': '사이즈',
          'optionGroup:G-SIZE.optionSortOrder': '2',
          'optionValue:V-RED.optionValueName': '빨강',
          'optionValue:V-S.optionValueName': 'S',
          'optionValue:V-BLUE.optionValueName': '파랑',
          // 조합키는 옵션값키의 `+` 결합이다(F7).
          'variant:V-RED+V-S.variantCode': 'RED-S',
          'variant:V-RED+V-S.basePrice': '11000',
          'variant:V-BLUE+V-S.variantCode': 'BLUE-S',
          'variant:V-BLUE+V-S.basePrice': '12000',
        },
      },
    ]);

    await jobManager.runDraftSlice({ sessionId, leaseToken, phase: 'drafting' });

    const [item] = await readItems(sessionId);
    expect(item.errorMessage).toBeNull();
    expect(item.status).toBe('drafted');
    const draftVersionId = item.draftVersionId as string;
    const masterId = item.masterId as string;

    // ① 옵션값이 **제 그룹**에 귀속됐다. 옛 구현이라면 사이즈가 [S, 파랑] 이 된다.
    const groups = await db.run((trx: DbTransaction) =>
      optionLoader.getOptionGroups(trx, masterId, draftVersionId, 'ko-KR'),
    );
    const valuesByGroup = new Map(groups.map((g) => [g.displayName, g.values.map((v) => v.displayName).sort()]));
    expect(valuesByGroup.get('색상')).toEqual(['빨강', '파랑']);
    expect(valuesByGroup.get('사이즈')).toEqual(['S']);

    // ② 조합 2개가 만들어졌고, 각 variant 의 (그룹,값) 쌍으로 누가 누구인지 식별한다.
    const mappings = await db.run((trx) =>
      trx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(eq(productMasterVariants.versionId, draftVersionId)),
    );
    expect(mappings).toHaveLength(2);

    const variantIdByLabel = new Map<string, string>();
    for (const mapping of mappings) {
      const optionValues = await db.run((trx: DbTransaction) =>
        optionLoader.getVariantOptionValues(trx, mapping.variantId, draftVersionId, 'ko-KR'),
      );
      const label = optionValues
        .map((ov) => `${ov.optionGroupName}:${ov.displayName}`)
        .sort()
        .join('|');
      variantIdByLabel.set(label, mapping.variantId);
    }
    const redS = variantIdByLabel.get('사이즈:S|색상:빨강');
    const blueS = variantIdByLabel.get('사이즈:S|색상:파랑');
    expect(redS).toBeTruthy();
    expect(blueS).toBeTruthy();

    // ③ variantCode 가 **제 variant** 에 붙었다.
    const variantRows = await db.run((trx) =>
      trx
        .select({ id: productVariants.id, variantCode: productVariants.variantCode })
        .from(productVariants)
        .where(inArray(productVariants.id, [redS as string, blueS as string])),
    );
    const codeById = new Map(variantRows.map((r) => [r.id, r.variantCode]));
    expect(codeById.get(redS as string)).toBe('RED-S');
    expect(codeById.get(blueS as string)).toBe('BLUE-S');

    // ④ 조합별 판매가 룰이 **올바른 variantId** 를 가리킨다.
    const rules = await pricing.getVersionRules(draftVersionId);
    const overrides = rules.basePriceRules.filter((r) => r.scopeType === 'variants');
    const valueByVariantId = new Map(overrides.map((r) => [(r.scopeTargetIds ?? [])[0], r.operationValue]));
    expect(valueByVariantId.get(redS as string)).toBe(11000);
    expect(valueByVariantId.get(blueS as string)).toBe(12000);
    // all_variants 기본가도 그대로다.
    const allVariants = rules.basePriceRules.filter((r) => r.scopeType === 'all_variants');
    expect(allVariants).toHaveLength(1);
    expect(allVariants[0].operationValue).toBe(10000);
  });

  it('한 행이 실패해도 나머지 행이 draft 를 얻는다', async () => {
    // 2단계 검증기를 우회해 payload 를 직접 심는다 — 여기서 보려는 것은 "행 층 오류가
    // 슬라이스를 죽이지 않는가"이지 검증기의 커버리지가 아니다. 가운데 행의 name 을
    // varchar(255) 초과로 두면 Postgres 22001 이 **그 행의 트랜잭션에서만** 난다.
    const { sessionId, leaseToken } = await seedSession([
      { rowNumber: 1, kind: 'create', fields: { 'product.name': 'A', 'product.basePrice': '1000' } },
      { rowNumber: 2, kind: 'create', fields: { 'product.name': 'X'.repeat(300), 'product.basePrice': '1000' } },
      { rowNumber: 3, kind: 'create', fields: { 'product.name': 'C', 'product.basePrice': '1000' } },
    ]);

    await jobManager.runDraftSlice({ sessionId, leaseToken, phase: 'drafting' });

    const items = await readItems(sessionId);
    expect(items.map((i) => i.status)).toEqual(['drafted', 'failed', 'drafted']);
    expect(items[1].errorMessage).toBeTruthy();
    expect(items[1].draftVersionId).toBeNull();

    // 실패 행은 master 를 남기지 않아야 한다 — `draftOne` 이 apply() 와 상태갱신을 한
    // 트랜잭션에 묶는 이유가 이것이다(v3 의 고아 master **행**이 구조적으로 없다).
    // 범위 주의: DB 행까지다. `createMaster` 가 낸 Kafka 이벤트와 `product_matchings` 행은
    // 롤백돼도 남는다 — 스펙 §5.1 의 정정 블록 참조(이 브랜치의 회귀가 아니다).
    expect(items[1].masterId).toBeNull();

    // 성공한 두 행은 진짜 master + draft 를 얻었다.
    for (const index of [0, 2]) {
      expect(items[index].masterId).toBeTruthy();
      expect(items[index].draftVersionId).toBeTruthy();
      const draft = await readVersion(items[index].draftVersionId as string);
      expect(draft.status).toBe('draft');
      expect(draft.bulkSessionId).toBe(sessionId);
    }
    const first = await readVersion(items[0].draftVersionId as string);
    expect(first.name).toBe('A');

    // 이 세션이 잠근 draft 가 **정확히 2건**이라는 완결성 검사다. phantom master 를 실제로
    // 지는 단정은 위의 `items[1].masterId === null` 이고, 이 질의는 그것을 대신하지 못한다 —
    // `lockDraft` 가 `applyCreate` 의 마지막 단계라, 진짜 부분 커밋 고아라면 `bulk_session_id`
    // 가 NULL 이어서 이 WHERE 에 애초에 걸리지 않는다. 여기서 보는 것은 "성공한 행 수만큼만
    // 잠갔는가"(3건이면 실패 행이 draft 를 남겼다는 뜻)다.
    const lockedDrafts = await db.run((trx) =>
      trx
        .select({ id: productMasterVersions.id })
        .from(productMasterVersions)
        .where(and(eq(productMasterVersions.bulkSessionId, sessionId), eq(productMasterVersions.status, 'draft'))),
    );
    expect(lockedDrafts).toHaveLength(2);
  });
});
