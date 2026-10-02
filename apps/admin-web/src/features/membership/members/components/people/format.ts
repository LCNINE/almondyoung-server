import { cmsFailureReason } from '@/lib/utils/cms-failure-reason';

export const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

/** 지금으로부터 며칠 전인지(오늘이면 0). */
export function daysSince(iso: string, now = new Date()): number {
  return Math.max(
    Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000),
    0
  );
}

/** 오늘(한국 날짜)부터 그 날짜까지 남은 날. 지났으면 음수. */
export function daysUntilDate(date: string, now = new Date()): number {
  const today = new Date(now.getTime() + 9 * 3600_000)
    .toISOString()
    .slice(0, 10);
  return Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
}

export const percent = (part: number, whole: number): string =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : '-';

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/**
 * 청구 기간을 사람 말로. 한 달을 온전히 덮으면 「2026년 8월분」, 아니면 「8/5 ~ 9/4」.
 * 기간을 모르면(인보이스 없이 생긴 줄) null.
 */
export function periodLabel(
  start: string | null,
  end: string | null
): string | null {
  if (!start || !end) return null;
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const lastDay = new Date(
    Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const wholeMonth =
    s.getUTCDate() === 1 &&
    e.getUTCFullYear() === s.getUTCFullYear() &&
    e.getUTCMonth() === s.getUTCMonth() &&
    e.getUTCDate() === lastDay;
  if (wholeMonth) return `${s.getUTCFullYear()}년 ${s.getUTCMonth() + 1}월분`;
  return `${md(start)} ~ ${md(end)}`;
}

/** 미납이 생긴 이유 — 원장 cause/causeCode 를 관리자가 읽는 말로. */
export function arrearsCauseLabel(
  cause: string,
  causeCode?: string | null
): string {
  if (cause === 'UNCOLLECTIBLE') return '자동이체 출금이 끝내 실패';
  if (cause === 'MANDATE_REJECTED') {
    if (causeCode === 'MANDATE_TIMEOUT')
      return '계좌 심사가 기한 안에 끝나지 않음';
    const reason = cmsFailureReason(causeCode);
    return reason ? `계좌 심사 거절 — ${reason}` : '계좌 심사 거절';
  }
  return cause;
}

/** 목록용 짧은 이유(여러 줄의 원인을 한 줄로) */
export function arrearsCauseShort(causes: string[]): string {
  const labels = causes.map((c) =>
    c === 'UNCOLLECTIBLE'
      ? '출금 실패'
      : c === 'MANDATE_REJECTED'
        ? '계좌 심사 거절'
        : c
  );
  return [...new Set(labels)].join(' · ') || '-';
}

export const ARREARS_STATUS_LABEL: Record<string, string> = {
  OUTSTANDING: '남음',
  SETTLED: '받음',
  WAIVED: '면제',
};

export function planLabel(durationDays: number): string {
  if (durationDays >= 365) return '연간';
  if (durationDays >= 28) return '월간';
  return `${durationDays}일`;
}

/** 서버 안내 문구를 꺼낸다. 권한이 없으면 무엇이 필요한지 말해 준다. */
export function adminErrorMessage(error: unknown, fallback: string): string {
  const e = error as {
    response?: { status?: number; data?: { message?: string } };
    message?: string;
  };
  if (e?.response?.status === 403)
    return '이 작업은 환불 권한이 있는 관리자만 할 수 있습니다.';
  const msg = e?.response?.data?.message ?? e?.message;
  return typeof msg === 'string' && msg.trim() ? msg : fallback;
}
