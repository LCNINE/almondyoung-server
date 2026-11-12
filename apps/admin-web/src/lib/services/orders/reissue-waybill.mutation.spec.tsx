/**
 * @jest-environment jsdom
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';

jest.mock('@/lib/api/domains', () => ({
  orders: {
    waybills: { reissue: jest.fn() },
    picking: {},
  },
}));
jest.mock('@/lib/api/domains/orders/daily-status.shape', () => ({}));
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

import { orders } from '@/lib/api/domains';
import { useReissueWaybill } from './mutations';
import { orderQueryKeys } from './query-keys';

it('재발급이 실패해도 상자를 다시 불러온다 — 기존 송장은 이미 무효가 됐을 수 있다', async () => {
  jest
    .mocked(orders.waybills.reissue)
    .mockRejectedValue(new Error('carrier failed'));
  const client = new QueryClient();
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useReissueWaybill(), { wrapper });

  await expect(
    result.current.mutateAsync({
      shipmentId: 'ship-1',
      data: { carrier: 'HANJIN', expectedManifestVersion: 1 },
      idempotencyKey: 'key-1',
    })
  ).rejects.toThrow('carrier failed');

  expect(invalidate).toHaveBeenCalledWith({
    queryKey: orderQueryKeys.shipment('ship-1'),
  });
});
