import { DEFAULT_COLUMN_KEYS, EXPORT_COLUMNS, ExportRow, resolveColumns } from './product-export.columns';

const row = (over: Partial<ExportRow> = {}): ExportRow =>
  ({
    masterId: 'm1',
    versionId: 'v1',
    name: '상품',
    thumbnail: null,
    brand: '브랜드',
    productCode: 'cafe24-1',
    supplyPrice: 1200,
    supplierId: 's1',
    supplierName: '한국',
    hideMembershipPriceForNonMembers: false,
    isVisibleToMembersOnly: false,
    isOverseas: false,
    isMembershipOnly: false,
    status: 'active',
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T01:00:00.000Z',
    optionGroupNames: ['색상', '사이즈'],
    variantCount: 6,
    priceSummary: {
      minBasePrice: 1000,
      maxBasePrice: 2000,
      minMembershipPrice: 900,
      maxMembershipPrice: 900,
      hasTieredPrices: true,
    },
    soldOutState: 'none',
    ...over,
  }) as ExportRow;

const byKey = (key: string) => EXPORT_COLUMNS.find((c) => c.key === key)!;

describe('상품 내보내기 항목 카탈로그', () => {
  it('항목 key 는 중복이 없다 — 양식에 저장되는 식별자라 겹치면 열이 덮인다', () => {
    const keys = EXPORT_COLUMNS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('기본 양식의 key 는 모두 카탈로그에 존재한다', () => {
    const keys = new Set(EXPORT_COLUMNS.map((c) => c.key));
    for (const key of DEFAULT_COLUMN_KEYS) expect(keys.has(key)).toBe(true);
  });

  it('요청한 순서대로 열을 만든다', () => {
    const resolved = resolveColumns(['supplyPrice', 'name', 'brand']);
    expect(resolved.map((c) => c.key)).toEqual(['supplyPrice', 'name', 'brand']);
  });

  it('모르는 key 는 버리고 나머지로 진행한다 — 옛 양식 때문에 내보내기가 실패하면 안 된다', () => {
    expect(resolveColumns(['name', '삭제된항목', 'supplyPrice']).map((c) => c.key)).toEqual(['name', 'supplyPrice']);
  });

  it('아는 key 가 하나도 없으면 기본 양식으로 되돌린다', () => {
    expect(resolveColumns(['전부', '모르는', '것']).map((c) => c.key)).toEqual(DEFAULT_COLUMN_KEYS);
  });

  it('빈 배열·undefined 는 기본 양식', () => {
    expect(resolveColumns([]).map((c) => c.key)).toEqual(DEFAULT_COLUMN_KEYS);
    expect(resolveColumns(undefined).map((c) => c.key)).toEqual(DEFAULT_COLUMN_KEYS);
  });

  it('가격은 최소=최대면 숫자, 다르면 범위 문자열', () => {
    expect(byKey('basePrice').value(row())).toBe('1000 ~ 2000');
    expect(byKey('membershipPrice').value(row())).toBe(900);
  });

  it('가격 요약이 없으면 빈칸(null)이다 — 0 으로 채우면 0원으로 읽힌다', () => {
    expect(byKey('basePrice').value(row({ priceSummary: null }))).toBeNull();
    expect(byKey('supplyPrice').value(row({ supplyPrice: null }))).toBeNull();
  });

  it('불리언은 Y/N, 상태는 한국어 라벨', () => {
    expect(byKey('isOverseas').value(row({ isOverseas: true }))).toBe('Y');
    expect(byKey('isOverseas').value(row({ isOverseas: false }))).toBe('N');
    expect(byKey('status').value(row({ status: 'draft' }))).toBe('작성중');
    expect(byKey('soldOutState').value(row({ soldOutState: 'partial' }))).toBe('부분품절');
  });

  it('옵션제목은 슬래시로 잇고, 없으면 빈칸', () => {
    expect(byKey('optionGroupNames').value(row())).toBe('색상 / 사이즈');
    expect(byKey('optionGroupNames').value(row({ optionGroupNames: [] }))).toBeNull();
  });

  it('공급처 이름이 없으면 빈칸 — id 를 노출하지 않는다', () => {
    expect(byKey('supplierName').value(row({ supplierName: null }))).toBeNull();
  });
});
