import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { InjectStreamPublisher, StreamPublisher } from '@app/events';
import { ProductEvents, PRODUCT_STREAM } from '@packages/event-contracts';
import { PricingValidatorService } from '../../pricing/pricing-validator.service';
import { VariantPriceCacheService } from '../../pricing/variant-price-cache.service';
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
  productMasterVersions,
  productMasterOptionGroups,
  productMasterVariants,
  productMasterPricingRules,
  productOptionGroupDisplays,
  productOptionValueDisplays,
  variantOptionValues,
  productVariants,
  pricingRules,
  productTagValues,
  tagValues,
  tagGroups,
  productOptionGroups,
  productOptionValues,
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
    private readonly priceCacheService: VariantPriceCacheService,
  ) { }

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
          createdAt: version.createdAt!,
          updatedAt: version.updatedAt!,
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
        .innerJoin(
          productMasters,
          eq(productMasterVersions.masterId, productMasters.id)
        )
        .where(
          and(
            eq(productMasterVersions.masterId, masterId),
            eq(productMasterVersions.status, 'active'),
            isNull(productMasters.deletedAt)
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
    return this.inTx(async (tx) => {
      const version = await this.getVersionById(versionId, tx);
      const masterId = version.masterId;

      const [optionGroups, variants, tags, images] = await Promise.all([
        this._fetchOptionGroups(masterId, versionId, tx),
        this._fetchVariants(masterId, versionId, tx),
        this._fetchTags(masterId, versionId, tx),
        this._fetchImages(versionId, tx),
      ]);

      const variantsWithOptions = await Promise.all(
        variants.map(async (v) => {
          const optionValues = await this._fetchVariantOptionValues(v.id, versionId, tx);
          return { ...v, optionValues };
        })
      );

      const primaryImage = images.find(img => img.isPrimary);
      const thumbnail = primaryImage ? primaryImage.fileId : null;
      const priceSummary =
        version.status === 'draft'
          ? null
          : (await this.priceCacheService.getPriceSummariesByVersionIds(
            [versionId],
            tx,
          )).get(versionId) ?? null;

      return {
        ...version,
        thumbnail,
        images,
        optionGroups,
        variants: variantsWithOptions,
        channelProducts: [],
        tagValues: tags,
        priceSummary,
      };
    }, tx);
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

      const { id, masterId, version, parentVersionId: _, status, draftOwnerId, createdAt, updatedAt, ...parentData } = parent;

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

      this.logger.log(
        `Created draft version ${newVersion.id} for master ${parent.masterId} from version ${parent.id}`,
      );

      return newVersion;
    }, tx);
  }

  /**
   * Draft 버전을 Active로 Publish
   * 기존 Active 버전이 있으면 자동으로 Inactive로 전환됨
   */
  async publishVersion(
    versionId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.inTx(async (tx) => {
      const version = await this.getVersionById(versionId, tx);

      if (version.status !== 'draft') {
        throw new BadRequestException('Only draft versions can be published');
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
        .where(
          and(
            eq(productMasterVersions.masterId, version.masterId),
            eq(productMasterVersions.status, 'active'),
          ),
        );

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
      await this._publishVariantChangeEvents(
        version,
        previousActiveVersion,
        tx,
      );

      await this._emitActiveVersionChangedEvent(
        version,
        previousActiveVersion,
        'active',
        tx,
      );

      this.logger.log(
        `Published version ${version.id} of master ${version.masterId} as active`,
      );
    }, tx);
  }

  /**
   * Master의 Active 버전을 Inactive로 전환 (상품 비공개)
   */
  async unpublishMaster(
    masterId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.inTx(async (tx) => {
      const activeVersion = await this.getActiveVersion(masterId, tx);

      // active를 inactive로 전환
      await tx
        .update(productMasterVersions)
        .set({ status: 'inactive', updatedAt: new Date() })
        .where(eq(productMasterVersions.id, activeVersion.id));

      await this._emitActiveVersionChangedEvent(
        activeVersion,
        activeVersion,
        'inactive',
        tx,
      );

      this.logger.log(
        `Unpublished master ${masterId} (version ${activeVersion.version} → inactive)`,
      );
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
      const changeReason = targetStatus === 'inactive'
        ? 'unpublished'
        : previousActiveVersion
          ? 'rollback'
          : 'published';

      await this.productPublisher.publishEvent({
        eventType: 'ProductMasterActiveVersionChanged',
        aggregateId: newVersion.masterId,
        payload: {
          masterId: newVersion.masterId,
          productId: targetStatus === 'active' ? newVersion.id : null,
          version: targetStatus === 'active' ? newVersion.version : null,
          name: targetStatus === 'active' ? newVersion.name : null,
          previousActiveVersionId: previousActiveVersion?.id || null,
          changeReason,
          changedAt: new Date().toISOString(),
        },
      });

      this.logger.log(
        `📤 Published ProductMasterActiveVersionChanged: ${newVersion.masterId} (${changeReason})`,
      );
    } catch (error) {
      this.logger.error(
        `❌ Failed to publish ProductMasterActiveVersionChanged: ${newVersion.masterId}`,
        error.stack,
      );
    }
  }

  /**
   * publish 시 variant 변경 이벤트 발행
   */
  private async _publishVariantChangeEvents(
    newVersion: ProductMasterVersion,
    oldVersion: ProductMasterVersion | null,
    tx: DbTransaction,
  ): Promise<void> {
    const newVariantIds = await this.getVersionVariants(
      newVersion.masterId,
      newVersion.id,
      tx,
    );

    const oldVariantIds = oldVersion
      ? await this.getVersionVariants(
        oldVersion.masterId,
        oldVersion.id,
        tx,
      )
      : [];

    const addedVariantIds = newVariantIds.filter(
      (id) => !oldVariantIds.includes(id),
    );
    const deletedVariantIds = oldVariantIds.filter(
      (id) => !newVariantIds.includes(id),
    );

    if (deletedVariantIds.length > 0) {
      this.logger.log(
        `VARIANT_DELETED event: ${deletedVariantIds.length} variants deleted from master ${newVersion.masterId}`,
      );
    }

    if (addedVariantIds.length > 0) {
      this.logger.log(
        `VARIANT_ADDED event: ${addedVariantIds.length} variants added to master ${newVersion.masterId}`,
      );
    }

    if (addedVariantIds.length === 0 && deletedVariantIds.length === 0) {
      this.logger.log(`No variant changes for master ${newVersion.masterId}`);
    }
  }

  async compareVersions(
    versionId1: string,
    versionId2: string,
    tx?: DbTransaction,
  ): Promise<VersionDiffDto[]> {
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

  async getVersionOptionGroups(
    masterId: string,
    versionId: string,
    tx?: DbTransaction,
  ): Promise<string[]> {
    return this.inTx(async (tx) => {
      const mappings = await tx
        .select()
        .from(productMasterOptionGroups)
        .where(
          and(
            eq(productMasterOptionGroups.masterId, masterId),
            eq(productMasterOptionGroups.versionId, versionId),
          ),
        );

      return mappings.map((m) => m.optionGroupId);
    }, tx);
  }

  async getVersionVariants(
    masterId: string,
    versionId: string,
    tx?: DbTransaction,
  ): Promise<string[]> {
    return this.inTx(async (tx) => {
      const mappings = await tx
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, masterId),
            eq(productMasterVariants.versionId, versionId),
          ),
        );

      return mappings.map((m) => m.variantId);
    }, tx);
  }

  async getVersionPricingRules(
    masterId: string,
    versionId: string,
    tx?: DbTransaction,
  ): Promise<string[]> {
    return this.inTx(async (tx) => {
      const mappings = await tx
        .select()
        .from(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, masterId),
            eq(productMasterPricingRules.versionId, versionId),
          ),
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
        and(
          eq(productMasterOptionGroups.masterId, masterId),
          eq(productMasterOptionGroups.versionId, fromVersionId),
        ),
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
      .where(
        and(
          eq(productMasterVariants.masterId, masterId),
          eq(productMasterVariants.versionId, fromVersionId),
        ),
      );

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
        and(
          eq(productMasterPricingRules.masterId, masterId),
          eq(productMasterPricingRules.versionId, fromVersionId),
        ),
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
      .innerJoin(
        tagValues,
        eq(productTagValues.tagValueId, tagValues.id)
      )
      .where(
        and(
          eq(productTagValues.masterId, masterId),
          eq(productTagValues.versionId, fromVersionId),
          eq(tagValues.isActive, true)
        )
      );

    if (tagValueMappings.length > 0) {
      await tx.insert(productTagValues).values(
        tagValueMappings.map((tv) => ({
          masterId,
          versionId: toVersionId,
          tagValueId: tv.tagValueId,
        }))
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
        }))
      );
    }

    this.logger.log(
      `Copied mappings and displays from version ${fromVersionId} to ${toVersionId} for master ${masterId}: ` +
      `${optionGroups.length} option groups, ${variants.length} variants, ${pricingRules.length} pricing rules, ${tagValueMappings.length} active tag values, ${images.length} images`,
    );
  }

  /**
   * Draft 버전 삭제 (고아 variant도 정리)
   */
  async deleteDraftVersion(
    versionId: string,
    tx?: DbTransaction,
  ): Promise<void> {
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
          and(
            eq(productMasterVariants.masterId, version.masterId),
            eq(productMasterVariants.versionId, version.id),
          ),
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
          and(
            eq(productMasterVariants.masterId, version.masterId),
            eq(productMasterVariants.versionId, version.id),
          ),
        );

      await tx
        .delete(productTagValues)
        .where(
          and(
            eq(productTagValues.masterId, version.masterId),
            eq(productTagValues.versionId, version.id)
          )
        );

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
      await tx
        .delete(productMasterVersions)
        .where(eq(productMasterVersions.id, versionId));

      // 5. 고아 variant 정리
      if (variantIds.length > 0) {
        await this._cleanupOrphanedVariantsAfterDeletion(
          version.masterId,
          variantIds,
          tx,
        );
      }

      // 6. 고아 pricing rules 정리
      if (pricingRuleMappings.length > 0) {
        await this._cleanupOrphanedPricingRules(
          pricingRuleMappings.map((m) => m.pricingRuleId),
          tx,
        );
      }

      this.logger.log(
        `Deleted draft version ${version.id} of master ${version.masterId}`,
      );
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
        .where(
          and(
            eq(productMasterVariants.masterId, masterId),
            eq(productMasterVariants.variantId, variantId),
          ),
        );

      if (remainingMappings.length === 0) {
        // 더 이상 참조하는 버전이 없으면 삭제
        await tx
          .delete(productVariants)
          .where(eq(productVariants.id, variantId));

        deletedCount++;
        this.logger.log(
          `Deleted orphaned variant entity: ${variantId} (no longer referenced after draft deletion)`,
        );
      }
    }

    if (deletedCount > 0) {
      this.logger.log(
        `Cleaned up ${deletedCount} orphaned variant entities`,
      );
    }
  }

  /**
   * 고아 pricing rule 정리 (deleteDraftVersion용)
   */
  private async _cleanupOrphanedPricingRules(
    candidateRuleIds: string[],
    tx: DbTransaction,
  ): Promise<void> {
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
        await tx
          .delete(pricingRules)
          .where(eq(pricingRules.id, ruleId));
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      this.logger.log(
        `Cleaned up ${deletedCount} orphaned pricing rules`,
      );
    }
  }

  private async _fetchOptionGroups(
    masterId: string,
    versionId: string,
    tx: DbTransaction,
  ): Promise<any[]> {
    const optionGroupResults = await tx
      .select({
        id: productOptionGroups.id,
        displayName: productOptionGroupDisplays.displayName,
        sortOrder: productOptionGroupDisplays.sortOrder,
        createdAt: productOptionGroups.createdAt,
      })
      .from(productMasterOptionGroups)
      .innerJoin(
        productOptionGroups,
        eq(productMasterOptionGroups.optionGroupId, productOptionGroups.id),
      )
      .innerJoin(
        productOptionGroupDisplays,
        and(
          eq(productOptionGroups.id, productOptionGroupDisplays.optionGroupId),
          eq(productOptionGroupDisplays.masterId, masterId),
          eq(productOptionGroupDisplays.versionId, versionId),
          eq(productOptionGroupDisplays.locale, 'ko-KR'),
        ),
      )
      .where(
        and(
          eq(productMasterOptionGroups.masterId, masterId),
          eq(productMasterOptionGroups.versionId, versionId),
        ),
      )
      .orderBy(asc(productOptionGroupDisplays.sortOrder));

    const optionGroupIds = optionGroupResults.map(g => g.id);

    if (optionGroupIds.length === 0) {
      return [];
    }

    const allValues = await tx
      .select({
        id: productOptionValues.id,
        optionGroupId: productOptionValues.optionGroupId,
        displayName: productOptionValueDisplays.displayName,
        sortOrder: productOptionValueDisplays.sortOrder,
        createdAt: productOptionValues.createdAt,
      })
      .from(productOptionValues)
      .innerJoin(
        productOptionValueDisplays,
        and(
          eq(productOptionValues.id, productOptionValueDisplays.optionValueId),
          eq(productOptionValueDisplays.masterId, masterId),
          eq(productOptionValueDisplays.versionId, versionId),
          eq(productOptionValueDisplays.locale, 'ko-KR'),
        ),
      )
      .where(inArray(productOptionValues.optionGroupId, optionGroupIds))
      .orderBy(
        asc(productOptionValues.optionGroupId),
        asc(productOptionValueDisplays.sortOrder),
      );

    const valuesByGroup = new Map<string, typeof allValues>();
    for (const v of allValues) {
      const list = valuesByGroup.get(v.optionGroupId) ?? [];
      list.push(v);
      valuesByGroup.set(v.optionGroupId, list);
    }

    return optionGroupResults.map(group => ({
      ...group,
      values: valuesByGroup.get(group.id) ?? [],
    }));
  }

  private async _fetchVariants(
    masterId: string,
    versionId: string,
    tx: DbTransaction,
  ): Promise<any[]> {
    const variantResults = await tx
      .select()
      .from(productMasterVariants)
      .innerJoin(
        productVariants,
        eq(productMasterVariants.variantId, productVariants.id),
      )
      .where(
        and(
          eq(productMasterVariants.masterId, masterId),
          eq(productMasterVariants.versionId, versionId),
        ),
      )
      .orderBy(asc(productVariants.displayOrder));

    return variantResults.map((r) => r.product_variants);
  }

  private async _fetchTags(
    masterId: string,
    versionId: string,
    tx: DbTransaction,
  ): Promise<Array<{ id: string; name: string; displayOrder: number; groupId: string; groupName: string }>> {
    const tagResults = await tx
      .select({
        tagValueId: productTagValues.tagValueId,
        tagValueName: tagValues.name,
        tagValueDisplayOrder: tagValues.displayOrder,
        tagGroupId: tagGroups.id,
        tagGroupName: tagGroups.name,
      })
      .from(productTagValues)
      .innerJoin(
        tagValues,
        eq(productTagValues.tagValueId, tagValues.id)
      )
      .innerJoin(
        tagGroups,
        eq(tagValues.groupId, tagGroups.id)
      )
      .where(
        and(
          eq(productTagValues.masterId, masterId),
          eq(productTagValues.versionId, versionId),
          eq(tagValues.isActive, true),
          eq(tagGroups.isActive, true)
        )
      )
      .orderBy(
        asc(tagGroups.displayOrder),
        asc(tagValues.displayOrder)
      );

    return tagResults.map(r => ({
      id: r.tagValueId,
      name: r.tagValueName,
      displayOrder: r.tagValueDisplayOrder,
      groupId: r.tagGroupId,
      groupName: r.tagGroupName,
    }));
  }

  private async _fetchImages(
    versionId: string,
    tx: DbTransaction,
  ): Promise<any[]> {
    return await tx
      .select()
      .from(productImages)
      .where(eq(productImages.versionId, versionId))
      .orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder));
  }

  private async _fetchVariantOptionValues(
    variantId: string,
    versionId: string,
    tx: DbTransaction,
  ): Promise<any[]> {
    const optionValues = await tx
      .select({
        id: productOptionValues.id,
        optionGroupId: productOptionValues.optionGroupId,
        displayName: productOptionValueDisplays.displayName,
        sortOrder: productOptionValueDisplays.sortOrder,
        createdAt: productOptionValues.createdAt,
      })
      .from(variantOptionValues)
      .innerJoin(
        productOptionValues,
        eq(variantOptionValues.optionValueId, productOptionValues.id),
      )
      .innerJoin(
        productOptionValueDisplays,
        and(
          eq(productOptionValues.id, productOptionValueDisplays.optionValueId),
          eq(productOptionValueDisplays.versionId, versionId),
          eq(productOptionValueDisplays.locale, 'ko-KR'),
        ),
      )
      .innerJoin(
        productOptionGroups,
        eq(productOptionValues.optionGroupId, productOptionGroups.id),
      )
      .innerJoin(
        productOptionGroupDisplays,
        and(
          eq(productOptionGroups.id, productOptionGroupDisplays.optionGroupId),
          eq(productOptionGroupDisplays.versionId, versionId),
          eq(productOptionGroupDisplays.locale, 'ko-KR'),
        ),
      )
      .where(eq(variantOptionValues.variantId, variantId))
      .orderBy(
        asc(productOptionGroupDisplays.sortOrder),
        asc(productOptionValueDisplays.sortOrder),
      );

    return optionValues;
  }
}
