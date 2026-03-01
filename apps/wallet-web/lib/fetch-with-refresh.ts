// CSR 전용: 401 응답 시 토큰 갱신 후 재시도하는 fetch 래퍼.
// credentials: 'include'를 포함한 요청에만 사용해야 한다.
export async function fetchWithRefresh(url: string, options: RequestInit): Promise<Response> {
  const res = await fetch(url, options);
  if (res.status !== 401) return res;

  // refreshToken 쿠키는 httpOnly라 JS가 직접 읽을 수 없으므로
  // Route Handler를 통해 user-service로 프록시한다.
  const refreshRes = await fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include', // refreshToken 쿠키 자동 전송
  });
  if (!refreshRes.ok) return res; // refresh 실패 시 원래 401 반환

  // 브라우저가 새 accessToken 쿠키를 저장한 뒤 원래 요청 재시도
  return fetch(url, options);
}
