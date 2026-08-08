import * as contracts from '../index';
import { ORDER_STREAM } from './index';
import { STREAM_REGISTRY, streamForTopic } from './registry';

/**
 * 소비자(`libs/events`, 각 앱)는 `@packages/event-contracts` 루트로만 import 한다.
 * 레지스트리가 그 표면에 없으면 존재해도 닿을 수 없다.
 *
 * 이 스펙은 순환 import 회귀도 잡는다: 루트 index 를 먼저 로드했을 때
 * 레지스트리가 빈 채로 굳으면 여기서 터진다.
 */
describe('@packages/event-contracts public surface', () => {
  it('re-exports the registry from the package root', () => {
    expect(contracts.STREAM_REGISTRY).toBe(STREAM_REGISTRY);
    expect(contracts.streamForTopic).toBe(streamForTopic);
  });

  it('is fully populated when reached through the package root', () => {
    expect(contracts.streamForTopic('orders.events.v1')).toBe(ORDER_STREAM);
    expect(Object.keys(contracts.STREAM_REGISTRY).length).toBeGreaterThan(1);
  });
});
