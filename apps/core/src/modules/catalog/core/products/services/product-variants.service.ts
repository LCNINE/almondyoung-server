import { BadRequestException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { ProductVariant, UpdateProductVariant, DbTransaction } from '../../../catalog.types';
import { ProductVariantMapper } from '../mappers';
import { VariantWithPriceDto } from '../dto/variants/variant-response.dto';
import {
  type PimSchema,
  productMasters,
  productVariants,
  productMasterVersions,
  productMasterVariants,
  productMasterPricingRules,
  pricingRules,
  productOptionGroups,
  productOptionValues,
  productOptionGroupDisplays,
  productOptionValueDisplays,
  variantOptionValues,
} from '../../../schema/catalog.schema';
import { eq, ne, and, or, like, ilike, count, asc, desc, sql, inArray, SQL, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { UpdateProductVariantDto, UpdateVariantBulkDto } from '../dto';
import { ProductVersionsService } from './product-versions.service';
import { VariantPriceCacheService } from '../../pricing/variant-price-cache.service';
import { VariantAssetLinkService } from '../../../../library/services/variant-asset-link.service';

type VariantDetailKeysParam = { variantId: string; versionId: string } | { variantId: string; masterId: string };
type VariantOptionsKeysParam = { variantId: string; versionId: string } | { variantId: string; masterId: string };

@Injectable()
export class ProductVariantsService {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly productVersionsService: ProductVersionsService,
    private readonly priceCacheService: VariantPriceCacheService,
    private readonly variantAssetLinkService: VariantAssetLinkService,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.db.db;
  }

  private async inTx<T>(fn: (tx: DbTransaction) => Promise<T>, tx?: DbTransaction): Promise<T> {
    return tx ? fn(tx) : this.db.db.transaction(fn);
  }

  async getVariantsByMaster(
    masterId: string,
    versionId?: string,
    filters?: {
      status?: string;
      includePrice?: boolean;
      page?: number;
      limit?: number;
    },
    tx?: DbTransaction,
  ): Promise<{
    data: VariantWithPriceDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    if (!masterId) {
      throw new BadRequestException('Master ID is required');
    }

    const client = this.getClient(tx);

    const page = filters?.page || 1;
    const limit = Math.min(filters?.limit || 20, 100);
    const offset = (page - 1) * limit;
    const includePrice = filters?.includePrice !== false;

    // version이 지정되지 않으면 active 버전 사용
    let actualVersionId: string;
    if (versionId === undefined) {
      const [activeVersion] = await client
        .select({ id: productMasterVersions.id })
        .from(productMasterVersions)
        .where(and(eq(productMasterVersions.masterId, masterId), eq(productMasterVersions.status, 'active')))
        .limit(1);

      if (!activeVersion) {
        throw new NotFoundException(`No active version found for master ${masterId}`);
      }
      actualVersionId = activeVersion.id;
    } else {
      const [version] = await client
        .select({ id: productMasterVersions.id })
        .from(productMasterVersions)
        .where(eq(productMasterVersions.id, versionId));

      if (!version) {
        throw new NotFoundException(`Version not found: ${versionId}`);
      }
      actualVersionId = version.id;
    }

    // 매핑 테이블을 통해 variants 조회
    const whereConditions: SQL[] = [
      eq(productMasterVariants.masterId, masterId),
      eq(productMasterVariants.versionId, actualVersionId),
    ];

    if (filters?.status) {
      whereConditions.push(eq(productVariants.status, filters.status));
    }

    const whereClause = and(...whereConditions);

    const countQuery = client
      .select({ count: count() })
      .from(productMasterVariants)
      .innerJoin(productVariants, eq(productMasterVariants.variantId, productVariants.id))
      .where(whereClause);

    const [{ count: total }] = await countQuery;

    const variants = await client
      .select()
      .from(productMasterVariants)
      .innerJoin(productVariants, eq(productMasterVariants.variantId, productVariants.id))
      .where(whereClause)
      .orderBy(asc(productVariants.displayOrder), asc(productVariants.createdAt))
      .limit(limit)
      .offset(offset);

    const variantsWithPriceData: VariantWithPriceDto[] = [];

    let priceMap = new Map<string, number>();
    if (includePrice) {
      const cachedPrices = await this.priceCacheService.getCachedPriceSetsByVersion(actualVersionId, tx);
      priceMap = new Map(cachedPrices.map((p) => [p.variantId, p.basePrice]));
    }

    for (const row of variants) {
      const variant = row.product_variants;
      let price = 0;
      let optionValues: Array<{
        id: string;
        optionGroupId: string;
        createdAt: Date | null;
      }> = [];

      if (includePrice) {
        price = priceMap.get(variant.id) ?? 0;
      }

      // TODO: Update to use Display tables with masterId and version
      // For now, returning basic info without Display data
      optionValues = await client
        .select({
          id: productOptionValues.id,
          optionGroupId: productOptionValues.optionGroupId,
          createdAt: productOptionValues.createdAt,
        })
        .from(variantOptionValues)
        .innerJoin(productOptionValues, eq(variantOptionValues.optionValueId, productOptionValues.id))
        .innerJoin(productOptionGroups, eq(productOptionValues.optionGroupId, productOptionGroups.id))
        .where(eq(variantOptionValues.variantId, variant.id));

      variantsWithPriceData.push(
        ProductVariantMapper.toWithPriceDto(
          {
            ...variant,
            versionId: actualVersionId,
            masterId: row.product_master_variants.masterId,
            optionValues,
          },
          price,
        ),
      );
    }

    return {
      data: variantsWithPriceData,
      total,
      page,
      limit,
    };
  }

  async getVariantDetail(keys: VariantDetailKeysParam, tx?: DbTransaction): Promise<VariantWithPriceDto | null> {
    return await this.inTx(async (tx) => {
      // version ID를 결정
      let versionId: string;
      let masterId: string;

      if ('versionId' in keys) {
        versionId = keys.versionId;
        const [version] = await tx
          .select({ masterId: productMasterVersions.masterId })
          .from(productMasterVersions)
          .where(eq(productMasterVersions.id, versionId))
          .limit(1);

        if (!version) {
          throw new NotFoundException(`Version ${versionId} not found`);
        }

        masterId = version.masterId;
      } else {
        const activeVersion = await this.productVersionsService.getActiveVersion(keys.masterId, tx);
        versionId = activeVersion.id;
        masterId = keys.masterId;
      }

      const variantId = keys.variantId;

      const [variant] = await tx.select().from(productVariants).where(eq(productVariants.id, variantId)).limit(1);

      if (!variant) {
        throw new NotFoundException(`Variant ${variantId} not found`);
      }

      // Display 테이블을 통해 optionValues 조회
      const optionValues = await tx
        .select({
          id: productOptionValues.id,
          optionGroupId: productOptionValues.optionGroupId,
          displayName: productOptionValueDisplays.displayName,
          sortOrder: productOptionValueDisplays.sortOrder,
          createdAt: productOptionValues.createdAt,
        })
        .from(variantOptionValues)
        .innerJoin(productOptionValues, eq(variantOptionValues.optionValueId, productOptionValues.id))
        .innerJoin(
          productOptionValueDisplays,
          and(
            eq(productOptionValues.id, productOptionValueDisplays.optionValueId),
            eq(productOptionValueDisplays.versionId, versionId),
            eq(productOptionValueDisplays.locale, 'ko-KR'),
          ),
        )
        .innerJoin(productOptionGroups, eq(productOptionValues.optionGroupId, productOptionGroups.id))
        .innerJoin(
          productOptionGroupDisplays,
          and(
            eq(productOptionGroups.id, productOptionGroupDisplays.optionGroupId),
            eq(productOptionGroupDisplays.versionId, versionId),
            eq(productOptionGroupDisplays.locale, 'ko-KR'),
          ),
        )
        .where(eq(variantOptionValues.variantId, variantId))
        .orderBy(asc(productOptionGroupDisplays.sortOrder), asc(productOptionValueDisplays.sortOrder));

      let price: number;
      try {
        price = await this.calculateVariantPrice(variantId, tx);
      } catch (error) {
        console.warn(`Failed to calculate price for variant ${variantId}:`, error.message);
        price = 0;
      }

      return ProductVariantMapper.toWithPriceDto(
        {
          ...variant,
          masterId,
          versionId,
          optionValues,
        },
        price,
      );
    }, tx);
  }

  async getVariantOptions(
    keys: VariantOptionsKeysParam,
    tx?: DbTransaction,
  ): Promise<
    Array<{
      optionGroup: {
        id: string;
        displayName: string;
        sortOrder: number | null;
      };
      optionValue: {
        id: string;
        displayName: string;
        sortOrder: number | null;
      };
    }>
  > {
    return await this.inTx(async (tx) => {
      let versionId: string;
      let masterId: string;

      if ('versionId' in keys) {
        versionId = keys.versionId;
        const [version] = await tx
          .select({ masterId: productMasterVersions.masterId })
          .from(productMasterVersions)
          .where(eq(productMasterVersions.id, versionId))
          .limit(1);

        if (!version) {
          throw new NotFoundException(`Version ${versionId} not found`);
        }

        masterId = version.masterId;
      } else {
        const activeVersion = await this.productVersionsService.getActiveVersion(keys.masterId, tx);
        versionId = activeVersion.id;
        masterId = keys.masterId;
      }

      const variantId = keys.variantId;

      // Display 테이블을 통해 optionInfo 조회
      const optionInfo = await tx
        .select({
          optionGroup: {
            id: productOptionGroups.id,
            displayName: productOptionGroupDisplays.displayName,
            sortOrder: productOptionGroupDisplays.sortOrder,
          },
          optionValue: {
            id: productOptionValues.id,
            displayName: productOptionValueDisplays.displayName,
            sortOrder: productOptionValueDisplays.sortOrder,
          },
        })
        .from(variantOptionValues)
        .innerJoin(productOptionValues, eq(variantOptionValues.optionValueId, productOptionValues.id))
        .innerJoin(
          productOptionValueDisplays,
          and(
            eq(productOptionValues.id, productOptionValueDisplays.optionValueId),
            eq(productOptionValueDisplays.versionId, versionId),
            eq(productOptionValueDisplays.locale, 'ko-KR'),
          ),
        )
        .innerJoin(productOptionGroups, eq(productOptionValues.optionGroupId, productOptionGroups.id))
        .innerJoin(
          productOptionGroupDisplays,
          and(
            eq(productOptionGroups.id, productOptionGroupDisplays.optionGroupId),
            eq(productOptionGroupDisplays.versionId, versionId),
            eq(productOptionGroupDisplays.locale, 'ko-KR'),
          ),
        )
        .where(eq(variantOptionValues.variantId, variantId))
        .orderBy(asc(productOptionGroupDisplays.sortOrder), asc(productOptionValueDisplays.sortOrder));

      return optionInfo;
    }, tx);
  }

  /**
   * Draft 버전 컨텍스트에서 variant 를 편집한다. variantId 가 draft 외 다른 버전과
   * 공유 매핑되어 있으면 copy-on-write 로 새 row 를 만들고 draft 의 정션만 repoint.
   * 같은 트랜잭션 내에서 그 variantId 를 scopeTargetIds 에 포함하는 pricing rule 도
   * cascading CoW.
   *
   * docs/adr/0004-variant-draft-scoped-edit-cow.md.
   *
   * @returns 편집된 variant 의 (CoW 시 새) id 와 CoW 발생 여부
   */
  async updateVariantInDraft(
    masterId: string,
    versionId: string,
    variantId: string,
    data: UpdateProductVariantDto,
    tx?: DbTransaction,
  ): Promise<{ variantId: string; cowed: boolean }> {
    if (!masterId || !versionId || !variantId) {
      throw new BadRequestException('masterId, versionId, variantId are required');
    }

    return this.inTx(async (trx) => {
      const version = await this.productVersionsService.getVersionById(versionId, trx);
      if (version.masterId !== masterId) {
        throw new BadRequestException(`Version ${versionId} does not belong to master ${masterId}`);
      }
      if (version.status !== 'draft') {
        throw new BadRequestException('Variants can only be edited on draft versions');
      }

      const [mapping] = await trx
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, masterId),
            eq(productMasterVariants.versionId, versionId),
            eq(productMasterVariants.variantId, variantId),
          ),
        )
        .limit(1);
      if (!mapping) {
        throw new NotFoundException(`Variant ${variantId} is not mapped to version ${versionId}`);
      }

      const [sharedMapping] = await trx
        .select({ versionId: productMasterVariants.versionId })
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.variantId, variantId),
            ne(productMasterVariants.versionId, versionId),
          ),
        )
        .limit(1);

      if (!sharedMapping) {
        await this._applyVariantUpdate(variantId, data, trx);
        return { variantId, cowed: false };
      }

      const newVariantId = await this._cloneVariant(variantId, trx);
      await this._cloneVariantOptionValues(variantId, newVariantId, trx);

      await trx
        .update(productMasterVariants)
        .set({ variantId: newVariantId })
        .where(
          and(
            eq(productMasterVariants.masterId, masterId),
            eq(productMasterVariants.versionId, versionId),
            eq(productMasterVariants.variantId, variantId),
          ),
        );

      await this._cascadeVariantCoWToPricingRules(masterId, versionId, variantId, newVariantId, trx);
      // Library asset 매칭 정션도 함께 clone (docs/adr/0004 의 pricing cascading 과 같은 패턴)
      await this.variantAssetLinkService.cloneLinksForVariant(variantId, newVariantId, trx);
      await this._applyVariantUpdate(newVariantId, data, trx);

      return { variantId: newVariantId, cowed: true };
    }, tx);
  }

  async bulkUpdateVariantsInDraft(
    masterId: string,
    versionId: string,
    updates: Array<{ id: string } & UpdateProductVariantDto>,
    tx?: DbTransaction,
  ): Promise<Array<{ originalId: string; variantId: string; cowed: boolean }>> {
    if (!updates || updates.length === 0) {
      throw new BadRequestException('Updates are required');
    }

    return this.inTx(async (trx) => {
      const results: Array<{ originalId: string; variantId: string; cowed: boolean }> = [];
      for (const update of updates) {
        const { id, ...data } = update;
        const result = await this.updateVariantInDraft(masterId, versionId, id, data, trx);
        results.push({ originalId: id, ...result });
      }
      return results;
    }, tx);
  }

  private async _applyVariantUpdate(
    variantId: string,
    data: UpdateProductVariantDto,
    tx: DbTransaction,
  ): Promise<void> {
    const updateData: Partial<typeof productVariants.$inferInsert> = { updatedAt: new Date() };
    if (data.variantName !== undefined) updateData.variantName = data.variantName;
    if (data.imageId !== undefined) updateData.imageId = data.imageId;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.displayOrder !== undefined) updateData.displayOrder = data.displayOrder;
    if (data.variantCode !== undefined) updateData.variantCode = data.variantCode;

    await tx.update(productVariants).set(updateData).where(eq(productVariants.id, variantId));
  }

  private async _cloneVariant(sourceVariantId: string, tx: DbTransaction): Promise<string> {
    const [source] = await tx
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, sourceVariantId))
      .limit(1);
    if (!source) {
      throw new NotFoundException(`Variant ${sourceVariantId} not found`);
    }
    const newId = uuidv7();
    await tx.insert(productVariants).values({
      id: newId,
      variantName: source.variantName,
      imageId: source.imageId,
      displayOrder: source.displayOrder,
      status: source.status,
      isDefault: source.isDefault,
      variantCode: source.variantCode,
    });
    return newId;
  }

  private async _cloneVariantOptionValues(
    sourceVariantId: string,
    targetVariantId: string,
    tx: DbTransaction,
  ): Promise<void> {
    const sources = await tx
      .select({ optionValueId: variantOptionValues.optionValueId })
      .from(variantOptionValues)
      .where(eq(variantOptionValues.variantId, sourceVariantId));

    if (sources.length === 0) return;

    await tx.insert(variantOptionValues).values(
      sources.map((s) => ({
        variantId: targetVariantId,
        optionValueId: s.optionValueId,
      })),
    );
  }

  /**
   * Variant CoW 발생 시, 같은 draft 의 pricing rule 중 scopeType='variants' 이고
   * scopeTargetIds 에 oldVariantId 를 포함하는 룰들을 cascading CoW.
   * scopeType='with_option' 룰은 옵션값 기반이라 영향 없음.
   */
  private async _cascadeVariantCoWToPricingRules(
    masterId: string,
    versionId: string,
    oldVariantId: string,
    newVariantId: string,
    tx: DbTransaction,
  ): Promise<void> {
    const draftRules = await tx
      .select({
        ruleId: pricingRules.id,
        layer: pricingRules.layer,
        order: pricingRules.order,
        scopeType: pricingRules.scopeType,
        scopeTargetIds: pricingRules.scopeTargetIds,
        operationType: pricingRules.operationType,
        operationValue: pricingRules.operationValue,
        minQuantity: pricingRules.minQuantity,
      })
      .from(productMasterPricingRules)
      .innerJoin(pricingRules, eq(productMasterPricingRules.pricingRuleId, pricingRules.id))
      .where(
        and(
          eq(productMasterPricingRules.masterId, masterId),
          eq(productMasterPricingRules.versionId, versionId),
          eq(pricingRules.scopeType, 'variants'),
        ),
      );

    for (const rule of draftRules) {
      const targets = rule.scopeTargetIds ?? [];
      if (!targets.includes(oldVariantId)) continue;

      const newTargets = targets.map((id) => (id === oldVariantId ? newVariantId : id));

      const [otherMapping] = await tx
        .select({ versionId: productMasterPricingRules.versionId })
        .from(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.pricingRuleId, rule.ruleId),
            ne(productMasterPricingRules.versionId, versionId),
          ),
        )
        .limit(1);

      if (otherMapping) {
        const newRuleId = uuidv7();
        await tx.insert(pricingRules).values({
          id: newRuleId,
          layer: rule.layer,
          order: rule.order,
          scopeType: rule.scopeType,
          scopeTargetIds: newTargets,
          operationType: rule.operationType,
          operationValue: rule.operationValue,
          minQuantity: rule.minQuantity,
        });

        await tx
          .update(productMasterPricingRules)
          .set({ pricingRuleId: newRuleId })
          .where(
            and(
              eq(productMasterPricingRules.masterId, masterId),
              eq(productMasterPricingRules.versionId, versionId),
              eq(productMasterPricingRules.pricingRuleId, rule.ruleId),
            ),
          );
      } else {
        await tx
          .update(pricingRules)
          .set({ scopeTargetIds: newTargets, updatedAt: new Date() })
          .where(eq(pricingRules.id, rule.ruleId));
      }
    }
  }

  async calculateVariantPrice(variantId: string, tx?: DbTransaction): Promise<number> {
    // NOTE: This method has been moved to PricingCalculatorService
    // Use PricingCalculatorService.calculateVariantPrice() instead
    throw new GoneException(
      'calculateVariantPrice has been moved to PricingCalculatorService. Use the new pricing API.',
    );
  }

  async calculateVariantPrices(variantIds: string[], tx?: DbTransaction): Promise<Record<string, number>> {
    // NOTE: This method has been moved to PricingCalculatorService
    throw new GoneException(
      'calculateVariantPrices has been moved to PricingCalculatorService. Use the new pricing API.',
    );
  }

  async calculateAllVariantPrices(masterId: string, tx?: DbTransaction): Promise<Record<string, number>> {
    // NOTE: This method has been moved to PricingCalculatorService
    throw new GoneException(
      'calculateAllVariantPrices has been moved to PricingCalculatorService. Use the new pricing API.',
    );
  }

  async findByIds(ids: string[]): Promise<
    {
      id: string;
      variantName?: string;
      variantCode?: string;
      masterId: string;
      masterName: string;
      optionLabel?: string;
    }[]
  > {
    if (!ids.length) return [];
    const client = this.db.db;

    const rows = await client
      .select({
        variantId: productVariants.id,
        variantName: productVariants.variantName,
        variantCode: productVariants.variantCode,
        masterId: productMasterVariants.masterId,
        versionId: productMasterVariants.versionId,
        masterName: productMasterVersions.name,
      })
      .from(productVariants)
      .innerJoin(productMasterVariants, eq(productMasterVariants.variantId, productVariants.id))
      .innerJoin(
        productMasterVersions,
        and(eq(productMasterVersions.id, productMasterVariants.versionId), eq(productMasterVersions.status, 'active')),
      )
      .where(inArray(productVariants.id, ids));

    if (!rows.length) return [];

    // 변형이 여러 active 버전에 속할 경우 첫 번째만 사용
    const variantMap = new Map<string, (typeof rows)[0]>();
    for (const row of rows) {
      if (!variantMap.has(row.variantId)) variantMap.set(row.variantId, row);
    }
    const uniqueRows = Array.from(variantMap.values());
    const variantIds = uniqueRows.map((r) => r.variantId);
    const versionIds = [...new Set(uniqueRows.map((r) => r.versionId))];

    // 옵션 표시명 일괄 조회
    const optionRows = await client
      .select({
        variantId: variantOptionValues.variantId,
        displayName: productOptionValueDisplays.displayName,
        groupSortOrder: productOptionGroupDisplays.sortOrder,
        valueSortOrder: productOptionValueDisplays.sortOrder,
      })
      .from(variantOptionValues)
      .innerJoin(productOptionValues, eq(variantOptionValues.optionValueId, productOptionValues.id))
      .innerJoin(
        productOptionValueDisplays,
        and(
          eq(productOptionValues.id, productOptionValueDisplays.optionValueId),
          inArray(productOptionValueDisplays.versionId, versionIds),
          eq(productOptionValueDisplays.locale, 'ko-KR'),
        ),
      )
      .innerJoin(productOptionGroups, eq(productOptionValues.optionGroupId, productOptionGroups.id))
      .innerJoin(
        productOptionGroupDisplays,
        and(
          eq(productOptionGroups.id, productOptionGroupDisplays.optionGroupId),
          inArray(productOptionGroupDisplays.versionId, versionIds),
          eq(productOptionGroupDisplays.locale, 'ko-KR'),
        ),
      )
      .where(inArray(variantOptionValues.variantId, variantIds))
      .orderBy(asc(productOptionGroupDisplays.sortOrder), asc(productOptionValueDisplays.sortOrder));

    const optionMap = new Map<string, string[]>();
    for (const opt of optionRows) {
      if (!optionMap.has(opt.variantId)) optionMap.set(opt.variantId, []);
      optionMap.get(opt.variantId)!.push(opt.displayName);
    }

    return uniqueRows.map((row) => ({
      id: row.variantId,
      variantName: row.variantName ?? undefined,
      variantCode: row.variantCode ?? undefined,
      masterId: row.masterId,
      masterName: row.masterName,
      optionLabel: optionMap.get(row.variantId)?.join(', '),
    }));
  }

  async existsVariant(variantId: string, tx?: DbTransaction): Promise<boolean> {
    if (!variantId) {
      return false;
    }

    const client = this.getClient(tx);

    const result = await client
      .select({ count: count() })
      .from(productVariants)
      .where(eq(productVariants.id, variantId));

    return result[0].count > 0;
  }

  async getActiveVariants(masterId: string, versionId?: string, tx?: DbTransaction): Promise<ProductVariant[]> {
    if (!masterId) {
      throw new BadRequestException('Master ID is required');
    }

    return await this.inTx(async (tx) => {
      let targetVersionId: string;

      if (!versionId) {
        const targetVersion = await this.productVersionsService.getActiveVersion(masterId, tx);
        targetVersionId = targetVersion.id;
      } else {
        targetVersionId = versionId;
      }

      const results = await tx
        .select()
        .from(productMasterVariants)
        .innerJoin(productVariants, eq(productMasterVariants.variantId, productVariants.id))
        .where(
          and(
            eq(productMasterVariants.masterId, masterId),
            eq(productMasterVariants.versionId, targetVersionId),
            eq(productVariants.status, 'active'),
          ),
        )
        .orderBy(asc(productVariants.displayOrder));

      return results.map((r) => r.product_variants);
    }, tx);
  }

  async updateDisplayOrder(variantId: string, displayOrder: number, tx?: DbTransaction): Promise<void> {
    if (!variantId) {
      throw new BadRequestException('Variant ID is required');
    }

    if (displayOrder < 0) {
      throw new BadRequestException('Display order must be non-negative');
    }

    const client = this.getClient(tx);

    const exists = await this.existsVariant(variantId, tx);
    if (!exists) {
      throw new NotFoundException(`Variant not found: ${variantId}`);
    }

    await client
      .update(productVariants)
      .set({
        displayOrder,
        updatedAt: new Date(),
      })
      .where(eq(productVariants.id, variantId));
  }
}
