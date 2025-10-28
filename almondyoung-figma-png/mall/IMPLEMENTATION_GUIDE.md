# Implementation Guide - Mall Category PIM Features

## Overview
This guide provides a detailed, step-by-step implementation plan for adding the missing PIM features identified in `missing-features.md` for the mall category. The implementation is divided into 4 phases over 5 weeks.

## Prerequisites
- Node.js v18+
- PostgreSQL 14+
- NestJS framework knowledge
- Drizzle ORM familiarity
- Understanding of the current PIM architecture in `apps/pim/`

---

## Phase 1: Core Product Management (Weeks 1-2)

### 1.1 Database Schema Updates

#### Step 1.1.1: Add Missing Fields to `product_masters`

**File**: `apps/pim/src/schema.ts`

Add the following fields to the `productMasters` table:

```typescript
export const productMasters = pgTable(
  'product_masters',
  {
    // ... existing fields ...

    // Product Type
    productType: varchar('product_type', { length: 50 })
      .notNull()
      .default('regular_sale'), // 'limited_edition' | 'regular_sale'

    // Product Identification
    productCode: varchar('product_code', { length: 100 }).unique(), // Can be auto-generated
    alternativeName: varchar('alternative_name', { length: 255 }),
    material: text('material'), // Product material/composition

    // Classification
    salesClassification: varchar('sales_classification', { length: 100 }),
    purchaseClassification: varchar('purchase_classification', { length: 100 }),

    // Shipping
    shippingMethodId: uuid('shipping_method_id'), // Reference to shipping methods

    // Pricing (additional to existing)
    marketPrice: bigint('market_price', { mode: 'number' }), // MSRP
    supplyPrice: bigint('supply_price', { mode: 'number' }), // Cost price
    supplierId: uuid('supplier_id'), // Reference to supplier

    // Purchase Restrictions
    ageRestriction: integer('age_restriction').default(0), // Minimum age (0 = no restriction)
    minQuantity: integer('min_quantity').default(1),
    maxQuantity: integer('max_quantity'), // null = no limit

    // Sales Period
    salesStartDate: timestamp('sales_start_date'),
    salesEndDate: timestamp('sales_end_date'),

    // Approval Workflow
    approvalStatus: varchar('approval_status', { length: 20 })
      .notNull()
      .default('draft'), // 'draft', 'pending', 'approved', 'rejected'
    approvedAt: timestamp('approved_at'),
    approvedBy: uuid('approved_by'),
    rejectionReason: text('rejection_reason'),

    // Soft Delete
    deletedAt: timestamp('deleted_at'),
    deletedBy: uuid('deleted_by'),

    // Audit Fields
    seller: varchar('seller', { length: 100 }), // Seller/source attribution
    registrationDate: timestamp('registration_date').defaultNow(),
    lastEditDate: timestamp('last_edit_date'),

    // ... existing fields (createdAt, updatedAt, etc.) ...
  },
  (table) => [
    // ... existing indexes ...
    index('idx_masters_product_type').on(table.productType),
    index('idx_masters_product_code').on(table.productCode),
    index('idx_masters_approval_status').on(table.approvalStatus),
    index('idx_masters_deleted_at').on(table.deletedAt),
    index('idx_masters_supplier').on(table.supplierId),
    index('idx_masters_sales_dates').on(table.salesStartDate, table.salesEndDate),
  ],
);
```

#### Step 1.1.2: Create `product_variants` Extensions

Add fields to `productVariants` table:

```typescript
export const productVariants = pgTable(
  'product_variants',
  {
    // ... existing fields ...

    variantCode: varchar('variant_code', { length: 100 }).unique(), // Unique variant code
    variantImages: jsonb('variant_images').$type<string[]>(), // Variant-specific images

    // ... existing fields ...
  },
  (table) => [
    // ... existing indexes ...
    index('idx_variants_code').on(table.variantCode),
  ],
);
```

#### Step 1.1.3: Create `product_approval_history` Table

```typescript
export const productApprovalHistory = pgTable(
  'product_approval_history',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    productId: uuid('product_id')
      .notNull()
      .references(() => productMasters.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull(), // 'pending', 'approved', 'rejected'
    comment: text('comment'),
    approvedBy: uuid('approved_by').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_approval_history_product').on(table.productId),
    index('idx_approval_history_status').on(table.status),
    index('idx_approval_history_date').on(table.createdAt),
  ],
);
```

#### Step 1.1.4: Create `product_audit_log` Table

```typescript
export const productAuditLog = pgTable(
  'product_audit_log',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    productId: uuid('product_id').notNull(),
    action: varchar('action', { length: 50 }).notNull(), // 'created', 'updated', 'deleted', 'restored'
    changes: jsonb('changes').$type<Record<string, any>>(), // Field-level changes
    userId: uuid('user_id').notNull(),
    userEmail: varchar('user_email', { length: 255 }), // Denormalized for audit
    timestamp: timestamp('timestamp').notNull().defaultNow(),
    ipAddress: varchar('ip_address', { length: 45 }), // IPv4 or IPv6
    userAgent: text('user_agent'),
  },
  (table) => [
    index('idx_audit_log_product').on(table.productId),
    index('idx_audit_log_action').on(table.action),
    index('idx_audit_log_timestamp').on(table.timestamp),
    index('idx_audit_log_user').on(table.userId),
  ],
);
```

#### Step 1.1.5: Generate and Run Migration

```bash
# Generate migration
npm run db:generate:pim

# Review the generated migration in apps/pim/drizzle/

# Run migration
npm run db:migrate:pim
```

#### Step 1.1.6: Update Schema Exports

**File**: `apps/pim/src/schema.ts`

Add to schema export:

```typescript
export const pimSchema = {
  // ... existing tables ...
  productApprovalHistory,
  productAuditLog,
};

export type ProductApprovalHistory = typeof productApprovalHistory.$inferSelect;
export type NewProductApprovalHistory = typeof productApprovalHistory.$inferInsert;
export type ProductAuditLog = typeof productAuditLog.$inferSelect;
export type NewProductAuditLog = typeof productAuditLog.$inferInsert;
```

---

### 1.2 Implement Soft Delete

#### Step 1.2.1: Create Soft Delete Decorator

**File**: `apps/pim/src/decorators/soft-delete.decorator.ts`

```typescript
import { SetMetadata } from '@nestjs/common';

export const SOFT_DELETE_KEY = 'softDelete';
export const SoftDelete = () => SetMetadata(SOFT_DELETE_KEY, true);
```

#### Step 1.2.2: Update Product Masters Service

**File**: `apps/pim/src/services/product-masters.service.ts`

Add soft delete methods:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, isNull, isNotNull, and } from 'drizzle-orm';
import { DbService } from '@app/db';
import { productMasters } from '../schema';

@Injectable()
export class ProductMastersService {
  constructor(private db: DbService) {}

  // Update find methods to exclude soft-deleted by default
  async findAll(includeDeleted = false) {
    const conditions = includeDeleted
      ? []
      : [isNull(productMasters.deletedAt)];

    return this.db
      .select()
      .from(productMasters)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
  }

  async findById(id: string, includeDeleted = false) {
    const conditions = [eq(productMasters.id, id)];

    if (!includeDeleted) {
      conditions.push(isNull(productMasters.deletedAt));
    }

    const [product] = await this.db
      .select()
      .from(productMasters)
      .where(and(...conditions));

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return product;
  }

  // Soft delete
  async softDelete(id: string, userId: string) {
    const product = await this.findById(id);

    const [deleted] = await this.db
      .update(productMasters)
      .set({
        deletedAt: new Date(),
        deletedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(productMasters.id, id))
      .returning();

    // Log audit event
    await this.logAudit({
      productId: id,
      action: 'deleted',
      changes: { deletedAt: deleted.deletedAt },
      userId,
    });

    return deleted;
  }

  // Restore soft-deleted product
  async restore(id: string, userId: string) {
    const product = await this.findById(id, true);

    if (!product.deletedAt) {
      throw new Error('Product is not deleted');
    }

    const [restored] = await this.db
      .update(productMasters)
      .set({
        deletedAt: null,
        deletedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(productMasters.id, id))
      .returning();

    // Log audit event
    await this.logAudit({
      productId: id,
      action: 'restored',
      changes: { deletedAt: null },
      userId,
    });

    return restored;
  }

  // Get deleted products
  async findDeleted() {
    return this.db
      .select()
      .from(productMasters)
      .where(isNotNull(productMasters.deletedAt));
  }

  // Hard delete (permanent)
  async hardDelete(id: string, userId: string) {
    const product = await this.findById(id, true);

    await this.db
      .delete(productMasters)
      .where(eq(productMasters.id, id));

    // Log audit event (orphaned after delete, for records)
    await this.logAudit({
      productId: id,
      action: 'hard_deleted',
      changes: { permanent: true },
      userId,
    });

    return { deleted: true };
  }

  private async logAudit(data: {
    productId: string;
    action: string;
    changes: Record<string, any>;
    userId: string;
  }) {
    // Import productAuditLog when implementing
    // await this.db.insert(productAuditLog).values({...});
  }
}
```

#### Step 1.2.3: Add Controller Endpoints

**File**: `apps/pim/src/controllers/product-masters.controller.ts`

```typescript
import { Controller, Delete, Post, Get, Param, Body, Query } from '@nestjs/common';
import { ProductMastersService } from '../services/product-masters.service';

@Controller('api/pim/products')
export class ProductMastersController {
  constructor(private productsService: ProductMastersService) {}

  // Soft delete
  @Delete(':id')
  async softDelete(
    @Param('id') id: string,
    @Body('userId') userId: string, // TODO: Get from JWT auth
  ) {
    return this.productsService.softDelete(id, userId);
  }

  // Get deleted products
  @Get('deleted')
  async getDeleted() {
    return this.productsService.findDeleted();
  }

  // Restore deleted product
  @Post(':id/restore')
  async restore(
    @Param('id') id: string,
    @Body('userId') userId: string,
  ) {
    return this.productsService.restore(id, userId);
  }

  // Hard delete (optional - be careful!)
  @Delete(':id/permanent')
  async hardDelete(
    @Param('id') id: string,
    @Body('userId') userId: string,
  ) {
    return this.productsService.hardDelete(id, userId);
  }
}
```

---

### 1.3 Implement Product Approval Workflow

#### Step 1.3.1: Create Approval Service

**File**: `apps/pim/src/services/product-approval.service.ts`

```typescript
import { Injectable, BadRequestException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DbService } from '@app/db';
import { productMasters, productApprovalHistory, NewProductApprovalHistory } from '../schema';

@Injectable()
export class ProductApprovalService {
  constructor(private db: DbService) {}

  async submitForApproval(productId: string, userId: string) {
    const [product] = await this.db
      .select()
      .from(productMasters)
      .where(eq(productMasters.id, productId));

    if (!product) {
      throw new BadRequestException('Product not found');
    }

    if (product.approvalStatus !== 'draft') {
      throw new BadRequestException('Product is not in draft status');
    }

    const [updated] = await this.db
      .update(productMasters)
      .set({
        approvalStatus: 'pending',
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(productMasters.id, productId))
      .returning();

    await this.addHistory({
      productId,
      status: 'pending',
      comment: 'Submitted for approval',
      approvedBy: userId,
    });

    return updated;
  }

  async approve(productId: string, userId: string, comment?: string) {
    const [product] = await this.db
      .select()
      .from(productMasters)
      .where(eq(productMasters.id, productId));

    if (!product) {
      throw new BadRequestException('Product not found');
    }

    if (product.approvalStatus !== 'pending') {
      throw new BadRequestException('Product is not pending approval');
    }

    const [updated] = await this.db
      .update(productMasters)
      .set({
        approvalStatus: 'approved',
        approvedAt: new Date(),
        approvedBy: userId,
        status: 'active', // Activate product upon approval
        updatedAt: new Date(),
      })
      .where(eq(productMasters.id, productId))
      .returning();

    await this.addHistory({
      productId,
      status: 'approved',
      comment: comment || 'Approved',
      approvedBy: userId,
    });

    return updated;
  }

  async reject(productId: string, userId: string, reason: string) {
    const [product] = await this.db
      .select()
      .from(productMasters)
      .where(eq(productMasters.id, productId));

    if (!product) {
      throw new BadRequestException('Product not found');
    }

    if (product.approvalStatus !== 'pending') {
      throw new BadRequestException('Product is not pending approval');
    }

    const [updated] = await this.db
      .update(productMasters)
      .set({
        approvalStatus: 'rejected',
        rejectionReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(productMasters.id, productId))
      .returning();

    await this.addHistory({
      productId,
      status: 'rejected',
      comment: reason,
      approvedBy: userId,
    });

    return updated;
  }

  async getPendingApprovals() {
    return this.db
      .select()
      .from(productMasters)
      .where(eq(productMasters.approvalStatus, 'pending'));
  }

  async getApprovalHistory(productId: string) {
    return this.db
      .select()
      .from(productApprovalHistory)
      .where(eq(productApprovalHistory.productId, productId))
      .orderBy(productApprovalHistory.createdAt);
  }

  private async addHistory(data: NewProductApprovalHistory) {
    await this.db.insert(productApprovalHistory).values(data);
  }
}
```

#### Step 1.3.2: Create Approval Controller

**File**: `apps/pim/src/controllers/product-approval.controller.ts`

```typescript
import { Controller, Post, Get, Param, Body } from '@nestjs/common';
import { ProductApprovalService } from '../services/product-approval.service';

@Controller('api/pim/products')
export class ProductApprovalController {
  constructor(private approvalService: ProductApprovalService) {}

  @Post(':id/submit-approval')
  async submitForApproval(
    @Param('id') productId: string,
    @Body('userId') userId: string,
  ) {
    return this.approvalService.submitForApproval(productId, userId);
  }

  @Post(':id/approve')
  async approve(
    @Param('id') productId: string,
    @Body() body: { userId: string; comment?: string },
  ) {
    return this.approvalService.approve(productId, body.userId, body.comment);
  }

  @Post(':id/reject')
  async reject(
    @Param('id') productId: string,
    @Body() body: { userId: string; reason: string },
  ) {
    return this.approvalService.reject(productId, body.userId, body.reason);
  }

  @Get('pending-approval')
  async getPendingApprovals() {
    return this.approvalService.getPendingApprovals();
  }

  @Get(':id/approval-history')
  async getApprovalHistory(@Param('id') productId: string) {
    return this.approvalService.getApprovalHistory(productId);
  }
}
```

#### Step 1.3.3: Register in Module

**File**: `apps/pim/src/pim.module.ts`

```typescript
import { ProductApprovalService } from './services/product-approval.service';
import { ProductApprovalController } from './controllers/product-approval.controller';

@Module({
  // ... existing imports ...
  controllers: [
    // ... existing controllers ...
    ProductApprovalController,
  ],
  providers: [
    // ... existing providers ...
    ProductApprovalService,
  ],
})
export class PimModule {}
```

---

### 1.4 Implement Advanced Search and Filtering

#### Step 1.4.1: Create Query DTO

**File**: `apps/pim/src/dto/product-query.dto.ts`

```typescript
import { IsOptional, IsString, IsEnum, IsInt, Min, IsDateString, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

export class ProductQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsEnum(['draft', 'pending', 'approved', 'rejected'])
  approvalStatus?: string;

  @IsOptional()
  @IsEnum(['active', 'inactive'])
  status?: string;

  @IsOptional()
  @IsString()
  productType?: string; // 'limited_edition' | 'regular_sale'

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  seller?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(['today', 'yesterday', 'week', 'month', 'custom'])
  dateRange?: string;

  @IsOptional()
  @IsEnum(['createdAt', 'updatedAt', 'name', 'basePrice'])
  sortBy?: string;

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  includeDeleted?: boolean = false;
}
```

#### Step 1.4.2: Implement Search Service

**File**: `apps/pim/src/services/product-search.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { and, or, eq, gte, lte, like, isNull, desc, asc, inArray, sql } from 'drizzle-orm';
import { DbService } from '@app/db';
import { productMasters, productMasterCategories } from '../schema';
import { ProductQueryDto } from '../dto/product-query.dto';

@Injectable()
export class ProductSearchService {
  constructor(private db: DbService) {}

  async search(query: ProductQueryDto) {
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
    let baseQuery = this.db
      .select({
        product: productMasters,
        categoryCount: sql<number>`count(distinct ${productMasterCategories.categoryId})`,
      })
      .from(productMasters)
      .leftJoin(
        productMasterCategories,
        eq(productMasters.id, productMasterCategories.masterId),
      );

    // Category filter
    if (query.categoryIds && query.categoryIds.length > 0) {
      baseQuery = baseQuery.where(
        and(
          ...conditions,
          inArray(productMasterCategories.categoryId, query.categoryIds),
        ),
      );
    } else if (conditions.length > 0) {
      baseQuery = baseQuery.where(and(...conditions));
    }

    // Group by product
    baseQuery = baseQuery.groupBy(productMasters.id);

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
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(productMasters)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return {
      data: results.map((r) => r.product),
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
```

#### Step 1.4.3: Add Search Endpoint

**File**: `apps/pim/src/controllers/product-masters.controller.ts`

```typescript
import { Controller, Get, Query } from '@nestjs/common';
import { ProductSearchService } from '../services/product-search.service';
import { ProductQueryDto } from '../dto/product-query.dto';

@Controller('api/pim/products')
export class ProductMastersController {
  constructor(
    private productsService: ProductMastersService,
    private searchService: ProductSearchService,
  ) {}

  @Get()
  async search(@Query() query: ProductQueryDto) {
    return this.searchService.search(query);
  }
}
```

---

### 1.5 Implement Bulk Operations

#### Step 1.5.1: Create Bulk Operations DTO

**File**: `apps/pim/src/dto/bulk-operations.dto.ts`

```typescript
import { IsArray, IsString, IsOptional, IsEnum, IsInt, Min } from 'class-validator';

export class BulkUpdateDto {
  @IsArray()
  @IsString({ each: true })
  productIds: string[];

  @IsOptional()
  @IsEnum(['active', 'inactive'])
  status?: string;

  @IsOptional()
  @IsEnum(['draft', 'pending', 'approved', 'rejected'])
  approvalStatus?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  basePrice?: number;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  seller?: string;
}

export class BulkDeleteDto {
  @IsArray()
  @IsString({ each: true })
  productIds: string[];
}

export class BulkExportDto {
  @IsArray()
  @IsString({ each: true })
  productIds: string[];

  @IsOptional()
  @IsEnum(['csv', 'json', 'xlsx'])
  format?: string = 'csv';
}
```

#### Step 1.5.2: Implement Bulk Service

**File**: `apps/pim/src/services/product-bulk.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { inArray, eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { productMasters } from '../schema';
import { BulkUpdateDto, BulkDeleteDto } from '../dto/bulk-operations.dto';

@Injectable()
export class ProductBulkService {
  constructor(private db: DbService) {}

  async bulkUpdate(dto: BulkUpdateDto, userId: string) {
    const updateData: any = {
      updatedAt: new Date(),
      updatedBy: userId,
    };

    if (dto.status) updateData.status = dto.status;
    if (dto.approvalStatus) updateData.approvalStatus = dto.approvalStatus;
    if (dto.basePrice !== undefined) updateData.basePrice = dto.basePrice;
    if (dto.brand) updateData.brand = dto.brand;
    if (dto.seller) updateData.seller = dto.seller;

    const updated = await this.db
      .update(productMasters)
      .set(updateData)
      .where(inArray(productMasters.id, dto.productIds))
      .returning();

    return {
      updated: updated.length,
      products: updated,
    };
  }

  async bulkSoftDelete(dto: BulkDeleteDto, userId: string) {
    const deleted = await this.db
      .update(productMasters)
      .set({
        deletedAt: new Date(),
        deletedBy: userId,
        updatedAt: new Date(),
      })
      .where(inArray(productMasters.id, dto.productIds))
      .returning();

    return {
      deleted: deleted.length,
      products: deleted,
    };
  }

  async bulkRestore(productIds: string[], userId: string) {
    const restored = await this.db
      .update(productMasters)
      .set({
        deletedAt: null,
        deletedBy: null,
        updatedAt: new Date(),
      })
      .where(inArray(productMasters.id, productIds))
      .returning();

    return {
      restored: restored.length,
      products: restored,
    };
  }

  async bulkHardDelete(productIds: string[]) {
    await this.db
      .delete(productMasters)
      .where(inArray(productMasters.id, productIds));

    return {
      deleted: productIds.length,
    };
  }
}
```

#### Step 1.5.3: Add Bulk Controller Endpoints

**File**: `apps/pim/src/controllers/product-bulk.controller.ts`

```typescript
import { Controller, Post, Body } from '@nestjs/common';
import { ProductBulkService } from '../services/product-bulk.service';
import { BulkUpdateDto, BulkDeleteDto } from '../dto/bulk-operations.dto';

@Controller('api/pim/products/bulk')
export class ProductBulkController {
  constructor(private bulkService: ProductBulkService) {}

  @Post('update')
  async bulkUpdate(
    @Body() dto: BulkUpdateDto,
    @Body('userId') userId: string,
  ) {
    return this.bulkService.bulkUpdate(dto, userId);
  }

  @Post('delete')
  async bulkDelete(
    @Body() dto: BulkDeleteDto,
    @Body('userId') userId: string,
  ) {
    return this.bulkService.bulkSoftDelete(dto, userId);
  }

  @Post('restore')
  async bulkRestore(
    @Body('productIds') productIds: string[],
    @Body('userId') userId: string,
  ) {
    return this.bulkService.bulkRestore(productIds, userId);
  }
}
```

---

## Phase 2: Category Enhancement (Week 3)

### 2.1 Category Display and SEO Configuration

#### Step 2.1.1: Update Category Schema

**File**: `apps/pim/src/schema.ts`

```typescript
// Create types for JSONB fields
export type CategoryDisplaySettings = {
  showOnMainCategory?: boolean;
  pcAndMobile?: boolean;
  mobileOnly?: boolean;
  productDisplayOrder?: 'asc' | 'desc';
  defaultSortField?: string;
  menuPositions?: {
    leftSide?: boolean;
    topMenu?: boolean;
    footerMenu?: boolean;
  };
};

export type CategorySeoConfig = {
  browserTitle?: string;
  metaAuthor?: string;
  metaDescription?: string;
  metaKeywords?: string[];
  showInSearchEngines?: boolean;
};

export type CategoryTemplateConfig = {
  templateType?: 'default' | 'custom';
  htmlContent?: string;
  customCss?: string;
};

// Update productCategories table
export const productCategories = pgTable(
  'product_categories',
  {
    // ... existing fields ...

    visibility: boolean('visibility').notNull().default(true),
    displaySettings: jsonb('display_settings').$type<CategoryDisplaySettings>(),
    seoConfig: jsonb('seo_config').$type<CategorySeoConfig>(),
    templateConfig: jsonb('template_config').$type<CategoryTemplateConfig>(),

    // ... existing fields ...
  },
  // ... existing indexes ...
);
```

#### Step 2.1.2: Create Category Configuration DTOs

**File**: `apps/pim/src/dto/category-config.dto.ts`

```typescript
import { IsBoolean, IsOptional, IsString, IsArray, IsEnum, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class MenuPositionsDto {
  @IsOptional()
  @IsBoolean()
  leftSide?: boolean;

  @IsOptional()
  @IsBoolean()
  topMenu?: boolean;

  @IsOptional()
  @IsBoolean()
  footerMenu?: boolean;
}

export class UpdateDisplaySettingsDto {
  @IsOptional()
  @IsBoolean()
  showOnMainCategory?: boolean;

  @IsOptional()
  @IsBoolean()
  pcAndMobile?: boolean;

  @IsOptional()
  @IsBoolean()
  mobileOnly?: boolean;

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  productDisplayOrder?: 'asc' | 'desc';

  @IsOptional()
  @IsString()
  defaultSortField?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MenuPositionsDto)
  menuPositions?: MenuPositionsDto;
}

export class UpdateSeoConfigDto {
  @IsOptional()
  @IsString()
  browserTitle?: string;

  @IsOptional()
  @IsString()
  metaAuthor?: string;

  @IsOptional()
  @IsString()
  metaDescription?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  metaKeywords?: string[];

  @IsOptional()
  @IsBoolean()
  showInSearchEngines?: boolean;
}

export class UpdateTemplateConfigDto {
  @IsOptional()
  @IsEnum(['default', 'custom'])
  templateType?: 'default' | 'custom';

  @IsOptional()
  @IsString()
  htmlContent?: string;

  @IsOptional()
  @IsString()
  customCss?: string;
}
```

#### Step 2.1.3: Extend Categories Service

**File**: `apps/pim/src/services/categories.service.ts`

Add methods:

```typescript
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { productCategories, CategoryDisplaySettings, CategorySeoConfig, CategoryTemplateConfig } from '../schema';
import { UpdateDisplaySettingsDto, UpdateSeoConfigDto, UpdateTemplateConfigDto } from '../dto/category-config.dto';

@Injectable()
export class ProductCategoriesService {
  constructor(private db: DbService) {}

  // ... existing methods ...

  async updateDisplaySettings(categoryId: string, dto: UpdateDisplaySettingsDto) {
    const [category] = await this.db
      .select()
      .from(productCategories)
      .where(eq(productCategories.id, categoryId));

    if (!category) {
      throw new Error('Category not found');
    }

    const displaySettings: CategoryDisplaySettings = {
      ...(category.displaySettings as CategoryDisplaySettings),
      ...dto,
    };

    const [updated] = await this.db
      .update(productCategories)
      .set({
        displaySettings,
        updatedAt: new Date(),
      })
      .where(eq(productCategories.id, categoryId))
      .returning();

    return updated;
  }

  async updateSeoConfig(categoryId: string, dto: UpdateSeoConfigDto) {
    const [category] = await this.db
      .select()
      .from(productCategories)
      .where(eq(productCategories.id, categoryId));

    if (!category) {
      throw new Error('Category not found');
    }

    const seoConfig: CategorySeoConfig = {
      ...(category.seoConfig as CategorySeoConfig),
      ...dto,
    };

    const [updated] = await this.db
      .update(productCategories)
      .set({
        seoConfig,
        updatedAt: new Date(),
      })
      .where(eq(productCategories.id, categoryId))
      .returning();

    return updated;
  }

  async updateTemplateConfig(categoryId: string, dto: UpdateTemplateConfigDto) {
    const [category] = await this.db
      .select()
      .from(productCategories)
      .where(eq(productCategories.id, categoryId));

    if (!category) {
      throw new Error('Category not found');
    }

    const templateConfig: CategoryTemplateConfig = {
      ...(category.templateConfig as CategoryTemplateConfig),
      ...dto,
    };

    const [updated] = await this.db
      .update(productCategories)
      .set({
        templateConfig,
        updatedAt: new Date(),
      })
      .where(eq(productCategories.id, categoryId))
      .returning();

    return updated;
  }

  async updateVisibility(categoryId: string, visible: boolean) {
    const [updated] = await this.db
      .update(productCategories)
      .set({
        visibility: visible,
        updatedAt: new Date(),
      })
      .where(eq(productCategories.id, categoryId))
      .returning();

    return updated;
  }
}
```

#### Step 2.1.4: Add Category Configuration Endpoints

**File**: `apps/pim/src/controllers/categories.controller.ts`

```typescript
import { Controller, Patch, Param, Body } from '@nestjs/common';
import { ProductCategoriesService } from '../services/categories.service';
import { UpdateDisplaySettingsDto, UpdateSeoConfigDto, UpdateTemplateConfigDto } from '../dto/category-config.dto';

@Controller('api/pim/categories')
export class ProductCategoriesController {
  constructor(private categoriesService: ProductCategoriesService) {}

  // ... existing endpoints ...

  @Patch(':id/display-settings')
  async updateDisplaySettings(
    @Param('id') categoryId: string,
    @Body() dto: UpdateDisplaySettingsDto,
  ) {
    return this.categoriesService.updateDisplaySettings(categoryId, dto);
  }

  @Patch(':id/seo')
  async updateSeoConfig(
    @Param('id') categoryId: string,
    @Body() dto: UpdateSeoConfigDto,
  ) {
    return this.categoriesService.updateSeoConfig(categoryId, dto);
  }

  @Patch(':id/template')
  async updateTemplateConfig(
    @Param('id') categoryId: string,
    @Body() dto: UpdateTemplateConfigDto,
  ) {
    return this.categoriesService.updateTemplateConfig(categoryId, dto);
  }

  @Patch(':id/visibility')
  async updateVisibility(
    @Param('id') categoryId: string,
    @Body('visible') visible: boolean,
  ) {
    return this.categoriesService.updateVisibility(categoryId, visible);
  }
}
```

---

## Phase 3: Advanced Features (Week 4)

### 3.1 CSV Bulk Import/Export

#### Step 3.1.1: Install CSV Processing Libraries

```bash
npm install papaparse
npm install --save-dev @types/papaparse
```

#### Step 3.1.2: Create CSV Service

**File**: `apps/pim/src/services/product-csv.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import * as Papa from 'papaparse';
import { DbService } from '@app/db';
import { productMasters, NewProductMaster } from '../schema';

export interface ProductCsvRow {
  productCode?: string;
  name: string;
  description?: string;
  brand?: string;
  basePrice?: number;
  status?: string;
  productType?: string;
  // ... add all relevant fields
}

@Injectable()
export class ProductCsvService {
  constructor(private db: DbService) {}

  /**
   * Parse CSV file content and return structured data
   */
  parseCsv(csvContent: string): Promise<ProductCsvRow[]> {
    return new Promise((resolve, reject) => {
      Papa.parse(csvContent, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          resolve(results.data as ProductCsvRow[]);
        },
        error: (error) => {
          reject(error);
        },
      });
    });
  }

  /**
   * Validate CSV data before import
   */
  validateCsvData(data: ProductCsvRow[]): {
    valid: ProductCsvRow[];
    invalid: Array<{ row: number; errors: string[]; data: ProductCsvRow }>;
  } {
    const valid: ProductCsvRow[] = [];
    const invalid: Array<{ row: number; errors: string[]; data: ProductCsvRow }> = [];

    data.forEach((row, index) => {
      const errors: string[] = [];

      if (!row.name || row.name.trim() === '') {
        errors.push('Product name is required');
      }

      if (row.basePrice !== undefined && (isNaN(Number(row.basePrice)) || Number(row.basePrice) < 0)) {
        errors.push('Base price must be a non-negative number');
      }

      if (errors.length > 0) {
        invalid.push({ row: index + 2, errors, data: row }); // +2 for header and 1-based indexing
      } else {
        valid.push(row);
      }
    });

    return { valid, invalid };
  }

  /**
   * Import products from CSV data
   */
  async importProducts(csvData: ProductCsvRow[], userId: string) {
    const { valid, invalid } = this.validateCsvData(csvData);

    if (valid.length === 0) {
      return {
        imported: 0,
        failed: invalid.length,
        errors: invalid,
      };
    }

    // Transform CSV rows to database records
    const productsToInsert: NewProductMaster[] = valid.map((row) => ({
      productCode: row.productCode || undefined,
      name: row.name,
      description: row.description || undefined,
      brand: row.brand || undefined,
      basePrice: row.basePrice ? Number(row.basePrice) : undefined,
      status: (row.status as any) || 'draft',
      productType: (row.productType as any) || 'regular_sale',
      approvalStatus: 'draft',
      createdBy: userId,
      updatedBy: userId,
    }));

    // Batch insert
    const inserted = await this.db
      .insert(productMasters)
      .values(productsToInsert)
      .returning();

    return {
      imported: inserted.length,
      failed: invalid.length,
      errors: invalid,
      products: inserted,
    };
  }

  /**
   * Export products to CSV format
   */
  async exportProducts(productIds?: string[]): Promise<string> {
    let query = this.db.select().from(productMasters);

    if (productIds && productIds.length > 0) {
      query = query.where(productMasters.id);
    }

    const products = await query;

    // Transform to CSV-friendly format
    const csvData = products.map((product) => ({
      productCode: product.productCode || '',
      name: product.name,
      description: product.description || '',
      brand: product.brand || '',
      basePrice: product.basePrice || 0,
      status: product.status || 'draft',
      productType: product.productType || 'regular_sale',
      approvalStatus: product.approvalStatus || 'draft',
      createdAt: product.createdAt?.toISOString() || '',
    }));

    // Generate CSV string
    const csv = Papa.unparse(csvData);
    return csv;
  }

  /**
   * Generate CSV template for bulk import
   */
  generateTemplate(): string {
    const template = [
      {
        productCode: 'PROD001',
        name: 'Example Product',
        description: 'Product description',
        brand: 'Brand Name',
        basePrice: '10000',
        status: 'active',
        productType: 'regular_sale',
      },
    ];

    return Papa.unparse(template);
  }
}
```

#### Step 3.1.3: Create CSV Controller

**File**: `apps/pim/src/controllers/product-csv.controller.ts`

```typescript
import {
  Controller,
  Post,
  Get,
  UseInterceptors,
  UploadedFile,
  Body,
  Query,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ProductCsvService } from '../services/product-csv.service';

@Controller('api/pim/products')
export class ProductCsvController {
  constructor(private csvService: ProductCsvService) {}

  @Get('csv/template')
  async downloadTemplate(@Res() res: Response) {
    const csv = this.csvService.generateTemplate();

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=product-import-template.csv');
    res.send(csv);
  }

  @Post('bulk-import')
  @UseInterceptors(FileInterceptor('file'))
  async bulkImport(
    @UploadedFile() file: Express.Multer.File,
    @Body('userId') userId: string,
  ) {
    if (!file) {
      throw new Error('No file uploaded');
    }

    const csvContent = file.buffer.toString('utf-8');
    const csvData = await this.csvService.parseCsv(csvContent);

    return this.csvService.importProducts(csvData, userId);
  }

  @Get('export')
  async exportProducts(
    @Query('productIds') productIds: string,
    @Res() res: Response,
  ) {
    const ids = productIds ? productIds.split(',') : undefined;
    const csv = await this.csvService.exportProducts(ids);

    const filename = `products-export-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(csv);
  }
}
```

#### Step 3.1.4: Configure Multer in Main

**File**: `apps/pim/src/main.ts`

```typescript
import { NestFactory } from '@nestjs/core';
import { PimModule } from './pim.module';
import * as multer from 'multer';

async function bootstrap() {
  const app = await NestFactory.create(PimModule);

  // Configure multer for file uploads
  app.use(multer().any());

  await app.listen(3001); // PIM service port
}
bootstrap();
```

---

### 3.2 Product Audit Logging

#### Step 3.2.1: Create Audit Interceptor

**File**: `apps/pim/src/interceptors/audit-log.interceptor.ts`

```typescript
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { DbService } from '@app/db';
import { productAuditLog } from '../schema';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private db: DbService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, ip, headers } = request;

    // Only log mutations (POST, PUT, PATCH, DELETE)
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle();
    }

    const userId = body.userId || headers['x-user-id']; // Get user from auth
    const productId = request.params.id || body.productId;

    return next.handle().pipe(
      tap(async (response) => {
        if (productId && userId) {
          await this.db.insert(productAuditLog).values({
            productId,
            action: this.mapMethodToAction(method),
            changes: body,
            userId,
            userEmail: headers['x-user-email'] || 'unknown',
            ipAddress: ip,
            userAgent: headers['user-agent'],
          });
        }
      }),
    );
  }

  private mapMethodToAction(method: string): string {
    const actionMap = {
      POST: 'created',
      PUT: 'updated',
      PATCH: 'updated',
      DELETE: 'deleted',
    };
    return actionMap[method] || 'unknown';
  }
}
```

#### Step 3.2.2: Apply Interceptor Globally

**File**: `apps/pim/src/pim.module.ts`

```typescript
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditLogInterceptor } from './interceptors/audit-log.interceptor';

@Module({
  // ... existing config ...
  providers: [
    // ... existing providers ...
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
  ],
})
export class PimModule {}
```

---

## Phase 4: Analytics & Monitoring (Week 5)

### 4.1 Dashboard Metrics Service

#### Step 4.1.1: Create Dashboard Service

**File**: `apps/pim/src/services/dashboard.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { eq, and, gte, lte, sql, isNull } from 'drizzle-orm';
import { DbService } from '@app/db';
import { productMasters } from '../schema';

@Injectable()
export class DashboardService {
  constructor(private db: DbService) {}

  async getMetrics() {
    const now = new Date();
    const today = new Date(now.setHours(0, 0, 0, 0));

    // Total products
    const [{ totalProducts }] = await this.db
      .select({ totalProducts: sql<number>`count(*)` })
      .from(productMasters)
      .where(isNull(productMasters.deletedAt));

    // Products by status
    const productsByStatus = await this.db
      .select({
        status: productMasters.status,
        count: sql<number>`count(*)`,
      })
      .from(productMasters)
      .where(isNull(productMasters.deletedAt))
      .groupBy(productMasters.status);

    // Products by approval status
    const productsByApproval = await this.db
      .select({
        approvalStatus: productMasters.approvalStatus,
        count: sql<number>`count(*)`,
      })
      .from(productMasters)
      .where(isNull(productMasters.deletedAt))
      .groupBy(productMasters.approvalStatus);

    // Products created today
    const [{ createdToday }] = await this.db
      .select({ createdToday: sql<number>`count(*)` })
      .from(productMasters)
      .where(
        and(
          isNull(productMasters.deletedAt),
          gte(productMasters.createdAt, today),
        ),
      );

    // Out of stock products (would need integration with WMS)
    // Placeholder for now
    const outOfStock = 0;

    return {
      totalProducts: Number(totalProducts),
      createdToday: Number(createdToday),
      outOfStock,
      byStatus: productsByStatus.map((s) => ({
        status: s.status,
        count: Number(s.count),
      })),
      byApproval: productsByApproval.map((a) => ({
        approvalStatus: a.approvalStatus,
        count: Number(a.count),
      })),
    };
  }

  async getTopProducts(limit = 5) {
    // This would need integration with order/sales data
    // Placeholder implementation
    return this.db
      .select()
      .from(productMasters)
      .where(
        and(
          isNull(productMasters.deletedAt),
          eq(productMasters.status, 'active'),
        ),
      )
      .limit(limit);
  }

  async getSalesTrends(days = 30) {
    // This requires integration with order service
    // Placeholder for structure
    return {
      labels: [], // Array of dates
      data: [], // Array of sales amounts
    };
  }
}
```

#### Step 4.1.2: Create Dashboard Controller

**File**: `apps/pim/src/controllers/dashboard.controller.ts`

```typescript
import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from '../services/dashboard.service';

@Controller('api/pim/dashboard')
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('metrics')
  async getMetrics() {
    return this.dashboardService.getMetrics();
  }

  @Get('top-products')
  async getTopProducts(@Query('limit') limit?: string) {
    return this.dashboardService.getTopProducts(
      limit ? parseInt(limit) : 5,
    );
  }

  @Get('sales-trends')
  async getSalesTrends(@Query('days') days?: string) {
    return this.dashboardService.getSalesTrends(
      days ? parseInt(days) : 30,
    );
  }
}
```

---

## Testing

### Unit Tests Example

**File**: `apps/pim/src/services/product-masters.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ProductMastersService } from './product-masters.service';
import { DbService } from '@app/db';

describe('ProductMastersService', () => {
  let service: ProductMastersService;
  let dbService: jest.Mocked<DbService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductMastersService,
        {
          provide: DbService,
          useValue: {
            select: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            insert: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ProductMastersService>(ProductMastersService);
    dbService = module.get(DbService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('softDelete', () => {
    it('should soft delete a product', async () => {
      const mockProduct = {
        id: 'test-id',
        name: 'Test Product',
        deletedAt: null,
      };

      const mockDeleted = {
        ...mockProduct,
        deletedAt: new Date(),
      };

      dbService.select = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([mockProduct]),
        }),
      });

      dbService.update = jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([mockDeleted]),
          }),
        }),
      });

      const result = await service.softDelete('test-id', 'user-id');

      expect(result.deletedAt).toBeDefined();
    });
  });
});
```

### E2E Tests Example

**File**: `apps/pim/test/product-masters.e2e-spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PimModule } from '../src/pim.module';

describe('ProductMasters (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PimModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api/pim/products (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/pim/products')
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('data');
        expect(res.body).toHaveProperty('pagination');
      });
  });

  it('/api/pim/products/:id (DELETE) - soft delete', () => {
    return request(app.getHttpServer())
      .delete('/api/pim/products/test-id')
      .send({ userId: 'test-user' })
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('deletedAt');
      });
  });
});
```

---

## Deployment

### Run Migrations

```bash
# Generate migrations for all schema changes
npm run db:generate:pim

# Review migrations in apps/pim/drizzle/

# Apply migrations
npm run db:migrate:pim
```

### Build and Start

```bash
# Build PIM service
npm run build:pim

# Start in production
npm run start:pim:prod
```

### Environment Variables

**File**: `.env`

```env
DATABASE_URL=postgresql://user:password@host:port/database
PIM_PORT=3001
NODE_ENV=production
```

---

## API Documentation

### Key Endpoints Summary

#### Products
- `GET /api/pim/products` - Search/list products with filters
- `POST /api/pim/products` - Create product
- `GET /api/pim/products/:id` - Get product details
- `PATCH /api/pim/products/:id` - Update product
- `DELETE /api/pim/products/:id` - Soft delete product
- `POST /api/pim/products/:id/restore` - Restore deleted product
- `GET /api/pim/products/deleted` - List deleted products

#### Approval Workflow
- `POST /api/pim/products/:id/submit-approval` - Submit for approval
- `POST /api/pim/products/:id/approve` - Approve product
- `POST /api/pim/products/:id/reject` - Reject product
- `GET /api/pim/products/pending-approval` - List pending approvals
- `GET /api/pim/products/:id/approval-history` - Get approval history

#### Bulk Operations
- `POST /api/pim/products/bulk/update` - Bulk update products
- `POST /api/pim/products/bulk/delete` - Bulk soft delete
- `POST /api/pim/products/bulk/restore` - Bulk restore

#### CSV Import/Export
- `GET /api/pim/products/csv/template` - Download CSV template
- `POST /api/pim/products/bulk-import` - Import from CSV
- `GET /api/pim/products/export` - Export to CSV

#### Categories
- `PATCH /api/pim/categories/:id/display-settings` - Update display config
- `PATCH /api/pim/categories/:id/seo` - Update SEO config
- `PATCH /api/pim/categories/:id/template` - Update template
- `PATCH /api/pim/categories/:id/visibility` - Toggle visibility

#### Dashboard
- `GET /api/pim/dashboard/metrics` - Get dashboard metrics
- `GET /api/pim/dashboard/top-products` - Get top products
- `GET /api/pim/dashboard/sales-trends` - Get sales trends

---

## Next Steps

1. **Implement Authentication/Authorization**
   - Add JWT authentication
   - Implement role-based access control (RBAC)
   - Protect approval endpoints with admin roles

2. **Frontend Integration**
   - Build React/Vue components for product forms
   - Implement bulk operation UI
   - Create dashboard visualizations

3. **WMS Integration**
   - Connect product variants to WMS SKUs
   - Implement stock availability queries
   - Add inventory status to product lists

4. **Performance Optimization**
   - Add Redis caching for frequent queries
   - Implement database query optimization
   - Add pagination for large result sets

5. **Monitoring & Logging**
   - Set up application logging (Winston/Pino)
   - Implement error tracking (Sentry)
   - Add performance monitoring (New Relic/DataDog)

---

## Troubleshooting

### Common Issues

**Issue**: Migration fails with foreign key constraint
- **Solution**: Ensure parent tables exist before creating foreign keys
- Run migrations in correct order

**Issue**: Soft deleted products still appear in listings
- **Solution**: Ensure `isNull(productMasters.deletedAt)` is in WHERE clauses
- Update all query methods to respect soft delete

**Issue**: CSV import fails with validation errors
- **Solution**: Check CSV template format matches expected schema
- Validate data types (numbers, dates) in CSV

**Issue**: Bulk operations timeout
- **Solution**: Implement batch processing for large datasets
- Add queue system (Bull) for async processing

---

## Conclusion

This implementation guide provides a comprehensive roadmap for implementing the missing PIM features identified in the mall category Figma designs. Follow the phases sequentially, ensuring proper testing at each step. The modular approach allows for incremental delivery while maintaining code quality and system stability.
