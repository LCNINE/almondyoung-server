/** 목록 한 쪽의 최대 건수(HTTP). */
export const MASTER_LIST_MAX_LIMIT = 100;

const DEFAULT_LIMIT = 15;

/**
 * 상품 목록의 쪽·건수. page 가 없어도 «전부»가 아니라 1 쪽이다 — 예전엔 page 가 없으면
 * limit 을 무시하고 전량을 줬고, 그 요청 하나가 core 를 OOM 으로 내렸다(2026-11-02).
 * ids 조회는 limit 이 없으면 id 수만큼 준다(리뷰·QnA 화면이 한 쪽 분량 id 로 부른다).
 * maxLimit 은 HTTP 를 거치지 않는 내부 호출(엑셀 내보내기 묶음)만 올린다.
 */
export function resolveMasterListPaging(
  filters: { page?: number; limit?: number; ids?: string[] },
  maxLimit: number = MASTER_LIST_MAX_LIMIT,
): { page: number; limit: number; offset: number } {
  const page = filters.page ?? 1;
  const requested = filters.limit ?? (filters.ids?.length ? filters.ids.length : DEFAULT_LIMIT);
  const limit = Math.min(requested, maxLimit);
  return { page, limit, offset: (page - 1) * limit };
}
