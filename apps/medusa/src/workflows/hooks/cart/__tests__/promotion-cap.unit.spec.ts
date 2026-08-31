import { findCapViolations, planPromotionCap } from '../promotion-cap';

const caps = (entries: Array<[string, number]>) => new Map<string, number>(entries);

describe('planPromotionCap — 캡을 넘는 만큼만 줄인다', () => {
  it('캡이 없는 프로모션은 손대지 않는다', () => {
    const plan = planPromotionCap(
      [{ id: 'adj_1', promotion_id: 'promo_1', amount: 99999 }],
      caps([]),
    );
    expect(plan).toEqual([]);
  });

  it('합이 캡 이하면 손대지 않는다 (멱등)', () => {
    const plan = planPromotionCap(
      [
        { id: 'adj_1', promotion_id: 'promo_1', amount: 2000 },
        { id: 'adj_2', promotion_id: 'promo_1', amount: 1000 },
      ],
      caps([['promo_1', 3000]]),
    );
    expect(plan).toEqual([]);
  });

  it('단일 라인이 캡을 넘으면 캡으로 깎는다', () => {
    const plan = planPromotionCap(
      [{ id: 'adj_1', promotion_id: 'promo_1', amount: 50000 }],
      caps([['promo_1', 30000]]),
    );
    expect(plan).toEqual([{ id: 'adj_1', amount: 30000 }]);
  });

  it('여러 라인은 비례 배분하고, 합은 정확히 캡이다', () => {
    const plan = planPromotionCap(
      [
        { id: 'adj_a', promotion_id: 'promo_1', amount: 3333 },
        { id: 'adj_b', promotion_id: 'promo_1', amount: 3333 },
        { id: 'adj_c', promotion_id: 'promo_1', amount: 3334 },
      ],
      caps([['promo_1', 5000]]),
    );
    expect(plan.reduce((sum, p) => sum + p.amount, 0)).toBe(5000);
    // 버려진 소수부(.5, .5, .0)가 큰 순으로 1원을 되돌린다. 동률은 id 오름차순.
    expect([...plan].sort((x, y) => (x.id < y.id ? -1 : 1))).toEqual([
      { id: 'adj_a', amount: 1667 },
      { id: 'adj_b', amount: 1666 },
      { id: 'adj_c', amount: 1667 },
    ]);
  });

  it('라인아이템과 배송수단 adjustment 를 한 프로모션으로 묶어 캡한다', () => {
    const plan = planPromotionCap(
      [
        { id: 'li_1', promotion_id: 'promo_1', amount: 8000 },
        { id: 'sm_1', promotion_id: 'promo_1', amount: 2000 },
      ],
      caps([['promo_1', 5000]]),
    );
    expect(plan.reduce((sum, p) => sum + p.amount, 0)).toBe(5000);
    expect(plan).toEqual(
      expect.arrayContaining([
        { id: 'li_1', amount: 4000 },
        { id: 'sm_1', amount: 1000 },
      ]),
    );
  });

  it('프로모션이 여럿이면 각자의 캡을 독립적으로 적용한다', () => {
    const plan = planPromotionCap(
      [
        { id: 'adj_1', promotion_id: 'promo_1', amount: 50000 },
        { id: 'adj_2', promotion_id: 'promo_2', amount: 1000 },
      ],
      caps([
        ['promo_1', 30000],
        ['promo_2', 30000],
      ]),
    );
    expect(plan).toEqual([{ id: 'adj_1', amount: 30000 }]);
  });

  it('promotion_id 가 없는 adjustment 는 무시한다', () => {
    const plan = planPromotionCap(
      [
        { id: 'adj_1', promotion_id: null, amount: 50000 },
        { id: 'adj_2', amount: 50000 },
      ],
      caps([['promo_1', 100]]),
    );
    expect(plan).toEqual([]);
  });

  it('캡 0 은 「할인 없음」이다 — 무시하지 않는다', () => {
    const plan = planPromotionCap(
      [{ id: 'adj_1', promotion_id: 'promo_1', amount: 50000 }],
      caps([['promo_1', 0]]),
    );
    expect(plan).toEqual([{ id: 'adj_1', amount: 0 }]);
  });

  it('합이 0 이면 나눗셈을 하지 않는다', () => {
    const plan = planPromotionCap(
      [{ id: 'adj_1', promotion_id: 'promo_1', amount: 0 }],
      caps([['promo_1', 0]]),
    );
    expect(plan).toEqual([]);
  });
});

describe('findCapViolations — 백스톱이 묻는 질문', () => {
  it('캡 이하면 위반이 없다', () => {
    expect(
      findCapViolations(
        [{ id: 'adj_1', promotion_id: 'promo_1', amount: 3000 }],
        caps([['promo_1', 3000]]),
      ),
    ).toEqual([]);
  });

  it('캡을 넘으면 프로모션·합·캡을 돌려준다', () => {
    expect(
      findCapViolations(
        [
          { id: 'adj_1', promotion_id: 'promo_1', amount: 3000 },
          { id: 'adj_2', promotion_id: 'promo_1', amount: 1 },
        ],
        caps([['promo_1', 3000]]),
      ),
    ).toEqual([{ promotion_id: 'promo_1', total: 3001, cap: 3000 }]);
  });
});
