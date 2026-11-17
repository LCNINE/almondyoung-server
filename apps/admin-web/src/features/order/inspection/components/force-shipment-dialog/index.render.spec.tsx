/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForceShipmentDialog } from '.';

const mockForce = jest.fn();

jest.mock('@/lib/services/orders', () => ({
  createIdempotentCommand: (data: unknown) => ({
    data,
    idempotencyKey: 'key-1',
  }),
  getServerDenyMessage: () => '실패했어요.',
  parseServerError: () => ({ status: 500 }),
  useForceShipmentDispatch: () => ({
    mutateAsync: mockForce,
    isPending: false,
  }),
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

beforeEach(() => {
  mockForce.mockReset();
  mockForce.mockResolvedValue({ operationId: 'op-1' });
});

it('CS 건 번호 칸 없이 사유와 요청 경로를 보낸다', async () => {
  render(<ForceShipmentDialog shipmentId="shipment-1" onClose={jest.fn()} />);
  expect(screen.getByRole('dialog').textContent).not.toMatch(/CS case/);

  await userEvent.click(
    screen.getByRole('radio', { name: '고객이 급하게 보내 달라고 요청' })
  );
  await userEvent.click(screen.getByRole('radio', { name: '전화' }));
  await userEvent.click(screen.getByRole('button', { name: '강제 출고' }));

  expect(mockForce).toHaveBeenCalledTimes(1);
  const { data } = mockForce.mock.calls[0][0];
  expect(data).toEqual({
    reason: '고객이 급하게 보내 달라고 요청',
    reasonCode: 'customer_urgent',
    requestChannel: 'phone',
  });
});

it('제목과 안내에 영문 단어가 없다', () => {
  render(<ForceShipmentDialog shipmentId="abcdef123456" onClose={jest.fn()} />);

  const text = screen.getByRole('dialog').textContent ?? '';
  expect(text).toContain('상자 abcdef12');
  expect(text.replace(/abcdef12|Close/g, '')).not.toMatch(/[A-Za-z]{3,}/);
});

it('사유를 고르지 않으면 보내지 않고 안내한다', async () => {
  render(<ForceShipmentDialog shipmentId="shipment-1" onClose={jest.fn()} />);

  await userEvent.click(screen.getByRole('button', { name: '강제 출고' }));

  expect(mockForce).not.toHaveBeenCalled();
  expect(screen.getByText('작업 사유를 골라 주세요.')).toBeTruthy();
});
