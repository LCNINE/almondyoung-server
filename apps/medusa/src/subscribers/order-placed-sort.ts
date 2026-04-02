import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { type SubscriberConfig, type SubscriberArgs } from '@medusajs/medusa';
import { PRODUCT_SORTING_MODULE } from '../modules/product-sorting';
import type ProductSortingModuleService from '../modules/product-sorting/service';

type OrderItem = {
  id: string;
  product_id: string;
  quantity: number;
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
      fields: ['id', 'items.id', 'items.product_id', 'items.quantity'],
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
        productQuantityMap.set(item.product_id, current + (item.quantity || 1));
      }
    }

    for (const [productId, quantity] of productQuantityMap) {
      await sortingService.incrementSalesCount(productId, 'krw', quantity);
      logger.info(`[ProductSorting] Sales count incremented for product ${productId} by ${quantity}`);
    }
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
