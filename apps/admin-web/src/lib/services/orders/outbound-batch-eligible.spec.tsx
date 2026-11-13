/**
 * @jest-environment jsdom
 */
import type { ReactNode } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

jest.mock('@/lib/api/domains', () => ({
  orders: {
    outboundBatches: {
      getV2: jest.fn(),
      getEligibleShipments: jest.fn(),
      addShipment: jest.fn(),
    },
    picking: {},
  },
}));
jest.mock('@/lib/api/domains/orders/daily-status.shape', () => ({}));
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

import { orders } from '@/lib/api/domains';
import type { EligibleShipmentV2 } from '@/lib/types/dto/fulfillment';
import { useAddShipmentToBatch } from './mutations';
import { useOutboundBatchEligibleShipments } from './queries';
import { orderQueryKeys } from './query-keys';

const api = jest.mocked(orders.outboundBatches);
const box = (shipmentId: string) => ({ shipmentId }) as EligibleShipmentV2;

function clientWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

const renderEligible = (
  wrapper: ({ children }: { children: ReactNode }) => ReactNode,
  initialProps: { id: string; enabled: boolean; snapshotAt: number }
) =>
  renderHook(
    ({ id, enabled, snapshotAt }) =>
      useOutboundBatchEligibleShipments(id, { enabled, snapshotAt }),
    { wrapper, initialProps }
  );

beforeEach(() => {
  api.getV2.mockReset();
  api.getEligibleShipments.mockReset();
  api.addShipment.mockReset();
});

it('상자를 넣은 뒤 배치는 다시 받고, 추가할 상자 후보는 그 자리에서 다시 묻지 않는다', async () => {
  api.getV2.mockResolvedValue({ id: 'batch-1' } as never);
  api.getEligibleShipments.mockResolvedValue([]);
  api.addShipment.mockResolvedValue({} as never);
  const { client, wrapper } = clientWrapper();
  const batch = new QueryObserver(client, {
    queryKey: orderQueryKeys.outboundBatchV2('batch-1'),
    queryFn: () => orders.outboundBatches.getV2('batch-1'),
  });
  const stopBatch = batch.subscribe(() => undefined);
  renderEligible(wrapper, { id: 'batch-1', enabled: true, snapshotAt: 1 });
  await waitFor(() =>
    expect(api.getEligibleShipments).toHaveBeenCalledTimes(1)
  );
  await waitFor(() => expect(api.getV2).toHaveBeenCalledTimes(1));

  const { result } = renderHook(() => useAddShipmentToBatch(), { wrapper });
  await result.current.mutateAsync({
    batchId: 'batch-1',
    shipmentId: 'ship-1',
    idempotencyKey: 'key-1',
  });

  await waitFor(() => expect(api.getV2.mock.calls.length).toBeGreaterThan(1));
  expect(api.getEligibleShipments).toHaveBeenCalledTimes(1);
  stopBatch();
});

it('새 배치 시점으로 다시 물으면, 그 전에 보낸 요청이 늦게 와도 새 후보가 남는다', async () => {
  let releaseOld: (value: EligibleShipmentV2[]) => void = () => undefined;
  api.getEligibleShipments
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseOld = resolve;
        })
    )
    .mockResolvedValueOnce([]);
  const { wrapper } = clientWrapper();
  const { result, rerender } = renderEligible(wrapper, {
    id: 'batch-1',
    enabled: true,
    snapshotAt: 1,
  });
  await waitFor(() =>
    expect(api.getEligibleShipments).toHaveBeenCalledTimes(1)
  );

  rerender({ id: 'batch-1', enabled: true, snapshotAt: 2 });
  await waitFor(() => expect(result.current.data).toEqual([]));
  releaseOld([box('ship-1')]);

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(result.current.data).toEqual([]);
  expect(api.getEligibleShipments).toHaveBeenCalledTimes(2);
});

it('새로 받은 배치가 상자를 받지 않으면 묻지 않는다', async () => {
  api.getEligibleShipments.mockResolvedValue([box('ship-1')]);
  const { wrapper } = clientWrapper();
  const { rerender } = renderEligible(wrapper, {
    id: 'batch-1',
    enabled: true,
    snapshotAt: 1,
  });
  await waitFor(() =>
    expect(api.getEligibleShipments).toHaveBeenCalledTimes(1)
  );

  rerender({ id: 'batch-1', enabled: false, snapshotAt: 2 });

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(api.getEligibleShipments).toHaveBeenCalledTimes(1);
});

it('새 응답이 오기 전에는 같은 배치의 앞 후보만 보이고, 다른 배치의 후보는 보이지 않는다', async () => {
  api.getEligibleShipments
    .mockResolvedValueOnce([box('ship-1')])
    .mockImplementation(() => new Promise(() => undefined));
  const { wrapper } = clientWrapper();
  const { result, rerender } = renderEligible(wrapper, {
    id: 'batch-1',
    enabled: true,
    snapshotAt: 1,
  });
  await waitFor(() => expect(result.current.data).toEqual([box('ship-1')]));

  rerender({ id: 'batch-1', enabled: true, snapshotAt: 2 });
  expect(result.current.data).toEqual([box('ship-1')]);

  rerender({ id: 'batch-2', enabled: true, snapshotAt: 3 });
  expect(result.current.data).toBeUndefined();
  expect(result.current.isPending).toBe(true);
});

it('같은 배치 시점으로 다시 열면 후보를 다시 묻지 않는다 — 새 배치가 들어올 때만 묻는다', async () => {
  api.getEligibleShipments.mockResolvedValue([box('ship-1')]);
  const { wrapper } = clientWrapper();
  const first = renderEligible(wrapper, {
    id: 'batch-1',
    enabled: true,
    snapshotAt: 1,
  });
  await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
  first.unmount();

  const again = renderEligible(wrapper, {
    id: 'batch-1',
    enabled: true,
    snapshotAt: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(again.result.current.data).toEqual([box('ship-1')]);
  expect(api.getEligibleShipments).toHaveBeenCalledTimes(1);

  again.rerender({ id: 'batch-1', enabled: true, snapshotAt: 2 });
  await waitFor(() =>
    expect(api.getEligibleShipments).toHaveBeenCalledTimes(2)
  );
});
