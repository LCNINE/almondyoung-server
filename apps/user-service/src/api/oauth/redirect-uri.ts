// RFC 8252 — public client의 redirect_uri 매칭.
// confidential client는 항상 정확 일치(RFC 6749).
// public client는 등록 URI가 loopback이면 임의 port를 허용.

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', '::1', 'localhost']);

function tryParse(uri: string): URL | null {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

function isLoopback(url: URL): boolean {
  // url.hostname normalizes to lowercase; ::1 stays as `[::1]` in href but `hostname` strips brackets.
  return LOOPBACK_HOSTNAMES.has(url.hostname);
}

export function matchRedirectUri(
  registered: string,
  incoming: string,
  clientType: 'confidential' | 'public',
): boolean {
  if (registered === incoming) return true;
  if (clientType !== 'public') return false;

  const reg = tryParse(registered);
  const inc = tryParse(incoming);
  if (!reg || !inc) return false;

  // Loopback: scheme/host/path 동일 + port 무관.
  if (reg.protocol === 'http:' && isLoopback(reg) && inc.protocol === 'http:' && isLoopback(inc)) {
    return reg.hostname === inc.hostname && reg.pathname === inc.pathname;
  }

  // Custom scheme(예: com.example.app:/callback) — exact match만 허용(이미 위에서 비교됨).
  return false;
}

export function isRedirectUriRegistered(
  registeredList: string[],
  incoming: string,
  clientType: 'confidential' | 'public',
): boolean {
  return registeredList.some((reg) => matchRedirectUri(reg, incoming, clientType));
}
