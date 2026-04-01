import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { type SubscriberConfig, type SubscriberArgs } from '@medusajs/medusa';
import { PRODUCT_SORT_MODULE } from '../modules/product-sort';
import type { ProductSortModuleService } from '../modules/product-sort/service';

type ProductEventData = {
  id: string;
};

type VariantEventData = {
  id: string;
  product_id?: string;
};

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

const KRW_CURRENCY_CODE = 'KRW';

async function getProductIdFromVariant(variantId: string, container: any): Promise<string | null> {
  const productModule = container.resolve(Modules.PRODUCT);
  try {
    const variant = await productModule.retrieveProductVariant(variantId, {
      select: ['product_id'],
    });
    return variant?.product_id ?? null;
  } catch {
    return null;
  }
}

async function calculateMinPriceForProduct(productId: string, container: any): Promise<number | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  try {
    const { data } = await query.graph({
      entity: 'product',
      fields: ['id', 'variants.id', 'variants.prices.amount', 'variants.prices.currency_code', 'variants.prices.price_list_id'],
      filters: { id: productId },
    });

    const product = data?.[0] as ProductWithVariants | undefined;
    if (!product?.variants) {
      return null;
    }

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
  } catch (error) {
    console.error(`[sync-product-sort-key] 가격 계산 실패 (productId: ${productId}):`, error);
    return null;
  }
}

async function upsertProductSortKey(
  productId: string,
  priceSortKey: number | null,
  container: any,
): Promise<void> {
  const productSortService = container.resolve(PRODUCT_SORT_MODULE) as ProductSortModuleService;

  try {
    const existing = await productSortService.listProductSortKeys({
      product_id: productId,
    });

    if (existing.length > 0) {
      await productSortService.updateProductSortKeys({
        id: existing[0].id,
        price_sort_key: priceSortKey,
        last_synced_at: new Date(),
      });
    } else {
      await productSortService.createProductSortKeys({
        product_id: productId,
        price_sort_key: priceSortKey,
        sales_sort_key: 0,
        last_synced_at: new Date(),
      });
    }
  } catch (error) {
    console.error(`[sync-product-sort-key] upsert 실패 (productId: ${productId}):`, error);
    throw error;
  }
}

export default async function handleSyncProductSortKey({
  event,
  container,
}: SubscriberArgs<ProductEventData | VariantEventData>) {
  const logger = container.resolve('logger');
  const eventName = event.name;

  try {
    let productId: string | undefined;

    if (eventName.startsWith('product.')) {
      productId = (event.data as ProductEventData).id;
    } else if (eventName.startsWith('product-variant.')) {
      const variantData = event.data as VariantEventData;
      productId = variantData.product_id ?? (await getProductIdFromVariant(variantData.id, container)) ?? undefined;
    }

    if (!productId) {
      logger.warn(`[sync-product-sort-key] productId를 찾을 수 없음: ${eventName}`);
      return;
    }

    const minPrice = await calculateMinPriceForProduct(productId, container);

    await upsertProductSortKey(productId, minPrice, container);

    logger.info(`[sync-product-sort-key] 동기화 완료: productId=${productId}, minPrice=${minPrice}`);
  } catch (error) {
    logger.error(`[sync-product-sort-key] ${eventName} 처리 실패:`, error);
  }
}

export const config: SubscriberConfig = {
  event: [
    'product.created',
    'product.updated',
    'product-variant.created',
    'product-variant.updated',
  ],
  context: {
    subscriberId: 'sync-product-sort-key-handler',
  },
};
