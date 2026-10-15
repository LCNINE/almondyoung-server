import { CANCEL_CLAIM_STALE_MS } from './print-order-cancellation.manager';
import { PRINT_ORDER_STALE_MS, unsavedOrdnumError } from './print-order-submit.manager';
import { boardFlags, isActivePrint } from './print-order-board.rules';
import { lateOrdnumError } from './print-order.repository';
import { type PrintOrderListItem } from './print-order.reader';

const NOW = Date.UTC(2026, 9, 14, 12);
const LONG_AGO = new Date(NOW - 24 * 3600_000);

function row(overrides: Partial<PrintOrderListItem> = {}): PrintOrderListItem {
  return {
    id: 'po-1',
    salesOrderId: 'so-1',
    salesOrderLineId: 'sol-1',
    almondDesignId: 'd-1',
    vendor: 'wowpress',
    status: 'submitted',
    testMemo: false,
    vendorOrderNumber: 'W-1',
    vendorBoxNumber: null,
    vendorShippingFee: null,
    attemptCount: 0,
    lastError: null,
    nextAttemptAt: LONG_AGO,
    submittingAt: LONG_AGO,
    orderAttemptedAt: LONG_AGO,
    carrier: null,
    trackingNumber: null,
    shippedAt: null,
    deliveredAt: null,
    testConfirmedAt: null,
    testConfirmedBy: null,
    testNote: null,
    cancelRefusedAt: null,
    cancelResolvedAt: null,
    cancelResolvedBy: null,
    salesCancelFailedAt: null,
    createdAt: LONG_AGO,
    updatedAt: LONG_AGO,
    channelOrderId: 'order_1',
    displayOrderNo: null,
    customerName: null,
    customerPhone: null,
    productName: 'p',
    salesCancelFailed: false,
    ...overrides,
  };
}

describe('boardFlags', () => {
  it('plain submitted row: nothing to do', () => {
    expect(boardFlags(row(), NOW)).toEqual({
      retryBlocked: false,
      needsWowpressCheck: false,
      resolvable: false,
      salesCancelFailed: false,
    });
  });

  it.each([lateOrdnumError('W-2'), unsavedOrdnumError('W-2'), 'duplicate wowpress order suspected: W-1 / W-2'])(
    'retryBlocked for %s',
    (lastError) => {
      expect(boardFlags(row({ status: 'failed', lastError }), NOW).retryBlocked).toBe(true);
    },
  );

  it('needsWowpressCheck when an order was attempted without a number', () => {
    expect(boardFlags(row({ status: 'failed', vendorOrderNumber: null }), NOW).needsWowpressCheck).toBe(true);
  });

  it('cancel_refused is resolvable, but not while an order may be in flight', () => {
    expect(boardFlags(row({ status: 'cancel_refused' }), NOW).resolvable).toBe(true);
    const inFlight = row({ status: 'cancel_refused', submittingAt: new Date(NOW - PRINT_ORDER_STALE_MS + 1000) });
    expect(boardFlags(inFlight, NOW).resolvable).toBe(false);
  });

  it('cancelling is resolvable only once stale', () => {
    expect(boardFlags(row({ status: 'cancelling', updatedAt: new Date(NOW - 1000) }), NOW).resolvable).toBe(false);
    const stale = row({ status: 'cancelling', updatedAt: new Date(NOW - CANCEL_CLAIM_STALE_MS - 1000) });
    expect(boardFlags(stale, NOW).resolvable).toBe(true);
  });

  it('cancelled with sales quantity left is flagged and resolvable, whatever the failure stamp says', () => {
    const flags = boardFlags(row({ status: 'cancelled', salesCancelFailed: true }), NOW);
    expect(flags).toMatchObject({ salesCancelFailed: true, resolvable: true });
  });

  it('a stale failure stamp alone does not flag a row whose sales line is fully cancelled', () => {
    const flags = boardFlags(
      row({ status: 'cancelled', salesCancelFailedAt: new Date(NOW), salesCancelFailed: false }),
      NOW,
    );
    expect(flags).toMatchObject({ salesCancelFailed: false, resolvable: false });
  });

  it('a protected cancelled row is resolvable only if the operator resolved it', () => {
    const base = {
      status: 'cancelled' as const,
      salesCancelFailed: true,
      lastError: lateOrdnumError('W-2'),
    };
    expect(boardFlags(row(base), NOW).resolvable).toBe(false);
    expect(boardFlags(row({ ...base, cancelResolvedAt: LONG_AGO }), NOW).resolvable).toBe(true);
  });
});

describe('isActivePrint — 결제 상세 환불 제한 판정', () => {
  const at = new Date(NOW);
  it.each([
    ['pending', null],
    ['submitting', null],
    ['submitted', at],
    ['shipped', at],
    ['delivered', at],
    ['cancelling', at],
    ['cancel_refused', at],
    ['failed', at],
    ['unsupported', at],
  ] as const)('%s (주문권 %s) → 제작 접수됐을 수 있음', (status, orderAttemptedAt) => {
    expect(isActivePrint({ status, orderAttemptedAt })).toBe(true);
  });

  it.each([
    ['cancelled', at],
    ['failed', null],
    ['unsupported', null],
  ] as const)('%s (주문권 %s) → 제작 접수 없음', (status, orderAttemptedAt) => {
    expect(isActivePrint({ status, orderAttemptedAt })).toBe(false);
  });
});
