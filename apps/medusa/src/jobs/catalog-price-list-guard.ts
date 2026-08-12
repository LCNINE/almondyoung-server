import type { MedusaContainer } from '@medusajs/framework/types';
import catalogPriceListGuard from '../scripts/catalog-price-list-guard';

// 카탈로그 캐시는 "고객 그룹 룰이 걸린 price list 는 멤버십 하나뿐" 이라는 전제 위에 서 있다.
// 어드민에서 다른 그룹용 price list 를 만들면 코드 변경 없이 그 전제가 깨지므로 주기 점검한다.
export default async function catalogPriceListGuardJob(container: MedusaContainer) {
  await catalogPriceListGuard({ container, args: [] });
}

export const config = {
  name: 'catalog-price-list-guard',
  // 매일 09:30 KST (00:30 UTC) — 읽기 전용이고, 업무 시작 직전에 로그가 쌓이게.
  schedule: '30 0 * * *',
};
