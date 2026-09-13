import type { MedusaContainer } from '@medusajs/framework/types';
import syncProductSortIndex from '../scripts/sync-product-sort-index';

// product_sort_index(가격/리뷰 정렬 인덱스)를 주기적으로 재동기화한다.
// review_count 는 ugc 이벤트를 Medusa 가 직접 소비하지 못해(=Kafka 미연동) 이 주기 job 이 유일한 적재 경로다.
// 동작은 `medusa exec ./src/scripts/sync-product-sort-index` 와 동일.
//
// ADR-0037 (#855): 백그라운드(job·subscriber)는 admin 인스턴스(`workerMode: shared`) 하나만 돌린다.
//           store 는 `server` 라 이 job 을 로드하지 않는다 — 인스턴스 중복 실행 문제는 구조로 사라졌다.
export default async function syncProductSortIndexJob(container: MedusaContainer) {
  await syncProductSortIndex({ container, args: [] });
}

export const config = {
  name: 'sync-product-sort-index-daily',
  // 매일 03:00 KST (UTC 18:00). 부하 적은 새벽에 전체 재동기화.
  schedule: '0 18 * * *',
};
