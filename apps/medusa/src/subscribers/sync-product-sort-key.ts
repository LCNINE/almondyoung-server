/**
 * 상품/Variant 이벤트 시 ProductSortKey의 price_sort_key 동기화
 *
 * 이벤트 구독:
 * - product.created: 상품 생성 시 ProductSortKey 생성
 * - product.updated: 상품 수정 시 가격 재계산
 * - product-variant.created: Variant 생성 시 가격 재계산
 * - product-variant.updated: Variant 가격 변경 시 가격 재계산
 */
import { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { type SubscriberArgs, type SubscriberConfig } from '@medusajs/medusa';
import { PRODUCT_SORT_MODULE } from '../modules/product-sort';
import ProductSortModuleService from '../modules/product-sort/service';

const KRW_CURRENCY_CODE = 'krw';

type PriceData = {
  amount: number;
  currency_code: string;
  price_list_id: string | null;
};

type VariantData = {
  id: string;
  product_id?: string;
  prices?: PriceData[];
};

type ProductData = {
  id: string;
  variants?: VariantData[];
};

function getLowestRegularPrice(variants: VariantData[] | undefined): number | null {
  if (!variants || variants.length === 0) {
    return null;
  }

  let lowestPrice: number | null = null;

  for (const variant of variants) {
    if (!variant.prices) {
      continue;
    }

    for (const price of variant.prices) {
      if (price.currency_code !== KRW_CURRENCY_CODE) {
        continue;
      }

      if (price.price_list_id) {
        continue;
      }

      if (lowestPrice === null || price.amount < lowestPrice) {
        lowestPrice = price.amount;
      }
    }
  }

  return lowestPrice;
}

async function syncPriceSortKey(productId: string, container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const productModule = container.resolve(Modules.PRODUCT);
  const productSortModule: ProductSortModuleService = container.resolve(PRODUCT_SORT_MODULE);
  const link = container.resolve(ContainerRegistrationKeys.LINK);

  try {
    const product = (await productModule.retrieveProduct(productId, {
      relations: ['variants', 'variants.prices'],
    })) as ProductData;

    const priceSortKey = getLowestRegularPrice(product.variants);

    const existingKeys = await productSortModule.listProductSortKeys({
      product_id: productId,
    });

    if (existingKeys.length > 0) {
      await productSortModule.updateProductSortKeys([
        {
          id: existingKeys[0].id,
          price_sort_key: priceSortKey,
          last_synced_at: new Date(),
        },
      ]);
      logger.info(`[sync-product-sort-key] Updated price_sort_key for product ${productId}: ${priceSortKey}`);
    } else {
      const [sortKey] = await productSortModule.createProductSortKeys([
        {
          product_id: productId,
          price_sort_key: priceSortKey,
          sales_sort_key: 0,
          last_synced_at: new Date(),
        },
      ]);

      await link.create({
        [Modules.PRODUCT]: {
          product_id: productId,
        },
        [PRODUCT_SORT_MODULE]: {
          product_sort_key_id: sortKey.id,
        },
      });

      logger.info(`[sync-product-sort-key] Created ProductSortKey for product ${productId}: ${priceSortKey}`);
    }
  } catch (error: any) {
    logger.error(`[sync-product-sort-key] Failed to sync product ${productId}:`, error);
  }
}

export default async function handleProductSortKeySync({
  event,
  container,
}: SubscriberArgs<{ id: string; product_id?: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const eventName = event.name;
  const eventData = event.data;

  logger.info(`[sync-product-sort-key] Received event: ${eventName}`);

  let productId: string | undefined;

  if (eventName.startsWith('product-variant.')) {
    productId = eventData.product_id;

    if (!productId) {
      const productModule = container.resolve(Modules.PRODUCT);
      try {
        const variant = (await productModule.retrieveProductVariant(eventData.id, {
          select: ['product_id'],
        })) as VariantData;
        productId = variant.product_id;
      } catch {
        logger.warn(`[sync-product-sort-key] Could not find variant ${eventData.id}`);
        return;
      }
    }
  } else {
    productId = eventData.id;
  }

  if (!productId) {
    logger.warn(`[sync-product-sort-key] No product_id found for event ${eventName}`);
    return;
  }

  await syncPriceSortKey(productId, container);
}

export const config: SubscriberConfig = {
  event: ['product.created', 'product.updated', 'product-variant.created', 'product-variant.updated'],
  context: {
    subscriberId: 'sync-product-sort-key',
  },
};
