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
const mockPlan = jest.fn();
let mockKeySeq = 0;

jest.mock('@/hooks/use-permission', () => ({
  usePermissionCheck: () => ({ can: () => false, canRun: () => true }),
}));

jest.mock('@/lib/services/inventory/queries', () => ({
  useDeliveryProfiles: () => ({
    data: [
      { id: 'p-basic', name: '기본 택배' },
      { id: 'p-cold', name: '냉장 택배' },
    ],
    isLoading: false,
    isError: false,
  }),
}));

jest.mock('@/lib/services/orders', () => {
  const idle = () => ({ mutateAsync: jest.fn(), isPending: false });
  return {
    canRecallShipment: () => false,
    createIdempotentCommand: (_command: unknown, originalKey?: string) => ({
      idempotencyKey: originalKey ?? `key-${++mockKeySeq}`,
    }),
    getServerDenyMessage: (_error: unknown, fallback: string) => fallback,
    parseServerError: jest.requireActual<
      typeof import('@/lib/api/server-error')
    >('@/lib/api/server-error').parseServerError,
    isRecoverableOperation: () => false,
    useCreateShipmentConsolidation: idle,
    useFulfillmentRequestOutcome: () => ({ refetch: jest.fn() }),
    useFulfillmentOperation: () => ({ data: undefined }),
    usePlanShipment: () => ({ mutateAsync: mockPlan, isPending: false }),
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

const BASIC = { id: 'p-basic', name: '기본 택배' };
const COLD = { id: 'p-cold', name: '냉장 택배' };

function line(
  id: string,
  qty: number,
  profile: ShipmentAdminLine['deliveryProfile']
): ShipmentAdminLine {
  return {
    id,
    fulfillmentOrderId: 'fo-1',
    fulfillmentOrderItemId: `item-${id}`,
    skuId: `sku-${id}`,
    skuName: `상품 ${id}`,
    skuCode: `CODE-${id}`,
    deliveryProfile: profile,
    qty,
    reservedQty: qty,
    inspectedQty: 0,
    lineVersion: 4,
    origin: null,
    reservations: [],
  };
}

function box(lines: ShipmentAdminLine[]): ShipmentAdminDetail {
  return {
    id: 'shipment-1',
    status: 'draft',
    warehouseId: 'wh-1',
    supplierId: null,
    shippingProfileId: 'p-basic',
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

beforeEach(() => {
  mockSplit.mockReset();
  mockPlan.mockReset();
  mockSplit.mockResolvedValue({ operationId: 'op-1', status: 'completed' });
  mockPlan.mockResolvedValue({ operationId: 'op-2', status: 'completed' });
});

describe('계획 확정 — 배송 프로필이 하나로 맞지 않는 상자', () => {
  const mixed = box([
    line('a', 1, COLD),
    line('b', 1, BASIC),
    line('c', 2, COLD),
  ]);

  it('확정 버튼 없이 상품별 프로필과 고칠 곳을 보인다', async () => {
    render(<ShipmentActions shipment={mixed} />);
    await userEvent.click(screen.getByRole('button', { name: '계획 확정' }));
    const dialog = screen.getByRole('dialog');

    expect(
      within(dialog).queryByRole('button', { name: '확정하기' })
    ).toBeNull();
    expect(within(dialog).queryByLabelText('배송 프로필')).toBeNull();
    const list = within(dialog).getByRole('list', {
      name: '상품별 배송 프로필',
    });
    expect(list.textContent).toContain('«냉장 택배»상품 a 1개, 상품 c 2개');
    expect(list.textContent).toContain('«기본 택배»상품 b 1개');
    expect(
      within(dialog).getByRole('link', { name: '상품 c' }).getAttribute('href')
    ).toBe('/inventory/skus?code=CODE-c');
  });

  it('«배송 프로필별로 나누기»는 다른 프로필의 상품 전부를 사유와 함께 새 상자로 보낸다', async () => {
    render(
      <ShipmentActions
        shipment={box([
          line('a', 1, BASIC),
          line('b', 1, COLD),
          line('c', 2, COLD),
        ])}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: '계획 확정' }));
    await userEvent.click(
      screen.getByRole('button', { name: '배송 프로필별로 나누기' })
    );
    const dialog = screen.getByRole('dialog');

    expect(
      within(dialog)
        .getByRole('button', { name: '배송 프로필별로' })
        .getAttribute('aria-pressed')
    ).toBe('true');
    expect(within(dialog).getByRole('status').textContent).toContain(
      '이번 상자에 남는 것상품 a 1개새 상자로 보낼 것상품 b 1개, 상품 c 2개'
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: '분할하기' })
    );

    expect(mockSplit).toHaveBeenCalledWith({
      shipmentId: 'shipment-1',
      idempotencyKey: expect.any(String),
      data: expect.objectContaining({
        expectedManifestVersion: 7,
        moves: [
          { shipmentLineId: 'b', expectedLineVersion: 4, qty: 1 },
          { shipmentLineId: 'c', expectedLineVersion: 4, qty: 2 },
        ],
        reasonCode: 'profile_mismatch',
        reason: '배송 프로필이 달라 나눔',
      }),
    });
  });

  it('«상품 하나만»으로 바꾸면 예전처럼 한 상품과 수량을 고른다', async () => {
    render(<ShipmentActions shipment={mixed} />);
    await userEvent.click(screen.getByRole('button', { name: '분할' }));
    const dialog = screen.getByRole('dialog');

    await userEvent.click(
      within(dialog).getByRole('button', { name: '상품 하나만' })
    );

    expect(within(dialog).getByLabelText('나눌 상품')).toBeTruthy();
    expect(
      within(dialog).queryByLabelText('새 상자로 보낼 배송 프로필')
    ).toBeNull();
  });

  it('프로필이 없는 상품만 문제면 나누기를 권하지 않고 SKU 에서 정하라고 한다', async () => {
    render(
      <ShipmentActions
        shipment={box([line('a', 1, BASIC), line('b', 1, null)])}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: '계획 확정' }));
    const dialog = screen.getByRole('dialog');

    expect(dialog.textContent).toContain(
      '배송 프로필이 없는 상품이 있어 확정할 수 없어요'
    );
    expect(dialog.textContent).toContain(
      '프로필이 없는 상품은 SKU 에서 배송 프로필을 정해 주세요'
    );
    expect(
      within(dialog).queryByRole('button', { name: '배송 프로필별로 나누기' })
    ).toBeNull();
    expect(
      within(dialog).queryByRole('button', { name: '확정하기' })
    ).toBeNull();
  });
});

describe('계획 확정 — 프로필이 하나로 맞는 상자', () => {
  it('상자에 남은 옛 프로필이 아니라 상품의 프로필을 미리 골라 보낸다', async () => {
    render(
      <ShipmentActions
        shipment={box([line('a', 1, COLD), line('b', 2, COLD)])}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: '계획 확정' }));
    await userEvent.click(screen.getByRole('button', { name: '확정하기' }));

    expect(mockPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ shippingProfileId: 'p-cold' }),
      })
    );
  });

  it('줄에 프로필이 없는 응답이면 예전처럼 고르게 둔다', async () => {
    const { deliveryProfile: _omit, ...legacy } = line('a', 1, COLD);
    render(<ShipmentActions shipment={box([legacy])} />);
    await userEvent.click(screen.getByRole('button', { name: '계획 확정' }));
    await userEvent.click(screen.getByRole('button', { name: '확정하기' }));

    expect(mockPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ shippingProfileId: 'p-basic' }),
      })
    );
  });
});

describe('창이 열린 동안 상자가 새로 고쳐지면', () => {
  it('계획 확정은 지금 상품의 프로필로 보낸다', async () => {
    // 상자에 남은 프로필(기본)과 같은 값으로 연 뒤, 상품 프로필이 냉장으로 바뀐다
    const { rerender } = render(
      <ShipmentActions shipment={box([line('a', 1, BASIC)])} />
    );
    await userEvent.click(screen.getByRole('button', { name: '계획 확정' }));
    expect(screen.getByRole('dialog').textContent).toContain('기본 택배');

    rerender(<ShipmentActions shipment={box([line('a', 1, COLD)])} />);
    expect(screen.getByRole('dialog').textContent).toContain('냉장 택배');
    await userEvent.click(screen.getByRole('button', { name: '확정하기' }));

    expect(mockPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ shippingProfileId: 'p-cold' }),
      })
    );
  });

  it('프로필이 하나로 맞춰지면 분할 창은 그 사실을 알리고 저절로 다른 나누기를 보내지 않는다', async () => {
    const { rerender } = render(
      <ShipmentActions
        shipment={box([line('a', 1, BASIC), line('b', 1, COLD)])}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: '분할' }));
    expect(screen.getByLabelText('새 상자로 보낼 배송 프로필')).toBeTruthy();

    rerender(
      <ShipmentActions
        shipment={box([line('a', 1, BASIC), line('b', 1, BASIC)])}
      />
    );
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).getByRole('status').textContent).toContain(
      '배송 프로필이 하나로 맞아요'
    );
    expect(within(dialog).queryByLabelText('나눌 상품')).toBeNull();
    expect(
      within(dialog)
        .getByRole('button', { name: '분할하기' })
        .hasAttribute('disabled')
    ).toBe(true);
    await userEvent.click(
      within(dialog).getByRole('button', { name: '분할하기' })
    );
    expect(mockSplit).not.toHaveBeenCalled();

    // 한 상품만 나누려면 직접 고른다
    await userEvent.click(
      within(dialog).getByRole('button', { name: '상품 하나만' })
    );
    expect(within(dialog).getByLabelText('나눌 상품')).toBeTruthy();
  });

  it('프로필별로 나누던 상자의 상품이 모두 프로필을 잃으면 SKU 에서 정하라고 한다', async () => {
    // 프로필 없는 상품을 보낼 묶음으로 고른 뒤, 남은 상품도 프로필을 잃는다
    const { rerender } = render(
      <ShipmentActions
        shipment={box([line('a', 1, BASIC), line('b', 1, null)])}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: '분할' }));
    expect(
      screen.getByLabelText('새 상자로 보낼 배송 프로필').textContent
    ).toContain('배송 프로필 없음');

    rerender(
      <ShipmentActions
        shipment={box([line('a', 1, null), line('b', 1, null)])}
      />
    );
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).getByRole('status').textContent).toContain(
      'SKU 에서 배송 프로필을 정해 주세요'
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: '분할하기' })
    );
    expect(mockSplit).not.toHaveBeenCalled();
  });
});
