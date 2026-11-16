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
    createdAt: '2026-06-15T22:00:00.000Z',
    memo: '참고 누적액에서 집계액을 차감',
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
  LineChart: () => null,
  Legend: () => null,
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
    screen.getByRole<HTMLButtonElement>('button', { name: '매출 근거 엑셀' })
      .disabled
  ).toBe(true);
});

it('shows the legacy calculation and its uncertainty without opening details', () => {
  render(<CompanyRevenueCard />);
  const explanation = screen.getByRole('region', {
    name: '이전 표시액과 현재 매출의 차이',
  });
  expect(explanation.closest('details')).toBeNull();
  expect(explanation.textContent).toContain('2026-06-16');
  expect(explanation.textContent).toContain('₩100,179');
  expect(explanation.textContent).toContain('₩99,999');
  expect(explanation.textContent).toContain('₩680');
  expect(explanation.textContent).toContain('₩860');
  expect(explanation.textContent).toContain('출처를 확정하지 않습니다');
  expect(explanation.textContent).toContain('전체 검토 완료를 뜻하지 않습니다');
});

it('shows native and legacy storefront sales together and reconciles the monthly total', () => {
  render(<CompanyRevenueCard />);
  const table = screen.getByRole('table', {
    name: '월별 채널 매출과 회사 전체 합계, 원 단위',
  });
  expect(table.textContent).toContain('현재 자사몰(메두사)');
  expect(table.textContent).toContain('이전 자사몰(카페24)');
  expect(table.textContent).toContain('₩180');
  expect(table.textContent).toContain('₩500');
  expect(table.textContent).toContain('₩860');
  expect(table.textContent).toContain('미등록');
});
