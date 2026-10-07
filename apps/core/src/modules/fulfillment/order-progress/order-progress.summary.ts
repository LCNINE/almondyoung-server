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
