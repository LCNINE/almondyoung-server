// src/lib/api/domains/channel/order-reconcile-findings.shape.ts
//
// «채널과 어긋남»(#1016 45번) 응답의 순수 정형화 함수. axios·react-query 를 import 하지 않는다 —
// admin-web 은 컴포넌트 테스트가 불가능해서 이 함수들만 스펙으로 검증된다.
//
// 서버 원형은 apps/channel-adapter/src/controllers/order-reconcile-findings.controller.ts.
// 공용 인터셉터(`lib/api/client.ts`)는 `success === true && 'data' in body` 일 때만 한 겹 벗긴다:
//
// | 호출 | 서버 본문 | 인터셉터 통과 후 |
// |---|---|---|
// | `GET /`               | `{ success, data }`            | `data` (배열) |
// | `GET /summary`        | `{ success, data, timestamp }` | `data` (요약) |
// | `POST /:id/redeliver` | `{ result }`                   | 그대로 (`success` 가 없다) |
// | `POST /:id/close`     | `{ data }`                     | 그대로 (`success` 가 없다) |
//
// 그래서 «`data` 키가 있으면 한 겹 벗긴다» 하나로 두 모양을 다 받는다(행·요약·결과엔 `data` 키가 없다).
// 모양이 다르면 null 이다 — 빈 목록이나 0 으로 그리면 운영자가 «어긋난 주문 없음»으로 읽는다.

export type FindingKind = 'missing_order' | 'cancel_not_applied';
export type FindingHandling = 'auto' | 'human';
export type HumanReason =
  | 'out_of_window'
  | 'core_status'
  | 'event_failure_open'
  | 'attempts_exhausted';
export type FindingStatus = 'open' | 'resolved' | 'closed';

/** `order_reconcile_findings` 행 하나 (apps/channel-adapter/src/schema.ts). 시각은 JSON 이라 ISO 문자열이다. */
export interface ReconcileFindingDto {
  id: string;
  channel: string;
  externalOrderId: string;
  displayOrderNo: string | null;
  kind: FindingKind;
  status: FindingStatus;
  handling: FindingHandling;
  humanReason: HumanReason | null;
  coreStatus: string | null;
  channelCreatedAt: string;
  mode: 'observe' | 'act';
  lastResult: string | null;
  attemptCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastAttemptAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  closedBy: string | null;
  closeMemo: string | null;
}

export interface ReconcileSummary {
  open: number;
  human: number;
  gaveUp: number;
  oldestFirstSeenAt: string | null;
}

/** 서버 상한(200)과 같게 보낸다. 서버 기본 50 이면 말없이 앞 50건만 보인다. */
export const MISMATCH_LIST_LIMIT = 200;

/** 화면 토글의 두 값. 서버는 resolved·closed 를 따로도 받지만 화면은 «열린 것»과 «전부»만 쓴다. */
export type MismatchListScope = 'open' | 'all';

export interface MismatchListResult {
  data: ReconcileFindingDto[];
  /** 상한에 닿았다 — 뒤에 더 있을 수 있다. */
  truncated: boolean;
}

function asRecord(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function unwrap(body: unknown): unknown {
  const record = asRecord(body);
  return record && 'data' in record ? record.data : body;
}

export function toMismatchList(
  body: unknown,
  limit: number = MISMATCH_LIST_LIMIT
): MismatchListResult | null {
  const value = unwrap(body);
  if (!Array.isArray(value)) return null;
  const rows = value as ReconcileFindingDto[];
  return { data: rows, truncated: rows.length >= limit };
}

export function toMismatchSummary(body: unknown): ReconcileSummary | null {
  const v = asRecord(unwrap(body));
  if (
    !v ||
    typeof v.open !== 'number' ||
    typeof v.human !== 'number' ||
    typeof v.gaveUp !== 'number'
  )
    return null;
  return {
    open: v.open,
    human: v.human,
    gaveUp: v.gaveUp,
    oldestFirstSeenAt:
      typeof v.oldestFirstSeenAt === 'string' ? v.oldestFirstSeenAt : null,
  };
}

export function toRedeliverResult(body: unknown): string | null {
  const v = asRecord(unwrap(body));
  return v && typeof v.result === 'string' ? v.result : null;
}

export function toClosedFinding(body: unknown): ReconcileFindingDto | null {
  const v = asRecord(unwrap(body));
  return v && typeof v.id === 'string'
    ? (v as unknown as ReconcileFindingDto)
    : null;
}
