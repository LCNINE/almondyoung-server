import {
  applyPercentDiscount,
  applySavedSalePrices,
  summarizeSaleRows,
  buildPriceListPayloads,
  findOverlapping,
  findVariantConflicts,
  resolveTimeSaleStatus,
  validateRows,
  toTimeSaleRows,
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

describe('findVariantConflicts', () => {
  const overlapping = [
    { title: '색소 세일', variantIds: ['variant_1', 'variant_2'] },
    { title: '니들 세일', variantIds: ['variant_9'] },
  ];

  // 카테고리마다 기간이 다른 세일을 동시에 거는 게 요구사항이라, 기간만 겹치는 건 정상이다.
  it('기간이 겹쳐도 품목이 안 겹치면 통과다', () => {
    expect(findVariantConflicts(['variant_5'], overlapping)).toEqual([]);
  });

  // 같은 품목이 두 세일에 걸리면 Medusa 가 한쪽 가격만 적용해, 손님이 A 목록에서 B 가격을 본다.
  it('같은 품목을 쓰는 세일만 골라내고 겹친 품목을 알려준다', () => {
    const hit = findVariantConflicts(['variant_2', 'variant_5'], overlapping);

    expect(hit).toHaveLength(1);
    expect(hit[0].title).toBe('색소 세일');
    expect(hit[0].conflictingVariantIds).toEqual(['variant_2']);
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

describe('toTimeSaleRows', () => {
  const product = {
    id: 'prod_1',
    title: '노몬드 속눈썹 영양제',
    variants: [
      {
        id: 'variant_1',
        title: '기본 품목',
        metadata: { membershipPrice: 8000 },
        prices: [{ amount: 10000, currency_code: 'krw', price_list_id: null }],
      },
    ],
  };

  // Medusa Admin 의 상품 응답은 price list 가격을 싣지 않는다 — 기본가만 온다.
  // 멤버십가는 metadata 에서만 읽을 수 있고, 스토어프론트가 손님에게 보여주는 값도 같은 metadata 다.
  it('정가는 price list 없는 가격 행, 멤버십가는 metadata 에서 읽는다', () => {
    const [row] = toTimeSaleRows([product]);

    expect(row.basePrice).toBe(10000);
    expect(row.membershipBasePrice).toBe(8000);
  });

  it('문자열로 들어온 멤버십가도 숫자로 읽는다', () => {
    const [row] = toTimeSaleRows([
      { ...product, variants: [{ ...product.variants[0], metadata: { membershipPrice: '8000' } }] },
    ]);

    expect(row.membershipBasePrice).toBe(8000);
  });

  it('멤버십가가 없으면 null — 멤버십 세일가를 만들지 않는다', () => {
    const [row] = toTimeSaleRows([
      { ...product, variants: [{ ...product.variants[0], metadata: null }] },
    ]);

    expect(row.basePrice).toBe(10000);
    expect(row.membershipBasePrice).toBeNull();
  });
});

describe('summarizeSaleRows', () => {
  // "입력 111개" 만으로는 얼마로 채워졌는지 알 수 없어 운영자가 111 개를 펼쳐 확인하게 된다.
  it('할인율이 같으면 단일 값, 다르면 범위로 요약한다', () => {
    const same = summarizeSaleRows([
      row({ variantId: 'v1', basePrice: 10000, generalSalePrice: 9000 }),
      row({ variantId: 'v2', basePrice: 20000, generalSalePrice: 18000 }),
    ]);
    expect(same.minPercent).toBe(10);
    expect(same.maxPercent).toBe(10);
    expect(same.minPrice).toBe(9000);
    expect(same.maxPrice).toBe(18000);

    const mixed = summarizeSaleRows([
      row({ variantId: 'v1', basePrice: 10000, generalSalePrice: 9000 }),
      row({ variantId: 'v2', basePrice: 10000, generalSalePrice: 8000 }),
    ]);
    expect(mixed.minPercent).toBe(10);
    expect(mixed.maxPercent).toBe(20);
  });

  it('세일가가 없으면 할인율이 null 이고 미입력 수를 셀 수 있다', () => {
    const summary = summarizeSaleRows([
      row({ variantId: 'v1', generalSalePrice: null }),
      row({ variantId: 'v2', basePrice: 10000, generalSalePrice: 9000 }),
    ]);
    expect(summary.total).toBe(2);
    expect(summary.filled).toBe(1);
    expect(summary.minPercent).toBe(10);
  });

  it('입력이 하나도 없으면 전부 null 이다', () => {
    const summary = summarizeSaleRows([row({ generalSalePrice: null })]);
    expect(summary.filled).toBe(0);
    expect(summary.minPercent).toBeNull();
    expect(summary.minPrice).toBeNull();
  });
});

describe('applySavedSalePrices', () => {
  // 정가·멤버십가는 상품 응답의 현재 값을 쓴다. 저장 당시 값으로 검증하면 그 사이 정가가 내려간
  // 상품이 "세일가가 정가보다 비쌈" 을 통과해버린다.
  it('저장된 세일가만 덮고 정가·멤버십가는 그대로 둔다', () => {
    const [restored] = applySavedSalePrices(
      [row({ variantId: 'v1', basePrice: 12000, membershipBasePrice: 9000 })],
      { general: new Map([['v1', 9000]]), membership: new Map([['v1', 7000]]) }
    );

    expect(restored.basePrice).toBe(12000);
    expect(restored.membershipBasePrice).toBe(9000);
    expect(restored.generalSalePrice).toBe(9000);
    expect(restored.membershipSalePrice).toBe(7000);
  });

  // 멤버십가가 없는 상품(라이브 기준 54%)에 멤버십 세일가를 남기면 저장 단계에서 거부된다.
  it('멤버십가가 없는 품목은 멤버십 세일가를 복원하지 않는다', () => {
    const [restored] = applySavedSalePrices(
      [row({ variantId: 'v1', membershipBasePrice: null })],
      { general: new Map([['v1', 9000]]), membership: new Map([['v1', 7000]]) }
    );

    expect(restored.membershipSalePrice).toBeNull();
  });
});
