import { validateFields } from './bulk-session.validator';
import { PRICING_SENTINEL } from './form-export.sheets';

const row = (product: Record<string, string>, over: Partial<Parameters<typeof validateFields>[0]> = {}) => ({
  rowNumber: 1,
  rowKey: 'P-1',
  kind: 'create' as const,
  bundle: { product, options: [], variants: [], categories: [], constraint: null },
  errors: [],
  ...over,
});
const messages = (errors: { message: string }[]) => errors.map((e) => e.message).join(' | ');

describe('validateFields — 신규 행', () => {
  it('상품명이 없으면 오류다', () => {
    expect(messages(validateFields(row({ basePrice: '1000' }), { pricingEditable: true }))).toContain('상품명');
  });

  it('판매가가 없거나 0 이면 오류다 (판매가 없이 게시할 수 없다)', () => {
    expect(messages(validateFields(row({ name: 'x', basePrice: '0' }), { pricingEditable: true }))).toContain('판매가');
  });

  it('판매가가 소수면 오류다 (원화는 소수 단위가 없다)', () => {
    expect(messages(validateFields(row({ name: 'x', basePrice: '1000.5' }), { pricingEditable: true }))).toContain(
      '정수',
    );
  });

  it('멤버십가가 판매가보다 크면 오류다', () => {
    const errors = validateFields(row({ name: 'x', basePrice: '1000', membershipPrice: '2000' }), {
      pricingEditable: true,
    });
    expect(messages(errors)).toContain('이하');
  });

  it('varchar 상한을 넘으면 오류다 — 브랜드 100자', () => {
    const errors = validateFields(row({ name: 'x', basePrice: '1', brand: 'ㄱ'.repeat(101) }), {
      pricingEditable: true,
    });
    expect(messages(errors)).toContain('100자');
  });

  it('varchar 상한을 넘으면 오류다 — 상품명 255자', () => {
    const errors = validateFields(row({ name: 'ㄱ'.repeat(256), basePrice: '1' }), { pricingEditable: true });
    expect(messages(errors)).toContain('255자');
  });

  it('상품유형이 정해진 값 밖이면 오류다', () => {
    const errors = validateFields(row({ name: 'x', basePrice: '1', productType: 'weird' }), { pricingEditable: true });
    expect(messages(errors)).toContain('상품유형');
  });

  it('판매기간은 YYYY-MM-DD 또는 YYYY-MM-DD HH:mm 만 받는다', () => {
    const errors = validateFields(row({ name: 'x', basePrice: '1', salesStartDate: '08/01/2026' }), {
      pricingEditable: true,
    });
    expect(messages(errors)).toContain('형식');
  });

  it('존재하지 않는 날짜를 잡는다', () => {
    const errors = validateFields(row({ name: 'x', basePrice: '1', salesEndDate: '2026-02-30' }), {
      pricingEditable: true,
    });
    expect(messages(errors)).toContain('존재하지 않는 날짜');
  });

  it('판매종료가 판매시작보다 앞서면 오류다', () => {
    const errors = validateFields(
      row({ name: 'x', basePrice: '1', salesStartDate: '2026-08-10', salesEndDate: '2026-08-01' }),
      { pricingEditable: true },
    );
    expect(messages(errors)).toContain('판매종료');
  });

  it('부가이미지키는 5개까지다', () => {
    const errors = validateFields(row({ name: 'x', basePrice: '1', additionalImageKeys: 'a|b|c|d|e|f' }), {
      pricingEditable: true,
    });
    expect(messages(errors)).toContain('5개');
  });

  it('평생구매한도는 integer 범위여야 한다', () => {
    const r = row({ name: 'x', basePrice: '1' });
    r.bundle.constraint = { requiresMembership: 'N', lifetimeQuantityLimit: '9999999999' };
    expect(messages(validateFields(r, { pricingEditable: true }))).toContain('2147483647');
  });
});

describe('validateFields — 가격 센티넬', () => {
  it('복합 가격규칙 상품은 센티넬이 그대로면 통과다', () => {
    const r = row({ name: 'x', basePrice: PRICING_SENTINEL, membershipPrice: PRICING_SENTINEL }, { kind: 'update' });
    expect(validateFields(r, { pricingEditable: false })).toEqual([]);
  });

  it('복합 가격규칙 상품의 판매가를 고치면 오류다', () => {
    const r = row({ name: 'x', basePrice: '19000' }, { kind: 'update' });
    expect(messages(validateFields(r, { pricingEditable: false }))).toContain('복합 가격규칙');
  });

  it('단순 가격 상품에 센티넬을 적어 넣으면 오류다', () => {
    const r = row({ name: 'x', basePrice: PRICING_SENTINEL }, { kind: 'update' });
    expect(messages(validateFields(r, { pricingEditable: true }))).toContain('판매가');
  });

  it('수정 행은 판매가가 비어 있어도 오류가 아니다 (변경 없음이다)', () => {
    const r = row({ name: 'x', basePrice: '' }, { kind: 'update' });
    expect(validateFields(r, { pricingEditable: true })).toEqual([]);
  });
});

const rowWithVariant = (
  product: Record<string, string>,
  variant: Record<string, string>,
  over: Partial<Parameters<typeof validateFields>[0]> = {},
) => ({
  rowNumber: 1,
  rowKey: 'P-1',
  kind: 'update' as const,
  bundle: {
    product,
    options: [],
    variants: [{ rowKey: 'P-1', combination: 'RED-M', ...variant }],
    categories: [],
    constraint: null,
  },
  errors: [],
  ...over,
});

describe('validateFields — 조합 가격', () => {
  it('복합 가격규칙 상품은 조합 센티넬이 그대로면 통과다', () => {
    const r = rowWithVariant({ name: 'x', basePrice: PRICING_SENTINEL }, { basePrice: PRICING_SENTINEL });
    expect(validateFields(r, { pricingEditable: false })).toEqual([]);
  });

  it('복합 가격규칙 상품의 조합 판매가를 고치면 오류다', () => {
    const r = rowWithVariant({ name: 'x', basePrice: PRICING_SENTINEL }, { basePrice: '19000' });
    expect(messages(validateFields(r, { pricingEditable: false }))).toContain('복합 가격규칙');
  });

  it('조합 판매가가 0 이면 오류다', () => {
    const r = rowWithVariant({ name: 'x', basePrice: '10000' }, { basePrice: '0' });
    expect(messages(validateFields(r, { pricingEditable: true }))).toContain('판매가');
  });

  it('조합 멤버십가가 조합 판매가보다 크면 오류다', () => {
    const r = rowWithVariant({ name: 'x', basePrice: '10000' }, { basePrice: '10000', membershipPrice: '20000' });
    expect(messages(validateFields(r, { pricingEditable: true }))).toContain('이하');
  });

  it('조합에 판매가 오버라이드가 없으면 상품 판매가를 상속해 멤버십가와 비교한다', () => {
    const r = rowWithVariant({ name: 'x', basePrice: '10000' }, { membershipPrice: '20000' });
    expect(messages(validateFields(r, { pricingEditable: true }))).toContain('이하');
  });

  it('조합 오류는 rowNumber 가 0 이고 메시지에 조합 식별자를 담는다', () => {
    const r = rowWithVariant({ name: 'x', basePrice: '10000' }, { basePrice: '0' });
    const errors = validateFields(r, { pricingEditable: true });
    const variantError = errors.find((e) => e.sheet === '조합');
    expect(variantError?.rowNumber).toBe(0);
    expect(variantError?.message).toContain('RED-M');
  });
});

describe('validateFields — 조합·옵션 varchar 상한', () => {
  it('조합 품목코드가 100자를 넘으면 오류다', () => {
    const r = rowWithVariant({ name: 'x', basePrice: '10000' }, { variantCode: 'A'.repeat(101) });
    const errors = validateFields(r, { pricingEditable: true });
    const variantError = errors.find((e) => e.sheet === '조합');
    expect(variantError?.rowNumber).toBe(0);
    expect(messages(errors)).toContain('100자');
  });

  it('옵션값 색상코드가 7자를 넘으면 오류다', () => {
    const r = {
      rowNumber: 1,
      rowKey: 'P-1',
      kind: 'create' as const,
      bundle: {
        product: { name: 'x', basePrice: '1' },
        options: [
          {
            rowKey: 'P-1',
            optionKey: 'color',
            optionName: '색상',
            optionValueKey: 'red',
            optionValueName: '빨강',
            colorCode: '#1234567',
          },
        ],
        variants: [],
        categories: [],
        constraint: null,
      },
      errors: [],
    };
    const errors = validateFields(r, { pricingEditable: true });
    const optionError = errors.find((e) => e.sheet === '옵션');
    expect(optionError?.rowNumber).toBe(0);
    expect(optionError?.message).toContain('7자');
  });
});

describe('validateFields — 정수·금액 칸', () => {
  it('연령제한이 0~100 범위를 벗어나면 오류다', () => {
    const errors = validateFields(row({ name: 'x', basePrice: '1', ageRestriction: '150' }), { pricingEditable: true });
    expect(messages(errors)).toContain('연령제한');
  });

  it('최소구매수량이 정수가 아니면 오류다', () => {
    const errors = validateFields(row({ name: 'x', basePrice: '1', minQuantity: '1개' }), { pricingEditable: true });
    expect(messages(errors)).toContain('최소구매수량');
  });

  it('최대구매수량이 2147483647 을 넘으면 오류다 (Postgres integer 상한)', () => {
    const errors = validateFields(row({ name: 'x', basePrice: '1', maxQuantity: '9999999999' }), {
      pricingEditable: true,
    });
    const msg = messages(errors);
    expect(msg).toContain('최대구매수량');
    expect(msg).toContain('2147483647');
  });

  it('최대구매수량이 최소구매수량보다 작으면 오류다', () => {
    const errors = validateFields(row({ name: 'x', basePrice: '1', minQuantity: '5', maxQuantity: '2' }), {
      pricingEditable: true,
    });
    expect(messages(errors)).toContain('최대구매수량');
  });

  it('시중가가 음수면 오류다', () => {
    const errors = validateFields(row({ name: 'x', basePrice: '1', marketPrice: '-1' }), { pricingEditable: true });
    expect(messages(errors)).toContain('시중가');
  });
});

describe('validateFields — Y/N 형식', () => {
  it('해외직구가 Y/N 밖의 값이면 오류다', () => {
    const errors = validateFields(row({ name: 'x', basePrice: '1', isOverseas: 'true' }), { pricingEditable: true });
    expect(messages(errors)).toContain('해외직구');
  });

  it('멤버십필요가 Y/N 밖의 값이면 오류다', () => {
    const r = row({ name: 'x', basePrice: '1' });
    r.bundle.constraint = { requiresMembership: 'yes', lifetimeQuantityLimit: '' };
    const errors = validateFields(r, { pricingEditable: true });
    expect(messages(errors)).toContain('멤버십필요');
  });
});
