import { ALL_COLUMN_SETS, PRODUCT_COLUMNS, IMAGE_COLUMNS, labelsOf, PRICING_SENTINEL } from './form-export.sheets';

describe('form-export.sheets', () => {
  it.each(ALL_COLUMN_SETS)('$name: 라벨이 중복되지 않는다', ({ columns }) => {
    const labels = labelsOf(columns);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it.each(ALL_COLUMN_SETS)('$name: 내부 키가 중복되지 않는다', ({ columns }) => {
    const keys = columns.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(ALL_COLUMN_SETS)('$name: 필수 열이 선택 열보다 앞에 온다', ({ columns }) => {
    const firstOptional = columns.findIndex((c) => !c.required);
    if (firstOptional === -1) return;
    const requiredAfter = columns.slice(firstOptional).filter((c) => c.required);
    expect(requiredAfter).toEqual([]);
  });

  it.each(ALL_COLUMN_SETS)('$name: 헤더가 전부 한국어다(ASCII 전용 라벨 없음)', ({ columns }) => {
    const asciiOnly = columns.filter((c) => /^[\x20-\x7E]+$/.test(c.label));
    expect(asciiOnly).toEqual([]);
  });

  it('상품 시트의 필수는 상품키·상품명·판매가 셋이다', () => {
    expect(PRODUCT_COLUMNS.filter((c) => c.required).map((c) => c.key)).toEqual(['rowKey', 'name', 'basePrice']);
  });

  it('이미지 시트는 이미지키와 원본 두 열이다', () => {
    expect(labelsOf(IMAGE_COLUMNS)).toEqual(['이미지키', '원본']);
  });

  it('가격 센티넬은 대괄호로 감싼 고정 문자열이다', () => {
    expect(PRICING_SENTINEL).toBe('[복합 가격규칙]');
  });
});
