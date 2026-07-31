import { ProductImportValidator } from './product-import.validator';
import { ProductImportNormalizer } from './product-import.normalizer';
import { ProductRecord, formatKstMinutes } from '../dto/import.types';

function record(raw: Record<string, string>, options: ProductRecord['options'] = []): ProductRecord {
  return {
    rowNumber: 1,
    productKey: raw.productKey ?? 'P1',
    raw,
    version: {},
    categoryIds: [],
    categoryNames: [],
    options,
    variantOverrides: [],
    errors: [],
  };
}

describe('ProductImportValidator', () => {
  const validator = new ProductImportValidator();

  it('유효 행은 version 스칼라를 채우고 에러가 없다', () => {
    const [rec] = validator.validate([
      record({
        productKey: 'P1',
        name: '니트',
        basePrice: '29000',
        marketPrice: '19000',
        productType: 'regular_sale',
        isOverseas: 'Y',
      }),
    ]);
    expect(rec.errors).toEqual([]);
    expect(rec.version).toMatchObject({
      name: '니트',
      marketPrice: 19000,
      productType: 'regular_sale',
      isOverseas: true,
    });
  });

  it('name 누락은 에러', () => {
    const [rec] = validator.validate([record({ productKey: 'P1', name: '  ' })]);
    expect(rec.errors.some((e) => /name/.test(e.message))).toBe(true);
  });

  it('음수/NaN 가격은 에러', () => {
    const [rec] = validator.validate([record({ productKey: 'P1', name: 'x', marketPrice: '-5' })]);
    expect(rec.errors.some((e) => /marketPrice/.test(e.message))).toBe(true);
  });

  it('정의되지 않은 enum 은 에러', () => {
    const [rec] = validator.validate([record({ productKey: 'P1', name: 'x', productType: 'weird' })]);
    expect(rec.errors.some((e) => /productType/.test(e.message))).toBe(true);
  });

  it('maxQuantity < minQuantity 는 에러', () => {
    const [rec] = validator.validate([record({ productKey: 'P1', name: 'x', minQuantity: '5', maxQuantity: '2' })]);
    expect(rec.errors.some((e) => /maxQuantity/.test(e.message))).toBe(true);
  });

  it('옵션값 중복은 에러', () => {
    const [rec] = validator.validate([
      record({ productKey: 'P1', name: 'x' }, [
        { displayName: '색상', values: [{ displayName: '빨강' }, { displayName: '빨강' }], sortOrder: 1 },
      ]),
    ]);
    expect(rec.errors.some((e) => e.sheet === 'Options' && /중복/.test(e.message))).toBe(true);
  });

  it('sortOrder 중복은 에러', () => {
    const [rec] = validator.validate([
      record({ productKey: 'P1', name: 'x' }, [
        { displayName: '사이즈', values: [{ displayName: 'S' }], sortOrder: 1 },
        { displayName: '색상', values: [{ displayName: '빨강' }], sortOrder: 1 },
      ]),
    ]);
    expect(rec.errors.some((e) => e.sheet === 'Options' && /sortOrder 중복/.test(e.message))).toBe(true);
  });

  it('명시 sortOrder(1) 와 공란 행의 fallback(등장 순서 1) 이 충돌해도 잡아낸다', () => {
    // 실제 엑셀에서 재현 가능한 패턴: 한 행만 sortOrder 를 명시(1)하고, 나머지는 비워둔다.
    // fallback 은 "비어있는 행끼리의 등장 순서"라 1부터 다시 시작하므로 명시값 1 과 충돌한다.
    const normalizer = new ProductImportNormalizer();
    const [normalized] = normalizer.normalize(
      {
        products: [{ rowNumber: 1, cells: { productKey: 'P1', name: 'x' } }],
        options: [
          { rowNumber: 1, cells: { productKey: 'P1', optionName: '사이즈', optionValues: 'S', sortOrder: '1' } },
          { rowNumber: 2, cells: { productKey: 'P1', optionName: '색상', optionValues: '빨강', sortOrder: '' } },
        ],
        variants: [],
        categories: [],
        constraints: [],
        images: [],
      },
      [],
    );
    expect(normalized.options.map((o) => o.sortOrder)).toEqual([1, 1]); // 충돌 재현(normalizer 는 검증하지 않음)

    const [rec] = validator.validate([normalized]);
    expect(rec.errors.some((e) => e.sheet === 'Options' && /sortOrder 중복/.test(e.message))).toBe(true);
  });

  it('variant 조합이 상한(100)을 넘으면 에러', () => {
    const many = {
      displayName: '색상',
      values: Array.from({ length: 11 }, (_, i) => ({ displayName: `c${i}` })),
      sortOrder: 1,
    };
    const many2 = {
      displayName: '사이즈',
      values: Array.from({ length: 11 }, (_, i) => ({ displayName: `s${i}` })),
      sortOrder: 2,
    };
    const [rec] = validator.validate([record({ productKey: 'P1', name: 'x' }, [many, many2])]);
    expect(rec.errors.some((e) => /조합/.test(e.message))).toBe(true);
  });

  it('빈 name 도 기본값(productType=regular_sale, minQuantity=1)은 채운다', () => {
    const [rec] = validator.validate([record({ productKey: 'P1', name: '니트', basePrice: '29000' })]);
    expect(rec.version).toMatchObject({
      productType: 'regular_sale',
      fulfillmentKind: 'physical',
      ageRestriction: 0,
      minQuantity: 1,
    });
  });

  it('basePrice 누락은 오류다 — 0원 게시 차단', () => {
    const [rec] = validator.validate([record({ productKey: 'P1', name: '니트' })]);
    expect(rec.errors.some((e) => /basePrice/.test(e.message))).toBe(true);
  });

  it('basePrice 0 은 오류다', () => {
    const [rec] = validator.validate([record({ productKey: 'P1', name: '니트', basePrice: '0' })]);
    expect(rec.errors.some((e) => /basePrice/.test(e.message))).toBe(true);
  });

  it('유효한 basePrice/membershipPrice 는 숫자로 채워진다', () => {
    const [rec] = validator.validate([
      record({ productKey: 'P1', name: '니트', basePrice: '29000', membershipPrice: '26000' }),
    ]);
    expect(rec.errors).toEqual([]);
    expect(rec.basePrice).toBe(29000);
    expect(rec.membershipPrice).toBe(26000);
  });

  it('membershipPrice 가 basePrice 보다 크면 오류다', () => {
    const [rec] = validator.validate([
      record({ productKey: 'P1', name: '니트', basePrice: '29000', membershipPrice: '31000' }),
    ]);
    expect(rec.errors.some((e) => /membershipPrice/.test(e.message))).toBe(true);
  });

  it('variant override 가격도 검증하고 숫자로 채운다', () => {
    const rec = record({ productKey: 'P1', name: '니트', basePrice: '29000' });
    rec.variantOverrides = [
      {
        rowNumber: 1,
        comboKey: '색상=빨강',
        basePriceRaw: '31000',
        membershipPriceRaw: '',
      },
      {
        rowNumber: 2,
        comboKey: '색상=파랑',
        basePriceRaw: '-1',
        membershipPriceRaw: '',
      },
    ];
    const [out] = validator.validate([rec]);
    expect(out.variantOverrides[0].basePrice).toBe(31000);
    expect(out.errors.some((e) => e.sheet === 'Variants' && e.rowNumber === 2)).toBe(true);
  });

  it('membershipPrice 만 오버라이드한 조합은 상속된 basePrice 와 비교한다', () => {
    const rec = record({ productKey: 'P1', name: '니트', basePrice: '29000' });
    rec.variantOverrides = [
      {
        rowNumber: 1,
        comboKey: '색상=빨강',
        basePriceRaw: '',
        membershipPriceRaw: '31000',
      },
    ];
    const [out] = validator.validate([rec]);
    expect(
      out.errors.some((e) => e.sheet === 'Variants' && e.rowNumber === 1 && /membershipPrice/.test(e.message)),
    ).toBe(true);
  });

  it('basePrice 만 오버라이드한 조합은 상품의 membershipPrice 를 상속해 비교한다 — 안 그러면 회원이 더 비싸게 산다', () => {
    // 회귀 재현: basePrice=29000/membershipPrice=26000 인 상품에서 한 조합만 basePrice=25000 으로
    // 낮추고 membershipPrice 는 비워둔다. 상속을 안 하면(override.membershipPrice 가 undefined 라
    // base>member 비교 자체가 스킵) 이 조합은 base 25000 인데 상품 레벨 membership 규칙(26000, order1
    // all_variants)이 그대로 적용돼 멤버가 비회원보다 더 비싸게 사는 상품이 검증을 통과해버린다.
    const rec = record({ productKey: 'P1', name: '니트', basePrice: '29000', membershipPrice: '26000' });
    rec.variantOverrides = [
      {
        rowNumber: 1,
        comboKey: '사이즈=S',
        basePriceRaw: '25000',
        membershipPriceRaw: '',
      },
    ];
    const [out] = validator.validate([rec]);
    expect(out.variantOverrides[0].basePrice).toBe(25000);
    expect(out.variantOverrides[0].membershipPrice).toBeUndefined();
    expect(
      out.errors.some((e) => e.sheet === 'Variants' && e.rowNumber === 1 && /membershipPrice/.test(e.message)),
    ).toBe(true);
  });

  it('basePrice 가 정수가 아니면(소수) 오류다 — pricingRulesSetSchema 의 operationValue 는 int 다', () => {
    const [rec] = validator.validate([record({ productKey: 'P1', name: '니트', basePrice: '29000.5' })]);
    expect(rec.errors.some((e) => /basePrice/.test(e.message) && /정수/.test(e.message))).toBe(true);
    expect(rec.basePrice).toBeUndefined();
  });

  it('지수표기라도 정수값(2.9e4=29000)이면 basePrice 로 정상 채워진다 — 정수 가드가 과잉차단하지 않는다', () => {
    const [rec] = validator.validate([record({ productKey: 'P1', name: '니트', basePrice: '2.9e4' })]);
    expect(rec.errors).toEqual([]);
    expect(rec.basePrice).toBe(29000);
  });

  it('membershipPrice 가 정수가 아니면(소수) 오류다', () => {
    const [rec] = validator.validate([
      record({ productKey: 'P1', name: '니트', basePrice: '29000', membershipPrice: '26000.9' }),
    ]);
    expect(rec.errors.some((e) => /membershipPrice/.test(e.message) && /정수/.test(e.message))).toBe(true);
    expect(rec.membershipPrice).toBeUndefined();
  });

  it('variant override 의 basePrice 가 정수가 아니면(소수) 오류다', () => {
    const rec = record({ productKey: 'P1', name: '니트', basePrice: '29000' });
    rec.variantOverrides = [
      {
        rowNumber: 1,
        comboKey: '색상=빨강',
        basePriceRaw: '31000.5',
        membershipPriceRaw: '',
      },
    ];
    const [out] = validator.validate([rec]);
    expect(
      out.errors.some(
        (e) => e.sheet === 'Variants' && e.rowNumber === 1 && /basePrice/.test(e.message) && /정수/.test(e.message),
      ),
    ).toBe(true);
    expect(out.variantOverrides[0].basePrice).toBeUndefined();
  });
});

describe('ProductImportValidator — 구매제약', () => {
  const validator = new ProductImportValidator();

  function recordWithConstraint(raw: Partial<{ requiresMembershipRaw: string; lifetimeQuantityLimitRaw: string }>) {
    const record: ProductRecord = {
      rowNumber: 1,
      productKey: 'P1',
      raw: { productKey: 'P1', name: '니트A', basePrice: '29000' },
      version: {},
      categoryIds: [],
      categoryNames: [],
      options: [],
      variantOverrides: [],
      errors: [],
      purchaseConstraintRaw: {
        rowNumber: 1,
        requiresMembershipRaw: raw.requiresMembershipRaw ?? '',
        lifetimeQuantityLimitRaw: raw.lifetimeQuantityLimitRaw ?? '',
      },
    };
    return validator.validate([record])[0];
  }

  it('requiresMembership=Y 를 파싱한다', () => {
    const out = recordWithConstraint({ requiresMembershipRaw: 'Y' });
    expect(out.purchaseConstraint).toEqual({ requiresMembership: true, lifetimeQuantityLimit: null });
    expect(out.errors).toEqual([]);
  });

  it('lifetimeQuantityLimit 만 있어도 제약이 생긴다', () => {
    const out = recordWithConstraint({ requiresMembershipRaw: 'N', lifetimeQuantityLimitRaw: '2' });
    expect(out.purchaseConstraint).toEqual({ requiresMembership: false, lifetimeQuantityLimit: 2 });
  });

  it('둘 다 비면 제약을 만들지 않는다 (삭제 의도로 해석되는 입력을 보내지 않는다)', () => {
    const out = recordWithConstraint({});
    expect(out.purchaseConstraint).toBeUndefined();
    expect(out.errors).toEqual([]);
  });

  it('lifetimeQuantityLimit 0 이하·소수·상한 초과는 행 오류', () => {
    // '2147483648' 은 컬럼 타입(integer, 최대 2147483647)의 상한 초과 — 방치하면 프리뷰는
    // 통과하고 commit 에서 Postgres 22003 으로 그 행만 죽는다.
    for (const bad of ['0', '-1', '1.5', 'abc', '2147483648']) {
      const out = recordWithConstraint({ lifetimeQuantityLimitRaw: bad });
      expect(out.errors.some((e) => e.sheet === 'Constraints' && /lifetimeQuantityLimit/.test(e.message))).toBe(true);
      expect(out.purchaseConstraint).toBeUndefined();
    }
  });
});

describe('ProductImportValidator — SEO·도매전용', () => {
  const validator = new ProductImportValidator();

  function versionOf(raw: Record<string, string>) {
    const record: ProductRecord = {
      rowNumber: 1,
      productKey: 'P1',
      raw: { productKey: 'P1', name: '니트A', basePrice: '29000', ...raw },
      version: {},
      categoryIds: [],
      categoryNames: [],
      options: [],
      variantOverrides: [],
      errors: [],
    };
    return validator.validate([record])[0];
  }

  it('seoTitle·seoDescription 을 version 에 넣는다', () => {
    const out = versionOf({ seoTitle: '겨울 니트 추천', seoDescription: '부드러운 니트' });
    expect(out.version.seoTitle).toBe('겨울 니트 추천');
    expect(out.version.seoDescription).toBe('부드러운 니트');
    expect(out.errors).toEqual([]);
  });

  it('seoKeywords 를 | 로 쪼갠다', () => {
    const out = versionOf({ seoKeywords: '니트|겨울| 여성니트 |' });
    expect(out.version.seoKeywords).toEqual(['니트', '겨울', '여성니트']);
  });

  it('빈 SEO 칸은 version 에 키를 만들지 않는다', () => {
    const out = versionOf({ seoTitle: '  ', seoDescription: '', seoKeywords: '|' });
    expect('seoTitle' in out.version).toBe(false);
    expect('seoDescription' in out.version).toBe(false);
    expect('seoKeywords' in out.version).toBe(false);
  });

  it('seoTitle 255자 초과는 행 오류', () => {
    const out = versionOf({ seoTitle: 'ㄱ'.repeat(256) });
    expect(out.errors.some((e) => e.sheet === 'Products' && /seoTitle/.test(e.message))).toBe(true);
    expect('seoTitle' in out.version).toBe(false);
  });

  it('isWholesaleOnly 는 항상 불린으로 채워진다', () => {
    expect(versionOf({ isWholesaleOnly: 'Y' }).version.isWholesaleOnly).toBe(true);
    expect(versionOf({}).version.isWholesaleOnly).toBe(false);
  });
});

describe('ProductImportValidator — 판매기간', () => {
  const validator = new ProductImportValidator();

  function salesOf(raw: Record<string, string>) {
    const record: ProductRecord = {
      rowNumber: 1,
      productKey: 'P1',
      raw: { productKey: 'P1', name: '니트A', basePrice: '29000', ...raw },
      version: {},
      categoryIds: [],
      categoryNames: [],
      options: [],
      variantOverrides: [],
      errors: [],
    };
    return validator.validate([record])[0];
  }

  it('날짜만 주면 시작은 KST 자정, 종료는 KST 하루 끝이다', () => {
    const out = salesOf({ salesStartDate: '2026-08-01', salesEndDate: '2026-08-31' });
    // 2026-08-01 00:00 KST === 2026-07-31T15:00:00.000Z
    expect(out.salesStartDate).toBe('2026-07-31T15:00:00.000Z');
    // 2026-08-31 23:59:59.999 KST === 2026-08-31T14:59:59.999Z
    expect(out.salesEndDate).toBe('2026-08-31T14:59:59.999Z');
    expect(out.errors).toEqual([]);
  });

  it('시각까지 주면 그 분을 KST 로 해석한다', () => {
    const out = salesOf({ salesStartDate: '2026-08-01 14:30' });
    expect(out.salesStartDate).toBe('2026-08-01T05:30:00.000Z');
    expect(out.salesEndDate).toBeUndefined();
  });

  it('version 에는 넣지 않는다 (manager 가 Date 로 되살린다)', () => {
    const out = salesOf({ salesStartDate: '2026-08-01' });
    expect('salesStartDate' in out.version).toBe(false);
  });

  it('형식이 다르면 행 오류', () => {
    for (const bad of ['08/01/2026', '2026-8-1', '2026-08-01T14:30:00Z', 'Sat Aug 01 2026 09:00:00 GMT+0900']) {
      const out = salesOf({ salesStartDate: bad });
      expect(out.errors.some((e) => /salesStartDate/.test(e.message))).toBe(true);
      expect(out.salesStartDate).toBeUndefined();
    }
  });

  it('존재하지 않는 날짜는 행 오류', () => {
    const out = salesOf({ salesStartDate: '2026-02-30' });
    expect(out.errors.some((e) => /salesStartDate/.test(e.message))).toBe(true);
  });

  it('종료가 시작보다 앞이면 행 오류이고 둘 다 버린다 — 메시지가 KST 로 해석된 두 값을 보여준다', () => {
    const out = salesOf({ salesStartDate: '2026-08-31', salesEndDate: '2026-08-01' });
    const error = out.errors.find((e) => /salesEndDate/.test(e.message));
    expect(error).toBeDefined();
    expect(error!.message).toBe(
      'salesEndDate 는 salesStartDate 보다 뒤여야 합니다: 2026-08-01 23:59 <= 2026-08-31 00:00',
    );
    expect(out.salesStartDate).toBeUndefined();
    expect(out.salesEndDate).toBeUndefined();
  });

  it('빈 칸은 아무 것도 만들지 않는다', () => {
    const out = salesOf({ salesStartDate: '', salesEndDate: '  ' });
    expect(out.salesStartDate).toBeUndefined();
    expect(out.salesEndDate).toBeUndefined();
    expect(out.errors).toEqual([]);
  });

  it('formatKstMinutes 는 KST 분 단위로 되돌린다', () => {
    expect(formatKstMinutes('2026-07-31T15:00:00.000Z')).toBe('2026-08-01 00:00');
    expect(formatKstMinutes('2026-08-31T14:59:59.999Z')).toBe('2026-08-31 23:59');
  });
});
