import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { refundPaymentWorkflow } from '@medusajs/medusa/core-flows';

import {
  withManualRefund,
  withRefundKind,
  withoutExternalRefund,
  withoutManualRefund,
  withRefundAttempt,
  type WalletRefundKind,
} from '../../../modules/almond-payment/refund-data';
import { describeError } from '../../../utils/describe-error';
import { writePaymentData } from './payment-data';
import type { RefundMode } from './refund-mode';

/**
 * 결제 하나에 환불 한 번(#1016 36번 재설계 §6.2·§6.3). 결제 잠금(paymentRefundLockKey) 안에서 부른다.
 * 첫 쓰기가 표식 셋을 이번 시도의 값으로 맞춘다 — 시도 표식을 쓰고(응답을 잃어 실패로 끝나도 다음 장부 맞추기가 그 돈을 이 메모로
 * 장부에 넣는다), 수동 표식은 수동이면 이번 메모·금액으로, 자동이면 null, 외부 환불 표식은 null. 앞 시도가 죽으며 남긴 표식이
 * 이번 환불을 바꾸지 못하게 한다: 수동 표식이 남으면 같은 금액의 자동 환불이 MANUAL 로 새고, 외부 표식이 남으면 provider 가 wallet 을
 * 건너뛰고 나가지 않은 환불을 장부에 넣는다. 결제 잠금 안이라 투영(외부 표식을 쓰는 쪽)이 돌고 있지 않으니 지워도 안전하다.
 * 실패하면 수동 표식만 지운다 — 남으면 다음 «자동» 시도가 금액이 같아 MANUAL 로 샌다(다음 시도의 첫 쓰기도 지운다).
 * 오류는 그대로 던진다. 표지 붙은 NOT_ALLOWED(영구 거절)와 그 밖(일시)을 가르는 것은 부르는 쪽이다.
 */
export async function issuePaymentRefund(
  container: MedusaContainer,
  input: { paymentId: string; amount: number; note: string; mode: RefundMode; kind: WalletRefundKind; actorId?: string },
): Promise<void> {
  const paymentModule = container.resolve(Modules.PAYMENT);
  const fresh = await paymentModule.retrievePayment(input.paymentId, { select: ['id', 'data'] });
  // 종류 표식도 이번 시도의 값으로 덮어쓴다(금액이 붙어 있어 앞 시도의 표식은 다른 금액의 환불에 붙지 못한다)
  const marked = withoutExternalRefund(
    withRefundKind(withRefundAttempt(fresh.data ?? {}, { note: input.note, amount: input.amount }), { kind: input.kind, amount: input.amount }),
  );
  await writePaymentData(
    paymentModule,
    input.paymentId,
    input.mode === 'manual' ? withManualRefund(marked, { requestId: input.note, amount: input.amount }) : withoutManualRefund(marked),
  );
  try {
    await refundPaymentWorkflow(container).run({
      input: { payment_id: input.paymentId, amount: input.amount, created_by: input.actorId, note: input.note },
    });
  } catch (error) {
    if (input.mode === 'manual') {
      // 지우기 실패가 원래 오류(영구 거절 표지·일시)를 덮으면 부르는 쪽의 판정이 바뀐다 — 로그만 남기고 원래 오류를 던진다
      await writePaymentData(paymentModule, input.paymentId, { manualRefund: null }).catch((cleanupError: unknown) => {
        container
          .resolve(ContainerRegistrationKeys.LOGGER)
          .error(
            `[settlement] 수동 환불 실패 뒤 수동 표식을 지우지 못했습니다 — 다음 시도의 첫 쓰기가 지웁니다(payment ${input.paymentId}): ${describeError(cleanupError)}`,
          );
      });
    }
    throw error;
  }
  await writePaymentData(paymentModule, input.paymentId, { refundAttempt: null, refundKind: null });
}
