// src/lib/api/domains/channel/reservation-reconcile-runs.shape.ts
//
// «Medusa 예약 대사»(#1247) 회차 응답의 순수 정형화 함수. 서버 원형은
// apps/channel-adapter/src/controllers/reservation-reconcile-runs.controller.ts — 본문이 `{ data }` 라
// «`data` 키가 있으면 한 겹 벗긴다». 모양이 다르면 null (빈 목록으로 그리면 «정상»으로 읽힌다).

export type ReconcileRunStatus = 'applied' | 'halted' | 'skipped' | 'running';

export interface ReconcileRunExample {
  lineItemId: string;
  current: number;
  target: number;
}

/** `medusa_reservation_reconcile_runs` 행. 시각은 JSON 이라 ISO 문자열이다. */
export interface ReconcileRunDto {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: ReconcileRunStatus;
  candidates: number;
  /** 한도 판정에 센 고칠 줄 — 멈춘 회차가 보이는 숫자. 후보(candidates)와 다르다 */
  plannedFixes: number;
  fixes: number;
  fixFailures: number;
  deferred: number;
  unknown: number;
  oldestUnknownAt: string | null;
  examples: ReconcileRunExample[];
  error: string | null;
  closedAt: string | null;
}

export interface ReconcileRunsOverview {
  open: ReconcileRunDto[];
  latest: ReconcileRunDto | null;
}

const STATUSES = ['applied', 'halted', 'skipped', 'running'];

function asRecord(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function unwrap(body: unknown): unknown {
  const record = asRecord(body);
  return record && 'data' in record ? record.data : body;
}

function nullableString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

function toExample(raw: unknown): ReconcileRunExample | null {
  const v = asRecord(raw);
  if (
    !v ||
    typeof v.lineItemId !== 'string' ||
    typeof v.current !== 'number' ||
    typeof v.target !== 'number'
  )
    return null;
  return { lineItemId: v.lineItemId, current: v.current, target: v.target };
}

function toRun(raw: unknown): ReconcileRunDto | null {
  const v = asRecord(raw);
  if (
    !v ||
    typeof v.id !== 'string' ||
    typeof v.startedAt !== 'string' ||
    typeof v.status !== 'string' ||
    !STATUSES.includes(v.status)
  )
    return null;
  const examples = Array.isArray(v.examples)
    ? v.examples.map(toExample).filter((e): e is ReconcileRunExample => !!e)
    : [];
  return {
    id: v.id,
    startedAt: v.startedAt,
    finishedAt: nullableString(v.finishedAt),
    status: v.status as ReconcileRunStatus,
    candidates: num(v.candidates),
    plannedFixes: num(v.plannedFixes),
    fixes: num(v.fixes),
    fixFailures: num(v.fixFailures),
    deferred: num(v.deferred),
    unknown: num(v.unknown),
    oldestUnknownAt: nullableString(v.oldestUnknownAt),
    examples,
    error: nullableString(v.error),
    closedAt: nullableString(v.closedAt),
  };
}

export function toReconcileRun(body: unknown): ReconcileRunDto | null {
  return toRun(unwrap(body));
}

export function toReconcileRunsOverview(
  body: unknown
): ReconcileRunsOverview | null {
  const v = asRecord(unwrap(body));
  if (!v || !Array.isArray(v.open)) return null;
  const open = v.open.map(toRun);
  if (open.some((r) => r === null)) return null;
  let latest: ReconcileRunDto | null = null;
  if (v.latest !== null && v.latest !== undefined) {
    latest = toRun(v.latest);
    if (!latest) return null;
  }
  return { open: open as ReconcileRunDto[], latest };
}
