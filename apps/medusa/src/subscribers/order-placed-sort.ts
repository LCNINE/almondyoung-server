import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { type SubscriberConfig, type SubscriberArgs } from '@medusajs/medusa';
import { PRODUCT_SORTING_MODULE } from '../modules/product-sorting';
import { pushSalesCounts, type SalesCountEntry } from '../utils/search-sales-sync';
import type ProductSortingModuleService from '../modules/product-sorting/service';

type OrderItem = {
  id: string;
  product_id: string;
  /** order_line_item 에는 quantity 컬럼이 없다 — 수량은 `detail`(order_item) 에서 온다. */
  detail?: { quantity?: number | null } | null;
};

type OrderData = {
  id: string;
  items?: OrderItem[];
};

export default async function handleOrderPlacedSort({ event, container }: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve('logger');
  const orderId = event.data.id;

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const sortingService = container.resolve<ProductSortingModuleService>(PRODUCT_SORTING_MODULE);

    const { data } = await query.graph({
      entity: 'order',
      // 수량은 order_item(=detail)에만 있다. `items.quantity` 는 항상 undefined 로 와서
      // 모든 라인이 수량 1 로 세어졌다(판매순 정렬 과소집계).
      fields: ['id', 'items.id', 'items.product_id', 'items.detail.quantity'],
      filters: { id: orderId },
    });

    const order = data?.[0] as OrderData | undefined;
    if (!order || !order.items?.length) {
      logger.info(`[ProductSorting] No items in order: ${orderId}`);
      return;
    }

    const productQuantityMap = new Map<string, number>();

    for (const item of order.items) {
      if (item.product_id) {
        const current = productQuantityMap.get(item.product_id) || 0;
        productQuantityMap.set(
          item.product_id,
          current + (item.detail?.quantity ?? 1)
        );
      }
    }

    const salesCountByProductId = new Map<string, number>();
    for (const [productId, quantity] of productQuantityMap) {
      const updated = await sortingService.incrementSalesCount(productId, 'krw', quantity);
      logger.info(`[ProductSorting] Sales count incremented for product ${productId} by ${quantity}`);

      const record = Array.isArray(updated) ? updated[0] : updated;
      const salesCount = (record as { sales_count?: number } | undefined)?.sales_count;
      if (typeof salesCount === 'number') salesCountByProductId.set(productId, salesCount);
    }

    // 검색 랭킹의 판매량 항도 같이 올린다. 색인 문서 ID 는 product_id 가 아니라 handle 이다.
    const { data: products } = await query.graph({
      entity: 'product',
      fields: ['id', 'handle'],
      filters: { id: [...salesCountByProductId.keys()] },
    });

    const entries: SalesCountEntry[] = (products ?? [])
      .filter((product: { id: string; handle?: string | null }) => Boolean(product.handle))
      .map((product: { id: string; handle?: string | null }) => ({
        masterId: product.handle as string,
        salesCount: salesCountByProductId.get(product.id) as number,
      }));

    await pushSalesCounts(entries, logger);
  } catch (err: any) {
    logger.error(`[ProductSorting] Order placed handler error for ${orderId}: ${err?.message}`);
  }
}

export const config: SubscriberConfig = {
  event: 'order.placed',
  context: {
    subscriberId: 'order-placed-sort-handler',
  },
};
