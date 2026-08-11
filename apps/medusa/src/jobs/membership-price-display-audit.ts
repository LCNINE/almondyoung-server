import type { MedusaContainer } from '@medusajs/framework/types';
import membershipPriceDisplayAudit from '../scripts/membership-price-display-audit';

// 스토어프론트는 비회원에게 보여줄 멤버십가를 variant.metadata.membershipPrice 에서 읽고,
// 실제 결제는 price_list 가 결정한다. 둘이 갈라지면 표시가와 결제가가 달라진다.
//
// 정상 동기화 경로는 둘을 같이 쓰므로 어긋나지 않는다. 어긋나는 건 이벤트를 안 내는
// 수동 DB 작업 뒤 재동기화가 빠졌을 때다 — 2026-07-21 누락이 3주간 방치돼
// 표시 4,000원/결제 4,500원 상태가 있었고, 코드로는 막을 수 없어 주기 점검으로 잡는다.
export default async function membershipPriceDisplayAuditJob(container: MedusaContainer) {
  await membershipPriceDisplayAudit({ container, args: [] });
}

export const config = {
  name: 'membership-price-display-audit',
  // 매일 09:40 KST (00:40 UTC) — 읽기 전용이라 부하 무시 가능, 업무 시작 직전에 로그가 쌓이게.
  schedule: '40 0 * * *',
};
