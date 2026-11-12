/**
 * @jest-environment jsdom
 */
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  ShipmentAdminDetail,
  ShipmentAdminLine,
} from '@/lib/types/dto/fulfillment';
import { toast } from 'sonner';
import { ShipmentActions } from './shipment-actions';
import { pendingRequests, rememberPending } from './shipment-action-pending';

const mockSplit = jest.fn();
const mockRecall = jest.fn();
let mockCanRecall = false;
let mockOperationStatus: string | undefined;
let mockKeySeq = 0;
const mockRefetchOutcome = jest.fn();
let mockOutcome: { data?: unknown; isError?: boolean } = {};

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
    useFulfillmentRequestOutcome: () => ({
      ...mockOutcome,
      refetch: mockRefetchOutcome,
    }),
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

async function openSplit(detail = mergedBox) {
  render(<ShipmentActions shipment={detail} />);
  await userEvent.click(screen.getByRole('button', { name: '분할' }));
  return screen.getByRole('dialog');
}

beforeEach(() => {
  window.localStorage.clear();
  mockOutcome = {};
  mockRefetchOutcome.mockReset();
  jest.mocked(toast.error).mockReset();
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

  await userEvent.type(
    within(dialog).getByLabelText('작업 사유 (필수)'),
    '먼저 보내기'
  );
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
});

// API 클라이언트는 응답이 없거나 시간이 지나면 500, 서버가 거절하면 그 상태로 던진다
const noResponse = { statusCode: 500, message: 'Network Error' };
const rejected = { statusCode: 409, message: '그사이 상자가 바뀌었어요.' };

async function submitSplit() {
  const dialog = await openSplit();
  await userEvent.type(
    within(dialog).getByLabelText('작업 사유 (필수)'),
    '먼저 보내기'
  );
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
  await userEvent.type(
    within(dialog).getByLabelText('작업 사유 (필수)'),
    '먼저 보내기'
  );
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
  // 바로 아래 안내의 «다시 시도»를 가리킨다 — 새로고침하라고 하면 같은 요청으로 다시 보낼 길을 잃는다
  expect(toast.error).toHaveBeenCalledWith(
    '응답을 받지 못했어요. 아래 «다시 시도»로 같은 요청을 다시 보낼 수 있어요.'
  );

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
    (within(dialog).getByLabelText('작업 사유 (필수)') as HTMLInputElement)
      .value
  ).toBe('먼저 보내기');
  expect(screen.queryByRole('alert', { hidden: true })).toBeNull();
});

function reasonIn(dialog: HTMLElement) {
  return within(dialog).getByLabelText('작업 사유 (필수)') as HTMLInputElement;
}

function noteIn(dialog: HTMLElement) {
  return within(dialog).getByLabelText(
    '운영 메모 (선택)'
  ) as HTMLTextAreaElement;
}

it('다른 작업을 열면 앞 작업의 사유와 메모를 비운다', async () => {
  render(<ShipmentActions shipment={mergedBox} />);
  await userEvent.click(screen.getByRole('button', { name: '수령인 변경' }));
  let dialog = screen.getByRole('dialog');
  await userEvent.type(reasonIn(dialog), '배송지 변경 요청');
  await userEvent.type(noteIn(dialog), '전화로 접수');
  await userEvent.click(within(dialog).getByRole('button', { name: '취소' }));

  await userEvent.click(screen.getByRole('button', { name: '분할' }));
  dialog = screen.getByRole('dialog');

  expect(reasonIn(dialog).value).toBe('');
  expect(noteIn(dialog).value).toBe('');
});

it('작업을 마친 뒤 같은 작업을 다시 열어도 새로 입력하게 한다', async () => {
  await submitSplit();
  expect(screen.queryByRole('dialog')).toBeNull();

  await userEvent.click(screen.getByRole('button', { name: '분할' }));
  const dialog = screen.getByRole('dialog');

  expect(reasonIn(dialog).value).toBe('');
  expect(
    (within(dialog).getByLabelText('새 상자로 보낼 수량') as HTMLInputElement)
      .value
  ).toBe('1');
});

it('되돌리기 실물 확인은 창을 열 때마다 다시 체크하게 한다', async () => {
  mockCanRecall = true;
  render(<ShipmentActions shipment={shippedBox} />);
  await userEvent.click(screen.getByRole('button', { name: '출고 되돌리기' }));
  let dialog = screen.getByRole('dialog');
  const confirm = {
    name: '고른 출고의 상자를 창고에서 실제로 돌려받았어요.',
  };
  await userEvent.click(within(dialog).getByRole('checkbox', confirm));
  await userEvent.click(within(dialog).getByRole('button', { name: '취소' }));

  await userEvent.click(screen.getByRole('button', { name: '출고 되돌리기' }));
  dialog = screen.getByRole('dialog');

  expect(
    within(dialog).getByRole('checkbox', confirm).getAttribute('aria-checked')
  ).toBe('false');
});

it('응답을 기다리는 사이 다른 작업 창을 열어도 거절된 요청은 보낸 입력으로 다시 연다', async () => {
  mockSplit.mockRejectedValueOnce(noResponse);
  mockSplit.mockRejectedValueOnce(rejected);
  await submitSplit();

  await userEvent.click(screen.getByRole('button', { name: '수령인 변경' }));
  const other = screen.getByRole('dialog');
  expect(reasonIn(other).value).toBe('');
  await userEvent.type(reasonIn(other), '다른 작업');
  await userEvent.click(within(other).getByRole('button', { name: '취소' }));

  await userEvent.click(
    within(screen.getByRole('alert')).getByRole('button', {
      name: '다시 시도',
    })
  );

  expect(mockSplit.mock.calls[1][0].idempotencyKey).toBe('key-1');
  expect(mockSplit.mock.calls[1][0].data.reason).toBe('먼저 보내기');
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('heading').textContent).toBe('상자 분할');
  expect(reasonIn(dialog).value).toBe('먼저 보내기');
});

const otherBox: ShipmentAdminDetail = {
  ...shipment([line('line-x', 2, { skuName: '다른 상품' })]),
  id: 'shipment-2',
};

it('다른 상자를 보는 동안에는 앞 상자의 재시도 안내를 보이지 않는다', async () => {
  mockSplit.mockRejectedValueOnce(noResponse);
  const { rerender } = render(<ShipmentActions shipment={mergedBox} />);
  await userEvent.click(screen.getByRole('button', { name: '분할' }));
  await userEvent.type(reasonIn(screen.getByRole('dialog')), '먼저 보내기');
  await userEvent.click(screen.getByRole('button', { name: '분할하기' }));
  expect(screen.getByRole('alert')).toBeTruthy();

  rerender(<ShipmentActions shipment={otherBox} />);
  expect(screen.queryByRole('alert')).toBeNull();

  rerender(<ShipmentActions shipment={mergedBox} />);
  expect(screen.getByRole('alert').textContent).toContain('응답 대기');
});

it('거절 응답이 다른 상자로 넘어간 뒤 오면 그 상자에 앞 상자의 입력으로 창을 열지 않는다', async () => {
  let reject: (error: unknown) => void = () => {};
  mockSplit.mockReturnValueOnce(
    new Promise((_resolve, fail) => {
      reject = fail;
    })
  );
  const { rerender } = render(<ShipmentActions shipment={mergedBox} />);
  await userEvent.click(screen.getByRole('button', { name: '분할' }));
  await userEvent.type(reasonIn(screen.getByRole('dialog')), '먼저 보내기');
  await userEvent.click(screen.getByRole('button', { name: '분할하기' }));

  rerender(<ShipmentActions shipment={otherBox} />);
  await act(async () => reject(rejected));

  expect(screen.queryByRole('dialog')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: '수령인 변경' }));
  expect(reasonIn(screen.getByRole('dialog')).value).toBe('');
});

describe('응답을 받지 못한 요청의 기록', () => {
  it('보내기 전에 요청 키를 남기고, 서버가 답하면 지운다', async () => {
    let atSend: unknown[] = [];
    mockSplit.mockImplementationOnce(async () => {
      atSend = pendingRequests();
      return { operationId: 'op-1', operationStatus: 'completed' };
    });
    await submitSplit();

    expect(atSend).toEqual([
      {
        shipmentId: 'shipment-1',
        action: 'split',
        idempotencyKey: 'key-1',
        sentAt: expect.any(Number),
      },
    ]);
    expect(pendingRequests()).toEqual([]);
  });

  it('응답을 받지 못하면 남기고, 서버가 거절하면 지운다', async () => {
    mockSplit.mockRejectedValueOnce(noResponse);
    await submitSplit();
    expect(pendingRequests().map((entry) => entry.idempotencyKey)).toEqual([
      'key-1',
    ]);

    mockSplit.mockRejectedValueOnce(rejected);
    await userEvent.click(
      within(screen.getByRole('alert')).getByRole('button', {
        name: '다시 시도',
      })
    );
    expect(pendingRequests()).toEqual([]);
  });

  it('지금 화면의 «다시 시도» 안내와 같은 요청이면 결과 안내를 따로 띄우지 않는다', async () => {
    mockSplit.mockRejectedValueOnce(noResponse);
    await submitSplit();

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});

describe('새로고침 뒤 남은 요청의 결과', () => {
  const remember = (shipmentId = 'shipment-1', ago = 60_000) =>
    rememberPending({
      shipmentId,
      action: 'split',
      idempotencyKey: 'old-key',
      sentAt: Date.now() - ago,
    });

  it('처리됐으면 알리고, 확인을 누르면 기록을 지운다', async () => {
    remember();
    mockOutcome = {
      data: {
        processed: true,
        operationId: 'op-9',
        status: 'completed',
        completedAt: new Date().toISOString(),
      },
    };
    render(<ShipmentActions shipment={mergedBox} />);

    const notice = screen.getByRole('status');
    expect(notice.textContent).toContain(
      '앞서 보낸 상자 분할 요청은 처리됐어요'
    );
    await userEvent.click(within(notice).getByRole('button', { name: '확인' }));

    expect(pendingRequests()).toEqual([]);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('처리되지 않았으면 다시 하기로 빈 입력 창을 연다', async () => {
    remember();
    mockOutcome = {
      data: {
        processed: false,
        operationId: null,
        status: null,
        completedAt: null,
      },
    };
    render(<ShipmentActions shipment={mergedBox} />);

    const notice = screen.getByRole('status');
    expect(notice.textContent).toContain(
      '앞서 보낸 상자 분할 요청은 처리되지 않았어요. 필요하면 다시 해 주세요.'
    );
    await userEvent.click(
      within(notice).getByRole('button', { name: '다시 하기' })
    );

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading').textContent).toBe('상자 분할');
    expect(reasonIn(dialog).value).toBe('');
    expect(pendingRequests()).toEqual([]);
  });

  it('보낸 지 얼마 안 됐으면 처리 안 됨으로 단정하지 않는다', () => {
    remember('shipment-1', 3_000);
    mockOutcome = {
      data: {
        processed: false,
        operationId: null,
        status: null,
        completedAt: null,
      },
    };
    render(<ShipmentActions shipment={mergedBox} />);

    const notice = screen.getByRole('status');
    expect(notice.textContent).toContain('결과를 확인하고 있어요');
    expect(
      within(notice).queryByRole('button', { name: '다시 하기' })
    ).toBeNull();
  });

  it('결과를 확인하지 못하면 다시 확인할 수 있다', async () => {
    remember();
    mockOutcome = { isError: true };
    render(<ShipmentActions shipment={mergedBox} />);

    const notice = screen.getByRole('status');
    expect(notice.textContent).toContain(
      '앞서 보낸 상자 분할 요청의 결과를 확인하지 못했어요.'
    );
    await userEvent.click(
      within(notice).getByRole('button', { name: '다시 확인' })
    );
    expect(mockRefetchOutcome).toHaveBeenCalled();
  });

  it('앞서 받은 답이 «확인 중»인데 다시 묻다 실패하면 다시 확인할 수 있다', async () => {
    remember('shipment-1', 3_000);
    mockOutcome = {
      data: {
        processed: false,
        operationId: null,
        status: null,
        completedAt: null,
      },
      isError: true,
    };
    render(<ShipmentActions shipment={mergedBox} />);

    const notice = screen.getByRole('status');
    expect(notice.textContent).toContain('결과를 확인하지 못했어요');
    await userEvent.click(
      within(notice).getByRole('button', { name: '다시 확인' })
    );
    expect(mockRefetchOutcome).toHaveBeenCalled();
  });

  it('다른 상자의 남은 요청은 이 상자에 보이지 않는다', () => {
    remember('shipment-other');
    mockOutcome = {
      data: {
        processed: true,
        operationId: 'op-9',
        status: 'completed',
        completedAt: null,
      },
    };
    render(<ShipmentActions shipment={mergedBox} />);

    expect(screen.queryByRole('status')).toBeNull();
  });
});

it('서버가 거절한 이유를 관리자 문장으로 알린다', async () => {
  mockSplit.mockRejectedValueOnce({
    statusCode: 409,
    message: 'Shipment shipment-1 must be Draft to split',
    response: {
      code: 'SHIPMENT_NOT_DRAFT',
      message: 'Shipment shipment-1 must be Draft to split',
    },
  });
  await submitSplit();

  expect(toast.error).toHaveBeenCalledWith(
    '계획 전 상자만 나눌 수 있어요. 새로고침해 상자 상태를 확인해 주세요.'
  );
});

it('출고한 상자에는 되돌리기만 보인다', () => {
  mockCanRecall = true;
  render(<ShipmentActions shipment={shippedBox} />);

  expect(
    screen.getAllByRole('button').map((button) => button.textContent)
  ).toEqual(['출고 되돌리기']);
});
