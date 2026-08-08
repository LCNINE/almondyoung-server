import * as allStreams from './index';
import { CORE_ORDER_STREAM, ORDER_STREAM, PRODUCT_STREAM } from './index';
import { buildStreamRegistry, STREAM_REGISTRY, streamForTopic } from './registry';

/**
 * 레지스트리는 `streams/index.ts` 가 export 하는 스트림에서 **도출**된다.
 * 손으로 유지하는 두 번째 목록이 생기면 어긋나고, 어긋남이 무증상이면
 * 그 자리에 틀린 주석이 자란다 — ADR-0029 가 고치려는 실패 모드다.
 */
describe('STREAM_REGISTRY', () => {
  /**
   * 계약 표면의 스냅샷. 스트림을 추가/삭제하면 이 목록도 같이 고쳐야 한다 —
   * 토픽 집합의 변화는 리뷰에서 눈에 띄어야 하는 종류의 변화다.
   */
  const EXPECTED_TOPICS = [
    'carts.events.v1',
    'channel-adapter.events.v1',
    'core.orders.events.v1',
    'fulfillments.events.v1',
    'fulfillments.events.v2',
    'inventory.events.v1',
    'membership.events.v1',
    'orders.events.v1',
    'payments.events.v1',
    'products.events.v1',
    'shipments.events.v1',
    'ugc.commands.v1',
    'ugc.events.v1',
    'users.events.v1',
    'wallet.commands.v1',
  ];

  it('exposes exactly the topics declared by the contract package', () => {
    expect(Object.keys(STREAM_REGISTRY).sort()).toEqual(EXPECTED_TOPICS);
  });

  it('keys every stream by its own topic.topic', () => {
    for (const [topic, config] of Object.entries(STREAM_REGISTRY)) {
      expect(config.topic.topic).toBe(topic);
    }
  });

  it('holds the exported stream objects themselves, not copies', () => {
    expect(STREAM_REGISTRY['orders.events.v1']).toBe(ORDER_STREAM);
    expect(STREAM_REGISTRY['core.orders.events.v1']).toBe(CORE_ORDER_STREAM);
    expect(STREAM_REGISTRY['products.events.v1']).toBe(PRODUCT_STREAM);
  });

  it('skips exports that are not stream configs', () => {
    // `streams/index.ts` 는 스트림 말고도 이벤트명 상수·스키마·타입을 export 한다.
    expect(allStreams.ORDER_EVENTS).toBeDefined();
    expect(Object.values(STREAM_REGISTRY)).not.toContain(allStreams.ORDER_EVENTS);
  });
});

describe('streamForTopic', () => {
  it('resolves a registered topic to its stream config', () => {
    expect(streamForTopic('orders.events.v1')).toBe(ORDER_STREAM);
  });

  it('returns undefined for an unregistered topic', () => {
    expect(streamForTopic('analytics.events.v1')).toBeUndefined();
  });

  it('does not resolve Object.prototype members as streams', () => {
    // 토픽 문자열은 Task 3 에서 구독 메타데이터로부터 오므로 임의 문자열이 들어올 수 있다.
    expect(streamForTopic('constructor')).toBeUndefined();
    expect(streamForTopic('toString')).toBeUndefined();
  });
});

describe('buildStreamRegistry', () => {
  const streamNamed = (topic: string) => ({
    topic: { topic },
    aggregateType: 'Thing',
    events: {},
  });

  it('throws when two exported streams claim the same topic', () => {
    const source = {
      A_STREAM: streamNamed('things.events.v1'),
      B_STREAM: streamNamed('things.events.v1'),
    };

    expect(() => buildStreamRegistry(source)).toThrow(/things\.events\.v1/);
  });

  it('names both colliding exports so the duplicate is findable', () => {
    const source = {
      A_STREAM: streamNamed('things.events.v1'),
      B_STREAM: streamNamed('things.events.v1'),
    };

    expect(() => buildStreamRegistry(source)).toThrow(/A_STREAM.*B_STREAM|B_STREAM.*A_STREAM/);
  });

  it('ignores values that are not stream configs', () => {
    const source = {
      A_STREAM: streamNamed('things.events.v1'),
      THING_EVENTS: { Created: 'Created' },
      someHelper: () => 'noop',
      nothing: undefined,
    };

    expect(Object.keys(buildStreamRegistry(source))).toEqual(['things.events.v1']);
  });

  it('rejects a stream whose topic is an empty string', () => {
    expect(() => buildStreamRegistry({ A_STREAM: streamNamed('') })).toThrow(/A_STREAM/);
  });
});
