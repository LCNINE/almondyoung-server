/** @jest-environment jsdom */
import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import type {
  ShipmentWaybillHistory,
  WaybillResponse,
} from '@/lib/types/dto/fulfillment';
import { StuckWaybillPanel } from './stuck-waybill-panel';

const mockAbandon = jest.fn();
const mockIssue = jest.fn<
  Promise<Pick<WaybillResponse, 'status' | 'trackingNo'>>,
  [unknown]
>();
let mockKey = 0;
let mockAllowed = true;

jest.mock('@/lib/services/orders', () => ({
  ...jest.requireActual('@/lib/services/orders/waybill-policy'),
  createIdempotentCommand: (data: unknown) => ({
    data,
    idempotencyKey: `key-${++mockKey}`,
  }),
  useAbandonWaybill: Object.assign(
    () => ({ mutateAsync: mockAbandon, isPending: false }),
    { permission: ['fulfillment.warehouse.operate'] }
  ),
  useIssueWaybill: Object.assign(
    () => ({ mutateAsync: mockIssue, isPending: false }),
    { permission: ['fulfillment.warehouse.operate'] }
  ),
}));

jest.mock('@/hooks/use-permission', () => ({
  usePermissionCheck: () => ({ canRun: () => mockAllowed }),
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const waybill = (
  over: Partial<ShipmentWaybillHistory>
): ShipmentWaybillHistory => ({
  id: 'wb-1',
  status: 'allocated',
  trackingNo: '510012345678',
  carrier: 'HANJIN',
  manifestVersion: 3,
  issuedAt: null,
  voidedAt: null,
  lastError: 'register unknown_outcome',
  nextAttemptAt: null,
  ...over,
});

const shipment = (waybills: ShipmentWaybillHistory[], manifestVersion = 3) => ({
  id: 'ship-1',
  manifestVersion,
  waybills,
});

beforeEach(() => {
  mockAbandon.mockReset();
  jest.mocked(toast.success).mockClear();
  mockIssue.mockReset();
  mockKey = 0;
  mockAllowed = true;
});

it('멈춘 송장이 없으면 아무것도 그리지 않는다', () => {
  const { container } = render(
    <StuckWaybillPanel
      shipment={shipment([waybill({ status: 'registered' })])}
    />
  );
  expect(container.textContent).toBe('');
});

it('권한이 없으면 경고만 보이고 중단 버튼은 없다', () => {
  mockAllowed = false;
  render(<StuckWaybillPanel shipment={shipment([waybill({})])} />);
  expect(screen.getByText('송장 발급이 멈춰 있어요')).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: '중단하고 다시 발급' })
  ).toBeNull();
});

it('위험을 읽고 사유를 적어 중단한 뒤 같은 대화상자에서 새로 발급한다', async () => {
  const user = userEvent.setup();
  mockAbandon.mockResolvedValue({});
  mockIssue.mockResolvedValue({
    status: 'registered',
    trackingNo: '510099999999',
  });
  const { rerender } = render(
    <StuckWaybillPanel shipment={shipment([waybill({})], 4)} />
  );

  expect(
    screen.getByText(
      '상자 내용이 발급을 시작할 때와 달라 이어서 발급할 수 없어요.'
    )
  ).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '중단하고 다시 발급' }));

  expect(
    screen.getByText(/한진 송장번호 510012345678는 받았지만/)
  ).toBeTruthy();
  expect(screen.getByText('register unknown_outcome')).toBeTruthy();

  await user.click(screen.getByRole('button', { name: '발급 중단' }));
  expect(screen.getByRole('alert').textContent).toBe(
    '중단 사유를 적어 주세요.'
  );
  expect(mockAbandon).not.toHaveBeenCalled();

  await user.type(screen.getByLabelText('중단 사유'), '한진 응답 없음');
  // 적기 시작하면 «사유를 적어 주세요»는 사라진다.
  expect(screen.queryByRole('alert')).toBeNull();
  await user.click(screen.getByRole('button', { name: '발급 중단' }));
  expect(mockAbandon).toHaveBeenCalledWith({
    waybillId: 'wb-1',
    shipmentId: 'ship-1',
    data: { reason: '한진 응답 없음' },
    idempotencyKey: 'key-1',
  });

  // 중단 뒤 상세를 다시 읽으면 멈춘 행이 abandoned 가 된다 — 대화상자는 남아야 한다.
  rerender(
    <StuckWaybillPanel
      shipment={shipment([waybill({ status: 'abandoned' })], 4)}
    />
  );
  expect(
    await screen.findByText(
      '발급을 중단했어요. 이 상자의 새 송장을 발급할까요?'
    )
  ).toBeTruthy();
  expect(screen.queryByText('송장 발급이 멈춰 있어요')).toBeNull();

  await user.click(screen.getByRole('button', { name: '새로 발급' }));
  expect(mockIssue).toHaveBeenCalledWith({
    shipmentId: 'ship-1',
    data: { carrier: 'HANJIN', expectedManifestVersion: 4 },
    idempotencyKey: 'key-2',
  });
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      '새 송장을 발급했어요 (510099999999).'
    )
  );
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('그 사이 발급이 끝나 서버가 거절하면 한국어로 알린다', async () => {
  const user = userEvent.setup();
  mockAbandon.mockRejectedValue({
    response: {
      status: 409,
      data: {
        code: 'CONFLICT',
        message: 'WAYBILL_ABANDON_NOT_ALLOWED: wb-1 is registered',
      },
    },
  });
  render(
    <StuckWaybillPanel
      shipment={shipment([waybill({ status: 'pending', trackingNo: null })])}
    />
  );
  await user.click(screen.getByRole('button', { name: '중단하고 다시 발급' }));
  expect(
    screen.getByText(/한진에서 송장번호를 받았는지 확인되지 않았어요/)
  ).toBeTruthy();
  await user.type(screen.getByLabelText('중단 사유'), '멈춤');
  await user.click(screen.getByRole('button', { name: '발급 중단' }));
  expect((await screen.findByRole('alert')).textContent).toBe(
    '그 사이 발급이 끝났어요. 중단할 필요가 없어요.'
  );
  expect(screen.queryByRole('button', { name: '새로 발급' })).toBeNull();
});

it('새 발급이 또 끝나지 않으면 성공으로 보이지 않고 같은 키로 다시 누르게 한다', async () => {
  const user = userEvent.setup();
  mockAbandon.mockResolvedValue({});
  mockIssue.mockResolvedValue({ status: 'pending', trackingNo: null });
  render(<StuckWaybillPanel shipment={shipment([waybill({})])} />);
  await user.click(screen.getByRole('button', { name: '중단하고 다시 발급' }));
  await user.type(screen.getByLabelText('중단 사유'), '멈춤');
  await user.click(screen.getByRole('button', { name: '발급 중단' }));
  await user.click(await screen.findByRole('button', { name: '새로 발급' }));
  expect(
    await screen.findByText(
      '발급이 아직 끝나지 않았어요. 잠시 뒤 다시 눌러 주세요.'
    )
  ).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '새로 발급' }));
  expect(
    mockIssue.mock.calls.map(
      ([v]) => (v as { idempotencyKey: string }).idempotencyKey
    )
  ).toEqual(['key-2', 'key-2']);
  expect(toast.success).not.toHaveBeenCalled();
});
