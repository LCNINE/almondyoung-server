import {
  calculateMembershipDiscount,
  resolveMembershipDiscount,
  resolveQuantity,
  type OrderItem,
} from '../membership-benefit-order';

// 멤버십 혜택 기록(→ 해지 시 환불 차단)은 이 함수가 > 0 을 낼 때만 트리거된다.
// (subscriber: `if (discountAmount <= 0) return;`)
// 즉 "멤버십 할인가가 실제 적용된 상품(compare_at > 실결제가)"을 샀을 때만 혜택 사용으로 잡힌다.
// 수량은 order_line_item 이 아니라 order_item(=detail)에 있다. graph 가 실제로 내려주는 모양을
// 그대로 쓴다 — 예전 헬퍼처럼 item.quantity 를 직접 채우면 라이브에서만 터지는 버그를 못 잡는다.
const item = ({ quantity = 1, ...o }: Partial<OrderItem> & { quantity?: number }): OrderItem => ({
  id: 'li',
  unit_price: 10000,
  compare_at_unit_price: null,
  detail: { quantity },
  ...o,
});

describe('resolveQuantity - 수량의 출처', () => {
  it('수량은 detail(order_item)에서 온다', () => {
    expect(resolveQuantity({ id: 'li', unit_price: 0, compare_at_unit_price: null, detail: { quantity: 3 } })).toBe(3);
  });

  it('detail 이 없으면 라인의 quantity 로 폴백한다', () => {
    expect(resolveQuantity({ id: 'li', unit_price: 0, compare_at_unit_price: null, quantity: 2 })).toBe(2);
  });

  it('둘 다 없으면 NaN — 0/1 로 눙치면 금액이 조용히 틀어진다', () => {
    expect(resolveQuantity({ id: 'li', unit_price: 0, compare_at_unit_price: null })).toBeNaN();
  });
});

describe('수량 조회 실패는 금액을 오염시킨다', () => {
  it('detail 도 quantity 도 없으면 할인액이 NaN 이다 (경계 가드가 잡아야 하는 값)', () => {
    // 라이브에서 `items.quantity` 만 요청해 전 라인이 undefined 로 오던 상태의 재현.
    // NaN 은 `<= 0` 가드를 통과하고 JSON.stringify 가 null 로 직렬화해 기록 API 가 400 을 냈다.
    const broken: OrderItem = { id: 'li', unit_price: 11900, compare_at_unit_price: 18000 };
    expect(calculateMembershipDiscount([broken])).toBeNaN();
    expect(JSON.parse(JSON.stringify({ amount: calculateMembershipDiscount([broken]) })).amount).toBeNull();
  });

  it('detail 로 수량이 오면 정상 계산된다', () => {
    expect(
      calculateMembershipDiscount([
        { id: 'li', unit_price: 11900, compare_at_unit_price: 18000, detail: { quantity: 3 } },
      ]),
    ).toBe(18300);
  });
});

describe('calculateMembershipDiscount - 혜택 사용 판정 신호', () => {
  it('정가 구매(compare_at 없음)는 할인 0 → 혜택 미기록', () => {
    expect(calculateMembershipDiscount([item({ compare_at_unit_price: null })])).toBe(0);
  });

  it('compare_at == 실결제가(할인 아님)도 할인 0 → 혜택 미기록', () => {
    expect(
      calculateMembershipDiscount([item({ unit_price: 10000, compare_at_unit_price: 10000 })]),
    ).toBe(0);
  });

  it('compare_at < 실결제가(비정상/인상)도 음수 아닌 0 처리 → 혜택 미기록', () => {
    expect(
      calculateMembershipDiscount([item({ unit_price: 10000, compare_at_unit_price: 8000 })]),
    ).toBe(0);
  });

  it('멤버십 할인가 적용(compare_at > 실결제가) → 할인액 = (compare_at - 실결제가) * 수량', () => {
    expect(
      calculateMembershipDiscount([item({ unit_price: 8000, compare_at_unit_price: 10000, quantity: 3 })]),
    ).toBe(6000);
  });

  it('할인 상품 + 정가 상품 혼합 → 할인 상품분만 합산', () => {
    const discount = calculateMembershipDiscount([
      item({ id: 'a', unit_price: 9000, compare_at_unit_price: 12000, quantity: 2 }), // 6000
      item({ id: 'b', unit_price: 5000, compare_at_unit_price: null, quantity: 5 }), // 0 (정가)
    ]);
    expect(discount).toBe(6000);
  });

  it('빈 주문은 0', () => {
    expect(calculateMembershipDiscount([])).toBe(0);
  });
});

// compare_at 은 멤버십가뿐 아니라 수량 할인(Tiered Prices)에도 채워진다 — 수량 할인은 고객그룹 규칙이
// 없어 비회원도 받는다. 멤버십 귀속분만 남기려면 '회원이 아니었다면 냈을 가격'과 비교해야 한다.
describe('resolveMembershipDiscount - 멤버십 귀속 할인 분리', () => {
  const logger = { warn: jest.fn() };

  /**
   * 비회원가를 priceSet 별로 돌려주는 컨테이너 스텁.
   *
   * 값이 함수면 `(quantity) => 가격` 으로 해석한다 — 수량 할인은 pricing 모듈이 컨텍스트의
   * quantity 로 min_quantity 를 걸러 고르므로, 스텁도 같은 축을 흉내내야 회귀를 잡는다.
   */
  const containerWith = (
    nonMemberPriceByVariant: Record<string, number | ((quantity: number) => number)>
  ) => ({
    resolve: (key: string) => {
      if (key === 'pricing') {
        return {
          calculatePrices: async (filters: { id: string[] }, opts: { context: { quantity?: number } }) =>
            Object.entries(nonMemberPriceByVariant)
              .filter(([variantId]) => filters.id.includes(`ps_${variantId}`))
              .map(([variantId, priced]) => ({
                id: `ps_${variantId}`,
                calculated_amount:
                  typeof priced === 'function' ? priced(opts.context.quantity ?? 1) : priced,
              })),
        };
      }
      return {
        graph: async () => ({
          data: Object.keys(nonMemberPriceByVariant).map((variantId) => ({
            id: variantId,
            price_set: { id: `ps_${variantId}` },
          })),
        }),
      };
    },
  });

  beforeEach(() => logger.warn.mockClear());

  it('수량 할인만 받은 주문은 멤버십 귀속 0 → 혜택 미기록', async () => {
    // 정가 10000, 수량 할인가 8000. 회원도 비회원도 8000 이므로 멤버십이 깎아준 몫은 없다.
    const items = [item({ variant_id: 'v1', unit_price: 8000, compare_at_unit_price: 10000, quantity: 2 })];

    const discount = await resolveMembershipDiscount(items, 'grp_membership', containerWith({ v1: 8000 }), logger);

    expect(discount).toBe(0);
  });

  it('멤버십가만 받은 주문은 전액이 멤버십 귀속', async () => {
    const items = [item({ variant_id: 'v1', unit_price: 8000, compare_at_unit_price: 10000, quantity: 2 })];

    const discount = await resolveMembershipDiscount(items, 'grp_membership', containerWith({ v1: 10000 }), logger);

    expect(discount).toBe(4000);
  });

  it('수량 할인 + 멤버십가가 겹치면 멤버십 기여분만 센다', async () => {
    // 정가 10000 → 수량 할인 9000 → 멤버십가 8000. 멤버십이 깎은 건 1000 뿐이다.
    const items = [item({ variant_id: 'v1', unit_price: 8000, compare_at_unit_price: 10000, quantity: 3 })];

    const discount = await resolveMembershipDiscount(items, 'grp_membership', containerWith({ v1: 9000 }), logger);

    expect(discount).toBe(3000);
  });

  it('compare_at 기준 할인액을 넘지 않는다', async () => {
    // 주문 뒤 정가가 올랐어도 고객이 실제로 덜 낸 금액(2000)보다 크게 잡지 않는다.
    const items = [item({ variant_id: 'v1', unit_price: 8000, compare_at_unit_price: 10000, quantity: 1 })];

    const discount = await resolveMembershipDiscount(items, 'grp_membership', containerWith({ v1: 50000 }), logger);

    expect(discount).toBe(2000);
  });

  it('가격 조회가 실패하면 compare_at 기준으로 떨어진다', async () => {
    const items = [item({ variant_id: 'v1', unit_price: 8000, compare_at_unit_price: 10000, quantity: 1 })];
    const brokenContainer = {
      resolve: () => {
        throw new Error('pricing module down');
      },
    };

    const discount = await resolveMembershipDiscount(items, 'grp_membership', brokenContainer, logger);

    expect(discount).toBe(2000);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('멤버십 그룹 설정이 없으면 compare_at 기준을 그대로 쓴다', async () => {
    const items = [item({ variant_id: 'v1', unit_price: 8000, compare_at_unit_price: 10000, quantity: 1 })];

    const discount = await resolveMembershipDiscount(items, null, containerWith({ v1: 8000 }), logger);

    expect(discount).toBe(2000);
  });

  // 수량 할인은 min_quantity 로 걸린다. 조회 컨텍스트에 quantity 를 안 넘기면 pricing 모듈이
  // 수량 할인가를 빼버려 비회원가가 정가로 나오고, 수량 할인분이 다시 멤버십 귀속으로 잡힌다.
  it('수량 할인 상품을 수량 조건과 함께 조회해 멤버십 귀속에서 뺀다', async () => {
    // 정가 10000, 10개 이상 8000. 고객은 10개를 사서 8000 에 받았다 — 멤버십 기여는 0이다.
    const tiered = (quantity: number) => (quantity >= 10 ? 8000 : 10000);
    const items = [item({ variant_id: 'v1', unit_price: 8000, compare_at_unit_price: 10000, quantity: 10 })];

    const discount = await resolveMembershipDiscount(items, 'grp_membership', containerWith({ v1: tiered }), logger);

    expect(discount).toBe(0);
  });

  it('수량이 다른 라인은 각자의 수량 조건으로 조회한다', async () => {
    const tiered = (quantity: number) => (quantity >= 10 ? 8000 : 10000);
    const items = [
      // 10개 → 수량 할인 8000 이 정당하다. 멤버십 기여 0.
      item({ id: 'a', variant_id: 'v1', unit_price: 8000, compare_at_unit_price: 10000, quantity: 10 }),
      // 2개 → 수량 할인 대상이 아닌데 8000 에 샀다. 차액 2000 은 멤버십 기여다.
      item({ id: 'b', variant_id: 'v2', unit_price: 8000, compare_at_unit_price: 10000, quantity: 2 }),
    ];

    const discount = await resolveMembershipDiscount(
      items,
      'grp_membership',
      containerWith({ v1: tiered, v2: tiered }),
      logger
    );

    expect(discount).toBe(4000);
  });

  // 과소 계상은 "혜택을 썼는데 전액 환불" 로 이어진다 — 돈이 나가면 되돌릴 수 없다.
  // 반대(과다 계상)는 환불이 막힐 뿐이고 관리자 예외 환불이라는 창구가 있다.
  it('비회원가를 못 구하면 0 이 아니라 compare_at 기준으로 떨어진다', async () => {
    const items = [item({ variant_id: 'v1', unit_price: 8000, compare_at_unit_price: 10000, quantity: 1 })];
    const emptyPricing = {
      resolve: (key: string) =>
        key === 'pricing'
          ? { calculatePrices: async () => [] }
          : { graph: async () => ({ data: [{ id: 'v1', price_set: { id: 'ps_v1' } }] }) },
    };

    const discount = await resolveMembershipDiscount(items, 'grp_membership', emptyPricing, logger);

    expect(discount).toBe(2000);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('할인 품목 일부만 비회원가를 구해도 전체를 compare_at 기준으로 떨어뜨린다', async () => {
    const items = [
      item({ id: 'a', variant_id: 'v1', unit_price: 8000, compare_at_unit_price: 10000, quantity: 1 }),
      item({ id: 'b', variant_id: 'v2', unit_price: 5000, compare_at_unit_price: 6000, quantity: 1 }),
    ];
    const partial = {
      resolve: (key: string) =>
        key === 'pricing'
          ? { calculatePrices: async () => [{ id: 'ps_v1', calculated_amount: 8000 }] }
          : {
              graph: async () => ({
                data: [
                  { id: 'v1', price_set: { id: 'ps_v1' } },
                  { id: 'v2', price_set: { id: 'ps_v2' } },
                ],
              }),
            },
    };

    const discount = await resolveMembershipDiscount(items, 'grp_membership', partial, logger);

    expect(discount).toBe(3000);
  });

  it('할인 없는 품목의 가격을 못 구한 건 결과를 흔들지 않는다', async () => {
    const items = [
      item({ id: 'a', variant_id: 'v1', unit_price: 8000, compare_at_unit_price: 10000, quantity: 1 }),
      item({ id: 'b', variant_id: 'v2', unit_price: 5000, compare_at_unit_price: null, quantity: 1 }),
    ];
    const partial = {
      resolve: (key: string) =>
        key === 'pricing'
          ? { calculatePrices: async () => [{ id: 'ps_v1', calculated_amount: 8000 }] }
          : {
              graph: async () => ({
                data: [
                  { id: 'v1', price_set: { id: 'ps_v1' } },
                  { id: 'v2', price_set: { id: 'ps_v2' } },
                ],
              }),
            },
    };

    // v1 은 비회원도 8000 → 멤버십 기여 0. v2 는 애초에 할인이 없어 판정과 무관하다.
    const discount = await resolveMembershipDiscount(items, 'grp_membership', partial, logger);

    expect(discount).toBe(0);
  });

  it('할인 자체가 없으면 가격 조회 없이 0', async () => {
    const items = [item({ variant_id: 'v1', unit_price: 10000, compare_at_unit_price: null })];
    const container = { resolve: () => { throw new Error('불려서는 안 된다'); } };

    await expect(resolveMembershipDiscount(items, 'grp_membership', container, logger)).resolves.toBe(0);
  });
});
