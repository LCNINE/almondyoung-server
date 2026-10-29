import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';
import { DbTransaction } from '../../../catalog.types';
import { productMasterVariants, productVariants } from '../../../schema/catalog.schema';
import {
  productMatchings,
  productVariantSkuLinks,
  sku3dModels,
  skus,
} from '../../../../inventory/schema/inventory.schema';

@Injectable()
export class ProductModel3dLoader {
  async getFileId(tx: DbTransaction, masterId: string, versionId: string): Promise<string | undefined> {
    // 상품 버전의 variant → 매칭 → 실물 SKU 경로에서 고객에게 노출 가능한 GLB만 고른다.
    const [selected] = await tx
      .select({ fileId: sku3dModels.glbFileId })
      .from(productMasterVariants)
      .innerJoin(productVariants, eq(productVariants.id, productMasterVariants.variantId))
      .innerJoin(productMatchings, eq(productMatchings.variantId, productVariants.id))
      .innerJoin(productVariantSkuLinks, eq(productVariantSkuLinks.productMatchingId, productMatchings.id))
      .innerJoin(skus, eq(skus.id, productVariantSkuLinks.skuId))
      .innerJoin(sku3dModels, eq(sku3dModels.skuId, skus.id))
      .where(
        and(
          eq(productMasterVariants.masterId, masterId),
          eq(productMasterVariants.versionId, versionId),
          eq(productVariants.status, 'active'),
          eq(skus.isDeleted, false),
          eq(sku3dModels.status, 'approved'),
          isNotNull(sku3dModels.glbFileId),
        ),
      )
      // 앞선 옵션의 최신 승인 버전을 쓰고, 동일 순서는 ID로 고정해 선택이 흔들리지 않게 한다.
      .orderBy(
        asc(productVariants.displayOrder),
        asc(productVariants.id),
        asc(sku3dModels.skuId),
        desc(sku3dModels.version),
      )
      .limit(1);

    return selected?.fileId ?? undefined;
  }
}
