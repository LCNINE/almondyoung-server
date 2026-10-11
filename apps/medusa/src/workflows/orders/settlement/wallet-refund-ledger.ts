import type { MedusaContainer } from '@medusajs/framework/types';
import { Modules } from '@medusajs/framework/utils';
import { refundPaymentWorkflow } from '@medusajs/medusa/core-flows';

import {
  paymentRefundLockKey,
  readRefundAttempt,
  readWalletRefundIds,
  withExternalRefund,
  type RefundAttempt,
} from '../../../modules/almond-payment/refund-data';
import { fetchWalletRefunds } from '../../../modules/almond-payment/wallet-refund-list';
import { EXTERNAL_REFUND_NOTE_PREFIX } from '../partial-cancel/external-refund';
import { orderPaymentIds } from './order-payments';
import { writePaymentData } from './payment-data';
import { planWalletRefundBookings, type WalletRefundBooking, type WalletRefundPlan } from './plan-wallet-refund-bookings';

/** 환불 투영(payment-events)·부분취소와 같은 값. 맞추기는 보통 0~1건이라 그 안에 든다 */
const PAYMENT_LOCK_TIMEOUT_SECONDS = 30;

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

/**
 * 결제 하나에서 장부에 없는 wallet 환불을 어떤 메모로 넣을지 «읽기만» 한다(#1016 36번 재설계 §6.2) — 투영도 표식 쓰기도 없다.
 * 장부 맞추기와 채널 취소의 «돈이 이미 나갔나» 판정이 같은 판정을 쓴다. 응답을 잃은 환불은 Medusa 가 자기 환불 행을 지워
 * 장부에 없고, 흔적은 wallet 목록과 시도 표식뿐이라 장부 합만으로는 못 본다.
 * wallet 결제가 아니거나 캡처 전에 취소된 결제면 맞출 것이 없다 — 시도 표식도 건드리지 않게 attempt 를 null 로 돌려준다.
 * inFlight(장부에 없는 자동 PENDING)도 메모와 함께 돌려준다 — 채널 취소의 판정은 그 메모가 자기 것이면 «돈이 나갔을 수 있다»로 읽는다.
 */
export async function planPaymentWalletRefundBookings(
  container: MedusaContainer,
  paymentId: string,
): Promise<WalletRefundPlan & { attempt: RefundAttempt | null }> {
  const payment = await container
    .resolve(Modules.PAYMENT)
    .retrievePayment(paymentId, { select: ['id', 'data', 'canceled_at'], relations: ['refunds'] });
  const data = payment.data ?? {};
  const intentId = typeof data.intentId === 'string' ? data.intentId : null;
  if (!intentId || payment.canceled_at) return { bookings: [], inFlight: [], attempt: null };
  const attempt = readRefundAttempt(data);
  const plan = planWalletRefundBookings({
    walletRefunds: await fetchWalletRefunds(intentId),
    bookedWalletRefundIds: [
      ...readWalletRefundIds(data),
      ...(payment.refunds ?? []).flatMap((r) =>
        r.note?.startsWith(EXTERNAL_REFUND_NOTE_PREFIX) ? [r.note.slice(EXTERNAL_REFUND_NOTE_PREFIX.length)] : [],
      ),
    ],
    attempt,
  });
  return { ...plan, attempt };
}

/**
 * 결제 하나의 장부 맞추기(#1016 36번 재설계 §6.2). 결제 잠금 안에서 부른다.
 * wallet 환불 목록에서 장부에 없는 SUCCEEDED·수동 PENDING 을 투영으로 넣는다 — 그래야 뒤의 «캡처 − 환불»이 이미 나간 돈을 또 내지 않는다.
 * 장부에 없는 자동 PENDING(진행 중)이 하나라도 있으면 아무것도 넣지 않고 일반 오류로 멈춘다(D8) — 정산은 일시 실패(500·502)로
 * 다시 불리고, wallet 이 그 행을 SUCCEEDED·FAILED 로 끝낸 뒤에 넣거나 버린다. 시도 표식도 그때까지 남는다.
 * 남은 시도 표식은 여기서 소비한다: 그 시도가 움직인 돈은 방금 그 메모로 들어갔거나, 없었다.
 */
export async function reconcileWalletRefunds(container: MedusaContainer, paymentId: string): Promise<void> {
  const { bookings, inFlight, attempt } = await planPaymentWalletRefundBookings(container, paymentId);
  if (inFlight.length > 0) {
    throw new Error(
      `wallet 환불이 아직 진행 중입니다 — 끝날 때까지 장부를 맞추지 않고 환불하지 않습니다(payment ${paymentId}): ` +
        inFlight.map((r) => `${r.walletRefundId}:${r.amount}`).join(','),
    );
  }
  for (const booking of bookings) await projectWalletRefund(container, paymentId, booking);
  if (attempt) await writePaymentData(container.resolve(Modules.PAYMENT), paymentId, { refundAttempt: null });
}

/** 주문의 결제마다 결제 잠금을 잡고 맞춘다. 부르는 쪽은 주문 잠금(orderCancelLockKey)을 쥐고 있다 */
export async function reconcileOrderWalletRefunds(container: MedusaContainer, orderId: string): Promise<void> {
  const locking = container.resolve(Modules.LOCKING);
  for (const paymentId of await orderPaymentIds(container, orderId)) {
    await locking.execute(paymentRefundLockKey(paymentId), () => reconcileWalletRefunds(container, paymentId), {
      timeout: PAYMENT_LOCK_TIMEOUT_SECONDS,
    });
  }
}
