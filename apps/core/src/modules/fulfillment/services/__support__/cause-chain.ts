/**
 * drizzle-orm 0.44.x 는 모든 쿼리 에러를 DrizzleQueryError 로 감싼다 — 최상위 `.message` 는
 * "Failed query: ...\nparams: ..." 뿐이고 실제 Postgres 메시지는 `.cause` 에만 남는다. jest 의
 * `toThrow(regex)` 는 최상위 `.message` 만 보므로 그걸로는 절대 매치되지 않는다. cause 체인을
 * 직접 걸어서 합친 문자열로 검사한다 (replenishment 통계·규칙 스키마 통합 스펙 공용, #743 A/B).
 */
export function causeChainMessage(error: unknown, depth = 5): string {
  const parts: string[] = [];
  let current: (Error & { cause?: unknown }) | undefined = error instanceof Error ? error : undefined;
  for (let i = 0; current && i < depth; i += 1) {
    parts.push(current.message);
    current = current.cause instanceof Error ? current.cause : undefined;
  }
  return parts.join(' ');
}
