import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { ContainerRegistrationKeys, QueryContext } from '@medusajs/framework/utils';
import { PRODUCT_SORTING_MODULE } from '../../../modules/product-sorting';
import type ProductSortingModuleService from '../../../modules/product-sorting/service';

type UpdateSortIndexInput = {
  product_id: string;
  currency_code?: string;
};

/** createStep 밖으로 뺀 실행부 — 스킵 조건을 테스트에서 직접 검증하기 위함. */
export const updateSortIndexInvoke = async (
  { product_id, currency_code = 'krw' }: UpdateSortIndexInput,
  { container }: { container: { resolve: <T = any>(key: string) => T } },
) => {
  {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const sortingService = container.resolve<ProductSortingModuleService>(PRODUCT_SORTING_MODULE);
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

    try {
      // status만 먼저 확인한다. 아래 calculated_price 조회는 price list·멤버십 등
      // 가격 규칙을 전부 평가해서 Medusa 에서 가장 비싼 축인데, 스토어프론트에 노출되지 않는
      // draft 상품엔 그 결과가 쓰이지 않는다(/store/products-sorted 가 published 만 조회).
      // 상품을 대량으로 내리면 product.updated 가 그만큼 발생하므로 여기서 걸러야 한다
      const { data: statusRows } = await query.graph({
        entity: 'product',
        fields: ['id', 'status'],
        filters: { id: product_id },
      });
      if (statusRows?.[0]?.status !== 'published') {
        logger.info(`[ProductSorting] Skip sort index for non-published product: ${product_id}`);
        return new StepResponse(null);
      }

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
  }
};

export const updateSortIndexStep = createStep('update-sort-index', updateSortIndexInvoke);
