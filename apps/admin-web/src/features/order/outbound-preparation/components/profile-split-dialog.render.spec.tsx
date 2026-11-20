/** @jest-environment jsdom */
import { randomUUID } from 'node:crypto';
import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import { CustomError } from '@/lib/api/customError';
import type { PreparationProfileSplit } from '@/lib/types/dto/fulfillment';
import { rememberPending } from '@/features/order/fulfillments/detail/shipment-action-pending';
import { ProfileSplitDialog } from './profile-split-dialog';

const mutateAsync = jest.fn();
const invalidateQueries = jest.fn();
// 실제 QueryClient 처럼 렌더마다 같은 객체
const mockQueryClient = { invalidateQueries };
let fetching = 0;

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => mockQueryClient,
  useIsFetching: () => fetching,
}));
jest.mock('@/lib/services/orders', () => ({
  ...jest.requireActual('@/lib/services/orders/idempotency'),
  ...jest.requireActual('@/lib/api/server-error'),
  useSplitShipment: () => ({ mutateAsync, isPending: false }),
}));
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const BASIC = { id: 'p-basic', name: '기본 택배' };
const COLD = { id: 'p-cold', name: '냉장 택배' };

const line = (
  id: string,
  qty: number,
  profile: { id: string; name: string } | null
) => ({
  id,
  lineVersion: 3,
  qty,
  skuId: `sku-${id}`,
  skuName: `상품 ${id}`,
  skuCode: `SKU-${id}`,
  deliveryProfile: profile,
});

function split(
  overrides: Partial<PreparationProfileSplit> = {}
): PreparationProfileSplit {
  return {
    manifestVersion: 7,
    lines: [line('a', 1, BASIC), line('b', 2, COLD)],
    ...overrides,
  };
}

const onClose = jest.fn();

function dialog(current: PreparationProfileSplit | null = split()) {
  return (
    <ProfileSplitDialog
      shipmentId="box1"
      orderText="#A-1"
      split={current}
      onClose={onClose}
    />
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
  jest.clearAllMocks();
  mutateAsync.mockReset();
  fetching = 0;
  window.localStorage.clear();
});

it('목록이 준 줄로 남는 것과 보낼 것을 보이고, 고른 프로필 묶음을 프로필 사유로 나눈다', async () => {
  mutateAsync.mockResolvedValue({ operationId: 'op1' });
  render(dialog());

  // 열 때 목록을 다시 읽는다
  expect(invalidateQueries).toHaveBeenCalledWith({
    queryKey: ['outbound-preparation'],
  });
  expect(screen.getByText('상품 a 1개')).toBeTruthy();
  expect(screen.getByText('상품 b 2개')).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '나누기' }));
  });

  expect(mutateAsync).toHaveBeenCalledTimes(1);
  expect(mutateAsync.mock.calls[0][0]).toMatchObject({
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
  const { rerender } = render(dialog());
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '나누기' }));
  });

  expect(screen.getByRole('alert').textContent).toContain(
    '응답을 받지 못했어요'
  );
  expect(onClose).not.toHaveBeenCalled();

  // 그사이 목록이 다시 읽혀 이 상자가 바뀌어도 다시 보내는 내용은 처음 보낸 그대로다
  rerender(dialog(split({ manifestVersion: 8, lines: [line('a', 1, BASIC)] })));
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

it('서버가 거절하면 창을 두고 목록을 다시 읽으며, 다음 요청은 새 키로 보낸다', async () => {
  mutateAsync.mockRejectedValueOnce(
    new CustomError({
      message: 'stale',
      statusCode: 409,
      response: { code: 'SHIPMENT_LINE_STALE_VERSION', message: 'stale' },
    })
  );
  const { rerender } = render(dialog());
  invalidateQueries.mockClear();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '나누기' }));
  });

  expect(invalidateQueries).toHaveBeenCalledTimes(1);
  expect(invalidateQueries).toHaveBeenCalledWith({
    queryKey: ['outbound-preparation'],
  });
  expect(onClose).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('button', { name: '같은 요청 다시 보내기' })
  ).toBeNull();

  // 다시 읽는 동안에는 거절된 낡은 줄로 또 보낼 수 없다
  fetching = 1;
  rerender(dialog());
  const busy = screen.getByRole('button', { name: '확인하는 중…' });
  expect(busy.hasAttribute('disabled')).toBe(true);

  // 새 줄이 오면 그 버전으로, 새 키로 보낸다
  fetching = 0;
  rerender(dialog(split({ manifestVersion: 9 })));
  mutateAsync.mockResolvedValueOnce({ operationId: 'op2' });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '나누기' }));
  });
  expect(mutateAsync).toHaveBeenCalledTimes(2);
  expect(mutateAsync.mock.calls[1][0].data.expectedManifestVersion).toBe(9);
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
  render(dialog());

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

it('목록을 다시 읽는 동안에는 낡은 묶음으로 나누지 않는다', async () => {
  fetching = 1;
  const { rerender } = render(dialog());

  const busy = screen.getByRole('button', { name: '확인하는 중…' });
  expect(busy.hasAttribute('disabled')).toBe(true);
  await act(async () => {
    fireEvent.click(busy);
  });
  expect(mutateAsync).not.toHaveBeenCalled();

  fetching = 0;
  rerender(dialog());
  expect(
    screen.getByRole('button', { name: '나누기' }).hasAttribute('disabled')
  ).toBe(false);
});

it('목록을 다시 읽어 상자가 정보 부족에서 빠지면 나누기를 막는다', () => {
  render(dialog(null));

  expect(screen.getByText(/이 상자는 이제 정보 부족에 없어요/)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: '나누기' }).hasAttribute('disabled')
  ).toBe(true);
});
