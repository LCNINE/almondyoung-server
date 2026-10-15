// 이벤트 실패 화면의 표시 규칙 (#1016 7·8번, 스펙 §10). React·axios·react-query 를 import 하지 않는다 —
// admin-web 은 컴포넌트 테스트가 불가능하므로 화면에 나가는 문장은 전부 여기서 만들고 여기서 검증한다.

import { formatDwell } from '@/lib/utils/format-dwell';
import type {
  EventFailuresSummary,
  RedriveAllResult,
  RedriveResult,
  ResendAllResult,
  ResendResult,
} from '@/lib/api/domains/events/failures.types';

/** 서버 `DiscardFailureDto` 의 `@MaxLength(500)` 과 같다 */
export const REASON_MAX = 500;

const ERROR_LINE_MAX = 120;

export function dwellSince(iso: string | null, now: Date): string {
  if (!iso) return '-';
  return formatDwell(Math.max(0, now.getTime() - new Date(iso).getTime()));
}

/** 목록 칸용. 스택이 섞인 여러 줄 메시지는 첫 내용 줄만, 길면 자른다 */
export function errorOneLine(name: string | null, message: string | null): string {
  const first = (message ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  const text = [name, first].filter((v): v is string => !!v).join(': ');
  if (!text) return '-';
  return text.length > ERROR_LINE_MAX ? `${text.slice(0, ERROR_LINE_MAX)}…` : text;
}

/** axios 인터셉터가 서버 문구를 `CustomError.message` 에 담아 던진다 */
export function errorMessageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '요청이 실패했습니다';
}

export function loadErrorText(error: unknown): string {
  return `불러오지 못했습니다 — ${errorMessageOf(error)}`;
}

export function isStopped(result: RedriveResult): boolean {
  return result.stoppedAt !== null;
}

function stopSuffix(result: RedriveResult): string {
  return `${result.processed}건 처리 후 멈춤 — ${result.stoppedAt?.errorName ?? '오류'}`;
}

export function redriveResultText(result: RedriveResult): string {
  if (isStopped(result)) return stopSuffix(result);
  return result.processed > 0 ? `${result.processed}건 처리` : '처리할 것이 없습니다';
}

/** 종결 결과. 머리를 종결했으면 뒤 보류가 이어서 다시 넣어진 결과가 함께 온다 */
export function discardResultText(result: RedriveResult): string {
  if (isStopped(result)) return `종결 · 뒤 ${stopSuffix(result)}`;
  return result.processed > 0 ? `종결 · 뒤 ${result.processed}건 처리` : '종결';
}

export function redriveAllResultText(result: RedriveAllResult): string {
  if (result.sequences === 0) return '다시 넣을 것이 없습니다';
  const parts = [`성공 ${result.succeeded}`];
  if (result.stopped > 0) {
    const byError = Object.entries(result.stoppedByError)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, n]) => `${name} ${n}`)
      .join(', ');
    parts.push(byError ? `멈춤 ${result.stopped} (${byError})` : `멈춤 ${result.stopped}`);
  }
  if (result.busy > 0) parts.push(`진행 중이라 건너뜀 ${result.busy}`);
  return parts.join(' · ');
}

export function resendResultText(result: ResendResult): string {
  return result.status === 'PUBLISHED' ? '보냈습니다' : `실패 — ${errorOneLine(null, result.error)}`;
}

export function resendAllResultText(result: ResendAllResult): string {
  if (result.total === 0) return '다시 보낼 것이 없습니다';
  const parts = [`성공 ${result.published}`];
  if (result.failed.length > 0) parts.push(`실패 ${result.failed.length}`);
  // 서버는 그 사이 다른 사람이 처리한 행(409)을 세지 않고 건너뛴다
  const skipped = result.total - result.published - result.failed.length;
  if (skipped > 0) parts.push(`건너뜀 ${skipped}`);
  return parts.join(' · ');
}

/** 종결 대화상자의 미리 알림. 머리 아닌 행(뒤 0)에는 문구가 없다 — 아무것도 흐르지 않으므로 */
export function discardFollowUpText(behind: number): string | null {
  return behind > 0 ? `뒤 ${behind}건이 이어서 처리됩니다` : null;
}

export function reasonError(reason: string): string | null {
  const trimmed = reason.trim();
  if (!trimmed) return '사유를 입력하세요';
  if (trimmed.length > REASON_MAX) return `${REASON_MAX}자 이내로 입력하세요`;
  return null;
}

/** 요약을 아직 못 받았거나 실패했으면 null — 0 을 보이면 «정상»으로 읽힌다 */
export function tabBadgeCount(summary: EventFailuresSummary | undefined): number | null {
  if (!summary) return null;
  return summary.deadLetters.failed + summary.deadLetters.held + summary.outbox.failed;
}

export function redriveAllConfirmText(summary: EventFailuresSummary | undefined): string {
  if (!summary) return '안 푼 실패를 순서마다 다시 넣습니다';
  const { failed, held } = summary.deadLetters;
  return held > 0
    ? `실패 ${failed}건 · 보류 ${held}건을 순서마다 다시 넣습니다`
    : `실패 ${failed}건을 순서마다 다시 넣습니다`;
}

export function resendAllConfirmText(summary: EventFailuresSummary | undefined): string {
  if (!summary) return '실패한 행을 오래된 순서로 다시 보냅니다';
  return `${summary.outbox.failed}건을 오래된 순서로 다시 보냅니다`;
}

const STATUS_LABELS: Record<string, string> = {
  failed: '실패',
  held: '보류',
  redriven: '다시 넣음',
  discarded: '종결',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function isUnresolved(status: string): boolean {
  return status === 'failed' || status === 'held';
}

export function actionLabel(kind: 'dead_letter' | 'outbox', action: string, outcome: string): string {
  if (action === 'discard') return '종결';
  const base = kind === 'outbox' ? '다시 보내기' : '다시 넣기';
  return outcome === 'failed' ? `${base} 실패` : base;
}
