import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import {
  UpdateVariantBulkDto,
  VariantWithPriceDto,
  ProductVariant,
  UpdateProductVariant,
  DbTransaction
} from '../../../types';
import {
  type PimSchema,
  productVariants,
  productMasterVersions,
  productMasterVariants,
  productOptionGroups,
  productOptionValues,
  productOptionGroupDisplays,
  productOptionValueDisplays,
  variantOptionValues
} from '../../../schema';
import { eq, and, or, like, ilike, count, asc, desc, sql, inArray, SQL } from 'drizzle-orm';

@Injectable()
export class ProductVariantsService {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
  ) { }

  private getClient(tx?: DbTransaction) {
    return tx ?? this.db.db;
  }


  async getVariantsByMaster(masterId: string, version?: number, filters?: {
    status?: string;
    includePrice?: boolean;
    page?: number;
    limit?: number;
  }, tx?: DbTransaction): Promise<{
    data: VariantWithPriceDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    if (!masterId) {
      throw new Error('Master ID is required');
    }

    const client = this.getClient(tx);

    const page = filters?.page || 1;
    const limit = Math.min(filters?.limit || 20, 100);
    const offset = (page - 1) * limit;
    const includePrice = filters?.includePrice !== false;

    // version이 지정되지 않으면 active 버전 사용
    let actualVersion = version;
    if (actualVersion === undefined) {
      const [activeMaster] = await client
        .select({ version: productMasterVersions.version })
        .from(productMasterVersions)
        .where(
          and(
            eq(productMasterVersions.masterId, masterId),
            eq(productMasterVersions.versionStatus, 'active'),
          ),
        )
        .limit(1);

      if (!activeMaster) {
        throw new Error(`No active version found for master ${masterId}`);
      }
      actualVersion = activeMaster.version;
    }

    // 매핑 테이블을 통해 variants 조회
    const whereConditions: SQL[] = [
      eq(productMasterVariants.masterId, masterId),
      eq(productMasterVariants.version, actualVersion),
    ];

    if (filters?.status) {
      whereConditions.push(eq(productVariants.status, filters.status));
    }

    const whereClause = and(...whereConditions);

    const countQuery = client
      .select({ count: count() })
      .from(productMasterVariants)
      .innerJoin(
        productVariants,
        eq(productMasterVariants.variantId, productVariants.id),
      )
      .where(whereClause);

    const [{ count: total }] = await countQuery;

    const variants = await client
      .select()
      .from(productMasterVariants)
      .innerJoin(
        productVariants,
        eq(productMasterVariants.variantId, productVariants.id),
      )
      .where(whereClause)
      .orderBy(asc(productVariants.displayOrder), asc(productVariants.createdAt))
      .limit(limit)
      .offset(offset);

    const variantsWithPriceData: VariantWithPriceDto[] = [];

    for (const row of variants) {
      const variant = row.product_variants;
      let price = 0;
      let optionValues: Array<{
        id: string;
        optionGroupId: string;
        createdAt: Date | null;
      }> = [];

      if (includePrice) {
        try {
          price = await this.calculateVariantPrice(variant.id, tx);
        } catch (error) {
          console.warn(`Failed to calculate price for variant ${variant.id}:`, error.message);
          price = 0;
        }
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

      variantsWithPriceData.push({
        ...variant,
        masterId: row.product_master_variants.masterId,
        price,
        optionValues
      });
    }

    return {
      data: variantsWithPriceData,
      total,
      page,
      limit
    };
  }

  async getVariantDetail(variantId: string, masterId?: string, version?: number, tx?: DbTransaction): Promise<VariantWithPriceDto | null> {
    if (!variantId) {
      throw new Error('Variant ID is required');
    }

    const client = this.getClient(tx);

    // masterId와 version 정보 확보
    let actualMasterId = masterId;
    let actualVersion = version;

    if (!actualMasterId || actualVersion === undefined) {
      const mappingInfo = await client
        .select({
          masterId: productMasterVariants.masterId,
          version: productMasterVariants.version,
        })
        .from(productMasterVariants)
        .where(eq(productMasterVariants.variantId, variantId))
        .limit(1);

      if (mappingInfo.length === 0) {
        return null;
      }

      actualMasterId = actualMasterId || mappingInfo[0].masterId;
      actualVersion = actualVersion ?? mappingInfo[0].version;
    }

    const variants = await client
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, variantId));

    if (variants.length === 0) {
      return null;
    }

    const variant = variants[0];

    // Display 테이블을 통해 optionValues 조회
    const optionValues = await client
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
          eq(productOptionValueDisplays.masterId, actualMasterId),
          eq(productOptionValueDisplays.version, actualVersion),
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
          eq(productOptionGroupDisplays.masterId, actualMasterId),
          eq(productOptionGroupDisplays.version, actualVersion),
          eq(productOptionGroupDisplays.locale, 'ko-KR'),
        ),
      )
      .where(eq(variantOptionValues.variantId, variantId))
      .orderBy(
        asc(productOptionGroupDisplays.sortOrder),
        asc(productOptionValueDisplays.sortOrder),
      );

    let price: number;
    try {
      price = await this.calculateVariantPrice(variantId, tx);
    } catch (error) {
      console.warn(`Failed to calculate price for variant ${variantId}:`, error.message);
      price = 0;
    }

    return {
      ...variant,
      masterId: actualMasterId,
      price,
      optionValues
    };
  }

  async getVariantOptions(variantId: string, masterId?: string, version?: number, tx?: DbTransaction): Promise<Array<{
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
  }>> {
    if (!variantId) {
      throw new Error('Variant ID is required');
    }

    const client = this.getClient(tx);

    const exists = await this.existsVariant(variantId, tx);
    if (!exists) {
      throw new Error(`Variant not found: ${variantId}`);
    }

    // masterId와 version 정보 확보
    let actualMasterId = masterId;
    let actualVersion = version;

    if (!actualMasterId || actualVersion === undefined) {
      const mappingInfo = await client
        .select({
          masterId: productMasterVariants.masterId,
          version: productMasterVariants.version,
        })
        .from(productMasterVariants)
        .where(eq(productMasterVariants.variantId, variantId))
        .limit(1);

      if (mappingInfo.length === 0) {
        throw new Error(`Variant ${variantId} not found in mapping table`);
      }

      actualMasterId = actualMasterId || mappingInfo[0].masterId;
      actualVersion = actualVersion ?? mappingInfo[0].version;
    }

    // Display 테이블을 통해 optionInfo 조회
    const optionInfo = await client
      .select({
        optionGroup: {
          id: productOptionGroups.id,
          displayName: productOptionGroupDisplays.displayName,
          sortOrder: productOptionGroupDisplays.sortOrder
        },
        optionValue: {
          id: productOptionValues.id,
          displayName: productOptionValueDisplays.displayName,
          sortOrder: productOptionValueDisplays.sortOrder,
        }
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
          eq(productOptionValueDisplays.masterId, actualMasterId),
          eq(productOptionValueDisplays.version, actualVersion),
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
          eq(productOptionGroupDisplays.masterId, actualMasterId),
          eq(productOptionGroupDisplays.version, actualVersion),
          eq(productOptionGroupDisplays.locale, 'ko-KR'),
        ),
      )
      .where(eq(variantOptionValues.variantId, variantId))
      .orderBy(
        asc(productOptionGroupDisplays.sortOrder),
        asc(productOptionValueDisplays.sortOrder),
      );

    return optionInfo;
  }


  async updateVariantStatus(variantId: string, status: string, tx?: DbTransaction): Promise<void> {
    if (!variantId) {
      throw new Error('Variant ID is required');
    }

    if (!status) {
      throw new Error('Status is required');
    }

    const validStatuses = ['active', 'inactive'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}. Valid statuses are: ${validStatuses.join(', ')}`);
    }

    const client = this.getClient(tx);

    const exists = await this.existsVariant(variantId, tx);
    if (!exists) {
      throw new Error(`Variant not found: ${variantId}`);
    }

    await client
      .update(productVariants)
      .set({
        status,
        updatedAt: new Date()
      })
      .where(eq(productVariants.id, variantId));
  }

  async bulkUpdateVariantStatus(variantIds: string[], status: string, tx?: DbTransaction): Promise<void> {
    if (!variantIds || variantIds.length === 0) {
      throw new Error('Variant IDs are required');
    }

    if (!status) {
      throw new Error('Status is required');
    }

    const validStatuses = ['active', 'inactive'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}. Valid statuses are: ${validStatuses.join(', ')}`);
    }

    const client = this.getClient(tx);

    const existingVariants = await client
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(inArray(productVariants.id, variantIds));

    const existingIds = existingVariants.map(v => v.id);
    const missingIds = variantIds.filter(id => !existingIds.includes(id));

    if (missingIds.length > 0) {
      throw new Error(`Variants not found: ${missingIds.join(', ')}`);
    }

    await client
      .update(productVariants)
      .set({
        status,
        updatedAt: new Date()
      })
      .where(inArray(productVariants.id, variantIds));
  }

  async updateVariant(variantId: string, data: UpdateProductVariant, tx?: DbTransaction): Promise<ProductVariant> {
    if (!variantId) {
      throw new Error('Variant ID is required');
    }

    const client = this.getClient(tx);

    const exists = await this.existsVariant(variantId, tx);
    if (!exists) {
      throw new Error(`Variant not found: ${variantId}`);
    }

    const updateData = {
      ...data,
      updatedAt: new Date(),
    };

    delete (updateData as any).id;
    delete (updateData as any).createdAt;
    delete (updateData as any).masterId;

    const result = await client
      .update(productVariants)
      .set(updateData)
      .where(eq(productVariants.id, variantId))
      .returning();

    if (result.length === 0) {
      throw new Error(`Failed to update variant: ${variantId}`);
    }

    return result[0];
  }

  async bulkUpdateVariants(data: UpdateVariantBulkDto, tx?: DbTransaction): Promise<void> {
    if (!data.variantIds || data.variantIds.length === 0) {
      throw new Error('Variant IDs are required');
    }

    if (!data.updates || Object.keys(data.updates).length === 0) {
      throw new Error('Updates are required');
    }

    const client = this.getClient(tx);

    const existingVariants = await client
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(inArray(productVariants.id, data.variantIds));

    const existingIds = existingVariants.map(v => v.id);
    const missingIds = data.variantIds.filter(id => !existingIds.includes(id));

    if (missingIds.length > 0) {
      throw new Error(`Variants not found: ${missingIds.join(', ')}`);
    }

    if (data.updates.status) {
      const validStatuses = ['active', 'inactive'];
      if (!validStatuses.includes(data.updates.status)) {
        throw new Error(`Invalid status: ${data.updates.status}. Valid statuses are: ${validStatuses.join(', ')}`);
      }
    }

    if (data.updates.displayOrder !== undefined && data.updates.displayOrder < 0) {
      throw new Error('Display order must be non-negative');
    }

    const updateData = {
      ...data.updates,
      updatedAt: new Date()
    };

    await client
      .update(productVariants)
      .set(updateData)
      .where(inArray(productVariants.id, data.variantIds));
  }


  async calculateVariantPrice(variantId: string, tx?: DbTransaction): Promise<number> {
    // NOTE: This method has been moved to PricingCalculatorService
    // Use PricingCalculatorService.calculateVariantPrice() instead
    throw new Error('calculateVariantPrice has been moved to PricingCalculatorService. Use the new pricing API.');
  }

  async calculateVariantPrices(variantIds: string[], tx?: DbTransaction): Promise<Record<string, number>> {
    // NOTE: This method has been moved to PricingCalculatorService
    throw new Error('calculateVariantPrices has been moved to PricingCalculatorService. Use the new pricing API.');
  }

  async calculateAllVariantPrices(masterId: string, tx?: DbTransaction): Promise<Record<string, number>> {
    // NOTE: This method has been moved to PricingCalculatorService
    throw new Error('calculateAllVariantPrices has been moved to PricingCalculatorService. Use the new pricing API.');
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

  async belongsToMaster(variantId: string, masterId: string, version?: number, tx?: DbTransaction): Promise<boolean> {
    if (!variantId || !masterId) {
      return false;
    }

    const client = this.getClient(tx);

    // 매핑 테이블을 통해 확인
    const conditions: SQL[] = [
      eq(productMasterVariants.variantId, variantId),
      eq(productMasterVariants.masterId, masterId),
    ];

    if (version !== undefined) {
      conditions.push(eq(productMasterVariants.version, version));
    }

    const result = await client
      .select({ count: count() })
      .from(productMasterVariants)
      .where(and(...conditions));

    return result[0].count > 0;
  }

  async getActiveVariants(masterId: string, version?: number, tx?: DbTransaction): Promise<ProductVariant[]> {
    if (!masterId) {
      throw new Error('Master ID is required');
    }

    const client = this.getClient(tx);

    // version이 지정되지 않으면 active 버전 사용
    let actualVersion = version;
    if (actualVersion === undefined) {
      const [activeMaster] = await client
        .select({ version: productMasterVersions.version })
        .from(productMasterVersions)
        .where(
          and(
            eq(productMasterVersions.masterId, masterId),
            eq(productMasterVersions.versionStatus, 'active'),
          ),
        )
        .limit(1);

      if (!activeMaster) {
        throw new Error(`No active version found for master ${masterId}`);
      }
      actualVersion = activeMaster.version;
    }

    // 매핑 테이블을 통해 active status variants 조회
    const results = await client
      .select()
      .from(productMasterVariants)
      .innerJoin(
        productVariants,
        eq(productMasterVariants.variantId, productVariants.id),
      )
      .where(
        and(
          eq(productMasterVariants.masterId, masterId),
          eq(productMasterVariants.version, actualVersion),
          eq(productVariants.status, 'active'),
        ),
      )
      .orderBy(asc(productVariants.displayOrder));

    return results.map(r => r.product_variants);
  }

  async updateDisplayOrder(variantId: string, displayOrder: number, tx?: DbTransaction): Promise<void> {
    if (!variantId) {
      throw new Error('Variant ID is required');
    }

    if (displayOrder < 0) {
      throw new Error('Display order must be non-negative');
    }

    const client = this.getClient(tx);

    const exists = await this.existsVariant(variantId, tx);
    if (!exists) {
      throw new Error(`Variant not found: ${variantId}`);
    }

    await client
      .update(productVariants)
      .set({
        displayOrder,
        updatedAt: new Date()
      })
      .where(eq(productVariants.id, variantId));
  }
} 