import { type SubscriberConfig, type SubscriberArgs } from '@medusajs/medusa';
import { syncPriceSortIndexWorkflow } from '../workflows/sync-sort-index/workflows/sync-price-sort-index';

export default async function handleProductPriceUpdated({ event, container }: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve('logger');
  const productId = event.data.id;

  try {
    await syncPriceSortIndexWorkflow(container).run({
      input: { product_id: productId },
    });
    logger.info(`[ProductSorting] Price sync completed for product: ${productId}`);
  } catch (err: any) {
    logger.error(`[ProductSorting] Price sync failed for product ${productId}: ${err?.message}`);
  }
}

export const config: SubscriberConfig = {
  event: ['product.created', 'product.updated'],
  context: {
    subscriberId: 'product-price-updated-handler',
  },
};
