import { isMoneyMoved, isOrphanPayment, partialCancelHref, printRefundGate } from './refund-print-gate';

describe('printRefundGate', () => {
  const opts = { medusaOrder: true, moneyCaptured: true, defectConfirmed: false };
  const collected = { hasActivePrint: false, channelOrderId: 'order_01' };

  it('인쇄 줄이 없고 수집된 주문이면 연다', () => {
    expect(printRefundGate(collected, opts)).toBe('open');
  });

  it('인쇄 줄이 있으면 하자 체크 전에는 막고, 체크하면 연다', () => {
    const print = { hasActivePrint: true, channelOrderId: 'order_01' };
    expect(printRefundGate(print, opts)).toBe('print');
    expect(printRefundGate(print, { ...opts, defectConfirmed: true })).toBe('open');
  });

  it('인쇄 상태를 아직 모르면 막는다', () => {
    expect(printRefundGate(undefined, opts)).toBe('unknown');
  });

  it('Medusa 주문인데 아직 수집 전이면 받은 돈을 돌려주는 동작은 막는다', () => {
    const uncollected = { hasActivePrint: false, channelOrderId: null };
    expect(printRefundGate(uncollected, opts)).toBe('uncollected');
    expect(printRefundGate(uncollected, { ...opts, defectConfirmed: true })).toBe('uncollected');
  });

  it('Medusa 에 주문이 없는 결제는 수집 전이어도 연다. 인쇄가 있으면 그것으로는 열지 않는다', () => {
    const uncollected = { hasActivePrint: false, channelOrderId: null };
    expect(printRefundGate(uncollected, { ...opts, orphanPayment: true })).toBe('open');
    expect(printRefundGate({ hasActivePrint: true, channelOrderId: 'o' }, { ...opts, orphanPayment: true })).toBe(
      'print'
    );
  });

  it('주문 없음은 결제 후 30분이 지나고 카트도 완료되지 않았을 때만 믿는다', () => {
    const createdAt = '2026-10-16T00:00:00Z';
    const late = new Date(createdAt).getTime() + 31 * 60_000;
    const early = new Date(createdAt).getTime() + 5 * 60_000;
    const none = { orderId: null, cartCompleted: false };
    expect(isOrphanPayment(none, createdAt, late)).toBe(true);
    expect(isOrphanPayment(none, createdAt, early)).toBe(false);
    expect(isOrphanPayment({ orderId: null, cartCompleted: true }, createdAt, late)).toBe(false);
    expect(isOrphanPayment({ orderId: 'order_1', cartCompleted: true }, createdAt, late)).toBe(false);
    expect(isOrphanPayment(undefined, createdAt, late)).toBe(false);
  });

  it('입금 전 거절처럼 돈이 안 오간 취소나 Medusa 주문이 아닌 결제는 수집 여부와 상관없이 연다', () => {
    const uncollected = { hasActivePrint: false, channelOrderId: null };
    expect(printRefundGate(uncollected, { ...opts, moneyCaptured: false })).toBe('open');
    expect(printRefundGate(uncollected, { ...opts, medusaOrder: false })).toBe('open');
  });
});

describe('partialCancelHref', () => {
  it('주문번호가 있으면 주문내역을 그 주문으로 연다', () => {
    expect(partialCancelHref('order_01J A')).toBe('/order/history?orderNo=order_01J%20A');
  });

  it('주문번호를 모르면 주문내역 목록으로 보낸다', () => {
    expect(partialCancelHref(null)).toBe('/order/history');
  });
});

describe('isMoneyMoved', () => {
  it('승인·매입된 결제만 돈이 오간 것으로 본다', () => {
    expect(isMoneyMoved('AUTHORIZED')).toBe(true);
    expect(isMoneyMoved('SUCCEEDED')).toBe(true);
    expect(isMoneyMoved('REQUIRES_ACTION')).toBe(false);
    expect(isMoneyMoved('AWAITING_DEPOSIT')).toBe(false);
  });
});
