import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, or, eq, gte, lte, like, isNull, desc, asc, inArray, sql } from 'drizzle-orm';
import {
  type PimSchema,
  productMasters,
  productMasterCategories,
} from '../schema';
import { ProductQueryDto } from '../dto/product-query.dto';
import { DbTransaction } from '../types';

@Injectable()
export class ProductSearchService {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.db.db;
  }

  async search(query: ProductQueryDto, tx?: DbTransaction) {
    const client = this.getClient(tx);
    const conditions = [];

    // Soft delete filter
    if (!query.includeDeleted) {
      conditions.push(isNull(productMasters.deletedAt));
    }

    // Keyword search (name, description, product code)
    if (query.keyword) {
      conditions.push(
        or(
          like(productMasters.name, `%${query.keyword}%`),
          like(productMasters.description, `%${query.keyword}%`),
          like(productMasters.productCode, `%${query.keyword}%`),
          like(productMasters.brand, `%${query.keyword}%`),
        ),
      );
    }

    // Approval status filter
    if (query.approvalStatus) {
      conditions.push(eq(productMasters.approvalStatus, query.approvalStatus));
    }

    // Status filter
    if (query.status) {
      conditions.push(eq(productMasters.status, query.status));
    }

    // Product type filter
    if (query.productType) {
      conditions.push(eq(productMasters.productType, query.productType));
    }

    // Brand filter
    if (query.brand) {
      conditions.push(eq(productMasters.brand, query.brand));
    }

    // Seller filter
    if (query.seller) {
      conditions.push(eq(productMasters.seller, query.seller));
    }

    // Price range
    if (query.minPrice !== undefined) {
      conditions.push(gte(productMasters.basePrice, query.minPrice));
    }
    if (query.maxPrice !== undefined) {
      conditions.push(lte(productMasters.basePrice, query.maxPrice));
    }

    // Date range
    const { startDate, endDate } = this.parseDateRange(query);
    if (startDate) {
      conditions.push(gte(productMasters.createdAt, startDate));
    }
    if (endDate) {
      conditions.push(lte(productMasters.createdAt, endDate));
    }

    // Base query
    let baseQuery = client
      .select()
      .from(productMasters);

    // Category filter
    if (query.categoryIds && query.categoryIds.length > 0) {
      baseQuery = baseQuery
        .innerJoin(
          productMasterCategories,
          eq(productMasters.id, productMasterCategories.masterId),
        )
        .where(
          and(
            ...conditions,
            inArray(productMasterCategories.categoryId, query.categoryIds),
          ),
        );
    } else if (conditions.length > 0) {
      baseQuery = baseQuery.where(and(...conditions));
    }

    // Sorting
    const sortField = query.sortBy || 'createdAt';
    const sortDirection = query.sortOrder === 'asc' ? asc : desc;
    baseQuery = baseQuery.orderBy(sortDirection(productMasters[sortField]));

    // Pagination
    const page = query.page || 1;
    const limit = query.limit || 20;
    const offset = (page - 1) * limit;

    const results = await baseQuery.limit(limit).offset(offset);

    // Get total count
    const countQuery = client
      .select({ count: sql<number>`count(*)` })
      .from(productMasters);
    
    if (conditions.length > 0) {
      countQuery.where(and(...conditions));
    }

    const [{ count }] = await countQuery;

    return {
      data: results,
      pagination: {
        page,
        limit,
        total: Number(count),
        totalPages: Math.ceil(Number(count) / limit),
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

