import {
  applyPercentDiscount,
  buildPriceListPayloads,
  findOverlapping,
  groupTimeSales,
  isTimeSalePriceList,
  resolveTimeSaleStatus,
  validateRows,
  toTimeSaleRows,
  type RawPriceList,
  type TimeSaleRow,
} from './time-sale-model';

const row = (over: Partial<TimeSaleRow> = {}): TimeSaleRow => ({
  variantId: 'variant_1',
  productId: 'prod_1',
  productTitle: '상품',
  variantTitle: '기본 품목',
  basePrice: 10000,
  membershipBasePrice: 8000,
  generalSalePrice: null,
  membershipSalePrice: null,
  ...over,
});

const priceList = (over: Partial<RawPriceList> = {}): RawPriceList => ({
  id: 'plist_1',
  title: '8월 마감 세일',
  type: 'sale',
  status: 'active',
  starts_at: '2026-08-28T00:00:00.000Z',
  ends_at: '2026-08-30T00:00:00.000Z',
  ...over,
});

describe('resolveTimeSaleStatus', () => {
  const period = { startsAt: '2026-08-28T00:00:00Z', endsAt: '2026-08-30T00:00:00Z' };

  it.each([
    ['2026-08-27T23:59:59Z', 'scheduled'],
    ['2026-08-29T00:00:00Z', 'active'],
    ['2026-08-30T00:00:00Z', 'ended'],
  ])('%s 는 %s', (now, expected) => {
    expect(resolveTimeSaleStatus(period, new Date(now))).toBe(expected);
  });
});

describe('findOverlapping', () => {
  const existing = [
    { id: 'a', startsAt: '2026-08-28T00:00:00Z', endsAt: '2026-08-30T00:00:00Z' },
  ];

  it('기간이 겹치면 잡는다', () => {
    const hit = findOverlapping(
      { startsAt: '2026-08-29T00:00:00Z', endsAt: '2026-09-01T00:00:00Z' },
      existing
    );
    expect(hit.map((s) => s.id)).toEqual(['a']);
  });

  // 앞 세일이 끝나는 순간 다음 세일을 시작하는 건 정상 운영이다. 여기서 막으면 세일을 연달아 못 건다.
  it('경계가 맞닿는 건 겹침이 아니다', () => {
    expect(
      findOverlapping({ startsAt: '2026-08-30T00:00:00Z', endsAt: '2026-09-01T00:00:00Z' }, existing)
    ).toEqual([]);
  });

  it('자기 자신은 겹침으로 보지 않는다 (수정 시)', () => {
    expect(
      findOverlapping(
        { id: 'a', startsAt: '2026-08-28T00:00:00Z', endsAt: '2026-08-30T00:00:00Z' },
        existing
      )
    ).toEqual([]);
  });
});

describe('applyPercentDiscount', () => {
  // 정가 기준 하나로 양쪽을 채우면 멤버십 할인율이 N 보다 큰 상품이 전부 저장 거부된다.
  // 각자의 기준에 같은 N 을 적용해야 멤버십 세일가가 반드시 멤버십가보다 싸진다.
  it('일반은 정가에서, 멤버십은 멤버십가에서 같은 비율로 깎는다', () => {
    const [result] = applyPercentDiscount([row()], 20);

    expect(result.generalSalePrice).toBe(8000);
    expect(result.membershipSalePrice).toBe(6400);
    expect(validateRows([result])).toEqual([]);
  });

  it('멤버십가가 없는 상품은 멤버십 세일가도 만들지 않는다', () => {
    const [result] = applyPercentDiscount([row({ membershipBasePrice: null })], 20);

    expect(result.generalSalePrice).toBe(8000);
    expect(result.membershipSalePrice).toBeNull();
  });

  // 멤버십 할인율(20%)이 세일 할인율(10%)보다 커도 저장 가능해야 한다 — 라이브 중앙값이 20% 라
  // 정가 기준이었다면 절반이 막힌다.
  it('세일 할인율이 멤버십 할인율보다 작아도 검증을 통과한다', () => {
    const [result] = applyPercentDiscount([row()], 10);

    expect(result.generalSalePrice).toBe(9000);
    expect(result.membershipSalePrice).toBe(7200);
    expect(validateRows([result])).toEqual([]);
  });
});

describe('validateRows', () => {
  it('세일가가 정가 이상이면 막는다', () => {
    const errors = validateRows([row({ generalSalePrice: 10000, membershipSalePrice: 7000 })]);
    expect(errors[0].message).toContain('정가');
  });

  it('멤버십 세일가가 멤버십가 이상이면 막는다', () => {
    const errors = validateRows([row({ generalSalePrice: 9000, membershipSalePrice: 8000 })]);
    expect(errors[0].message).toContain('멤버십가');
  });

  it('세일가가 비어 있으면 막는다', () => {
    expect(validateRows([row()])[0].message).toContain('세일가를 입력');
  });
});

describe('buildPriceListPayloads', () => {
  const params = {
    title: '8월 마감 세일',
    period: { startsAt: '2026-08-28T00:00:00Z', endsAt: '2026-08-30T00:00:00Z' },
    regionIds: ['reg_kr'],
    membershipGroupId: 'cusgroup_membership',
  };

  // 룰이 0 개면 Medusa 가 `rules_count 내림` 으로 상시 멤버십 리스트를 먼저 고른다 — 금액을
  // 비교하기도 전에 세일이 진다.
  it('두 리스트 모두 룰을 정확히 하나씩 갖는다', () => {
    const { general, membership } = buildPriceListPayloads({
      ...params,
      rows: [row({ generalSalePrice: 8000, membershipSalePrice: 6400 })],
    });

    expect(Object.keys(general.rules)).toHaveLength(1);
    expect(general.rules).toEqual({ region_id: ['reg_kr'] });
    expect(Object.keys(membership!.rules)).toHaveLength(1);
    expect(membership!.rules).toEqual({ 'customer.groups.id': ['cusgroup_membership'] });
  });

  it('기간은 두 리스트에 같이 실린다', () => {
    const { general, membership } = buildPriceListPayloads({
      ...params,
      rows: [row({ generalSalePrice: 8000, membershipSalePrice: 6400 })],
    });

    expect(general.starts_at).toBe(params.period.startsAt);
    expect(membership!.ends_at).toBe(params.period.endsAt);
  });

  // 멤버십가가 없는 상품만 있으면 멤버십 리스트를 만들 이유가 없다. 구독자는 전원 대상인
  // 일반용 리스트를 받으므로 세일에서 빠지지 않는다.
  it('멤버십 세일가가 하나도 없으면 멤버십 리스트를 만들지 않는다', () => {
    const { general, membership } = buildPriceListPayloads({
      ...params,
      rows: [row({ membershipBasePrice: null, generalSalePrice: 8000 })],
    });

    expect(general.prices).toHaveLength(1);
    expect(membership).toBeNull();
  });
});

describe('isTimeSalePriceList / groupTimeSales', () => {
  // 상시 리스트는 두 시각이 모두 null 이라 이 조건 하나로 갈린다.
  it('기간 없는 상시 리스트는 타임세일이 아니다', () => {
    expect(isTimeSalePriceList(priceList({ title: 'Membership Prices', starts_at: null, ends_at: null }))).toBe(
      false
    );
    expect(isTimeSalePriceList(priceList())).toBe(true);
  });

  it('일반용과 멤버십용을 세일 하나로 묶는다', () => {
    const sales = groupTimeSales([
      priceList({ id: 'plist_g', title: '8월 마감 세일' }),
      priceList({ id: 'plist_m', title: '8월 마감 세일 (멤버십)' }),
      priceList({ title: 'Membership Prices', starts_at: null, ends_at: null }),
    ]);

    expect(sales).toHaveLength(1);
    expect(sales[0].title).toBe('8월 마감 세일');
    expect(sales[0].general?.id).toBe('plist_g');
    expect(sales[0].membership?.id).toBe('plist_m');
  });
});

describe('toTimeSaleRows', () => {
  const product = {
    id: 'prod_1',
    title: '노몬드 속눈썹 영양제',
    variants: [
      {
        id: 'variant_1',
        title: '기본 품목',
        prices: [
          { amount: 10000, currency_code: 'krw', price_list_id: null },
          { amount: 8000, currency_code: 'krw', price_list_id: 'plist_membership' },
          { amount: 7000, currency_code: 'krw', price_list_id: 'plist_tiered' },
        ],
      },
    ],
  };

  // metadata.membershipPrice 는 표시용 사본이라 어긋난 전례가 있다. 어긋난 값으로 세일가를 계산하면
  // 구독자에게 세일이 안 먹으므로 price list 의 실제 가격을 읽는다.
  it('정가는 price list 없는 행, 멤버십가는 멤버십 리스트 행에서 읽는다', () => {
    const [row] = toTimeSaleRows([product], 'plist_membership');

    expect(row.basePrice).toBe(10000);
    expect(row.membershipBasePrice).toBe(8000);
  });

  it('멤버십 리스트를 못 찾으면 멤버십가 없이 진행한다', () => {
    const [row] = toTimeSaleRows([product], null);

    expect(row.basePrice).toBe(10000);
    expect(row.membershipBasePrice).toBeNull();
  });
});
