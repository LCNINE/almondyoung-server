/**
 * @jest-environment jsdom
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

jest.mock('@/lib/api/domains', () => ({
  orders: {
    picking: {},
    outboundPreparation: { summary: jest.fn() },
    consolidation: { createShipmentConsolidation: jest.fn() },
    outboundBatches: { addShipment: jest.fn(), excludeShipment: jest.fn() },
    salesOrders: {
      cancelSalesOrder: jest.fn(),
      adminCancelSalesOrder: jest.fn(),
    },
  },
}));
jest.mock('@/lib/api/domains/orders/daily-status.shape', () => ({}));
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

import { orders } from '@/lib/api/domains';
import type { OutboundPreparationSummary } from '@/lib/types/dto/fulfillment';
import {
  useAddShipmentToBatch,
  useAdminCancelSalesOrder,
  useCancelSalesOrder,
  useCreateShipmentConsolidation,
  useExcludeShipmentFromBatch,
} from './mutations';
import { useOutboundPreparationSummary } from './queries';

const summaryApi = jest.mocked(orders.outboundPreparation.summary);

const summaryWith = (ids: string[]) =>
  ({
    buckets: [
      {
        bucket: 'ready',
        count: ids.length,
        shipments: ids.map((shipmentId) => ({ shipmentId })),
      },
    ],
  }) as unknown as OutboundPreparationSummary;

const idsOf = (summary: OutboundPreparationSummary | undefined) =>
  summary?.buckets[0].shipments.map((shipment) => shipment.shipmentId);

function clientWrapper() {
  // 관리자 앱과 같은 기본 신선도(5분)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

async function renderBadge(
  wrapper: ({ children }: { children: ReactNode }) => ReactNode
) {
  summaryApi.mockResolvedValueOnce(summaryWith(['old']));

  const badge = renderHook(() => useOutboundPreparationSummary('w1'), {
    wrapper,
  });

  await waitFor(() =>
    expect(idsOf(badge.result.current.data)).toEqual(['old'])
  );

  return badge;
}

beforeEach(() => {
  jest.clearAllMocks();
  summaryApi.mockReset();
});

describe('출고 준비 요약 신선도', () => {
  it('메뉴 배지가 받아 둔 요약이 있어도 출고 준비 화면은 들어올 때 다시 읽고 그동안 조회 중이다', async () => {
    const { wrapper } = clientWrapper();

    await renderBadge(wrapper);
    summaryApi.mockResolvedValueOnce(summaryWith(['old', 'merged']));

    const page = renderHook(
      () => useOutboundPreparationSummary('w1', true, 'always'),
      { wrapper }
    );

    expect(page.result.current.isFetching).toBe(true);
    await waitFor(() =>
      expect(idsOf(page.result.current.data)).toEqual(['old', 'merged'])
    );
    expect(summaryApi).toHaveBeenCalledTimes(2);
  });

  it('메뉴 배지처럼 기본으로 쓰면 받아 둔 요약을 그대로 쓴다', async () => {
    const { wrapper } = clientWrapper();

    await renderBadge(wrapper);

    const other = renderHook(() => useOutboundPreparationSummary('w1'), {
      wrapper,
    });

    expect(other.result.current.isFetching).toBe(false);
    expect(summaryApi).toHaveBeenCalledTimes(1);
  });

  const commands: [string, () => () => Promise<unknown>][] = [
    [
      '합포장',
      () => {
        jest
          .mocked(orders.consolidation.createShipmentConsolidation)
          .mockResolvedValue({} as never);
        const { mutateAsync } = useCreateShipmentConsolidation();
        return () => mutateAsync({ data: {} as never, idempotencyKey: 'k1' });
      },
    ],
    [
      '배치에 넣기',
      () => {
        jest
          .mocked(orders.outboundBatches.addShipment)
          .mockResolvedValue({} as never);
        const { mutateAsync } = useAddShipmentToBatch();
        return () =>
          mutateAsync({
            batchId: 'b1',
            shipmentId: 's1',
            idempotencyKey: 'k1',
          });
      },
    ],
    [
      '배치에서 빼기',
      () => {
        jest
          .mocked(orders.outboundBatches.excludeShipment)
          .mockResolvedValue({} as never);
        const { mutateAsync } = useExcludeShipmentFromBatch();
        return () =>
          mutateAsync({
            batchId: 'b1',
            shipmentId: 's1',
            reason: '테스트',
            idempotencyKey: 'k1',
          });
      },
    ],
    [
      '주문 취소',
      () => {
        jest
          .mocked(orders.salesOrders.cancelSalesOrder)
          .mockResolvedValue({} as never);
        const { mutateAsync } = useCancelSalesOrder();
        return () => mutateAsync({ id: 'o1' });
      },
    ],
    [
      '관리자 주문 취소',
      () => {
        jest
          .mocked(orders.salesOrders.adminCancelSalesOrder)
          .mockResolvedValue({} as never);
        const { mutateAsync } = useAdminCancelSalesOrder();
        return () => mutateAsync({ id: 'o1' });
      },
    ],
  ];

  it.each(commands)(
    '%s 뒤에는 열려 있는 메뉴 배지의 요약을 바로 다시 읽는다',
    async (_, useCommand) => {
      const { wrapper } = clientWrapper();
      const badge = await renderBadge(wrapper);
      const command = renderHook(useCommand, { wrapper });

      summaryApi.mockResolvedValueOnce(summaryWith(['merged']));
      await act(() => command.result.current());

      await waitFor(() =>
        expect(idsOf(badge.result.current.data)).toEqual(['merged'])
      );
      expect(summaryApi).toHaveBeenCalledTimes(2);
    }
  );
});
