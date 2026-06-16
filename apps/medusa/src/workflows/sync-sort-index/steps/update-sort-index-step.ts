import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { ContainerRegistrationKeys, QueryContext } from '@medusajs/framework/utils';
import { PRODUCT_SORTING_MODULE } from '../../../modules/product-sorting';
import type ProductSortingModuleService from '../../../modules/product-sorting/service';

type UpdateSortIndexInput = {
  product_id: string;
  currency_code?: string;
};

export const updateSortIndexStep = createStep(
  'update-sort-index',
  async ({ product_id, currency_code = 'krw' }: UpdateSortIndexInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const sortingService = container.resolve<ProductSortingModuleService>(PRODUCT_SORTING_MODULE);
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

    try {
      const { data: products } = await query.graph({
        entity: 'product',
        fields: ['id', 'variants.id', 'variants.calculated_price.calculated_amount'],
        filters: { id: product_id },
        context: {
          variants: {
            calculated_price: QueryContext({ currency_code }),
          },
        },
      });

      if (!products || products.length === 0) {
        logger.warn(`[ProductSorting] Product not found: ${product_id}`);
        return new StepResponse(null);
      }

      const product = products[0];
      const variants = (product as any).variants || [];

      const prices: number[] = [];
      for (const variant of variants) {
        const calculatedAmount = variant.calculated_price?.calculated_amount;
        if (calculatedAmount !== undefined && calculatedAmount !== null) {
          prices.push(Number(calculatedAmount));
        }
      }

      if (prices.length === 0) {
        logger.info(`[ProductSorting] No prices found for product: ${product_id}`);
        return new StepResponse(null);
      }

      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);

      const result = await sortingService.upsertSortIndex({
        product_id,
        currency_code,
        min_price: minPrice,
        max_price: maxPrice,
      });

      logger.info(`[ProductSorting] Sort index updated for product: ${product_id}, min: ${minPrice}, max: ${maxPrice}`);

      return new StepResponse(result);
    } catch (error: any) {
      logger.error(`[ProductSorting] Failed to update sort index for product ${product_id}: ${error.message}`);
      throw error;
    }
  },
);
