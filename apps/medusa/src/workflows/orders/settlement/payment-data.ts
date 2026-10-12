import type { IPaymentModuleService } from '@medusajs/framework/types';

/**
 * 결제 `data` 칸 쓰기 — 정산의 표식(externalRefund·manualRefund·refundAttempt)은 모두 여기로 쓴다.
 * 런타임은 payment.data 를 (병합) 갱신하지만 UpdatePaymentDTO 타입에 `data` 가 없다(기존 웹훅은 scope 가 any 라 가려졌다).
 * 초과 속성 검사는 새 객체 리터럴에만 걸리므로 변수로 한 번 받아 넘긴다 — 캐스트 없이 이 한 자리에서만.
 * 표식을 지울 때는 키를 빼지 말고 null 로 쓴다(병합 갱신이라 뺀 키는 그대로 남는다).
 */
export function writePaymentData(paymentModule: IPaymentModuleService, id: string, data: Record<string, unknown>) {
  const update = { id, data };
  return paymentModule.updatePayment(update);
}
