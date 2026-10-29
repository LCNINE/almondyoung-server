import { createElement, Fragment, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CustomerReturnView } from '@/lib/types/dto/customer-returns';
import { CustomerReturnSheet } from './index';

const mockUseCustomerReturn = jest.fn();

jest.mock('@/lib/services/customer-returns', () => ({
  useCustomerReturn: () => mockUseCustomerReturn(),
}));
jest.mock('../customer-return-action-dialog', () => ({
  CustomerReturnActionDialog: () => null,
}));
jest.mock('@/components/ui/sheet', () => {
  const part = ({ children }: { children: ReactNode }) =>
    createElement(Fragment, null, children);

  return {
    Sheet: part,
    SheetContent: part,
    SheetHeader: part,
    SheetTitle: part,
    SheetDescription: part,
  };
});

const view: CustomerReturnView = {
  id: 'r1',
  salesOrderId: 'so1',
  order: { orderNo: 'N1', channelOrderId: 'c1', salesChannel: 'medusa' },
  channelReturnId: 'cr1',
  status: 'settled',
  reason: 'defective',
  note: '포장이 찢어졌어요\n확인 부탁드려요',
  feeBearer: 'seller',
  requestedBy: 'customer',
  warehouseId: null,
  windowOverrideReason: null,
  requestedAt: '2026-10-01T00:00:00Z',
  cancelledAt: null,
  arrivedAt: null,
  refundDueAt: null,
  inspectedAt: null,
  settledAt: '2026-10-02T00:00:00Z',
  settlement: null,
  settlementOutcome: null,
  prepayment: null,
  csResolution: null,
  pickup: null,
  lines: [],
};

function render(note: string | null, shippingRefund?: number) {
  mockUseCustomerReturn.mockReturnValue({
    data: {
      ...view,
      note,
      settlementOutcome: {
        refundAmount: 13000,
        shippingRefund,
        deduction: { returnShipping: 3000, freeShippingBreak: 0, roundTrip: 0 },
        feeNotAdjusted: false,
        refundMode: 'auto',
        settledAt: view.settledAt,
      },
    },
  });

  return renderToStaticMarkup(
    createElement(CustomerReturnSheet, {
      id: view.id,
      customerName: null,
      onClose: jest.fn(),
    })
  );
}

describe('CustomerReturnSheet', () => {
  it('메모의 줄바꿈을 유지하고 환불 총액과 차감 사이에 배송비 환불을 표시한다', () => {
    const html = render(view.note, 3000);

    expect(html).toContain('class="whitespace-pre-wrap break-words"');
    expect(html).toContain(`고객 메모: ${view.note}`);
    expect(html).toContain('배송비 환불 +3,000원');
    expect(html.indexOf('환불 13,000원')).toBeLessThan(
      html.indexOf('배송비 환불 +3,000원')
    );
    expect(html.indexOf('배송비 환불 +3,000원')).toBeLessThan(
      html.indexOf('반품 택배비 -3,000원')
    );
  });

  it.each([null, ''])('메모가 %p이면 메모 줄이 없다', (note) => {
    expect(render(note)).not.toContain('고객 메모:');
  });

  it.each([undefined, 0, -1])(
    '배송비 환불이 %p이면 환불 줄이 없다',
    (shippingRefund) => {
      expect(render(null, shippingRefund)).not.toContain('배송비 환불');
    }
  );
});
