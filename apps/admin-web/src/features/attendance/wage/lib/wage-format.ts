import type {
  SettlementIssueKind,
  SettlementResult,
  SettlementWarning,
} from '@packages/domain-types/attendance-wage';

export function formatWon(value: number): string {
  return `${value.toLocaleString('ko-KR')}원`;
}

/** 분 → «8시간 30분». 0 은 «0분». */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) {
    return `${rest}분`;
  }

  return rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}

export const ISSUE_LABELS: Record<SettlementIssueKind, string> = {
  missing_checkout: '퇴근 기록 없음',
  no_rate: '시급 없음',
  overtime_undecided: '연장 미판정',
  absence_undecided: '부재 미판정',
  not_on_roster: '근무자 명단에 없음',
  outside_employment: '입사·퇴사일 밖 근무 기록',
};

export const WARNING_LABELS: Record<SettlementWarning, string> = {
  below_minimum_wage: '최저임금 미만 시급',
  rounding_unit: '근무시간 단위 반올림 사용 중',
  over_52_hours: '주 52시간 초과',
};

/** 이번 지급 달(YYYY-MM, 한국 날짜 기준). */
export function currentMonth(now: Date): string {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 7);
}

export function seoulToday(now: Date): string {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}

/** 확정할 수 없는 이유. 확정할 수 있으면 null. */
export function confirmBlockedReason(
  result: SettlementResult,
  today: string
): string | null {
  if (result.periodEnd >= today) {
    return '정산 기간이 끝난 다음 날부터 확정할 수 있어요.';
  }

  if (result.issues.length > 0) {
    return `계산하지 못한 항목 ${result.issues.length}건을 먼저 정리해 주세요.`;
  }

  return null;
}
