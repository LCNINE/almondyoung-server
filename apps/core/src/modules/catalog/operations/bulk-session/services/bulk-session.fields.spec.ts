import { flattenBundle, fieldLabel, parseFieldPath } from './bulk-session.fields';
import { computeChanges } from './bulk-session.diff';

const bundle = () => ({
  product: { name: '티셔츠', basePrice: '19000', brand: 'ACME', membershipPrice: '' },
  options: [
    {
      optionKey: 'og1',
      optionName: '색상',
      optionSortOrder: '1',
      optionValueKey: 'ov1',
      optionValueName: '빨강',
      colorCode: '#f00',
      valueSortOrder: '1',
    },
    {
      optionKey: 'og1',
      optionName: '색상',
      optionSortOrder: '1',
      optionValueKey: 'ov2',
      optionValueName: '파랑',
      colorCode: '#00f',
      valueSortOrder: '2',
    },
  ],
  variants: [{ combination: 'ov1', basePrice: '19000', membershipPrice: '', variantCode: 'V-1' }],
  categories: [
    { categoryPath: '여성패션>티셔츠', isPrimary: 'Y' },
    { categoryPath: '신상품', isPrimary: 'N' },
  ],
  constraint: { requiresMembership: 'N', lifetimeQuantityLimit: '3' },
});

describe('flattenBundle', () => {
  it('상품 스칼라를 product.<key> 로 눕힌다', () => {
    const flat = flattenBundle(bundle());
    expect(flat['product.name']).toBe('티셔츠');
    expect(flat['product.brand']).toBe('ACME');
  });

  it('빈 셀도 빈 문자열로 담는다 (없는 것과 구분하지 않는다)', () => {
    expect(flattenBundle(bundle())['product.membershipPrice']).toBe('');
  });

  it('상품키는 필드가 아니다 — 행 정체성이지 값이 아니다', () => {
    expect(flattenBundle(bundle())['product.rowKey']).toBeUndefined();
  });

  it('옵션 그룹 필드는 옵션키로, 옵션값 필드는 옵션값키로 스코프한다', () => {
    const flat = flattenBundle(bundle());
    expect(flat['optionGroup:og1.optionName']).toBe('색상');
    expect(flat['optionValue:ov2.optionValueName']).toBe('파랑');
    expect(flat['optionValue:ov1.colorCode']).toBe('#f00');
  });

  it('조합 필드는 조합키로 스코프한다', () => {
    expect(flattenBundle(bundle())['variant:ov1.variantCode']).toBe('V-1');
  });

  it('카테고리는 집합이라 정렬 조인한 단일 필드다', () => {
    // 대표 카테고리는 * 로 표시한다 — 대표만 바뀌어도 변경으로 잡혀야 한다.
    expect(flattenBundle(bundle())['category.set']).toBe('신상품|여성패션>티셔츠*');
  });

  it('구매제약 행이 없으면 필드를 담지 않는다 — 빈 문자열이 아니라 "변경 없음"이다', () => {
    const flat = flattenBundle({ ...bundle(), constraint: null });
    expect('constraint.requiresMembership' in flat).toBe(false);
    expect('constraint.lifetimeQuantityLimit' in flat).toBe(false);
  });

  it('present 를 주면 그 시트에 실제로 있던 열만 담는다', () => {
    const flat = flattenBundle(bundle(), {
      products: new Set(['name']),
      options: new Set<string>(),
      variants: new Set<string>(),
      categories: new Set<string>(),
      constraints: new Set<string>(),
    });
    expect(flat['product.name']).toBe('티셔츠');
    expect('product.brand' in flat).toBe(false);
    expect('optionValue:ov1.colorCode' in flat).toBe(false);
    // 카테고리 시트 열이 하나도 없으면 집합 필드 자체가 없다 — "카테고리 변경 없음"이다.
    expect('category.set' in flat).toBe(false);
  });

  // ─── 열 삭제와 **행 삭제**는 다른 축이다 ───
  //
  // 위 테스트는 "열이 통째로 없는" 경우만 덮는다. 실제로 훨씬 흔한 것은 **열은 그대로 두고
  // 자기가 손댈 행만 남기려고 하위 시트를 필터·삭제**하는 것이고, 그 경우 `present` 에는
  // 열이 전부 들어 있다. 그 구분이 없으면 그런 파일이 나머지 상품의 카테고리를 전량 해제하고
  // 구매제약을 푸는 변경분을 만든다(발행 후에나 발견되는 부류).
  const ALL_PRESENT = {
    products: new Set(['name', 'brand', 'basePrice', 'membershipPrice']),
    options: new Set<string>(),
    variants: new Set<string>(),
    categories: new Set(['categoryPath', 'isPrimary']),
    constraints: new Set(['requiresMembership', 'lifetimeQuantityLimit']),
  };

  it('열은 있는데 카테고리 **행**이 없으면 category.set 을 담지 않는다', () => {
    const flat = flattenBundle({ ...bundle(), categories: [] }, ALL_PRESENT);

    // `''` 로 담으면 computeChanges 가 "카테고리 전량 해제"를 변경분에 넣는다.
    expect('category.set' in flat).toBe(false);
  });

  it('열은 있는데 구매제약 **행**이 없으면 constraint.* 를 담지 않는다', () => {
    const flat = flattenBundle({ ...bundle(), constraint: null }, ALL_PRESENT);

    expect('constraint.requiresMembership' in flat).toBe(false);
    expect('constraint.lifetimeQuantityLimit' in flat).toBe(false);
  });

  it('해제는 값 칸을 비운 **행**으로 표현한다 — 그건 담긴다', () => {
    const flat = flattenBundle(
      { ...bundle(), constraint: { requiresMembership: '', lifetimeQuantityLimit: '' } },
      ALL_PRESENT,
    );

    expect(flat['constraint.requiresMembership']).toBe('');
    expect(flat['constraint.lifetimeQuantityLimit']).toBe('');
  });

  it('행 부재 규칙은 세 상태에 **같이** 걸린다 — 스냅샷(present 없음)도 마찬가지다', () => {
    // 비대칭을 만들지 않는 근거는 diff 쪽에 있다(`base[k] ?? ''`) — 아래 diff 통합 단정 참조.
    const snapshot = flattenBundle({ ...bundle(), categories: [], constraint: null });

    expect('category.set' in snapshot).toBe(false);
    expect('constraint.requiresMembership' in snapshot).toBe(false);
  });

  it('옵션/조합은 하드코딩된 상수가 아니라 ColumnDef 직접 순회 (회귀 보호)', () => {
    // 옵션과 조합이 OPTION_COLUMNS·VARIANT_COLUMNS 를 직접 순회하므로
    // 시트에 새 열이 추가되어도 수동으로 상수를 갱신할 필요가 없다.
    // 이미 정의된 모든 필드는 present 제약 없이 포함되어야 한다.
    const flat = flattenBundle(bundle());
    // 옵션 그룹 필드가 모두 포함됨
    expect(flat['optionGroup:og1.optionName']).toBe('색상');
    expect(flat['optionGroup:og1.optionSortOrder']).toBe('1');
    // 옵션 값 필드가 모두 포함됨
    expect(flat['optionValue:ov1.optionValueName']).toBe('빨강');
    expect(flat['optionValue:ov1.colorCode']).toBe('#f00');
    expect(flat['optionValue:ov1.valueSortOrder']).toBe('1');
    expect(flat['optionValue:ov2.optionValueName']).toBe('파랑');
    // 조합 필드가 모두 포함됨 (combinationLabel 제외)
    expect(flat['variant:ov1.basePrice']).toBe('19000');
    expect(flat['variant:ov1.membershipPrice']).toBe('');
    expect(flat['variant:ov1.variantCode']).toBe('V-1');
  });
});

describe('flattenBundle + computeChanges — 하위 시트 행 삭제', () => {
  const present = {
    products: new Set(['name']),
    options: new Set<string>(),
    variants: new Set<string>(),
    categories: new Set(['categoryPath', 'isPrimary']),
    constraints: new Set(['requiresMembership', 'lifetimeQuantityLimit']),
  };

  it('스냅샷에 있던 카테고리·구매제약을 업로드에서 행째 지워도 변경분이 되지 않는다', () => {
    const base = flattenBundle(bundle());
    // 작업자가 하위 시트에서 이 상품의 행만 지웠다. 열·헤더는 그대로다.
    const mine = flattenBundle({ ...bundle(), categories: [], constraint: null }, present);

    const changes = computeChanges(base, mine);

    // 이 세 키가 하나라도 들어가면 4단계가 카테고리 배정과 구매제약을 지운다.
    expect('category.set' in changes).toBe(false);
    expect('constraint.requiresMembership' in changes).toBe(false);
    expect('constraint.lifetimeQuantityLimit' in changes).toBe(false);
  });

  it('반대 방향은 그대로 잡힌다 — 없던 카테고리·구매제약을 추가하면 변경분이다', () => {
    const base = flattenBundle({ ...bundle(), categories: [], constraint: null });
    const mine = flattenBundle(bundle(), present);

    const changes = computeChanges(base, mine);

    expect(changes['category.set']).toBe('신상품|여성패션>티셔츠*');
    expect(changes['constraint.lifetimeQuantityLimit']).toBe('3');
  });

  it('값 칸을 비운 행은 여전히 "해제" 로 잡힌다 — 행 삭제와 구분된다', () => {
    const base = flattenBundle(bundle());
    const mine = flattenBundle(
      { ...bundle(), constraint: { requiresMembership: '', lifetimeQuantityLimit: '' } },
      present,
    );

    expect(computeChanges(base, mine)['constraint.lifetimeQuantityLimit']).toBe('');
  });
});

describe('parseFieldPath', () => {
  it('스코프 경로를 세 조각으로 되판다', () => {
    expect(parseFieldPath('optionValue:ov1.colorCode')).toEqual({
      scope: 'optionValue',
      scopeKey: 'ov1',
      key: 'colorCode',
    });
  });

  it('옵션 없는 상품의 빈 조합키도 판다 (스코프키가 빈 문자열인 것이 계약이다)', () => {
    expect(parseFieldPath('variant:.basePrice')).toEqual({ scope: 'variant', scopeKey: '', key: 'basePrice' });
  });

  it('조합키에 점이 있어도 마지막 조각만 열 이름이다', () => {
    expect(parseFieldPath('variant:RED.M.basePrice')).toEqual({
      scope: 'variant',
      scopeKey: 'RED.M',
      key: 'basePrice',
    });
  });

  it('스코프 없는 경로는 null 이다 — 4단계가 그건 접두어로 직접 가른다', () => {
    expect(parseFieldPath('product.name')).toBeNull();
    expect(parseFieldPath('category.set')).toBeNull();
    expect(parseFieldPath('constraint.requiresMembership')).toBeNull();
  });
});

describe('fieldLabel', () => {
  it('상품 필드는 워크북 헤더 한국어를 그대로 쓴다', () => {
    expect(fieldLabel('product.basePrice')).toBe('판매가');
  });

  it('옵션값 필드는 어느 옵션값인지까지 보여준다', () => {
    expect(fieldLabel('optionValue:ov1.colorCode')).toBe('색상코드 (옵션값 ov1)');
  });

  // 옵션 없는 상품은 흔하고, 그 상품의 단일 기본 조합은 combination 이 빈 문자열이다
  // (form-export.snapshot.reader.ts:263-267). `(.+)` 였을 때는 매칭 자체가 실패해 프리뷰에
  // `variant:.basePrice` 라는 원시 경로가 그대로 떴다.
  it('옵션 없는 상품의 조합 필드도 라벨이 된다 — 스코프키가 비면 접미를 생략한다', () => {
    expect(fieldLabel('variant:.basePrice')).toBe('판매가 (조합)');
  });

  it('모르는 경로는 경로를 그대로 돌려준다 (라벨이 없다고 죽지 않는다)', () => {
    expect(fieldLabel('mystery.field')).toBe('mystery.field');
  });
});
