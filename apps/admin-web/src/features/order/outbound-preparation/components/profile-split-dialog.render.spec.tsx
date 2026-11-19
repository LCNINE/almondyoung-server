/** @jest-environment jsdom */
import { randomUUID } from 'node:crypto';
import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CustomError } from '@/lib/api/customError';
import type { ShipmentAdminDetail } from '@/lib/types/dto/fulfillment';
import { toast } from 'sonner';
import { rememberPending } from '@/features/order/fulfillments/detail/shipment-action-pending';
import { ProfileSplitDialog } from './profile-split-dialog';

const mutateAsync = jest.fn();
const refetch = jest.fn();
let detail: {
  data?: ShipmentAdminDetail;
  isFetching: boolean;
  isError: boolean;
};

jest.mock('@/lib/services/orders', () => ({
  ...jest.requireActual('@/lib/services/orders/idempotency'),
  ...jest.requireActual('@/lib/api/server-error'),
  useShipmentDetail: () => ({ ...detail, refetch }),
  useSplitShipment: () => ({ mutateAsync, isPending: false }),
}));
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const line = (
  id: string,
  qty: number,
  profile: { id: string; name: string } | null
) => ({
  id,
  fulfillmentOrderId: 'fo1',
  fulfillmentOrderItemId: `foi-${id}`,
  skuId: `sku-${id}`,
  skuName: `상품 ${id}`,
  skuCode: `SKU-${id}`,
  deliveryProfile: profile,
  qty,
  reservedQty: qty,
  inspectedQty: 0,
  lineVersion: 3,
  origin: null,
  reservations: [],
});

const BASIC = { id: 'p-basic', name: '기본 택배' };
const COLD = { id: 'p-cold', name: '냉장 택배' };

function box(
  overrides: Partial<ShipmentAdminDetail> = {}
): ShipmentAdminDetail {
  return {
    id: 'box1',
    status: 'draft',
    warehouseId: 'w1',
    supplierId: null,
    manifestVersion: 7,
    reservationVersion: 1,
    recipientSnapshot: null,
    lines: [line('a', 1, BASIC), line('b', 2, COLD)],
    waybills: [],
    workItems: [],
    dispatchAttempts: [],
    operations: [],
    ...overrides,
  };
}

const onClose = jest.fn();

function open() {
  render(
    <ProfileSplitDialog shipmentId="box1" orderText="#A-1" onClose={onClose} />
  );
}

beforeAll(() => {
  if (typeof globalThis.crypto.randomUUID !== 'function') {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: randomUUID,
      configurable: true,
    });
  }
});

beforeEach(() => {
  mutateAsync.mockReset();
  refetch.mockReset();
  onClose.mockReset();
  window.localStorage.clear();
  detail = { data: box(), isFetching: false, isError: false };
});

it('상자를 새로 읽어 남는 것과 보낼 것을 보이고, 고른 프로필 묶음을 프로필 사유로 나눈다', async () => {
  mutateAsync.mockResolvedValue({ operationId: 'op1' });
  open();

  expect(screen.getByText('상품 a 1개')).toBeTruthy();
  expect(screen.getByText('상품 b 2개')).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '나누기' }));
  });

  expect(mutateAsync).toHaveBeenCalledTimes(1);
  const [request] = mutateAsync.mock.calls[0];
  expect(request).toMatchObject({
    shipmentId: 'box1',
    data: {
      expectedManifestVersion: 7,
      moves: [{ shipmentLineId: 'b', expectedLineVersion: 3, qty: 2 }],
      reasonCode: 'profile_mismatch',
    },
  });
  expect(onClose).toHaveBeenCalled();
  expect(toast.success).toHaveBeenCalledWith(
    '#A-1 상자를 배송 프로필별로 나눴어요.'
  );
});

it('응답을 못 받으면 창을 두고, 다시 보낼 때는 같은 요청 키와 같은 내용을 보낸다', async () => {
  mutateAsync.mockRejectedValueOnce(
    new CustomError({ message: 'Network Error', statusCode: 500 })
  );
  open();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '나누기' }));
  });

  expect(screen.getByRole('alert').textContent).toContain(
    '응답을 받지 못했어요'
  );
  expect(onClose).not.toHaveBeenCalled();

  // 그사이 상자가 다시 읽혀도 다시 보내는 내용은 처음 보낸 그대로다
  detail = {
    data: box({ manifestVersion: 8, lines: [line('a', 1, BASIC)] }),
    isFetching: false,
    isError: false,
  };
  mutateAsync.mockResolvedValueOnce({ operationId: 'op1' });
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: '같은 요청 다시 보내기' })
    );
  });

  expect(mutateAsync).toHaveBeenCalledTimes(2);
  expect(mutateAsync.mock.calls[1][0]).toEqual(mutateAsync.mock.calls[0][0]);
  expect(onClose).toHaveBeenCalled();
});

it('서버가 거절하면 창을 두고 상자를 다시 읽으며, 다음 요청은 새 키로 보낸다', async () => {
  mutateAsync.mockRejectedValueOnce(
    new CustomError({
      message: 'stale',
      statusCode: 409,
      response: { code: 'SHIPMENT_LINE_STALE_VERSION', message: 'stale' },
    })
  );
  open();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '나누기' }));
  });

  expect(refetch).toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('button', { name: '같은 요청 다시 보내기' })
  ).toBeNull();

  mutateAsync.mockResolvedValueOnce({ operationId: 'op2' });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '나누기' }));
  });
  expect(mutateAsync.mock.calls[1][0].idempotencyKey).not.toBe(
    mutateAsync.mock.calls[0][0].idempotencyKey
  );
});

it('앞서 닫은 창의 결과를 모르는 요청이 남은 상자는 새로 나누지 않고 상자 상세로 보낸다', async () => {
  rememberPending({
    shipmentId: 'box1',
    action: 'split',
    idempotencyKey: 'earlier-key',
    sentAt: Date.now(),
  });
  open();

  expect(
    screen.getByText(/결과를 모르는 요청이 남아 있어 여기서 나누지 않아요/)
  ).toBeTruthy();
  expect(
    screen.getByRole('link', { name: '상자 상세' }).getAttribute('href')
  ).toBe('/order/fulfillments?shipmentId=box1');
  const submit = screen.getByRole('button', { name: '나누기' });
  expect(submit.hasAttribute('disabled')).toBe(true);
  await act(async () => {
    fireEvent.click(submit);
  });
  expect(mutateAsync).not.toHaveBeenCalled();
});

it('다시 읽는 동안·계획 전이 아닌 상자는 나누기를 막는다', () => {
  detail = { data: box(), isFetching: true, isError: false };
  const { rerender } = render(
    <ProfileSplitDialog shipmentId="box1" orderText="#A-1" onClose={onClose} />
  );
  expect(screen.getByText('상자 정보를 불러오는 중이에요.')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: '나누기' }).hasAttribute('disabled')
  ).toBe(true);

  detail = {
    data: box({ status: 'planned' }),
    isFetching: false,
    isError: false,
  };
  rerender(
    <ProfileSplitDialog shipmentId="box1" orderText="#A-1" onClose={onClose} />
  );
  expect(screen.getByText(/지금은 여기서 나눌 수 없어요/)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: '나누기' }).hasAttribute('disabled')
  ).toBe(true);
});
