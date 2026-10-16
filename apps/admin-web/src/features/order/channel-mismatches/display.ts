// «채널과 어긋남» 목록의 표시 규칙 (#1016 45번 스펙 §8.2). React·axios·react-query 를 import 하지 않는다 —
// admin-web 은 컴포넌트 테스트가 불가능하므로 화면 문장·버튼 노출은 전부 여기서 만들고 여기서 검증한다.

import { formatDwell } from '@/lib/utils/format-dwell';
import type {
  FindingKind,
  HumanReason,
  MismatchListScope,
  ReconcileFindingDto,
} from '@/lib/api/domains/channel/order-reconcile-findings.shape';

import { actionErrorText } from '@/features/events/failures/display';

// 409 문구 그대로·504 는 «처리 중» — 이벤트 실패 화면과 같은 규칙이다
export {
  actionErrorText,
  loadErrorText,
} from '@/features/events/failures/display';

/** 서버 `CloseFindingDto` 의 `@MaxLength(500)` 과 같다 */
export const MEMO_MAX = 500;

const KIND_LABELS: Record<FindingKind, string> = {
  missing_order: 'core 에 없음',
  cancel_not_applied: '취소 미반영',
};

const HUMAN_REASON_LABELS: Record<HumanReason, string> = {
  out_of_window: '3일 지난 주문',
  core_status: 'core 가 취소를 못 받음',
  event_failure_open: '이벤트 실패 열림',
  attempts_exhausted: '시도 3회 소진',
};

// 어댑터가 `last_result` 에 쓰는 값: 대사 주기(would_act·pending·skipped), 적재(enqueued),
// 다시 배달 결과(`RedeliveryResult` = `OrderSyncOutcome` + no_mapping·nothing_to_send), 오류(`error: …`)
const RESULT_LABELS: Record<string, string> = {
  would_act: '관찰 — 보내지 않음',
  pending: '보낼 차례',
  skipped: '건너뜀',
  enqueued: '보냄',
  emitted: '보냄',
  created: '수집함',
  unchanged: '변경 없음',
  not_found: '채널에 없음',
  not_eligible: '수집 대상 아님',
  identification_failed: '식별 실패',
  channel_inactive: '채널 비활성',
  no_mapping: '매핑 없음',
  nothing_to_send: '보낼 취소 없음',
};

const ERROR_PREFIX = 'error: ';

function labelOf(labels: Record<string, string>, key: string): string {
  return Object.prototype.hasOwnProperty.call(labels, key) ? labels[key] : key;
}

export function orderNoOf(f: ReconcileFindingDto): string {
  return f.displayOrderNo || f.externalOrderId;
}

export function kindLabel(kind: string): string {
  return labelOf(KIND_LABELS, kind);
}

export function handlingText(f: ReconcileFindingDto): string {
  if (f.status === 'resolved') return '해소';
  if (f.status === 'closed')
    return f.closeMemo ? `종결 — ${f.closeMemo}` : '종결';
  if (f.handling === 'auto') return '자동';
  const reason = f.humanReason
    ? labelOf(HUMAN_REASON_LABELS, f.humanReason)
    : '';
  const status =
    f.humanReason === 'core_status' && f.coreStatus ? ` (${f.coreStatus})` : '';
  return reason ? `사람 — ${reason}${status}` : '사람';
}

export function lastResultText(result: string | null): string {
  if (!result) return '-';
  if (result.startsWith(ERROR_PREFIX))
    return `오류 — ${result.slice(ERROR_PREFIX.length)}`;
  return labelOf(RESULT_LABELS, result);
}

export function firstSeenText(iso: string, now: Date): string {
  return `${formatDwell(Math.max(0, now.getTime() - new Date(iso).getTime()))} 전`;
}

/** 조치는 열린 사람 행에만(스펙 §8.2). 자동 행은 대사가 다음 주기에 스스로 다룬다 */
export function canAct(f: ReconcileFindingDto): boolean {
  return f.status === 'open' && f.handling === 'human';
}

const SENT = new Set(['enqueued', 'emitted']);

/** 200 이어도 보낸 게 아니면 오류 톤이다 — 성공으로 보이면 운영자가 «보냈다»고 믿고 떠난다 */
export function redeliverOutcome(result: string): {
  tone: 'success' | 'error';
  text: string;
} {
  if (SENT.has(result)) return { tone: 'success', text: '보냈습니다' };
  if (result === 'created') return { tone: 'success', text: '수집했습니다' };
  return { tone: 'error', text: `보내지 않음 — ${lastResultText(result)}` };
}

export function memoError(memo: string): string | null {
  const trimmed = memo.trim();
  if (!trimmed) return '메모를 입력하세요';
  if (trimmed.length > MEMO_MAX) return `${MEMO_MAX}자 이내로 입력하세요`;
  return null;
}

export function emptyText(scope: MismatchListScope): string {
  return scope === 'open' ? '어긋난 주문 없음' : '기록 없음';
}

function statusCodeOf(error: unknown): number | null {
  return error &&
    typeof error === 'object' &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
    ? error.statusCode
    : null;
}

/**
 * 조치(다시 배달·종결) 실패. 404 는 그 사이 대사 주기가 해소했거나 누가 종결한 행이다 — 서버 문구는 영어
 * (`Open reconcile finding not found`)라 한국어로 바꾸고, `gone` 이면 대화상자를 닫는다(다시 눌러도 또 404).
 */
export function mismatchActionError(error: unknown): {
  text: string;
  gone: boolean;
} {
  if (statusCodeOf(error) === 404)
    return { text: '이미 해소·종결된 행입니다', gone: true };
  return { text: actionErrorText(error), gone: false };
}
