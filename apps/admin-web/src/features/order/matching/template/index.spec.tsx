/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import MatchingTemplate from './index';
import { useOrderLines } from '@/lib/services/matching';

let mockExcludeMatched = true;

jest.mock('@/lib/services/matching', () => ({
  useOrderLines: jest.fn(() => ({
    data: { data: [], total: 125 },
    isLoading: false,
    error: null,
  })),
}));
jest.mock('../contexts/filter.context', () => ({
  FilterProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useMatchingFilter: () => ({
    appliedFilters: {
      excludeMatched: mockExcludeMatched,
      excludeShipped: true,
      dateType: 'custom',
    },
  }),
}));
jest.mock('../components/filter-box', () => ({ FilterBox: () => null }));
jest.mock('../components/table', () => ({ MatchingTable: () => null }));
jest.mock('../components/name-match-button', () => ({
  NameMatchButton: () => null,
}));
jest.mock(
  '@/components/admin-ui-experimental/common/container/container',
  () => ({
    Container: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  })
);
jest.mock('@/components/admin-ui-experimental/common/header/header', () => ({
  Header: () => null,
}));

it.each([true, false])(
  'uses the server total and the appropriate label when excludeMatched=%s',
  (excludeMatched) => {
    mockExcludeMatched = excludeMatched;
    render(<MatchingTemplate />);

    expect(
      screen.getByText(`${excludeMatched ? '매칭대기' : '주문 줄'} 125건`)
    ).toBeTruthy();
    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(useOrderLines).toHaveBeenLastCalledWith(
      expect.objectContaining({ excludeShipped: true, limit: 50, offset: 0 })
    );
  }
);
