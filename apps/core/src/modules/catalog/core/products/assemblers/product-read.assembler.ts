import { Injectable, Logger } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { VariantPriceCacheService } from '../../pricing/variant-price-cache.service';
import {
  ProductDetailDto,
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
  productImages,
} from '../../../schema/catalog.schema';
import { and, eq, inArray } from 'drizzle-orm';
import { OptionReadLoader } from '../loaders/option-read.loader';
import { TagReadLoader } from '../loaders/tag-read.loader';
import { ProductVersionReadLoader } from '../loaders/product-version-read.loader';

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
    private readonly versionReadLoader: ProductVersionReadLoader,
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

      const version = await this.versionReadLoader.getVersionById(tx, versionId);
      const masterId = version.masterId;

      const optionGroupsPromise: Promise<OptionGroupReadModel[]> = include.optionGroups
        ? this.optionReadLoader.getOptionGroups(tx, masterId, versionId, locale)
        : Promise.resolve([]);
      const variantsPromise: Promise<ProductVariant[]> = include.variants
        ? this.versionReadLoader.getVariants(tx, masterId, versionId)
        : Promise.resolve([]);
      const tagsPromise: Promise<TagReadModel[]> = include.tags
        ? this.tagReadLoader.getTags(tx, masterId, versionId)
        : Promise.resolve([]);
      const imagesPromise: Promise<ProductImage[]> = include.images
        ? this.versionReadLoader.getImages(tx, versionId)
        : Promise.resolve([]);
      const categoryFragmentsPromise = include.categories
        ? this.versionReadLoader.getCategories(tx, masterId, versionId)
        : Promise.resolve([]);
      const purchaseConstraintPromise = this.versionReadLoader.getPurchaseConstraint(tx, masterId, versionId);

      const [optionGroups, variants, tags, images, categoryFragments, purchaseConstraint] = await Promise.all([
        optionGroupsPromise,
        variantsPromise,
        tagsPromise,
        imagesPromise,
        categoryFragmentsPromise,
        purchaseConstraintPromise,
      ]);
      const categories: ProductDetailCategory[] = categoryFragments.map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        path: category.path,
        parentId: category.parentId,
        isActive: category.isActive,
        isPrimary: category.isPrimary,
      }));

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
        purchaseConstraint,
      };
    }, tx);
  }

  async getMasterDetail(
    masterId: string,
    options?: ProductReadAssemblerOptions,
    tx?: DbTransaction,
  ): Promise<ProductDetailDto> {
    return this.inTx(async (tx) => {
      const activeVersion = await this.versionReadLoader.getActiveVersion(tx, masterId);
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
    return this.inTx(async (tx) => this.versionReadLoader.getImages(tx, versionId), tx);
  }
}
