'use client';

import { refreshAccessToken } from './client';

/**
 * axios `client` 를 못 쓰는 raw fetch 호출부용 401 처리.
 *
 * admin-web 의 access token 재발급 지점은 두 곳뿐이다 — 페이지 네비게이션(middleware → /auth/ensure)과
 * axios client 의 401 인터셉터. `/api/*` 는 미들웨어를 타지 않고 프록시(`app/api/proxy/_lib/forward.ts`)는
 * 쿠키를 그대로 넘기기만 하므로, axios 를 우회한 fetch 는 아무도 갱신해주지 않아 401 로 끝난다.
 * refresh 는 `refreshAccessToken` 의 Web Locks 락을 그대로 재사용한다 — 직접 `/api/auth/refresh` 를
 * 부르면 다중 탭 동시 호출로 user-service reuse detection 에 걸린다.
 *
 * 401 이면 refresh 후 1회만 재시도하고, 그래도 401 이면 세션 만료 이벤트를 발행한다.
 * body 로 stream 을 쓰는 요청은 재시도 시 소비된 상태라 쓸 수 없다 (FormData/Blob/string 은 안전).
 */
export async function fetchWithRefresh(
  input: string,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status !== 401) return res;

  try {
    await refreshAccessToken();
  } catch {
    window.dispatchEvent(new CustomEvent('auth:session-expired'));
    return res;
  }

  const retried = await fetch(input, init);
  if (retried.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:session-expired'));
  }
  return retried;
}
