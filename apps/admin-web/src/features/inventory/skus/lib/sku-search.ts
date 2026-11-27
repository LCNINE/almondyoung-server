/**
 * 서버가 통합 검색어(q)를 적용했으면 같은 값을 응답 q 로 돌려준다.
 * q 를 모르는 서버는 그 값을 조용히 버리고 전체 목록을 주므로, 그 목록을 검색 결과처럼 보이지 않게 가른다.
 */
export function skuSearchIgnored(
  requestedQ: string | undefined,
  response: { q?: string } | undefined
): boolean {
  if (!requestedQ || !response) return false;

  return response.q !== requestedQ;
}

export const SKU_SEARCH_IGNORED_MESSAGE =
  '서버가 아직 이 검색을 지원하지 않아 결과를 보여 드릴 수 없어요. SKU명·SKU 코드·바코드는 필터 추가에서 찾아 주세요.';

export function skuSearchEmptyMessage(q: string | undefined): string {
  if (!q) return 'SKU 데이터가 없습니다.';

  return `«${q}»와 맞는 SKU가 없어요. SKU명은 일부만, SKU 코드와 바코드는 전체 번호로 찾아요.`;
}
