/**
 * 소비 집합 도출 (ADR-0029 §1·§3)
 *
 * 이 프로세스가 무엇을 소비하는지는 **선언하지 않는다** — `@On` 데코레이터가
 * 이미 authoritative 하기 때문이다. Nest 의 `ServerKafka.bindEvents()` 는
 * `subscribe.topics` 를 `[...this.messageHandlers.keys()]` 로 덮어쓰므로
 * (`server-kafka.js:92`), 실제 구독 집합은 컨테이너 안의 데코레이터가 결정한다.
 * 같은 사실을 따로 선언하면 두 벌이 생기고, 두 벌은 어긋나며, 어긋남이 무증상이면
 * 그 자리에 틀린 주석이 자란다 — 2026-08-08 아키텍처 리뷰의 오판이 그것이었다.
 *
 * 도출은 Nest 자신의 `ListenerMetadataExplorer` 로 한다. 흉내낸 스캐너를 쓰면
 * "우리가 도출한 집합"과 "Nest 가 바인딩하는 집합"이 다를 수 있고, 그 어긋남이
 * 정확히 이 모듈이 없애려는 종류의 무증상 결함이다.
 */

import type { INestApplicationContext } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, ModulesContainer } from '@nestjs/core';
import type { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import { ListenerMetadataExplorer } from '@nestjs/microservices/listener-metadata-explorer';
import type { StreamConfig } from '@packages/event-contracts/types';
import { streamForTopic } from '@packages/event-contracts/streams/registry';
import { EVENT_TYPE_FILTER } from './decorators';

/** 컨테이너에서 발견된 이벤트 핸들러 하나. */
export interface DiscoveredEventHandler {
  /** `@On` 이 계약에서 읽은 토픽 = Nest 의 등록 패턴 */
  topic: string;
  /** `@On` 의 두 번째 인자. 토픽 전체를 받는 핸들러면 undefined */
  eventType?: string;
  controller: string;
  methodName: string;
}

/** 발견된 핸들러들에서 파생된 소비 설정. */
export interface DerivedConsumerConfig {
  /** 구독 토픽 (중복 없음, 발견 순서) */
  topics: string[];
  /** 각 토픽의 계약 — 스키마 검증 맵과 토픽 부트스트랩이 이것으로 만들어진다 */
  streams: StreamConfig[];
  handlers: DiscoveredEventHandler[];
}

/**
 * `metatype` 이 있으면 그쪽을 쓴다 — request-scoped 컨트롤러는 정적 인스턴스가 없다.
 */
function controllerPrototype(wrapper: InstanceWrapper): object | undefined {
  const metatype: unknown = wrapper.metatype;
  if (typeof metatype === 'function') {
    // as 정당화: `InstanceWrapper.metatype` 은 `Type<any> | Function` 이라 prototype 이
    // 타입상 드러나지 않는다. 컨트롤러 metatype 은 정의상 클래스다.
    const prototype = (metatype as { prototype?: object }).prototype;
    if (prototype) return prototype;
  }
  if (wrapper.instance) return Object.getPrototypeOf(wrapper.instance) as object;
  return undefined;
}

/**
 * 컨테이너의 모든 컨트롤러에서 이벤트 핸들러를 훑는다.
 *
 * 컨트롤러만 본다 — Nest 도 그렇다 (`microservices-module.js` 의 `setupListeners` 는
 * `module.controllers` 만 순회한다). provider 에 `@On` 을 달면 지금도 아무 일이
 * 일어나지 않으며, 여기서도 발견되지 않는다.
 */
export function discoverEventHandlers(app: INestApplicationContext): DiscoveredEventHandler[] {
  const discovery = new DiscoveryService(app.get(ModulesContainer));
  const explorer = new ListenerMetadataExplorer(new MetadataScanner());
  const handlers: DiscoveredEventHandler[] = [];

  for (const wrapper of discovery.getControllers()) {
    const prototype = controllerPrototype(wrapper);
    if (!prototype) continue;

    // `explore()` 는 인스턴스에서 프로토타입을 되짚는다. 프로토타입만 가진 경우를
    // 위해 빈 껍데기를 씌운다 — 메서드 조회는 프로토타입 체인을 그대로 탄다.
    const probe = Object.create(prototype) as object;

    for (const definition of explorer.explore(probe)) {
      if (!definition.isEventHandler) continue;

      const eventType: unknown = Reflect.getMetadata(EVENT_TYPE_FILTER, definition.targetCallback);
      const controller = String(wrapper.name ?? prototype.constructor?.name ?? 'UnknownController');

      for (const pattern of definition.patterns ?? []) {
        if (typeof pattern !== 'string' || pattern.length === 0) {
          throw new Error(
            `startConsumer(): ${controller}.${definition.methodKey} 의 이벤트 패턴이 토픽 문자열이 아니다 ` +
              `(${JSON.stringify(pattern)}). @On 은 계약에서 토픽 문자열을 읽는다.`,
          );
        }

        handlers.push({
          topic: pattern,
          eventType: typeof eventType === 'string' ? eventType : undefined,
          controller,
          methodName: definition.methodKey,
        });
      }
    }
  }

  return handlers;
}

/**
 * 발견된 핸들러에서 구독 토픽 · 계약 목록을 파생한다.
 *
 * 두 가지를 부팅에서 거부한다. 둘 다 지금은 완전 무증상인 실수다:
 * - 핸들러 0개 — 컨슈머 컨트롤러를 `controllers: []` 에 등록하지 않은 경우
 * - 계약 레지스트리에 없는 토픽 — 오타이거나 계약 미등록
 */
export function deriveConsumerConfig(handlers: DiscoveredEventHandler[]): DerivedConsumerConfig {
  if (handlers.length === 0) {
    throw new Error(
      'startConsumer(): @On 핸들러가 하나도 발견되지 않았다. ' +
        '컨슈머 컨트롤러를 모듈의 `controllers: []` 에 등록했는지 확인하라 — ' +
        '등록 누락은 이 시스템에서 가장 조용한 실수였다 (ADR-0029).',
    );
  }

  const streams = new Map<string, StreamConfig>();
  const unregistered = new Map<string, DiscoveredEventHandler>();

  for (const handler of handlers) {
    if (streams.has(handler.topic) || unregistered.has(handler.topic)) continue;

    const config = streamForTopic(handler.topic);
    if (config) {
      streams.set(handler.topic, config);
    } else {
      unregistered.set(handler.topic, handler);
    }
  }

  if (unregistered.size > 0) {
    const detail = [...unregistered.values()]
      .map((handler) => `  - ${handler.topic}  (${handler.controller}.${handler.methodName})`)
      .join('\n');
    throw new Error(
      `startConsumer(): 계약 레지스트리에 없는 토픽을 구독하려 한다.\n${detail}\n` +
        'packages/event-contracts/streams 에 스트림을 추가하고 streams/index.ts 에서 export 하라.',
    );
  }

  return {
    topics: [...streams.keys()],
    streams: [...streams.values()],
    handlers,
  };
}
