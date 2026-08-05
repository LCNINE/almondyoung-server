/**
 * 일괄 세션·양식 생성 두 컨트롤러가 공유하는 페이지 파라미터 파싱.
 *
 * bulk-session.controller.ts 의 모듈 지역 함수였던 것을 양식 목록(GET /product-forms)이
 * 같은 규칙을 쓰게 되면서 여기로 옮겼다. 이미지 목록의 parseImageLimit 은 상한이 달라
 * (행이 훨씬 가벼워 1000) 그대로 컨트롤러에 남긴다.
 */
export function parsePage(page: string): number {
  const parsed = Number.parseInt(page, 10);
  return Math.max(1, isNaN(parsed) ? 1 : parsed);
}

export function parseLimit(limit: string): number {
  const parsed = Number.parseInt(limit, 10);
  const fallback = isNaN(parsed) ? 20 : parsed;
  return Math.min(100, Math.max(1, fallback));
}
