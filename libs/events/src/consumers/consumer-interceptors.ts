/**
 * 소비 경로 인터셉터 배선 (ADR-0029 §8)
 *
 * 이 인터셉터들은 `forRoot`/`forConsumerModule` 에서 `APP_INTERCEPTOR` 로도 등록되지만,
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
import { Reflector } from '@nestjs/core';
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
 * 마이크로서비스 스코프 전역 인터셉터를 만든다.
 *
 * **배열 순서 = 래핑 순서.** 재시도·분류·DLQ 가 최외곽이어야 안쪽에서 나온
 * `SchemaValidationError` 도 분류망에 걸린다 (`events.module.ts` 의 APP_INTERCEPTOR
 * 등록 순서와 같은 이유·같은 순서).
 *
 * @param streams `@OnEvent` 에서 **도출된** 스트림 목록 — 검증 스키마 맵이 된다
 */
export function buildConsumerInterceptors(app: INestApplicationContext, streams: StreamConfig[]): NestInterceptor[] {
  const reflector = app.get(Reflector, { strict: false });
  const policy = optionalGet<EventsConsumerPolicy>(app, EVENTS_CONSUMER_POLICY);

  const interceptors: NestInterceptor[] = [
    new EventRetryInterceptor(reflector, optionalGet(app, DLQHandler)),
    new SchemaValidationInterceptor(reflector, streams, policy?.validation),
  ];

  const eventChainService = optionalGet(app, EventChainService);
  if (eventChainService) {
    interceptors.push(new ChainContextInterceptor(eventChainService));
  }

  return interceptors;
}
