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
  productMasters,
  productOptionGroups,
  productOptionValues,
  variantOptionValues
} from '../../../schema';
import { PricingStrategyFactory } from '../pricing/pricing-strategy.factory';
import { eq, and, or, like, ilike, count, asc, desc, sql, inArray } from 'drizzle-orm';

@Injectable()
export class ProductVariantsService {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly pricingStrategyFactory: PricingStrategyFactory,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.db.db;
  }


  async getVariantsByMaster(masterId: string, filters?: {
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
    
    const whereConditions: any[] = [
      eq(productVariants.masterId, masterId)
    ];
    
    if (filters?.status) {
      whereConditions.push(eq(productVariants.status, filters.status));
    }
    
    const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;
    
    const countQuery = client
      .select({ count: count() })
      .from(productVariants);
      
    if (whereClause) {
      countQuery.where(whereClause);
    }
    
    const [{ count: total }] = await countQuery;
    
    const dataQuery = client
      .select()
      .from(productVariants)
      .orderBy(asc(productVariants.displayOrder), asc(productVariants.createdAt))
      .limit(limit)
      .offset(offset);
      
    if (whereClause) {
      dataQuery.where(whereClause);
    }
    
    const variants = await dataQuery;
    
    const variantsWithPriceData: VariantWithPriceDto[] = [];
    
    for (const variant of variants) {
      let price = 0;
      let optionValues: any[] = [];
      
      if (includePrice) {
        try {
          price = await this.calculateVariantPrice(variant.id, tx);
        } catch (error) {
          console.warn(`Failed to calculate price for variant ${variant.id}:`, error.message);
          
          const masterInfo = await client
            .select({ basePrice: productMasters.basePrice })
            .from(productMasters)
            .where(eq(productMasters.id, variant.masterId));
          
          price = masterInfo[0]?.basePrice || 0;
        }
      }
      
      optionValues = await client
        .select({
          id: productOptionValues.id,
          optionGroupId: productOptionValues.optionGroupId,
          value: productOptionValues.value,
          displayName: productOptionValues.displayName,
          sortOrder: productOptionValues.sortOrder,
          isActive: productOptionValues.isActive,
          createdAt: productOptionValues.createdAt,
          updatedAt: productOptionValues.updatedAt
        })
        .from(variantOptionValues)
        .innerJoin(productOptionValues, eq(variantOptionValues.optionValueId, productOptionValues.id))
        .innerJoin(productOptionGroups, eq(productOptionValues.optionGroupId, productOptionGroups.id))
        .where(eq(variantOptionValues.variantId, variant.id))
        .orderBy(asc(productOptionGroups.sortOrder), asc(productOptionValues.sortOrder));
      
      variantsWithPriceData.push({
        ...variant,
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

  async getVariantDetail(variantId: string, tx?: DbTransaction): Promise<VariantWithPriceDto | null> {
    if (!variantId) {
      throw new Error('Variant ID is required');
    }
    
    const client = this.getClient(tx);
    
    const variants = await client
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, variantId));
    
    if (variants.length === 0) {
      return null;
    }
    
    const variant = variants[0];
    
    const optionValues = await client
      .select({
        id: productOptionValues.id,
        optionGroupId: productOptionValues.optionGroupId,
        value: productOptionValues.value,
        displayName: productOptionValues.displayName,
        sortOrder: productOptionValues.sortOrder,
        isActive: productOptionValues.isActive,
        createdAt: productOptionValues.createdAt,
        updatedAt: productOptionValues.updatedAt
      })
      .from(variantOptionValues)
      .innerJoin(productOptionValues, eq(variantOptionValues.optionValueId, productOptionValues.id))
      .innerJoin(productOptionGroups, eq(productOptionValues.optionGroupId, productOptionGroups.id))
      .where(eq(variantOptionValues.variantId, variantId))
      .orderBy(asc(productOptionGroups.sortOrder), asc(productOptionValues.sortOrder));
    
    let price: number;
    try {
      price = await this.calculateVariantPrice(variantId, tx);
    } catch (error) {
      // 가격 계산 실패 시 Master의 기본 가격 사용
      console.warn(`Failed to calculate price for variant ${variantId}:`, error.message);
      
      const masterInfo = await client
        .select({ basePrice: productMasters.basePrice })
        .from(productMasters)
        .where(eq(productMasters.id, variant.masterId));
      
      price = masterInfo[0]?.basePrice || 0;
    }
    
    return {
      ...variant,
      price,
      optionValues
    };
  }

  async getVariantOptions(variantId: string, tx?: DbTransaction): Promise<any[]> {
    if (!variantId) {
      throw new Error('Variant ID is required');
    }
    
    const client = this.getClient(tx);
    
    const exists = await this.existsVariant(variantId, tx);
    if (!exists) {
      throw new Error(`Variant not found: ${variantId}`);
    }
    
    const optionInfo = await client
      .select({
        optionGroup: {
          id: productOptionGroups.id,
          name: productOptionGroups.name,
          displayName: productOptionGroups.displayName,
          sortOrder: productOptionGroups.sortOrder
        },
        optionValue: {
          id: productOptionValues.id,
          value: productOptionValues.value,
          displayName: productOptionValues.displayName,
          sortOrder: productOptionValues.sortOrder,
          isActive: productOptionValues.isActive
        }
      })
      .from(variantOptionValues)
      .innerJoin(productOptionValues, eq(variantOptionValues.optionValueId, productOptionValues.id))
      .innerJoin(productOptionGroups, eq(productOptionValues.optionGroupId, productOptionGroups.id))
      .where(eq(variantOptionValues.variantId, variantId))
      .orderBy(asc(productOptionGroups.sortOrder), asc(productOptionValues.sortOrder));
    
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
    if (!variantId) {
      throw new Error('Variant ID is required');
    }
    
    const client = this.getClient(tx);
    
    const variants = await client
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, variantId));
    
    if (variants.length === 0) {
      throw new Error(`Variant not found: ${variantId}`);
    }
    
    const variant = variants[0];
    
    const masters = await client
      .select()
      .from(productMasters)
      .where(eq(productMasters.id, variant.masterId));
    
    if (masters.length === 0) {
      throw new Error(`Master not found: ${variant.masterId}`);
    }
    
    const master = masters[0];
    
    const strategy = await this.pricingStrategyFactory.getStrategy(master.pricingStrategy as any);
    
    const optionInfo = await client
      .select({
        optionValueId: productOptionValues.id,
        value: productOptionValues.value,
        groupName: productOptionGroups.name
      })
      .from(variantOptionValues)
      .innerJoin(productOptionValues, eq(variantOptionValues.optionValueId, productOptionValues.id))
      .innerJoin(productOptionGroups, eq(productOptionValues.optionGroupId, productOptionGroups.id))
      .where(eq(variantOptionValues.variantId, variantId));
    
    try {
      if (master.pricingStrategy === 'option_based') {
        return await strategy.calculatePrice(optionInfo as any, client);
      } else if (master.pricingStrategy === 'variant_based') {
        return await strategy.calculatePrice(variantId, client);
      } else {
        return master.basePrice || 0;
      }
    } catch (error) {
      console.warn(`Failed to calculate price for variant ${variantId} with strategy ${master.pricingStrategy}:`, error.message);
      
      return master.basePrice || 0;
    }
  }

  async calculateVariantPrices(variantIds: string[], tx?: DbTransaction): Promise<Record<string, number>> {
    if (!variantIds || variantIds.length === 0) {
      throw new Error('Variant IDs are required');
    }
    
    const prices: Record<string, number> = {};
    
    for (const variantId of variantIds) {
      try {
        prices[variantId] = await this.calculateVariantPrice(variantId, tx);
      } catch (error) {
        console.warn(`Failed to calculate price for variant ${variantId}:`, error.message);
        
        prices[variantId] = 0;
      }
    }
    
    return prices;
  }

  async calculateAllVariantPrices(masterId: string, tx?: DbTransaction): Promise<Record<string, number>> {
    if (!masterId) {
      throw new Error('Master ID is required');
    }
    
    const client = this.getClient(tx);
    
    const variants = await client
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(eq(productVariants.masterId, masterId));
    
    if (variants.length === 0) {
      return {};
    }
    
    const variantIds = variants.map(v => v.id);
    
    return await this.calculateVariantPrices(variantIds, tx);
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

  async belongsToMaster(variantId: string, masterId: string, tx?: DbTransaction): Promise<boolean> {
    if (!variantId || !masterId) {
      return false;
    }
    
    const client = this.getClient(tx);
    
    const result = await client
      .select({ count: count() })
      .from(productVariants)
      .where(and(
        eq(productVariants.id, variantId),
        eq(productVariants.masterId, masterId)
      ));
    
    return result[0].count > 0;
  }

  async getActiveVariants(masterId: string, tx?: DbTransaction): Promise<ProductVariant[]> {
    if (!masterId) {
      throw new Error('Master ID is required');
    }
    
    const client = this.getClient(tx);
    
    const variants = await client
      .select()
      .from(productVariants)
      .where(and(
        eq(productVariants.masterId, masterId),
        eq(productVariants.status, 'active')
      ))
      .orderBy(asc(productVariants.displayOrder));
    
    return variants;
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