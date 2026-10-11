import type { IPaymentModuleService, MedusaContainer } from '@medusajs/framework/types';
import { Modules } from '@medusajs/framework/utils';
import { refundPaymentWorkflow } from '@medusajs/medusa/core-flows';

import { withExternalRefund } from '../../../modules/almond-payment/refund-data';
import type { WalletRefundBooking } from './plan-wallet-refund-bookings';

/**
 * 런타임은 payment.data 를 갱신하지만 UpdatePaymentDTO 타입에 `data` 가 없다(기존 웹훅은 scope 가 any 라 가려졌다).
 * 타입 정의만 좁은 것이므로 이 한 자리에서만 좁힌다.
 */
const writePaymentData = (paymentModule: IPaymentModuleService, id: string, data: Record<string, unknown>) =>
  paymentModule.updatePayment({ id, data } as Parameters<IPaymentModuleService['updatePayment']>[0]);

/**
 * Medusa 밖에서 끝난(또는 응답을 잃은) wallet 환불 하나를 장부에 넣는다 — wallet 을 다시 부르지 않는다(ADR-0042 원칙 3).
 * `externalRefund` 표식을 쓰고 refundPaymentWorkflow 를 돌리면 almond-payment 가 표식을 보고 wallet 호출을 건너뛴다.
 * 결제 잠금(paymentRefundLockKey) 안에서 부른다. 웹훅 투영(api/hooks/payment-events)과 장부 맞추기가 함께 쓴다.
 */
export async function projectWalletRefund(container: MedusaContainer, paymentId: string, booking: WalletRefundBooking): Promise<void> {
  const paymentModule = container.resolve(Modules.PAYMENT);
  const fresh = await paymentModule.retrievePayment(paymentId, { select: ['id', 'data'] });
  await writePaymentData(
    paymentModule,
    paymentId,
    withExternalRefund(fresh.data ?? {}, { walletRefundId: booking.walletRefundId, amount: booking.amount }),
  );
  try {
    await refundPaymentWorkflow(container).run({ input: { payment_id: paymentId, amount: booking.amount, note: booking.note } });
  } catch (err) {
    // 영구 실패(캡처 없음·캡처 초과 등)면 표식이 남아 같은 금액의 다음 Medusa 환불이 wallet 을 건너뛴다.
    // Medusa 는 JSON 칸을 병합 갱신하므로 null 로 지운다. 재배달·다음 맞추기가 표식을 다시 쓴다.
    await writePaymentData(paymentModule, paymentId, { externalRefund: null });
    throw err;
  }
}
