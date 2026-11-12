/**
 * @jest-environment jsdom
 */
import { render } from '@testing-library/react';
import type { FulfillmentOrderDetail } from '@/lib/types/dto/fulfillment';
import { HistoryTab } from './history-tab';

jest.mock('@/lib/services/orders', () => ({
  useFulfillmentOutboxEvents: () => ({
    isLoading: false,
    isError: false,
    data: [
      {
        id: 'ev-1',
        eventType: 'FulfillmentShipped',
        status: 'failed',
        attempts: 2,
        publishedAt: null,
        nextAttemptAt: '2026-11-01T01:00:00Z',
        createdAt: '2026-11-01T00:00:00Z',
      },
      {
        id: 'ev-3',
        eventType: 'FulfillmentLabelled',
        status: 'skipped',
        attempts: 5,
        publishedAt: null,
        nextAttemptAt: '2026-11-01T02:00:00Z',
        createdAt: '2026-11-01T00:00:00Z',
      },
      {
        id: 'ev-2',
        eventType: 'FulfillmentReady',
        status: 'pending',
        attempts: 1,
        publishedAt: null,
        nextAttemptAt: '2026-11-01T01:00:00Z',
        createdAt: '2026-11-01T00:00:00Z',
      },
    ],
  }),
}));

const fo = {
  id: 'fo-1',
  createdAt: '2026-11-01T00:00:00Z',
  allocatedAt: '2026-11-01T00:10:00Z',
  shippedAt: null,
  canceledAt: null,
} as unknown as FulfillmentOrderDetail;

it('알림 기록을 하는 일과 한국어 상태로 보이고 개발 용어를 쓰지 않는다', () => {
  const { container } = render(<HistoryTab fo={fo} />);
  const text = container.textContent ?? '';

  for (const expected of [
    '재고 확보',
    '쇼핑몰·연동 알림',
    '출고 완료',
    '보내지 못함',
    '보내지 못하고 멈춘 알림이 1건 있어요',
    '다시 보내는 중인 알림이 1건 있어요',
    '다시 보내지 않아요',
  ]) {
    expect(text).toContain(expected);
  }
  expect(text).not.toMatch(
    /Outbox|outbox|dispatcher|projection|Medusa|channel-adapter|FulfillmentShipped|할당됨|자동으로 다시 보내고/
  );
});

it('다시 보낼 시각은 보내는 중인 알림에만 보인다', () => {
  const { container } = render(<HistoryTab fo={fo} />);

  expect((container.textContent ?? '').split('다시 보낼 시각').length - 1).toBe(
    1
  );
});
