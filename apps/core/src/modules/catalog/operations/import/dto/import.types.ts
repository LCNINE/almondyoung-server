export interface RawRow {
  /** 시트 데이터 행 번호 (헤더 제외, 엑셀 기준 1-based data index) */
  rowNumber: number;
  /** 헤더명 → trim 된 셀 문자열 */
  cells: Record<string, string>;
}

export interface ParsedWorkbook {
  products: RawRow[];
  options: RawRow[];
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
}

export interface RowError {
  sheet: 'Products' | 'Options';
  rowNumber: number;
  message: string;
}

/** 정규화+검증 파이프라인의 상품 단위 레코드 */
export interface ProductRecord {
  rowNumber: number;
  productKey: string;
  /** Products 시트 원본 셀 (validator 가 coerce/validate 시 참조) */
  raw: Record<string, string>;
  /** validator 가 채우는 updateVersion 스칼라 필드 */
  version: Record<string, unknown>;
  categoryIds: string[];
  categoryNames: string[];
  primaryCategoryId?: string;
  options: NormalizedOption[];
  errors: RowError[];
}
