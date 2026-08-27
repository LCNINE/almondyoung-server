import { canDeriveReceived, isTerminal } from './purchase-order-closure.rules';

describe('isTerminal', () => {
  it('received 와 cancelled 는 종결이다', () => {
    expect(isTerminal('received')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
  });

  it('created 와 confirmed 는 종결이 아니다', () => {
    expect(isTerminal('created')).toBe(false);
    expect(isTerminal('confirmed')).toBe(false);
  });
});

describe('canDeriveReceived', () => {
  it('전 라인이 실행됐고 아직 종결 전이면 received 로 간다', () => {
    expect(canDeriveReceived({ current: 'confirmed', hasRequestedLine: false })).toBe(true);
  });

  it('requested 라인이 남았으면 안 간다 — 아직 살 것이 남았다', () => {
    expect(canDeriveReceived({ current: 'created', hasRequestedLine: true })).toBe(false);
  });

  // 취소된 발주에 입고가 들어와도 되살아나면 안 된다.
  it('이미 종결된 발주는 건드리지 않는다', () => {
    expect(canDeriveReceived({ current: 'cancelled', hasRequestedLine: false })).toBe(false);
    expect(canDeriveReceived({ current: 'received', hasRequestedLine: false })).toBe(false);
  });
});
