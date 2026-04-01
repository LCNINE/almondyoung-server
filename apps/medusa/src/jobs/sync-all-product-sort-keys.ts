/**
 * ProductSortKey 전체 동기화 크론잡
 *
 * 매일 새벽 3시에 실행되어 모든 상품의 정렬 키를 동기화합니다.
 * - price_sort_key: 모든 상품의 variant 최저 일반가 재계산
 * - sales_sort_key: 주문 데이터 기반 판매량 재집계
 *
 * Subscriber 누락 케이스를 보완합니다.
 */
import { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { PRODUCT_SORT_MODULE } from '../modules/product-sort';
import ProductSortModuleService from '../modules/product-sort/service';

const BATCH_SIZE = 100;
const KRW_CURRENCY_CODE = 'krw';

type PriceData = {
  amount: number;
  currency_code: string;
  price_list_id: string | null;
};

type VariantData = {
  id: string;
  prices?: PriceData[];
};

type ProductData = {
  id: string;
  variants?: VariantData[];
};

type LineItem = {
  product_id: string;
  quantity: number;
};

type OrderData = {
  id: string;
  status: string;
  items?: LineItem[];
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

async function syncPriceSortKeys(container: MedusaContainer): Promise<number> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const productModule = container.resolve(Modules.PRODUCT);
  const productSortModule = container.resolve<ProductSortModuleService>(PRODUCT_SORT_MODULE);
  const link = container.resolve(ContainerRegistrationKeys.LINK);

  let offset = 0;
  let totalSynced = 0;

  while (true) {
    const products = (await productModule.listProducts(
      {},
      {
        select: ['id'],
        relations: ['variants', 'variants.prices'],
        take: BATCH_SIZE,
        skip: offset,
      },
    )) as ProductData[];

    if (products.length === 0) {
      break;
    }

    for (const product of products) {
      const priceSortKey = getLowestRegularPrice(product.variants);

      const existingKeys = await productSortModule.listProductSortKeys({
        product_id: product.id,
      });

      if (existingKeys.length > 0) {
        await productSortModule.updateProductSortKeys([
          {
            id: existingKeys[0].id,
            price_sort_key: priceSortKey,
            last_synced_at: new Date(),
          },
        ]);
      } else {
        const [sortKey] = await productSortModule.createProductSortKeys([
          {
            product_id: product.id,
            price_sort_key: priceSortKey,
            sales_sort_key: 0,
            last_synced_at: new Date(),
          },
        ]);

        await link.create({
          [Modules.PRODUCT]: {
            product_id: product.id,
          },
          [PRODUCT_SORT_MODULE]: {
            product_sort_key_id: sortKey.id,
          },
        });
      }

      totalSynced++;
    }

    offset += products.length;
    logger.info(`[sync-all-product-sort-keys] Price sync progress: ${totalSynced} products...`);
  }

  return totalSynced;
}

async function syncSalesSortKeys(container: MedusaContainer): Promise<number> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const productSortModule = container.resolve<ProductSortModuleService>(PRODUCT_SORT_MODULE);

  const { data: orders } = await query.graph({
    entity: 'order',
    fields: ['id', 'status', 'items.product_id', 'items.quantity'],
    filters: {
      status: { $nin: ['canceled', 'requires_action'] },
    },
  });

  const salesByProduct = new Map<string, number>();

  for (const order of orders as OrderData[]) {
    if (!order.items) {
      continue;
    }

    for (const item of order.items) {
      if (!item.product_id) {
        continue;
      }

      const currentSales = salesByProduct.get(item.product_id) || 0;
      salesByProduct.set(item.product_id, currentSales + item.quantity);
    }
  }

  let totalSynced = 0;

  for (const [productId, totalSales] of salesByProduct) {
    const existingKeys = await productSortModule.listProductSortKeys({
      product_id: productId,
    });

    if (existingKeys.length > 0) {
      await productSortModule.updateProductSortKeys([
        {
          id: existingKeys[0].id,
          sales_sort_key: totalSales,
        },
      ]);
      totalSynced++;
    }
  }

  logger.info(`[sync-all-product-sort-keys] Sales sync complete: ${totalSynced} products updated`);

  return totalSynced;
}

export default async function syncAllProductSortKeys(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  logger.info('[sync-all-product-sort-keys] Starting full sync...');

  try {
    const priceSynced = await syncPriceSortKeys(container);
    logger.info(`[sync-all-product-sort-keys] Price sync complete: ${priceSynced} products`);

    const salesSynced = await syncSalesSortKeys(container);
    logger.info(`[sync-all-product-sort-keys] Sales sync complete: ${salesSynced} products`);

    logger.info('[sync-all-product-sort-keys] Full sync completed successfully');
  } catch (error: any) {
    logger.error('[sync-all-product-sort-keys] Sync failed:', error);
  }
}

export const config = {
  name: 'sync-all-product-sort-keys',
  schedule: '0 3 * * *',
};
