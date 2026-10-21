import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { authQueryKeys } from '@/lib/services/auth/query-keys';
import { permissionLabel } from '@/lib/auth/permission-labels';
import MainTemplate from './MainTemplate';

// The unrelated carousel cannot render in the backend Jest CommonJS transform.
jest.mock('@/features/main/quick-actions/QuickActionsCard', () => ({
  QuickActionsCard: () => null,
}));

// «오늘의 할 일» 큐 조회 — 넘긴 옵션(enabled)을 보려고 바꿔 둔다. 응답은 비어 있다.
function mockQueue() {
  return jest.fn(() => ({ data: undefined, isLoading: false, isError: false }));
}
jest.mock('@/lib/services/orders', () => ({ ...jest.requireActual('@/lib/services/orders'), useOrderStats: mockQueue() }));
jest.mock('@/lib/services/wallet', () => ({
  ...jest.requireActual('@/lib/services/wallet'),
  usePendingBankTransfers: mockQueue(),
  useRefundRequests: mockQueue(),
}));
jest.mock('@/lib/services/return-exchange/queries', () => ({
  ...jest.requireActual('@/lib/services/return-exchange/queries'),
  useReturnRequests: mockQueue(),
  useExchangeRequests: mockQueue(),
}));
jest.mock('@/lib/services/qna', () => ({ ...jest.requireActual('@/lib/services/qna'), useQuestions: mockQueue() }));
jest.mock('@/lib/services/review', () => ({ ...jest.requireActual('@/lib/services/review'), useReviews: mockQueue() }));
jest.mock('@/lib/services/business-licenses', () => ({
  ...jest.requireActual('@/lib/services/business-licenses'),
  useBusinessLicenses: mockQueue(),
}));

const QUEUE_HOOKS: ReadonlyArray<readonly [string, string]> = [
  ['@/lib/services/orders', 'useOrderStats'],
  ['@/lib/services/wallet', 'usePendingBankTransfers'],
  ['@/lib/services/wallet', 'useRefundRequests'],
  ['@/lib/services/return-exchange/queries', 'useReturnRequests'],
  ['@/lib/services/return-exchange/queries', 'useExchangeRequests'],
  ['@/lib/services/qna', 'useQuestions'],
  ['@/lib/services/review', 'useReviews'],
  ['@/lib/services/business-licenses', 'useBusinessLicenses'],
];

/** 렌더 동안 각 큐 훅이 받은 마지막 인자(옵션) — 호출이 여럿이면 전부 */
function queueOptions(): Array<{ hook: string; options: unknown }> {
  return QUEUE_HOOKS.flatMap(([path, hook]) => {
    const fn = (jest.requireMock(path) as Record<string, jest.Mock>)[hook];
    return fn.mock.calls.map((args: unknown[]) => ({ hook, options: args[args.length - 1] }));
  });
}

describe('admin home attendance placement', () => {
  it('renders the dashboard without a work card in the page structure at any viewport size', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });

    try {
      const html = renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client },
          createElement(MainTemplate)
        )
      );

      expect(html).toContain('오늘의 할 일');
      expect(html).not.toContain('오늘의 근무');
      expect(html).not.toContain('/attendance');
    } finally {
      client.clear();
    }
  });
});

describe('admin home queues the viewer cannot read', () => {
  const render = (permissions: readonly string[]) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
    });
    client.setQueryData(authQueryKeys.myPermissions(), {
      roles: [{ name: 'custom', displayName: '맞춤 역할' }],
      permissions: new Set(permissions),
      version: 'v1',
      landingPath: null,
    });
    try {
      return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MainTemplate)));
    } finally {
      client.clear();
    }
  };
  const QUEUE_PERMISSIONS = [
    'order.order.read',
    'order.claim.read',
    'payment.payment.read',
    'payment.refund.read',
    'cs.inquiry.read',
    'cs.review.read',
    'customer.profile.read',
  ];

  it('shows «가림» with the missing permission for every queue a statistics-only role cannot read', () => {
    const html = render(['analytics.report.read']);
    // 주문 통계 칩 3 · 교환 2 · 반품 2 · 입금 · 환불 · 문의 · 리뷰 · 사업자
    expect(html.match(/>가림</g)).toHaveLength(12);
    for (const key of QUEUE_PERMISSIONS) expect(html).toContain(`${permissionLabel(key)} 권한이 있어야 보입니다`);
  });

  beforeEach(() => jest.clearAllMocks());

  it('does not request a queue the role cannot read', () => {
    render(['analytics.report.read']);
    const calls = queueOptions();
    expect(calls.length).toBeGreaterThanOrEqual(QUEUE_HOOKS.length);
    for (const call of calls) expect(call).toEqual({ hook: call.hook, options: { enabled: false } });
  });

  it.each([
    ['order.order.read', 'useOrderStats'],
    ['payment.payment.read', 'usePendingBankTransfers'],
    ['payment.refund.read', 'useRefundRequests'],
    ['order.claim.read', 'useReturnRequests'],
    ['order.claim.read', 'useExchangeRequests'],
    ['cs.inquiry.read', 'useQuestions'],
    ['cs.review.read', 'useReviews'],
    ['customer.profile.read', 'useBusinessLicenses'],
  ])('opens only the queue %s unlocks (%s)', (permission, hook) => {
    render(['analytics.report.read', permission]);
    for (const call of queueOptions()) {
      const opened = call.hook === hook || (permission === 'order.claim.read' && /Return|Exchange/.test(call.hook));
      expect(call).toEqual({ hook: call.hook, options: { enabled: opened } });
    }
  });

  it('requests every queue for a role that reads them', () => {
    render(['analytics.report.read', ...QUEUE_PERMISSIONS]);
    for (const call of queueOptions()) expect(call).toEqual({ hook: call.hook, options: { enabled: true } });
  });

  it('hides nothing for a role that reads every queue', () => {
    const html = render(['analytics.report.read', ...QUEUE_PERMISSIONS]);
    expect(html).not.toMatch(/>가림</);
  });
});
