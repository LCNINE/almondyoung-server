import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import {
  CreateMasterDto,
  MasterDetailDto,
  PricePreviewDto,
  ProductMaster,
  NewProductMaster,
  UpdateProductMaster,
  DbTransaction,
} from '../types';
import {
  type PimSchema,
  productMasters,
  productOptionGroups,
  productOptionValues,
  productVariants,
  variantOptionValues,
} from '../schema';
import { PricingStrategyFactory } from './pricing/pricing-strategy.factory';
import { eq, and, or, like, ilike, count, asc, desc, sql } from 'drizzle-orm';

@Injectable()
export class ProductMastersService {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly pricingStrategyFactory: PricingStrategyFactory,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.db.db;
  }

  async createMaster(
    data: CreateMasterDto,
    tx?: DbTransaction,
  ): Promise<ProductMaster> {
    const db =
      tx ||
      (await this.db.db.transaction(async (txn) => {
        return await this._createMasterWithinTransaction(data, txn);
      }));

    if (tx) {
      return await this._createMasterWithinTransaction(data, tx);
    } else {
      return db as ProductMaster;
    }
  }

  private async _createMasterWithinTransaction(
    data: CreateMasterDto,
    tx: DbTransaction,
  ): Promise<ProductMaster> {
    // categoryId 제거됨 - many-to-many 관계로 변경
    const masterData = {
      name: data.name,
      description: data.description,
      brand: data.brand,
      basePrice: data.basePrice,
      pricingStrategy: data.pricingStrategy,
      tags: data.tags,
      images: data.images,
      attributes: data.attributes,
      seoTitle: data.seoTitle,
      seoDescription: data.seoDescription,
      seoKeywords: data.seoKeywords,
      // 구매제한 필드들
      isWholesaleOnly: data.isWholesaleOnly || false,
      isMembershipOnly: data.isMembershipOnly || false,
      // 특별 가격 필드들
      membershipPrice: data.membershipPrice || null,
      wholesalePrice: data.wholesalePrice || null,
    };

    const [master] = await tx
      .insert(productMasters)
      .values(masterData)
      .returning();

    const createdOptionGroups: any[] = [];
    if (data.optionGroups && data.optionGroups.length > 0) {
      for (const optionGroup of data.optionGroups) {
        const [group] = await tx
          .insert(productOptionGroups)
          .values({
            masterId: master.id,
            name: optionGroup.name,
            displayName: optionGroup.displayName,
            sortOrder: optionGroup.sortOrder || 0,
          })
          .returning();

        const optionValues: any[] = [];
        for (const value of optionGroup.values) {
          const [optionValue] = await tx
            .insert(productOptionValues)
            .values({
              optionGroupId: group.id,
              value: value.value,
              displayName: value.displayName,
              sortOrder: value.sortOrder || 0,
            })
            .returning();

          optionValues.push({
            ...optionValue,
            price: value.price, // option_based 전략용
          });
        }

        createdOptionGroups.push({
          ...group,
          values: optionValues,
        });
      }
    }

    await this._generateVariants(master.id, createdOptionGroups, tx);

    await this.initializePricingStrategy(
      master.id,
      {
        pricingStrategy: data.pricingStrategy,
        optionGroups: createdOptionGroups,
        variantPrices: data.variantPrices,
      },
      tx,
    );

    return master;
  }

  private async _generateVariants(
    masterId: string,
    optionGroups: any[],
    tx: DbTransaction,
  ): Promise<void> {
    if (!optionGroups || optionGroups.length === 0) {
      await tx.insert(productVariants).values({
        masterId,
        variantName: null,
        isDefault: true,
        status: 'active',
      });
      return;
    }

    const combinations = this.generateOptionCombinations(optionGroups);

    for (const combination of combinations) {
      const [variant] = await tx
        .insert(productVariants)
        .values({
          masterId,
          variantName: combination.map((v) => v.displayName).join(' × '),
          isDefault: false,
          status: 'active',
        })
        .returning();

      for (const optionValue of combination) {
        await tx.insert(variantOptionValues).values({
          variantId: variant.id,
          optionValueId: optionValue.id,
        });
      }
    }
  }

  async getMasterById(
    masterId: string,
    tx?: DbTransaction,
  ): Promise<ProductMaster | null> {
    if (!masterId) {
      throw new Error('Master ID is required');
    }

    const client = this.getClient(tx);

    const result = await client
      .select()
      .from(productMasters)
      .where(eq(productMasters.id, masterId));

    return result.length > 0 ? result[0] : null;
  }

  async getMasterDetail(
    masterId: string,
    tx?: DbTransaction,
  ): Promise<MasterDetailDto | null> {
    const client = this.getClient(tx);

    const master = await this.getMasterById(masterId, tx);
    if (!master) {
      return null;
    }
    const optionGroups = await client
      .select()
      .from(productOptionGroups)
      .where(eq(productOptionGroups.masterId, masterId))
      .orderBy(productOptionGroups.sortOrder);

    const optionGroupsWithValues: any[] = [];
    for (const group of optionGroups) {
      const values = await client
        .select()
        .from(productOptionValues)
        .where(eq(productOptionValues.optionGroupId, group.id))
        .orderBy(productOptionValues.sortOrder);

      optionGroupsWithValues.push({
        ...group,
        values,
      });
    }

    const variants = await client
      .select()
      .from(productVariants)
      .where(eq(productVariants.masterId, masterId))
      .orderBy(productVariants.displayOrder);

    const channelProducts = [];

    return {
      ...master,
      optionGroups: optionGroupsWithValues,
      variants: variants.map((v) => ({ ...v, optionValues: [] })),
      channelProducts,
    };
  }

  async getMasters(
    filters?: {
      status?: string;
      categoryId?: string;
      brand?: string;
      pricingStrategy?: string;
      search?: string;
      page?: number;
      limit?: number;
    },
    tx?: DbTransaction,
  ): Promise<{
    data: ProductMaster[];
    total: number;
    page: number;
    limit: number;
  }> {
    const client = this.getClient(tx);

    const page = filters?.page || 1;
    const limit = Math.min(filters?.limit || 20, 100);
    const offset = (page - 1) * limit;

    const whereConditions: any[] = [];
    if (filters?.status) {
      whereConditions.push(eq(productMasters.status, filters.status));
    }

    // 카테고리 필터링은 별도 처리가 필요하므로 여기서는 제거하고 나중에 구현
    if (filters?.brand) {
      whereConditions.push(eq(productMasters.brand, filters.brand));
    }
    if (filters?.pricingStrategy) {
      whereConditions.push(
        eq(productMasters.pricingStrategy, filters.pricingStrategy),
      );
    }
    if (filters?.search) {
      whereConditions.push(ilike(productMasters.name, `%${filters.search}%`));
    }

    const whereClause =
      whereConditions.length > 0 ? and(...whereConditions) : undefined;
    const countQuery = client.select({ count: count() }).from(productMasters);

    if (whereClause) {
      countQuery.where(whereClause);
    }

    const [{ count: total }] = await countQuery;
    const dataQuery = client
      .select()
      .from(productMasters)
      .orderBy(desc(productMasters.createdAt))
      .limit(limit)
      .offset(offset);

    if (whereClause) {
      dataQuery.where(whereClause);
    }

    const data = await dataQuery;

    return {
      data,
      total,
      page,
      limit,
    };
  }

  async updateMaster(
    masterId: string,
    data: UpdateProductMaster,
    tx?: DbTransaction,
  ): Promise<ProductMaster> {
    if (!masterId) {
      throw new Error('Master ID is required');
    }

    const client = this.getClient(tx);

    const existingMaster = await this.getMasterById(masterId, tx);
    if (!existingMaster) {
      throw new Error(`Master not found: ${masterId}`);
    }

    const updateData = {
      ...data,
      updatedAt: new Date(),
    };
    delete (updateData as any).id;
    delete (updateData as any).createdAt;
    const result = await client
      .update(productMasters)
      .set(updateData)
      .where(eq(productMasters.id, masterId))
      .returning();

    if (result.length === 0) {
      throw new Error(`Failed to update master: ${masterId}`);
    }

    return result[0];
  }

  async deleteMaster(masterId: string, tx?: DbTransaction): Promise<boolean> {
    if (!masterId) {
      throw new Error('Master ID is required');
    }

    const client = this.getClient(tx);

    const master = await this.getMasterById(masterId, tx);
    if (!master) {
      return false;
    }
    const result = await client
      .delete(productMasters)
      .where(eq(productMasters.id, masterId));

    return true;
  }

  async createOptionGroups(
    masterId: string,
    optionGroups: any[],
    tx?: DbTransaction,
  ): Promise<void> {
    if (!masterId) {
      throw new Error('Master ID is required');
    }

    if (!optionGroups || optionGroups.length === 0) {
      throw new Error('Option groups are required');
    }

    const client = this.getClient(tx);

    const exists = await this.existsMaster(masterId, tx);
    if (!exists) {
      throw new Error(`Master not found: ${masterId}`);
    }
    for (const optionGroup of optionGroups) {
      if (
        !optionGroup.name ||
        !optionGroup.displayName ||
        !optionGroup.values
      ) {
        throw new Error('Option group must have name, displayName, and values');
      }
      const existingGroup = await client
        .select()
        .from(productOptionGroups)
        .where(
          and(
            eq(productOptionGroups.masterId, masterId),
            eq(productOptionGroups.name, optionGroup.name),
          ),
        );

      if (existingGroup.length > 0) {
        throw new Error(
          `Option group '${optionGroup.name}' already exists for this master`,
        );
      }
      const [group] = await client
        .insert(productOptionGroups)
        .values({
          masterId: masterId,
          name: optionGroup.name,
          displayName: optionGroup.displayName,
          sortOrder: optionGroup.sortOrder || 0,
        })
        .returning();
      for (const value of optionGroup.values) {
        if (!value.value || !value.displayName) {
          throw new Error('Option value must have value and displayName');
        }
        const existingValue = await client
          .select()
          .from(productOptionValues)
          .where(
            and(
              eq(productOptionValues.optionGroupId, group.id),
              eq(productOptionValues.value, value.value),
            ),
          );

        if (existingValue.length > 0) {
          throw new Error(
            `Option value '${value.value}' already exists in group '${optionGroup.name}'`,
          );
        }

        await client.insert(productOptionValues).values({
          optionGroupId: group.id,
          value: value.value,
          displayName: value.displayName,
          sortOrder: value.sortOrder || 0,
        });
      }
    }
  }

  async generateVariants(masterId: string, tx?: DbTransaction): Promise<void> {
    if (!masterId) {
      throw new Error('Master ID is required');
    }

    const client = this.getClient(tx);

    const exists = await this.existsMaster(masterId, tx);
    if (!exists) {
      throw new Error(`Master not found: ${masterId}`);
    }
    const existingVariants = await client
      .select()
      .from(productVariants)
      .where(eq(productVariants.masterId, masterId));

    if (existingVariants.length > 0) {
      throw new Error(
        'Master already has variants. Use regenerateVariants to recreate them.',
      );
    }
    const optionGroups = await client
      .select()
      .from(productOptionGroups)
      .where(eq(productOptionGroups.masterId, masterId))
      .orderBy(asc(productOptionGroups.sortOrder));
    const optionGroupsWithValues: any[] = [];
    for (const group of optionGroups) {
      const values = await client
        .select()
        .from(productOptionValues)
        .where(eq(productOptionValues.optionGroupId, group.id))
        .orderBy(asc(productOptionValues.sortOrder));

      optionGroupsWithValues.push({
        ...group,
        values,
      } as any);
    }
    if (tx) {
      await this._generateVariants(masterId, optionGroupsWithValues, tx);
    } else {
      await this.db.db.transaction(async (txn) => {
        await this._generateVariants(masterId, optionGroupsWithValues, txn);
      });
    }
  }

  async generateDefaultVariant(
    masterId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    if (!masterId) {
      throw new Error('Master ID is required');
    }

    const client = this.getClient(tx);

    const exists = await this.existsMaster(masterId, tx);
    if (!exists) {
      throw new Error(`Master not found: ${masterId}`);
    }
    const existingOptionGroups = await client
      .select()
      .from(productOptionGroups)
      .where(eq(productOptionGroups.masterId, masterId));

    if (existingOptionGroups.length > 0) {
      throw new Error(
        'Cannot generate default variant for master with option groups. Use generateVariants instead.',
      );
    }
    const existingVariants = await client
      .select()
      .from(productVariants)
      .where(eq(productVariants.masterId, masterId));

    if (existingVariants.length > 0) {
      throw new Error(
        'Master already has variants. Cannot generate default variant.',
      );
    }
    await client.insert(productVariants).values({
      masterId,
      variantName: null,
      isDefault: true,
      status: 'active',
      displayOrder: 0,
    });
  }

  async regenerateVariants(
    masterId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    if (!masterId) {
      throw new Error('Master ID is required');
    }

    const client = this.getClient(tx);

    const exists = await this.existsMaster(masterId, tx);
    if (!exists) {
      throw new Error(`Master not found: ${masterId}`);
    }
    const executeRegeneration = async (txn: DbTransaction) => {
      await txn
        .delete(productVariants)
        .where(eq(productVariants.masterId, masterId));
      const optionGroups = await txn
        .select()
        .from(productOptionGroups)
        .where(eq(productOptionGroups.masterId, masterId))
        .orderBy(asc(productOptionGroups.sortOrder));
      const optionGroupsWithValues: any[] = [];
      for (const group of optionGroups) {
        const values = await txn
          .select()
          .from(productOptionValues)
          .where(eq(productOptionValues.optionGroupId, group.id))
          .orderBy(asc(productOptionValues.sortOrder));

        optionGroupsWithValues.push({
          ...group,
          values,
        } as any);
      }
      await this._generateVariants(masterId, optionGroupsWithValues, txn);
    };

    if (tx) {
      await executeRegeneration(tx);
    } else {
      await this.db.db.transaction(async (txn) => {
        await executeRegeneration(txn);
      });
    }
  }

  async initializePricingStrategy(
    masterId: string,
    strategyData: any,
    tx?: DbTransaction,
  ): Promise<void> {
    const client = this.getClient(tx);

    try {
      const strategy = this.pricingStrategyFactory.getStrategy(
        strategyData.pricingStrategy,
      );

      if (strategyData.pricingStrategy === 'option_based') {
        const priceData: Record<string, number> = {};

        if (strategyData.optionGroups) {
          for (const group of strategyData.optionGroups) {
            for (const value of group.values) {
              if (value.price !== undefined) {
                priceData[value.id] = value.price;
              }
            }
          }
        }

        if (strategy && typeof strategy.setPriceData === 'function') {
          await strategy.setPriceData(masterId, priceData, client);
        }
      } else if (strategyData.pricingStrategy === 'variant_based') {
        const priceData: Record<string, number> = {};

        if (strategyData.variantPrices) {
          Object.assign(priceData, strategyData.variantPrices);
        }

        if (strategy && typeof strategy.setPriceData === 'function') {
          await strategy.setPriceData(masterId, priceData, client);
        }
      }
    } catch (error) {
      console.warn('Pricing strategy initialization skipped:', error.message);
    }
  }

  async changePricingStrategy(
    masterId: string,
    toStrategy: string,
    migrationData?: any,
    tx?: DbTransaction,
  ): Promise<void> {
    const client = this.getClient(tx);

    const result = await client
      .select({ pricingStrategy: productMasters.pricingStrategy })
      .from(productMasters)
      .where(eq(productMasters.id, masterId));

    const master = Array.isArray(result) ? result[0] : result;

    if (!master) {
      throw new Error(`Master not found: ${masterId}`);
    }

    const fromStrategy = master.pricingStrategy;
    await this.pricingStrategyFactory.changeStrategy(
      masterId,
      fromStrategy as any,
      toStrategy as any,
      migrationData || {},
      client,
    );
    await client
      .update(productMasters)
      .set({ pricingStrategy: toStrategy })
      .where(eq(productMasters.id, masterId));
  }

  async getPricePreview(
    masterId: string,
    tx?: DbTransaction,
  ): Promise<PricePreviewDto> {
    if (!masterId) {
      throw new Error('Master ID is required');
    }

    const client = this.getClient(tx);

    const master = await this.getMasterById(masterId, tx);
    if (!master) {
      throw new Error(`Master not found: ${masterId}`);
    }
    const variants = await client
      .select()
      .from(productVariants)
      .where(eq(productVariants.masterId, masterId))
      .orderBy(asc(productVariants.displayOrder));

    if (variants.length === 0) {
      return {
        masterId,
        variants: [],
      };
    }

    const strategy = await this.pricingStrategyFactory.getStrategy(
      master.pricingStrategy as any,
    );
    const variantPreviews: {
      variantId: string;
      optionCombination: string;
      price: number;
    }[] = [];

    for (const variant of variants) {
      try {
        const variantOptions = await client
          .select({
            optionValue: {
              id: productOptionValues.id,
              value: productOptionValues.value,
              displayName: productOptionValues.displayName,
              optionGroupId: productOptionValues.optionGroupId,
            },
            optionGroup: {
              name: productOptionGroups.name,
              displayName: productOptionGroups.displayName,
            },
          })
          .from(variantOptionValues)
          .innerJoin(
            productOptionValues,
            eq(variantOptionValues.optionValueId, productOptionValues.id),
          )
          .innerJoin(
            productOptionGroups,
            eq(productOptionValues.optionGroupId, productOptionGroups.id),
          )
          .where(eq(variantOptionValues.variantId, variant.id))
          .orderBy(asc(productOptionGroups.sortOrder));
        let optionCombination: string;
        if (variantOptions.length === 0) {
          // 옵션이 없는 기본 품목
          optionCombination = '기본 품목';
        } else {
          optionCombination = variantOptions
            .map((vo) => vo.optionValue.displayName)
            .join(' × ');
        }
        const optionInfo = variantOptions.map((vo) => ({
          optionValueId: vo.optionValue.id,
          value: vo.optionValue.value,
          groupName: vo.optionGroup.name,
        }));
        const price = await strategy.calculatePrice(optionInfo as any, client);

        variantPreviews.push({
          variantId: variant.id,
          optionCombination,
          price,
        });
      } catch (error) {
        console.warn(
          `Failed to calculate price for variant ${variant.id}:`,
          error.message,
        );

        variantPreviews.push({
          variantId: variant.id,
          optionCombination: variant.variantName || '알 수 없음',
          price: master.basePrice || 0,
        });
      }
    }

    return {
      masterId,
      variants: variantPreviews,
    };
  }

  async existsMaster(masterId: string, tx?: DbTransaction): Promise<boolean> {
    if (!masterId) {
      return false;
    }

    const client = this.getClient(tx);

    const result = await client
      .select({ count: count() })
      .from(productMasters)
      .where(eq(productMasters.id, masterId));

    return result[0].count > 0;
  }

  async updateMasterStatus(
    masterId: string,
    status: string,
    tx?: DbTransaction,
  ): Promise<void> {
    if (!masterId) {
      throw new Error('Master ID is required');
    }

    if (!status) {
      throw new Error('Status is required');
    }

    const validStatuses = ['active', 'inactive', 'draft'];
    if (!validStatuses.includes(status)) {
      throw new Error(
        `Invalid status: ${status}. Valid statuses are: ${validStatuses.join(', ')}`,
      );
    }

    const client = this.getClient(tx);

    const exists = await this.existsMaster(masterId, tx);
    if (!exists) {
      throw new Error(`Master not found: ${masterId}`);
    }
    await client
      .update(productMasters)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(productMasters.id, masterId));
  }

  private generateOptionCombinations(optionGroups: any[]): any[][] {
    if (!optionGroups || optionGroups.length === 0) {
      return [];
    }

    if (optionGroups.length === 1) {
      return optionGroups[0].values.map((value: any) => [value]);
    }
    const [firstGroup, ...restGroups] = optionGroups;
    const restCombinations = this.generateOptionCombinations(restGroups);

    const combinations: any[][] = [];

    for (const value of firstGroup.values) {
      if (restCombinations.length === 0) {
        combinations.push([value]);
      } else {
        for (const restCombination of restCombinations) {
          combinations.push([value, ...restCombination]);
        }
      }
    }

    return combinations;
  }

  public generateOptionCombinationsForTest(optionGroups: any[]): string[][] {
    const combinations = this.generateOptionCombinations(optionGroups);
    return combinations.map((combination) =>
      combination.map((option) => option.value || option),
    );
  }
}
