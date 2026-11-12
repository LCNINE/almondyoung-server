/**
 * @jest-environment jsdom
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  ShipmentAdminDetail,
  ShipmentAdminLine,
} from '@/lib/types/dto/fulfillment';
import { ShipmentActions } from './shipment-actions';

const mockSplit = jest.fn();
const mockRecall = jest.fn();
let mockCanRecall = false;
let mockOperationStatus: string | undefined;
let mockKeySeq = 0;

jest.mock('@/hooks/use-permission', () => ({
  usePermissionCheck: () => ({
    can: () => false,
    canRun: () => true,
  }),
}));

jest.mock('@/lib/services/inventory/queries', () => ({
  useDeliveryProfiles: () => ({ data: [], isLoading: false, isError: false }),
}));

jest.mock('@/lib/services/orders', () => {
  const idle = () => ({ mutateAsync: jest.fn(), isPending: false });
  return {
    canRecallShipment: () => mockCanRecall,
    createIdempotentCommand: (_command: unknown, originalKey?: string) => ({
      idempotencyKey: originalKey ?? `key-${++mockKeySeq}`,
    }),
    getServerDenyMessage: (_error: unknown, fallback: string) => fallback,
    parseServerError: jest.requireActual<
      typeof import('@/lib/api/server-error')
    >('@/lib/api/server-error').parseServerError,
    isRecoverableOperation: (status?: string) =>
      status === 'pending' ||
      status === 'in_progress' ||
      status === 'recovery_required',
    useCreateShipmentConsolidation: idle,
    useFulfillmentOperation: (operationId: string) => ({
      data:
        operationId && mockOperationStatus
          ? { status: mockOperationStatus }
          : undefined,
    }),
    usePlanShipment: idle,
    useRecallShipment: () => ({ mutateAsync: mockRecall, isPending: false }),
    useReviseShipmentRecipient: idle,
    useSplitShipment: () => ({ mutateAsync: mockSplit, isPending: false }),
  };
});

jest.mock('./consolidation-sheet', () => ({ ConsolidationSheet: () => null }));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

Element.prototype.hasPointerCapture = () => false;
Element.prototype.scrollIntoView = () => {};

function line(
  id: string,
  qty: number,
  extra: Partial<ShipmentAdminLine> = {}
): ShipmentAdminLine {
  return {
    id,
    fulfillmentOrderId: 'fo-1',
    fulfillmentOrderItemId: `item-${id}`,
    skuId: `sku-${id}-0000`,
    qty,
    reservedQty: qty,
    inspectedQty: 0,
    lineVersion: 3,
    origin: null,
    reservations: [],
    ...extra,
  };
}

function origin(channelOrderId: string, displayOrderNo: string | null) {
  return {
    salesOrderLineId: `sol-${channelOrderId}`,
    salesOrderId: `so-${channelOrderId}`,
    salesChannel: 'medusa',
    channelOrderId,
    displayOrderNo,
    channelOrderItemId: null,
    channelProductId: null,
  };
}

function shipment(lines: ShipmentAdminLine[]): ShipmentAdminDetail {
  return {
    id: 'shipment-1',
    status: 'draft',
    warehouseId: 'wh-1',
    supplierId: null,
    manifestVersion: 7,
    reservationVersion: 2,
    recipientSnapshot: null,
    lines,
    waybills: [],
    workItems: [],
    dispatchAttempts: [],
    operations: [],
  };
}

const mergedBox = shipment([
  line('line-a', 1, {
    skuName: '샘플 상품 (빨강)',
    origin: origin('ch-order-1', 'ORDER-1'),
  }),
  line('line-b', 2, {
    skuName: '샘플 상품 (빨강)',
    origin: origin('ch-order-2', 'ORDER-2'),
  }),
  line('line-c', 1, {
    skuName: '샘플 상품 (파랑)',
    origin: origin('ch-order-2', null),
  }),
]);

async function chooseCustomerReason(dialog: HTMLElement) {
  await userEvent.click(
    within(dialog).getByRole('radio', {
      name: '고객이 일부 먼저 보내 달라고 요청',
    })
  );
  await userEvent.click(
    within(dialog).getByRole('radio', { name: '카카오 상담' })
  );
}

async function openSplit(detail = mergedBox) {
  render(<ShipmentActions shipment={detail} />);
  await userEvent.click(screen.getByRole('button', { name: '분할' }));
  return screen.getByRole('dialog');
}

beforeEach(() => {
  mockCanRecall = false;
  mockOperationStatus = undefined;
  mockKeySeq = 0;
  mockRecall.mockReset();
  mockSplit.mockReset();
  mockSplit.mockResolvedValue({
    operationId: 'op-1',
    operationStatus: 'completed',
  });
});

it('나눌 상품을 상품명·주문번호·지금 수량으로 고른다', async () => {
  const dialog = await openSplit();

  await userEvent.click(
    within(dialog).getByRole('combobox', { name: '나눌 상품' })
  );

  expect(
    screen.getAllByRole('option').map((option) => option.textContent)
  ).toEqual([
    '샘플 상품 (빨강) · #ORDER-1 · 1개',
    '샘플 상품 (빨강) · #ORDER-2 · 2개',
    '샘플 상품 (파랑) · #ch-order-2 · 1개',
  ]);
});

it('입력한 수량으로 이번 상자에 남을 수량과 새 상자로 보낼 수량을 보여 주고 분할하기로 보낸다', async () => {
  const dialog = await openSplit();

  await userEvent.click(
    within(dialog).getByRole('combobox', { name: '나눌 상품' })
  );
  await userEvent.click(
    screen.getByRole('option', { name: '샘플 상품 (빨강) · #ORDER-2 · 2개' })
  );
  const qty = within(dialog).getByLabelText('새 상자로 보낼 수량');
  await userEvent.clear(qty);
  await userEvent.type(qty, '1');

  const preview = within(dialog).getByRole('status');
  expect(preview.textContent).toContain(
    '이번 상자에 남을 수량샘플 상품 (빨강) 1개 · 상자 전체 3개'
  );
  expect(preview.textContent).toContain(
    '새 상자로 보낼 수량샘플 상품 (빨강) 1개'
  );

  await chooseCustomerReason(dialog);
  await userEvent.click(
    within(dialog).getByRole('button', { name: '분할하기' })
  );

  expect(mockSplit).toHaveBeenCalledTimes(1);
  expect(mockSplit.mock.calls[0][0]).toMatchObject({
    shipmentId: 'shipment-1',
    data: {
      expectedManifestVersion: 7,
      moves: [{ shipmentLineId: 'line-b', expectedLineVersion: 3, qty: 1 }],
    },
  });
});

it('분할은 사유 이름표와 요청 경로를 보내고 CS 건 번호는 보내지 않는다', async () => {
  const dialog = await openSplit();
  await chooseCustomerReason(dialog);
  await userEvent.click(
    within(dialog).getByRole('button', { name: '분할하기' })
  );

  const { data } = mockSplit.mock.calls[0][0];
  expect(data).toMatchObject({
    reason: '고객이 일부 먼저 보내 달라고 요청',
    reasonCode: 'customer_ship_first',
    requestChannel: 'kakao',
  });
  expect(data).not.toHaveProperty('csCaseId');
  expect(dialog.textContent).not.toMatch(/CS case/);
});

it('사유를 고르지 않고 분할하기를 누르면 보내지 않고 안내한다', async () => {
  const dialog = await openSplit();
  await userEvent.click(
    within(dialog).getByRole('button', { name: '분할하기' })
  );

  expect(mockSplit).not.toHaveBeenCalled();
  expect(within(dialog).getByText('작업 사유를 골라 주세요.')).toBeTruthy();
});

it('보낼 수 없는 수량이면 범위를 알려 주고 분할하기를 막는다', async () => {
  const dialog = await openSplit();
  const qty = within(dialog).getByLabelText('새 상자로 보낼 수량');

  await userEvent.clear(qty);
  await userEvent.type(qty, '2');

  expect(within(dialog).queryByRole('status')).toBeNull();
  expect(dialog.textContent).toContain('1개부터 1개까지 보낼 수 있어요.');
  expect(
    within(dialog).getByRole('button', { name: '분할하기' })
  ).toHaveProperty('disabled', true);
});

it('상자에 상품이 하나뿐이면 더 나눌 수 없다고 알린다', async () => {
  const dialog = await openSplit(
    shipment([line('line-a', 1, { skuName: '샘플 상품 (빨강)' })])
  );

  expect(dialog.textContent).toContain(
    '이 상자에는 상품이 1개뿐이라 나눌 수 없어요.'
  );
  expect(
    within(dialog).getByRole('button', { name: '분할하기' })
  ).toHaveProperty('disabled', true);
});

it('상품명을 싣지 않는 응답이면 SKU 앞자리로 보여 준다', async () => {
  const dialog = await openSplit(
    shipment([line('line-a', 2), line('line-b', 1)])
  );

  expect(
    within(dialog).getByRole('combobox', { name: '나눌 상품' }).textContent
  ).toBe('SKU sku-line · 2개');
});

it('고른 줄이 다시 불러온 상자에 없으면 다시 고르라고 알린다', async () => {
  const { rerender } = render(<ShipmentActions shipment={mergedBox} />);
  await userEvent.click(screen.getByRole('button', { name: '분할' }));

  rerender(<ShipmentActions shipment={shipment(mergedBox.lines.slice(1))} />);

  const dialog = screen.getByRole('dialog');
  expect(dialog.textContent).toContain('나눌 상품을 고르세요.');
  expect(
    within(dialog).getByRole('button', { name: '분할하기' })
  ).toHaveProperty('disabled', true);
});

const shippedBox: ShipmentAdminDetail = {
  ...shipment([line('line-a', 1, { skuName: '샘플 상품 (빨강)' })]),
  status: 'shipped',
  waybills: [
    {
      id: 'wb-1',
      status: 'registered',
      trackingNo: '4567-8901-2345',
      carrier: 'HANJIN',
      manifestVersion: 7,
      issuedAt: '2026-11-01T00:00:00Z',
      voidedAt: null,
    },
  ],
  dispatchAttempts: [
    {
      id: 'attempt-uuid-1',
      attemptNo: 1,
      status: 'dispatched',
      waybillId: 'wb-1',
      dispatchedAt: '2026-11-01T01:00:00Z',
      recalledAt: null,
      recoveryCode: null,
      sources: [],
      trackingEvents: [],
    },
  ],
};

it('상자 작업 버튼과 창은 내부 용어 없이 하는 일로 부른다', async () => {
  mockCanRecall = true;
  render(<ShipmentActions shipment={mergedBox} />);

  expect(
    screen.getAllByRole('button').map((button) => button.textContent)
  ).toEqual(['분할', '수령인 변경', '계획 확정', '합포장', '출고 되돌리기']);

  await userEvent.click(screen.getByRole('button', { name: '수령인 변경' }));
  let dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('button', { name: '변경하기' })).toBeTruthy();
  expect(within(dialog).getByLabelText('수령인')).toBeTruthy();
  expect(within(dialog).getByLabelText('운영 메모 (선택)')).toBeTruthy();
  expect(dialog.textContent).not.toMatch(/CS case|UUID|서버에 요청/);

  await userEvent.click(within(dialog).getByRole('button', { name: '취소' }));
  await userEvent.click(screen.getByRole('button', { name: '계획 확정' }));
  dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('heading').textContent).toBe('계획 확정');
  expect(within(dialog).getByRole('button', { name: '확정하기' })).toBeTruthy();
  expect(within(dialog).getByLabelText('배송 프로필')).toBeTruthy();
});

it('출고 되돌리기는 송장 번호로 돌아온 출고를 고르고 실물 확인 뒤에만 보낸다', async () => {
  mockCanRecall = true;
  mockRecall.mockResolvedValue({ operationId: 'op-2', status: 'completed' });
  render(<ShipmentActions shipment={shippedBox} />);

  await userEvent.click(screen.getByRole('button', { name: '출고 되돌리기' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog.textContent).not.toMatch(/recall|attempt|custody|패키지/);
  const submit = within(dialog).getByRole('button', { name: '되돌리기' });
  expect(submit).toHaveProperty('disabled', true);

  await userEvent.click(
    within(dialog).getByRole('combobox', { name: '되돌릴 출고' })
  );
  const option = screen.getByRole('option');
  expect(option.textContent).toContain('1차 출고 · 송장 4567-8901-2345');
  expect(option.textContent).not.toContain('attempt-');
  await userEvent.click(option);
  await userEvent.click(
    within(dialog).getByRole('checkbox', {
      name: '고른 출고의 상자를 창고에서 실제로 돌려받았어요.',
    })
  );
  await userEvent.click(submit);

  expect(mockRecall).toHaveBeenCalledTimes(1);
  expect(mockRecall.mock.calls[0][0]).toMatchObject({
    shipmentId: 'shipment-1',
    data: {
      dispatchAttemptId: 'attempt-uuid-1',
      physicalRecoveryConfirmed: true,
    },
  });
  expect(mockRecall.mock.calls[0][0].data).not.toHaveProperty('csCaseId');
  expect(mockRecall.mock.calls[0][0].data).not.toHaveProperty('reasonCode');
});

// API 클라이언트는 응답이 없거나 시간이 지나면 500, 서버가 거절하면 그 상태로 던진다
const noResponse = { statusCode: 500, message: 'Network Error' };
const rejected = { statusCode: 409, message: '그사이 상자가 바뀌었어요.' };

async function submitSplit() {
  const dialog = await openSplit();
  await chooseCustomerReason(dialog);
  await userEvent.click(
    within(dialog).getByRole('button', { name: '분할하기' })
  );
}

it('처리 중인 작업은 한국어 상태로 보이고 끝나면 안내가 사라진다', async () => {
  mockSplit.mockResolvedValue({
    operationId: 'op-1',
    operationStatus: 'pending',
  });
  const { rerender } = render(<ShipmentActions shipment={mergedBox} />);
  await userEvent.click(screen.getByRole('button', { name: '분할' }));
  const dialog = screen.getByRole('dialog');
  await chooseCustomerReason(dialog);
  await userEvent.click(
    within(dialog).getByRole('button', { name: '분할하기' })
  );

  const alert = screen.getByRole('alert');
  expect(alert.textContent).toContain('상자 분할 · 접수됨');
  expect(alert.textContent).toContain('끝나면 이 안내가 사라져요.');
  expect(alert.textContent).not.toMatch(/operation|op-1|키/);

  mockOperationStatus = 'completed';
  rerender(<ShipmentActions shipment={mergedBox} />);

  expect(screen.queryByRole('alert')).toBeNull();
});

it('응답을 받지 못하면 접수됐다고 하지 않고 같은 요청 키로 다시 보낸다', async () => {
  mockSplit.mockRejectedValueOnce(noResponse);
  mockSplit.mockResolvedValueOnce({
    operationId: 'op-1',
    operationStatus: 'completed',
  });
  await submitSplit();

  const alert = screen.getByRole('alert');
  expect(alert.textContent).toContain('상자 분할 · 응답 대기');
  expect(alert.textContent).not.toContain('접수됨');

  await userEvent.click(
    within(alert).getByRole('button', { name: '다시 시도' })
  );

  expect(mockSplit).toHaveBeenCalledTimes(2);
  expect(mockSplit.mock.calls[1][0]).toEqual(mockSplit.mock.calls[0][0]);
  expect(mockSplit.mock.calls[1][0].idempotencyKey).toBe('key-1');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('서버가 거절하면 대기 안내 없이 창을 두어 입력을 고치게 한다', async () => {
  mockSplit.mockRejectedValueOnce(rejected);
  await submitSplit();

  expect(screen.queryByRole('alert', { hidden: true })).toBeNull();
  expect(screen.getByRole('dialog')).toBeTruthy();
});

it('다시 시도가 또 응답 없이 실패해도 안내와 요청 키를 유지한다', async () => {
  mockSplit.mockRejectedValue(noResponse);
  await submitSplit();

  await userEvent.click(
    within(screen.getByRole('alert')).getByRole('button', {
      name: '다시 시도',
    })
  );

  expect(mockSplit).toHaveBeenCalledTimes(2);
  expect(mockSplit.mock.calls[1][0].idempotencyKey).toBe('key-1');
  expect(screen.getByRole('alert').textContent).toContain(
    '상자 분할 · 응답 대기'
  );
});

it('다시 시도를 서버가 거절하면 고칠 수 있게 창을 다시 연다', async () => {
  mockSplit.mockRejectedValueOnce(noResponse);
  mockSplit.mockRejectedValueOnce(rejected);
  await submitSplit();

  expect(screen.queryByRole('dialog')).toBeNull();
  await userEvent.click(
    within(screen.getByRole('alert')).getByRole('button', {
      name: '다시 시도',
    })
  );

  const dialog = screen.getByRole('dialog');
  expect(
    within(dialog)
      .getByRole('radio', { name: '고객이 일부 먼저 보내 달라고 요청' })
      .getAttribute('aria-checked')
  ).toBe('true');
  expect(screen.queryByRole('alert', { hidden: true })).toBeNull();
});

it('출고한 상자에는 되돌리기만 보인다', () => {
  mockCanRecall = true;
  render(<ShipmentActions shipment={shippedBox} />);

  expect(
    screen.getAllByRole('button').map((button) => button.textContent)
  ).toEqual(['출고 되돌리기']);
});
