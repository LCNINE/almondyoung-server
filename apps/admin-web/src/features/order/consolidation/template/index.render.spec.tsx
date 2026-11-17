/**
 * @jest-environment jsdom
 */
import { randomUUID } from 'node:crypto';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  ConsolidationBoardGroup,
  ConsolidationBoardShipment,
  ShipmentConsolidationResponse,
} from '@/lib/types/dto/fulfillment';
import type { PendingCommand } from '@/features/order/fulfillments/detail/consolidation-sheet-model';
import ConsolidationTemplate from './index';

const mockMutateAsync = jest.fn<
  Promise<ShipmentConsolidationResponse>,
  [PendingCommand]
>();
const mockRefetch = jest.fn<Promise<unknown>, []>();
let mockGroups: ConsolidationBoardGroup[] = [];

jest.mock('@/lib/services/inventory/queries', () => ({
  useWarehouses: () => ({ data: [{ id: 'wh-1', name: '부천' }] }),
}));

jest.mock('@/lib/services/orders', () => ({
  getServerDenyMessage: (_error: unknown, fallback: string) => fallback,
  useConsolidationBoard: () => ({
    data: { groups: mockGroups },
    isLoading: false,
    isError: false,
    error: null,
    refetch: mockRefetch,
  }),
  useCreateShipmentConsolidation: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

jest.mock('@/hooks/use-permission', () => ({
  usePermissionCheck: () => ({
    can: () => true,
    canRun: () => true,
    isPermissionLoading: false,
  }),
}));

const mockSheet = jest.fn<null, [Record<string, unknown>]>(() => null);

jest.mock('@/features/order/fulfillments/detail/consolidation-sheet', () => ({
  ConsolidationSheet: (props: Record<string, unknown>) => mockSheet(props),
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

// 멱등키를 만드는 crypto.randomUUID 가 jest 의 jsdom(20) 에는 없다.
Object.defineProperty(globalThis.crypto, 'randomUUID', {
  value: randomUUID,
  configurable: true,
});

const box = (
  shipmentId: string,
  items: ConsolidationBoardShipment['items']
): ConsolidationBoardShipment => ({
  shipmentId,
  status: 'draft',
  salesOrderNos: [shipmentId.toUpperCase()],
  itemSummary: '상품',
  totalQty: 1,
  items,
  batchId: null,
  waybillTrackingNo: null,
  manifestVersion: 1,
  reservationVersion: 1,
  createdAt: '2026-11-01T00:00:00Z',
  orderedAt: '2026-11-01T00:00:00Z',
  salesChannels: ['medusa'],
  split: null,
});

const group = (
  key: string,
  shipments: ConsolidationBoardShipment[]
): ConsolidationBoardGroup => ({
  key,
  recipientSnapshot: { recipientName: '김고객', roadAddress: '서울시 1' },
  memoDiffers: false,
  canMergeNow: true,
  shipments,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRefetch.mockResolvedValue(undefined);
  mockMutateAsync.mockResolvedValue({
    operationId: 'op-1',
    operationStatus: 'completed',
    sourceShipmentIds: [],
    targetShipmentId: 't-1',
  });
  mockGroups = [
    group('g1', [
      box('a1', [{ skuId: 'sku-1', name: '립밤', qty: 1 }]),
      box('a2', [
        { skuId: 'sku-1', name: '립밤', qty: 2 },
        { skuId: 'sku-2', name: '핸드크림', qty: 1 },
      ]),
    ]),
    group('g2', [
      box('b1', [{ skuId: 'sku-3', name: '샴푸', qty: 3 }]),
      box('b2', [{ skuId: 'sku-4', name: '린스', qty: 2 }]),
    ]),
  ];
});

describe('합칠 수 있는 주문 상품과 수량', () => {
  it('묶음마다 상품 종류와 총수량을 요약하고 펼치면 주문별 상품과 수량을 보여 준다', async () => {
    const user = userEvent.setup();

    render(<ConsolidationTemplate />);

    expect(screen.getByText('2종 · 총 4개')).toBeTruthy();
    expect(screen.queryByRole('list', { name: '주문 #A1 상품' })).toBeNull();

    const toggle = screen.getByRole('button', {
      name: '#A1, #A2 주문별 상품 보기',
    });

    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    await user.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(
      screen.getByRole('list', { name: '주문 #A1 상품' }).textContent
    ).toBe('립밤 1개');
    expect(
      screen.getByRole('list', { name: '주문 #A2 상품' }).textContent
    ).toBe('립밤 2개핸드크림 1개');
    expect(screen.queryByRole('list', { name: '주문 #B1 상품' })).toBeNull();
  });

  it('선택 항목 합치기는 합친 결과를 상품별로 확인한 뒤에만 요청한다', async () => {
    const user = userEvent.setup();

    render(<ConsolidationTemplate />);

    await user.click(screen.getByRole('checkbox', { name: '#A1, #A2 선택' }));
    await user.click(screen.getByRole('button', { name: '선택 항목 합치기' }));

    const dialog = screen.getByRole('dialog', { name: '선택한 주문 합치기' });

    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('row', { name: /립밤/ }).textContent).toBe(
      '립밤#A1 1개 + #A2 2개3개'
    );
    expect(within(dialog).getByText('2종 · 총 4개')).toBeTruthy();
    expect(within(dialog).queryByText(/샴푸/)).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: '취소' }));

    expect(mockMutateAsync).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '선택 항목 합치기' }));
    await user.click(
      within(
        screen.getByRole('dialog', { name: '선택한 주문 합치기' })
      ).getByRole('button', { name: '1묶음 합치기' })
    );

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    expect(
      mockMutateAsync.mock.calls[0][0].data.sources.map(
        (source) => source.shipmentId
      )
    ).toEqual(['a1', 'a2']);
    expect(
      await screen.findByRole('dialog', { name: '합치기 결과' })
    ).toBeTruthy();
  });

  it('확인 창을 연 뒤 목록이 다시 불러와져도 확인한 상자만 요청한다', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ConsolidationTemplate />);

    await user.click(screen.getByRole('checkbox', { name: '#A1, #A2 선택' }));
    await user.click(screen.getByRole('button', { name: '선택 항목 합치기' }));

    mockGroups = [
      group('g1', [
        ...mockGroups[0].shipments,
        box('a3', [{ skuId: 'sku-9', name: '마스크', qty: 5 }]),
      ]),
      mockGroups[1],
    ];
    rerender(<ConsolidationTemplate />);

    const dialog = screen.getByRole('dialog', { name: '선택한 주문 합치기' });

    expect(within(dialog).queryByText(/마스크/)).toBeNull();

    await user.click(
      within(dialog).getByRole('button', { name: '1묶음 합치기' })
    );

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    expect(
      mockMutateAsync.mock.calls[0][0].data.sources.map(
        (source) => source.shipmentId
      )
    ).toEqual(['a1', 'a2']);
  });
});

describe('합포장 결과에서 출고 준비로', () => {
  it('합친 묶음마다 새 상자의 상품과 그 상자만 출고 준비하는 링크를 남긴다', async () => {
    const user = userEvent.setup();

    render(<ConsolidationTemplate />);

    await user.click(screen.getByRole('checkbox', { name: '#A1, #A2 선택' }));
    await user.click(screen.getByRole('button', { name: '선택 항목 합치기' }));
    await user.click(screen.getByRole('button', { name: '1묶음 합치기' }));

    const result = within(
      await screen.findByRole('listitem', { name: '#A1, #A2 결과' })
    );

    expect(result.getByText('주문 #A1, #A2 → 새 상자 1개')).toBeTruthy();
    expect(
      result.getByRole('list', { name: '주문 #A1, #A2 새 상자 상품' })
        .textContent
    ).toBe('립밤 3개핸드크림 1개');
    expect(
      result
        .getByRole('link', { name: '이 상자 출고 준비' })
        .getAttribute('href')
    ).toBe('/order/waybill-issue?warehouseId=wh-1&prepare=t-1');
  });

  it('실패한 묶음에는 이어 갈 링크를 두지 않는다', async () => {
    mockMutateAsync.mockRejectedValueOnce(
      Object.assign(new Error('reject'), {
        response: { status: 409, data: {} },
      })
    );
    const user = userEvent.setup();

    render(<ConsolidationTemplate />);

    await user.click(screen.getByRole('checkbox', { name: '#A1, #A2 선택' }));
    await user.click(screen.getByRole('button', { name: '선택 항목 합치기' }));
    await user.click(screen.getByRole('button', { name: '1묶음 합치기' }));

    const result = within(
      await screen.findByRole('listitem', { name: '#A1, #A2 결과' })
    );

    expect(result.getByText('실패')).toBeTruthy();
    expect(result.queryByRole('link')).toBeNull();
  });

  it('줄의 합치기는 같은 묶음의 다른 주문을 미리 고른 시트를 연다', async () => {
    const user = userEvent.setup();

    render(<ConsolidationTemplate />);

    await user.click(screen.getAllByRole('button', { name: '합치기' })[0]);

    expect(mockSheet).toHaveBeenLastCalledWith(
      expect.objectContaining({
        shipmentId: 'a1',
        preselect: ['a2'],
        warehouseId: 'wh-1',
      })
    );
  });
});
