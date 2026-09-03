import type { MedusaContainer } from '@medusajs/framework/types';
import { restoreStuckCouponConsumptions } from '../scripts/restore-stuck-coupon-consumptions';

// «주문 없는 소모» 백스톱 (ADR-0034 결정 7). 동작은 `medusa exec ./src/scripts/restore-stuck-coupon-consumptions` 와 동일.
// 정상 경로에서는 0건이어야 한다 — 0 이 아니면 프로세스가 워크플로 중간에 죽었다는 뜻이라 warn 으로 남긴다.
export default async function restoreStuckCouponConsumptionsJob(container: MedusaContainer) {
  await restoreStuckCouponConsumptions(container);
}

export const config = {
  name: 'restore-stuck-coupon-consumptions',
  // 매 시각 23분 — 정시 배치·orphan-payment-reconcile(17분)과 겹치지 않게.
  schedule: '23 * * * *',
};
