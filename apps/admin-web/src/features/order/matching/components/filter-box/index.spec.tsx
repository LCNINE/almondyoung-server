/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { FilterBox } from '.';

let mockFilters: Record<string, unknown> = {};

jest.mock('../../contexts/filter.context', () => ({
  useMatchingFilter: () => ({
    filters: mockFilters,
    setFilters: jest.fn(),
    applySearch: jest.fn(),
  }),
}));

it.each([
  [{ startDate: '2026-01-01' }, ['2026-01-01']],
  [{ endDate: '2026-01-31' }, ['2026-01-31']],
  [
    { startDate: '2026-01-01', endDate: '2026-01-31' },
    ['2026-01-01', '2026-01-31'],
  ],
])(
  '검색 중인 주문일자를 한쪽 끝만 있어도 날짜 칸에 보인다 %p',
  (dates, shown) => {
    mockFilters = {
      dateType: 'custom',
      keywordType: 'sellerProductName',
      excludeMatched: true,
      showCanceledOrders: false,
      excludeShipped: false,
      ...dates,
    };
    render(<FilterBox />);

    for (const date of shown) expect(screen.getByText(date)).toBeTruthy();
  }
);
