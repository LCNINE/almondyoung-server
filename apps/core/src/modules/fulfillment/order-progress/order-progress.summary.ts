import { ORDER_PROGRESS_STAGES, OrderProgressStage, isOrderProgressStage } from './order-progress.thresholds';

export type SummaryRow = { stage: string; state: string; open: number; stuck: number; gaveUp: number; oldest: string | null };
export type StageSummary = {
  stage: OrderProgressStage;
  open: number;
  stuck: number;
  gaveUp: number;
  oldestEnteredAt: string | null;
  states: { state: string; open: number; stuck: number; gaveUp: number }[];
};
export type OrderProgressSummary = { evaluatedAt: string | null; stages: StageSummary[] };

/** 0건 단계도 채워 보낸다 — 화면이 단계 목록을 따로 들지 않게(스펙 §7.1). */
export function assembleSummary(rows: SummaryRow[], evaluatedAt: string | null): OrderProgressSummary {
  const byStage = new Map<OrderProgressStage, StageSummary>(
    ORDER_PROGRESS_STAGES.map((stage) => [stage, { stage, open: 0, stuck: 0, gaveUp: 0, oldestEnteredAt: null, states: [] }]),
  );
  for (const row of rows) {
    const stage: OrderProgressStage = isOrderProgressStage(row.stage) ? row.stage : 'unclassified';
    const acc = byStage.get(stage)!;
    acc.open += row.open;
    acc.stuck += row.stuck;
    acc.gaveUp += row.gaveUp;
    if (row.oldest !== null && (acc.oldestEnteredAt === null || row.oldest < acc.oldestEnteredAt)) {
      acc.oldestEnteredAt = row.oldest;
    }
    acc.states.push({ state: row.state, open: row.open, stuck: row.stuck, gaveUp: row.gaveUp });
  }
  for (const acc of byStage.values()) acc.states.sort((a, b) => b.open - a.open);
  return { evaluatedAt, stages: Array.from(byStage.values()) };
}

/** 정체 보드 목록 행의 «자동 멈춤» 배지 하나(리컨실러 스펙 §6·D18) */
export type GaveUpBadge = { rule: string; row: number; since: string; lastError: string | null };
export type GaveUpMark = {
  salesOrderId: string | null;
  rule: string;
  row: number;
  since: Date | null;
  lastError: string | null;
};

/**
 * 포기 표시를 주문별 배지로 묶는다. 주문 규칙은 주문당 행이 하나지만 상자 규칙은 한 주문의 여러 상자에서 포기할 수 있다 —
 * 같은 규칙은 가장 이른 포기 하나만 남긴다(배지가 «#25 #25» 로 겹치지 않게). 행 번호 순.
 */
export function groupGaveUpMarks(marks: GaveUpMark[]): Map<string, GaveUpBadge[]> {
  const byOrder = new Map<string, Map<string, GaveUpBadge>>();
  for (const m of marks) {
    if (!m.salesOrderId || !m.since) continue;
    const rules = byOrder.get(m.salesOrderId) ?? new Map<string, GaveUpBadge>();
    const since = m.since.toISOString();
    const prev = rules.get(m.rule);
    if (!prev || since < prev.since) rules.set(m.rule, { rule: m.rule, row: m.row, since, lastError: m.lastError });
    byOrder.set(m.salesOrderId, rules);
  }
  return new Map(
    [...byOrder].map(([id, rules]) => [
      id,
      [...rules.values()].sort((a, b) => a.row - b.row || a.rule.localeCompare(b.rule)),
    ]),
  );
}
