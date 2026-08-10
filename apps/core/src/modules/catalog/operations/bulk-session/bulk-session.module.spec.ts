// jest moduleNameMapper 는 `@packages/event-contracts/(.*)$` 서브패스만 매핑한다 — bare
// `@packages/event-contracts` (catalog.module.ts 가 PRODUCT_STREAM 을 이렇게 임포트한다) 는
// 안 걸려 jest 환경에서 module-not-found 로 죽는다. product-import.manager.spec.ts /
// product-import-job.manager.spec.ts 와 동일한 우회.
jest.mock(
  '@packages/event-contracts',
  () => ({ PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' } }),
  { virtual: true },
);

// 타입체크는 provider export 누락을 못 잡는다(BulkSessionModule 이 ProductsModule 을
// import 해도 그 module 이 어떤 provider 를 실제로 export 하는지는 컴파일 타임에 안 걸린다
// — DI 는 런타임 리플렉션이다). 그래서 실제로 Nest 컨테이너를 컴파일해 provider 그래프가
// 해석되는지 검증한다. WaybillModule DI 스모크(waybill.module.spec.ts)와 같은 패턴으로,
// 무거운 CatalogModule 을 스킵 여부와 무관하게 정적 import 하면 모듈 로드 시점에 곧장
// 끌려들어오므로 동적 import 로만 불러온다.
//
// `.compile()`은 constructor DI 만 수행하고 onModuleInit 같은 라이프사이클 훅은 실행하지
// 않는다(@nestjs/testing 의 문서화된 동작) — 그래서 DB 커넥션/쓰기는 이 스모크에서 안
// 일어난다.
//
// 필요한 건 DB 뿐이고 Kafka 브로커는 필요 없다: CatalogModule 이 정적으로 문
// EventsModule.forApp({enableOutbox:true}) 는 `providers` 배열에 "토픽을 만드는" async
// useFactory 를 등록해두지만(일반 provider 라 constructor DI 범주 안 — `.compile()` 이
// resolve 함), bootstrapKafkaTopics()(libs/events/src/bootstrap/topic-bootstrap.service.ts)
// 는 KAFKA_BOOTSTRAP_TOPICS=false 면 admin.connect() 조차 시도하지 않고 곧장 리턴한다.
// (참고로 이 플래그 없이 브로커가 죽어있어도 실패하진 않는다 — connect/createTopics 를
// try/catch 로 감싸 절대 rethrow 하지 않기 때문. 다만 kafkajs 의 bounded retry backoff
// 만큼 느려진다 — 이 스위트에서 실측 11초→1.2초.) StreamPublisher/OutboxPublisher/
// KAFKA_CLIENT/GracefulShutdownService 는 이 플래그와 무관하게 평소대로 constructor DI 로
// 생성되므로, 우리가 증명하려는 것(ProductVersionReadLoader 4종 의존성이 실제로
// resolve 되는지)은 그대로 검증된다 — 스킵되는 건 순수 네트워크 호출 하나뿐이다.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('BulkSessionModule DI', () => {
  jest.setTimeout(60_000);

  it('CatalogModule 안에서 FormExportService/FormExportSnapshotReader 를 해석한다', async () => {
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? 'bulk-session-module-spec-test-secret';
    // CatalogModule 이 EventsModule.forApp({enableOutbox:true}) 를 정적으로 물고 있어
    // 없으면 kafkajs 설정 생성 자체가 던진다 — 실제 브로커에 붙지는 않으므로 값 자체는
    // 아무 host:port 나 상관없다.
    process.env.KAFKA_BROKERS = process.env.KAFKA_BROKERS ?? 'localhost:9092';
    // 토픽 부트스트랩(admin.connect + createTopics)을 꺼서 이 스위트가 Kafka 브로커
    // 유무와 무관하게 빠르게 끝나도록 한다 — 위 헤더 코멘트 참조.
    process.env.KAFKA_BOOTSTRAP_TOPICS = process.env.KAFKA_BOOTSTRAP_TOPICS ?? 'false';
    // FulfillmentWorkflowGate(ProductsModule → ProductSellableQuantityModule 경유)가 부팅
    // 시 이 값을 강제한다 — 'legacy' 는 V1 outbound 경로와 함께 Task 25 에서 제거됐다.
    process.env.FULFILLMENT_WORKFLOW_MODE = process.env.FULFILLMENT_WORKFLOW_MODE ?? 'maintenance';

    const { Test } = await import('@nestjs/testing');
    const { ConfigModule } = await import('@nestjs/config');
    const { DbModule } = await import('@app/db');
    const { AuthorizationModule } = await import('@app/authorization');
    const { mergedSchema } = await import('../../../../platform/database/merged-schema');
    const { ALL_SCOPES, ALL_ROLE_MAPPINGS } = await import('../../../../platform/auth/merged-scopes');
    const { CatalogModule } = await import('../../catalog.module');
    const { FormExportService } = await import('./services/form-export.service');
    const { FormExportSnapshotReader } = await import('./services/form-export.snapshot.reader');
    const { FormExportJobManager } = await import('./services/form-export-job.manager');
    const { FormExportJobWorker } = await import('./services/form-export-job.worker');
    const { BulkSessionService } = await import('./services/bulk-session.service');
    const { BulkSessionManager } = await import('./services/bulk-session.manager');
    const { BulkSessionJobManager } = await import('./services/bulk-session-job.manager');
    const { BulkSessionJobWorker } = await import('./services/bulk-session-job.worker');
    const { BulkImageManager } = await import('./services/bulk-image.manager');
    const { BulkImageCleaner } = await import('./services/bulk-image.cleaner');
    const { BulkDraftApplier } = await import('./services/bulk-draft.applier');
    const { BulkVariantCodeChecker } = await import('./services/bulk-variant-code.checker');
    const { BulkSessionCleaner } = await import('./services/bulk-session.cleaner');

    const moduleRef = await Test.createTestingModule({
      imports: [
        // AppModule(apps/core/src/app.module.ts)과 동일한 순서로 배선한다: ConfigModule →
        // DbModule → AuthorizationModule → CatalogModule. DbModule 없이는 FormExportManager
        // 의 DbService 의존성이 미해결이고, AuthorizationModule(@Global) 없이는 CatalogModule
        // 하위 컨트롤러가 요구하는 인증 관련 provider 가 미해결이다.
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

    // FormExportService 는 BulkSessionModule 의 export 목록에 있어 strict 조회로도 잡힌다.
    expect(moduleRef.get(FormExportService)).toBeInstanceOf(FormExportService);
    // FormExportSnapshotReader 는 export 되지 않은 내부 provider라 { strict: false } 로 컨테이너
    // 전체에서 찾는다 — 이게 바로 ProductVersionReadLoader/OptionReadLoader/PricingService/
    // ProductCategoriesService 4개 의존성이 실제로 해석됐는지 증명하는 지점이다
    // (ProductsModule 이 ProductVersionReadLoader 를 export 하지 않았다면 여기서 부팅이 깨진다).
    expect(moduleRef.get(FormExportSnapshotReader, { strict: false })).toBeInstanceOf(FormExportSnapshotReader);
    // 앞선 커밋(양식 조립 워커) 산출물. FormExportJobWorker 의 생성자가 FormExportJobManager
    // 를 받으므로, 이게 해석된다는 건 그 매니저의 DbService<PimSchema>/FormExportSnapshotReader/
    // FormExportFileClient/ConfigService 4개 의존성도 함께 실제로 해석됐다는 뜻이다.
    expect(moduleRef.get(FormExportJobManager, { strict: false })).toBeInstanceOf(FormExportJobManager);
    expect(moduleRef.get(FormExportJobWorker, { strict: false })).toBeInstanceOf(FormExportJobWorker);

    // 업로드 접수 경로(POST /product-bulk-sessions) 산출물. BulkSessionService 는
    // BulkSessionModule 의 export 목록에 없으므로 strict 조회로는 안 잡힌다 —
    // { strict: false } 로 컨테이너 전체에서 찾는다. BulkSessionManager 가 해석된다는 건
    // 그 생성자가 받는 DbService<PimSchema>/FormExportFileClient/BulkSessionReader/
    // ProductVersionsService/ProductMastersService 5개 의존성도 함께 실제로 해석됐다는
    // 뜻이다(5단계 Task 6 이 정리·발행 경로를 붙이며 3개가 늘었다).
    expect(moduleRef.get(BulkSessionService, { strict: false })).toBeInstanceOf(BulkSessionService);
    expect(moduleRef.get(BulkSessionManager, { strict: false })).toBeInstanceOf(BulkSessionManager);

    // 검증 레인. BulkSessionJobWorker 의 생성자가 BulkSessionJobManager 를 받으므로, 이게
    // 해석된다는 건 그 매니저의 DbService<PimSchema>/FormExportFileClient/
    // FormExportSnapshotReader/ProductCategoriesService/BulkDraftApplier/ProductVersionsService/
    // ConfigService/BulkVariantCodeChecker 8개 의존성도 함께 실제로 해석됐다는 뜻이다 —
    // ProductCategoriesService 는 CategoriesModule 이 export 해야만 잡히므로 여기서만 걸리는
    // 종류의 배선 오류다. (Task 11) BulkVariantCodeChecker 가 새 의존성이다 — 등록을
    // 빠뜨리면 여기서 UnknownDependenciesException 으로 곧장 드러난다.
    expect(moduleRef.get(BulkSessionJobManager, { strict: false })).toBeInstanceOf(BulkSessionJobManager);
    expect(moduleRef.get(BulkSessionJobWorker, { strict: false })).toBeInstanceOf(BulkSessionJobWorker);
    // BulkVariantCodeChecker 자체도 따로 확인한다 — 자기 의존성은 DbService<PimSchema>
    // 하나뿐이지만, BulkSessionJobManager 를 통한 간접 해석과 별개로 단독 해석도 보장한다.
    expect(moduleRef.get(BulkVariantCodeChecker, { strict: false })).toBeInstanceOf(BulkVariantCodeChecker);

    // 3단계 이미지 경로. BulkImageManager 가 해석된다는 건 그 생성자가 받는
    // DbService<PimSchema>/FormExportFileClient/BulkSessionReader 3개 의존성도 함께 실제로
    // 해석됐다는 뜻이다 — 특히 BulkSessionReader 는 2단계까지 BulkSessionManager 만 쓰던
    // provider 라, 새 소비자가 붙는 순간 등록 누락이 여기서만 드러난다.
    expect(moduleRef.get(BulkImageManager, { strict: false })).toBeInstanceOf(BulkImageManager);

    // 정리 스윕. @Cron 은 provider 로 등록돼야 ScheduleExplorer 가 마운트한다 —
    // 등록을 빠뜨리면 타입도 테스트도 초록인 채 **크론이 영영 안 돈다**.
    expect(moduleRef.get(BulkImageCleaner, { strict: false })).toBeInstanceOf(BulkImageCleaner);

    // 타입체크는 provider export 누락을 못 잡는다 — DI 는 런타임 리플렉션이다.
    // BulkDraftApplier 는 ProductMastersService·ProductVersionsService·ProductVariantsService·
    // OptionReadLoader·PricingService·ProductPurchaseConstraintsService 여섯을 주입받는데,
    // 앞의 넷은 ProductsModule 이, PricingService 는 PricingModule 이 export 한다
    // (products.module.ts:41-56, pricing.module.ts:12) — 실측으로 확인된 사실이지만
    // 그 export 목록이 바뀌면 이 스모크가 먼저 빨개져야 한다.
    expect(moduleRef.get(BulkDraftApplier, { strict: false })).toBeDefined();

    // 5단계 정리 스윕(Task 7/9). BulkSessionCleaner 가 해석된다는 건 그 생성자가 받는
    // DbService<PimSchema>/FormExportFileClient/ConfigService 3개 의존성도 함께 실제로
    // 해석됐다는 뜻이다. @Cron 은 provider 로 등록돼야 ScheduleExplorer 가 마운트한다 —
    // 등록을 빠뜨리면 타입도 테스트도 초록인 채 워크북이 영영 안 지워진다.
    expect(moduleRef.get(BulkSessionCleaner, { strict: false })).toBeInstanceOf(BulkSessionCleaner);

    await moduleRef.close();
  });
});
