import type { MedusaContainer } from '@medusajs/framework/types';
import syncProductSortIndex from '../scripts/sync-product-sort-index';

// product_sort_index(가격/리뷰 정렬 인덱스)를 주기적으로 재동기화한다.
// review_count 는 ugc 이벤트를 Medusa 가 직접 소비하지 못해(=Kafka 미연동) 이 주기 job 이 유일한 적재 경로다.
// 동작은 `medusa exec ./src/scripts/sync-product-sort-index` 와 동일.
//
// ponytail: 현재 Medusa 가 worker_mode 미분리(shared) + 2인스턴스라 이 job 이 인스턴스마다 중복 실행될 수 있다.
//           upsert 라 결과는 멱등(중복 무해)이며 하루 1회/저부하라 방치. 중복을 없애려면 worker 인스턴스를 분리할 것.
export default async function syncProductSortIndexJob(container: MedusaContainer) {
  await syncProductSortIndex({ container, args: [] });
}

export const config = {
  name: 'sync-product-sort-index-daily',
  // 매일 03:00 KST (UTC 18:00). 부하 적은 새벽에 전체 재동기화.
  schedule: '0 18 * * *',
};
