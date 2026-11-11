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
    canRecallShipment: () => false,
    createIdempotentCommand: () => ({ idempotencyKey: 'key-1' }),
    getServerDenyMessage: (_error: unknown, fallback: string) => fallback,
    isRecoverableOperation: () => false,
    useCreateShipmentConsolidation: idle,
    useFulfillmentOperation: () => ({ data: undefined }),
    usePlanShipment: idle,
    useRecallShipment: idle,
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
