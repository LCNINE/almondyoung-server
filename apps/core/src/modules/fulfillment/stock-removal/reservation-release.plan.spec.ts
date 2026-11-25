import { planReservationRelease, ReleaseSourceLine } from './reservation-release.plan';

const line = (lineId: string, over: Partial<ReleaseSourceLine> = {}): ReleaseSourceLine => ({
  lineId,
  reservedQty: 2,
  lastResort: false,
  ready: false,
  queuedAt: 0,
  ...over,
});

describe('planReservationRelease', () => {
  it('없어지는 만큼만 놓는다', () => {
    expect(planReservationRelease(1, [line('a', { reservedQty: 3 })])).toEqual({
      releases: [{ lineId: 'a', qty: 1 }],
      missingQty: 0,
    });
  });

  it('빠질 것이 없으면 아무것도 놓지 않는다', () => {
    expect(planReservationRelease(-2, [line('a')])).toEqual({ releases: [], missingQty: 0 });
  });

  it('어차피 못 나가는 상자부터, 같으면 뒤에 온 주문부터 놓는다', () => {
    const plan = planReservationRelease(5, [
      line('ready', { ready: true, queuedAt: 9 }),
      line('early', { queuedAt: 1 }),
      line('late', { queuedAt: 5 }),
    ]);
    expect(plan.releases).toEqual([
      { lineId: 'late', qty: 2 },
      { lineId: 'early', qty: 2 },
      { lineId: 'ready', qty: 1 },
    ]);
  });

  it('우선할당한 주문은 다른 주문이 다 놓은 뒤에야 놓는다', () => {
    const plan = planReservationRelease(3, [
      line('priority', { lastResort: true, queuedAt: 9 }),
      line('ready', { ready: true, queuedAt: 1 }),
    ]);
    expect(plan.releases).toEqual([
      { lineId: 'ready', qty: 2 },
      { lineId: 'priority', qty: 1 },
    ]);
  });

  it('다 놓아도 모자라면 모자란 수량을 남긴다', () => {
    expect(planReservationRelease(5, [line('a'), line('b')]).missingQty).toBe(1);
  });
});
