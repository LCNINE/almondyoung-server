import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  DbTransaction,
  ProductImage,
  ProductMasterVersion,
  ProductVariant,
  PurchaseConstraintReadModel,
} from '../../../catalog.types';
import {
  productCategories,
  productImages,
  productMasterCategories,
  productMasterPurchaseConstraints,
  productMasterVariants,
  productMasterVersions,
  productMasters,
  productPurchaseConstraints,
  productVariants,
  variantOptionValues,
} from '../../../schema/catalog.schema';

export type ProductVersionCategoryFragment = {
  id: string;
  name: string;
  slug: string;
  path: string;
  parentId: string | null;
  isActive: boolean;
  visibility: boolean;
  showOnMainCategory: boolean;
  thumbnailFileId: string | null;
  isPrimary: boolean;
};

export type ProductVersionVariantFragment = ProductVariant & {
  optionValueIds: string[];
};

@Injectable()
export class ProductVersionReadLoader {
  async getVersionById(tx: DbTransaction, versionId: string): Promise<ProductMasterVersion> {
    const [version] = await tx.select().from(productMasterVersions).where(eq(productMasterVersions.id, versionId)).limit(1);

    if (!version) {
      throw new NotFoundException(`Version ${versionId} not found`);
    }

    return version;
  }

  async getActiveVersion(tx: DbTransaction, masterId: string): Promise<ProductMasterVersion> {
    const result = await tx
      .select()
      .from(productMasterVersions)
      .innerJoin(productMasters, eq(productMasterVersions.masterId, productMasters.id))
      .where(
        and(
          eq(productMasterVersions.masterId, masterId),
          eq(productMasterVersions.status, 'active'),
          isNull(productMasters.deletedAt),
          isNull(productMasterVersions.deletedAt),
        ),
      )
      .limit(1);

    if (result.length === 0) {
      throw new NotFoundException(`No active version found for master ${masterId}`);
    }

    return result[0].product_master_versions;
  }

  async getCategories(
    tx: DbTransaction,
    masterId: string,
    versionId: string,
  ): Promise<ProductVersionCategoryFragment[]> {
    const rows = await tx
      .select({
        id: productCategories.id,
        name: productCategories.name,
        slug: productCategories.slug,
        path: productCategories.path,
        parentId: productCategories.parentId,
        isActive: productCategories.isActive,
        visibility: productCategories.visibility,
        displaySettings: productCategories.displaySettings,
        thumbnailFileId: productCategories.imageUrl,
        isPrimary: productMasterCategories.isPrimary,
      })
      .from(productMasterCategories)
      .innerJoin(productCategories, eq(productMasterCategories.categoryId, productCategories.id))
      .where(and(eq(productMasterCategories.masterId, masterId), eq(productMasterCategories.versionId, versionId)))
      .orderBy(desc(productMasterCategories.isPrimary), asc(productCategories.path), asc(productCategories.name));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      path: row.path,
      parentId: row.parentId,
      isActive: row.isActive,
      visibility: row.visibility,
      showOnMainCategory: row.displaySettings?.showOnMainCategory ?? false,
      thumbnailFileId: row.thumbnailFileId,
      isPrimary: row.isPrimary,
    }));
  }

  async getVariants(tx: DbTransaction, masterId: string, versionId: string): Promise<ProductVersionVariantFragment[]> {
    const rows = await tx
      .select()
      .from(productMasterVariants)
      .innerJoin(productVariants, eq(productMasterVariants.variantId, productVariants.id))
      .where(and(eq(productMasterVariants.masterId, masterId), eq(productMasterVariants.versionId, versionId)))
      .orderBy(asc(productVariants.displayOrder));

    const variants = rows.map((row) => row.product_variants);

    if (variants.length === 0) {
      return [];
    }

    const variantIds = variants.map((variant) => variant.id);
    const optionRows = await tx
      .select({
        variantId: variantOptionValues.variantId,
        optionValueId: variantOptionValues.optionValueId,
      })
      .from(variantOptionValues)
      .where(inArray(variantOptionValues.variantId, variantIds));

    const optionValueIdsByVariant = new Map<string, string[]>();
    for (const variantId of variantIds) {
      optionValueIdsByVariant.set(variantId, []);
    }
    for (const row of optionRows) {
      optionValueIdsByVariant.get(row.variantId)?.push(row.optionValueId);
    }

    return variants.map((variant) => ({
      ...variant,
      optionValueIds: optionValueIdsByVariant.get(variant.id) ?? [],
    }));
  }

  async getImages(tx: DbTransaction, versionId: string): Promise<ProductImage[]> {
    return tx
      .select()
      .from(productImages)
      .where(eq(productImages.versionId, versionId))
      .orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder));
  }

  async getPurchaseConstraint(
    tx: DbTransaction,
    masterId: string,
    versionId: string,
  ): Promise<PurchaseConstraintReadModel | null> {
    const [row] = await tx
      .select({
        id: productPurchaseConstraints.id,
        requiresMembership: productPurchaseConstraints.requiresMembership,
        lifetimeQuantityLimit: productPurchaseConstraints.lifetimeQuantityLimit,
      })
      .from(productMasterPurchaseConstraints)
      .innerJoin(
        productPurchaseConstraints,
        eq(productMasterPurchaseConstraints.purchaseConstraintId, productPurchaseConstraints.id),
      )
      .where(
        and(
          eq(productMasterPurchaseConstraints.masterId, masterId),
          eq(productMasterPurchaseConstraints.versionId, versionId),
        ),
      )
      .limit(1);

    return row ?? null;
  }
}
