import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../schema/inventory.schema';
import { productImages, productMasterVariants, productMasterVersions } from '../../../catalog/schema/catalog.schema';

export interface OrderedImageRow {
  ownerId: string;
  fileId: string;
  isPrimary: boolean;
  sortOrder: number;
}

function orderedFileIds(rows: readonly OrderedImageRow[]): Map<string, string[]> {
  const sorted = [...rows].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder);
  const byOwner = new Map<string, string[]>();

  for (const row of sorted) {
    const ids = byOwner.get(row.ownerId) ?? [];
    ids.push(row.fileId);
    byOwner.set(row.ownerId, ids);
  }

  return byOwner;
}

/** SKU 자체 사진이 있으면 그것을, 없으면 매칭된 쇼핑몰 상품의 사진을 대표 사진부터 쓴다. */
export function pickSkuImageFileIds(
  skuIds: readonly string[],
  skuImageRows: readonly OrderedImageRow[],
  versionBySku: ReadonlyMap<string, string>,
  productImageRows: readonly OrderedImageRow[],
): Map<string, string[]> {
  const ownImages = orderedFileIds(skuImageRows);
  const productImagesByVersion = orderedFileIds(productImageRows);
  const result = new Map<string, string[]>();

  for (const skuId of skuIds) {
    const own = ownImages.get(skuId);

    if (own && own.length > 0) {
      result.set(skuId, own);
      continue;
    }

    const versionId = versionBySku.get(skuId);
    result.set(skuId, versionId ? (productImagesByVersion.get(versionId) ?? []) : []);
  }

  return result;
}

export async function readSkuImageFileIds(tx: DbTx, skuIds: readonly string[]): Promise<Map<string, string[]>> {
  const ids = [...new Set(skuIds)];

  if (ids.length === 0) {
    return new Map();
  }

  const skuImageRows = await tx
    .select({
      ownerId: wmsTables.skuImages.skuId,
      fileId: wmsTables.skuImages.uploadId,
      isPrimary: wmsTables.skuImages.isPrimary,
      sortOrder: wmsTables.skuImages.sortOrder,
    })
    .from(wmsTables.skuImages)
    .where(inArray(wmsTables.skuImages.skuId, ids));

  const withOwnImages = new Set(skuImageRows.map((row) => row.ownerId));
  const needProduct = ids.filter((id) => !withOwnImages.has(id));

  // 재고 현황 화면과 같은 규칙: 매칭된 활성 상품 중 대표 사진이 있는 것, 그다음 먼저 만든 것.
  const versions =
    needProduct.length === 0
      ? []
      : await tx
          .selectDistinctOn([wmsTables.productVariantSkuLinks.skuId], {
            skuId: wmsTables.productVariantSkuLinks.skuId,
            versionId: productMasterVersions.id,
          })
          .from(wmsTables.productVariantSkuLinks)
          .innerJoin(
            wmsTables.productMatchings,
            eq(wmsTables.productMatchings.id, wmsTables.productVariantSkuLinks.productMatchingId),
          )
          .innerJoin(productMasterVariants, eq(productMasterVariants.variantId, wmsTables.productMatchings.variantId))
          .innerJoin(productMasterVersions, eq(productMasterVersions.id, productMasterVariants.versionId))
          .leftJoin(
            productImages,
            and(eq(productImages.versionId, productMasterVersions.id), eq(productImages.isPrimary, true)),
          )
          .where(
            and(
              inArray(wmsTables.productVariantSkuLinks.skuId, needProduct),
              eq(productMasterVersions.status, 'active'),
              isNull(productMasterVersions.deletedAt),
            ),
          )
          .orderBy(
            wmsTables.productVariantSkuLinks.skuId,
            sql`${productImages.fileId} is null`,
            productMasterVersions.createdAt,
            productMasterVersions.id,
          );

  const versionIds = [...new Set(versions.map((row) => row.versionId))];
  const productImageRows =
    versionIds.length === 0
      ? []
      : await tx
          .select({
            ownerId: productImages.versionId,
            fileId: productImages.fileId,
            isPrimary: productImages.isPrimary,
            sortOrder: productImages.sortOrder,
          })
          .from(productImages)
          .where(inArray(productImages.versionId, versionIds))
          .orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder));

  return pickSkuImageFileIds(
    ids,
    skuImageRows,
    new Map(versions.map((row) => [row.skuId, row.versionId])),
    productImageRows,
  );
}
