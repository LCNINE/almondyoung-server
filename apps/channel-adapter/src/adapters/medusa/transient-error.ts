/**
 * Medusa 가 잠깐 못 받는 상태인지 판정한다. 배포·재기동 공백처럼 저절로 풀리는 실패라
 * 워커가 장기 스케줄로 재시도한다.
 *
 * 문자열이 아니라 status 로 고른다 — SDK 가 문구를 바꾸면 조용히 안 걸린다.
 * status 는 `medusa.client.ts` 의 rethrow 가 `cause` 로 넘긴 원본 FetchError 에 있다.
 */

const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/** 연결이 맺히지도 못한 경우 — status 가 없다. */
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENOTFOUND',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** 깊이 제한이 순환 cause 를 끊는다. */
function* causeChain(error: unknown, maxDepth = 5): Generator<Record<string, unknown>> {
  let current = error;
  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (typeof current !== 'object' || current === null) return;
    yield current as Record<string, unknown>;
    current = (current as { cause?: unknown }).cause;
  }
}

export function isTransientMedusaError(error: unknown): boolean {
  for (const node of causeChain(error)) {
    const status = node.status ?? node.statusCode;
    if (typeof status === 'number' && TRANSIENT_STATUSES.has(status)) return true;

    const code = node.code;
    if (typeof code === 'string' && TRANSIENT_CODES.has(code)) return true;
  }
  return false;
}
