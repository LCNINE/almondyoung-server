import { MODULE_METADATA } from '@nestjs/common/constants';
import { INTERNAL_KEY_ENV } from '@app/authorization';

/**
 * `@InternalOnly()` 의 `InternalKeyGuard` 는 «그 컨트롤러가 속한 모듈»에서 `INTERNAL_KEY_ENV` 를 주입받는다.
 * 빠지면 컨트롤러 단위 스펙은 통과하는데 core 가 부팅 중 `UnknownDependenciesException` 으로 죽는다(#1016 45번 로컬 E2E 에서 발견).
 */
describe('SalesOrderModule 내부 키', () => {
  it('내부 컨트롤러를 두는 모듈이 INTERNAL_KEY_ENV = CORE_INTERNAL_KEY 를 제공한다', () => {
    // 모듈 데코레이터가 평가 시점에 `EventsModule.forApp` 으로 브로커 주소를 읽는다 — 접속은 하지 않는다
    process.env.KAFKA_BROKERS ??= 'localhost:9092';
    /* eslint-disable @typescript-eslint/no-require-imports -- env 를 먼저 채운 뒤 모듈을 평가해야 한다 */
    const { SalesOrderModule } = require('../sales-order.module') as typeof import('../sales-order.module');
    const { SalesOrdersInternalController } =
      require('./sales-orders-internal.controller') as typeof import('./sales-orders-internal.controller');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const controllers: unknown[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, SalesOrderModule) ?? [];
    const providers: unknown[] = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, SalesOrderModule) ?? [];
    expect(controllers).toContain(SalesOrdersInternalController);
    expect(providers).toContainEqual({ provide: INTERNAL_KEY_ENV, useValue: 'CORE_INTERNAL_KEY' });
  });
});
