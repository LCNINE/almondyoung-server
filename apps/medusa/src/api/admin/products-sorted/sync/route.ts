import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { PRODUCT_SORTING_MODULE } from '../../../../modules/product-sorting';
import type ProductSortingModuleService from '../../../../modules/product-sorting/service';

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
  const sortingService = req.scope.resolve<ProductSortingModuleService>(PRODUCT_SORTING_MODULE);
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const currencyCode = (req.query.currency_code as string) || 'krw';
  const batchSize = parseInt(req.query.batch_size as string) || 100;

  logger.info(`[ProductSorting] Starting full sync with currency: ${currencyCode}`);

  let offset = 0;
  let totalSynced = 0;
  let totalSkipped = 0;

  try {
    while (true) {
      const { data: products } = await query.graph({
        entity: 'product',
        fields: ['id', 'variants.id', 'variants.calculated_price.calculated_amount'],
        pagination: {
          take: batchSize,
          skip: offset,
        },
        context: {
          currency_code: currencyCode,
        },
      });

      if (!products || products.length === 0) {
        break;
      }

      for (const product of products) {
        const variants = (product as any).variants || [];
        const prices: number[] = [];

        for (const variant of variants) {
          const calculatedAmount = variant.calculated_price?.calculated_amount;
          if (calculatedAmount !== undefined && calculatedAmount !== null) {
            prices.push(Number(calculatedAmount));
          }
        }

        if (prices.length === 0) {
          totalSkipped++;
          continue;
        }

        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);

        await sortingService.upsertSortIndex({
          product_id: product.id,
          currency_code: currencyCode,
          min_price: minPrice,
          max_price: maxPrice,
        });

        totalSynced++;
      }

      logger.info(`[ProductSorting] Synced batch: offset=${offset}, count=${products.length}`);
      offset += batchSize;

      if (products.length < batchSize) {
        break;
      }
    }

    logger.info(`[ProductSorting] Full sync completed. Synced: ${totalSynced}, Skipped: ${totalSkipped}`);

    res.json({
      success: true,
      synced: totalSynced,
      skipped: totalSkipped,
      currency_code: currencyCode,
    });
  } catch (error: any) {
    logger.error(`[ProductSorting] Sync failed: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
