/**
 * "지금 보이는 표가 아직 옛 페이지인가"를 판정한다.
 *
 * 이 화면들은 `placeholderData` 로 이전 페이지를 유지해 표가 깜빡이지 않게 한다.
 * 그 대가로 **React Query 는 placeholder 가 있으면 `isLoading` 을 false 로 준다** —
 * 화면이 `isLoading` 만 보고 있으면 페이지를 넘겨도 스켈레톤이 안 뜨고 옛 행이 그대로 남아,
 * 느린 엔드포인트에서는 "페이지네이션이 안 먹는다"로 읽힌다.
 *
 * 첫 로딩(`isLoading`)은 여기서 제외한다 — 그건 스켈레톤이 이미 담당한다.
 */
export function isPageChanging(query: {
  isPlaceholderData?: boolean;
  isFetching?: boolean;
  isLoading?: boolean;
}): boolean {
  if (query.isLoading) return false;
  return Boolean(query.isPlaceholderData || query.isFetching);
}
