import {
  moveSelectedItems,
  formatShiftRepeat,
  shortSaleNumber,
  TIME_SALE_LIST_STATUS_LABEL,
  applyPercentDiscount,
  applySavedSalePrices,
  summarizeSaleRows,
  buildPriceListPayloads,
  findOverlapping,
  findVariantConflicts,
  deriveTimeSaleListStatus,
  resolveTimeSaleStatus,
  saleVariantIds,
  validateRows,
  toTimeSaleRows,
  type TimeSaleRow,
  canDeleteSavedStyle,
  deleteSavedStyle,
  linkActiveStyle,
  removeVariableValues,
  saveNewStyle,
  shouldKeepDraftOnRefetch,
} from './time-sale-model';
import { defaultTimeSaleSettings } from '@packages/domain-types/time-sale';

it('moves selected rows together without crossing the list boundaries or changing the source', () => {
  const items = ['a', 'b', 'c', 'd'];
  expect(moveSelectedItems(items, ['b', 'c'], 'up')).toEqual([
    'b',
    'c',
    'a',
    'd',
  ]);
  expect(moveSelectedItems(items, ['b', 'c'], 'down')).toEqual([
    'a',
    'd',
    'b',
    'c',
  ]);
  expect(moveSelectedItems(items, ['a', 'b'], 'up')).toEqual(items);
  expect(moveSelectedItems(items, ['c', 'd'], 'down')).toEqual(items);
  expect(moveSelectedItems(items, ['b', 'd'], 'first')).toEqual([
    'b',
    'd',
    'a',
    'c',
  ]);
  expect(moveSelectedItems(items, ['a', 'c'], 'last')).toEqual([
    'b',
    'd',
    'a',
    'c',
  ]);
  expect(items).toEqual(['a', 'b', 'c', 'd']);
});

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
  const period = {
    startsAt: '2026-08-28T00:00:00Z',
    endsAt: '2026-08-30T00:00:00Z',
  };

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
    {
      id: 'a',
      startsAt: '2026-08-28T00:00:00Z',
      endsAt: '2026-08-30T00:00:00Z',
    },
  ];

  it('기간이 겹치면 잡는다', () => {
    const hit = findOverlapping(
      { startsAt: '2026-08-29T00:00:00Z', endsAt: '2026-09-01T00:00:00Z' },
      existing
    );
    expect(hit.map((s) => s.id)).toEqual(['a']);
  });

  // 앞 세일이 끝나는 순간 다음 세일을 시작하는 건 정상 운영이다.
  // 여기서 막으면 세일을 연달아 못 건다.
  it('경계가 맞닿는 건 겹침이 아니다', () => {
    expect(
      findOverlapping(
        { startsAt: '2026-08-30T00:00:00Z', endsAt: '2026-09-01T00:00:00Z' },
        existing
      )
    ).toEqual([]);
  });

  it('자기 자신은 겹침으로 보지 않는다 (수정 시)', () => {
    expect(
      findOverlapping(
        {
          id: 'a',
          startsAt: '2026-08-28T00:00:00Z',
          endsAt: '2026-08-30T00:00:00Z',
        },
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
    const [result] = applyPercentDiscount(
      [row({ membershipBasePrice: null })],
      20
    );

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
    const [result] = applyPercentDiscount(
      [row({ membershipBasePrice: 7000 })],
      20,
      10
    );

    expect(result.generalSalePrice).toBe(8000);
    expect(result.membershipSalePrice).toBe(6300);
    expect(validateRows([result])).toEqual([]);
  });
});

describe('validateRows', () => {
  it('세일가가 정가 이상이면 막는다', () => {
    const errors = validateRows([
      row({ generalSalePrice: 10000, membershipSalePrice: 7000 }),
    ]);
    expect(errors[0].message).toContain('정가');
  });

  it('멤버십 세일가가 멤버십가 이상이면 막는다', () => {
    const errors = validateRows([
      row({ generalSalePrice: 9000, membershipSalePrice: 8000 }),
    ]);
    expect(errors[0].message).toContain('기존 가격(8,000원)');
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
    const errors = validateRows([
      row({ generalSalePrice: 8000, membershipSalePrice: -100 }),
    ]);
    expect(errors[0].message).toContain('멤버십 세일가는 0원보다');
  });

  it('세일가가 숫자가 아니면 막는다', () => {
    expect(validateRows([row({ generalSalePrice: NaN })])[0].message).toContain(
      '숫자여야'
    );
    expect(
      validateRows([
        row({ generalSalePrice: 8000, membershipSalePrice: NaN }),
      ])[0].message
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

describe('buildPriceListPayloads', () => {
  const params = {
    title: '8월 마감 세일',
    period: {
      startsAt: '2026-08-28T00:00:00Z',
      endsAt: '2026-08-30T00:00:00Z',
    },
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
    expect(membership!.rules).toEqual({
      'customer.groups.id': ['cusgroup_membership'],
    });
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
      {
        ...product,
        variants: [
          { ...product.variants[0], metadata: { membershipPrice: '8000' } },
        ],
      },
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

  // 기존 멤버십가가 없어도 회원 전용 세일에 저장한 할인가는 복원한다.
  it('기존 멤버십가가 없는 품목도 저장된 멤버십 세일가를 복원한다', () => {
    const [restored] = applySavedSalePrices(
      [row({ variantId: 'v1', membershipBasePrice: null })],
      { general: new Map([['v1', 9000]]), membership: new Map([['v1', 7000]]) }
    );

    expect(restored.membershipSalePrice).toBe(7000);
  });
});

describe('스타일 라이브러리 연동', () => {
  it('새 스타일 저장 시 활성 레이아웃 id 가 새 snapshot id 가 된다', () => {
    const settings = defaultTimeSaleSettings();
    saveNewStyle(settings, 'main', 'pc', 'style-1');

    const last = settings.savedStyles[settings.savedStyles.length - 1];

    expect(settings.styles.main.pc.id).toBe(last.id);
    expect(last.id).toBe('style-1');
  });

  it('저장할 때마다 같은 id 의 snapshot 이 갱신되고 다른 항목은 그대로다', () => {
    const settings = defaultTimeSaleSettings();
    saveNewStyle(settings, 'main', 'pc', 'style-1');
    saveNewStyle(settings, 'main', 'mobile', 'style-2');

    settings.styles.main.pc.name = '바뀐 이름';

    expect(linkActiveStyle(settings, 'main', 'pc')).toBe(true);
    expect(settings.savedStyles[0].name).toBe('바뀐 이름');
    expect(settings.savedStyles[1].name).toBe('기본 스타일');
    expect(settings.savedStyles).toHaveLength(2);
  });

  it('연결된 snapshot 이 없으면 갱신하지 않는다', () => {
    const settings = defaultTimeSaleSettings();

    expect(linkActiveStyle(settings, 'main', 'pc')).toBe(false);
    expect(settings.savedStyles).toHaveLength(0);
  });

  it('기본 스타일은 삭제할 수 없고 저장된 스타일은 삭제 후 기본 id 로 돌아간다', () => {
    const settings = defaultTimeSaleSettings();

    expect(canDeleteSavedStyle(settings, 'main', 'pc')).toBe(false);

    saveNewStyle(settings, 'main', 'pc', 'style-1');
    expect(canDeleteSavedStyle(settings, 'main', 'pc')).toBe(true);

    deleteSavedStyle(settings, 'main', 'pc');

    expect(settings.savedStyles).toHaveLength(0);
    expect(settings.styles.main.pc.id).toBe('main-pc');
  });
});

describe('미저장 변경 보호', () => {
  it('dirty 면 서버 revision 이 달라도 편집본을 유지한다', () => {
    expect(shouldKeepDraftOnRefetch(true, 'r2', 'r1')).toBe(true);
  });

  it('dirty 가 아니고 revision 이 다르면 서버 값을 받아들인다', () => {
    expect(shouldKeepDraftOnRefetch(false, 'r2', 'r1')).toBe(false);
    expect(shouldKeepDraftOnRefetch(false, 'r1', 'r1')).toBe(true);
  });
});

describe('removeVariableValues', () => {
  it('모든 세일의 상품별 값에서 그 변수만 지운다', () => {
    const sales = {
      a: { productVariables: { p1: { user_x: '1', user_y: '2' } } },
      b: {},
    };

    removeVariableValues(sales, 'user_x');

    expect(sales.a.productVariables.p1).toEqual({ user_y: '2' });
  });
});

describe('deriveTimeSaleListStatus', () => {
  const now = new Date('2026-08-29T00:00:00Z');
  const on = { enabled: true, suspendedPriceListIds: [] as string[] };
  const upcoming = {
    startsAt: '2026-09-01T00:00:00Z',
    endsAt: '2026-09-02T00:00:00Z',
  };
  const running = {
    startsAt: '2026-08-28T00:00:00Z',
    endsAt: '2026-08-30T00:00:00Z',
  };
  const past = {
    startsAt: '2026-08-01T00:00:00Z',
    endsAt: '2026-08-02T00:00:00Z',
  };
  const sale = (
    status: 'active' | 'draft',
    periods: { startsAt: string; endsAt: string }[]
  ) => ({ status, priceListIds: ['pl_1'], periods });

  it('active + 시작 전 = 대기중', () => {
    expect(deriveTimeSaleListStatus(sale('active', [upcoming]), on, now)).toBe(
      'scheduled'
    );
  });

  it('active + 기간 중 = 실행중', () => {
    expect(deriveTimeSaleListStatus(sale('active', [running]), on, now)).toBe(
      'active'
    );
  });

  it('active + 기간 끝 = 마감', () => {
    expect(deriveTimeSaleListStatus(sale('active', [past]), on, now)).toBe(
      'ended'
    );
  });

  it('draft = 중지(없음)', () => {
    expect(deriveTimeSaleListStatus(sale('draft', [running]), on, now)).toBe(
      'stopped'
    );
  });

  it('상품별 기간: 하나라도 진행 중이면 실행중, 아니면 예정 우선, 전부 끝나면 마감', () => {
    expect(
      deriveTimeSaleListStatus(
        sale('active', [past, running, upcoming]),
        on,
        now
      )
    ).toBe('active');
    expect(
      deriveTimeSaleListStatus(sale('active', [past, upcoming]), on, now)
    ).toBe('scheduled');
    expect(
      deriveTimeSaleListStatus(sale('active', [past, past]), on, now)
    ).toBe('ended');
  });

  it('서비스 OFF 로 멈춘 가격표는 중지(서비스 OFF)', () => {
    const off = { enabled: false, suspendedPriceListIds: ['pl_1'] };
    expect(deriveTimeSaleListStatus(sale('draft', [running]), off, now)).toBe(
      'suspended'
    );
  });

  it('서비스 OFF 여도 목록에 없는 중지 세일은 중지(없음)', () => {
    const off = { enabled: false, suspendedPriceListIds: ['pl_other'] };
    expect(deriveTimeSaleListStatus(sale('draft', [running]), off, now)).toBe(
      'stopped'
    );
  });
});

describe('TIME_SALE_LIST_STATUS_LABEL', () => {
  it('중지 계열 문구는 없음/마감/서비스 OFF 로 나뉘고 중지중은 쓰지 않는다', () => {
    expect(TIME_SALE_LIST_STATUS_LABEL.stopped).toBe('중지(없음)');
    expect(TIME_SALE_LIST_STATUS_LABEL.ended).toBe('중지(마감)');
    expect(TIME_SALE_LIST_STATUS_LABEL.suspended).toBe('중지(서비스 OFF)');
    expect(Object.values(TIME_SALE_LIST_STATUS_LABEL)).not.toContain('중지중');
  });
});

describe('목록 칸 표기', () => {
  it('SHIFT 반복: 없음 / 무한 / 만료일', () => {
    expect(formatShiftRepeat({ repeatHours: 0, repeatUntil: null })).toBe('-');
    expect(formatShiftRepeat({ repeatHours: 24, repeatUntil: null })).toBe(
      '24시간 · 무한'
    );
    expect(
      formatShiftRepeat({
        repeatHours: 24,
        repeatUntil: '2026-10-08T13:50:00.000Z',
      })
    ).toBe('24시간 · 2026-10-08까지');
  });

  it('번호: 새 세일은 앞 8자, 옛 가격표 id 는 끝 8자', () => {
    expect(shortSaleNumber('abcdef12-3456-7890')).toBe('abcdef12');
    expect(shortSaleNumber('plist_01JABCDEFGH')).toBe('ABCDEFGH');
  });
});

describe('멤버십 회원 전용 할인', () => {
  it('회원 전용이면 일반 세일가 없이 회원 가격만 입력할 수 있다', () => {
    expect(validateRows([row({ membershipSalePrice: 6000 })], true)).toEqual(
      []
    );
    expect(
      validateRows([row({ membershipSalePrice: 6000 })], false)
    ).toHaveLength(1);
  });

  it('기존 멤버십가가 없으면 일반가를 기준으로 검증한다', () => {
    expect(
      validateRows(
        [row({ membershipBasePrice: null, membershipSalePrice: 9000 })],
        true
      )
    ).toEqual([]);
    expect(
      validateRows([row({ membershipSalePrice: 9000 })], true)
    ).toHaveLength(1);
    expect(
      validateRows([row({ membershipSalePrice: NaN })], true)
    ).toHaveLength(1);
  });

  it('일반 할인 가격표를 비우고 회원 세일가가 입력된 옵션만 포함한다', () => {
    const { general, membership } = buildPriceListPayloads({
      title: '회원 특가',
      period: {
        startsAt: '2026-10-09T00:00:00Z',
        endsAt: '2026-10-10T00:00:00Z',
      },
      rows: [
        row({ membershipSalePrice: 6000 }),
        row({ variantId: 'excluded' }),
      ],
      regionIds: ['reg_kr'],
      membershipGroupId: 'members',
      membershipOnly: true,
    });

    expect(general.prices).toEqual([]);
    expect(membership?.prices).toEqual([
      expect.objectContaining({ variant_id: 'variant_1', amount: 6000 }),
    ]);
  });
});
