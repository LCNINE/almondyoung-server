import type { MedusaContainer } from '@medusajs/framework/types';
import { Modules } from '@medusajs/framework/utils';
import { refundPaymentWorkflow } from '@medusajs/medusa/core-flows';

import { withManualRefund, withRefundAttempt } from '../../../modules/almond-payment/refund-data';
import { writePaymentData } from './payment-data';
import type { RefundMode } from './refund-mode';

/**
 * 결제 하나에 환불 한 번(#1016 36번 재설계 §6.2·§6.3). 결제 잠금(paymentRefundLockKey) 안에서 부른다.
 * 시도 표식을 먼저 쓴다 — 응답을 잃어 실패로 끝나도 다음 장부 맞추기가 그 돈을 이 메모로 장부에 넣는다.
 * 수동이면 수동 표식도 함께 쓰고, 실패하면 수동 표식만 지운다 — 남으면 다음 «자동» 시도가 금액이 같아 MANUAL 로 샌다.
 * 오류는 그대로 던진다. 표지 붙은 NOT_ALLOWED(영구 거절)와 그 밖(일시)을 가르는 것은 부르는 쪽이다.
 */
export async function issuePaymentRefund(
  container: MedusaContainer,
  input: { paymentId: string; amount: number; note: string; mode: RefundMode; actorId?: string },
): Promise<void> {
  const paymentModule = container.resolve(Modules.PAYMENT);
  const fresh = await paymentModule.retrievePayment(input.paymentId, { select: ['id', 'data'] });
  const marked = withRefundAttempt(fresh.data ?? {}, { note: input.note, amount: input.amount });
  await writePaymentData(
    paymentModule,
    input.paymentId,
    input.mode === 'manual' ? withManualRefund(marked, { requestId: input.note, amount: input.amount }) : marked,
  );
  try {
    await refundPaymentWorkflow(container).run({
      input: { payment_id: input.paymentId, amount: input.amount, created_by: input.actorId, note: input.note },
    });
  } catch (error) {
    if (input.mode === 'manual') await writePaymentData(paymentModule, input.paymentId, { manualRefund: null });
    throw error;
  }
  await writePaymentData(paymentModule, input.paymentId, { refundAttempt: null });
}
