import type { MedusaContainer } from '@medusajs/framework/types';
import purgeExpiredEntrancePasswords from '../scripts/purge-expired-entrance-passwords';

// 공동현관 비번은 Medusa 를 **통과**할 뿐이다 — core 가 받아 송장에 싣고 배송 완료 시 파기한다.
// 여기 남은 사본은 보관 의무가 아니라 잔여물이므로 주문일 +14일에 키 자체를 지운다.
// 동작은 `medusa exec ./src/scripts/purge-expired-entrance-passwords` 와 동일.
//
// 킬스위치를 두지 않았다. 이건 개인정보 파기를 이행하는 코드이고, env 하나로 조용히 꺼질 수
// 있으면 그 사실을 아무도 모르는 채로 보관이 계속된다.
//
// 중복 실행 주의: Medusa 가 worker_mode 미분리(shared) + 다중 인스턴스면 이 잡이 인스턴스마다
// 돈다. 파기는 "빈 문자열을 써서 키를 삭제"라 이미 지워진 주문에 다시 써도 no-op 이고,
// 후보 조회 술어가 비워진 주문을 애초에 뽑지 않으므로 결과는 안전하다.
export default async function purgeExpiredEntrancePasswordsJob(container: MedusaContainer) {
  await purgeExpiredEntrancePasswords({ container, args: [] });
}

export const config = {
  name: 'purge-expired-entrance-passwords',
  // 매일 04:20 KST (19:20 UTC). 상한이 14일이라 하루의 지연은 의미가 없고, 03:00 KST 전체
  // 재동기화(sync-product-sort-index)와 매시 :17 잡을 피해 둔다.
  schedule: '20 19 * * *',
};
