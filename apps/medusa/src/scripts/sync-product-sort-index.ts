import type { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import postgres from 'postgres';
import { PRODUCT_SORTING_MODULE } from '../modules/product-sorting';
import type ProductSortingModuleService from '../modules/product-sorting/service';

type ProductWithVariants = {
  id: string;
  handle: string;
  variants?: Array<{
    id: string;
    price_set?: { id: string };
  }>;
};

// ugc DB(UGC_SOURCE_DB_URL)에서 product별 active 리뷰 수를 집계해 Map<handle, count>로 반환.
// ugc reviews.product_id 는 master_id = medusa product.handle 이다.
// Medusa 는 Kafka 를 직접 소비하지 못하므로, 이 주기 동기화가 product_sort_index.review_count 의 적재 경로다.
async function loadReviewCounts(): Promise<Map<string, number>> {
  const ugcUrl = process.env.UGC_SOURCE_DB_URL;
  if (!ugcUrl) {
    console.warn('[ProductSorting] UGC_SOURCE_DB_URL 미설정 — review_count 동기화 건너뜀 (가격만 동기화)');
    return new Map();
  }
  const sql = postgres(ugcUrl);
  try {
    const rows = await sql<{ product_id: string; count: number }[]>`
      SELECT product_id, COUNT(*)::int AS count
      FROM reviews
      WHERE status = 'active' AND deleted_at IS NULL
      GROUP BY product_id`;
    const map = new Map<string, number>(rows.map((r) => [r.product_id, r.count]));
    console.log(`[ProductSorting] ugc 리뷰 수 로드: ${map.size} products`);
    return map;
  } finally {
    await sql.end();
  }
}

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

  const reviewCounts = await loadReviewCounts();

  let offset = 0;
  let totalSynced = 0;
  let totalSkipped = 0;

  try {
    while (true) {
      const { data: products } = await query.graph({
        entity: 'product',
        fields: ['id', 'handle', 'variants.id', 'variants.price_set.id'],
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
          review_count: reviewCounts.get(product.handle) ?? 0,
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
