import { CarrierGatewayRegistry } from './carrier/carrier-gateway.registry';
import { buildCarrierGatewayRegistry, buildHanjinConfig } from './carrier/hanjin/carrier-gateway.factory';

// FulfillmentModule 은 EventsModule.forConsumerModule(SalesOrderModule 경유)을 정적으로 물고 있어, import 만
// 해도 KAFKA_BROKERS 연결을 시도한다(실측: 로컬에 브로커가 없으면 재시도를 반복하며 멈추지 않는다 — Task 12
// 조사 결과, hang 재현 확인). 그래서 WaybillModule/WaybillService 는 정적 import 로 파일 최상단에 두지 않고
// it() 안에서 동적 import 로만 불러온다 — DATABASE_URL 이 없어 describeIfDb 가 skip 되는 기본 테스트런에서는
// 이 동적 import 문 자체가 실행되지 않으므로, 이 스펙파일이 로드되는 것만으로 무거운 체인이 끌려들어오지
// 않는다(정적 import 였다면 skip 여부와 무관하게 모듈 로드 시점에 곧장 걸렸을 것 — 실측 확인됨).
// WaybillModule 자체는 FulfillmentCommandModule 만 import 하므로(무거운 FulfillmentModule 은 물지 않는다),
// 이 동적 import 경로로도 순환/Kafka 체인 없이 안전하게 로드된다.
//
// Task 14: DATABASE_URL 이 있으면(describeIfDb) 실제로 .compile() 해 WaybillModule 전체 provider 그래프
// (WaybillService → WaybillManager/WaybillReader/WaybillRepository/WaybillIssueMachine → FulfillmentCommandModule
// → FulfillmentCommandService, 그리고 WaybillController 의 ScopeGuard → AuthorizationModule)가 무순환·전량
// 해결되는지 검증한다. AppModule(apps/core/src/app.module.ts)과 동일한 순서로 ConfigModule → DbModule →
// AuthorizationModule 을 배선해야 한다:
//   - DbModule 없이는 FulfillmentCommandService 의 DbService 의존성이 미해결.
//   - AuthorizationModule(@Global) 없이는 WaybillController 의 `@UseGuards(ScopeGuard)` 가 요구하는
//     AuthorizationService 가 미해결(이 isolated TestingModule 에는 AppModule 이 어디서도 전역 등록해주지
//     않으므로 직접 등록해야 한다).
// AuthorizationModule.forRoot 의 AUTH_CONFIG 팩토리는 AUTH_SECRET(HS256) 또는 OIDC_ISSUER_URL 이 없으면
// 즉시 throw 하므로, 로컬/CI 에 시크릿이 없을 때를 대비해 더미 AUTH_SECRET 을 주입한다 — 이 스모크는 provider
// 그래프 해결만 검증하며 JWT 검증 로직 자체는 행사하지 않는다.
// `.compile()`은 onModuleInit 등 라이프사이클 훅을 실행하지 않는다(@nestjs/testing 은 constructor DI만
// 수행) — 따라서 ScopeBootstrapService.onModuleInit(scopes/role_scope_mapping 테이블에 대한 실제 DB write)
// 은 이 테스트에서 트리거되지 않고, `core` DB 에 그 테이블들이 없어도 안전하다(실측 확인됨).
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('WaybillModule DI', () => {
  jest.setTimeout(60_000);

  it('resolves WaybillService', async () => {
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? 'waybill-module-spec-test-secret';

    const { Test } = await import('@nestjs/testing');
    const { ConfigModule } = await import('@nestjs/config');
    const { DbModule } = await import('@app/db');
    const { AuthorizationModule } = await import('@app/authorization');
    const { mergedSchema } = await import('../../../platform/database/merged-schema');
    const { ALL_SCOPES } = await import('../../../platform/auth/merged-scopes');
    const { FULFILLMENT_ROLE_MAPPINGS } = await import('../../../platform/auth/fulfillment-scopes');
    const { WaybillModule } = await import('./waybill.module');
    const { WaybillService } = await import('./waybill.service');

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        DbModule.forRootAsync({
          // AppModule과 동일한 배선(configService.get('DATABASE_URL')). `configService` 파라미터는
          // DbModuleAsyncOptions<TSchema>['useFactory']: (configService: ConfigService) => DbConfig 로부터
          // contextual typing 되므로 명시적 타입 주석 없이도 ConfigService 로 추론된다 — 동적 import 로
          // 들여온 `ConfigService` 값을 타입으로만 재사용하면 @typescript-eslint/no-unused-vars 가 걸린다.
          useFactory: (configService) => ({
            connectionString: configService.get<string>('DATABASE_URL') ?? '',
          }),
          schema: mergedSchema,
        }),
        AuthorizationModule.forRoot({
          microserviceName: 'almondyoung',
          scopes: ALL_SCOPES,
          roleMappings: FULFILLMENT_ROLE_MAPPINGS,
        }),
        WaybillModule,
      ],
    }).compile();
    expect(moduleRef.get(WaybillService)).toBeInstanceOf(WaybillService);
    await moduleRef.close();
  });
});

// DATABASE_URL 유무와 무관하게 항상 실행: 캐리어 팩토리 자체의 배선(순수 함수, DB/Kafka 불필요)을 검증.
// (Task 12 DI 검증의 실질적인 게이트 — 위 describeIfDb 블록이 이 환경에서 skip 되는 것을 보완한다.)
describe('carrier gateway factory', () => {
  it('builds a registry with a HANJIN gateway from env-derived config', () => {
    const config = buildHanjinConfig();
    const registry = buildCarrierGatewayRegistry(config);
    expect(registry).toBeInstanceOf(CarrierGatewayRegistry);
    const gateway = registry.get('HANJIN');
    expect(gateway).toBeDefined();
    expect(gateway?.carrier).toBe('HANJIN');
    // isConfigured() 값은 env 설정 여부에 따라 달라진다(구성 완료/미완료 모두 유효) — 정의된 boolean 인지만 확인.
    expect(typeof gateway?.isConfigured()).toBe('boolean');
  });
});
