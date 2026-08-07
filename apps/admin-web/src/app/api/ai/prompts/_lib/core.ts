import { cookies } from 'next/headers';

export const CORE_API_URL = (
  process.env.ALMONDYOUNG_API_URL ?? 'http://localhost:3000'
).replace(/\/+$/, '');

export const PROMPT_SCOPE = 'product-description';

/**
 * Core 는 전역 인증 가드가 걸려 있어 토큰 없이 호출하면 401 이다.
 * proxy/_lib/forward.ts 와 동일하게 accessToken/refreshToken 을 Cookie 헤더로 넘긴다.
 */
export async function coreAuthHeaders(
  extra?: Record<string, string>
): Promise<Record<string, string>> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('accessToken')?.value ?? '';
  const refreshToken = cookieStore.get('refreshToken')?.value ?? '';

  return {
    Cookie: `accessToken=${accessToken}; refreshToken=${refreshToken}`,
    ...extra,
  };
}

/** Core 가 준 도메인 에러 메시지를 그대로 전달한다 (403/409 사유가 사용자에게 보여야 한다). */
export async function coreErrorResponse(
  res: Response,
  fallbackMessage: string
): Promise<Response> {
  let message = fallbackMessage;
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) {
      message = body.message.join('\n');
    } else if (body.message) {
      message = body.message;
    }
  } catch {
    // Core 가 JSON 이 아닌 응답을 준 경우 — fallbackMessage 유지
  }

  return Response.json({ message }, { status: res.status });
}
