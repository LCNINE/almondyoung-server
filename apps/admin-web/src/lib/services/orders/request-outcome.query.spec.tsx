/**
 * @jest-environment jsdom
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

jest.mock('@/lib/api/domains', () => ({
  orders: { fulfillmentOrder: { getRequestOutcome: jest.fn() } },
}));
jest.mock('@/lib/api/domains/orders/daily-status.shape', () => ({}));

import { orders } from '@/lib/api/domains';
import { useFulfillmentRequestOutcome } from './queries';

const getRequestOutcome = jest.mocked(
  orders.fulfillmentOrder.getRequestOutcome
);

it('asks again when the box is opened again, even under the app-wide cache time', async () => {
  getRequestOutcome.mockResolvedValue({
    processed: false,
    operationId: null,
    status: null,
    completedAt: null,
  });
  // 앱 전역 설정과 같은 캐시 시간
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 5 * 60 * 1000, retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const sentAt = Date.now() - 60_000;

  const first = renderHook(
    () => useFulfillmentRequestOutcome('shipment.split', 'k-1', sentAt, 30_000),
    { wrapper }
  );
  await waitFor(() => expect(first.result.current.data).toBeDefined());
  first.unmount();

  renderHook(
    () => useFulfillmentRequestOutcome('shipment.split', 'k-1', sentAt, 30_000),
    { wrapper }
  );

  await waitFor(() => expect(getRequestOutcome).toHaveBeenCalledTimes(2));
});
