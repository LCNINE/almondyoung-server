import type { MonthlyAttendancePerson } from '@packages/domain-types/attendance';

export type StatisticsFilter = 'all' | 'missing';
export const STATISTICS_PAGE_SIZE = 10;

export function statisticsDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return `${hours.toLocaleString('ko-KR')}시간${rest ? ` ${rest}분` : ''}`;
}

export function paginateStatistics(
  people: MonthlyAttendancePerson[],
  search: string,
  filter: StatisticsFilter,
  requestedPage: number
) {
  const query = search.trim();
  const matching = people
    .filter(
      (person) =>
        person.name.includes(query) &&
        (filter === 'all' || person.missingCheckoutDays > 0)
    )
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, 'ko-KR') ||
        left.userId.localeCompare(right.userId)
    );
  const total = matching.length;
  const pageCount = Math.max(1, Math.ceil(total / STATISTICS_PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const offset = (page - 1) * STATISTICS_PAGE_SIZE;

  return {
    rows: matching.slice(offset, offset + STATISTICS_PAGE_SIZE),
    page,
    pageCount,
    total,
    start: total ? offset + 1 : 0,
    end: Math.min(offset + STATISTICS_PAGE_SIZE, total),
  };
}

export function statisticsPageNumbers(
  page: number,
  total: number
): Array<number | 'ellipsis'> {
  if (total <= 5) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  if (page <= 3) {
    return [1, 2, 3, 'ellipsis', total];
  }

  if (page >= total - 2) {
    return [1, 'ellipsis', total - 2, total - 1, total];
  }

  return [1, 'ellipsis', page, 'ellipsis', total];
}
