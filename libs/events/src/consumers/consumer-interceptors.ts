/**
 * 소비 경로 인터셉터 배선 (ADR-0029 §8)
 *
 * `EventRetryInterceptor` 는 `forApp` 에서 `APP_INTERCEPTOR` 로도 등록되지만,
 * **하이브리드 앱에서는 그 등록이 소비 경로에 닿지 않는다.** `app.connectMicroservice(opts)`
 * 를 두 번째 인자 없이 부르면 Nest 가 마이크로서비스에 **새 `ApplicationConfig`** 를
 * 만들어 주기 때문이다 (`nest-application.js:128`). 그래서 `startConsumer` 는 마이크로서비스
 * 자신의 config 에 인스턴스를 직접 얹는다 — 앱의 HTTP 전역 파이프·필터·가드는 건드리지 않고
 * 이벤트 인터셉터만 붙는다.
 *
 * `useGlobalInterceptors` 는 클래스가 아니라 인스턴스를 받으므로 여기서 생성한다.
 * 생성자 인자는 컨테이너에서 가져오되, 없을 수 있는 것(DLQ 비활성 등)은 optional 로 다룬다.
 */

import type { INestApplicationContext, NestInterceptor, Type } from '@nestjs/common';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { ClsInterceptor } from 'nestjs-cls';
import type { SchemaValidationOptions, StreamConfig } from '@packages/event-contracts/types';
import { DLQHandler } from '../dlq/dlq-handler.service';
import { ChainContextInterceptor } from '../interceptors/chain-context.interceptor';
import { EventRetryInterceptor } from '../interceptors/event-retry.interceptor';
import { SchemaValidationInterceptor } from '../interceptors/schema-validation.interceptor';
import { EventChainService } from '../tracking/event-chain.service';

/**
 * 앱이 선언한 소비 정책. **스트림 목록은 여기 없다** — 그건 데코레이터에서 도출된다.
 * 정책(검증을 켤지, 에러를 던질지)은 코드에서 도출할 수 없으므로 선언이 맞다 (ADR-0029 §1).
 */
export const EVENTS_CONSUMER_POLICY = 'EVENTS_CONSUMER_POLICY';

export interface EventsConsumerPolicy {
  validation?: SchemaValidationOptions;
}

/**
 * 컨테이너에 없을 수도 있는 provider 조회.
 *
 * Nest 11 의 `get()` 은 `optional` 옵션이 없고 못 찾으면 던진다. 던지는 조건이
 * "등록되지 않음" 하나뿐이므로 catch 로 흡수한다.
 */
function optionalGet<T>(app: INestApplicationContext, token: Type<T> | string): T | undefined {
  try {
    return app.get<T>(token, { strict: false });
  } catch {
    return undefined;
  }
}

/**
 * 소비 정책이 두 곳 이상에서 선언됐으면 부팅을 거부한다.
 *
 * `forApp` 은 BC 별로 여러 번 불릴 수 있고(core 는 4번), 그중 둘이 `policy` 를 선언하면
 * `optionalGet` 은 **아무 경고 없이 하나만** 돌려준다. 어느 것이 이기는지는 모듈 등록
 * 순서에 달렸고, 두 선언이 `validateOnConsume` 에서 갈리면 그 순간 검증이 켜지거나
 * 꺼진다 — 증상 없는 결함이다. 그래서 세어서 거부한다.
 *
 * 0개는 정상이다(기본값 `validateOnConsume: true` 로 떨어진다).
 */
export function assertSinglePolicyDeclaration(app: INestApplicationContext): void {
  const container = app.get(ModulesContainer, { strict: false });
  const declarations: unknown[] = [];

  for (const module of container.values()) {
    const wrapper = module.providers.get(EVENTS_CONSUMER_POLICY);
    if (wrapper) declarations.push(wrapper.instance ?? wrapper.metatype);
  }

  if (declarations.length > 1) {
    throw new Error(
      `startConsumer(): 소비 정책(EVENTS_CONSUMER_POLICY)이 ${declarations.length}곳에서 선언됐다 — ` +
        '`forApp({ policy })` 는 앱 전체에 하나여야 한다. 어느 선언이 이기는지는 모듈 등록 ' +
        '순서에 달려 있어 조용히 갈린다.\n' +
        declarations.map((declaration) => `  - ${JSON.stringify(declaration)}`).join('\n'),
    );
  }
}

/**
 * 마이크로서비스 스코프 전역 인터셉터를 만든다.
 *
 * **배열 순서 = 래핑 순서.** 재시도·분류·DLQ 가 최외곽이어야 안쪽에서 나온
 * `SchemaValidationError` 도 분류망에 걸린다 (`events.module.ts` 의 APP_INTERCEPTOR
 * 등록 순서와 같은 이유·같은 순서).
 *
 * @param streams `@On` 에서 **도출된** 스트림 목록 — 검증 스키마 맵이 된다
 */
export function buildConsumerInterceptors(app: INestApplicationContext, streams: StreamConfig[]): NestInterceptor[] {
  const reflector = app.get(Reflector, { strict: false });
  assertSinglePolicyDeclaration(app);
  const policy = optionalGet<EventsConsumerPolicy>(app, EVENTS_CONSUMER_POLICY);

  const interceptors: NestInterceptor[] = [
    // **최외곽 — CLS 컨텍스트를 연다 (#612).** 소비 경로에는 ClsGuard/ClsInterceptor 가 없어
    // CLS 가 아예 열리지 않았고, 그래서 `ChainContextInterceptor` 의 `setChainId` 가
    // "No CLS context available" 로 던지며 그 안의 `catch` 에 삼켜졌다 — 완전 무증상이었다.
    //
    // 라이브러리 구현을 쓰는 이유: `cls.run(() => next.handle())` 은 **동작하지 않는다.**
    // Observable 은 구독 시점에 실행되므로 핸들러가 도는 시점엔 `run` 콜백이 이미 반환된
    // 뒤다. `ClsInterceptor` 는 `new Observable(sub => cls.runWith(store, () =>
    // next.handle().subscribe(sub)))` 로 그 함정을 이미 풀어놨다.
    //
    // `ClsGuard` 는 대안이 아니다 — 그 구현은 `cls.enterWith()` 이고, 이는 컨텍스트를 현재
    // async resource 의 남은 수명 전체에 눌러쓰므로 장수 컨슈머 루프에서 메시지 간 store 가
    // 샐 수 있다.
    //
    // 최외곽인 이유: 재시도·DLQ·스키마 검증까지 전부 같은 사슬 컨텍스트 안에서 돌아야
    // DLQ 로 나가는 메시지도 인바운드 사슬을 물고 나간다. 에러는 그대로 통과시키므로
    // (`error: (err) => subscriber.error(err)`) 아래 재시도·분류망의 순서 의미는 그대로다.
    new ClsInterceptor({ saveCtx: false, resolveProxyProviders: false }),
    new EventRetryInterceptor(reflector, optionalGet(app, DLQHandler)),
    new SchemaValidationInterceptor(reflector, streams, policy?.validation),
  ];

  const eventChainService = optionalGet(app, EventChainService);
  if (eventChainService) {
    interceptors.push(new ChainContextInterceptor(eventChainService));
  }

  return interceptors;
}
