/**
 * 분류 토글 ↔ URL 파라미터(status/stock) 변환.
 *
 * 판매 상태와 재고 상태는 서버에서 별도 파라미터지만, 화면에서는 하나의
 * 분류 버튼 그룹으로 다룬다. 품절/부분품절은 판매중(active)인 상품에만
 * 의미가 있으므로 status=active 를 함께 싣는다.
 */
export type Classification =
  | 'all'
  | 'active'
  | 'inactive'
  | 'draft'
  | 'sold_out'
  | 'partial';

export type ClassificationParams = { status?: string; stock?: string };

const CLASSIFICATION_PARAMS: Record<Classification, ClassificationParams> = {
  all: {},
  active: { status: 'active' },
  inactive: { status: 'inactive' },
  draft: { status: 'draft' },
  sold_out: { status: 'active', stock: 'sold_out' },
  partial: { status: 'active', stock: 'partial' },
};

export const CLASSIFICATION_OPTIONS: {
  value: Classification;
  label: string;
}[] = [
  { value: 'all', label: '전체' },
  { value: 'active', label: '판매함' },
  { value: 'inactive', label: '판매안함' },
  { value: 'draft', label: '작성중' },
  { value: 'sold_out', label: '품절' },
  { value: 'partial', label: '부분품절' },
];

/** 다중 선택 칩 토글. 빈 배열 = 전체. */
export function toggle(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value];
}

export function classificationToParams(
  value: Classification
): ClassificationParams {
  return CLASSIFICATION_PARAMS[value] ?? {};
}

export function classificationFromParams(
  status?: string | null,
  stock?: string | null
): Classification {
  // 재고 조건이 더 좁으므로 우선한다.
  if (stock === 'sold_out' || stock === 'partial') return stock;
  if (status === 'active' || status === 'inactive' || status === 'draft') {
    return status;
  }
  return 'all';
}
