export interface RawRow {
  /** 시트 데이터 행 번호 (헤더 제외, 엑셀 기준 1-based data index) */
  rowNumber: number;
  /** 헤더명 → trim 된 셀 문자열 */
  cells: Record<string, string>;
}

export interface ParsedWorkbook {
  products: RawRow[];
  options: RawRow[];
  /** 선택 시트 — 없으면 빈 배열 */
  variants: RawRow[];
}

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
}

export interface NormalizedOption {
  displayName: string;
  values: { displayName: string }[];
  /** Options 시트 sortOrder. 비어 있으면 시트 등장 순서(0-based+1) */
  sortOrder: number;
}

export interface RowError {
  sheet: 'Products' | 'Options' | 'Variants';
  rowNumber: number;
  message: string;
}

export interface NormalizedVariantOverride {
  rowNumber: number;
  comboKey: string;
  /** 숫자 파싱은 validator 가 한다 (오류 메시지를 한 곳에 모으기 위해) */
  basePriceRaw: string;
  membershipPriceRaw: string;
  /** validator 가 basePriceRaw 를 파싱해 채운다. 공란(=Products 기본가 상속)이면 undefined. */
  basePrice?: number;
  /** validator 가 membershipPriceRaw 를 파싱해 채운다. 공란이면 undefined. */
  membershipPrice?: number;
  variantCode?: string;
}

/** 조합 정규화 키 — 축 순서를 무시하기 위해 옵션명으로 정렬한다 */
export function comboKey(pairs: Array<{ name: string; value: string }>): string {
  return [...pairs]
    .map((p) => ({ name: p.name.trim(), value: p.value.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => `${p.name}=${p.value}`)
    .join(';');
}

/** 정규화+검증 파이프라인의 상품 단위 레코드 */
export interface ProductRecord {
  rowNumber: number;
  productKey: string;
  /** Products 시트 원본 셀 (validator 가 coerce/validate 시 참조) */
  raw: Record<string, string>;
  /** validator 가 채우는 updateVersion 스칼라 필드 */
  version: Record<string, unknown>;
  /** validator 가 raw.basePrice 를 파싱해 채운다 (필수 — pricing rules 의 base_price 규칙에 쓰인다) */
  basePrice?: number;
  /** validator 가 raw.membershipPrice 를 파싱해 채운다 (선택) */
  membershipPrice?: number;
  categoryIds: string[];
  categoryNames: string[];
  primaryCategoryId?: string;
  options: NormalizedOption[];
  variantOverrides: NormalizedVariantOverride[];
  errors: RowError[];
}
