/**
 * The backend today reads tokens from cookies (admin-web proxy sets them). A
 * native client can attach either a Bearer header or a Cookie header. Which one
 * the backend accepts is verification item §13.1 — this switch makes it a
 * one-line config change.
 */
export function authHeader(
  token: string,
  mode: 'bearer' | 'cookie'
): Record<string, string> {
  return mode === 'bearer'
    ? { Authorization: `Bearer ${token}` }
    : { Cookie: `accessToken=${token}` };
}
