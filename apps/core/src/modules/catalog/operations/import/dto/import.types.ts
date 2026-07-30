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
  /** 선택 시트 — 다중 카테고리 지정. 없으면 빈 배열(Products.categoryPath 하위호환) */
  categories: RawRow[];
  /** 선택 시트 — 구매제약. 없으면 빈 배열 */
  constraints: RawRow[];
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
  sheet: 'Products' | 'Options' | 'Variants' | 'Categories' | 'Constraints';
  rowNumber: number;
  message: string;
}

/** Constraints 시트 원본 — 숫자 파싱은 validator 가 한다(오류 메시지를 한 곳에 모으기 위해) */
export interface NormalizedPurchaseConstraintRaw {
  rowNumber: number;
  requiresMembershipRaw: string;
  lifetimeQuantityLimitRaw: string;
}

export interface NormalizedPurchaseConstraint {
  requiresMembership: boolean;
  /** null 이면 수량 제한 없음 (upsert DTO 의 표현과 같다) */
  lifetimeQuantityLimit: number | null;
}

/**
 * 워크북 불린 셀 해석. 엑셀에서 사람이 쓰는 표기가 갈리므로 셋 다 받는다.
 * validator·normalizer 양쪽이 쓰므로 여기 둔다(전에는 validator private 였다).
 */
export function parseBoolCell(raw: string | undefined): boolean {
  const value = (raw ?? '').trim().toLowerCase();
  return value === 'y' || value === 'true' || value === '1';
}

/**
 * ISO8601 → 'YYYY-MM-DD HH:mm' (KST). 프리뷰 표시 전용이다.
 *
 * KST 는 DST 가 없어 항상 UTC+9 이므로 오프셋을 더한 뒤 UTC 성분을 읽으면 정확하다 —
 * 서버·CI TZ 와 무관해지고 Intl 로케일 데이터에도 의존하지 않는다.
 */
export function formatKstMinutes(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 16).replace('T', ' ');
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
  /** Constraints 시트 원본. 시트에 이 상품 행이 없으면 undefined. */
  purchaseConstraintRaw?: NormalizedPurchaseConstraintRaw;
  /** validator 가 purchaseConstraintRaw 를 파싱해 채운다. 실질 제약이 없으면 undefined. */
  purchaseConstraint?: NormalizedPurchaseConstraint;
  /**
   * 판매 시작/종료. **ISO8601 문자열**이다 — Date 로 두면 payload jsonb 왕복에서 문자열로
   * 바뀌어 타입이 거짓이 된다(워커는 항상 왕복한 값을 본다). 처음부터 문자열로 들고,
   * Date 로 되살리는 지점을 manager 한 곳으로 모은다.
   */
  salesStartDate?: string;
  salesEndDate?: string;
  errors: RowError[];
}
