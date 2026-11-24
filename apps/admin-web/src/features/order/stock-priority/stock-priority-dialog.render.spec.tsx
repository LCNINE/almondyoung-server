/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { StockPriorityPreview } from '@/lib/types/dto/fulfillment';
import {
  StockPriorityCancelDialog,
  StockPriorityDialog,
} from './stock-priority-dialog';

const mockPreview = jest.fn();
const mockSet = jest.fn();
const mockCancel = jest.fn();
const mockToast = { success: jest.fn(), error: jest.fn() };

jest.mock('sonner', () => ({
  toast: {
    success: (text: string) => mockToast.success(text),
    error: (text: string) => mockToast.error(text),
  },
}));
jest.mock('@/lib/services/orders/queries', () => ({
  useStockPriorityPreview: () => mockPreview(),
}));
jest.mock('@/lib/services/orders/mutations', () => ({
  useSetStockPriority: () => ({ mutateAsync: mockSet, isPending: false }),
  useCancelStockPriority: () => ({ mutateAsync: mockCancel, isPending: false }),
}));

const refetch = jest.fn();
const take = {
  shipmentId: 'box-big',
  orderNos: ['A-1'],
  skuName: '상품 가',
  qty: 1,
  ready: false,
  emptied: true,
};

function preview(over: Partial<StockPriorityPreview> = {}) {
  mockPreview.mockReturnValue({
    data: {
      shipmentId: 'box',
      orderNos: ['B-1'],
      stockAllocation: 'normal',
      blocked: null,
      lines: [
        {
          skuId: 'sku',
          skuName: '상품 가',
          qty: 1,
          reservedQty: 0,
          missingQty: 1,
        },
      ],
      plan: { freeQty: 0, takes: [take], missingQty: 0, token: 'token-1' },
      planWithReady: null,
      ...over,
    },
    isPending: false,
    isFetching: false,
    refetch,
  });
}

/** 관리자 API 클라이언트가 4xx 를 바꿔 던지는 모양 */
function rejection(status: number, code: string) {
  return Object.assign(new Error('거절'), {
    statusCode: status,
    response: { code, message: '거절' },
  });
}

const open = () => {
  const onClose = jest.fn();
  render(
    <StockPriorityDialog shipmentId="box" orderText="#B-1" onClose={onClose} />
  );
  return onClose;
};
const run = () =>
  fireEvent.click(screen.getByRole('button', { name: '우선할당' }));

let keys = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', {
  configurable: true,
  value: () => `key-${++keys}`,
});

beforeEach(() => {
  jest.clearAllMocks();
  preview();
});

it('어느 주문에서 몇 개를 가져오고 그 주문이 어떻게 되는지 보인다', () => {
  open();

  expect(screen.getByText('#A-1에서 상품 가 1개')).toBeTruthy();
  expect(
    screen.getByText('잡은 재고가 없어져 출고불가로 다음 재고를 기다려요')
  ).toBeTruthy();
  expect(
    screen.getByText('재고가 다 차서 바로 출고 준비를 할 수 있어요.')
  ).toBeTruthy();
});

it('본 계획의 값으로 실행하고 결과를 알린 뒤 닫는다', async () => {
  mockSet.mockResolvedValue({ movedQty: 1, freeQty: 0, missingQty: 0 });
  const onClose = open();
  run();

  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(mockSet).toHaveBeenCalledWith({
    shipmentId: 'box',
    data: {
      reason: '먼저 들어온 주문이 재고를 잡고 있어 못 나감',
      reasonCode: 'blocked_by_waiting_order',
      planToken: 'token-1',
    },
    idempotencyKey: expect.stringMatching(/^key-/),
  });
  expect(mockToast.success).toHaveBeenCalledWith(
    '#B-1 재고를 다 잡았어요. 완전출고에서 바로 보낼 수 있어요.'
  );
});

it('바로 나갈 수 있는 주문의 재고는 체크해야 가져온다', async () => {
  mockSet.mockResolvedValue({ movedQty: 1, freeQty: 0, missingQty: 0 });
  preview({
    plan: { freeQty: 0, takes: [], missingQty: 1, token: 'token-1' },
    planWithReady: {
      freeQty: 0,
      takes: [{ ...take, ready: true, emptied: false }],
      missingQty: 0,
      token: 'token-ready',
    },
  });
  open();
  expect(
    screen.getByText(
      '지금 옮길 재고가 없어요. 모자란 1개는 다음에 들어오는 재고를 먼저 받아요.'
    )
  ).toBeTruthy();

  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByText('완전출고에서 부분출고로 바뀌어요')).toBeTruthy();
  run();

  await waitFor(() => expect(mockSet).toHaveBeenCalled());
  expect(mockSet.mock.calls[0][0].data).toMatchObject({
    planToken: 'token-ready',
    includeReady: true,
  });
});

it('완전출고 계획이 없으면 체크 칸을 보이지 않는다', () => {
  open();
  expect(screen.queryByRole('checkbox')).toBeNull();
});

it('보던 사이 바뀌었으면 닫지 않고 새로 읽어 다시 확인하게 한다', async () => {
  mockSet.mockRejectedValue(rejection(409, 'STOCK_PRIORITY_PLAN_CHANGED'));
  const onClose = open();
  run();

  expect(
    await screen.findByText(
      '그 사이 재고나 다른 주문이 바뀌었어요. 아래 내용을 다시 확인해 주세요.'
    )
  ).toBeTruthy();
  expect(refetch).toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it('응답을 못 받으면 같은 키와 내용으로만 다시 보낸다', async () => {
  mockSet
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce({ movedQty: 1, freeQty: 0, missingQty: 0 });
  const onClose = open();
  run();

  fireEvent.click(
    await screen.findByRole('button', { name: '같은 요청 다시 보내기' })
  );
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(mockSet.mock.calls[1][0]).toEqual(mockSet.mock.calls[0][0]);
});

it('막힌 상자는 이유를 보이고 실행할 수 없다', () => {
  preview({ blocked: 'IN_BATCH', plan: null });
  open();

  expect(screen.getByText(/출고 배치에서 작업 중인 상자예요/)).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: '우선할당' }).disabled
  ).toBe(true);
});

it('재고를 못 읽으면 실행 대신 다시 읽게 한다', () => {
  mockPreview.mockReturnValue({
    data: undefined,
    isPending: false,
    isFetching: false,
    refetch,
  });
  open();

  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  expect(refetch).toHaveBeenCalled();
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: '우선할당' }).disabled
  ).toBe(true);
});

it('취소는 사유와 함께 표시를 거둔다', async () => {
  mockCancel.mockResolvedValue(undefined);
  const onClose = jest.fn();
  render(
    <StockPriorityCancelDialog
      shipmentId="box"
      orderText="#B-1"
      onClose={onClose}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: '우선할당 취소' }));

  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(mockCancel.mock.calls[0][0]).toMatchObject({
    shipmentId: 'box',
    data: { reasonCode: 'no_longer_urgent' },
  });
});

it('취소 응답을 못 받으면 같은 키로만 다시 보낸다', async () => {
  mockCancel
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce(undefined);
  const onClose = jest.fn();
  render(
    <StockPriorityCancelDialog
      shipmentId="box"
      orderText="#B-1"
      onClose={onClose}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: '우선할당 취소' }));
  fireEvent.click(
    await screen.findByRole('button', { name: '같은 요청 다시 보내기' })
  );

  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(mockCancel.mock.calls[1][0]).toEqual(mockCancel.mock.calls[0][0]);
});

it('다 채우지 못하면 누가 잡고 있고 어떻게 하면 되는지 보인다', () => {
  preview({
    plan: { freeQty: 0, takes: [], missingQty: 1, token: 'token-1' },
    held: [
      { reason: 'priority', orderNos: ['P-1'], qty: 2 },
      { reason: 'in_progress', orderNos: ['Q-1', 'Q-2', 'Q-3', 'Q-4'], qty: 4 },
    ],
  });
  open();

  expect(
    screen.getByText(
      '우선할당한 주문(#P-1)이 2개를 잡고 있어요. 먼저 보낼 필요가 없으면 그 주문의 우선할당을 취소한 뒤 다시 열어 보세요.'
    )
  ).toBeTruthy();
  expect(
    screen.getByText(/#Q-1, #Q-2, #Q-3 외 1건\)가 4개를 잡고 있어요/)
  ).toBeTruthy();
});
