/** 필터 박스가 만들어내는 값들. 날짜는 이미 문자열로 환산된 뒤 들어온다. */
export type SearchParamsInput = {
  q: string;
  /**
   * 값이 있으면 그대로 싣는 truthy 검사다 — 'all' sentinel 을 걸러내지 않는다.
   * 필터 박스가 "전체" 를 표현할 때 'all' 을 쓴다면, 호출부가 여기 넘기기 전에
   * 반드시 빈 문자열로 바꿔야 한다. 안 그러면 categoryId=all 이 URL 에 새고,
   * hasActiveFilter 가 그걸 활성 필터로 읽어 전체 선택 버튼이 잘못 열린다.
   */
  categoryId: string;
  supplierIds: string[];
  /** categoryId 와 같은 계약 — 'all' sentinel 은 호출부가 빈 문자열로 바꿔 넘겨야 한다. */
  createdBy: string;
  brand: string;
  status?: string;
  stock?: string;
  /** createdAt 파라미터로 실릴 JSON 문자열. 범위가 없으면 undefined. */
  createdAt?: string;
  datePreset: string;
};

/** 검색해도 살아남아야 하는 값들 — 필터가 아니라 보기 설정이다. */
export type PreservedParams = {
  size?: string | null;
  sort?: string | null;
  order?: string | null;
};

export function buildSearchParams(
  input: SearchParamsInput,
  preserved: PreservedParams
): URLSearchParams {
  const params = new URLSearchParams();
  params.set('page', '1');

  if (input.q.trim()) params.set('q', input.q.trim());
  if (input.brand.trim()) params.set('brand', input.brand.trim());
  if (input.categoryId) params.set('categoryId', input.categoryId);
  if (input.supplierIds.length > 0)
    params.set('supplierId', input.supplierIds.join(','));
  if (input.createdBy) params.set('createdBy', input.createdBy);
  if (input.status) params.set('status', input.status);
  if (input.stock) params.set('stock', input.stock);
  if (input.createdAt) params.set('createdAt', input.createdAt);
  if (input.datePreset !== 'all') params.set('datePreset', input.datePreset);

  // 정렬과 표시 개수는 필터와 독립이므로 검색해도 유지한다.
  if (preserved.size) params.set('size', preserved.size);
  if (preserved.sort) params.set('sort', preserved.sort);
  if (preserved.order) params.set('order', preserved.order);

  return params;
}
