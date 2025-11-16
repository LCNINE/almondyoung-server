import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import {
  ProductMaster,
  DbTransaction,
  VersionTreeNode,
  VersionDiffDto,
  VersionStatus,
} from '../../../types';
import {
  type PimSchema,
  productMasters,
  productMasterOptionGroups,
  productMasterVariants,
  productMasterPricingRules,
} from '../../../schema';
import { eq, and, sql, max as drizzleMax } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

@Injectable()
export class ProductVersionsService {
  private readonly logger = new Logger(ProductVersionsService.name);

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
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
        .from(productMasters)
        .where(eq(productMasters.masterId, masterId))
        .orderBy(productMasters.version);

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

  async getActiveVersion(masterId: string, tx?: DbTransaction): Promise<ProductMaster> {
    return this.inTx(async (tx) => {
      const [activeVersion] = await tx
        .select()
        .from(productMasters)
        .where(
          and(
            eq(productMasters.masterId, masterId),
            eq(productMasters.versionStatus, 'active'),
          ),
        )
        .limit(1);

      if (!activeVersion) {
        throw new NotFoundException(`No active version found for master ${masterId}`);
      }

      return activeVersion;
    }, tx);
  }

  async getVersionById(versionId: string, tx?: DbTransaction): Promise<ProductMaster> {
    return this.inTx(async (tx) => {
      const [version] = await tx
        .select()
        .from(productMasters)
        .where(eq(productMasters.id, versionId))
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
  ): Promise<ProductMaster> {
    return this.inTx(async (tx) => {
      const parent = await this.getVersionById(parentVersionId, tx);

      const maxVersionResult = await tx
        .select({ max: drizzleMax(productMasters.version) })
        .from(productMasters)
        .where(eq(productMasters.masterId, parent.masterId));

      const nextVersion = (maxVersionResult[0]?.max || 0) + 1;

      const { id, masterId, version, parentVersionId: _, versionStatus, draftOwnerId, createdAt, updatedAt, ...parentData } = parent;

      const [newVersion] = await tx
        .insert(productMasters)
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

      if (targetStatus === 'active') {
        await tx
          .update(productMasters)
          .set({ versionStatus: 'inactive' })
          .where(
            and(
              eq(productMasters.masterId, version.masterId),
              eq(productMasters.versionStatus, 'active'),
            ),
          );
      }

      await tx
        .update(productMasters)
        .set({ versionStatus: targetStatus, draftOwnerId: null, updatedAt: new Date() })
        .where(eq(productMasters.id, versionId));

      this.logger.log(
        `Published version ${version.version} of master ${version.masterId} as ${targetStatus}`,
      );
    }, tx);
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

    this.logger.log(
      `Copied mappings from version ${fromVersion} to ${toVersion} for master ${masterId}: ${optionGroups.length} option groups, ${variants.length} variants, ${pricingRules.length} pricing rules`,
    );
  }
}

