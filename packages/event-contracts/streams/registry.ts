/**
 * Stream Registry — `topic → StreamConfig`
 *
 * 소비 측이 토픽 문자열만 갖고 계약(스키마·이벤트 목록·aggregateType)에 도달할 수 있게 한다.
 * 이 레지스트리는 손으로 유지하는 목록이 아니라 `streams/index.ts` 의 export 에서 **도출**된다 —
 * 도출 가능한 사실을 선언으로 받으면 두 벌이 생기고, 두 벌은 어긋나며, 어긋남이 무증상이면
 * 그 자리에 틀린 주석이 자란다 (ADR-0029 §1·§3).
 *
 * ⚠️ 이 파일은 `streams/index.ts` 에서 re-export 하지 않는다. 그러면 순환 import 가 되어
 *    모듈 초기화 순서에 따라 레지스트리가 빈 채로 굳는다. 공개 표면은 패키지 루트
 *    `packages/event-contracts/index.ts` 하나뿐이다.
 */

import type { StreamConfig } from '../types/stream-config.types';
import * as streamExports from './index';

/**
 * `streams/index.ts` 는 스트림 말고도 이벤트명 상수(`ORDER_EVENTS` 등)·zod 스키마·헬퍼를
 * 함께 export 한다. 그중 스트림만 골라낸다.
 */
function isStreamConfig(value: unknown): value is StreamConfig {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Partial<StreamConfig>;
  if (typeof candidate.aggregateType !== 'string') return false;
  if (typeof candidate.events !== 'object' || candidate.events === null) return false;
  if (typeof candidate.topic !== 'object' || candidate.topic === null) return false;

  return typeof candidate.topic.topic === 'string';
}

/**
 * export 묶음에서 `topic → StreamConfig` 맵을 만든다.
 *
 * 토픽이 비었거나 두 스트림이 같은 토픽을 주장하면 **모듈 로드 시점에** 던진다.
 * 둘 다 라우팅을 조용히 깨뜨리는 계약 버그라서, 부팅에서 죽는 편이 낫다.
 *
 * @param source `streams/index.ts` 의 namespace 또는 그와 같은 모양의 객체
 */
export function buildStreamRegistry(source: object): Record<string, StreamConfig> {
  // null-prototype: 임의의 토픽 문자열이 `constructor` 같은 상속 멤버로 해석되지 않게 한다.
  // `Object.create` 의 반환 타입이 `any` 라서 캐스팅이 불가피하다 — 만드는 쪽이 모양을 온전히 알고 있다.
  const registry = Object.create(null) as Record<string, StreamConfig>;
  const exportNameByTopic = new Map<string, string>();

  for (const [exportName, value] of Object.entries(source)) {
    if (!isStreamConfig(value)) continue;

    const topic = value.topic.topic;
    if (topic.length === 0) {
      throw new Error(`Stream registry: ${exportName} has an empty topic.`);
    }

    const previous = exportNameByTopic.get(topic);
    if (previous !== undefined) {
      throw new Error(`Stream registry: duplicate topic "${topic}" declared by ${previous} and ${exportName}.`);
    }

    exportNameByTopic.set(topic, exportName);
    registry[topic] = value;
  }

  return registry;
}

/**
 * 이 계약 패키지가 아는 모든 스트림. 키는 Kafka 토픽 문자열이다.
 */
export const STREAM_REGISTRY: Readonly<Record<string, StreamConfig>> = buildStreamRegistry(streamExports);

/**
 * 토픽 문자열로 계약을 찾는다. 등록되지 않은 토픽이면 `undefined`.
 */
export function streamForTopic(topic: string): StreamConfig | undefined {
  return STREAM_REGISTRY[topic];
}
