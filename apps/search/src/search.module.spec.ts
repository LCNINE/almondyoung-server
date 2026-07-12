/**
 * #510 회귀 가드: SearchModule 이 EventsModule.forConsumerModule 을 통해
 * 전역 EventRetryInterceptor(재시도/DLQ/offset commit)를 실제로 등록하는지 봉인한다.
 *
 * SearchModule 의 imports 는 process.env.KAFKA_BROKERS 조건부(channel-adapter 판례)이므로
 * 브로커를 설정/해제한 뒤 모듈을 fresh 로 로드한다(resetModules + 동적 import). 컨테이너를
 * compile 하지 않고 @Module 메타데이터('imports')만 정적 검사하므로 OpenSearch/Kafka 등
 * 라이브 인프라가 불필요하다. (동적 import 는 @Module 데코레이터 인자만 평가할 뿐 provider 를
 * 인스턴스화하지 않는다.)
 */
import 'reflect-metadata';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { EventRetryInterceptor } from '@app/events';

// resetModules 후 동적 import 된 search.module 은 @app/events 의 fresh 복사본을 끌어오므로,
// 그 안의 EventRetryInterceptor 는 위 import 와 다른 클래스 참조다. 따라서 참조(===)가 아닌
// 클래스 이름으로 비교한다. (APP_INTERCEPTOR 는 문자열 토큰이라 모듈 중복과 무관.)
const RETRY_INTERCEPTOR_NAME = EventRetryInterceptor.name;

type AppInterceptorProvider = { provide?: unknown; useClass?: unknown };
type DynamicModuleLike = { providers?: AppInterceptorProvider[] };

async function loadSearchModuleImports(): Promise<unknown[]> {
  jest.resetModules();
  const mod = await import('./search.module');
  return (Reflect.getMetadata('imports', mod.SearchModule) ?? []) as unknown[];
}

function isDynamicModuleWithProviders(m: unknown): m is DynamicModuleLike {
  return typeof m === 'object' && m !== null && Array.isArray((m as DynamicModuleLike).providers);
}

function registersInterceptorNamed(imports: unknown[], name: string): boolean {
  return imports
    .filter(isDynamicModuleWithProviders)
    .some((m) =>
      m.providers!.some(
        (p) =>
          p.provide === APP_INTERCEPTOR &&
          typeof p.useClass === 'function' &&
          (p.useClass as { name?: string }).name === name,
      ),
    );
}

function registersAnyAppInterceptor(imports: unknown[]): boolean {
  return imports
    .filter(isDynamicModuleWithProviders)
    .some((m) => m.providers!.some((p) => p.provide === APP_INTERCEPTOR));
}

describe('SearchModule 이벤트 재시도/DLQ 배선 (#510)', () => {
  const ORIGINAL = process.env.KAFKA_BROKERS;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.KAFKA_BROKERS;
    else process.env.KAFKA_BROKERS = ORIGINAL;
  });

  it('KAFKA_BROKERS 설정 시 EventRetryInterceptor 를 전역 APP_INTERCEPTOR 로 등록한다', async () => {
    process.env.KAFKA_BROKERS = 'localhost:9092';

    const imports = await loadSearchModuleImports();

    expect(registersInterceptorNamed(imports, RETRY_INTERCEPTOR_NAME)).toBe(true);
  });

  it('KAFKA_BROKERS 미설정 시 전역 인터셉터를 등록하지 않는다 (graceful degradation 보존)', async () => {
    delete process.env.KAFKA_BROKERS;

    const imports = await loadSearchModuleImports();

    expect(registersAnyAppInterceptor(imports)).toBe(false);
  });
});
