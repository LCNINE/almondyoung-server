import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { type SubscriberConfig, type SubscriberArgs } from '@medusajs/medusa';
import { PRODUCT_SORT_MODULE } from '../modules/product-sort';
import type { ProductSortModuleService } from '../modules/product-sort/service';

type OrderEventData = {
  id: string;
};

type OrderItem = {
  id: string;
  product_id: string;
  quantity: number;
};

type OrderData = {
  id: string;
  items?: OrderItem[];
};

async function getOrderItems(orderId: string, container: any): Promise<OrderItem[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  try {
    const { data } = await query.graph({
      entity: 'order',
      fields: ['id', 'items.id', 'items.product_id', 'items.quantity'],
      filters: { id: orderId },
    });

    const order = data?.[0] as OrderData | undefined;
    return order?.items ?? [];
  } catch (error) {
    console.error(`[sync-sales-sort-key] 주문 조회 실패 (orderId: ${orderId}):`, error);
    return [];
  }
}

async function incrementSalesSortKey(
  productId: string,
  quantity: number,
  container: any,
): Promise<void> {
  const productSortService = container.resolve(PRODUCT_SORT_MODULE) as ProductSortModuleService;

  try {
    const existing = await productSortService.listProductSortKeys({
      product_id: productId,
    });

    if (existing.length > 0) {
      const current = existing[0];
      const newSalesCount = (current.sales_sort_key ?? 0) + quantity;

      await productSortService.updateProductSortKeys({
        id: current.id,
        sales_sort_key: newSalesCount,
        last_synced_at: new Date(),
      });
    } else {
      await productSortService.createProductSortKeys({
        product_id: productId,
        price_sort_key: null,
        sales_sort_key: quantity,
        last_synced_at: new Date(),
      });
    }
  } catch (error) {
    console.error(`[sync-sales-sort-key] 판매량 업데이트 실패 (productId: ${productId}):`, error);
    throw error;
  }
}

export default async function handleSyncSalesSortKey({
  event,
  container,
}: SubscriberArgs<OrderEventData>) {
  const logger = container.resolve('logger');
  const orderId = event.data.id;

  try {
    const items = await getOrderItems(orderId, container);

    if (items.length === 0) {
      logger.info(`[sync-sales-sort-key] 주문에 아이템 없음: orderId=${orderId}`);
      return;
    }

    const productQuantities = new Map<string, number>();

    for (const item of items) {
      if (!item.product_id) continue;

      const current = productQuantities.get(item.product_id) ?? 0;
      productQuantities.set(item.product_id, current + item.quantity);
    }

    for (const [productId, quantity] of productQuantities) {
      await incrementSalesSortKey(productId, quantity, container);
      logger.info(`[sync-sales-sort-key] 판매량 증가: productId=${productId}, quantity=${quantity}`);
    }

    logger.info(`[sync-sales-sort-key] 주문 처리 완료: orderId=${orderId}`);
  } catch (error) {
    logger.error(`[sync-sales-sort-key] order.placed 처리 실패 (orderId: ${orderId}):`, error);
  }
}

export const config: SubscriberConfig = {
  event: ['order.placed'],
  context: {
    subscriberId: 'sync-sales-sort-key-handler',
  },
};
