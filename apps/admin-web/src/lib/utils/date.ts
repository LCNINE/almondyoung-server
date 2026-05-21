import { format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { ko } from 'date-fns/locale';

export type DatePreset = 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'quarter' | 'custom';

export const DATE_PRESET_OPTIONS = [
  { value: 'all', label: '전체' },
  { value: 'today', label: '오늘' },
  { value: 'yesterday', label: '어제' },
  { value: 'week', label: '일주일' },
  { value: 'month', label: '당월' },
  { value: 'lastMonth', label: '전월' },
  { value: 'quarter', label: '3개월' },
  { value: 'custom', label: '임의기간' },
];

export function computeDateRange(preset: DatePreset): { from: string; to: string } | null {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  switch (preset) {
    case 'today':
      return { from: fmt(startOfDay(now)), to: fmt(endOfDay(now)) };
    case 'yesterday': {
      const y = subDays(now, 1);
      return { from: fmt(startOfDay(y)), to: fmt(endOfDay(y)) };
    }
    case 'week':
      return { from: fmt(startOfDay(subDays(now, 6))), to: fmt(endOfDay(now)) };
    case 'month':
      return { from: fmt(startOfMonth(now)), to: fmt(endOfMonth(now)) };
    case 'lastMonth': {
      const lm = subMonths(now, 1);
      return { from: fmt(startOfMonth(lm)), to: fmt(endOfMonth(lm)) };
    }
    case 'quarter':
      return { from: fmt(startOfDay(subMonths(now, 3))), to: fmt(endOfDay(now)) };
    default:
      return null;
  }
}

/** datetime-local input의 min 값으로 사용할 현재 로컬 시각 (UTC 기준이면 time zone shift 발생하므로 offset 보정) */
export function nowDatetimeLocalMin(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/**
 * 날짜를 한국어 형식으로 포맷팅 (년월일)
 * @example "2024년 3월 27일"
 */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, 'yyyy년 M월 d일', { locale: ko });
}

/**
 * 날짜와 시간을 한국어 형식으로 포맷팅 (년월일 시분)
 * @example "2024년 3월 27일 14:30"
 */
export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, 'yyyy년 M월 d일 HH:mm', { locale: ko });
}
