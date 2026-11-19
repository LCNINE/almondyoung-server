import type { MatchingFilter } from '../contexts/filter.context';

// 매칭 화면 주소에는 검색한 주문일자만 남긴다. 고객명 같은 검색어는 주소·방문 기록에 남기지 않는다.
export type MatchingDate = Pick<
  MatchingFilter,
  'dateType' | 'startDate' | 'endDate'
>;

export const NO_DATE: MatchingDate = {
  dateType: 'custom',
  startDate: undefined,
  endDate: undefined,
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function isDateKey(value: string | null): value is string {
  if (!value || !DATE_KEY.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  return (
    day.getUTCFullYear() === y &&
    day.getUTCMonth() === m - 1 &&
    day.getUTCDate() === d
  );
}

/** 주소의 주문일자. 읽을 수 없는 값이면 날짜 조건 없음. */
export function matchingDateFromParams(params: {
  get(name: string): string | null;
}): MatchingDate {
  if (params.get('date') === 'today') {
    return { dateType: 'today', startDate: undefined, endDate: undefined };
  }
  const from = params.get('from');
  const to = params.get('to');
  const startDate = isDateKey(from) ? from : undefined;
  const endDate = isDateKey(to) ? to : undefined;
  if (startDate && endDate && startDate > endDate) return NO_DATE;
  return { dateType: 'custom', startDate, endDate };
}

/** 검색한 주문일자를 주소 쿼리로. 서버에 보낸 그대로 — 한쪽 끝만 골랐으면 그 끝만. */
export function matchingDateQuery(date: MatchingDate): string {
  const params = new URLSearchParams();
  if (date.dateType === 'today') {
    params.set('date', 'today');
    return params.toString();
  }
  if (date.startDate) params.set('from', date.startDate);
  if (date.endDate) params.set('to', date.endDate);
  return params.toString();
}
