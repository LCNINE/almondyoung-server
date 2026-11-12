/**
 * @jest-environment jsdom
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ShipmentAdminDetail } from '@/lib/types/dto/fulfillment';
import { WaybillActions } from './waybill-actions';

const mockIssue = jest.fn();

jest.mock('@/hooks/use-permission', () => ({
  usePermissionCheck: () => ({ canRun: () => true }),
}));

jest.mock('@/lib/services/orders', () => {
  const idle = () => ({ mutateAsync: jest.fn(), isPending: false });
  return {
    createIdempotentCommand: () => ({ idempotencyKey: 'key-1' }),
    isWaybillIssued: (status: string) =>
      status === 'registered' || status === 'used',
    isWaybillPendingIssue: (status: string) =>
      status === 'pending' || status === 'allocated',
    isCarrierSupported: (carrier: string) => carrier === 'HANJIN',
    WAYBILL_CARRIERS: ['CJ', 'HANJIN'],
    useIssueWaybill: () => ({ mutateAsync: mockIssue, isPending: false }),
    useRegisterManualWaybill: idle,
    useReissueWaybill: idle,
    useVoidWaybill: idle,
  };
});

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

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

it('택배사를 이름으로 고르고 발급 버튼은 하는 일로 부른다', async () => {
  render(<WaybillActions shipment={shipment} />);
  await userEvent.click(screen.getByRole('button', { name: '운송장 발급' }));
  const dialog = screen.getByRole('dialog');

  expect(within(dialog).getByRole('combobox').textContent).toBe('한진택배');
  expect(within(dialog).getByRole('button', { name: '발급하기' })).toBeTruthy();
  expect(dialog.textContent).not.toMatch(/HANJIN|서버에 요청/);
});

it('발급이 끝나지 않으면 한국어로 안내하고 같은 요청으로 다시 시도한다', async () => {
  mockIssue.mockResolvedValue({ status: 'allocated' });
  render(<WaybillActions shipment={shipment} />);
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
