import { BadRequestException, Injectable } from '@nestjs/common';
import type { ProductSnapshot } from '@packages/event-contracts';
import { VariantPriceCacheService } from '../../pricing/variant-price-cache.service';
import { DbTransaction, OptionGroupReadModel, VariantOptionValueReadModel } from '../../../catalog.types';
import { OptionReadLoader } from '../loaders/option-read.loader';
import { ProductVersionReadLoader } from '../loaders/product-version-read.loader';
import { TagReadLoader } from '../loaders/tag-read.loader';

export type ProjectionSnapshotAssembly = {
  snapshot: ProductSnapshot;
  categoryIds: string[];
  primaryCategoryId: string | null;
};

type AssembleOptions = {
  locale?: string;
};

@Injectable()
export class ProjectionSnapshotAssembler {
  constructor(
    private readonly versionReadLoader: ProductVersionReadLoader,
    private readonly optionReadLoader: OptionReadLoader,
    private readonly tagReadLoader: TagReadLoader,
    private readonly priceCacheService: VariantPriceCacheService,
  ) {}

  async assembleActiveVersionSnapshot(
    masterId: string,
    versionId: string,
    tx: DbTransaction,
    options?: AssembleOptions,
  ): Promise<ProjectionSnapshotAssembly> {
    const locale = options?.locale ?? 'ko-KR';
    const version = await this.versionReadLoader.getVersionById(tx, versionId);

    if (version.masterId !== masterId) {
      throw new BadRequestException(`Version ${versionId} does not belong to master ${masterId}`);
    }

    if (version.status !== 'active') {
      throw new BadRequestException(`Cannot assemble projection snapshot for non-active version ${versionId}`);
    }

    const [categories, variants, images, tags, purchaseConstraint, cachedPrices, optionGroups] = await Promise.all([
      this.versionReadLoader.getCategories(tx, masterId, versionId),
      this.versionReadLoader.getVariants(tx, masterId, versionId),
      this.versionReadLoader.getImages(tx, versionId),
      this.tagReadLoader.getTags(tx, masterId, versionId),
      this.versionReadLoader.getPurchaseConstraint(tx, masterId, versionId),
      this.priceCacheService.getCachedPriceSetsByVersion(versionId, tx),
      this.optionReadLoader.getOptionGroups(tx, masterId, versionId, locale),
    ]);

    const primaryCategories = categories.filter((category) => category.isPrimary);
    if (primaryCategories.length > 1) {
      throw new BadRequestException(`Multiple primary categories for master ${masterId} version ${versionId}`);
    }

    const activeVariants = variants.filter((variant) => variant.status === 'active');
    if (activeVariants.length === 0) {
      throw new BadRequestException(`Projection snapshot requires at least one active variant: versionId=${versionId}`);
    }

    const priceMap = new Map(cachedPrices.map((price) => [price.variantId, price]));
    const optionCombinationByVariant = await this.getOptionCombinationsByVariant(tx, versionId, locale, activeVariants);
    const usedOptionValueIds = new Set(activeVariants.flatMap((variant) => variant.optionValueIds));
    const snapshotOptionGroups = this.buildSnapshotOptionGroups(optionGroups, usedOptionValueIds, activeVariants);
    const primaryImage = images.find((image) => image.isPrimary);

    const snapshot: ProductSnapshot = {
      masterId,
      versionId,
      version: version.version,
      isOverseas: version.isOverseas,
      name: version.name,
      description: version.description ?? undefined,
      descriptionHtml: version.descriptionHtml ?? undefined,
      thumbnail: primaryImage?.fileId,
      images: images.map((image) => ({
        fileId: image.fileId,
        url: image.fileId,
        isPrimary: image.isPrimary,
        sortOrder: image.sortOrder,
      })),
      seoTitle: version.seoTitle ?? undefined,
      seoDescription: version.seoDescription ?? undefined,
      seoKeywords: version.seoKeywords?.join(', ') || undefined,
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        path: category.path,
        parentId: category.parentId,
        isActive: category.isActive,
        visibility: category.visibility,
        showOnMainCategory: category.showOnMainCategory,
        thumbnail: category.thumbnailFileId ?? undefined,
      })),
      brand: version.brand ?? undefined,
      tags: tags.map((tag) => tag.name),
      productType: version.productType ?? undefined,
      fulfillmentKind: version.fulfillmentKind ?? 'physical',
      optionGroups: snapshotOptionGroups,
      variants: activeVariants.map((variant) => {
        const price = priceMap.get(variant.id);
        if (!price) {
          throw new BadRequestException(
            `Missing calculated price cache for active variant ${variant.id} in version ${versionId}`,
          );
        }
        if (!Number.isFinite(price.basePrice) || !Number.isFinite(price.membershipPrice)) {
          throw new Error(`Invalid calculated price cache for active variant ${variant.id} in version ${versionId}`);
        }

        return {
          id: variant.id,
          variantName: variant.variantName ?? '',
          sku: variant.id,
          variantCode: variant.variantCode ?? undefined,
          isDefault: variant.isDefault,
          status: 'active',
          optionCombination: optionCombinationByVariant.get(variant.id) ?? [],
          basePrice: price.basePrice,
          membershipPrice: price.membershipPrice,
          tieredPrices: price.tieredPrices ?? [],
        };
      }),
      status: 'active',
      isWholesaleOnly: version.isWholesaleOnly ?? false,
      hideMembershipPriceForNonMembers: version.hideMembershipPriceForNonMembers ?? version.isMembershipOnly ?? false,
      isMembershipOnly: version.hideMembershipPriceForNonMembers ?? version.isMembershipOnly ?? false,
      isVisibleToMembersOnly: version.isVisibleToMembersOnly ?? false,
      isGiftcard: false,
      discountable: true,
      purchaseConstraint: purchaseConstraint
        ? {
            requiresMembership: purchaseConstraint.requiresMembership,
            lifetimeQuantityLimit: purchaseConstraint.lifetimeQuantityLimit,
          }
        : undefined,
    };

    return {
      snapshot,
      categoryIds: categories.map((category) => category.id),
      primaryCategoryId: primaryCategories[0]?.id ?? null,
    };
  }

  private async getOptionCombinationsByVariant(
    tx: DbTransaction,
    versionId: string,
    locale: string,
    activeVariants: Array<{ id: string; optionValueIds: string[] }>,
  ): Promise<Map<string, Array<{ name: string; value: string }>>> {
    const optionCombinationByVariant = new Map<string, Array<{ name: string; value: string }>>();

    for (const variant of activeVariants) {
      if (variant.optionValueIds.length === 0) {
        optionCombinationByVariant.set(variant.id, []);
        continue;
      }

      const displayRows = await this.optionReadLoader.getVariantOptionValues(tx, variant.id, versionId, locale);
      if (displayRows.length !== variant.optionValueIds.length) {
        throw new BadRequestException(
          `Missing option display for active variant ${variant.id} in version ${versionId}`,
        );
      }

      const expectedOptionValueIds = new Set(variant.optionValueIds);
      const optionCombination = displayRows.map((row) => {
        this.assertValidOptionDisplay(row, variant.id, versionId);
        if (!expectedOptionValueIds.has(row.id)) {
          throw new BadRequestException(
            `Missing option display for active variant ${variant.id} in version ${versionId}`,
          );
        }

        return { name: row.optionGroupName, value: row.displayName };
      });

      optionCombinationByVariant.set(variant.id, optionCombination);
    }

    return optionCombinationByVariant;
  }

  private assertValidOptionDisplay(row: VariantOptionValueReadModel, variantId: string, versionId: string): void {
    if (!row.optionGroupName?.trim() || !row.displayName?.trim()) {
      throw new BadRequestException(`Missing option display for active variant ${variantId} in version ${versionId}`);
    }
  }

  private buildSnapshotOptionGroups(
    optionGroups: OptionGroupReadModel[],
    usedOptionValueIds: Set<string>,
    activeVariants: Array<{ id: string; optionValueIds: string[] }>,
  ): ProductSnapshot['optionGroups'] {
    if (usedOptionValueIds.size === 0) {
      return [];
    }

    const usedOptionGroupIds = new Set<string>();
    for (const group of optionGroups) {
      if (group.values.some((value) => usedOptionValueIds.has(value.id))) {
        usedOptionGroupIds.add(group.id);
      }
    }

    const snapshotOptionGroups = optionGroups
      .filter((group) => usedOptionGroupIds.has(group.id))
      .map((group) => {
        if (!group.displayName?.trim()) {
          throw new BadRequestException(`Missing option group display for active projection: groupId=${group.id}`);
        }

        return {
          id: group.id,
          name: group.displayName,
          values: group.values
            .filter((value) => usedOptionValueIds.has(value.id))
            .map((value) => {
              if (!value.displayName?.trim()) {
                throw new BadRequestException(
                  `Missing option value display for active projection: valueId=${value.id}`,
                );
              }

              return { id: value.id, name: value.displayName };
            }),
        };
      });

    this.assertAllUsedOptionsWereEmitted(snapshotOptionGroups ?? [], usedOptionValueIds, activeVariants);

    return snapshotOptionGroups;
  }

  private assertAllUsedOptionsWereEmitted(
    snapshotOptionGroups: NonNullable<ProductSnapshot['optionGroups']>,
    usedOptionValueIds: Set<string>,
    activeVariants: Array<{ id: string; optionValueIds: string[] }>,
  ): void {
    const emittedValueIds = new Set(snapshotOptionGroups.flatMap((group) => group.values.map((value) => value.id)));

    for (const valueId of usedOptionValueIds) {
      if (!emittedValueIds.has(valueId)) {
        const variant = activeVariants.find((activeVariant) => activeVariant.optionValueIds.includes(valueId));
        throw new BadRequestException(
          `Missing option display for active variant ${variant?.id ?? 'unknown'}: valueId=${valueId}`,
        );
      }
    }
  }
}
