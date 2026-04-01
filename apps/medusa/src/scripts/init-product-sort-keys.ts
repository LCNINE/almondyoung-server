/**
 * 기존 상품에 대한 ProductSortKey 초기화 스크립트
 *
 * 모든 기존 상품에 대해 ProductSortKey를 생성하고 최저가를 계산합니다.
 *
 * 실행: npx medusa exec ./src/scripts/init-product-sort-keys.ts
 */
import { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { PRODUCT_SORT_MODULE } from '../modules/product-sort';
import type { ProductSortModuleService } from '../modules/product-sort/service';

const KRW_CURRENCY_CODE = 'KRW';
const BATCH_SIZE = 50;

type PriceAmount = {
  amount: number;
  currency_code: string;
  price_list_id?: string | null;
};

type VariantWithPrices = {
  id: string;
  prices?: PriceAmount[];
};

type ProductWithVariants = {
  id: string;
  variants?: VariantWithPrices[];
};

function calculateMinPrice(product: ProductWithVariants): number | null {
  if (!product.variants) return null;

  let minPrice: number | null = null;

  for (const variant of product.variants) {
    if (!variant.prices) continue;

    const basePrices = variant.prices.filter(
      (p) => p.currency_code === KRW_CURRENCY_CODE && !p.price_list_id,
    );

    for (const price of basePrices) {
      if (minPrice === null || price.amount < minPrice) {
        minPrice = price.amount;
      }
    }
  }

  return minPrice;
}

export default async function initProductSortKeys({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const productModule = container.resolve(Modules.PRODUCT);
  const productSortService = container.resolve(PRODUCT_SORT_MODULE) as ProductSortModuleService;
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  logger.info('[init-product-sort-keys] 시작...');

  try {
    const existingKeys = await productSortService.listProductSortKeys({});
    const existingProductIds = new Set(existingKeys.map((k) => k.product_id));

    logger.info(`[init-product-sort-keys] 기존 ProductSortKey 수: ${existingKeys.length}`);

    const products = await productModule.listProducts({}, { select: ['id'] });
    const newProductIds = products.filter((p) => !existingProductIds.has(p.id)).map((p) => p.id);

    logger.info(`[init-product-sort-keys] 초기화할 상품 수: ${newProductIds.length}`);

    let processed = 0;
    let errors = 0;

    for (let i = 0; i < newProductIds.length; i += BATCH_SIZE) {
      const batch = newProductIds.slice(i, i + BATCH_SIZE);

      const { data: productsWithPrices } = await query.graph({
        entity: 'product',
        fields: [
          'id',
          'variants.id',
          'variants.prices.amount',
          'variants.prices.currency_code',
          'variants.prices.price_list_id',
        ],
        filters: { id: batch },
      });

      for (const product of productsWithPrices as ProductWithVariants[]) {
        try {
          const minPrice = calculateMinPrice(product);

          await productSortService.createProductSortKeys({
            product_id: product.id,
            price_sort_key: minPrice,
            sales_sort_key: 0,
            last_synced_at: new Date(),
          });

          processed++;
        } catch (error) {
          logger.error(`[init-product-sort-keys] 상품 ${product.id} 처리 실패:`, error);
          errors++;
        }
      }

      logger.info(
        `[init-product-sort-keys] 진행: ${Math.min(i + BATCH_SIZE, newProductIds.length)}/${newProductIds.length}`,
      );
    }

    logger.info(`[init-product-sort-keys] 완료: 성공=${processed}, 실패=${errors}`);
  } catch (error) {
    logger.error('[init-product-sort-keys] 스크립트 실패:', error);
    throw error;
  }
}
