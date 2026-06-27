import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, or, eq, gte, lte, like, isNull, desc, asc, inArray, sql, SQL } from 'drizzle-orm';
import {
  type PimSchema,
  productMasters,
  productMasterVersions,
  productMasterCategories,
} from '../../../schema/catalog.schema';
import { ProductQueryDto } from '../dto';
import { DbTransaction, DbClient } from '../../../catalog.types';

@Injectable()
export class ProductSearchService {
  constructor(@InjectDb() private readonly db: DbService<PimSchema>) {}

  private getClient(tx?: DbTransaction): DbClient {
    return tx ?? this.db.db;
  }

  async search(query: ProductQueryDto, tx?: DbTransaction) {
    const client = this.getClient(tx);
    const conditions = this.buildConditions(query);

    // Category가 있는 경우와 없는 경우를 명확하게 분리
    if (query.categoryIds && query.categoryIds.length > 0) {
      return this.searchWithCategory(client, query, conditions);
    } else {
      return this.searchWithoutCategory(client, query, conditions);
    }
  }

  private buildConditions(query: ProductQueryDto): SQL[] {
    const conditions: SQL[] = [];

    // Active version filter (default for searches)
    conditions.push(eq(productMasterVersions.status, 'active'));

    // Soft delete filter
    if (!query.includeDeleted) {
      conditions.push(isNull(productMasterVersions.deletedAt));
      conditions.push(isNull(productMasters.deletedAt));
    }

    // Keyword search (name, description, product code)
    if (query.keyword) {
      const keywordCondition = or(
        like(productMasterVersions.name, `%${query.keyword}%`),
        like(productMasterVersions.description, `%${query.keyword}%`),
        like(productMasterVersions.productCode, `%${query.keyword}%`),
        like(productMasterVersions.brand, `%${query.keyword}%`),
      );
      if (keywordCondition) {
        conditions.push(keywordCondition);
      }
    }

    // Approval status filter
    if (query.approvalStatus) {
      conditions.push(eq(productMasterVersions.approvalStatus, query.approvalStatus));
    }

    // Status filter
    if (query.status) {
      conditions.push(eq(productMasterVersions.status, query.status));
    }

    // Product type filter
    if (query.productType) {
      conditions.push(eq(productMasterVersions.productType, query.productType));
    }

    // Brand filter
    if (query.brand) {
      conditions.push(eq(productMasterVersions.brand, query.brand));
    }

    // Seller filter
    if (query.seller) {
      conditions.push(eq(productMasterVersions.seller, query.seller));
    }

    // Date range
    const { startDate, endDate } = this.parseDateRange(query);
    if (startDate) {
      conditions.push(gte(productMasterVersions.createdAt, startDate));
    }
    if (endDate) {
      conditions.push(lte(productMasterVersions.createdAt, endDate));
    }

    return conditions;
  }

  private async searchWithCategory(
    client: ReturnType<typeof this.getClient>,
    query: ProductQueryDto,
    conditions: SQL[],
  ) {
    const categoryCondition = inArray(productMasterCategories.categoryId, query.categoryIds!);

    // Main query
    const page = query.page || 1;
    const limit = query.limit || 20;
    const offset = (page - 1) * limit;

    const results = await client
      .select()
      .from(productMasterVersions)
      .innerJoin(productMasters, eq(productMasterVersions.masterId, productMasters.id))
      .innerJoin(
        productMasterCategories,
        and(
          eq(productMasterCategories.masterId, productMasterVersions.masterId),
          eq(productMasterCategories.versionId, productMasterVersions.id),
        ),
      )
      .where(and(...conditions, categoryCondition))
      .orderBy(this.getSortOrder(query))
      .limit(limit)
      .offset(offset);

    // Count query (동일한 조건 적용 + distinct!)
    const [{ count }] = await client
      .select({ count: sql<number>`count(distinct ${productMasterVersions.id})` })
      .from(productMasterVersions)
      .innerJoin(productMasters, eq(productMasterVersions.masterId, productMasters.id))
      .innerJoin(
        productMasterCategories,
        and(
          eq(productMasterCategories.masterId, productMasterVersions.masterId),
          eq(productMasterCategories.versionId, productMasterVersions.id),
        ),
      )
      .where(and(...conditions, categoryCondition));

    return this.buildPaginationResponse(results, query, Number(count));
  }

  private async searchWithoutCategory(
    client: ReturnType<typeof this.getClient>,
    query: ProductQueryDto,
    conditions: SQL[],
  ) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const offset = (page - 1) * limit;

    // Main query
    const results = await client
      .select()
      .from(productMasterVersions)
      .innerJoin(productMasters, eq(productMasterVersions.masterId, productMasters.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(this.getSortOrder(query))
      .limit(limit)
      .offset(offset);

    // Count query
    const [{ count }] = await client
      .select({ count: sql<number>`count(*)` })
      .from(productMasterVersions)
      .innerJoin(productMasters, eq(productMasterVersions.masterId, productMasters.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return this.buildPaginationResponse(results, query, Number(count));
  }

  private getSortOrder(query: ProductQueryDto) {
    const sortField = query.sortBy || 'createdAt';
    const sortDirection = query.sortOrder === 'asc' ? asc : desc;
    return sortDirection(productMasterVersions[sortField]);
  }

  private buildPaginationResponse(results: any[], query: ProductQueryDto, total: number) {
    const page = query.page || 1;
    const limit = query.limit || 20;

    return {
      data: results,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private parseDateRange(query: ProductQueryDto): {
    startDate?: Date;
    endDate?: Date;
  } {
    const now = new Date();

    switch (query.dateRange) {
      case 'today':
        return {
          startDate: new Date(now.setHours(0, 0, 0, 0)),
          endDate: new Date(now.setHours(23, 59, 59, 999)),
        };
      case 'yesterday':
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        return {
          startDate: new Date(yesterday.setHours(0, 0, 0, 0)),
          endDate: new Date(yesterday.setHours(23, 59, 59, 999)),
        };
      case 'week':
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        return { startDate: weekAgo, endDate: now };
      case 'month':
        const monthAgo = new Date(now);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        return { startDate: monthAgo, endDate: now };
      case 'custom':
        return {
          startDate: query.startDate ? new Date(query.startDate) : undefined,
          endDate: query.endDate ? new Date(query.endDate) : undefined,
        };
      default:
        return {};
    }
  }
}
