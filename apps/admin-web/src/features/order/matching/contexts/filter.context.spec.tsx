/** @jest-environment jsdom */
import { act, render } from '@testing-library/react';
import { FilterProvider, useMatchingFilter } from './filter.context';

let mockQuery = '';
const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/order/matching',
  useSearchParams: () => new URLSearchParams(mockQuery),
}));

let ctx: ReturnType<typeof useMatchingFilter>;
function Probe() {
  ctx = useMatchingFilter();
  return null;
}
const ui = () => (
  <FilterProvider>
    <Probe />
  </FilterProvider>
);

const setLocation = (query: string) =>
  window.history.replaceState(
    null,
    '',
    query ? `/order/matching?${query}` : '/order/matching'
  );

beforeEach(() => {
  mockReplace.mockReset();
  mockQuery = '';
  setLocation('');
});

it('주소의 주문일자로 시작한다', () => {
  mockQuery = 'from=2026-01-01&to=2026-01-31';
  setLocation(mockQuery);
  render(ui());

  expect(ctx.appliedFilters).toMatchObject({
    dateType: 'custom',
    startDate: '2026-01-01',
    endDate: '2026-01-31',
  });
  expect(ctx.filters.startDate).toBe('2026-01-01');
  expect(mockReplace).not.toHaveBeenCalled();
});

it('검색하면 고른 주문일자만 주소에 남긴다', () => {
  render(ui());
  act(() =>
    ctx.setFilters({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      keywordType: 'customerName',
      keyword: '홍길동',
    })
  );
  act(() => ctx.applySearch());

  expect(mockReplace).toHaveBeenCalledWith(
    '/order/matching?from=2026-01-01&to=2026-01-31',
    { scroll: false }
  );
});

it('주소가 이미 같으면 다시 쓰지 않는다', () => {
  mockQuery = 'date=today';
  setLocation(mockQuery);
  render(ui());
  act(() => ctx.applySearch());

  expect(mockReplace).not.toHaveBeenCalled();
});

it('검색을 이어서 하면 앞 검색의 주소가 늦게 와도 뒤 검색을 되돌리지 않는다', () => {
  const view = render(ui());
  act(() => ctx.setFilters({ startDate: '2026-01-01', endDate: '2026-01-31' }));
  act(() => ctx.applySearch());
  act(() => ctx.setFilters({ startDate: '2026-02-01', endDate: '2026-02-28' }));
  act(() => ctx.applySearch());

  mockQuery = 'from=2026-01-01&to=2026-01-31';
  view.rerender(ui());
  expect(ctx.appliedFilters.startDate).toBe('2026-02-01');
  expect(ctx.filters.startDate).toBe('2026-02-01');

  mockQuery = 'from=2026-02-01&to=2026-02-28';
  view.rerender(ui());
  expect(ctx.appliedFilters.startDate).toBe('2026-02-01');
});

it('떠 있는 동안 바깥에서 주소가 바뀌면 그 기간을 따른다', () => {
  mockQuery = 'from=2026-01-01&to=2026-01-31';
  setLocation(mockQuery);
  const view = render(ui());

  mockQuery = '';
  view.rerender(ui());
  expect(ctx.appliedFilters.startDate).toBeUndefined();
  expect(ctx.filters.startDate).toBeUndefined();

  mockQuery = 'date=today';
  view.rerender(ui());
  expect(ctx.appliedFilters.dateType).toBe('today');
  expect(ctx.filters.dateType).toBe('today');
});
