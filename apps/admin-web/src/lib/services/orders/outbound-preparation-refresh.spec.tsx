/**
 * @jest-environment jsdom
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

jest.mock('@/lib/api/domains', () => ({
  orders: {
    picking: {},
    outboundPreparation: { summary: jest.fn(), counts: jest.fn() },
    consolidation: {
      createShipmentConsolidation: jest.fn(),
      getBoard: jest.fn(),
      getBoardCount: jest.fn(),
    },
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
import type {
  ConsolidationBoardResponse,
  OutboundPreparationCounts,
  OutboundPreparationSummary,
} from '@/lib/types/dto/fulfillment';
import {
  useAddShipmentToBatch,
  useAdminCancelSalesOrder,
  useCancelSalesOrder,
  useCreateShipmentConsolidation,
  useExcludeShipmentFromBatch,
} from './mutations';
import {
  useConsolidationBoard,
  useConsolidationBoardCount,
  useOutboundPreparationCounts,
  useOutboundPreparationSummary,
} from './queries';
import { orderQueryKeys } from './query-keys';

const summaryApi = jest.mocked(orders.outboundPreparation.summary);
const countsApi = jest.mocked(orders.outboundPreparation.counts);
const boardApi = jest.mocked(orders.consolidation.getBoard);
const boardCountApi = jest.mocked(orders.consolidation.getBoardCount);

const countsOf = (ready: number): OutboundPreparationCounts => ({
  warehouseId: 'w1',
  buckets: [{ bucket: 'ready', count: ready }],
});

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
  countsApi.mockResolvedValueOnce(countsOf(1));

  const badge = renderHook(() => useOutboundPreparationCounts('w1'), {
    wrapper,
  });

  await waitFor(() =>
    expect(badge.result.current.data?.buckets[0].count).toBe(1)
  );

  return badge;
}

beforeEach(() => {
  jest.clearAllMocks();
  summaryApi.mockReset();
  countsApi.mockReset();
  boardApi.mockReset();
  boardCountApi.mockReset();
});

describe('출고 준비 요약 신선도', () => {
  it('메뉴 배지는 내역을 부르지 않고 숫자만 받는다', async () => {
    const { wrapper } = clientWrapper();

    await renderBadge(wrapper);

    expect(countsApi).toHaveBeenCalledWith('w1');
    expect(summaryApi).not.toHaveBeenCalled();
  });

  it('출고 준비 화면은 들어올 때 다시 읽고, 읽은 내역으로 배지 숫자를 맞춘다', async () => {
    const { wrapper } = clientWrapper();
    const badge = await renderBadge(wrapper);

    summaryApi.mockResolvedValueOnce(summaryWith(['old', 'merged']));
    const page = renderHook(
      () => useOutboundPreparationSummary('w1', true, 'always'),
      { wrapper }
    );

    expect(page.result.current.isFetching).toBe(true);
    await waitFor(() =>
      expect(idsOf(page.result.current.data)).toEqual(['old', 'merged'])
    );
    await waitFor(() =>
      expect(badge.result.current.data?.buckets[0].count).toBe(2)
    );
    expect(countsApi).toHaveBeenCalledTimes(1);
  });

  it('먼저 떠난 배지 숫자 조회가 늦게 와도 화면 내역으로 맞춘 숫자를 덮지 않는다', async () => {
    const { wrapper } = clientWrapper();
    let releaseCounts: (value: OutboundPreparationCounts) => void = () => {};

    countsApi.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseCounts = resolve;
      })
    );
    const badge = renderHook(() => useOutboundPreparationCounts('w1'), {
      wrapper,
    });
    await waitFor(() => expect(countsApi).toHaveBeenCalledTimes(1));

    summaryApi.mockResolvedValueOnce(summaryWith(['a', 'b']));
    const page = renderHook(
      () => useOutboundPreparationSummary('w1', true, 'always'),
      { wrapper }
    );
    await waitFor(() =>
      expect(idsOf(page.result.current.data)).toEqual(['a', 'b'])
    );
    await waitFor(() =>
      expect(badge.result.current.data?.buckets[0].count).toBe(2)
    );

    await act(async () => releaseCounts(countsOf(1)));
    await waitFor(() => expect(badge.result.current.isFetching).toBe(false));
    expect(badge.result.current.data?.buckets[0].count).toBe(2);
  });

  it('먼저 떠난 묶음 수 조회가 늦게 와도 보드로 맞춘 숫자를 덮지 않는다', async () => {
    const { wrapper } = clientWrapper();
    let releaseCount: (value: { groupCount: number }) => void = () => {};

    boardCountApi.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseCount = resolve;
      })
    );
    const badge = renderHook(() => useConsolidationBoardCount('w1'), {
      wrapper,
    });
    await waitFor(() => expect(boardCountApi).toHaveBeenCalledTimes(1));

    boardApi.mockResolvedValueOnce({
      groups: [{}, {}],
    } as unknown as ConsolidationBoardResponse);
    renderHook(() => useConsolidationBoard('w1'), { wrapper });
    await waitFor(() => expect(badge.result.current.data?.groupCount).toBe(2));

    await act(async () => releaseCount({ groupCount: 5 }));
    await waitFor(() => expect(badge.result.current.isFetching).toBe(false));
    expect(badge.result.current.data?.groupCount).toBe(2);
  });

  it('화주로 걸러 읽은 내역은 배지 숫자를 바꾸지 않는다', async () => {
    const { client, wrapper } = clientWrapper();

    await renderBadge(wrapper);
    summaryApi.mockResolvedValueOnce(summaryWith(['own-1', 'own-2']));
    const page = renderHook(
      () => useOutboundPreparationSummary('w1', true, 'always', ['own']),
      { wrapper }
    );

    await waitFor(() =>
      expect(idsOf(page.result.current.data)).toEqual(['own-1', 'own-2'])
    );
    expect(
      client.getQueryData<OutboundPreparationCounts>(
        orderQueryKeys.outboundPreparationCounts('w1')
      )?.buckets[0].count
    ).toBe(1);
  });

  it('합칠 수 있는 주문 배지는 묶음 수만 받고, 보드를 읽으면 그 묶음 수로 맞춘다', async () => {
    const { wrapper } = clientWrapper();

    boardCountApi.mockResolvedValueOnce({ groupCount: 3 });
    const badge = renderHook(() => useConsolidationBoardCount('w1'), {
      wrapper,
    });
    await waitFor(() => expect(badge.result.current.data?.groupCount).toBe(3));
    expect(boardApi).not.toHaveBeenCalled();

    boardApi.mockResolvedValueOnce({
      groups: [{}, {}],
    } as unknown as ConsolidationBoardResponse);
    renderHook(() => useConsolidationBoard('w1'), { wrapper });

    await waitFor(() => expect(badge.result.current.data?.groupCount).toBe(2));
    expect(boardCountApi).toHaveBeenCalledTimes(1);
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
    '%s 뒤에는 열려 있는 메뉴 배지 숫자를 바로 다시 읽는다',
    async (_, useCommand) => {
      const { wrapper } = clientWrapper();
      const badge = await renderBadge(wrapper);
      const command = renderHook(useCommand, { wrapper });

      countsApi.mockResolvedValueOnce(countsOf(5));
      await act(() => command.result.current());

      await waitFor(() =>
        expect(badge.result.current.data?.buckets[0].count).toBe(5)
      );
      expect(countsApi).toHaveBeenCalledTimes(2);
    }
  );
});
