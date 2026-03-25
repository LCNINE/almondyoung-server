import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { InjectStreamPublisher, StreamPublisher } from '@app/events';
import { ProductEvents, PRODUCT_STREAM, ProductSnapshot } from '@packages/event-contracts';
import { PricingValidatorService } from '../../pricing/pricing-validator.service';
import { VariantPriceCacheService } from '../../pricing/variant-price-cache.service';
import { ProductReadAssembler } from '../assemblers/product-read.assembler';
import {
  ProductMasterVersion,
  DbTransaction,
  VersionTreeNode,
  VersionDiffDto,
  VersionStatus,
  ProductDetailDto,
} from '../../../types';
import {
  type PimSchema,
  productMasters,
  productMasterCategories,
  productCategories,
  productMasterVersions,
  productMasterOptionGroups,
  productMasterVariants,
  productMasterPricingRules,
  productOptionGroupDisplays,
  productOptionValueDisplays,
  productOptionGroups,
  productOptionValues,
  productVariants,
  variantOptionValues,
  pricingRules,
  productTagValues,
  tagValues,
  productImages,
} from '../../../schema';
import { eq, and, sql, max as drizzleMax, isNull, inArray, asc, desc } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

@Injectable()
export class ProductVersionsService {
  private readonly logger = new Logger(ProductVersionsService.name);

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    @InjectStreamPublisher(PRODUCT_STREAM.topic.topic)
    private readonly productPublisher: StreamPublisher<ProductEvents>,
    private readonly pricingValidator: PricingValidatorService,
    private readonly productReadAssembler: ProductReadAssembler,
    private readonly priceCacheService: VariantPriceCacheService,
  ) {}

  private get dbConn() {
    return this.db.db;
  }

  private async inTx<T>(fn: (tx: DbTransaction) => Promise<T>, tx?: DbTransaction): Promise<T> {
    return tx ? fn(tx) : this.dbConn.transaction(fn);
  }

  async getVersionTree(masterId: string, tx?: DbTransaction): Promise<VersionTreeNode[]> {
    return this.inTx(async (tx) => {
      const versions = await tx
        .select()
        .from(productMasterVersions)
        .where(eq(productMasterVersions.masterId, masterId))
        .orderBy(productMasterVersions.version);

      if (versions.length === 0) {
        throw new NotFoundException(`No versions found for master ${masterId}`);
      }

      const versionMap = new Map<string, VersionTreeNode>();
      const rootNodes: VersionTreeNode[] = [];

      for (const version of versions) {
        const node: VersionTreeNode = {
          id: version.id,
          masterId: version.masterId,
          version: version.version,
          status: version.status as VersionStatus,
          name: version.name,
          parentVersionId: version.parentVersionId,
          children: [],
          createdAt: version.createdAt,
          updatedAt: version.updatedAt,
          draftOwnerId: version.draftOwnerId,
        };
        versionMap.set(version.id, node);
      }

      for (const node of versionMap.values()) {
        if (node.parentVersionId) {
          const parent = versionMap.get(node.parentVersionId);
          if (parent) {
            parent.children.push(node);
          } else {
            rootNodes.push(node);
          }
        } else {
          rootNodes.push(node);
        }
      }

      return rootNodes;
    }, tx);
  }

  async getActiveVersion(masterId: string, tx?: DbTransaction): Promise<ProductMasterVersion> {
    return this.inTx(async (tx) => {
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
    }, tx);
  }

  async getVersionById(versionId: string, tx?: DbTransaction): Promise<ProductMasterVersion> {
    return this.inTx(async (tx) => {
      const [version] = await tx
        .select()
        .from(productMasterVersions)
        .where(eq(productMasterVersions.id, versionId))
        .limit(1);

      if (!version) {
        throw new NotFoundException(`Version ${versionId} not found`);
      }

      return version;
    }, tx);
  }

  async getVersionDetail(versionId: string, tx?: DbTransaction): Promise<ProductDetailDto> {
    return this.productReadAssembler.getVersionDetail(versionId, undefined, tx);
  }

  async createDraftVersion(
    parentVersionId: string,
    userId: string,
    copyMappings: boolean = true,
    tx?: DbTransaction,
  ): Promise<ProductMasterVersion> {
    return this.inTx(async (tx) => {
      const parent = await this.getVersionById(parentVersionId, tx);

      const maxVersionResult = await tx
        .select({ max: drizzleMax(productMasterVersions.version) })
        .from(productMasterVersions)
        .where(eq(productMasterVersions.masterId, parent.masterId));

      const nextVersion = (maxVersionResult[0]?.max || 0) + 1;

      const {
        id,
        masterId,
        version,
        parentVersionId: _,
        status,
        draftOwnerId,
        createdAt,
        updatedAt,
        ...parentData
      } = parent;

      const [newVersion] = await tx
        .insert(productMasterVersions)
        .values({
          ...parentData,
          id: uuidv7(),
          masterId: parent.masterId,
          version: nextVersion,
          parentVersionId: parentVersionId,
          status: 'draft',
          draftOwnerId: userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      if (copyMappings) {
        await this._copyMappings(tx, parent.masterId, parent.id, newVersion.id);
      }

      this.logger.log(`Created draft version ${newVersion.id} for master ${parent.masterId} from version ${parent.id}`);

      return newVersion;
    }, tx);
  }

  /**
   * Draft 버전을 Active로 Publish
   * 기존 Active 버전이 있으면 자동으로 Inactive로 전환됨
   */
  async publishVersion(versionId: string, tx?: DbTransaction): Promise<void> {
    return this.inTx(async (tx) => {
      const version = await this.getVersionById(versionId, tx);

      if (version.status !== 'draft' && version.status !== 'inactive') {
        throw new BadRequestException('Only draft or inactive versions can be published');
      }

      let previousActiveVersion: ProductMasterVersion | null = null;

      // 기존 active 버전 조회
      try {
        previousActiveVersion = await this.getActiveVersion(version.masterId, tx);
      } catch (e) {
        this.logger.debug(`No previous active version for ${version.masterId}`);
      }

      // 기존 active를 inactive로
      await tx
        .update(productMasterVersions)
        .set({ status: 'inactive' })
        .where(and(eq(productMasterVersions.masterId, version.masterId), eq(productMasterVersions.status, 'active')));

      // 가격 검증 (publish 시점)
      await this.pricingValidator.validateCalculatedPrices(versionId, tx);

      // 가격 캐시 생성 (publish 시점)
      await this.priceCacheService.cachePricesForVersion(versionId, tx);

      // draft를 active로 publish
      await tx
        .update(productMasterVersions)
        .set({ status: 'active', draftOwnerId: null, updatedAt: new Date() })
        .where(eq(productMasterVersions.id, versionId));

      // 이벤트 발행: 추가/삭제된 variant
      await this._publishVariantChangeEvents(version, previousActiveVersion, tx);

      await this._emitActiveVersionChangedEvent(version, previousActiveVersion, 'active', tx);

      this.logger.log(`Published version ${version.id} of master ${version.masterId} as active`);
    }, tx);
  }

  /**
   * Master의 Active 버전을 Inactive로 전환 (상품 비공개)
   */
  async unpublishMaster(masterId: string, tx?: DbTransaction): Promise<void> {
    return this.inTx(async (tx) => {
      const activeVersion = await this.getActiveVersion(masterId, tx);

      // active를 inactive로 전환
      await tx
        .update(productMasterVersions)
        .set({ status: 'inactive', updatedAt: new Date() })
        .where(eq(productMasterVersions.id, activeVersion.id));

      await this._emitActiveVersionChangedEvent(activeVersion, activeVersion, 'inactive', tx);

      this.logger.log(`Unpublished master ${masterId} (version ${activeVersion.version} → inactive)`);
    }, tx);
  }

  async getDraftVersions(
    filters?: {
      page?: number;
      limit?: number;
    },
    tx?: DbTransaction,
  ): Promise<{
    data: ProductMasterVersion[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 15;
    const offset = (page - 1) * limit;

    return this.inTx(async (tx) => {
      const versions = await tx
        .select()
        .from(productMasterVersions)
        .where(eq(productMasterVersions.status, 'draft'))
        .limit(limit)
        .offset(offset);
      return {
        data: versions,
        total: versions.length,
        page,
        limit,
      };
    }, tx);
  }

  /**
   * Active version 변경 이벤트 발행
   */
  private async _emitActiveVersionChangedEvent(
    newVersion: ProductMasterVersion,
    previousActiveVersion: ProductMasterVersion | null,
    targetStatus: 'active' | 'inactive',
    tx: DbTransaction,
  ): Promise<void> {
    try {
      const changeReason =
        targetStatus === 'inactive' ? 'unpublished' : previousActiveVersion ? 'rollback' : 'published';

      const snapshot =
        targetStatus === 'active' ? await this._buildFullSnapshot(newVersion.masterId, newVersion.id, tx) : null;

      const categoryIds = snapshot?.categories?.map((c) => c.id) || [];
      const primaryCategoryId =
        categoryIds.length > 0 ? await this.getPrimaryCategoryId(newVersion.masterId, newVersion.id, tx) : null;

      await this.productPublisher.publishEvent({
        eventType: 'ProductMasterActiveVersionChanged',
        aggregateId: newVersion.masterId,
        payload: {
          masterId: newVersion.masterId,
          versionId: targetStatus === 'active' ? newVersion.id : null,
          name: targetStatus === 'active' ? newVersion.name : null,
          previousActiveVersionId: previousActiveVersion?.id || null,
          categoryIds,
          primaryCategoryId,
          changeReason,
          changedAt: new Date().toISOString(),
          snapshot,
        },
      });

      this.logger.log(
        `📤 Published ProductMasterActiveVersionChanged: ${newVersion.masterId} (${changeReason}) with ${snapshot ? 'full snapshot' : 'no snapshot'}`,
      );
    } catch (error) {
      this.logger.error(`❌ Failed to publish ProductMasterActiveVersionChanged: ${newVersion.masterId}`, error.stack);
    }
  }

  private async getVersionCategoryIds(masterId: string, versionId: string, tx: DbTransaction): Promise<string[]> {
    const rows = await tx
      .select({ categoryId: productMasterCategories.categoryId })
      .from(productMasterCategories)
      .where(and(eq(productMasterCategories.masterId, masterId), eq(productMasterCategories.versionId, versionId)));

    return rows.map((row) => row.categoryId);
  }

  private async getPrimaryCategoryId(masterId: string, versionId: string, tx: DbTransaction): Promise<string | null> {
    const [row] = await tx
      .select({ categoryId: productMasterCategories.categoryId })
      .from(productMasterCategories)
      .where(
        and(
          eq(productMasterCategories.masterId, masterId),
          eq(productMasterCategories.versionId, versionId),
          eq(productMasterCategories.isPrimary, true),
        ),
      )
      .limit(1);

    return row?.categoryId ?? null;
  }

  /**
   * 전체 ProductSnapshot 빌드 (Phase 2)
   * 이벤트 페이로드에 포함할 모든 상품 데이터를 조회
   */
  private async _buildFullSnapshot(masterId: string, versionId: string, tx: DbTransaction): Promise<ProductSnapshot> {
    const version = await tx.query.productMasterVersions.findFirst({
      where: eq(productMasterVersions.id, versionId),
    });

    if (!version) {
      throw new Error(`Version ${versionId} not found`);
    }

    const categories = await this._buildCategoryTree(masterId, versionId, tx);
    const optionGroups = await this._getVersionOptionGroups(masterId, versionId, tx);
    const variants = await this._getVersionVariants(versionId, tx);

    const images = await tx
      .select()
      .from(productImages)
      .where(eq(productImages.versionId, versionId))
      .orderBy(asc(productImages.sortOrder));

    const tagRows = await tx
      .select({
        name: tagValues.name,
      })
      .from(productTagValues)
      .innerJoin(tagValues, eq(productTagValues.tagValueId, tagValues.id))
      .where(eq(productTagValues.versionId, versionId));

    const fileServiceUrl = process.env.FILE_SERVICE_URL || '';

    return {
      masterId,
      versionId,
      version: version.version,
      name: version.name,
      description: version.description || undefined,
      descriptionHtml: version.descriptionHtml || undefined,
      thumbnail: version.thumbnail ? `${fileServiceUrl}/files/${version.thumbnail}` : undefined,
      images: images.map((img) => ({
        fileId: img.fileId,
        url: `${fileServiceUrl}/files/${img.fileId}`,
        isPrimary: img.isPrimary,
        sortOrder: img.sortOrder,
      })),
      seoTitle: version.seoTitle || undefined,
      seoDescription: version.seoDescription || undefined,
      seoKeywords: version.seoKeywords?.join(', ') || undefined,
      categories,
      brand: version.brand || undefined,
      tags: tagRows.map((t) => t.name),
      productType: version.productType || undefined,
      optionGroups,
      variants,
      status: version.status === 'inactive' ? 'draft' : version.status,
      isWholesaleOnly: version.isWholesaleOnly || false,
      isMembershipOnly: version.isMembershipOnly || false,
      isGiftcard: false,
      discountable: true,
    };
  }

  /**
   * 카테고리 트리 빌드 (부모 경로 포함)
   */
  private async _buildCategoryTree(
    masterId: string,
    versionId: string,
    tx: DbTransaction,
  ): Promise<
    Array<{
      id: string;
      name: string;
      slug: string;
      path: string;
      parentId: string | null;
      isActive: boolean;
      visibility: boolean;
      showOnMainCategory: boolean;
      thumbnail?: string;
    }>
  > {
    const categoryRows = await tx
      .select({
        categoryId: productMasterCategories.categoryId,
      })
      .from(productMasterCategories)
      .where(eq(productMasterCategories.masterId, masterId));

    if (categoryRows.length === 0) return [];

    const categoryIds = categoryRows.map((r) => r.categoryId);

    const categories = await tx.select().from(productCategories).where(inArray(productCategories.id, categoryIds));

    const fileServiceUrl = process.env.FILE_SERVICE_URL || '';

    const categoriesWithPath = await Promise.all(
      categories.map(async (cat) => {
        const path = await this._buildCategoryPath(cat.id, tx);
        return {
          id: cat.id,
          name: cat.name,
          slug: cat.slug,
          path,
          parentId: cat.parentId,
          isActive: cat.isActive,
          visibility: cat.visibility ?? true,
          showOnMainCategory: cat.displaySettings?.showOnMainCategory ?? false,
          thumbnail: cat.imageUrl ? `${fileServiceUrl}/files/${cat.imageUrl}` : undefined,
        };
      }),
    );

    return categoriesWithPath;
  }

  /**
   * 카테고리 경로 재귀적으로 구성
   */
  private async _buildCategoryPath(categoryId: string, tx: DbTransaction): Promise<string> {
    const pathParts: string[] = [];
    let currentId: string | null = categoryId;

    while (currentId) {
      const category = await tx.query.productCategories.findFirst({
        where: eq(productCategories.id, currentId),
      });

      if (!category) break;

      pathParts.unshift(category.slug);
      currentId = category.parentId;
    }

    return '/' + pathParts.join('/');
  }

  /**
   * 버전의 옵션 그룹 조회
   */
  private async _getVersionOptionGroups(
    masterId: string,
    versionId: string,
    tx: DbTransaction,
  ): Promise<
    Array<{
      id: string;
      name: string;
      values: Array<{
        id: string;
        name: string;
        colorCode?: string;
        imageUrl?: string;
      }>;
    }>
  > {
    const optionGroupRows = await tx
      .select({
        optionGroupId: productMasterOptionGroups.optionGroupId,
        displayName: productOptionGroupDisplays.displayName,
      })
      .from(productMasterOptionGroups)
      .leftJoin(
        productOptionGroupDisplays,
        and(
          eq(productMasterOptionGroups.optionGroupId, productOptionGroupDisplays.optionGroupId),
          eq(productOptionGroupDisplays.versionId, versionId),
        ),
      )
      .where(eq(productMasterOptionGroups.masterId, masterId));

    const fileServiceUrl = process.env.FILE_SERVICE_URL || '';

    const optionGroups = await Promise.all(
      optionGroupRows.map(async (row) => {
        const valueRows = await tx
          .select({
            id: productOptionValueDisplays.optionValueId,
            name: productOptionValueDisplays.displayName,
            colorCode: productOptionValueDisplays.colorCode,
            imageUrl: productOptionValueDisplays.imageUrl,
          })
          .from(productOptionValueDisplays)
          .where(and(eq(productOptionValueDisplays.versionId, versionId)));

        return {
          id: row.optionGroupId,
          name: row.displayName || row.optionGroupId,
          values: valueRows.map((v) => ({
            id: v.id,
            name: v.name,
            colorCode: v.colorCode || undefined,
            imageUrl: v.imageUrl ? `${fileServiceUrl}/files/${v.imageUrl}` : undefined,
          })),
        };
      }),
    );

    return optionGroups;
  }

  /**
   * 버전의 변형(Variants) 조회
   */
  private async _getVersionVariants(
    versionId: string,
    tx: DbTransaction,
  ): Promise<
    Array<{
      id: string;
      variantName: string;
      sku: string;
      variantCode?: string;
      isDefault: boolean;
      status: string;
      optionCombination?: Array<{
        name: string;
        value: string;
      }>;
      basePrice: number;
      membershipPrice?: number;
      tieredPrices?: Array<{
        minQuantity: number;
        price: number;
      }>;
      weight?: number;
      length?: number;
      width?: number;
      height?: number;
      originCountry?: string;
      midCode?: string;
      hsCode?: string;
      material?: string;
    }>
  > {
    const variantRows = await tx
      .select({
        id: productVariants.id,
        variantName: productVariants.variantName,
        variantCode: productVariants.variantCode,
        isDefault: productVariants.isDefault,
        status: productVariants.status,
      })
      .from(productMasterVariants)
      .innerJoin(productVariants, eq(productMasterVariants.variantId, productVariants.id))
      .where(eq(productMasterVariants.versionId, versionId));

    const cachedPrices = await this.priceCacheService.getCachedPriceSetsByVersion(versionId, tx);
    const priceMap = new Map(cachedPrices.map((p) => [p.variantId, p]));

    const variants = await Promise.all(
      variantRows.map(async (variant) => {
        const priceData = priceMap.get(variant.id);

        const optionValues = await tx
          .select({
            optionGroupName: productOptionGroupDisplays.displayName,
            optionValueName: productOptionValueDisplays.displayName,
          })
          .from(variantOptionValues)
          .innerJoin(productOptionValues, eq(variantOptionValues.optionValueId, productOptionValues.id))
          .innerJoin(
            productOptionValueDisplays,
            and(
              eq(productOptionValues.id, productOptionValueDisplays.optionValueId),
              eq(productOptionValueDisplays.versionId, versionId),
            ),
          )
          .innerJoin(productOptionGroups, eq(productOptionValues.optionGroupId, productOptionGroups.id))
          .innerJoin(
            productOptionGroupDisplays,
            and(
              eq(productOptionGroups.id, productOptionGroupDisplays.optionGroupId),
              eq(productOptionGroupDisplays.versionId, versionId),
            ),
          )
          .where(eq(variantOptionValues.variantId, variant.id));

        return {
          id: variant.id,
          variantName: variant.variantName || '',
          sku: variant.id,
          variantCode: variant.variantCode || undefined,
          isDefault: variant.isDefault,
          status: variant.status,
          optionCombination: optionValues.map((ov) => ({
            name: ov.optionGroupName || '',
            value: ov.optionValueName || '',
          })),
          basePrice: priceData?.basePrice ?? 0,
          membershipPrice: priceData?.membershipPrice || undefined,
          tieredPrices: priceData?.tieredPrices || undefined,
        };
      }),
    );

    return variants;
  }

  /**
   * publish 시 variant 변경 이벤트 발행
   */
  private async _publishVariantChangeEvents(
    newVersion: ProductMasterVersion,
    oldVersion: ProductMasterVersion | null,
    tx: DbTransaction,
  ): Promise<void> {
    const newVariantIds = await this.getVersionVariants(newVersion.masterId, newVersion.id, tx);

    const oldVariantIds = oldVersion ? await this.getVersionVariants(oldVersion.masterId, oldVersion.id, tx) : [];

    const addedVariantIds = newVariantIds.filter((id) => !oldVariantIds.includes(id));
    const deletedVariantIds = oldVariantIds.filter((id) => !newVariantIds.includes(id));

    if (deletedVariantIds.length > 0) {
      this.logger.log(
        `VARIANT_DELETED event: ${deletedVariantIds.length} variants deleted from master ${newVersion.masterId}`,
      );
    }

    if (addedVariantIds.length > 0) {
      this.logger.log(`VARIANT_ADDED event: ${addedVariantIds.length} variants added to master ${newVersion.masterId}`);
    }

    if (addedVariantIds.length === 0 && deletedVariantIds.length === 0) {
      this.logger.log(`No variant changes for master ${newVersion.masterId}`);
    }
  }

  async compareVersions(versionId1: string, versionId2: string, tx?: DbTransaction): Promise<VersionDiffDto[]> {
    return this.inTx(async (tx) => {
      const [version1, version2] = await Promise.all([
        this.getVersionById(versionId1, tx),
        this.getVersionById(versionId2, tx),
      ]);

      if (version1.masterId !== version2.masterId) {
        throw new BadRequestException('Cannot compare versions from different masters');
      }

      const diffs: VersionDiffDto[] = [];
      const fieldsToCompare = [
        'name',
        'description',
        'brand',
        'thumbnail',
        'basePrice',
        'tags',
        'images',
        'attributes',
        'seoTitle',
        'seoDescription',
        'seoKeywords',
        'descriptionHtml',
        'status',
        'isWholesaleOnly',
        'isMembershipOnly',
        'productType',
        'productCode',
        'alternativeName',
        'material',
        'salesClassification',
        'purchaseClassification',
        'shippingMethodId',
        'marketPrice',
        'supplyPrice',
        'supplierId',
        'ageRestriction',
        'minQuantity',
        'maxQuantity',
        'salesStartDate',
        'salesEndDate',
      ];

      for (const field of fieldsToCompare) {
        const val1 = (version1 as any)[field];
        const val2 = (version2 as any)[field];

        if (JSON.stringify(val1) !== JSON.stringify(val2)) {
          diffs.push({
            field,
            oldValue: val1,
            newValue: val2,
          });
        }
      }

      return diffs;
    }, tx);
  }

  async canUserModifyVersion(versionId: string, userId: string, tx?: DbTransaction): Promise<boolean> {
    return this.inTx(async (tx) => {
      const version = await this.getVersionById(versionId, tx);

      if (version.status !== 'draft') {
        return false;
      }

      if (!version.draftOwnerId) {
        return true;
      }

      return version.draftOwnerId === userId;
    }, tx);
  }

  async linkOptionGroupToVersion(
    masterId: string,
    versionId: string,
    optionGroupId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.inTx(async (tx) => {
      await tx.insert(productMasterOptionGroups).values({
        id: uuidv7(),
        masterId,
        optionGroupId,
        versionId,
        createdAt: new Date(),
      });
    }, tx);
  }

  async unlinkOptionGroupFromVersion(
    masterId: string,
    versionId: string,
    optionGroupId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.inTx(async (tx) => {
      await tx
        .delete(productMasterOptionGroups)
        .where(
          and(
            eq(productMasterOptionGroups.masterId, masterId),
            eq(productMasterOptionGroups.versionId, versionId),
            eq(productMasterOptionGroups.optionGroupId, optionGroupId),
          ),
        );
    }, tx);
  }

  async linkVariantToVersion(
    masterId: string,
    versionId: string,
    variantId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.inTx(async (tx) => {
      await tx.insert(productMasterVariants).values({
        id: uuidv7(),
        masterId,
        variantId,
        versionId,
        createdAt: new Date(),
      });
    }, tx);
  }

  async unlinkVariantFromVersion(
    masterId: string,
    versionId: string,
    variantId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.inTx(async (tx) => {
      await tx
        .delete(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, masterId),
            eq(productMasterVariants.versionId, versionId),
            eq(productMasterVariants.variantId, variantId),
          ),
        );
    }, tx);
  }

  async linkPricingRuleToVersion(
    masterId: string,
    versionId: string,
    pricingRuleId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.inTx(async (tx) => {
      await tx.insert(productMasterPricingRules).values({
        id: uuidv7(),
        masterId,
        pricingRuleId,
        versionId,
        createdAt: new Date(),
      });
    }, tx);
  }

  async unlinkPricingRuleFromVersion(
    masterId: string,
    versionId: string,
    pricingRuleId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.inTx(async (tx) => {
      await tx
        .delete(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, masterId),
            eq(productMasterPricingRules.versionId, versionId),
            eq(productMasterPricingRules.pricingRuleId, pricingRuleId),
          ),
        );
    }, tx);
  }

  async getVersionOptionGroups(masterId: string, versionId: string, tx?: DbTransaction): Promise<string[]> {
    return this.inTx(async (tx) => {
      const mappings = await tx
        .select()
        .from(productMasterOptionGroups)
        .where(
          and(eq(productMasterOptionGroups.masterId, masterId), eq(productMasterOptionGroups.versionId, versionId)),
        );

      return mappings.map((m) => m.optionGroupId);
    }, tx);
  }

  async getVersionVariants(masterId: string, versionId: string, tx?: DbTransaction): Promise<string[]> {
    return this.inTx(async (tx) => {
      const mappings = await tx
        .select()
        .from(productMasterVariants)
        .where(and(eq(productMasterVariants.masterId, masterId), eq(productMasterVariants.versionId, versionId)));

      return mappings.map((m) => m.variantId);
    }, tx);
  }

  async getVersionPricingRules(masterId: string, versionId: string, tx?: DbTransaction): Promise<string[]> {
    return this.inTx(async (tx) => {
      const mappings = await tx
        .select()
        .from(productMasterPricingRules)
        .where(
          and(eq(productMasterPricingRules.masterId, masterId), eq(productMasterPricingRules.versionId, versionId)),
        );

      return mappings.map((m) => m.pricingRuleId);
    }, tx);
  }

  private async _copyMappings(
    tx: DbTransaction,
    masterId: string,
    fromVersionId: string,
    toVersionId: string,
  ): Promise<void> {
    const optionGroups = await tx
      .select()
      .from(productMasterOptionGroups)
      .where(
        and(eq(productMasterOptionGroups.masterId, masterId), eq(productMasterOptionGroups.versionId, fromVersionId)),
      );

    if (optionGroups.length > 0) {
      await tx.insert(productMasterOptionGroups).values(
        optionGroups.map((og) => ({
          id: uuidv7(),
          masterId,
          optionGroupId: og.optionGroupId,
          versionId: toVersionId,
          createdAt: new Date(),
        })),
      );

      // 1-1. 옵션 그룹 display 정보 복사
      const groupDisplays = await tx
        .select()
        .from(productOptionGroupDisplays)
        .where(
          and(
            eq(productOptionGroupDisplays.masterId, masterId),
            eq(productOptionGroupDisplays.versionId, fromVersionId),
          ),
        );

      if (groupDisplays.length > 0) {
        await tx.insert(productOptionGroupDisplays).values(
          groupDisplays.map((gd) => ({
            id: uuidv7(),
            optionGroupId: gd.optionGroupId,
            masterId,
            versionId: toVersionId,
            locale: gd.locale,
            displayName: gd.displayName,
            description: gd.description,
            sortOrder: gd.sortOrder,
            createdAt: new Date(),
          })),
        );
      }

      // 1-2. 옵션값 display 정보 복사
      const valueDisplays = await tx
        .select()
        .from(productOptionValueDisplays)
        .where(
          and(
            eq(productOptionValueDisplays.masterId, masterId),
            eq(productOptionValueDisplays.versionId, fromVersionId),
          ),
        );

      if (valueDisplays.length > 0) {
        await tx.insert(productOptionValueDisplays).values(
          valueDisplays.map((vd) => ({
            id: uuidv7(),
            optionValueId: vd.optionValueId,
            masterId,
            versionId: toVersionId,
            locale: vd.locale,
            displayName: vd.displayName,
            colorCode: vd.colorCode,
            imageUrl: vd.imageUrl,
            sortOrder: vd.sortOrder,
            createdAt: new Date(),
          })),
        );
      }
    }

    const variants = await tx
      .select()
      .from(productMasterVariants)
      .where(and(eq(productMasterVariants.masterId, masterId), eq(productMasterVariants.versionId, fromVersionId)));

    if (variants.length > 0) {
      await tx.insert(productMasterVariants).values(
        variants.map((v) => ({
          id: uuidv7(),
          masterId,
          variantId: v.variantId,
          versionId: toVersionId,
          createdAt: new Date(),
        })),
      );
    }

    const pricingRules = await tx
      .select()
      .from(productMasterPricingRules)
      .where(
        and(eq(productMasterPricingRules.masterId, masterId), eq(productMasterPricingRules.versionId, fromVersionId)),
      );

    if (pricingRules.length > 0) {
      await tx.insert(productMasterPricingRules).values(
        pricingRules.map((pr) => ({
          id: uuidv7(),
          masterId,
          pricingRuleId: pr.pricingRuleId,
          versionId: toVersionId,
        })),
      );
    }

    const tagValueMappings = await tx
      .select({
        tagValueId: productTagValues.tagValueId,
      })
      .from(productTagValues)
      .innerJoin(tagValues, eq(productTagValues.tagValueId, tagValues.id))
      .where(
        and(
          eq(productTagValues.masterId, masterId),
          eq(productTagValues.versionId, fromVersionId),
          eq(tagValues.isActive, true),
        ),
      );

    if (tagValueMappings.length > 0) {
      await tx.insert(productTagValues).values(
        tagValueMappings.map((tv) => ({
          masterId,
          versionId: toVersionId,
          tagValueId: tv.tagValueId,
        })),
      );
    }

    // 카테고리 복사
    const categories = await tx
      .select()
      .from(productMasterCategories)
      .where(and(eq(productMasterCategories.masterId, masterId), eq(productMasterCategories.versionId, fromVersionId)));

    if (categories.length > 0) {
      await tx.insert(productMasterCategories).values(
        categories.map((c) => ({
          id: uuidv7(),
          masterId,
          categoryId: c.categoryId,
          versionId: toVersionId,
          isPrimary: c.isPrimary,
          createdAt: new Date(),
        })),
      );
    }

    // 이미지 복사
    const images = await tx
      .select()
      .from(productImages)
      .where(eq(productImages.versionId, fromVersionId))
      .orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder));

    if (images.length > 0) {
      await tx.insert(productImages).values(
        images.map((img) => ({
          id: uuidv7(),
          versionId: toVersionId,
          fileId: img.fileId,
          isPrimary: img.isPrimary,
          sortOrder: img.sortOrder,
          createdAt: new Date(),
        })),
      );
    }

    this.logger.log(
      `Copied mappings and displays from version ${fromVersionId} to ${toVersionId} for master ${masterId}: ` +
        `${categories.length} categories, ${optionGroups.length} option groups, ${variants.length} variants, ${pricingRules.length} pricing rules, ${tagValueMappings.length} active tag values, ${images.length} images`,
    );
  }

  /**
   * Draft 버전 삭제 (고아 variant도 정리)
   */
  async deleteDraftVersion(versionId: string, tx?: DbTransaction): Promise<void> {
    return this.inTx(async (tx) => {
      const version = await this.getVersionById(versionId, tx);

      if (version.status !== 'draft') {
        throw new BadRequestException('Only draft versions can be deleted');
      }

      // 1. 이 버전이 참조하는 variant 목록 조회
      const variantMappings = await tx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(
          and(eq(productMasterVariants.masterId, version.masterId), eq(productMasterVariants.versionId, version.id)),
        );

      const variantIds = variantMappings.map((m) => m.variantId);

      // 2. Display 정보 삭제
      await tx
        .delete(productOptionGroupDisplays)
        .where(
          and(
            eq(productOptionGroupDisplays.masterId, version.masterId),
            eq(productOptionGroupDisplays.versionId, version.id),
          ),
        );

      await tx
        .delete(productOptionValueDisplays)
        .where(
          and(
            eq(productOptionValueDisplays.masterId, version.masterId),
            eq(productOptionValueDisplays.versionId, version.id),
          ),
        );

      // 3. 매핑 테이블 삭제
      await tx
        .delete(productMasterOptionGroups)
        .where(
          and(
            eq(productMasterOptionGroups.masterId, version.masterId),
            eq(productMasterOptionGroups.versionId, version.id),
          ),
        );

      await tx
        .delete(productMasterVariants)
        .where(
          and(eq(productMasterVariants.masterId, version.masterId), eq(productMasterVariants.versionId, version.id)),
        );

      await tx
        .delete(productTagValues)
        .where(and(eq(productTagValues.masterId, version.masterId), eq(productTagValues.versionId, version.id)));

      // 3. 가격 규칙 매핑 삭제 (고아 정리 포함)
      const pricingRuleMappings = await tx
        .select({ pricingRuleId: productMasterPricingRules.pricingRuleId })
        .from(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, version.masterId),
            eq(productMasterPricingRules.versionId, version.id),
          ),
        );

      await tx
        .delete(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, version.masterId),
            eq(productMasterPricingRules.versionId, version.id),
          ),
        );

      // 4. 버전 자체 삭제
      await tx.delete(productMasterVersions).where(eq(productMasterVersions.id, versionId));

      // 5. 고아 variant 정리
      if (variantIds.length > 0) {
        await this._cleanupOrphanedVariantsAfterDeletion(version.masterId, variantIds, tx);
      }

      // 6. 고아 pricing rules 정리
      if (pricingRuleMappings.length > 0) {
        await this._cleanupOrphanedPricingRules(
          pricingRuleMappings.map((m) => m.pricingRuleId),
          tx,
        );
      }

      this.logger.log(`Deleted draft version ${version.id} of master ${version.masterId}`);
    }, tx);
  }

  /**
   * Draft 버전 삭제 후 고아 variant 정리
   */
  private async _cleanupOrphanedVariantsAfterDeletion(
    masterId: string,
    candidateVariantIds: string[],
    tx: DbTransaction,
  ): Promise<void> {
    let deletedCount = 0;

    for (const variantId of candidateVariantIds) {
      // 이 variant를 참조하는 다른 버전이 있는지 확인
      const remainingMappings = await tx
        .select({ versionId: productMasterVariants.versionId })
        .from(productMasterVariants)
        .where(and(eq(productMasterVariants.masterId, masterId), eq(productMasterVariants.variantId, variantId)));

      if (remainingMappings.length === 0) {
        // 더 이상 참조하는 버전이 없으면 삭제
        await tx.delete(productVariants).where(eq(productVariants.id, variantId));

        deletedCount++;
        this.logger.log(`Deleted orphaned variant entity: ${variantId} (no longer referenced after draft deletion)`);
      }
    }

    if (deletedCount > 0) {
      this.logger.log(`Cleaned up ${deletedCount} orphaned variant entities`);
    }
  }

  /**
   * 고아 pricing rule 정리 (deleteDraftVersion용)
   */
  private async _cleanupOrphanedPricingRules(candidateRuleIds: string[], tx: DbTransaction): Promise<void> {
    if (candidateRuleIds.length === 0) {
      return;
    }

    let deletedCount = 0;

    for (const ruleId of candidateRuleIds) {
      const allMappings = await tx
        .select()
        .from(productMasterPricingRules)
        .where(eq(productMasterPricingRules.pricingRuleId, ruleId));

      if (allMappings.length === 0) {
        await tx.delete(pricingRules).where(eq(pricingRules.id, ruleId));
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      this.logger.log(`Cleaned up ${deletedCount} orphaned pricing rules`);
    }
  }
}
