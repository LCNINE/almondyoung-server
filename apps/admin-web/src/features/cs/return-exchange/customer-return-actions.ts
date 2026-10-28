import type { CustomerReturnView } from '@/lib/types/dto/customer-returns';

export type CustomerReturnAction = {
  kind:
    | 'cancel'
    | 'closeMissing'
    | 'settleHeld'
    | 'prepay'
    | 'retrySettlement'
    | 'manualSettlement'
    | 'retryPrepayment'
    | 'manualPrepayment'
    | 'retryPickup';
  /** 다시 시도 대화상자가 받아야 하는 칸 */
  needs?: 'alreadyRefundedAmount' | 'dropHoldDeduction';
};

const EXTERNAL_REFUND_PREFIX = 'return_settle_rejected:external_refund_';
const NO_CHARGE_SHIPPING_OPTION =
  'return_settle_rejected:no_charge_shipping_option';
const PREPAY_REJECTED_PREFIX = 'return_prepay_rejected:';

/**
 * 반품 한 건에서 CS 가 누를 수 있는 버튼 (K8 PR7 N9). 서버 거절 조건 중 뷰로 알 수 있는 것만 미리 거르고,
 * 나머지는 서버 문구를 그대로 토스트한다. 순서는 N9 표의 행 순서.
 */
export function availableCustomerReturnActions(
  view: CustomerReturnView
): CustomerReturnAction[] {
  const actions: CustomerReturnAction[] = [];
  const { status, settlement, prepayment } = view;

  const missingTotal = view.lines.reduce((sum, l) => sum + l.missingQty, 0);
  const items = view.lines.flatMap((l) => l.items);
  const arrivedTotal = items.reduce((sum, i) => sum + i.arrivedQty, 0);
  const expectedTotal = items.reduce((sum, i) => sum + i.expectedQty, 0);
  const beforeInspection = status === 'expected' || status === 'arrived';
  const prepayCode = prepayment?.lastFailure?.code ?? '';
  const prepayRejected = prepayCode.startsWith(PREPAY_REJECTED_PREFIX);

  if (status === 'expected' && prepayment?.state !== 'done')
    actions.push({ kind: 'cancel' });

  if (
    status === 'arrived' &&
    arrivedTotal < expectedTotal &&
    missingTotal === 0 &&
    prepayment?.state !== 'in_progress' &&
    prepayment?.state !== 'stalled' &&
    prepayment?.state !== 'done'
  ) {
    actions.push({ kind: 'closeMissing' });
  }

  if (status === 'held') actions.push({ kind: 'settleHeld' });

  if (
    beforeInspection &&
    missingTotal === 0 &&
    (!prepayment || (prepayment.state === 'refused' && prepayRejected))
  ) {
    actions.push({ kind: 'prepay' });
  }

  if (
    (status === 'inspected' || status === 'refund_pending') &&
    settlement &&
    (settlement.state === 'refused' || settlement.state === 'stalled')
  ) {
    const code = settlement.lastFailure?.code ?? '';
    const retry: CustomerReturnAction = { kind: 'retrySettlement' };
    // 서버는 이 둘을 refused 에만 받는다(stalled 는 400) — 버튼도 그에 맞춘다.
    if (settlement.state === 'refused') {
      if (code.startsWith(EXTERNAL_REFUND_PREFIX))
        retry.needs = 'alreadyRefundedAmount';
      else if (code === NO_CHARGE_SHIPPING_OPTION)
        retry.needs = 'dropHoldDeduction';
    }
    actions.push(retry);
    if (settlement.refundMode !== 'manual')
      actions.push({ kind: 'manualSettlement' });
  }

  if (
    beforeInspection &&
    prepayment &&
    (prepayment.state === 'refused' || prepayment.state === 'stalled') &&
    !prepayRejected
  ) {
    actions.push({ kind: 'retryPrepayment' });
    if (prepayment.refundMode !== 'manual')
      actions.push({ kind: 'manualPrepayment' });
  }

  // 회수(한진) 예약이 없거나 실패·취소된 반품만 다시 접수한다. 나머지(활성 행·단계)는 서버가 409 로 가른다.
  if (
    status === 'expected' &&
    (!view.pickup ||
      view.pickup.status === 'failed' ||
      view.pickup.status === 'cancelled')
  ) {
    actions.push({ kind: 'retryPickup' });
  }

  return actions;
}
