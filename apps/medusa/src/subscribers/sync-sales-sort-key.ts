/**
 * 주문 완료 시 ProductSortKey의 sales_sort_key 동기화
 *
 * 이벤트 구독:
 * - order.placed: 주문 완료 시 판매량 증가
 *
 * 참고: 취소 시에도 판매량 유지 (인기도/관심도 기준)
 */
import { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { type SubscriberArgs, type SubscriberConfig } from '@medusajs/medusa';
import { PRODUCT_SORT_MODULE } from '../modules/product-sort';
import ProductSortModuleService from '../modules/product-sort/service';

type LineItem = {
  id: string;
  product_id: string;
  quantity: number;
};

type OrderData = {
  id: string;
  items?: LineItem[];
};

async function getOrderItems(orderId: string, container: MedusaContainer): Promise<LineItem[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const { data } = await query.graph({
    entity: 'order',
    fields: ['id', 'items.id', 'items.product_id', 'items.quantity'],
    filters: { id: orderId },
  });

  const order = (data?.[0] as OrderData) ?? null;
  return order?.items ?? [];
}

async function updateSalesSortKey(productId: string, quantityDelta: number, container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const productSortModule: ProductSortModuleService = container.resolve(PRODUCT_SORT_MODULE);
  const link = container.resolve(ContainerRegistrationKeys.LINK);

  try {
    const existingKeys = await productSortModule.listProductSortKeys({
      product_id: productId,
    });

    if (existingKeys.length > 0) {
      const currentSales = Number(existingKeys[0].sales_sort_key) || 0;
      const newSales = Math.max(0, currentSales + quantityDelta);

      await productSortModule.updateProductSortKeys([
        {
          id: existingKeys[0].id,
          sales_sort_key: newSales,
        },
      ]);

      logger.info(
        `[sync-sales-sort-key] Updated sales_sort_key for product ${productId}: ${currentSales} -> ${newSales}`,
      );
    } else {
      const newSales = Math.max(0, quantityDelta);

      const [sortKey] = await productSortModule.createProductSortKeys([
        {
          product_id: productId,
          price_sort_key: null,
          sales_sort_key: newSales,
          last_synced_at: new Date(),
        },
      ]);

      await link.create({
        [Modules.PRODUCT]: {
          product_id: productId,
        },
        [PRODUCT_SORT_MODULE]: {
          product_sort_key_id: sortKey.id,
        },
      });

      logger.info(`[sync-sales-sort-key] Created ProductSortKey for product ${productId} with sales: ${newSales}`);
    }
  } catch (error) {
    logger.error(`[sync-sales-sort-key] Failed to update sales for product ${productId}:`, error as Error);
  }
}

export default async function handleSalesSortKeySync({ event, container }: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const orderId = event.data.id;
  const eventName = event.name;

  logger.info(`[sync-sales-sort-key] Received event: ${eventName}, order: ${orderId}`);

  try {
    const items = await getOrderItems(orderId, container);

    if (items.length === 0) {
      logger.info(`[sync-sales-sort-key] No items found for order ${orderId}`);
      return;
    }

    const productQuantities = new Map<string, number>();

    for (const item of items) {
      if (!item.product_id) {
        continue;
      }

      const currentQty = productQuantities.get(item.product_id) || 0;
      productQuantities.set(item.product_id, currentQty + item.quantity);
    }

    for (const [productId, quantityDelta] of productQuantities) {
      await updateSalesSortKey(productId, quantityDelta, container);
    }

    logger.info(
      `[sync-sales-sort-key] Processed ${productQuantities.size} product(s) for order ${orderId} (${eventName})`,
    );
  } catch (error) {
    logger.error(`[sync-sales-sort-key] Failed to process order ${orderId}:`, error);
  }
}

export const config: SubscriberConfig = {
  event: ['order.placed'],
  context: {
    subscriberId: 'sync-sales-sort-key',
  },
};
