import type { CustomerReturnView } from '@/lib/types/dto/customer-returns';
import { RETURN_ACTION_LABELS } from './customer-return-labels';

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
    | 'retryPickup'
    | 'releaseExchange';
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
 *
 * 교환(K8 PR11b N13)에는 돈이 나가지 않는다 — 미도착 닫기·보류 정산·선환불·계좌 송금이 없고, 정산 다시 시도는
 * 칸 없이만 낸다(core 가 나머지를 «교환은 …» 400 으로 거절한다). 대신 «교환품 보내기»가 있다. 열린 교환은 취소할 수
 * 없다(Medusa `exchange_released`).
 */
export function availableCustomerReturnActions(
  view: CustomerReturnView
): CustomerReturnAction[] {
  const actions: CustomerReturnAction[] = [];
  const { status, settlement, prepayment } = view;
  const exchange = view.kind === 'exchange';
  const released = view.exchangeReleasedAt !== null;

  const missingTotal = view.lines.reduce((sum, l) => sum + l.missingQty, 0);
  const items = view.lines.flatMap((l) => l.items);
  const arrivedTotal = items.reduce((sum, i) => sum + i.arrivedQty, 0);
  const expectedTotal = items.reduce((sum, i) => sum + i.expectedQty, 0);
  const beforeInspection = status === 'expected' || status === 'arrived';
  const prepayCode = prepayment?.lastFailure?.code ?? '';
  const prepayRejected = prepayCode.startsWith(PREPAY_REJECTED_PREFIX);

  if (status === 'expected' && prepayment?.state !== 'done' && !(exchange && released))
    actions.push({ kind: 'cancel' });

  if (exchange && releaseExchangeOpen(view)) actions.push({ kind: 'releaseExchange' });

  if (
    !exchange &&
    status === 'arrived' &&
    arrivedTotal < expectedTotal &&
    missingTotal === 0 &&
    prepayment?.state !== 'in_progress' &&
    prepayment?.state !== 'stalled' &&
    prepayment?.state !== 'done'
  ) {
    actions.push({ kind: 'closeMissing' });
  }

  if (!exchange && status === 'held') actions.push({ kind: 'settleHeld' });

  if (
    !exchange &&
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
    // 서버는 이 둘을 refused 에만 받는다(stalled 는 400) — 버튼도 그에 맞춘다. 교환은 둘 다 400 이다.
    if (!exchange && settlement.state === 'refused') {
      if (code.startsWith(EXTERNAL_REFUND_PREFIX))
        retry.needs = 'alreadyRefundedAmount';
      else if (code === NO_CHARGE_SHIPPING_OPTION)
        retry.needs = 'dropHoldDeduction';
    }
    actions.push(retry);
    if (!exchange && settlement.refundMode !== 'manual')
      actions.push({ kind: 'manualSettlement' });
  }

  if (
    !exchange &&
    beforeInspection &&
    prepayment &&
    (prepayment.state === 'refused' || prepayment.state === 'stalled') &&
    !prepayRejected
  ) {
    actions.push({ kind: 'retryPrepayment' });
    if (prepayment.refundMode !== 'manual')
      actions.push({ kind: 'manualPrepayment' });
  }

  // 회수(한진) 예약이 없거나 실패·취소·무효인 반품만 다시 접수한다. void 는 회수만 놓아주고 반품 취소가 실패했을 때
  // 생긴다(R8). 나머지(활성 행·단계)는 서버가 409 로 가른다.
  if (
    status === 'expected' &&
    (!view.pickup ||
      view.pickup.status === 'failed' ||
      view.pickup.status === 'cancelled' ||
      view.pickup.status === 'void')
  ) {
    actions.push({ kind: 'retryPickup' });
  }

  return actions;
}

/** 교환품 보내기 문이 열려 있는가 — 열기 전이면 수령 전·보류에서, 연 뒤면 보류(정산 열기)에서만 (K8 PR11 N14) */
function releaseExchangeOpen(view: CustomerReturnView): boolean {
  if (view.exchangeReleasedAt === null)
    return view.status === 'expected' || view.status === 'arrived' || view.status === 'held';
  return view.status === 'held';
}

/** 선발송 뒤 검수가 보류로 멈춘 교환은 상자가 이미 열렸다 — 남은 일은 정산을 여는 것뿐이다 */
const opensSettlementOnly = (view: CustomerReturnView) =>
  view.exchangeReleasedAt !== null && view.status === 'held';

export function releaseExchangeLabel(view: CustomerReturnView): string {
  return opensSettlementOnly(view) ? '교환 정산 열기' : RETURN_ACTION_LABELS.releaseExchange;
}

export function releaseExchangeSuccessMessage(view: CustomerReturnView): string {
  return opensSettlementOnly(view)
    ? '교환 정산을 열었습니다'
    : '교환품 출고를 지시했습니다 — 상자는 출고 화면에 나타납니다';
}
