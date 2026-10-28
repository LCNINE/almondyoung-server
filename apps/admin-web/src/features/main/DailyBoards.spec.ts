import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { kstDaysAgo, kstToday } from '@/features/statistics/as-of';
import { authQueryKeys } from '@/lib/services/auth/query-keys';
import { CsBoard } from './DailyBoards';

describe('CS board columns the viewer cannot read', () => {
  const render = (permissions: readonly string[]) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
    client.setQueryData(authQueryKeys.myPermissions(), {
      roles: [{ name: 'custom', displayName: '맞춤 역할' }],
      permissions: new Set(permissions),
      version: 'v1',
      landingPath: null,
    });
    const range = { from: kstDaysAgo(6), to: kstToday() };
    const series = (count: number) => ({ series: [{ bucket: range.to, count }] });
    // 예전에 권한이 있을 때 받아 둔 캐시 — 권한이 없어진 뒤에도 남아 있을 수 있다
    client.setQueryData(['qna', 'daily', range], series(7));
    client.setQueryData(['review', 'daily', range], series(100));
    client.setQueryData(['business-licenses', 'daily', range], series(0));
    const zero = { pending: 0, preparing: 0, shipping: 0, delivered: 0, externalShipped: 0, cancelled: 0, total: 0 };
    client.setQueryData(['orders', 'stats', 'daily', range], { series: [{ bucket: range.to, ...zero, return: 0 }] });
    try {
      return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(CsBoard)));
    } finally {
      client.clear();
    }
  };

  it('keeps a cached count of a hidden column out of the cells and the totals', () => {
    // 리뷰 열만 가림 — 다른 열은 모두 값이 있어 합계가 계산된다
    const html = render(['analytics.report.read', 'cs.inquiry.read', 'order.order.read', 'customer.profile.read']);
    expect(html).toContain('가림');
    expect(html).not.toMatch(/>100</);
    expect(html).not.toMatch(/>107</);
  });

  it('shows the same count to a viewer who reads reviews', () => {
    const html = render(['analytics.report.read', 'cs.inquiry.read', 'cs.review.read', 'order.order.read', 'customer.profile.read']);
    expect(html).toMatch(/>100</);
  });

  it('반품 열은 날짜 조건 없이 새 반품 목록으로 가고, 교환 열은 없다 (K8 PR 10)', () => {
    const html = render(['analytics.report.read', 'cs.inquiry.read', 'cs.review.read', 'order.order.read', 'customer.profile.read']);
    expect(html).toContain('반품 신청');
    expect(html).not.toContain('교환');
    expect(html).toContain('href="/cs/return-exchange"');
    expect(html).not.toContain('/cs/return-exchange?');
  });
});
