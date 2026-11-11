/**
 * 마지막으로 끝난 조회가 실패였는지. TanStack Query 는 데이터 없이 실패한 쿼리를 다시 가져오는 동안
 * 상태를 pending 으로 되돌리고 error 를 비우므로, isError 만 보면 재시도 중에 실패 안내가 사라진다.
 */
export function loadFailed(query: {
  isError: boolean;
  errorUpdatedAt: number;
  dataUpdatedAt: number;
}): boolean {
  return query.isError || query.errorUpdatedAt > query.dataUpdatedAt;
}
