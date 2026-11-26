/**
 * 문자로 보낸 추적 링크 `/r/<8자 코드>` 를 처리할 API 라우트 경로. 아니면 null.
 * 코드는 쿼리가 아니라 경로에 싣는다 — 미들웨어 rewrite 뒤에도 라우트가 받는 request.url 은 원래 주소(`/r/…`)라
 * 쿼리로 넘긴 코드는 사라진다(로컬 next dev 실측). 경로 파라미터는 rewrite 된 경로로 정해진다.
 * 미들웨어(edge)에서 쓰므로 다른 모듈을 import 하지 않는다.
 */
export function smsLinkRewritePath(pathname: string): string | null {
  const match = pathname.match(/^\/r\/([A-Za-z0-9_-]{8})$/)
  return match ? `/api/sms-link/${match[1]}` : null
}
