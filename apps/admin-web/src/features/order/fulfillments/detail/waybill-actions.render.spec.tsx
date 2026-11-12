/**
 * @jest-environment jsdom
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ShipmentAdminDetail } from '@/lib/types/dto/fulfillment';
import { WaybillActions } from './waybill-actions';

const mockIssue = jest.fn();
const mockReissue = jest.fn();

jest.mock('@/hooks/use-permission', () => ({
  usePermissionCheck: () => ({ canRun: () => true }),
}));

jest.mock('@/lib/services/orders', () => {
  const idle = () => ({ mutateAsync: jest.fn(), isPending: false });
  return {
    createIdempotentCommand: (_data: unknown, original?: string) => ({
      idempotencyKey: original ?? 'key-1',
    }),
    isWaybillIssued: (status: string) =>
      status === 'registered' || status === 'used',
    isWaybillPendingIssue: (status: string) =>
      status === 'pending' || status === 'allocated',
    isCarrierSupported: (carrier: string) => carrier === 'HANJIN',
    WAYBILL_CARRIERS: ['CJ', 'HANJIN'],
    useIssueWaybill: () => ({ mutateAsync: mockIssue, isPending: false }),
    useRegisterManualWaybill: idle,
    useReissueWaybill: () => ({ mutateAsync: mockReissue, isPending: false }),
    useVoidWaybill: idle,
  };
});

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

beforeEach(() => jest.clearAllMocks());

Element.prototype.hasPointerCapture = () => false;
Element.prototype.scrollIntoView = () => {};

const shipment = {
  id: 'ship-1',
  status: 'planned',
  supplierId: null,
  manifestVersion: 1,
  waybills: [
    {
      id: 'wb-uuid-1',
      status: 'registered',
      trackingNo: '4567-8901-2345',
      carrier: 'HANJIN',
      manifestVersion: 1,
      issuedAt: null,
      voidedAt: null,
    },
  ],
} as unknown as ShipmentAdminDetail;

const withoutWaybill = { ...shipment, waybills: [] } as ShipmentAdminDetail;

it('택배사를 이름으로 고르고 발급 버튼은 하는 일로 부른다', async () => {
  render(<WaybillActions shipment={withoutWaybill} />);
  await userEvent.click(screen.getByRole('button', { name: '운송장 발급' }));
  const dialog = screen.getByRole('dialog');

  expect(within(dialog).getByRole('combobox').textContent).toBe('한진택배');
  expect(within(dialog).getByRole('button', { name: '발급하기' })).toBeTruthy();
  expect(dialog.textContent).not.toMatch(/HANJIN|서버에 요청/);
});

it('발급이 끝나지 않으면 한국어로 안내하고 같은 요청으로 다시 시도한다', async () => {
  mockIssue.mockResolvedValue({ status: 'allocated' });
  render(<WaybillActions shipment={withoutWaybill} />);
  await userEvent.click(screen.getByRole('button', { name: '운송장 발급' }));
  await userEvent.click(screen.getByRole('button', { name: '발급하기' }));

  const notice = screen.getByRole('alert');
  expect(notice.textContent).toContain('아직 발급이 끝나지 않았어요');
  expect(notice.textContent).not.toMatch(/allocated|동일 키|종결/);
  expect(
    within(notice).getByRole('button', { name: '다시 시도' })
  ).toBeTruthy();
});

it('무효화 대상은 송장 번호로 보인다', async () => {
  render(<WaybillActions shipment={shipment} />);
  await userEvent.click(screen.getByRole('button', { name: '무효화' }));

  expect(screen.getByRole('dialog').textContent).toContain(
    '무효로 할 송장: 한진택배 4567-8901-2345'
  );
});

it('재발급 전에 바꿀 송장 번호와 붙인 송장을 바꿔 붙여야 한다는 것을 알린다', async () => {
  render(<WaybillActions shipment={shipment} />);
  await userEvent.click(screen.getByRole('button', { name: '재발급' }));

  const dialog = screen.getByRole('dialog');
  expect(dialog.textContent).toContain('바꿀 송장: 한진택배 4567-8901-2345');
  expect(dialog.textContent).toContain('이 번호는 먼저 무효가 돼요');
  expect(dialog.textContent).toContain('새 송장 번호를 확인한 뒤');
  expect(dialog.textContent).not.toContain('새 번호를 받아요');
});

it('배치에 든 상자를 재발급하면 물류앱에서 새 송장을 다시 출력하라고 알린다', async () => {
  render(
    <WaybillActions
      shipment={{
        ...shipment,
        workItems: [{ id: 'wi-1', status: 'packing', batchId: 'b-1' }],
      }}
    />
  );
  await userEvent.click(screen.getByRole('button', { name: '재발급' }));

  expect(screen.getByRole('dialog').textContent).toContain(
    '물류앱에서 «송장 재출력»'
  );
});

it('재발급이 끝나면 기존 송장을 바꿔 붙이라고 알린다', async () => {
  const { toast } = jest.requireMock<{ toast: { success: jest.Mock } }>(
    'sonner'
  );
  mockReissue.mockResolvedValue({ status: 'registered' });
  render(<WaybillActions shipment={shipment} />);
  await userEvent.click(screen.getByRole('button', { name: '재발급' }));
  await userEvent.click(screen.getByRole('button', { name: '재발급하기' }));

  expect(toast.success).toHaveBeenCalledWith(
    '새 송장을 받았어요. 붙어 있는 송장은 떼고 새 송장으로 바꿔 붙여 주세요.'
  );
});

it('재발급에서 새 송장을 받지 못하면 창을 닫고 기존 송장은 이미 무효라고 알린다', async () => {
  const { toast } = jest.requireMock<{ toast: { error: jest.Mock } }>('sonner');
  mockReissue.mockResolvedValue({ status: 'failed' });
  render(<WaybillActions shipment={shipment} />);
  await userEvent.click(screen.getByRole('button', { name: '재발급' }));
  await userEvent.click(screen.getByRole('button', { name: '재발급하기' }));

  expect(toast.error).toHaveBeenCalledWith(
    '기존 송장은 무효가 됐고 새 송장은 받지 못했어요. «운송장 발급»으로 새 송장을 받아 주세요.'
  );
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('재발급이 발급 대기로 끝나면 다시 시도는 같은 재발급의 발급 단계로 보낸다', async () => {
  mockReissue.mockResolvedValue({ status: 'allocated' });
  mockIssue.mockResolvedValue({ status: 'registered' });
  render(<WaybillActions shipment={shipment} />);
  await userEvent.click(screen.getByRole('button', { name: '재발급' }));
  await userEvent.click(screen.getByRole('button', { name: '재발급하기' }));
  await userEvent.click(
    within(screen.getByRole('alert')).getByRole('button', { name: '다시 시도' })
  );

  expect(mockReissue).toHaveBeenCalledTimes(1);
  expect(mockIssue).toHaveBeenCalledWith(
    expect.objectContaining({ idempotencyKey: 'key-1:issue' })
  );
});
