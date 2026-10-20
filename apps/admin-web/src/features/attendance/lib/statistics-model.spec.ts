import { paginateStatistics, statisticsPageNumbers } from './statistics-model';

const people = Array.from({ length: 41 }, (_, index) => ({
  userId: `person-${index + 1}`,
  name: `직원 ${String(index + 1).padStart(2, '0')}`,
  recordedDays: 10,
  completedDays: index % 3 === 0 ? 9 : 10,
  recordedMinutes: 4800,
  missingCheckoutDays: index % 3 === 0 ? 1 : 0,
  ongoingDays: 0,
}));

it('paginates all employees into ten rows and a final partial page', () => {
  expect(paginateStatistics(people, '', 'all', 1).rows).toHaveLength(10);
  expect(paginateStatistics(people, '', 'all', 2).rows[0].name).toBe('직원 11');
  expect(paginateStatistics(people, '', 'all', 5)).toMatchObject({
    page: 5,
    pageCount: 5,
    start: 41,
    end: 41,
    total: 41,
  });
});

it('searches all employees before pagination and clamps a stale page', () => {
  const result = paginateStatistics(people, '직원 41', 'all', 4);

  expect(result).toMatchObject({ page: 1, total: 1, start: 1, end: 1 });
  expect(result.rows[0].name).toBe('직원 41');
});

it('filters missing checkouts before pagination and handles empty results', () => {
  expect(paginateStatistics(people, '', 'missing', 2)).toMatchObject({
    total: 14,
    start: 11,
    end: 14,
  });
  expect(paginateStatistics(people, '없는 직원', 'all', 5)).toMatchObject({
    rows: [],
    page: 1,
    pageCount: 1,
    start: 0,
    end: 0,
  });
});

it('keeps pagination within five number slots on narrow screens', () => {
  expect(statisticsPageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5]);
  expect(statisticsPageNumbers(1, 20)).toEqual([1, 2, 3, 'ellipsis', 20]);
  expect(statisticsPageNumbers(10, 20)).toEqual([
    1,
    'ellipsis',
    10,
    'ellipsis',
    20,
  ]);
  expect(statisticsPageNumbers(20, 20)).toEqual([1, 'ellipsis', 18, 19, 20]);
});
