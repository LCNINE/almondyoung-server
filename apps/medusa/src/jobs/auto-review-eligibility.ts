import type { MedusaContainer } from '@medusajs/framework/types';
import autoReviewEligibility from '../scripts/auto-review-eligibility';

// 배송이 끝났을 법한 주문에 리뷰 자격을 발급한다. 결제 경로는 타지 않는다 — 이 쇼핑몰은 매입이
// 체크아웃에서 끝나 구매확정에 남은 실질이 자격 발급 하나뿐이다.
// 판정 규칙·근거·기간 창은 `../scripts/lib/auto-review-eligibility.ts`.
// 동작은 `medusa exec ./src/scripts/auto-review-eligibility` 와 동일.
//
// 🔴 기본은 꺼져 있다 — `ELIGIBILITY_AUTO_ISSUE=true` 여야 실제로 발급한다. 꺼진 채로는 후보를
// 세고 로그만 남기므로, 켜기 전에 「몇 건에 한꺼번에 자격이 생길지」를 먼저 볼 수 있다.
//
// 중복 실행 주의: Medusa 가 worker_mode 미분리(shared) + 다중 인스턴스면 이 잡이 인스턴스마다
// 돈다. ugc 의 발급이 `source_event_id` unique + onConflictDoNothing 이라 자격이 두 번 만들어지지
// 않고, 발급 표식도 같은 값을 두 번 쓰는 것이라 결과가 같다.
export default async function autoReviewEligibilityJob(container: MedusaContainer) {
  await autoReviewEligibility({ container, args: [] });
}

export const config = {
  name: 'auto-review-eligibility',
  // 매일 05:10 KST (20:10 UTC). 트래픽이 가장 적은 시각대이면서 03:00 KST 전체 재동기화,
  // 04:20 KST 비번 파기, 매시 :17/:23 잡과 겹치지 않는 자리.
  schedule: '10 20 * * *',
};
