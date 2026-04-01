/**
 * ProductSortKey 초기화 스크립트
 *
 * 목적:
 * - 기존 모든 상품에 대해 ProductSortKey 레코드 생성
 * - 각 상품의 variant 중 최저 KRW 일반가를 price_sort_key로 설정
 * - Product-ProductSortKey 링크 연결
 *
 * 실행:
 *   yarn medusa exec ./src/scripts/init-product-sort-keys.ts
 *
 * 옵션(환경변수):
 * - DRY_RUN=true: 변경 없이 대상 개수만 출력
 * - BATCH_SIZE: 한 번에 처리할 상품 수 (기본값: 100)
 */
import { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { PRODUCT_SORT_MODULE } from '../modules/product-sort';
import ProductSortModuleService from '../modules/product-sort/service';

const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 100;
const DRY_RUN = process.env.DRY_RUN === 'true';
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

export default async function initProductSortKeys({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const productModule = container.resolve(Modules.PRODUCT);
  const productSortModule = container.resolve<ProductSortModuleService>(PRODUCT_SORT_MODULE);
  const link = container.resolve(ContainerRegistrationKeys.LINK);

  logger.info(`[init-product-sort-keys] Starting... DRY_RUN=${DRY_RUN}`);

  let offset = 0;
  let totalProcessed = 0;
  let totalCreated = 0;
  let totalSkipped = 0;

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
      totalProcessed++;

      const existingKeys = await productSortModule.listProductSortKeys({
        product_id: product.id,
      });

      if (existingKeys.length > 0) {
        totalSkipped++;
        continue;
      }

      const priceSortKey = getLowestRegularPrice(product.variants);

      if (DRY_RUN) {
        logger.info(`[init-product-sort-keys] Would create: product_id=${product.id}, price_sort_key=${priceSortKey}`);
        totalCreated++;
        continue;
      }

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

      totalCreated++;

      if (totalCreated % 50 === 0) {
        logger.info(`[init-product-sort-keys] Progress: ${totalCreated} created...`);
      }
    }

    offset += products.length;
  }

  logger.info(
    `[init-product-sort-keys] Complete. Total=${totalProcessed}, Created=${totalCreated}, Skipped=${totalSkipped}`,
  );
}
