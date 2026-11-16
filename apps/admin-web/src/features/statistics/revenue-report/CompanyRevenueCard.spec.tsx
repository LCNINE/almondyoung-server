/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { CompanyRevenueCard } from './CompanyRevenueCard';

const summary = {
  today: '2026-06-16',
  year: 2026,
  coverageStart: '2026-06-01',
  channels: ['medusa'],
  goal: {
    annualTarget: 2000,
    monthlyTargets: Array(12).fill(2000 / 12),
    preCoverageActual: 99999,
    scope: 'own_mall',
  },
  ytdDaily: [{ date: '2026-06-15', ownMall: 200, allChannels: 200 }],
};
const report = {
  external: [
    {
      channel: 'cafe24',
      account: 'sample',
      month: '2026-05',
      basis: 'operational_net',
      originalStatus: 'confirmed',
      amount: 500,
    },
    {
      channel: 'naver',
      account: 'sample',
      month: '2026-05',
      basis: 'purchase_confirmed',
      amount: 100,
    },
    {
      channel: 'coupang',
      account: 'sample',
      month: '2026-06',
      basis: 'paid',
      amount: 80,
    },
  ],
};
let refundError = false;
jest.mock('@/lib/services/analytics', () => ({
  useGrowthSummary: () => ({ data: summary }),
}));
jest.mock('@/lib/services/wallet/queries', () => ({
  useOrderRefunds: () => ({
    data: { series: [{ day: '2026-06-15', amount: 20 }] },
    isError: refundError,
  }),
}));
jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: report }),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ComposedChart: ({ data }: { data: unknown }) => (
    <div data-testid="monthly-chart">{JSON.stringify(data)}</div>
  ),
  Area: () => null,
  CartesianGrid: () => null,
  Line: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

afterEach(() => {
  refundError = false;
});

it('uses the combined company total in the actual goal and chart, then filters the same ledger', () => {
  render(<CompanyRevenueCard />);
  expect(screen.getByText('43.0%')).toBeTruthy();
  expect(screen.getByRole('img', { name: '목표 달성률 43.0%' })).toBeTruthy();
  expect(screen.getByTestId('monthly-chart').textContent).toContain(
    '"actual":860'
  );

  fireEvent.click(screen.getByRole('button', { name: '자사몰' }));
  expect(
    screen.getByRole('button', { name: '자사몰', pressed: true })
  ).toBeTruthy();
  expect(screen.getByText('34.0%')).toBeTruthy();
  expect(screen.getByText('이전 카페24 자사몰 매출 포함')).toBeTruthy();
  expect(screen.getByTestId('monthly-chart').textContent).toContain(
    '"actual":680'
  );
  expect(screen.getByTestId('monthly-chart').textContent).not.toContain(
    '"plan":166'
  );

  fireEvent.click(screen.getByRole('button', { name: '스마트스토어' }));
  expect(screen.getByText('5.0%')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '쿠팡' }));
  expect(screen.getByText('4.0%')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '전체' }));
  expect(screen.getByText('43.0%')).toBeTruthy();
});

it('does not display an incomplete company achievement when refunds fail', () => {
  refundError = true;
  render(<CompanyRevenueCard />);
  expect(screen.queryByText('43.0%')).toBeNull();
  expect(screen.queryByTestId('monthly-chart')).toBeNull();
  expect(
    (
      screen.getByRole('button', {
        name: '매출 근거 엑셀',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
});
