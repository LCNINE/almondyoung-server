import type { MedusaContainer } from '@medusajs/framework/types';
import orphanPaymentReconcile from '../scripts/orphan-payment-reconcile';

// 고아결제(돈은 빠졌는데 주문 없음) 백스톱. 지연 승인이 원천 차단하는 구조이지만, 남는
// 잔여 케이스(웹훅 유실, 승인 후 주문 복구 실패 등)를 주기적으로 훑어 환불/취소/캡처로 정리한다.
// 동작은 `medusa exec ./src/scripts/orphan-payment-reconcile` 와 동일.
//
// 중복 실행 주의: Medusa 가 worker_mode 미분리(shared) + 다중 인스턴스면 이 잡이 인스턴스마다
// 돈다. wallet 의 환불/취소/캡처는 모두 멱등(이미 처리된 intent 는 no-op)이라 결과는 안전하다.
export default async function orphanPaymentReconcileJob(container: MedusaContainer) {
  await orphanPaymentReconcile({ container, args: [] });
}

export const config = {
  name: 'orphan-payment-reconcile',
  // 매 시각 17분 — 정시 배치들과 겹치지 않게.
  schedule: '17 * * * *',
};
