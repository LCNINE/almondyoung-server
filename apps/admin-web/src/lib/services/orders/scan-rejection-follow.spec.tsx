/**
 * @jest-environment jsdom
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';

jest.mock('@/lib/api/domains', () => ({
  orders: {
    outboundBatches: { getV2: jest.fn() },
    fulfillmentOrder: { getShipment: jest.fn() },
  },
}));
jest.mock('@/lib/api/domains/orders/daily-status.shape', () => ({}));

import { orders } from '@/lib/api/domains';
import type {
  OutboundBatchV2,
  ScanRejection,
  ShipmentAdminDetail,
} from '@/lib/types/dto/fulfillment';
import { orderQueryKeys } from './query-keys';
import {
  SCAN_REJECTION_REFRESH_MS,
  useFollowBatchScanRejections,
  useOutboundBatchV2,
  useShipmentDetail,
} from './queries';

const getV2 = jest.mocked(orders.outboundBatches.getV2);
const getShipment = jest.mocked(orders.fulfillmentOrder.getShipment);

const rejection: ScanRejection = {
  shipmentId: 'ship-1',
  workItemId: 'item-1',
  code: 'WAYBILL_NOT_DISPATCHABLE',
  reasonCode: null,
  message: '송장을 확인해 주세요',
  action: 'check_waybill',
  route: 'simple_scan',
  barcode: null,
  skuName: null,
  quantity: null,
  actorId: 'worker-1',
  rejectedAt: '2026-01-01T00:00:00.000Z',
};

function batchWith(scanRejection: ScanRejection | null, status = 'picking') {
  return {
    id: 'batch-1',
    workItems: [{ id: 'item-1', status, scanRejection }],
  } as unknown as OutboundBatchV2;
}

function shipmentWith(scanRejection: ScanRejection | null) {
  return { id: 'ship-1', scanRejection } as unknown as ShipmentAdminDetail;
}

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 5 * 60 * 1000, retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

function renderBatch(wrapper: (props: { children: ReactNode }) => ReactNode) {
  return renderHook(
    () => {
      const query = useOutboundBatchV2('batch-1');
      useFollowBatchScanRejections('batch-1', query.data, query.dataUpdatedAt);
      return query;
    },
    { wrapper }
  );
}

// 쿼리 알림은 setTimeout(0)(가짜 시계에서는 1ms)으로 미뤄 그려지므로 1ms 를 더 흘린다
const tick = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
    await jest.advanceTimersByTimeAsync(1);
  });

beforeEach(() => {
  jest.useFakeTimers();
  getV2.mockReset();
  getShipment.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('출고 배치 상세의 막힌 상자 따라가기', () => {
  it('막힌 상자가 없으면 따로 다시 읽지 않는다', async () => {
    getV2.mockResolvedValue(batchWith(null));
    const { wrapper } = setup();
    renderBatch(wrapper);
    await tick(0);

    await tick(SCAN_REJECTION_REFRESH_MS * 3);

    expect(getV2).toHaveBeenCalledTimes(1);
  });

  it('막힘이 그대로면 배치 데이터를 바꾸지 않고, 풀리면 바꾼다', async () => {
    getV2.mockResolvedValue(batchWith(rejection));
    const { wrapper } = setup();
    const view = renderBatch(wrapper);
    await tick(0);
    const firstUpdatedAt = view.result.current.dataUpdatedAt;

    await tick(SCAN_REJECTION_REFRESH_MS);
    expect(getV2).toHaveBeenCalledTimes(2);
    expect(view.result.current.dataUpdatedAt).toBe(firstUpdatedAt);

    getV2.mockResolvedValue(batchWith(null, 'completed'));
    await tick(SCAN_REJECTION_REFRESH_MS);

    expect(view.result.current.data?.workItems[0].scanRejection).toBeNull();
    expect(view.result.current.data?.workItems[0].status).toBe('completed');

    await tick(SCAN_REJECTION_REFRESH_MS * 3);
    expect(getV2).toHaveBeenCalledTimes(3);
  });

  it('막힘이 그대로면 다른 작업 항목이 늘거나 순서가 바뀌어도 배치 데이터를 바꾸지 않는다', async () => {
    getV2.mockResolvedValue(batchWith(rejection));
    const { wrapper } = setup();
    const view = renderBatch(wrapper);
    await tick(0);
    const firstUpdatedAt = view.result.current.dataUpdatedAt;

    getV2.mockResolvedValue({
      id: 'batch-1',
      workItems: [
        { id: 'item-0', status: 'queued', scanRejection: null },
        { id: 'item-1', status: 'picking', scanRejection: rejection },
      ],
    } as unknown as OutboundBatchV2);
    await tick(SCAN_REJECTION_REFRESH_MS);

    expect(getV2).toHaveBeenCalledTimes(2);
    expect(view.result.current.dataUpdatedAt).toBe(firstUpdatedAt);
  });

  it('배치를 새로 받기 전에 시작한 조회는 늦게 와도 반영하지 않는다', async () => {
    getV2.mockResolvedValueOnce(batchWith(rejection));
    const { client, wrapper } = setup();
    const view = renderBatch(wrapper);
    await tick(0);

    let releaseOld: (value: OutboundBatchV2) => void = () => undefined;
    getV2.mockImplementationOnce(
      () =>
        new Promise<OutboundBatchV2>((resolve) => {
          releaseOld = resolve;
        })
    );
    await tick(SCAN_REJECTION_REFRESH_MS);

    const newer = batchWith({ ...rejection, code: 'WAYBILL_STALE' });
    getV2.mockResolvedValueOnce(newer);
    await act(async () => {
      await client.refetchQueries({
        queryKey: orderQueryKeys.outboundBatchV2('batch-1'),
        exact: true,
      });
    });
    await tick(1);
    expect(view.result.current.data).toEqual(newer);

    await act(async () => {
      releaseOld(batchWith(null));
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(view.result.current.data).toEqual(newer);
  });
});

describe('상자 상세의 막힌 상자 따라가기', () => {
  it('막힘 표시가 있는 동안만 다시 읽는다', async () => {
    getShipment.mockResolvedValue(shipmentWith(rejection));
    const { wrapper } = setup();
    renderHook(
      () => useShipmentDetail('ship-1', { followScanRejection: true }),
      { wrapper }
    );
    await tick(0);

    getShipment.mockResolvedValue(shipmentWith(null));
    await tick(SCAN_REJECTION_REFRESH_MS);
    expect(getShipment).toHaveBeenCalledTimes(2);

    await tick(SCAN_REJECTION_REFRESH_MS * 3);
    expect(getShipment).toHaveBeenCalledTimes(2);
  });

  it('따라가기를 켜지 않은 화면은 다시 읽지 않는다', async () => {
    getShipment.mockResolvedValue(shipmentWith(rejection));
    const { wrapper } = setup();
    renderHook(() => useShipmentDetail('ship-1'), { wrapper });
    await tick(0);

    await tick(SCAN_REJECTION_REFRESH_MS * 3);

    expect(getShipment).toHaveBeenCalledTimes(1);
  });
});
