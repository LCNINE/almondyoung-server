import { assertReceivedTransition } from './purchase-order-status.rules';

describe('발주 종결 전이', () => {
  it('전 라인이 종결된 발주(confirmed)만 received 로 간다', () => {
    expect(() => assertReceivedTransition('confirmed')).not.toThrow();
  });

  // 아직 requested 인 라인이 남았다는 뜻이다. 발주하지 않은 물건이 입고될 수는 없다.
  it('created 는 거부한다 — 라인을 먼저 실행해야 한다', () => {
    expect(() => assertReceivedTransition('created')).toThrow(/created/);
  });

  // #735 가 심사 게이트를 걷어내며 received → confirmed 역방향이 열렸다. 같은 술어가 막는다.
  it('이미 종결된 발주는 다시 종결되지 않는다', () => {
    expect(() => assertReceivedTransition('received')).toThrow(/received/);
  });
});
