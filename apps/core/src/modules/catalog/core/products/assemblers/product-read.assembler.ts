import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { VariantPriceCacheService } from '../../pricing/variant-price-cache.service';
import {
  ProductDetailDto,
  ProductMasterVersion,
  DbTransaction,
  OptionGroupReadModel,
  ProductDetailCategory,
  ProductImage,
  ProductVariant,
  TagReadModel,
  VariantReadModel,
} from '../../../catalog.types';
import {
  type PimSchema,
  productMasters,
  productMasterVersions,
  productMasterCategories,
  productCategories,
  productMasterVariants,
  productVariants,
  productImages,
} from '../../../schema/catalog.schema';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { OptionReadLoader } from '../loaders/option-read.loader';
import { TagReadLoader } from '../loaders/tag-read.loader';

type ProductReadAssemblerInclude = {
  images?: boolean;
  optionGroups?: boolean;
  variants?: boolean;
  tags?: boolean;
  categories?: boolean;
  priceSummary?: boolean;
  channelProducts?: boolean;
};

type ProductReadAssemblerOptions = {
  locale?: string;
  include?: ProductReadAssemblerInclude;
};

@Injectable()
export class ProductReadAssembler {
  private readonly logger = new Logger(ProductReadAssembler.name);

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly priceCacheService: VariantPriceCacheService,
    private readonly optionReadLoader: OptionReadLoader,
    private readonly tagReadLoader: TagReadLoader,
  ) {}

  private get client() {
    return this.db.db;
  }

  private async inTx<T>(fn: (tx: DbTransaction) => Promise<T>, tx?: DbTransaction): Promise<T> {
    return tx ? fn(tx) : this.client.transaction(fn);
  }

  async getVersionDetail(
    versionId: string,
    options?: ProductReadAssemblerOptions,
    tx?: DbTransaction,
  ): Promise<ProductDetailDto> {
    return this.inTx(async (tx) => {
      const locale = options?.locale ?? 'ko-KR';
      const include: Required<ProductReadAssemblerInclude> = {
        images: true,
        optionGroups: true,
        variants: true,
        tags: true,
        categories: true,
        priceSummary: true,
        channelProducts: true,
        ...options?.include,
      };

      const version = await this.getVersionById(versionId, tx);
      const masterId = version.masterId;

      const optionGroupsPromise: Promise<OptionGroupReadModel[]> = include.optionGroups
        ? this.optionReadLoader.getOptionGroups(tx, masterId, versionId, locale)
        : Promise.resolve([]);
      const variantsPromise: Promise<ProductVariant[]> = include.variants
        ? this._fetchVariants(masterId, versionId, tx)
        : Promise.resolve([]);
      const tagsPromise: Promise<TagReadModel[]> = include.tags
        ? this.tagReadLoader.getTags(tx, masterId, versionId)
        : Promise.resolve([]);
      const imagesPromise: Promise<ProductImage[]> = include.images
        ? this._fetchImages(versionId, tx)
        : Promise.resolve([]);
      const categoriesPromise: Promise<ProductDetailCategory[]> = include.categories
        ? this._fetchCategories(masterId, versionId, tx)
        : Promise.resolve([]);

      const [optionGroups, variants, tags, images, categories] = await Promise.all([
        optionGroupsPromise,
        variantsPromise,
        tagsPromise,
        imagesPromise,
        categoriesPromise,
      ]);

      const cachedPrices = await this.priceCacheService.getCachedPriceSetsByVersion(versionId, tx);
      const priceMap = new Map(cachedPrices.map((p) => [p.variantId, p]));

      const variantsWithOptions: VariantReadModel[] = include.variants
        ? await Promise.all(
            variants.map(async (v) => {
              const optionValues = await this.optionReadLoader.getVariantOptionValues(tx, v.id, versionId, locale);
              const priceSet = priceMap.get(v.id);
              if (!priceSet && version.status === 'active') {
                this.logger.warn(`No cached price found for active variant ${v.id} in version ${versionId}`);
              }

              return {
                ...v,
                optionValues,
                price: priceSet?.basePrice,
                priceSet: priceSet
                  ? {
                      basePrice: priceSet.basePrice,
                      membershipPrice: priceSet.membershipPrice,
                      tieredPrices: priceSet.tieredPrices,
                    }
                  : undefined,
              };
            }),
          )
        : [];

      const primaryImage = images.find((img) => img.isPrimary);
      const thumbnail = primaryImage ? primaryImage.fileId : null;
      const priceSummary =
        include.priceSummary && version.status !== 'draft'
          ? ((await this.priceCacheService.getPriceSummariesByVersionIds([versionId], tx)).get(versionId) ?? null)
          : null;

      const channelProducts: ProductDetailDto['channelProducts'] = [];

      return {
        ...version,
        thumbnail,
        images,
        categories,
        optionGroups,
        variants: variantsWithOptions,
        channelProducts,
        tagValues: tags,
        priceSummary,
      };
    }, tx);
  }

  async getMasterDetail(
    masterId: string,
    options?: ProductReadAssemblerOptions,
    tx?: DbTransaction,
  ): Promise<ProductDetailDto> {
    return this.inTx(async (tx) => {
      const activeVersion = await this.getActiveVersion(masterId, tx);
      return this.getVersionDetail(activeVersion.id, options, tx);
    }, tx);
  }

  async getPrimaryImagesByVersionIds(versionIds: string[], tx?: DbTransaction): Promise<Map<string, string>> {
    return this.inTx(async (tx) => {
      if (versionIds.length === 0) {
        return new Map();
      }

      const primaryImages = await tx
        .select({
          versionId: productImages.versionId,
          fileId: productImages.fileId,
        })
        .from(productImages)
        .where(and(inArray(productImages.versionId, versionIds), eq(productImages.isPrimary, true)));

      return new Map(primaryImages.map((img) => [img.versionId, img.fileId]));
    }, tx);
  }

  async getImagesByVersionId(versionId: string, tx?: DbTransaction): Promise<ProductImage[]> {
    return this.inTx(async (tx) => this._fetchImages(versionId, tx), tx);
  }

  private async getVersionById(versionId: string, tx: DbTransaction): Promise<ProductMasterVersion> {
    const [version] = await tx
      .select()
      .from(productMasterVersions)
      .where(eq(productMasterVersions.id, versionId))
      .limit(1);

    if (!version) {
      throw new NotFoundException(`Version ${versionId} not found`);
    }

    return version;
  }

  private async getActiveVersion(masterId: string, tx: DbTransaction): Promise<ProductMasterVersion> {
    const result = await tx
      .select()
      .from(productMasterVersions)
      .innerJoin(productMasters, eq(productMasterVersions.masterId, productMasters.id))
      .where(
        and(
          eq(productMasterVersions.masterId, masterId),
          eq(productMasterVersions.status, 'active'),
          isNull(productMasters.deletedAt),
        ),
      )
      .limit(1);

    if (result.length === 0) {
      throw new NotFoundException(`No active version found for master ${masterId}`);
    }

    return result[0].product_master_versions;
  }

  private async _fetchVariants(masterId: string, versionId: string, tx: DbTransaction): Promise<ProductVariant[]> {
    const variantResults = await tx
      .select()
      .from(productMasterVariants)
      .innerJoin(productVariants, eq(productMasterVariants.variantId, productVariants.id))
      .where(and(eq(productMasterVariants.masterId, masterId), eq(productMasterVariants.versionId, versionId)))
      .orderBy(asc(productVariants.displayOrder));

    return variantResults.map((r) => r.product_variants);
  }

  private async _fetchImages(versionId: string, tx: DbTransaction): Promise<ProductImage[]> {
    return await tx
      .select()
      .from(productImages)
      .where(eq(productImages.versionId, versionId))
      .orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder));
  }

  private async _fetchCategories(
    masterId: string,
    versionId: string,
    tx: DbTransaction,
  ): Promise<ProductDetailCategory[]> {
    const rows = await tx
      .select({
        id: productCategories.id,
        name: productCategories.name,
        slug: productCategories.slug,
        path: productCategories.path,
        parentId: productCategories.parentId,
        isActive: productCategories.isActive,
        isPrimary: productMasterCategories.isPrimary,
      })
      .from(productMasterCategories)
      .innerJoin(productCategories, eq(productMasterCategories.categoryId, productCategories.id))
      .where(and(eq(productMasterCategories.masterId, masterId), eq(productMasterCategories.versionId, versionId)))
      .orderBy(desc(productMasterCategories.isPrimary), asc(productCategories.path), asc(productCategories.name));

    return rows;
  }
}
