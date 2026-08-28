import type { KeywordIssueFilter, KeywordIssueStatus } from '@/lib/api/domains/search';

export const STATUS_LABELS: Record<KeywordIssueStatus, string> = {
  new: '신규',
  dev: '개발팀',
  md: 'MD팀',
  in_progress: '처리중',
  resolved: '해소',
  ignored: '무시',
};

export const FILTER_LABELS: Record<KeywordIssueFilter, string> = {
  ...STATUS_LABELS,
  open: '처리할 것만',
};

/** 필터 칩 순서 — 왼쪽부터 업무 흐름 순 */
export const FILTER_ORDER: KeywordIssueFilter[] = [
  'open',
  'new',
  'dev',
  'md',
  'in_progress',
  'resolved',
  'ignored',
];

/**
 * 이 화면의 두 모수를 문구에서 절대 섞지 않기 위한 단위 표기.
 * 회 = 검색 횟수, 종 = 서로 다른 검색어 가짓수.
 */
export function formatTimes(value: number | null | undefined): string {
  if (value == null) return '-';
  return `${value.toLocaleString('ko-KR')}회`;
}

export function formatKinds(value: number | null | undefined): string {
  if (value == null) return '-';
  return `${value.toLocaleString('ko-KR')}종`;
}

export function formatDays(value: number | null | undefined): string {
  if (value == null) return '-';
  return `${value.toLocaleString('ko-KR')}일`;
}
