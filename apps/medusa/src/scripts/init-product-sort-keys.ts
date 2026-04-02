/**
 * 기존 상품에 대한 ProductSortKey 초기화 스크립트
 *
 * 모든 기존 상품에 대해 ProductSortKey를 생성하고 최저가를 계산합니다.
 * Product ↔ ProductSortKey 링크도 함께 생성합니다.
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
      (p) => p.currency_code.toUpperCase() === KRW_CURRENCY_CODE && !p.price_list_id,
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
  const link = container.resolve(ContainerRegistrationKeys.LINK);

  logger.info('[init-product-sort-keys] 시작...');

  try {
    const existingKeys = await productSortService.listProductSortKeys({});
    const existingProductIds = new Set(existingKeys.map((k) => k.product_id));
    const existingKeyMap = new Map(existingKeys.map((k) => [k.product_id, k]));

    logger.info(`[init-product-sort-keys] 기존 ProductSortKey 수: ${existingKeys.length}`);

    const products = await productModule.listProducts({}, { select: ['id'] });
    const newProductIds = products.filter((p) => !existingProductIds.has(p.id)).map((p) => p.id);

    logger.info(`[init-product-sort-keys] 초기화할 상품 수: ${newProductIds.length}`);

    let processed = 0;
    let errors = 0;

    // 1. 새 상품에 대해 ProductSortKey + 링크 생성
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

          const sortKey = await productSortService.createProductSortKeys({
            product_id: product.id,
            price_sort_key: minPrice,
            sales_sort_key: 0,
            last_synced_at: new Date(),
          });

          // 링크 생성
          await link.create({
            [Modules.PRODUCT]: { product_id: product.id },
            [PRODUCT_SORT_MODULE]: { product_sort_key_id: sortKey.id },
          });

          processed++;
        } catch (error) {
          logger.error(`[init-product-sort-keys] 상품 ${product.id} 처리 실패:`, error);
          errors++;
        }
      }

      logger.info(
        `[init-product-sort-keys] 새 상품 진행: ${Math.min(i + BATCH_SIZE, newProductIds.length)}/${newProductIds.length}`,
      );
    }

    // 2. 기존 ProductSortKey에 대해 누락된 링크 생성
    logger.info('[init-product-sort-keys] 기존 ProductSortKey 링크 확인 중...');
    let linkedCount = 0;

    for (const [productId, sortKey] of existingKeyMap) {
      try {
        // 링크가 이미 있는지 확인
        const { data: linkedProducts } = await query.graph({
          entity: 'product',
          fields: ['id', 'product_sort_key.id'],
          filters: { id: productId },
        });

        const linkedProduct = linkedProducts?.[0] as { id: string; product_sort_key?: { id: string } } | undefined;

        if (!linkedProduct?.product_sort_key) {
          // 링크 생성
          await link.create({
            [Modules.PRODUCT]: { product_id: productId },
            [PRODUCT_SORT_MODULE]: { product_sort_key_id: sortKey.id },
          });
          linkedCount++;
        }
      } catch (error) {
        logger.error(`[init-product-sort-keys] 링크 생성 실패 (${productId}):`, error);
        errors++;
      }
    }

    logger.info(`[init-product-sort-keys] 완료: 새로생성=${processed}, 링크추가=${linkedCount}, 실패=${errors}`);
  } catch (error) {
    logger.error('[init-product-sort-keys] 스크립트 실패:', error);
    throw error;
  }
}
