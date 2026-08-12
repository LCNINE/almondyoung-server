import { findStagnant } from './transfer-stagnation.monitor';

const base = {
  transferOrderId: 'o1',
  transferOrderLineId: 'l1',
  skuId: 's1',
  toWarehouseId: 'w1',
  outstandingQty: 5,
  eta: null as Date | null,
};

describe('findStagnant', () => {
  it('선적 후 임계일을 넘긴 잔량만 고른다', () => {
    const now = new Date('2026-08-12T00:00:00Z');
    const result = findStagnant(
      now,
      [
        { ...base, transferOrderLineId: 'old', shippedAt: new Date('2026-07-01T00:00:00Z') },
        { ...base, transferOrderLineId: 'new', shippedAt: new Date('2026-08-10T00:00:00Z') },
      ],
      30,
    );
    expect(result.map((r) => r.transferOrderLineId)).toEqual(['old']);
  });

  it('선적 시각이 없으면 체류로 보지 않는다', () => {
    const now = new Date('2026-08-12T00:00:00Z');
    expect(findStagnant(now, [{ ...base, shippedAt: null }], 30)).toEqual([]);
  });

  it('ETA 가 지났으면 임계일 이전이라도 고른다', () => {
    const now = new Date('2026-08-12T00:00:00Z');
    const result = findStagnant(
      now,
      [{ ...base, shippedAt: new Date('2026-08-10T00:00:00Z'), eta: new Date('2026-08-11T00:00:00Z') }],
      30,
    );
    expect(result).toHaveLength(1);
  });
});
