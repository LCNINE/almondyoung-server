import { CarrierGatewayRegistry } from './carrier/carrier-gateway.registry';
import { buildCarrierGatewayRegistry, buildHanjinConfig } from './carrier/hanjin/carrier-gateway.factory';

// FulfillmentModule 은 EventsModule.forConsumerModule(SalesOrderModule 경유)을 정적으로 물고 있어, import 만
// 해도 KAFKA_BROKERS 연결을 시도한다(실측: 로컬에 브로커가 없으면 재시도를 반복하며 멈추지 않는다 — Task 12
// 조사 결과, hang 재현 확인). 그래서 WaybillModule/WaybillService 는 정적 import 로 파일 최상단에 두지 않고
// it() 안에서 동적 import 로만 불러온다 — DATABASE_URL 이 없어 describeIfDb 가 skip 되는 기본 테스트런에서는
// 이 동적 import 문 자체가 실행되지 않으므로, 이 스펙파일이 로드되는 것만으로 무거운 체인이 끌려들어오지
// 않는다(정적 import 였다면 skip 여부와 무관하게 모듈 로드 시점에 곧장 걸렸을 것 — 실측 확인됨).
//
// 전체 DI(.compile()) 자체는 이 환경에서 실행 불가로 판정 — 브리프의 "환경적 한계면 강행하지 말 것" 경로를
// 택함: (a) 캐리어 팩토리를 직접 단위테스트(항상 실행) + (b) nest build core 로 그래프 전체 컴파일을 검증.
// 근거는 task-12-report.md 참고.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('WaybillModule DI', () => {
  jest.setTimeout(60_000);

  it('resolves WaybillService', async () => {
    const { Test } = await import('@nestjs/testing');
    const { ConfigModule } = await import('@nestjs/config');
    const { WaybillModule } = await import('./waybill.module');
    const { WaybillService } = await import('./waybill.service');

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), WaybillModule],
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
