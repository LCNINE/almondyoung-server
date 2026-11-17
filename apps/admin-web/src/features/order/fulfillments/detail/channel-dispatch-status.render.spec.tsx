/**
 * @jest-environment jsdom
 */
import { render } from '@testing-library/react';
import { ChannelDispatchAttemptStatus } from './channel-dispatch-status';
import type { ChannelDispatchViewModel } from './channel-dispatch-model';

const viewModel = (
  orders: ChannelDispatchViewModel['attempts'][number]['orders']
): ChannelDispatchViewModel => ({
  attempts: [{ dispatchAttemptId: 'attempt-1', orders }],
  manualOperations: [],
  hasUnavailable: false,
  hasLoading: false,
});

const operation = {
  dispatchAttemptId: 'attempt-1',
  shipmentId: 'ship-1',
  salesOrderId: 'so-uuid-1',
  operation: 'dispatch' as const,
  channel: 'naver',
  externalOrderId: 'ext-1',
  status: 'manual_adjustment_required' as const,
  attempts: 3,
  errorMessage: null,
  lastAttemptAt: null,
  updatedAt: '2026-11-01T00:00:00Z',
};

it('쇼핑몰 반영 상태를 주문번호·쇼핑몰·한국어 상태로 보인다', () => {
  const { container } = render(
    <ChannelDispatchAttemptStatus
      attemptId="attempt-1"
      orderNoOf={(id) => (id === 'so-uuid-1' ? '6275' : null)}
      viewModel={viewModel([
        {
          salesOrderId: 'so-uuid-1',
          availability: 'ready',
          operations: [operation],
        },
        { salesOrderId: 'so-uuid-2', availability: 'error', operations: [] },
      ])}
    />
  );

  const text = container.textContent ?? '';
  expect(text).toContain('#6275');
  expect(text).toContain('네이버 스마트스토어 · 발송 처리 · 직접 조정 필요');
  expect(text).toContain('확인하지 못했어요');
  expect(text).not.toMatch(/so-uuid|order |unavailable|dispatch|manual_/);
});

it('연결된 쇼핑몰 주문이 없으면 그렇게 알린다', () => {
  const { container } = render(
    <ChannelDispatchAttemptStatus
      attemptId="other"
      orderNoOf={() => null}
      viewModel={viewModel([])}
    />
  );

  expect(container.textContent).toBe('이 출고에 연결된 쇼핑몰 주문이 없어요.');
});
