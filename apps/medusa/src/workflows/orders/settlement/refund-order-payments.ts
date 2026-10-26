import type { MedusaContainer } from '@medusajs/framework/types';
import { Modules } from '@medusajs/framework/utils';

import { paymentRefundLockKey, type WalletRefundKind } from '../../../modules/almond-payment/refund-data';
import { toNumber } from '../partial-cancel/amount';
import { issuePaymentRefund } from './issue-payment-refund';
import { orderPaymentIds } from './order-payments';
import type { RefundMode } from './refund-mode';

/** 환불 투영(payment-events)과 같은 값. 이 잠금 안에서는 refundPaymentWorkflow 한 번만 돈다. */
const PAYMENT_LOCK_TIMEOUT_SECONDS = 30;

/**
 * 결제마다 «캡처 − 환불» 남은 만큼 차례로 환불한다. 결제 단위 잠금(환불 투영과 같은 키) 안에서 결제를 다시 읽어 여유를
 * 계산한다 — 같은 금액의 외부 환불 표식이 살아 있는 동안 우리 환불이 끼어들면 wallet 호출을 건너뛸 수 있다.
 * 이미 이 요청 메모로 기록된 환불은 빼고 나머지만 낸다(환불 뒤 기록 전에 끊겼다 다시 불려도 두 번 내지 않게).
 * 시도·수동 표식은 issuePaymentRefund 가 쓴다.
 */
export async function refundOrderPayments(
  container: MedusaContainer,
  input: { orderId: string; amount: number; note: string; mode: RefundMode; kind: WalletRefundKind; actorId?: string },
): Promise<void> {
  const { orderId, amount, note, mode, kind, actorId } = input;
  if (amount <= 0) return;
  const paymentModule = container.resolve(Modules.PAYMENT);
  const locking = container.resolve(Modules.LOCKING);
  const paymentIds = await orderPaymentIds(container, orderId);
  if (paymentIds.length === 0) throw new Error(`환불할 결제가 없습니다: ${orderId}`);

  const before = await paymentModule.listPayments({ id: paymentIds }, { relations: ['refunds'] });
  const alreadyRefunded = before.flatMap((p) => p.refunds ?? []).filter((r) => r.note === note).reduce((s, r) => s + toNumber(r.amount), 0);
  let left = amount - alreadyRefunded;

  for (const paymentId of paymentIds) {
    if (left <= 0) break;
    await locking.execute(
      paymentRefundLockKey(paymentId),
      async () => {
        const p = await paymentModule.retrievePayment(paymentId, { relations: ['captures', 'refunds'] });
        if (p.canceled_at) return;
        const captured = (p.captures ?? []).reduce((s, x) => s + toNumber(x.amount), 0);
        const refunded = (p.refunds ?? []).reduce((s, x) => s + toNumber(x.amount), 0);
        const take = Math.min(captured - refunded, left);
        if (!(take > 0)) return;
        await issuePaymentRefund(container, { paymentId, amount: take, note, mode, kind, actorId });
        left -= take;
      },
      { timeout: PAYMENT_LOCK_TIMEOUT_SECONDS },
    );
  }
  if (left > 0) throw new Error(`환불할 캡처 잔액이 부족합니다: 남은 ${left}`);
}
