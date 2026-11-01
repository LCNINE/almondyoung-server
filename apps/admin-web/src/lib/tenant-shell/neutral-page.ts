// 미들웨어(Edge)·라우트가 함께 쓴다.

/**
 * 모르는 주소·준비/정지 테넌트·조회 실패의 화면 — 브랜드도, 로그인 주소도, 다른 주소로 가는 링크도 없다. 기존 셸로 떨어지면 테넌트
 * 도메인에 아몬드영 셸이 뜬다.
 */
export function neutralPageResponse(): Response {
  const html =
    '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>열 수 없는 주소</title><link rel="icon" href="data:,"></head>' +
    '<body style="font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;color:#374151">' +
    '<p>이 주소에서는 관리자 화면을 열 수 없습니다.</p></body></html>';
  return new Response(html, {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
