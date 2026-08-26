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

  /**
   * 두 거부는 같은 술어의 두 얼굴이지만 **원인이 반대**다. 한 문장을 돌려쓰면 운영자가
   * 받는 409 가 자기 상황을 설명하지 못한다 — 이미 전 라인이 실행된 발주에게
   * "라인을 먼저 실행하라" 고 말하는 식이다(2026-08-26 dev 스모크에서 발견).
   */
  it('created 거부는 아직 실행 안 된 라인을 지목한다', () => {
    expect(() => assertReceivedTransition('created')).toThrow(/not executed yet/);
  });

  it('received 거부는 이미 종결됐음을 말한다 — 라인 실행을 요구하지 않는다', () => {
    expect(() => assertReceivedTransition('received')).toThrow(/already received/);
    expect(() => assertReceivedTransition('received')).not.toThrow(/executed/);
  });
});
