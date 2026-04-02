/**
 * 기존 주문 데이터 기반 sales_sort_key 초기화 스크립트
 *
 * 모든 기존 주문의 판매량을 집계하여 sales_sort_key에 반영합니다.
 *
 * 실행: npx medusa exec ./src/scripts/init-sales-sort-keys.ts
 */
import { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { PRODUCT_SORT_MODULE } from '../modules/product-sort';
import type { ProductSortModuleService } from '../modules/product-sort/service';

const BATCH_SIZE = 100;

type OrderItem = {
  product_id: string;
  quantity: number;
};

type OrderData = {
  id: string;
  items?: OrderItem[];
};

export default async function initSalesSortKeys({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const productSortService = container.resolve(PRODUCT_SORT_MODULE) as ProductSortModuleService;

  logger.info('[init-sales-sort-keys] 시작...');

  try {
    // 1. 모든 완료된 주문에서 상품별 판매량 집계
    const productSales = new Map<string, number>();

    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: orders } = await query.graph({
        entity: 'order',
        fields: ['id', 'items.product_id', 'items.quantity'],
        filters: {
          // 완료된 주문만 (필요시 status 필터 추가)
        },
        pagination: {
          skip: offset,
          take: BATCH_SIZE,
        },
      });

      if (!orders || orders.length === 0) {
        hasMore = false;
        break;
      }

      for (const order of orders as OrderData[]) {
        if (!order.items) continue;

        for (const item of order.items) {
          if (!item.product_id) continue;

          const current = productSales.get(item.product_id) ?? 0;
          productSales.set(item.product_id, current + (item.quantity ?? 1));
        }
      }

      offset += BATCH_SIZE;
      logger.info(`[init-sales-sort-keys] 주문 처리 중: ${offset}건 완료`);

      if (orders.length < BATCH_SIZE) {
        hasMore = false;
      }
    }

    logger.info(`[init-sales-sort-keys] 집계 완료: ${productSales.size}개 상품`);

    // 2. sales_sort_key 업데이트
    let updated = 0;
    let created = 0;
    let errors = 0;

    for (const [productId, salesCount] of productSales) {
      try {
        const existing = await productSortService.listProductSortKeys({
          product_id: productId,
        });

        if (existing.length > 0) {
          await productSortService.updateProductSortKeys({
            id: existing[0].id,
            sales_sort_key: salesCount,
            last_synced_at: new Date(),
          });
          updated++;
        } else {
          await productSortService.createProductSortKeys({
            product_id: productId,
            price_sort_key: null,
            sales_sort_key: salesCount,
            last_synced_at: new Date(),
          });
          created++;
        }
      } catch (error) {
        logger.error(`[init-sales-sort-keys] 상품 ${productId} 처리 실패:`, error);
        errors++;
      }
    }

    logger.info(
      `[init-sales-sort-keys] 완료: 업데이트=${updated}, 새로생성=${created}, 실패=${errors}`,
    );

    // 상위 판매 상품 출력
    const topProducts = Array.from(productSales.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    logger.info('[init-sales-sort-keys] 상위 10개 판매 상품:');
    for (const [productId, count] of topProducts) {
      logger.info(`  - ${productId}: ${count}개`);
    }
  } catch (error) {
    logger.error('[init-sales-sort-keys] 스크립트 실패:', error);
    throw error;
  }
}
