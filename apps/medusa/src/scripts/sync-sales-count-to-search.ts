/**
 * Medusa product_sort_index 의 누적 판매 수량을 search 색인으로 전량 동기화한다.
 *
 *   npx medusa exec ./src/scripts/sync-sales-count-to-search.ts
 *
 * 평상시엔 주문마다 order-placed-sort 구독자가 증분으로 밀어 넣는다. 이 스크립트는
 * (1) 최초 도입 백필 (2) 구독자가 search 호출에 실패해 놓친 건의 따라잡기 용이다.
 * 절대값을 덮어쓰므로 여러 번 돌려도 결과가 같다.
 */
import { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { PRODUCT_SORTING_MODULE } from '../modules/product-sorting';
import { pushSalesCounts, SALES_SYNC_BATCH_SIZE, type SalesCountEntry } from '../utils/search-sales-sync';

export default async function syncSalesCountToSearch({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const sortingService = container.resolve<any>(PRODUCT_SORTING_MODULE);

  const rows: Array<{ product_id: string; sales_count?: number }> =
    await sortingService.listProductSortIndices({ currency_code: 'krw' });

  const salesCountByProductId = new Map<string, number>();
  for (const row of rows) {
    if ((row.sales_count ?? 0) > 0) salesCountByProductId.set(row.product_id, row.sales_count as number);
  }
  logger.info(`[SalesSync] 판매 이력이 있는 상품 ${salesCountByProductId.size}건`);

  const { data: products } = await query.graph({
    entity: 'product',
    fields: ['id', 'handle'],
    filters: { id: [...salesCountByProductId.keys()] },
  });

  const entries: SalesCountEntry[] = (products ?? [])
    .filter((product: { handle?: string | null }) => Boolean(product.handle))
    .map((product: { id: string; handle?: string | null }) => ({
      masterId: product.handle as string,
      salesCount: salesCountByProductId.get(product.id) as number,
    }));

  let received = 0;
  let applied = 0;
  for (let i = 0; i < entries.length; i += SALES_SYNC_BATCH_SIZE) {
    const batch = entries.slice(i, i + SALES_SYNC_BATCH_SIZE);
    const result = await pushSalesCounts(batch, logger);
    if (!result) {
      logger.error(`[SalesSync] ${i}~${i + batch.length} 배치 전송 실패 — 중단`);
      break;
    }
    received += result.received;
    applied += result.applied;
    logger.info(`[SalesSync] ${received}/${entries.length} 전송, 색인 반영 ${applied}건`);
  }

  logger.info(`[SalesSync] 완료 — 전송 ${received}건, 색인 반영 ${applied}건`);
}
