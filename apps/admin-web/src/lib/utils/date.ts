import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

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
