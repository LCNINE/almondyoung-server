/** @jest-environment jsdom */
import { render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminMemberDetail } from '@/lib/api/domains/membership';
import { useRefundRequestCounts } from '@/features/payments/hooks/use-refund-request-counts';
import {
  useMemberDetail,
  useMembershipMembers,
} from '@/lib/services/membership';
import { useRefundRequests } from '@/lib/services/wallet';
import { RefundRequestsContent } from './refund-requests-content';

const replace = jest.fn();
const complete = jest.fn();
const setResolution = jest.fn();
let resolutionAt: string | null = '2026-11-23T05:00:00Z';
let permissions = new Set<string>();
let search = '';
let walletTotal = 0;
let membershipTotal = 13;
let canMutate = true;
let noPayment = false;
let detail: Partial<AdminMemberDetail>;

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => '/payments/refund-requests',
  useRouter: () => ({ replace }),
}));
jest.mock('@/features/main/read-gate', () => ({
  useReadGate: (keys: string[]) => ({
    enabled: keys.some((key) => permissions.has(key)),
    pending: false,
    failed: false,
    hiddenReason: keys.some((key) => permissions.has(key))
      ? null
      : '조회 권한이 없어요.',
  }),
}));
jest.mock('@/hooks/use-permission', () => ({
  usePermissionCheck: () => ({ canRun: () => canMutate }),
}));
jest.mock('@/hooks/use-user-names', () => ({
  useUserNames: () => ({
    user1: { loginId: 'customer1', username: '테스트 고객' },
  }),
}));
jest.mock('@/lib/services/wallet', () => ({
  useRefundRequests: jest.fn(() => ({
    data: { data: [], total: walletTotal },
    isLoading: false,
    isError: false,
  })),
  useApproveRefundRequest: () => ({ isPending: false }),
  useRejectRefundRequest: () => ({ isPending: false }),
}));
jest.mock('@/lib/services/membership', () => ({
  useMembershipMembers: jest.fn(() => ({
    data: {
      data: [
        {
          contractId: 'contract1',
          userId: 'user1',
          hasPaymentIntent: !noPayment,
          cancelledAt: '2026-10-01T00:00:00Z',
          eligibleRefundAmount: 12000,
          refundResolutionSubmittedAt: resolutionAt,
        },
      ],
      total: membershipTotal,
    },
    isLoading: false,
    isError: false,
  })),
  useMemberDetail: jest.fn(() => ({
    data: detail,
    isLoading: false,
    isError: false,
  })),
  useCompleteManualRefund: () => ({ mutateAsync: complete, isPending: false }),
  useSetRefundResolution: () => ({
    mutateAsync: setResolution,
    isPending: false,
  }),
}));
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

beforeEach(() => {
  jest.clearAllMocks();
  permissions = new Set([
    'payment.refund.read',
    'membership.billing.read',
    'membership.member.read',
  ]);
  search = '';
  walletTotal = 0;
  membershipTotal = 13;
  canMutate = true;
  noPayment = false;
  resolutionAt = '2026-11-23T05:00:00Z';
  detail = {
    contractId: 'contract1',
    userId: 'user1',
    refundRequested: true,
    refundCompleted: false,
    hasPaymentIntent: true,
    eligibleRefundAmount: 12000,
    manualRefundAccount: {
      bank: '92',
      accountNumber: '123456789',
      holderName: '테스트',
    },
    refundSettlement: null,
    refundResolutionSubmittedAt: resolutionAt,
  };
  complete.mockResolvedValue({});
  setResolution.mockResolvedValue({});
});

it('결의서를 올리기 전에는 이체했어요를 막고 올렸어요 확인 뒤 기록한다', async () => {
  resolutionAt = null;
  detail.refundResolutionSubmittedAt = null;
  const user = userEvent.setup();
  render(<RefundRequestsContent />);

  expect(
    screen.getByRole('button', { name: '이체했어요' }).hasAttribute('disabled')
  ).toBe(true);
  expect(screen.getByText('결의서를 먼저 올려 주세요')).toBeTruthy();

  await user.click(screen.getByRole('button', { name: '올렸어요' }));
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: '네, 올렸어요',
    })
  );

  expect(setResolution).toHaveBeenCalledWith({
    contractId: 'contract1',
    submitted: true,
  });
  expect(complete).not.toHaveBeenCalled();
});

it('상품 환불이 0이면 멤버십을 먼저 열고 확인 후 계약 한 건만 완료한다', async () => {
  const user = userEvent.setup();
  render(<RefundRequestsContent />);

  expect(
    screen
      .getByRole('tab', { name: '멤버십 환불 (수동 송금) 13건' })
      .getAttribute('aria-selected')
  ).toBe('true');
  expect(
    screen.getByRole('link', { name: 'customer1' }).getAttribute('href')
  ).toBe('/customer-window/user1');
  expect(
    screen.getByRole('link', { name: 'customer1' }).getAttribute('target')
  ).toBe('_blank');
  expect(screen.getByText('테스트 고객')).toBeTruthy();

  await user.click(screen.getByRole('button', { name: '이체했어요' }));
  const dialog = screen.getByRole('alertdialog');

  expect(dialog.textContent).toContain('123456789 (테스트)로 12,000원');
  expect(dialog.textContent).toContain('돈을 보내지 않아요');
  expect(complete).not.toHaveBeenCalled();

  await user.click(
    within(dialog).getByRole('button', { name: '네, 이체했어요' })
  );

  expect(complete).toHaveBeenCalledTimes(1);
  expect(complete).toHaveBeenCalledWith({ contractId: 'contract1' });
});

it('둘 다 있으면 상품 탭을 먼저 열고 탭 선택을 URL에 남긴다', async () => {
  walletTotal = 2;
  const user = userEvent.setup();
  render(<RefundRequestsContent />);

  expect(
    screen
      .getByRole('tab', { name: '상품 환불 (무통장) 2건' })
      .getAttribute('aria-selected')
  ).toBe('true');

  await user.click(
    screen.getByRole('tab', { name: '멤버십 환불 (수동 송금) 13건' })
  );

  expect(replace).toHaveBeenCalledWith(
    '/payments/refund-requests?tab=membership',
    { scroll: false }
  );
});

it('URL 선택을 우선하고 둘 다 0이면 상품 탭을 연다', () => {
  membershipTotal = 0;
  const view = render(<RefundRequestsContent />);

  expect(
    screen
      .getByRole('tab', { name: '상품 환불 (무통장) 0건' })
      .getAttribute('aria-selected')
  ).toBe('true');

  search = 'tab=membership';
  view.rerender(<RefundRequestsContent />);

  expect(
    screen
      .getByRole('tab', { name: '멤버십 환불 (수동 송금) 0건' })
      .getAttribute('aria-selected')
  ).toBe('true');
});

it.each(['membership.billing.read', 'membership.member.read'])(
  '%s가 없으면 멤버십 탭과 조회를 막는다',
  (permission) => {
    permissions.delete(permission);
    search = 'tab=membership';
    render(<RefundRequestsContent />);

    expect(screen.queryByRole('tab', { name: /멤버십 환불/ })).toBeNull();
    expect(useMembershipMembers).toHaveBeenCalledWith(
      { page: 1, limit: 1, refundPending: true },
      { enabled: false }
    );
    expect(useMemberDetail).not.toHaveBeenCalled();
  }
);

it('결제 이력이 없는 행은 상세 조회도 하지 않는다', () => {
  noPayment = true;
  render(<RefundRequestsContent />);

  expect(useMemberDetail).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '이체했어요' })).toBeNull();
});

it.each([
  {
    refundSettlement: { alreadyRefundedAmount: 0, pendingRefundAmount: 12000 },
  },
  { hasPaymentIntent: false },
  { refundCompleted: true },
  { contractId: 'different-contract' },
])('안전 조건을 만족하지 않으면 완료 버튼을 숨긴다: %j', (change) => {
  detail = { ...detail, ...change };
  render(<RefundRequestsContent />);

  expect(screen.queryByRole('button', { name: '이체했어요' })).toBeNull();
  expect(complete).not.toHaveBeenCalled();
});

it('이미 PG 환불된 건은 추가 송금 없이 정리하도록 확인한다', async () => {
  detail.refundSettlement = {
    alreadyRefundedAmount: 12000,
    pendingRefundAmount: 0,
  };
  const user = userEvent.setup();
  render(<RefundRequestsContent />);

  await user.click(screen.getByRole('button', { name: '완료로 정리' }));

  expect(screen.getByRole('alertdialog').textContent).toContain(
    '추가 송금 없이'
  );

  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: '취소',
    })
  );

  expect(complete).not.toHaveBeenCalled();
});

it('환불 쓰기 권한이 없으면 완료 버튼을 숨긴다', () => {
  canMutate = false;
  render(<RefundRequestsContent />);

  expect(screen.queryByRole('button', { name: '이체했어요' })).toBeNull();
});

it.each([
  [
    [
      'payment.refund.read',
      'membership.billing.read',
      'membership.member.read',
    ],
    15,
  ],
  [['payment.refund.read'], 2],
  [['membership.billing.read', 'membership.member.read'], 13],
  [[], 0],
])('대시보드는 읽을 수 있는 환불만 합산한다: %j', (held, count) => {
  permissions = new Set(held);
  walletTotal = 2;
  const { result } = renderHook(() => useRefundRequestCounts());

  expect(result.current.count).toBe(count);
  expect(useRefundRequests).toHaveBeenCalledWith(1, 1, {
    enabled: permissions.has('payment.refund.read'),
  });
  expect(useMembershipMembers).toHaveBeenCalledWith(
    { page: 1, limit: 1, refundPending: true },
    {
      enabled:
        permissions.has('membership.billing.read') &&
        permissions.has('membership.member.read'),
    }
  );
});
