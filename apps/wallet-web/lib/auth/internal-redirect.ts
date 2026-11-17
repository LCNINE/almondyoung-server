const PROBE_ORIGIN = 'https://wallet-web.internal';

/**
 * wallet-web 내부 경로만 통과시킨다. 접두사 검사만 하면 `/\evil.example` 같은 값이
 * `new URL()` 에서 외부 origin 으로 해석돼 빠져나가므로, 실제로 파싱해 origin 이 그대로인지 본다.
 */
export function sanitizeInternalRedirect(value: string | null): string {
  if (!value || !value.startsWith('/')) return '/';

  let parsed: URL;
  try {
    parsed = new URL(value, PROBE_ORIGIN);
  } catch {
    return '/';
  }

  if (parsed.origin !== PROBE_ORIGIN) return '/';

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
