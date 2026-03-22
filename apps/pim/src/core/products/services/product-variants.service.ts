import { BadRequestException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import {
  ProductVariant,
  UpdateProductVariant,
  DbTransaction
} from '../../../types';
import { ProductVariantMapper } from '../mappers';
import { VariantWithPriceDto } from '../dto/variants/variant-response.dto';
import {
  type PimSchema,
  productMasters,
  productVariants,
  productMasterVersions,
  productMasterVariants,
  productOptionGroups,
  productOptionValues,
  productOptionGroupDisplays,
  productOptionValueDisplays,
  variantOptionValues
} from '../../../schema';
import { eq, and, or, like, ilike, count, asc, desc, sql, inArray, SQL, isNull } from 'drizzle-orm';
import { UpdateProductVariantDto, UpdateVariantBulkDto } from '../dto';
import { ProductVersionsService } from './product-versions.service';
import { VariantPriceCacheService } from '../../pricing/variant-price-cache.service';

type VariantDetailKeysParam = { variantId: string, versionId: string } | { variantId: string, masterId: string };
type VariantOptionsKeysParam = { variantId: string, versionId: string } | { variantId: string, masterId: string };


@Injectable()
export class ProductVariantsService {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly productVersionsService: ProductVersionsService,
    private readonly priceCacheService: VariantPriceCacheService,
  ) { }

  private getClient(tx?: DbTransaction) {
    return tx ?? this.db.db;
  }

  private async inTx<T>(fn: (tx: DbTransaction) => Promise<T>, tx?: DbTransaction): Promise<T> {
    return tx ? fn(tx) : this.db.db.transaction(fn);
  }


  async getVariantsByMaster(masterId: string, versionId?: string, filters?: {
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
        .where(
          and(
            eq(productMasterVersions.masterId, masterId),
            eq(productMasterVersions.status, 'active'),
          ),
        )
        .limit(1);

      if (!activeVersion) {
        throw new NotFoundException(`No active version found for master ${masterId}`);
      }
      actualVersionId = activeVersion.id;
    }
    else {
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

      variantsWithPriceData.push(ProductVariantMapper.toWithPriceDto({
        ...variant,
        versionId: actualVersionId,
        masterId: row.product_master_variants.masterId,
        optionValues
      }, price));
    }

    return {
      data: variantsWithPriceData,
      total,
      page,
      limit
    };
  }

  async getVariantDetail(keys: VariantDetailKeysParam, tx?: DbTransaction): Promise<VariantWithPriceDto | null> {
    return await this.inTx(async (tx) => {
      // version ID를 결정
      let versionId: string;
      let masterId: string;

      if ('versionId' in keys) {
        versionId = keys.versionId;
        const [version] = await tx.select({ masterId: productMasterVersions.masterId })
          .from(productMasterVersions)
          .where(eq(productMasterVersions.id, versionId))
          .limit(1);

        if (!version) {
          throw new NotFoundException(`Version ${versionId} not found`);
        }

        masterId = version.masterId;
      }
      else {
        const activeVersion = await this.productVersionsService.getActiveVersion(keys.masterId, tx);
        versionId = activeVersion.id;
        masterId = keys.masterId;
      }

      const variantId = keys.variantId;

      const [variant] = await tx
        .select()
        .from(productVariants)
        .where(eq(productVariants.id, variantId))
        .limit(1);

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


      let price: number;
      try {
        price = await this.calculateVariantPrice(variantId, tx);
      } catch (error) {
        console.warn(`Failed to calculate price for variant ${variantId}:`, error.message);
        price = 0;
      }

      return ProductVariantMapper.toWithPriceDto({
        ...variant,
        masterId,
        versionId,
        optionValues
      }, price);
    }, tx)

  }

  async getVariantOptions(keys: VariantOptionsKeysParam, tx?: DbTransaction): Promise<Array<{
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
    return await this.inTx(async (tx) => {
      let versionId: string;
      let masterId: string;

      if ('versionId' in keys) {
        versionId = keys.versionId;
        const [version] = await tx.select({ masterId: productMasterVersions.masterId })
          .from(productMasterVersions)
          .where(eq(productMasterVersions.id, versionId))
          .limit(1);

        if (!version) {
          throw new NotFoundException(`Version ${versionId} not found`);
        }

        masterId = version.masterId;
      }
      else {
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

      return optionInfo;
    }, tx)
  }


  async updateVariantStatus(variantId: string, status: string, tx?: DbTransaction): Promise<void> {
    if (!variantId) {
      throw new BadRequestException('Variant ID is required');
    }

    if (!status) {
      throw new BadRequestException('Status is required');
    }

    const validStatuses = ['active', 'inactive'];
    if (!validStatuses.includes(status)) {
      throw new BadRequestException(`Invalid status: ${status}. Valid statuses are: ${validStatuses.join(', ')}`);
    }

    const client = this.getClient(tx);

    const exists = await this.existsVariant(variantId, tx);
    if (!exists) {
      throw new NotFoundException(`Variant not found: ${variantId}`);
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
      throw new BadRequestException('Variant IDs are required');
    }

    if (!status) {
      throw new BadRequestException('Status is required');
    }

    const validStatuses = ['active', 'inactive'];
    if (!validStatuses.includes(status)) {
      throw new BadRequestException(`Invalid status: ${status}. Valid statuses are: ${validStatuses.join(', ')}`);
    }

    const client = this.getClient(tx);

    const existingVariants = await client
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(inArray(productVariants.id, variantIds));

    const existingIds = existingVariants.map(v => v.id);
    const missingIds = variantIds.filter(id => !existingIds.includes(id));

    if (missingIds.length > 0) {
      throw new NotFoundException(`Variants not found: ${missingIds.join(', ')}`);
    }

    await client
      .update(productVariants)
      .set({
        status,
        updatedAt: new Date()
      })
      .where(inArray(productVariants.id, variantIds));
  }

  async updateVariant(variantId: string, data: UpdateProductVariantDto, tx?: DbTransaction): Promise<ProductVariant> {
    if (!variantId) {
      throw new BadRequestException('Variant ID is required');
    }

    const client = this.getClient(tx);

    const exists = await this.existsVariant(variantId, tx);
    if (!exists) {
      throw new NotFoundException(`Variant not found: ${variantId}`);
    }

    const updateData = {
      ...data,
      updatedAt: new Date(),
    };

    const result = await client
      .update(productVariants)
      .set(updateData)
      .where(eq(productVariants.id, variantId))
      .returning();

    if (result.length === 0) {
      throw new NotFoundException(`Failed to update variant: ${variantId}`);
    }

    return result[0];
  }

  async bulkUpdateVariants(data: UpdateVariantBulkDto, tx?: DbTransaction): Promise<void> {
    if (!data.updates || data.updates.length === 0) {
      throw new BadRequestException('Updates are required');
    }

    const client = this.getClient(tx);

    const existingVariants = await client
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(inArray(productVariants.id, data.updates.map(u => u.id)));

    const existingIds = existingVariants.map(v => v.id);
    const missingIds = data.updates.map(u => u.id).filter(id => !existingIds.includes(id));

    if (missingIds.length > 0) {
      throw new NotFoundException(`Variants not found: ${missingIds.join(', ')}`);
    }

    const validStatuses = ['active', 'inactive'];
    if (data.updates.map(u => u.status).some(status => status && !validStatuses.includes(status))) {
      throw new BadRequestException(`Invalid status: ${data.updates.map(u => u.status).join(', ')}. Valid statuses are: ${validStatuses.join(', ')}`);
    }

    if (data.updates.map(u => u.displayOrder).some(displayOrder => displayOrder !== undefined && displayOrder < 0)) {
      throw new BadRequestException('Display order must be non-negative');
    }

    const updateData = data.updates.map(u => ({
      ...u,
      updatedAt: new Date()
    }));

    for (const update of updateData) {
      await client
        .update(productVariants)
        .set(update)
        .where(eq(productVariants.id, update.id));
    }
  }


  async calculateVariantPrice(variantId: string, tx?: DbTransaction): Promise<number> {
    // NOTE: This method has been moved to PricingCalculatorService
    // Use PricingCalculatorService.calculateVariantPrice() instead
    throw new GoneException('calculateVariantPrice has been moved to PricingCalculatorService. Use the new pricing API.');
  }

  async calculateVariantPrices(variantIds: string[], tx?: DbTransaction): Promise<Record<string, number>> {
    // NOTE: This method has been moved to PricingCalculatorService
    throw new GoneException('calculateVariantPrices has been moved to PricingCalculatorService. Use the new pricing API.');
  }

  async calculateAllVariantPrices(masterId: string, tx?: DbTransaction): Promise<Record<string, number>> {
    // NOTE: This method has been moved to PricingCalculatorService
    throw new GoneException('calculateAllVariantPrices has been moved to PricingCalculatorService. Use the new pricing API.');
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
      }
      else {
        targetVersionId = versionId;
      }

      const results = await tx
        .select()
        .from(productMasterVariants)
        .innerJoin(
          productVariants,
          eq(productMasterVariants.variantId, productVariants.id),
        )
        .where(
          and(
            eq(productMasterVariants.masterId, masterId),
            eq(productMasterVariants.versionId, targetVersionId),
            eq(productVariants.status, 'active'),
          ),
        )
        .orderBy(asc(productVariants.displayOrder));

      return results.map(r => r.product_variants);
    }, tx)
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
        updatedAt: new Date()
      })
      .where(eq(productVariants.id, variantId));
  }
} 