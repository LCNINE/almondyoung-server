/**
 * "지금 보이는 표가 아직 옛 페이지인가"를 판정한다.
 *
 * 이 화면들은 `placeholderData` 로 이전 페이지를 유지해 표가 깜빡이지 않게 한다.
 * 그 대가로 **React Query 는 placeholder 가 있으면 `isLoading` 을 false 로 준다** —
 * 화면이 `isLoading` 만 보고 있으면 페이지를 넘겨도 스켈레톤이 안 뜨고 옛 행이 그대로 남아,
 * 느린 엔드포인트에서는 "페이지네이션이 안 먹는다"로 읽힌다.
 *
 * 판정은 `isPlaceholderData` **하나로만** 한다. 이 플래그는 새 쿼리키의 응답을 기다리는 동안,
 * 즉 지금 보이는 행이 요청한 페이지가 아닐 때만 켜진다. **`isFetching` 은 일부러 무시한다** —
 * 같이 보면 같은 페이지를 다시 확인하는 재요청(`refetchOnMount` + staleTime 만료)까지 걸려
 * 맞는 페이지를 보고 있는데 표가 흐려지고 버튼이 잠긴다. 쿼리 객체를 통째로 넘길 수 있게
 * 받기만 하고 판정에는 쓰지 않는다.
 *
 * 첫 로딩(`isLoading`)은 여기서 제외한다 — 그건 스켈레톤이 이미 담당한다.
 */
export function isPageChanging(query: {
  isPlaceholderData?: boolean;
  isFetching?: boolean;
  isLoading?: boolean;
}): boolean {
  if (query.isLoading) return false;
  return Boolean(query.isPlaceholderData);
}
