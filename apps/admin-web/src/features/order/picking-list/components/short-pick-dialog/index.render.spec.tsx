/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  OutboundBatchV2,
  ShipmentAdminDetail,
} from '@/lib/types/dto/fulfillment';
import { ShortPickDialog } from '.';

const mockReport = jest.fn();

jest.mock('@/lib/services/orders', () => ({
  createIdempotentCommand: (data: unknown) => ({
    data,
    idempotencyKey: 'key-1',
  }),
  getServerDenyMessage: () => '실패했어요.',
  isRecoverableOperation: () => false,
  isShortPickSettled: () => true,
  shortPickOutcomeMessage: () => null,
  shortPickRejectionMessage: () => null,
  useFulfillmentOperation: () => ({ data: undefined }),
  useReportShipmentShortPick: () => ({
    mutateAsync: mockReport,
    isPending: false,
  }),
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

Element.prototype.hasPointerCapture = () => false;
Element.prototype.scrollIntoView = () => {};

const batch = {
  workItems: [{ id: 'wi-1', leaseVersion: 2 }],
  picking: { strategy: 'single', startedAt: '2026-11-01T00:00:00Z' },
  inventorySession: { id: 'session-1', version: 4 },
} as unknown as OutboundBatchV2;

const shipment = {
  id: 'shipment-1',
  manifestVersion: 7,
  lines: [{ id: 'line-1', lineVersion: 3, skuName: '샘플 상품', qty: 2 }],
} as unknown as ShipmentAdminDetail;

beforeEach(() => {
  mockReport.mockReset();
  mockReport.mockResolvedValue({
    operationId: 'op-1',
    operationStatus: 'completed',
  });
});

function renderDialog() {
  render(
    <ShortPickDialog
      batch={batch}
      shipment={shipment}
      workItemId="wi-1"
      shipmentLineId="line-1"
      sourceLocationId="loc-1"
      onClose={jest.fn()}
    />
  );
}

it('CS 건 번호 칸이 없다', () => {
  renderDialog();

  expect(screen.getByRole('dialog').textContent).not.toMatch(/CS case/);
  expect(screen.getByText('메모 (선택)')).toBeTruthy();
});

it('식별자·버전 대신 상자와 상품만 보여 주고 영문 단어가 없다', () => {
  renderDialog();

  const text = screen.getByRole('dialog').textContent ?? '';
  expect(text).toContain('상자 shipment');
  expect(text).toContain('샘플 상품');
  expect(text).not.toMatch(/[A-Za-z]{3,}-?\d|lease|manifest/);
  expect(text.replace(/shipment|Close/g, '')).not.toMatch(/[A-Za-z]{3,}/);
});

it('기본 사유는 재고 부족이고 요청에 csCaseId 와 reasonCode 를 싣지 않는다', async () => {
  renderDialog();

  await userEvent.type(screen.getByRole('textbox'), '선반이 비어 있음');
  await userEvent.click(screen.getByRole('button', { name: '보고' }));

  expect(mockReport).toHaveBeenCalledTimes(1);
  const { data } = mockReport.mock.calls[0][0];
  expect(data.reason).toBe('inventory_shortage');
  expect(data.note).toBe('선반이 비어 있음');
  expect(data).not.toHaveProperty('csCaseId');
  expect(data).not.toHaveProperty('reasonCode');
});
