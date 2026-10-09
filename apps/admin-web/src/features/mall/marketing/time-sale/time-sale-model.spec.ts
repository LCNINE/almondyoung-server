import { CustomError } from '@/lib/api/customError';
import {
  applyPercentDiscount,
  applySavedSalePrices,
  summarizeSaleRows,
  buildTimeSaleWriteBody,
  readServerReason,
  resolveTimeSaleStatus,
  saleVariantIds,
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

  it('reports draft regardless of period', () => {
    expect(resolveTimeSaleStatus({ startsAt: '2000-01-01T00:00:00Z', endsAt: '2100-01-01T00:00:00Z' }, new Date(), 'draft')).toBe('draft');
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

  // 멤버십가가 이미 정가의 30% 를 깎은 값이면 20% 세일가(8000)보다 싸서 Medusa 가 멤버십가를
  // 그대로 적용한다 — 구독자에겐 세일이 없는 것과 같다. 멤버십만 얕게 깎아 그걸 피한다.
  it('멤버십 할인율을 따로 주면 멤버십가만 그 비율로 깎는다', () => {
    const [result] = applyPercentDiscount([row({ membershipBasePrice: 7000 })], 20, 10);

    expect(result.generalSalePrice).toBe(8000);
    expect(result.membershipSalePrice).toBe(6300);
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

  // 빈 칸은 "이 품목은 세일에서 뺀다" 는 뜻이다. 상품 하나에 옵션이 백 개씩 딸려오는데 전부
  // 채워야만 저장되면 일부 옵션만 거는 세일을 만들 수도, 그렇게 만든 세일을 다시 저장할 수도 없다.
  it('세일가가 비어 있으면 그 품목만 빠지고 저장은 막지 않는다', () => {
    expect(validateRows([row()])).toEqual([]);
  });

  it('일반 세일가 없이 멤버십 세일가만 남으면 막는다', () => {
    const errors = validateRows([row({ membershipSalePrice: 6000 })]);
    expect(errors[0].message).toContain('멤버십 세일가도 비우세요');
  });

  // 할인율 100 이상이면 음수가, NaN 이면 `amount: null` 이 Medusa 까지 간다. 멤버십 쪽은
  // "멤버십가보다 싼가" 만 봐서 둘 다 통과했다 — 음수도 NaN 비교도 그 검사를 뚫는다.
  it('멤버십 세일가가 0 이하면 막는다', () => {
    const errors = validateRows([row({ generalSalePrice: 8000, membershipSalePrice: -100 })]);
    expect(errors[0].message).toContain('멤버십 세일가는 0원보다');
  });

  it('세일가가 숫자가 아니면 막는다', () => {
    expect(validateRows([row({ generalSalePrice: NaN })])[0].message).toContain('숫자여야');
    expect(
      validateRows([row({ generalSalePrice: 8000, membershipSalePrice: NaN })])[0].message
    ).toContain('멤버십 세일가는 0원보다');
  });
});

describe('saleVariantIds', () => {
  // 상품 하나에 옵션이 백 개씩 딸려오는데 세일가를 넣은 건 몇 개뿐일 수 있다. 중복 검사가
  // 고른 옵션 전부를 세면, 세일에 넣지도 않은 품목 때문에 저장이 막힌다.
  it('세일가를 비운 품목은 빠진다', () => {
    expect(
      saleVariantIds([
        row({ variantId: 'variant_1', generalSalePrice: 8000 }),
        row({ variantId: 'variant_2' }),
      ])
    ).toEqual(['variant_1']);
  });
});

describe('buildTimeSaleWriteBody', () => {
  const period = { startsAt: '2030-01-01T00:00:00.000Z', endsAt: '2030-01-08T00:00:00.000Z' };
  const wrow = (overrides: Partial<TimeSaleRow>): TimeSaleRow => ({
    variantId: 'v1',
    productId: 'p1',
    productTitle: '상품',
    variantTitle: '옵션',
    basePrice: 1000,
    membershipBasePrice: 900,
    generalSalePrice: 800,
    membershipSalePrice: 700,
    ...overrides,
  });

  it('skips rows without a general sale price and keeps membership only where both exist', () => {
    const body = buildTimeSaleWriteBody({
      title: ' 가을 세일 ',
      period,
      status: 'draft',
      rows: [
        wrow({}),
        wrow({ variantId: 'v2', generalSalePrice: null, membershipSalePrice: null }),
        wrow({ variantId: 'v3', membershipBasePrice: null, membershipSalePrice: null }),
      ],
    });
    expect(body).toEqual({
      title: '가을 세일',
      starts_at: period.startsAt,
      ends_at: period.endsAt,
      status: 'draft',
      general_prices: [
        { variant_id: 'v1', amount: 800 },
        { variant_id: 'v3', amount: 800 },
      ],
      membership_prices: [{ variant_id: 'v1', amount: 700 }],
    });
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

describe('readServerReason', () => {
  // 인터셉터가 4xx 를 이 모양으로 던진다 (lib/api/client.ts).
  it('4xx CustomError 의 서버 메시지를 돌려준다', () => {
    const error = new CustomError({
      message: '겹치는 타임세일이 있습니다',
      statusCode: 400,
      response: { type: 'invalid_data', message: '겹치는 타임세일이 있습니다' },
    });
    expect(readServerReason(error)).toBe('겹치는 타임세일이 있습니다');
  });

  it('잠금 시간초과 409 도 사유로 보인다', () => {
    expect(readServerReason(new CustomError({ message: '잠시 후 다시 시도하세요', statusCode: 409 }))).toBe(
      '잠시 후 다시 시도하세요'
    );
  });

  it('5xx 와 일반 에러는 null', () => {
    expect(readServerReason(new CustomError({ message: 'boom', statusCode: 500 }))).toBeNull();
    expect(readServerReason(new Error('Network Error'))).toBeNull();
    expect(readServerReason(undefined)).toBeNull();
  });
});
