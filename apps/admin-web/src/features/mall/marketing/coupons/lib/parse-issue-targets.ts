/**
 * 발급 다이얼로그의 입력 파싱과 결과 집계 — **순수 함수**.
 *
 * 다이얼로그(`.tsx`)는 admin-web 의 jest transform(`^.+\.(t|j)s$`) 밖이라 그 안에 둔 로직은
 * 테스트가 실행조차 되지 않는다. 판정은 반드시 여기 있어야 한다.
 */

export type ResolvedTarget = { input: string; customerId: string; label: string };

export type IssueResponse = {
  issued: { customer_id: string; granted: number }[];
  skipped: { customer_id: string; reason: string }[];
};

export type IssueSummary = {
  grantedTotal: number;
  succeeded: { label: string; granted: number }[];
  failed: { label: string; reason: string }[];
};

/** 여러 줄 입력을 대상 목록으로. 개행·쉼표 구분, 공백 제거, 중복 제거(순서 유지). */
export function parseIssueTargets(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of (raw ?? '').split(/[\n,]/)) {
    const t = token.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * 서버 응답을 사람이 읽는 표로. **응답에 없는 고객은 `unknown` 으로 남긴다** —
 * 조용히 성공으로 세면 「발급됐다고 했는데 안 됐다」가 된다.
 */
export function summarizeIssueResult(
  result: IssueResponse,
  resolved: ResolvedTarget[],
): IssueSummary {
  const grantedById = new Map(result.issued.map((i) => [i.customer_id, i.granted]));
  const reasonById = new Map(result.skipped.map((s) => [s.customer_id, s.reason]));

  const succeeded: IssueSummary['succeeded'] = [];
  const failed: IssueSummary['failed'] = [];

  for (const target of resolved) {
    const granted = grantedById.get(target.customerId);
    if (granted != null) {
      succeeded.push({ label: target.label, granted });
      continue;
    }
    failed.push({ label: target.label, reason: reasonById.get(target.customerId) ?? 'unknown' });
  }

  return {
    grantedTotal: succeeded.reduce((s, x) => s + x.granted, 0),
    succeeded,
    failed,
  };
}
