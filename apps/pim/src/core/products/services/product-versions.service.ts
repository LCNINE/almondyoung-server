import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { InjectStreamPublisher, StreamPublisher } from '@app/events';
import { ProductEvents, PRODUCT_STREAM } from '@packages/event-contracts';
import {
  ProductMasterVersion,
  DbTransaction,
  VersionTreeNode,
  VersionDiffDto,
  VersionStatus,
} from '../../../types';
import {
  type PimSchema,
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
} from '../../../schema';
import { eq, and, sql, max as drizzleMax } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

@Injectable()
export class ProductVersionsService {
  private readonly logger = new Logger(ProductVersionsService.name);

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    @InjectStreamPublisher(PRODUCT_STREAM.topic.topic)
    private readonly productPublisher: StreamPublisher<ProductEvents>,
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
          versionStatus: version.versionStatus as VersionStatus,
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
      const [activeVersion] = await tx
        .select()
        .from(productMasterVersions)
        .where(
          and(
            eq(productMasterVersions.masterId, masterId),
            eq(productMasterVersions.versionStatus, 'active'),
          ),
        )
        .limit(1);

      if (!activeVersion) {
        throw new NotFoundException(`No active version found for master ${masterId}`);
      }

      return activeVersion;
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

      const { id, masterId, version, parentVersionId: _, versionStatus, draftOwnerId, createdAt, updatedAt, ...parentData } = parent;

      const [newVersion] = await tx
        .insert(productMasterVersions)
        .values({
          ...parentData,
          id: uuidv7(),
          masterId: parent.masterId,
          version: nextVersion,
          parentVersionId: parentVersionId,
          versionStatus: 'draft',
          draftOwnerId: userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      if (copyMappings) {
        await this._copyMappings(tx, parent.masterId, parent.version, newVersion.version);
      }

      this.logger.log(
        `Created draft version ${newVersion.version} for master ${parent.masterId} from version ${parent.version}`,
      );

      return newVersion;
    }, tx);
  }

  async publishVersion(
    versionId: string,
    targetStatus: 'active' | 'inactive',
    tx?: DbTransaction,
  ): Promise<void> {
    return this.inTx(async (tx) => {
      const version = await this.getVersionById(versionId, tx);

      if (version.versionStatus !== 'draft') {
        throw new BadRequestException('Only draft versions can be published');
      }

      let previousActiveVersion: ProductMasterVersion | null = null;

      if (targetStatus === 'active') {
        // 기존 active 버전 조회
        try {
          previousActiveVersion = await this.getActiveVersion(version.masterId, tx);
        } catch (e) {
          this.logger.debug(`No previous active version for ${version.masterId}`);
        }

        // 기존 active를 inactive로
        await tx
          .update(productMasterVersions)
          .set({ versionStatus: 'inactive' })
          .where(
            and(
              eq(productMasterVersions.masterId, version.masterId),
              eq(productMasterVersions.versionStatus, 'active'),
            ),
          );
      }

      // draft를 publish
      await tx
        .update(productMasterVersions)
        .set({ versionStatus: targetStatus, draftOwnerId: null, updatedAt: new Date() })
        .where(eq(productMasterVersions.id, versionId));

      // 이벤트 발행: 추가/삭제된 variant만
      if (targetStatus === 'active') {
        await this._publishVariantChangeEvents(
          version,
          previousActiveVersion,
          tx,
        );
      }

      await this._emitActiveVersionChangedEvent(
        version,
        previousActiveVersion,
        targetStatus,
        tx,
      );

      this.logger.log(
        `Published version ${version.version} of master ${version.masterId} as ${targetStatus}`,
      );
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
      newVersion.version,
      tx,
    );

    const oldVariantIds = oldVersion
      ? await this.getVersionVariants(
        oldVersion.masterId,
        oldVersion.version,
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

      if (version.versionStatus !== 'draft') {
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
    version: number,
    optionGroupId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.inTx(async (tx) => {
      await tx.insert(productMasterOptionGroups).values({
        id: uuidv7(),
        masterId,
        optionGroupId,
        version,
        createdAt: new Date(),
      });
    }, tx);
  }

  async unlinkOptionGroupFromVersion(
    masterId: string,
    version: number,
    optionGroupId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.inTx(async (tx) => {
      await tx
        .delete(productMasterOptionGroups)
        .where(
          and(
            eq(productMasterOptionGroups.masterId, masterId),
            eq(productMasterOptionGroups.version, version),
            eq(productMasterOptionGroups.optionGroupId, optionGroupId),
          ),
        );
    }, tx);
  }

  async linkVariantToVersion(
    masterId: string,
    version: number,
    variantId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.inTx(async (tx) => {
      await tx.insert(productMasterVariants).values({
        id: uuidv7(),
        masterId,
        variantId,
        version,
        createdAt: new Date(),
      });
    }, tx);
  }

  async unlinkVariantFromVersion(
    masterId: string,
    version: number,
    variantId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.inTx(async (tx) => {
      await tx
        .delete(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, masterId),
            eq(productMasterVariants.version, version),
            eq(productMasterVariants.variantId, variantId),
          ),
        );
    }, tx);
  }

  async linkPricingRuleToVersion(
    masterId: string,
    version: number,
    pricingRuleId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.inTx(async (tx) => {
      await tx.insert(productMasterPricingRules).values({
        id: uuidv7(),
        masterId,
        pricingRuleId,
        version,
        createdAt: new Date(),
      });
    }, tx);
  }

  async unlinkPricingRuleFromVersion(
    masterId: string,
    version: number,
    pricingRuleId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.inTx(async (tx) => {
      await tx
        .delete(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, masterId),
            eq(productMasterPricingRules.version, version),
            eq(productMasterPricingRules.pricingRuleId, pricingRuleId),
          ),
        );
    }, tx);
  }

  async getVersionOptionGroups(
    masterId: string,
    version: number,
    tx?: DbTransaction,
  ): Promise<string[]> {
    return this.inTx(async (tx) => {
      const mappings = await tx
        .select()
        .from(productMasterOptionGroups)
        .where(
          and(
            eq(productMasterOptionGroups.masterId, masterId),
            eq(productMasterOptionGroups.version, version),
          ),
        );

      return mappings.map((m) => m.optionGroupId);
    }, tx);
  }

  async getVersionVariants(
    masterId: string,
    version: number,
    tx?: DbTransaction,
  ): Promise<string[]> {
    return this.inTx(async (tx) => {
      const mappings = await tx
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, masterId),
            eq(productMasterVariants.version, version),
          ),
        );

      return mappings.map((m) => m.variantId);
    }, tx);
  }

  async getVersionPricingRules(
    masterId: string,
    version: number,
    tx?: DbTransaction,
  ): Promise<string[]> {
    return this.inTx(async (tx) => {
      const mappings = await tx
        .select()
        .from(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, masterId),
            eq(productMasterPricingRules.version, version),
          ),
        );

      return mappings.map((m) => m.pricingRuleId);
    }, tx);
  }

  private async _copyMappings(
    tx: DbTransaction,
    masterId: string,
    fromVersion: number,
    toVersion: number,
  ): Promise<void> {
    const optionGroups = await tx
      .select()
      .from(productMasterOptionGroups)
      .where(
        and(
          eq(productMasterOptionGroups.masterId, masterId),
          eq(productMasterOptionGroups.version, fromVersion),
        ),
      );

    if (optionGroups.length > 0) {
      await tx.insert(productMasterOptionGroups).values(
        optionGroups.map((og) => ({
          id: uuidv7(),
          masterId,
          optionGroupId: og.optionGroupId,
          version: toVersion,
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
            eq(productOptionGroupDisplays.version, fromVersion),
          ),
        );

      if (groupDisplays.length > 0) {
        await tx.insert(productOptionGroupDisplays).values(
          groupDisplays.map((gd) => ({
            id: uuidv7(),
            optionGroupId: gd.optionGroupId,
            masterId,
            version: toVersion,
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
            eq(productOptionValueDisplays.version, fromVersion),
          ),
        );

      if (valueDisplays.length > 0) {
        await tx.insert(productOptionValueDisplays).values(
          valueDisplays.map((vd) => ({
            id: uuidv7(),
            optionValueId: vd.optionValueId,
            masterId,
            version: toVersion,
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
          eq(productMasterVariants.version, fromVersion),
        ),
      );

    if (variants.length > 0) {
      await tx.insert(productMasterVariants).values(
        variants.map((v) => ({
          id: uuidv7(),
          masterId,
          variantId: v.variantId,
          version: toVersion,
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
          eq(productMasterPricingRules.version, fromVersion),
        ),
      );

    if (pricingRules.length > 0) {
      await tx.insert(productMasterPricingRules).values(
        pricingRules.map((pr) => ({
          id: uuidv7(),
          masterId,
          pricingRuleId: pr.pricingRuleId,
          version: toVersion,
          createdAt: new Date(),
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
          eq(productTagValues.version, fromVersion),
          eq(tagValues.isActive, true)
        )
      );

    if (tagValueMappings.length > 0) {
      await tx.insert(productTagValues).values(
        tagValueMappings.map((tv) => ({
          masterId,
          version: toVersion,
          tagValueId: tv.tagValueId,
          createdAt: new Date(),
        }))
      );
    }

    this.logger.log(
      `Copied mappings and displays from version ${fromVersion} to ${toVersion} for master ${masterId}: ` +
      `${optionGroups.length} option groups, ${variants.length} variants, ${pricingRules.length} pricing rules, ${tagValueMappings.length} active tag values`,
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

      if (version.versionStatus !== 'draft') {
        throw new BadRequestException('Only draft versions can be deleted');
      }

      // 1. 이 버전이 참조하는 variant 목록 조회
      const variantMappings = await tx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, version.masterId),
            eq(productMasterVariants.version, version.version),
          ),
        );

      const variantIds = variantMappings.map((m) => m.variantId);

      // 2. Display 정보 삭제
      await tx
        .delete(productOptionGroupDisplays)
        .where(
          and(
            eq(productOptionGroupDisplays.masterId, version.masterId),
            eq(productOptionGroupDisplays.version, version.version),
          ),
        );

      await tx
        .delete(productOptionValueDisplays)
        .where(
          and(
            eq(productOptionValueDisplays.masterId, version.masterId),
            eq(productOptionValueDisplays.version, version.version),
          ),
        );

      // 3. 매핑 테이블 삭제
      await tx
        .delete(productMasterOptionGroups)
        .where(
          and(
            eq(productMasterOptionGroups.masterId, version.masterId),
            eq(productMasterOptionGroups.version, version.version),
          ),
        );

      await tx
        .delete(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, version.masterId),
            eq(productMasterVariants.version, version.version),
          ),
        );

      await tx
        .delete(productTagValues)
        .where(
          and(
            eq(productTagValues.masterId, version.masterId),
            eq(productTagValues.version, version.version)
          )
        );

      // 3. 가격 규칙 매핑 삭제 (고아 정리 포함)
      const pricingRuleMappings = await tx
        .select({ pricingRuleId: productMasterPricingRules.pricingRuleId })
        .from(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, version.masterId),
            eq(productMasterPricingRules.version, version.version),
          ),
        );

      await tx
        .delete(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, version.masterId),
            eq(productMasterPricingRules.version, version.version),
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
        `Deleted draft version ${version.version} of master ${version.masterId}`,
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
        .select({ version: productMasterVariants.version })
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
}

