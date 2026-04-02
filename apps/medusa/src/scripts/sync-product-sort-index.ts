import type { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { PRODUCT_SORTING_MODULE } from '../modules/product-sorting';
import type ProductSortingModuleService from '../modules/product-sorting/service';

type ProductWithVariants = {
  id: string;
  variants?: Array<{
    id: string;
    price_set?: { id: string };
  }>;
};

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const [key, value] = arg.split('=');
    if (key && value) {
      result[key.replace(/^--?/, '')] = value;
    }
  }
  return result;
}

export default async function syncProductSortIndex({ container, args = [] }: ExecArgs) {
  const sortingService = container.resolve<ProductSortingModuleService>(PRODUCT_SORTING_MODULE);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const pricingModule = container.resolve(Modules.PRICING);

  const parsedArgs = parseArgs(args);
  const currencyCode = parsedArgs.currency_code || 'krw';
  const batchSize = parseInt(parsedArgs.batch_size || '100', 10);

  console.log(`[ProductSorting] Starting full sync with currency: ${currencyCode}, batch_size: ${batchSize}`);

  let offset = 0;
  let totalSynced = 0;
  let totalSkipped = 0;

  try {
    while (true) {
      const { data: products } = await query.graph({
        entity: 'product',
        fields: ['id', 'variants.id', 'variants.price_set.id'],
        pagination: {
          take: batchSize,
          skip: offset,
        },
      });

      if (!products || products.length === 0) {
        break;
      }

      for (const product of products as ProductWithVariants[]) {
        const variants = product.variants || [];
        const priceSetIds: string[] = [];

        for (const variant of variants) {
          if (variant.price_set?.id) {
            priceSetIds.push(variant.price_set.id);
          }
        }

        if (priceSetIds.length === 0) {
          totalSkipped++;
          continue;
        }

        const calculatedPrices = await pricingModule.calculatePrices(
          { id: priceSetIds },
          { context: { currency_code: currencyCode } },
        );

        const prices: number[] = [];
        for (const cp of calculatedPrices) {
          if (cp.calculated_amount !== undefined && cp.calculated_amount !== null) {
            prices.push(Number(cp.calculated_amount));
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

      console.log(`[ProductSorting] Progress: synced=${totalSynced}, skipped=${totalSkipped}, offset=${offset}`);
      offset += batchSize;

      if (products.length < batchSize) {
        break;
      }
    }

    console.log(`[ProductSorting] ✅ Full sync completed!`);
    console.log(`[ProductSorting] Synced: ${totalSynced}, Skipped (no price): ${totalSkipped}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[ProductSorting] ❌ Sync failed: ${message}`);
    throw error;
  }
}
