# Almondyoung WMS - Figma Design Implementation Guide

**Version:** 1.0
**Date:** 2025-10-15
**Estimated Timeline:** 10-12 weeks
**Target Audience:** Backend developers implementing inventory management features

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Prerequisites & Environment Setup](#prerequisites--environment-setup)
3. [Phase 1: Critical Path (Weeks 1-3)](#phase-1-critical-path-weeks-1-3)
4. [Phase 2: High Priority (Weeks 4-6)](#phase-2-high-priority-weeks-4-6)
5. [Phase 3: Medium Priority (Weeks 7-9)](#phase-3-medium-priority-weeks-7-9)
6. [Phase 4: Polish & Testing (Weeks 10-12)](#phase-4-polish--testing-weeks-10-12)
7. [Testing Strategy](#testing-strategy)
8. [Deployment Checklist](#deployment-checklist)

---

## Executive Summary

### Current State

Based on comprehensive analysis of Figma designs against backend implementation:

- **Overall Implementation Gap:** ~55% (over half of required features missing)
- **Total New API Endpoints Needed:** ~60
- **Database Schema Changes:** 3 tables to modify, 8 new tables to create
- **Critical Blockers:** Safety stock field, Stocktaking module, Inbound Lists management

### Implementation Phases

| Phase | Duration | Focus | Risk Level |
|-------|----------|-------|------------|
| Phase 1 | 3 weeks | Critical blockers (safety stock, inbound, stocktaking) | 🔴 Critical |
| Phase 2 | 3-4 weeks | SKU enhancements, pricing, barcode system | 🟡 High |
| Phase 3 | 2-3 weeks | Options, audit workflows, managers | 🟢 Medium |
| Phase 4 | 2 weeks | Testing, optimization, documentation | 🟢 Low |

### Key Deliverables

✅ **Phase 1 Completion:**
- Safety stock management operational
- Inbound lists fully functional
- Stocktaking module complete with barcode scanning

✅ **Phase 2 Completion:**
- Extended SKU metadata available
- Multi-tier pricing system
- Barcode printing and location management

✅ **Phase 3 Completion:**
- Option/variant management as first-class entities
- Purchase order audit workflow
- Manager assignments

✅ **Phase 4 Completion:**
- Advanced filtering and reporting
- 100% test coverage on critical paths
- Production deployment ready

---

## Prerequisites & Environment Setup

### Before You Start

#### 1. Verify Development Environment

```bash
# Check Node.js version (should be 18+)
node --version

# Check npm version
npm --version

# Verify database connection
npm run db:push.wms

# Run existing tests to ensure baseline
npm run wms:test
```

#### 2. Create Feature Branch

```bash
# Create and checkout feature branch
git checkout -b feature/figma-design-implementation

# Ensure you're on the latest master
git fetch origin
git merge origin/master
```

#### 3. Backup Database

```bash
# Create database backup before migrations
pg_dump -U your_username -d almondyoung_wms > backup_$(date +%Y%m%d_%H%M%S).sql
```

#### 4. Install Additional Dependencies

```bash
# For barcode generation
npm install bwip-js

# For PDF generation (Phase 4)
npm install pdfmake

# For testing
npm install --save-dev @testcontainers/postgresql
```

### Migration Strategy

#### Golden Rules

1. ✅ **Always add fields with DEFAULT values** to avoid breaking existing data
2. ✅ **Make new fields NULLABLE initially**, require them in application layer
3. ✅ **Test migrations on dev database first**
4. ✅ **Keep rollback scripts ready**
5. ✅ **Run migrations during low-traffic periods**

#### Migration Template

```typescript
// Template for all migrations in this project
import { sql } from 'drizzle-orm';
import { db } from '../database/connection';

export async function up() {
    // UP migration
    await db.execute(sql`
        -- Your schema changes here
    `);
}

export async function down() {
    // ROLLBACK migration
    await db.execute(sql`
        -- Reverse your changes here
    `);
}
```

---

## Phase 1: Critical Path (Weeks 1-3)

**Estimated Effort:** 15-20 developer days
**Priority:** 🔴 CRITICAL - Blocks frontend development

### Week 1, Day 1-2: Safety Stock Implementation

#### Objective
Add the missing `safetyStock` field to the `skus` table. This field is **REQUIRED** in the UI but completely missing in the backend.

#### Step 1.1: Update Database Schema

**File:** `apps/wms/database/schemas/wms-schema.ts`

**Locate the `skus` table definition (around line 286):**

```typescript
export const skus = pgTable('skus', {
    id: uuid('id').primaryKey().defaultRandom(),
    holderId: uuid('holder_id').notNull(),
    masterId: uuid('master_id').references(() => inventoryProductMasters.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    code: varchar('code', { length: 100 }).notNull(),
    optionKey: json('option_key').$type<Record<string, any>>(),
    defaultBarcode: varchar('default_barcode', { length: 64 }),
    stockType: stockTypeEnum('stock_type').notNull(),
    deliveryProfileId: uuid('delivery_profile_id'),
    sale1m: integer('sale_1m').default(0),
    sale3m: integer('sale_3m').default(0),

    // 🔴 ADD THIS CRITICAL FIELD
    safetyStock: integer('safety_stock').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

#### Step 1.2: Generate and Run Migration

```bash
# Generate migration
npm run db:generate.wms

# Review the generated migration file
# File will be in: apps/wms/database/migrations/

# Push to database
npm run db:push.wms

# Verify the column was added
psql -d almondyoung_wms -c "\d skus"
```

#### Step 1.3: Update DTOs

**File:** `apps/wms/src/inventory/dto/sku/create-sku.dto.ts`

```typescript
import { IsNotEmpty, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSkuDto {
    // ... existing fields ...

    @ApiProperty({
        description: '안전 재고 (Safety stock) - REQUIRED',
        required: true,
        minimum: 0,
        example: 10
    })
    @IsInt()
    @Min(0)
    @IsNotEmpty()
    safetyStock: number; // 🔴 NEW REQUIRED FIELD
}
```

**File:** `apps/wms/src/inventory/dto/sku/sku-response.dto.ts`

```typescript
export class SkuResponseDto {
    // ... existing fields ...

    @ApiProperty({
        description: 'Safety stock threshold',
        example: 10
    })
    safetyStock: number; // 🔴 NEW FIELD
}
```

#### Step 1.4: Update Service Layer

**File:** `apps/wms/src/inventory/services/inventory.service.ts`

**Update the `createSku` method to include safety stock:**

```typescript
async createSku(createSkuDto: CreateSkuDto, tx?: DbTx): Promise<SkuResponseDto> {
    return this.inTx(async (tx) => {
        // Validate safety stock
        if (createSkuDto.safetyStock < 0) {
            throw new BadRequestException('Safety stock cannot be negative');
        }

        const result = await tx
            .insert(skus)
            .values({
                holderId: createSkuDto.holderId,
                masterId: createSkuDto.masterId,
                name: createSkuDto.name,
                code: createSkuDto.code,
                defaultBarcode: createSkuDto.defaultBarcode,
                stockType: createSkuDto.stockType,
                safetyStock: createSkuDto.safetyStock, // 🔴 NEW
                // ... other fields
            })
            .returning();

        return this.mapToResponseDto(result[0]);
    }, tx);
}
```

#### Step 1.5: Add Safety Stock Validation

**Create new file:** `apps/wms/src/inventory/services/safety-stock.service.ts`

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { DbTx } from '../../database/schemas/wms-schema';
import { skus, stockSummary } from '../../database/schemas/wms-schema';
import { eq, and, lt, sql } from 'drizzle-orm';

export interface SafetyStockWarning {
    skuId: string;
    skuName: string;
    skuCode: string;
    currentStock: number;
    safetyStock: number;
    shortfall: number;
    warehouseId: string;
}

@Injectable()
export class SafetyStockService {
    constructor(@Inject('DB') private db: DbTx) {}

    /**
     * Get all SKUs below safety stock threshold
     */
    async getBelowSafetyStock(warehouseId?: string, tx?: DbTx): Promise<SafetyStockWarning[]> {
        return this.inTx(async (tx) => {
            const query = tx
                .select({
                    skuId: skus.id,
                    skuName: skus.name,
                    skuCode: skus.code,
                    safetyStock: skus.safetyStock,
                    currentStock: sql<number>`COALESCE(${stockSummary.onHand}, 0)`,
                    warehouseId: stockSummary.warehouseId,
                })
                .from(skus)
                .leftJoin(stockSummary, eq(skus.id, stockSummary.skuId))
                .where(
                    and(
                        sql`COALESCE(${stockSummary.onHand}, 0) < ${skus.safetyStock}`,
                        warehouseId ? eq(stockSummary.warehouseId, warehouseId) : undefined
                    )
                );

            const results = await query;

            return results.map(row => ({
                skuId: row.skuId,
                skuName: row.skuName,
                skuCode: row.skuCode,
                currentStock: row.currentStock,
                safetyStock: row.safetyStock,
                shortfall: row.safetyStock - row.currentStock,
                warehouseId: row.warehouseId ?? '',
            }));
        }, tx);
    }

    /**
     * Check if specific SKU is below safety stock
     */
    async isBelowSafetyStock(skuId: string, warehouseId: string, tx?: DbTx): Promise<boolean> {
        return this.inTx(async (tx) => {
            const result = await tx
                .select({
                    safetyStock: skus.safetyStock,
                    currentStock: sql<number>`COALESCE(${stockSummary.onHand}, 0)`,
                })
                .from(skus)
                .leftJoin(
                    stockSummary,
                    and(
                        eq(skus.id, stockSummary.skuId),
                        eq(stockSummary.warehouseId, warehouseId)
                    )
                )
                .where(eq(skus.id, skuId))
                .limit(1);

            if (!result[0]) return false;

            return result[0].currentStock < result[0].safetyStock;
        }, tx);
    }

    private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> {
        return tx ? fn(tx) : this.db.transaction(fn);
    }
}
```

#### Step 1.6: Add API Endpoint

**File:** `apps/wms/src/inventory/controllers/inventory.controller.ts`

```typescript
import { SafetyStockService, SafetyStockWarning } from '../services/safety-stock.service';

@Controller('wms/inventory')
export class InventoryController {
    constructor(
        private readonly inventoryService: InventoryService,
        private readonly safetyStockService: SafetyStockService, // 🔴 NEW
    ) {}

    @Get('safety-stock-warnings')
    @ApiOperation({ summary: '안전 재고 미만 상품 조회 (Get items below safety stock)' })
    @ApiQuery({ name: 'warehouseId', required: false })
    @ApiResponse({
        status: 200,
        description: 'List of SKUs below safety stock',
        schema: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    skuId: { type: 'string' },
                    skuName: { type: 'string' },
                    currentStock: { type: 'number' },
                    safetyStock: { type: 'number' },
                    shortfall: { type: 'number' }
                }
            }
        }
    })
    async getSafetyStockWarnings(
        @Query('warehouseId') warehouseId?: string
    ): Promise<SafetyStockWarning[]> {
        return this.safetyStockService.getBelowSafetyStock(warehouseId);
    }
}
```

#### Step 1.7: Register Service in Module

**File:** `apps/wms/src/inventory/inventory.module.ts`

```typescript
import { SafetyStockService } from './services/safety-stock.service';

@Module({
    controllers: [InventoryController],
    providers: [
        InventoryService,
        SafetyStockService, // 🔴 ADD THIS
    ],
    exports: [InventoryService, SafetyStockService],
})
export class InventoryModule {}
```

#### Step 1.8: Test Safety Stock Feature

**Create test file:** `apps/wms/src/inventory/services/safety-stock.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { SafetyStockService } from './safety-stock.service';

describe('SafetyStockService', () => {
    let service: SafetyStockService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SafetyStockService,
                {
                    provide: 'DB',
                    useValue: mockDb, // Mock implementation
                },
            ],
        }).compile();

        service = module.get<SafetyStockService>(SafetyStockService);
    });

    it('should identify SKUs below safety stock', async () => {
        // Test implementation
    });

    it('should return empty array when all SKUs above safety stock', async () => {
        // Test implementation
    });
});
```

**Manual testing with curl:**

```bash
# Test create SKU with safety stock
curl -X POST http://localhost:3000/wms/inventory/skus \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Product",
    "code": "TEST001",
    "stockType": "standard",
    "safetyStock": 10,
    "holderId": "uuid-here",
    "masterId": "uuid-here"
  }'

# Test safety stock warnings endpoint
curl http://localhost:3000/wms/inventory/safety-stock-warnings
```

#### ✅ Week 1 Checkpoint

- [ ] Safety stock field added to database
- [ ] DTOs updated with safety stock
- [ ] Service layer includes safety stock logic
- [ ] Safety stock validation service created
- [ ] API endpoint for warnings implemented
- [ ] Tests written and passing
- [ ] Manual testing completed

---

### Week 1, Day 3-5 + Week 2, Day 1-2: Inbound Lists Management

#### Objective
Implement the missing Inbound Lists management system with status workflow, barcode operations, and immediate receive functionality.

#### Step 2.1: Extend Status Enum

**File:** `apps/wms/database/schemas/wms-schema.ts`

**Find the `inboundStatusEnum` (around line 99):**

```typescript
// CURRENT (has only 2 statuses):
export const inboundStatusEnum = pgEnum('inbound_status', ['pending', 'confirmed']);

// 🔴 REPLACE WITH:
export const inboundStatusEnum = pgEnum('inbound_status', [
    'pending',      // 입고 대기 - Initial state
    'applied',      // 입고신청 - Applied for inbound
    'receiving',    // 입고 중 - Currently receiving
    'confirmed',    // 입고 완료 - Completed
]);
```

#### Step 2.2: Create Migration for Enum

**Create file:** `apps/wms/database/migrations/0001_extend_inbound_status.sql`

```sql
-- Extend inbound_status enum
ALTER TYPE inbound_status ADD VALUE IF NOT EXISTS 'applied';
ALTER TYPE inbound_status ADD VALUE IF NOT EXISTS 'receiving';

-- Add comment for documentation
COMMENT ON TYPE inbound_status IS 'Inbound status: pending, applied, receiving, confirmed';
```

**Run migration:**

```bash
npm run db:push.wms
```

#### Step 2.3: Create Inbound List DTOs

**Create file:** `apps/wms/src/inbound/dto/inbound-list/inbound-list-filters.dto.ts`

```typescript
import { IsOptional, IsUUID, IsString, IsEnum, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class InboundListFiltersDto {
    @ApiProperty({ description: 'Status filter', required: false, enum: ['pending', 'applied', 'receiving', 'confirmed'] })
    @IsEnum(['pending', 'applied', 'receiving', 'confirmed'])
    @IsOptional()
    status?: 'pending' | 'applied' | 'receiving' | 'confirmed';

    @ApiProperty({ description: 'Supplier ID filter', required: false })
    @IsUUID()
    @IsOptional()
    supplierId?: string;

    @ApiProperty({ description: 'Warehouse ID filter', required: false })
    @IsUUID()
    @IsOptional()
    warehouseId?: string;

    @ApiProperty({ description: 'Purchase Order ID filter', required: false })
    @IsUUID()
    @IsOptional()
    purchaseOrderId?: string;

    @ApiProperty({ description: 'Start date (YYYY-MM-DD)', required: false })
    @IsString()
    @IsOptional()
    startDate?: string;

    @ApiProperty({ description: 'End date (YYYY-MM-DD)', required: false })
    @IsString()
    @IsOptional()
    endDate?: string;

    @ApiProperty({ description: 'Barcode search (partial match)', required: false })
    @IsString()
    @IsOptional()
    barcodeSearch?: string;

    @ApiProperty({ description: 'SKU name/code search', required: false })
    @IsString()
    @IsOptional()
    skuSearch?: string;

    @ApiProperty({ description: 'Page limit', required: false, default: 50, minimum: 1, maximum: 100 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @IsOptional()
    limit?: number = 50;

    @ApiProperty({ description: 'Page offset', required: false, default: 0, minimum: 0 })
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @IsOptional()
    offset?: number = 0;
}
```

**Create file:** `apps/wms/src/inbound/dto/inbound-list/apply-inbound.dto.ts`

```typescript
import { IsOptional, IsString, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ApplyInboundDto {
    @ApiProperty({ description: 'Notes for the application', required: false })
    @IsString()
    @IsOptional()
    notes?: string;

    @ApiProperty({ description: 'Expected date override (YYYY-MM-DD)', required: false })
    @IsDateString()
    @IsOptional()
    expectedDate?: string;
}
```

**Create file:** `apps/wms/src/inbound/dto/inbound-list/immediate-receive.dto.ts`

```typescript
import { IsNotEmpty, IsUUID, IsOptional, IsInt, Min, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ImmediateReceiveDto {
    @ApiProperty({ description: 'Warehouse ID where items will be received' })
    @IsUUID()
    @IsNotEmpty()
    warehouseId: string;

    @ApiProperty({ description: 'Location ID (optional)', required: false })
    @IsUUID()
    @IsOptional()
    locationId?: string;

    @ApiProperty({ description: 'Actual quantity received (if different from expected)', required: false })
    @IsInt()
    @Min(1)
    @IsOptional()
    actualQuantity?: number;

    @ApiProperty({ description: 'Notes', required: false })
    @IsString()
    @IsOptional()
    notes?: string;
}
```

**Create file:** `apps/wms/src/inbound/dto/inbound-list/inbound-list-response.dto.ts`

```typescript
import { ApiProperty } from '@nestjs/swagger';

export class InboundListItemDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    poId: string;

    @ApiProperty()
    skuId: string;

    @ApiProperty()
    quantity: number;

    @ApiProperty({ required: false })
    barcode: string | null;

    @ApiProperty({ enum: ['pending', 'applied', 'receiving', 'confirmed'] })
    status: string;

    @ApiProperty()
    createdAt: Date;

    @ApiProperty()
    updatedAt: Date;

    @ApiProperty({ type: 'object' })
    purchaseOrder: {
        id: string;
        type: string;
        expectedArrival: string | null;
        supplier: {
            id: string;
            name: string;
        } | null;
    };

    @ApiProperty({ type: 'object' })
    sku: {
        id: string;
        name: string;
        code: string;
        defaultBarcode: string | null;
    };
}

export class InboundListResponseDto {
    @ApiProperty({ type: [InboundListItemDto] })
    items: InboundListItemDto[];

    @ApiProperty()
    total: number;

    @ApiProperty()
    limit: number;

    @ApiProperty()
    offset: number;
}
```

#### Step 2.4: Create Inbound List Service

**Create file:** `apps/wms/src/inbound/services/inbound-list.service.ts`

```typescript
import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { DbTx } from '../../database/schemas/wms-schema';
import {
    inboundLists,
    purchaseOrders,
    skus,
    suppliers
} from '../../database/schemas/wms-schema';
import { eq, and, gte, lte, like, or, sql } from 'drizzle-orm';
import { InboundListFiltersDto } from '../dto/inbound-list/inbound-list-filters.dto';
import { ApplyInboundDto } from '../dto/inbound-list/apply-inbound.dto';
import { ImmediateReceiveDto } from '../dto/inbound-list/immediate-receive.dto';
import { InboundListResponseDto, InboundListItemDto } from '../dto/inbound-list/inbound-list-response.dto';
import { InboundService } from './inbound.service';

@Injectable()
export class InboundListService {
    constructor(
        @Inject('DB') private db: DbTx,
        private readonly inboundService: InboundService,
    ) {}

    /**
     * List inbound list items with comprehensive filtering
     */
    async listInboundLists(filters: InboundListFiltersDto, tx?: DbTx): Promise<InboundListResponseDto> {
        return this.inTx(async (tx) => {
            // Build where conditions
            const conditions = [];

            if (filters.status) {
                conditions.push(eq(inboundLists.status, filters.status));
            }

            if (filters.purchaseOrderId) {
                conditions.push(eq(inboundLists.poId, filters.purchaseOrderId));
            }

            if (filters.barcodeSearch) {
                conditions.push(like(inboundLists.barcode, `%${filters.barcodeSearch}%`));
            }

            if (filters.startDate) {
                conditions.push(gte(inboundLists.createdAt, new Date(filters.startDate)));
            }

            if (filters.endDate) {
                conditions.push(lte(inboundLists.createdAt, new Date(filters.endDate)));
            }

            // Query with joins
            const query = tx
                .select({
                    id: inboundLists.id,
                    poId: inboundLists.poId,
                    skuId: inboundLists.skuId,
                    quantity: inboundLists.quantity,
                    barcode: inboundLists.barcode,
                    status: inboundLists.status,
                    createdAt: inboundLists.createdAt,
                    updatedAt: inboundLists.updatedAt,
                    po: {
                        id: purchaseOrders.id,
                        type: purchaseOrders.type,
                        expectedArrival: purchaseOrders.expectedArrival,
                        supplierId: purchaseOrders.supplierId,
                    },
                    sku: {
                        id: skus.id,
                        name: skus.name,
                        code: skus.code,
                        defaultBarcode: skus.defaultBarcode,
                    },
                    supplier: {
                        id: suppliers.id,
                        name: suppliers.name,
                    },
                })
                .from(inboundLists)
                .innerJoin(purchaseOrders, eq(inboundLists.poId, purchaseOrders.id))
                .innerJoin(skus, eq(inboundLists.skuId, skus.id))
                .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
                .where(conditions.length > 0 ? and(...conditions) : undefined)
                .limit(filters.limit ?? 50)
                .offset(filters.offset ?? 0);

            // Execute query
            const results = await query;

            // Count total
            const countQuery = await tx
                .select({ count: sql<number>`count(*)` })
                .from(inboundLists)
                .where(conditions.length > 0 ? and(...conditions) : undefined);

            const total = Number(countQuery[0]?.count ?? 0);

            // Map to DTOs
            const items: InboundListItemDto[] = results.map(row => ({
                id: row.id,
                poId: row.poId,
                skuId: row.skuId,
                quantity: row.quantity,
                barcode: row.barcode,
                status: row.status,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                purchaseOrder: {
                    id: row.po.id,
                    type: row.po.type,
                    expectedArrival: row.po.expectedArrival?.toISOString() ?? null,
                    supplier: row.supplier ? {
                        id: row.supplier.id,
                        name: row.supplier.name,
                    } : null,
                },
                sku: {
                    id: row.sku.id,
                    name: row.sku.name,
                    code: row.sku.code,
                    defaultBarcode: row.sku.defaultBarcode,
                },
            }));

            return {
                items,
                total,
                limit: filters.limit ?? 50,
                offset: filters.offset ?? 0,
            };
        }, tx);
    }

    /**
     * Get inbound list item detail by ID
     */
    async getInboundListDetail(id: string, tx?: DbTx): Promise<InboundListItemDto> {
        return this.inTx(async (tx) => {
            const result = await tx
                .select({
                    id: inboundLists.id,
                    poId: inboundLists.poId,
                    skuId: inboundLists.skuId,
                    quantity: inboundLists.quantity,
                    barcode: inboundLists.barcode,
                    status: inboundLists.status,
                    createdAt: inboundLists.createdAt,
                    updatedAt: inboundLists.updatedAt,
                    po: {
                        id: purchaseOrders.id,
                        type: purchaseOrders.type,
                        expectedArrival: purchaseOrders.expectedArrival,
                    },
                    sku: {
                        id: skus.id,
                        name: skus.name,
                        code: skus.code,
                        defaultBarcode: skus.defaultBarcode,
                    },
                    supplier: {
                        id: suppliers.id,
                        name: suppliers.name,
                    },
                })
                .from(inboundLists)
                .innerJoin(purchaseOrders, eq(inboundLists.poId, purchaseOrders.id))
                .innerJoin(skus, eq(inboundLists.skuId, skus.id))
                .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
                .where(eq(inboundLists.id, id))
                .limit(1);

            if (!result[0]) {
                throw new NotFoundException(`Inbound list item with ID ${id} not found`);
            }

            const row = result[0];

            return {
                id: row.id,
                poId: row.poId,
                skuId: row.skuId,
                quantity: row.quantity,
                barcode: row.barcode,
                status: row.status,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                purchaseOrder: {
                    id: row.po.id,
                    type: row.po.type,
                    expectedArrival: row.po.expectedArrival?.toISOString() ?? null,
                    supplier: row.supplier ? {
                        id: row.supplier.id,
                        name: row.supplier.name,
                    } : null,
                },
                sku: {
                    id: row.sku.id,
                    name: row.sku.name,
                    code: row.sku.code,
                    defaultBarcode: row.sku.defaultBarcode,
                },
            };
        }, tx);
    }

    /**
     * Apply for inbound (status: pending → applied)
     */
    async applyInbound(id: string, dto: ApplyInboundDto, tx?: DbTx): Promise<{
        id: string;
        status: string;
        appliedAt: Date;
        message: string
    }> {
        return this.inTx(async (tx) => {
            // Get current item
            const item = await tx
                .select()
                .from(inboundLists)
                .where(eq(inboundLists.id, id))
                .limit(1);

            if (!item[0]) {
                throw new NotFoundException(`Inbound list item with ID ${id} not found`);
            }

            // Validate status transition
            if (item[0].status !== 'pending') {
                throw new BadRequestException(
                    `Cannot apply inbound: current status is ${item[0].status}, expected 'pending'`
                );
            }

            // Update status to 'applied'
            await tx
                .update(inboundLists)
                .set({
                    status: 'applied',
                    updatedAt: new Date()
                })
                .where(eq(inboundLists.id, id));

            return {
                id,
                status: 'applied',
                appliedAt: new Date(),
                message: '입고신청이 완료되었습니다. (Inbound application completed)',
            };
        }, tx);
    }

    /**
     * Execute immediate receive (bypasses planning, directly creates receipt)
     */
    async immediateReceive(id: string, dto: ImmediateReceiveDto, tx?: DbTx): Promise<{
        id: string;
        receiptId: string;
        lineId: string;
        stockEventId: string;
        status: string;
        message: string;
    }> {
        return this.inTx(async (tx) => {
            // Get inbound list item
            const item = await tx
                .select()
                .from(inboundLists)
                .where(eq(inboundLists.id, id))
                .limit(1);

            if (!item[0]) {
                throw new NotFoundException(`Inbound list item with ID ${id} not found`);
            }

            // Validate status (can receive from pending, applied, or receiving)
            if (!['pending', 'applied', 'receiving'].includes(item[0].status)) {
                throw new BadRequestException(
                    `Cannot receive: current status is ${item[0].status}`
                );
            }

            // Create inbound receipt using existing service
            const receipt = await this.inboundService.simpleInbound({
                warehouseId: dto.warehouseId,
                locationId: dto.locationId,
                items: [{
                    skuId: item[0].skuId,
                    quantity: dto.actualQuantity ?? item[0].quantity,
                }],
            }, tx);

            // Update inbound list status to 'confirmed'
            await tx
                .update(inboundLists)
                .set({
                    status: 'confirmed',
                    updatedAt: new Date()
                })
                .where(eq(inboundLists.id, id));

            return {
                id,
                receiptId: receipt.id,
                lineId: receipt.lines[0]?.id ?? '',
                stockEventId: receipt.lines[0]?.eventId ?? '',
                status: 'confirmed',
                message: '입고가 완료되었습니다. (Inbound completed)',
            };
        }, tx);
    }

    /**
     * Generate barcode for inbound list item
     */
    async generateBarcode(id: string, tx?: DbTx): Promise<{
        barcodeValue: string;
        format: string;
        message: string;
    }> {
        return this.inTx(async (tx) => {
            // Get item with SKU details
            const result = await tx
                .select({
                    inboundList: inboundLists,
                    sku: skus,
                })
                .from(inboundLists)
                .innerJoin(skus, eq(inboundLists.skuId, skus.id))
                .where(eq(inboundLists.id, id))
                .limit(1);

            if (!result[0]) {
                throw new NotFoundException(`Inbound list item with ID ${id} not found`);
            }

            const { inboundList, sku } = result[0];

            // Use existing barcode or SKU default barcode
            const barcodeValue = inboundList.barcode ?? sku.defaultBarcode ?? `IL-${id.substring(0, 8)}`;

            // If no barcode exists, update inbound list with generated barcode
            if (!inboundList.barcode) {
                await tx
                    .update(inboundLists)
                    .set({
                        barcode: barcodeValue,
                        updatedAt: new Date()
                    })
                    .where(eq(inboundLists.id, id));
            }

            return {
                barcodeValue,
                format: 'CODE128',
                message: '바코드가 생성되었습니다. (Barcode generated)',
            };
        }, tx);
    }

    private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> {
        return tx ? fn(tx) : this.db.transaction(fn);
    }
}
```

#### Step 2.5: Create Inbound List Controller

**Create file:** `apps/wms/src/inbound/controllers/inbound-list.controller.ts`

```typescript
import {
    Controller,
    Get,
    Post,
    Param,
    Query,
    Body,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';
import { InboundListService } from '../services/inbound-list.service';
import { InboundListFiltersDto } from '../dto/inbound-list/inbound-list-filters.dto';
import { ApplyInboundDto } from '../dto/inbound-list/apply-inbound.dto';
import { ImmediateReceiveDto } from '../dto/inbound-list/immediate-receive.dto';
import { InboundListResponseDto, InboundListItemDto } from '../dto/inbound-list/inbound-list-response.dto';

@ApiTags('Inbound Lists')
@Controller('wms/inbound/lists')
export class InboundListController {
    constructor(private readonly inboundListService: InboundListService) {}

    @Get()
    @ApiOperation({ summary: '입고 리스트 조회 (List inbound items with filters)' })
    @ApiResponse({
        status: 200,
        description: 'Inbound list retrieved successfully',
        type: InboundListResponseDto,
    })
    async listInboundLists(
        @Query() filters: InboundListFiltersDto
    ): Promise<InboundListResponseDto> {
        return this.inboundListService.listInboundLists(filters);
    }

    @Get(':id')
    @ApiOperation({ summary: '입고 리스트 상세 조회 (Get inbound list item detail)' })
    @ApiParam({ name: 'id', description: 'Inbound list item ID' })
    @ApiResponse({
        status: 200,
        description: 'Inbound list item detail',
        type: InboundListItemDto,
    })
    @ApiResponse({ status: 404, description: 'Inbound list item not found' })
    async getInboundListDetail(
        @Param('id') id: string
    ): Promise<InboundListItemDto> {
        return this.inboundListService.getInboundListDetail(id);
    }

    @Post(':id/apply')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: '입고 신청 (Apply for inbound - status: pending → applied)' })
    @ApiParam({ name: 'id', description: 'Inbound list item ID' })
    @ApiResponse({
        status: 200,
        description: 'Inbound application successful',
        schema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                status: { type: 'string', example: 'applied' },
                appliedAt: { type: 'string', format: 'date-time' },
                message: { type: 'string', example: '입고신청이 완료되었습니다.' }
            }
        }
    })
    @ApiResponse({ status: 400, description: 'Invalid status transition' })
    @ApiResponse({ status: 404, description: 'Inbound list item not found' })
    async applyInbound(
        @Param('id') id: string,
        @Body() dto: ApplyInboundDto
    ): Promise<any> {
        return this.inboundListService.applyInbound(id, dto);
    }

    @Post(':id/receive')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: '즉시 입고 (Immediate receive - creates receipt and updates stock)' })
    @ApiParam({ name: 'id', description: 'Inbound list item ID' })
    @ApiResponse({
        status: 200,
        description: 'Immediate receive successful',
        schema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                receiptId: { type: 'string' },
                lineId: { type: 'string' },
                stockEventId: { type: 'string' },
                status: { type: 'string', example: 'confirmed' },
                message: { type: 'string', example: '입고가 완료되었습니다.' }
            }
        }
    })
    @ApiResponse({ status: 400, description: 'Invalid status or missing data' })
    @ApiResponse({ status: 404, description: 'Inbound list item not found' })
    async immediateReceive(
        @Param('id') id: string,
        @Body() dto: ImmediateReceiveDto
    ): Promise<any> {
        return this.inboundListService.immediateReceive(id, dto);
    }

    @Get(':id/barcode')
    @ApiOperation({ summary: '바코드 생성 (Generate barcode for inbound item)' })
    @ApiParam({ name: 'id', description: 'Inbound list item ID' })
    @ApiResponse({
        status: 200,
        description: 'Barcode generated successfully',
        schema: {
            type: 'object',
            properties: {
                barcodeValue: { type: 'string', example: '1234567890123' },
                format: { type: 'string', example: 'CODE128' },
                message: { type: 'string', example: '바코드가 생성되었습니다.' }
            }
        }
    })
    @ApiResponse({ status: 404, description: 'Inbound list item not found' })
    async generateBarcode(
        @Param('id') id: string
    ): Promise<any> {
        return this.inboundListService.generateBarcode(id);
    }
}
```

#### Step 2.6: Register in Module

**File:** `apps/wms/src/inbound/inbound.module.ts`

```typescript
import { InboundListController } from './controllers/inbound-list.controller';
import { InboundListService } from './services/inbound-list.service';

@Module({
    controllers: [
        InboundController,
        PurchaseOrderController,
        InboundListController, // 🔴 ADD THIS
    ],
    providers: [
        InboundService,
        PurchaseOrderService,
        InboundListService, // 🔴 ADD THIS
    ],
    exports: [
        InboundService,
        PurchaseOrderService,
        InboundListService, // 🔴 ADD THIS
    ],
})
export class InboundModule {}
```

#### Step 2.7: Test Inbound Lists

**Manual testing:**

```bash
# 1. List all inbound items
curl http://localhost:3000/wms/inbound/lists

# 2. Filter by status
curl "http://localhost:3000/wms/inbound/lists?status=pending&limit=10"

# 3. Get detail
curl http://localhost:3000/wms/inbound/lists/{id}

# 4. Apply inbound
curl -X POST http://localhost:3000/wms/inbound/lists/{id}/apply \
  -H "Content-Type: application/json" \
  -d '{"notes": "Ready for receiving"}'

# 5. Immediate receive
curl -X POST http://localhost:3000/wms/inbound/lists/{id}/receive \
  -H "Content-Type: application/json" \
  -d '{
    "warehouseId": "warehouse-uuid",
    "locationId": "location-uuid",
    "actualQuantity": 100
  }'

# 6. Generate barcode
curl http://localhost:3000/wms/inbound/lists/{id}/barcode
```

#### ✅ Week 2 Checkpoint

- [ ] Inbound status enum extended (pending, applied, receiving, confirmed)
- [ ] Inbound list DTOs created
- [ ] Inbound list service implemented with all methods
- [ ] Inbound list controller created with 5 endpoints
- [ ] Service registered in module
- [ ] Manual testing completed successfully
- [ ] Status transitions validated (pending → applied → confirmed)

---

### Week 2, Day 3-5 + Week 3: Stocktaking Module

#### Objective
Build the complete stocktaking module from scratch, including session management, barcode scanning, variance detection, and automatic adjustment generation.

#### Step 3.1: Create Stocktaking Tables

**File:** `apps/wms/database/schemas/wms-schema.ts`

**Add these enum and table definitions:**

```typescript
// 🔴 ADD: Stocktaking status enum
export const stocktakingStatusEnum = pgEnum('stocktaking_status', [
    'draft',        // 작성 중 - Being created
    'in_progress',  // 진행 중 - Actively counting
    'completed',    // 완료 - Counting finished
    'cancelled',    // 취소 - Cancelled
]);

// 🔴 ADD: Stocktaking sessions table
export const stocktakingSessions = pgTable('stocktaking_sessions', {
    id: uuid('id').primaryKey().defaultRandom(),
    warehouseId: uuid('warehouse_id')
        .references(() => warehouses.id, { onDelete: 'restrict' })
        .notNull(),
    sessionName: varchar('session_name', { length: 255 }).notNull(),
    status: stocktakingStatusEnum('status').notNull().default('draft'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    startedBy: uuid('started_by'), // FK to users (if available)
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 🔴 ADD: Stocktaking lines table (individual count records)
export const stocktakingLines = pgTable('stocktaking_lines', {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
        .references(() => stocktakingSessions.id, { onDelete: 'cascade' })
        .notNull(),
    skuId: uuid('sku_id')
        .references(() => skus.id, { onDelete: 'restrict' })
        .notNull(),
    locationId: uuid('location_id')
        .references(() => locations.id, { onDelete: 'restrict' }),
    expectedQuantity: integer('expected_quantity').notNull(),
    countedQuantity: integer('counted_quantity'),
    variance: integer('variance'), // Calculated: countedQuantity - expectedQuantity
    scannedBarcode: varchar('scanned_barcode', { length: 64 }),
    status: varchar('status', { length: 20 }).notNull().default('pending'), // pending, counted, verified
    countedAt: timestamp('counted_at', { withTimezone: true }),
    countedBy: uuid('counted_by'), // FK to users
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
    idxStocktakingLineSession: index('idx_stocktaking_line_session').on(t.sessionId),
    idxStocktakingLineSku: index('idx_stocktaking_line_sku').on(t.skuId),
    idxStocktakingLineLocation: index('idx_stocktaking_line_location').on(t.locationId),
}));

// 🔴 ADD: Stocktaking adjustments table (generated from variances)
export const stocktakingAdjustments = pgTable('stocktaking_adjustments', {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
        .references(() => stocktakingSessions.id, { onDelete: 'restrict' })
        .notNull(),
    lineId: uuid('line_id')
        .references(() => stocktakingLines.id, { onDelete: 'restrict' })
        .notNull(),
    stockEventId: uuid('stock_event_id')
        .references(() => stockEvents.id, { onDelete: 'restrict' }),
    adjustmentQuantity: integer('adjustment_quantity').notNull(),
    adjustmentType: varchar('adjustment_type', { length: 20 }).notNull(), // 'INCREASE' or 'DECREASE'
    reason: varchar('reason', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    appliedBy: uuid('applied_by'),
}, t => ({
    idxAdjustmentSession: index('idx_adjustment_session').on(t.sessionId),
    idxAdjustmentLine: index('idx_adjustment_line').on(t.lineId),
}));

// 🔴 ADD: Relations
export const stocktakingSessionsRelations = relations(stocktakingSessions, ({ one, many }) => ({
    warehouse: one(warehouses, {
        fields: [stocktakingSessions.warehouseId],
        references: [warehouses.id],
    }),
    lines: many(stocktakingLines),
    adjustments: many(stocktakingAdjustments),
}));

export const stocktakingLinesRelations = relations(stocktakingLines, ({ one }) => ({
    session: one(stocktakingSessions, {
        fields: [stocktakingLines.sessionId],
        references: [stocktakingSessions.id],
    }),
    sku: one(skus, {
        fields: [stocktakingLines.skuId],
        references: [skus.id],
    }),
    location: one(locations, {
        fields: [stocktakingLines.locationId],
        references: [locations.id],
    }),
}));

export const stocktakingAdjustmentsRelations = relations(stocktakingAdjustments, ({ one }) => ({
    session: one(stocktakingSessions, {
        fields: [stocktakingAdjustments.sessionId],
        references: [stocktakingSessions.id],
    }),
    line: one(stocktakingLines, {
        fields: [stocktakingAdjustments.lineId],
        references: [stocktakingLines.id],
    }),
    stockEvent: one(stockEvents, {
        fields: [stocktakingAdjustments.stockEventId],
        references: [stockEvents.id],
    }),
}));
```

#### Step 3.2: Generate and Run Migration

```bash
# Generate migration for new tables
npm run db:generate.wms

# Review the migration file (should create 3 tables + enum)
# File: apps/wms/database/migrations/XXXX_create_stocktaking_tables.sql

# Apply migration
npm run db:push.wms

# Verify tables were created
psql -d almondyoung_wms -c "\dt stocktaking*"
```

#### Step 3.3: Create Stocktaking DTOs

**Create directory:**
```bash
mkdir -p apps/wms/src/stocktaking/dto
```

**Create file:** `apps/wms/src/stocktaking/dto/create-session.dto.ts`

```typescript
import { IsNotEmpty, IsUUID, IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateStocktakingSessionDto {
    @ApiProperty({ description: 'Warehouse ID where stocktaking will be performed' })
    @IsUUID()
    @IsNotEmpty()
    warehouseId: string;

    @ApiProperty({ description: 'Session name', example: '2025-10 Cycle Count - Warehouse A' })
    @IsString()
    @IsNotEmpty()
    sessionName: string;

    @ApiProperty({ description: 'Notes', required: false })
    @IsString()
    @IsOptional()
    notes?: string;
}
```

**Create file:** `apps/wms/src/stocktaking/dto/scan-location.dto.ts`

```typescript
import { IsNotEmpty, IsUUID, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ScanLocationDto {
    @ApiProperty({ description: 'Session ID' })
    @IsUUID()
    @IsNotEmpty()
    sessionId: string;

    @ApiProperty({ description: 'Location barcode or code', example: 'A-01-02' })
    @IsString()
    @IsNotEmpty()
    locationBarcode: string;
}
```

**Create file:** `apps/wms/src/stocktaking/dto/scan-product.dto.ts`

```typescript
import { IsNotEmpty, IsUUID, IsString, IsInt, Min, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ScanProductDto {
    @ApiProperty({ description: 'Session ID' })
    @IsUUID()
    @IsNotEmpty()
    sessionId: string;

    @ApiProperty({ description: 'Location ID' })
    @IsUUID()
    @IsNotEmpty()
    locationId: string;

    @ApiProperty({ description: 'Product barcode' })
    @IsString()
    @IsNotEmpty()
    productBarcode: string;

    @ApiProperty({ description: 'Quantity scanned (default: 1)', required: false, minimum: 1 })
    @IsInt()
    @Min(1)
    @IsOptional()
    quantity?: number = 1;
}
```

**Create file:** `apps/wms/src/stocktaking/dto/update-count.dto.ts`

```typescript
import { IsInt, Min, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCountDto {
    @ApiProperty({ description: 'Counted quantity', minimum: 0 })
    @IsInt()
    @Min(0)
    countedQuantity: number;

    @ApiProperty({ description: 'Notes', required: false })
    @IsString()
    @IsOptional()
    notes?: string;
}
```

**Create file:** `apps/wms/src/stocktaking/dto/generate-adjustments.dto.ts`

```typescript
import { IsOptional, IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateAdjustmentsDto {
    @ApiProperty({
        description: 'Filter to specific line IDs (optional - generates for all variances if not provided)',
        required: false,
        type: [String]
    })
    @IsArray()
    @IsUUID('4', { each: true })
    @IsOptional()
    lineIds?: string[];
}
```

#### Step 3.4: Create Stocktaking Service

**Create directory:**
```bash
mkdir -p apps/wms/src/stocktaking/services
```

**Create file:** `apps/wms/src/stocktaking/services/stocktaking.service.ts`

```typescript
import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { DbTx } from '../../database/schemas/wms-schema';
import {
    stocktakingSessions,
    stocktakingLines,
    stocktakingAdjustments,
    skus,
    locations,
    stockSummary,
    stockEvents,
} from '../../database/schemas/wms-schema';
import { eq, and, sql } from 'drizzle-orm';
import { CreateStocktakingSessionDto } from '../dto/create-session.dto';
import { ScanLocationDto } from '../dto/scan-location.dto';
import { ScanProductDto } from '../dto/scan-product.dto';
import { UpdateCountDto } from '../dto/update-count.dto';
import { GenerateAdjustmentsDto } from '../dto/generate-adjustments.dto';

@Injectable()
export class StocktakingService {
    constructor(@Inject('DB') private db: DbTx) {}

    /**
     * Create new stocktaking session
     */
    async createSession(dto: CreateStocktakingSessionDto, tx?: DbTx) {
        return this.inTx(async (tx) => {
            const result = await tx
                .insert(stocktakingSessions)
                .values({
                    warehouseId: dto.warehouseId,
                    sessionName: dto.sessionName,
                    notes: dto.notes,
                    status: 'draft',
                })
                .returning();

            return result[0];
        }, tx);
    }

    /**
     * Start stocktaking session
     */
    async startSession(sessionId: string, tx?: DbTx) {
        return this.inTx(async (tx) => {
            const session = await tx
                .select()
                .from(stocktakingSessions)
                .where(eq(stocktakingSessions.id, sessionId))
                .limit(1);

            if (!session[0]) {
                throw new NotFoundException(`Session ${sessionId} not found`);
            }

            if (session[0].status !== 'draft') {
                throw new BadRequestException(`Session already started`);
            }

            await tx
                .update(stocktakingSessions)
                .set({
                    status: 'in_progress',
                    startedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(stocktakingSessions.id, sessionId));

            return { sessionId, status: 'in_progress', message: '재고 실사를 시작했습니다.' };
        }, tx);
    }

    /**
     * Scan location barcode and load expected inventory
     */
    async scanLocation(dto: ScanLocationDto, tx?: DbTx) {
        return this.inTx(async (tx) => {
            // Find location by barcode/code
            const location = await tx
                .select()
                .from(locations)
                .where(eq(locations.code, dto.locationBarcode))
                .limit(1);

            if (!location[0]) {
                throw new NotFoundException(`Location ${dto.locationBarcode} not found`);
            }

            // Get current stock at this location
            const stockAtLocation = await tx
                .select({
                    skuId: stockSummary.skuId,
                    expectedQty: stockSummary.onHand,
                    skuName: skus.name,
                    skuCode: skus.code,
                    defaultBarcode: skus.defaultBarcode,
                })
                .from(stockSummary)
                .innerJoin(skus, eq(stockSummary.skuId, skus.id))
                .where(
                    and(
                        eq(stockSummary.locationId, location[0].id),
                        sql`${stockSummary.onHand} > 0`
                    )
                );

            // Create stocktaking lines for each SKU at location
            const linesToCreate = stockAtLocation.map(item => ({
                sessionId: dto.sessionId,
                skuId: item.skuId,
                locationId: location[0].id,
                expectedQuantity: item.expectedQty,
                status: 'pending',
            }));

            if (linesToCreate.length > 0) {
                await tx.insert(stocktakingLines).values(linesToCreate);
            }

            return {
                locationId: location[0].id,
                locationCode: location[0].code,
                expectedItems: stockAtLocation.map(item => ({
                    skuId: item.skuId,
                    skuName: item.skuName,
                    skuCode: item.skuCode,
                    barcode: item.defaultBarcode,
                    expectedQuantity: item.expectedQty,
                })),
            };
        }, tx);
    }

    /**
     * Scan product barcode during counting
     */
    async scanProduct(dto: ScanProductDto, tx?: DbTx) {
        return this.inTx(async (tx) => {
            // Find SKU by barcode
            const sku = await tx
                .select()
                .from(skus)
                .where(eq(skus.defaultBarcode, dto.productBarcode))
                .limit(1);

            if (!sku[0]) {
                throw new NotFoundException(`SKU with barcode ${dto.productBarcode} not found`);
            }

            // Find or create stocktaking line
            const existingLine = await tx
                .select()
                .from(stocktakingLines)
                .where(
                    and(
                        eq(stocktakingLines.sessionId, dto.sessionId),
                        eq(stocktakingLines.skuId, sku[0].id),
                        eq(stocktakingLines.locationId, dto.locationId)
                    )
                )
                .limit(1);

            if (existingLine[0]) {
                // Update existing line
                const newCount = (existingLine[0].countedQuantity ?? 0) + (dto.quantity ?? 1);
                const variance = newCount - existingLine[0].expectedQuantity;

                await tx
                    .update(stocktakingLines)
                    .set({
                        countedQuantity: newCount,
                        variance,
                        scannedBarcode: dto.productBarcode,
                        countedAt: new Date(),
                        status: 'counted',
                        updatedAt: new Date(),
                    })
                    .where(eq(stocktakingLines.id, existingLine[0].id));

                return {
                    lineId: existingLine[0].id,
                    skuId: sku[0].id,
                    countedQuantity: newCount,
                    expectedQuantity: existingLine[0].expectedQuantity,
                    variance,
                };
            } else {
                // Create new line (unexpected item)
                const result = await tx
                    .insert(stocktakingLines)
                    .values({
                        sessionId: dto.sessionId,
                        skuId: sku[0].id,
                        locationId: dto.locationId,
                        expectedQuantity: 0,
                        countedQuantity: dto.quantity ?? 1,
                        variance: dto.quantity ?? 1,
                        scannedBarcode: dto.productBarcode,
                        countedAt: new Date(),
                        status: 'counted',
                    })
                    .returning();

                return {
                    lineId: result[0].id,
                    skuId: sku[0].id,
                    countedQuantity: dto.quantity ?? 1,
                    expectedQuantity: 0,
                    variance: dto.quantity ?? 1,
                };
            }
        }, tx);
    }

    /**
     * Update count manually
     */
    async updateCount(lineId: string, dto: UpdateCountDto, tx?: DbTx) {
        return this.inTx(async (tx) => {
            const line = await tx
                .select()
                .from(stocktakingLines)
                .where(eq(stocktakingLines.id, lineId))
                .limit(1);

            if (!line[0]) {
                throw new NotFoundException(`Line ${lineId} not found`);
            }

            const variance = dto.countedQuantity - line[0].expectedQuantity;

            await tx
                .update(stocktakingLines)
                .set({
                    countedQuantity: dto.countedQuantity,
                    variance,
                    notes: dto.notes,
                    countedAt: new Date(),
                    status: 'counted',
                    updatedAt: new Date(),
                })
                .where(eq(stocktakingLines.id, lineId));

            return {
                lineId,
                countedQuantity: dto.countedQuantity,
                expectedQuantity: line[0].expectedQuantity,
                variance,
            };
        }, tx);
    }

    /**
     * Get variances (discrepancies)
     */
    async getVariances(sessionId: string, tx?: DbTx) {
        return this.inTx(async (tx) => {
            const lines = await tx
                .select({
                    lineId: stocktakingLines.id,
                    locationCode: locations.code,
                    skuName: skus.name,
                    skuCode: skus.code,
                    expectedQuantity: stocktakingLines.expectedQuantity,
                    countedQuantity: stocktakingLines.countedQuantity,
                    variance: stocktakingLines.variance,
                })
                .from(stocktakingLines)
                .innerJoin(skus, eq(stocktakingLines.skuId, skus.id))
                .leftJoin(locations, eq(stocktakingLines.locationId, locations.id))
                .where(
                    and(
                        eq(stocktakingLines.sessionId, sessionId),
                        sql`${stocktakingLines.variance} IS NOT NULL AND ${stocktakingLines.variance} != 0`
                    )
                );

            return lines.map(line => ({
                ...line,
                discrepancyPercent: line.expectedQuantity > 0
                    ? ((line.variance ?? 0) / line.expectedQuantity) * 100
                    : 0,
            }));
        }, tx);
    }

    /**
     * Generate stock adjustments for variances
     */
    async generateAdjustments(sessionId: string, dto: GenerateAdjustmentsDto, tx?: DbTx) {
        return this.inTx(async (tx) => {
            // Build filter for lines
            let linesQuery = tx
                .select()
                .from(stocktakingLines)
                .where(
                    and(
                        eq(stocktakingLines.sessionId, sessionId),
                        sql`${stocktakingLines.variance} IS NOT NULL AND ${stocktakingLines.variance} != 0`,
                        sql`${stocktakingLines.countedQuantity} IS NOT NULL`
                    )
                );

            if (dto.lineIds && dto.lineIds.length > 0) {
                linesQuery = linesQuery.where(
                    sql`${stocktakingLines.id} IN (${sql.join(dto.lineIds.map(id => sql`${id}`), sql`, `)})`
                );
            }

            const linesToAdjust = await linesQuery;

            let adjustmentsCreated = 0;
            let eventsPosted = 0;

            for (const line of linesToAdjust) {
                // Create stock event for adjustment
                const eventResult = await tx
                    .insert(stockEvents)
                    .values({
                        skuId: line.skuId,
                        warehouseId: (await tx.select().from(stocktakingSessions).where(eq(stocktakingSessions.id, sessionId)).limit(1))[0].warehouseId,
                        locationId: line.locationId,
                        transitionType: line.variance! > 0 ? 'ADJUST_UP' : 'ADJUST_DOWN',
                        quantity: Math.abs(line.variance!),
                        fromState: null,
                        toState: 'ON_HAND',
                        reason: `Stocktaking adjustment - Session ${sessionId}`,
                    })
                    .returning();

                // Create adjustment record
                await tx
                    .insert(stocktakingAdjustments)
                    .values({
                        sessionId,
                        lineId: line.id,
                        stockEventId: eventResult[0].id,
                        adjustmentQuantity: Math.abs(line.variance!),
                        adjustmentType: line.variance! > 0 ? 'INCREASE' : 'DECREASE',
                        reason: `Variance detected: ${line.variance}`,
                    });

                adjustmentsCreated++;
                eventsPosted++;
            }

            return {
                adjustmentsCreated,
                eventsPosted,
                message: `${adjustmentsCreated}개의 조정이 생성되었습니다.`,
            };
        }, tx);
    }

    /**
     * Complete stocktaking session
     */
    async completeSession(sessionId: string, tx?: DbTx) {
        return this.inTx(async (tx) => {
            const session = await tx
                .select()
                .from(stocktakingSessions)
                .where(eq(stocktakingSessions.id, sessionId))
                .limit(1);

            if (!session[0]) {
                throw new NotFoundException(`Session ${sessionId} not found`);
            }

            if (session[0].status !== 'in_progress') {
                throw new BadRequestException(`Session is not in progress`);
            }

            // Get summary statistics
            const lineStats = await tx
                .select({
                    total: sql<number>`count(*)`,
                    withVariances: sql<number>`count(*) FILTER (WHERE ${stocktakingLines.variance} != 0)`,
                })
                .from(stocktakingLines)
                .where(eq(stocktakingLines.sessionId, sessionId));

            const adjustmentStats = await tx
                .select({
                    count: sql<number>`count(*)`,
                })
                .from(stocktakingAdjustments)
                .where(eq(stocktakingAdjustments.sessionId, sessionId));

            // Update session status
            await tx
                .update(stocktakingSessions)
                .set({
                    status: 'completed',
                    completedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(stocktakingSessions.id, sessionId));

            return {
                sessionId,
                status: 'completed',
                completedAt: new Date(),
                summary: {
                    totalLines: Number(lineStats[0]?.total ?? 0),
                    discrepanciesFound: Number(lineStats[0]?.withVariances ?? 0),
                    adjustmentsApplied: Number(adjustmentStats[0]?.count ?? 0),
                },
            };
        }, tx);
    }

    private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> {
        return tx ? fn(tx) : this.db.transaction(fn);
    }
}
```

#### Step 3.5: Create Stocktaking Controller

**Create file:** `apps/wms/src/stocktaking/controllers/stocktaking.controller.ts`

```typescript
import {
    Controller,
    Get,
    Post,
    Put,
    Param,
    Body,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { StocktakingService } from '../services/stocktaking.service';
import { CreateStocktakingSessionDto } from '../dto/create-session.dto';
import { ScanLocationDto } from '../dto/scan-location.dto';
import { ScanProductDto } from '../dto/scan-product.dto';
import { UpdateCountDto } from '../dto/update-count.dto';
import { GenerateAdjustmentsDto } from '../dto/generate-adjustments.dto';

@ApiTags('Stocktaking')
@Controller('wms/stocktaking')
export class StocktakingController {
    constructor(private readonly stocktakingService: StocktakingService) {}

    @Post('sessions')
    @ApiOperation({ summary: '재고 실사 세션 생성 (Create stocktaking session)' })
    @ApiResponse({ status: 201, description: 'Session created successfully' })
    async createSession(@Body() dto: CreateStocktakingSessionDto) {
        return this.stocktakingService.createSession(dto);
    }

    @Post('sessions/:id/start')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: '재고 실사 시작 (Start stocktaking session)' })
    @ApiParam({ name: 'id', description: 'Session ID' })
    @ApiResponse({ status: 200, description: 'Session started' })
    async startSession(@Param('id') id: string) {
        return this.stocktakingService.startSession(id);
    }

    @Post('scan-location')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: '위치 바코드 스캔 (Scan location barcode)' })
    @ApiResponse({ status: 200, description: 'Location scanned, expected items loaded' })
    async scanLocation(@Body() dto: ScanLocationDto) {
        return this.stocktakingService.scanLocation(dto);
    }

    @Post('scan-product')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: '상품 바코드 스캔 (Scan product barcode)' })
    @ApiResponse({ status: 200, description: 'Product scanned, count updated' })
    async scanProduct(@Body() dto: ScanProductDto) {
        return this.stocktakingService.scanProduct(dto);
    }

    @Put('lines/:id/count')
    @ApiOperation({ summary: '수량 수동 입력 (Update count manually)' })
    @ApiParam({ name: 'id', description: 'Line ID' })
    @ApiResponse({ status: 200, description: 'Count updated' })
    async updateCount(
        @Param('id') id: string,
        @Body() dto: UpdateCountDto
    ) {
        return this.stocktakingService.updateCount(id, dto);
    }

    @Get('sessions/:id/variances')
    @ApiOperation({ summary: '차이 조회 (Get variances/discrepancies)' })
    @ApiParam({ name: 'id', description: 'Session ID' })
    @ApiResponse({ status: 200, description: 'List of variances' })
    async getVariances(@Param('id') id: string) {
        return this.stocktakingService.getVariances(id);
    }

    @Post('sessions/:id/generate-adjustments')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: '조정 자동 생성 (Generate stock adjustments)' })
    @ApiParam({ name: 'id', description: 'Session ID' })
    @ApiResponse({ status: 200, description: 'Adjustments generated' })
    async generateAdjustments(
        @Param('id') id: string,
        @Body() dto: GenerateAdjustmentsDto
    ) {
        return this.stocktakingService.generateAdjustments(id, dto);
    }

    @Post('sessions/:id/complete')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: '재고 실사 완료 (Complete stocktaking session)' })
    @ApiParam({ name: 'id', description: 'Session ID' })
    @ApiResponse({ status: 200, description: 'Session completed with summary' })
    async completeSession(@Param('id') id: string) {
        return this.stocktakingService.completeSession(id);
    }
}
```

#### Step 3.6: Create Stocktaking Module

**Create file:** `apps/wms/src/stocktaking/stocktaking.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { StocktakingController } from './controllers/stocktaking.controller';
import { StocktakingService } from './services/stocktaking.service';

@Module({
    controllers: [StocktakingController],
    providers: [StocktakingService],
    exports: [StocktakingService],
})
export class StocktakingModule {}
```

**Register in main WMS module:**

**File:** `apps/wms/src/wms.module.ts` (or wherever your main module is)

```typescript
import { StocktakingModule } from './stocktaking/stocktaking.module';

@Module({
    imports: [
        // ... existing modules
        StocktakingModule, // 🔴 ADD THIS
    ],
})
export class WmsModule {}
```

#### Step 3.7: Test Stocktaking Module

**Complete workflow testing:**

```bash
# 1. Create session
SESSION_ID=$(curl -X POST http://localhost:3000/wms/stocktaking/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "warehouseId": "warehouse-uuid",
    "sessionName": "2025-10 Monthly Count",
    "notes": "Full warehouse count"
  }' | jq -r '.id')

# 2. Start session
curl -X POST http://localhost:3000/wms/stocktaking/sessions/$SESSION_ID/start

# 3. Scan location
curl -X POST http://localhost:3000/wms/stocktaking/scan-location \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "'$SESSION_ID'",
    "locationBarcode": "A-01-02"
  }'

# 4. Scan product
curl -X POST http://localhost:3000/wms/stocktaking/scan-product \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "'$SESSION_ID'",
    "locationId": "location-uuid",
    "productBarcode": "1234567890",
    "quantity": 5
  }'

# 5. Get variances
curl http://localhost:3000/wms/stocktaking/sessions/$SESSION_ID/variances

# 6. Generate adjustments
curl -X POST http://localhost:3000/wms/stocktaking/sessions/$SESSION_ID/generate-adjustments \
  -H "Content-Type: application/json" \
  -d '{}'

# 7. Complete session
curl -X POST http://localhost:3000/wms/stocktaking/sessions/$SESSION_ID/complete
```

#### ✅ Phase 1 Complete Checkpoint

- [ ] Safety stock field implemented and tested
- [ ] Inbound lists management fully operational
- [ ] Stocktaking module complete with all features:
  - [ ] Session management (create, start, complete)
  - [ ] Location barcode scanning
  - [ ] Product barcode scanning
  - [ ] Variance detection
  - [ ] Automatic adjustment generation
  - [ ] Stock event integration
- [ ] All Phase 1 endpoints tested and working
- [ ] Database migrations completed successfully
- [ ] Frontend team unblocked

---

## Phase 2: High Priority (Weeks 4-6)

**Estimated Effort:** 18-22 developer days
**Priority:** 🟡 HIGH - Enhances core functionality

### Overview

Phase 2 focuses on enhancing the SKU system with extended metadata, multi-tier pricing, location management, and a comprehensive barcode printing system.

### Week 4: Extended SKU Metadata

#### Objective
Add 30+ missing fields to the SKU schema to match Figma design requirements.

#### Step 4.1: Extended SKU Schema Fields

**File:** `apps/wms/database/schemas/wms-schema.ts`

**Add these fields to the `skus` table:**

```typescript
export const skus = pgTable('skus', {
    // ... existing fields ...

    // 🔴 ADD: Basic Information Enhancements
    businessProductName: varchar('business_product_name', { length: 255 }),
    importDeclarationNumber: varchar('import_declaration_number', { length: 100 }),
    logisticsPartnerId: uuid('logistics_partner_id').references(() => suppliers.id),
    discount: varchar('discount', { length: 100 }),
    manufacturerStar: varchar('manufacturer_star', { length: 100 }),

    // 🔴 ADD: Physical Properties
    productWeight: integer('product_weight'), // in grams
    dimensionWidth: integer('dimension_width'), // in cm
    dimensionHeight: integer('dimension_height'),
    dimensionDepth: integer('dimension_depth'),
    productMaterial: text('product_material'),

    // 🔴 ADD: Additional Metadata
    koreanName: varchar('korean_name', { length: 255 }),
    maxDiscountQuantity: integer('max_discount_quantity'),
    packagingImporterName: varchar('packaging_importer_name', { length: 255 }),

    // 🔴 ADD: Sales Information
    productDescription: text('product_description'),
    moq: integer('moq'), // Minimum Order Quantity
    memo2: text('memo2'),
    memo3: text('memo3'),

    // 🔴 ADD: Image Management
    mainImageUrl: varchar('main_image_url', { length: 512 }),

    // 🔴 ADD: Inventory Management (already added in Phase 1)
    // safetyStock: integer('safety_stock').notNull().default(0),
    currentStock: integer('current_stock').default(0), // Calculated/cached

    // 🔴 ADD: Expiry and Date Management
    expiryDateManagement: boolean('expiry_date_management').default(false),
    expiryStartDate: timestamp('expiry_start_date', { withTimezone: true }),
    expiryEndDate: timestamp('expiry_end_date', { withTimezone: true }),
    manufacturingDateManagement: boolean('manufacturing_date_management').default(false),
    isGeneralInventory: boolean('is_general_inventory').default(true),

    // 🔴 ADD: Validity Period
    validityStartDate: timestamp('validity_start_date', { withTimezone: true }),
    validityEndDate: timestamp('validity_end_date', { withTimezone: true }),

    // 🔴 ADD: Location Tracking
    primaryLocationId: uuid('primary_location_id').references(() => locations.id),
    secondaryLocationId: uuid('secondary_location_id').references(() => locations.id),

    // 🔴 ADD: Variant Grouping
    variantGroupCode: varchar('variant_group_code', { length: 64 }),

    // ... existing timestamps ...
});

// 🔴 ADD: Indexes for performance
export const skusIndexes = {
    idxSkusSafetyStock: index('idx_skus_safety_stock').on(skus.safetyStock),
    idxSkusVariantGroup: index('idx_skus_variant_group').on(skus.variantGroupCode),
    idxSkusPrimaryLocation: index('idx_skus_primary_location').on(skus.primaryLocationId),
    idxSkusWeight: index('idx_skus_weight').on(skus.productWeight),
    idxSkusMoq: index('idx_skus_moq').on(skus.moq),
};
```

#### Step 4.2: Create Multi-Tier Pricing Table

**Add to schema file:**

```typescript
export const skuVariantPricing = pgTable('sku_variant_pricing', {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id')
        .references(() => skus.id, { onDelete: 'cascade' })
        .notNull(),

    // Three-tier pricing
    retailPrice: integer('retail_price'), // 판매가 (in cents)
    specialSalePrice: integer('special_sale_price'), // 특별 판매가
    wholesalePrice: integer('wholesale_price'), // 도매가
    sellingPrice: integer('selling_price'), // 현재 판매가

    // Pricing metadata
    priceEffectiveDate: timestamp('price_effective_date', { withTimezone: true }),
    priceExpiryDate: timestamp('price_expiry_date', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
    uniqueSkuPricing: unique().on(t.skuId), // One pricing record per SKU
}));

export const skuVariantPricingRelations = relations(skuVariantPricing, ({ one }) => ({
    sku: one(skus, {
        fields: [skuVariantPricing.skuId],
        references: [skus.id],
    }),
}));
```

#### Step 4.3: Create Manager Assignments Table

```typescript
export const skuManagers = pgTable('sku_managers', {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id')
        .references(() => skus.id, { onDelete: 'cascade' })
        .notNull(),

    // Manager roles (all nullable - not all SKUs need managers)
    designerId: uuid('designer_id'), // 상품디자이너
    purchaseManagerId: uuid('purchase_manager_id'), // 발주담당자
    registrationManagerId: uuid('registration_manager_id'), // 상품등록자

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
    uniqueSkuManager: unique().on(t.skuId), // One manager record per SKU
}));

export const skuManagersRelations = relations(skuManagers, ({ one }) => ({
    sku: one(skus, {
        fields: [skuManagers.skuId],
        references: [skus.id],
    }),
}));
```

#### Step 4.4: Create Location Movement Tracking Table

```typescript
export const skuLocationMovements = pgTable('sku_location_movements', {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id')
        .references(() => skus.id, { onDelete: 'cascade' })
        .notNull(),

    barcode: varchar('barcode', { length: 64 }).notNull(),

    // Location tracking
    fromLocationId: uuid('from_location_id')
        .references(() => locations.id, { onDelete: 'restrict' })
        .notNull(),
    toLocationId: uuid('to_location_id')
        .references(() => locations.id, { onDelete: 'restrict' })
        .notNull(),

    // Movement details
    quantity: integer('quantity'), // Nullable for full SKU moves
    reason: text('reason'),
    status: varchar('status', { length: 20 }).notNull().default('completed'),

    // Audit
    movedBy: uuid('moved_by'),
    movementTimestamp: timestamp('movement_timestamp', { withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
    idxMovementSku: index('idx_movement_sku').on(t.skuId),
    idxMovementBarcode: index('idx_movement_barcode').on(t.barcode),
    idxMovementTimestamp: index('idx_movement_timestamp').on(t.movementTimestamp),
}));

export const skuLocationMovementsRelations = relations(skuLocationMovements, ({ one }) => ({
    sku: one(skus, {
        fields: [skuLocationMovements.skuId],
        references: [skus.id],
    }),
    fromLocation: one(locations, {
        fields: [skuLocationMovements.fromLocationId],
        references: [locations.id],
        relationName: 'movementFrom',
    }),
    toLocation: one(locations, {
        fields: [skuLocationMovements.toLocationId],
        references: [locations.id],
        relationName: 'movementTo',
    }),
}));
```

#### Step 4.5: Run Migrations

```bash
# Generate migration for all Phase 2 schema changes
npm run db:generate.wms

# Review migration files
ls -la apps/wms/database/migrations/

# Apply migrations
npm run db:push.wms

# Verify new columns and tables
psql -d almondyoung_wms -c "\d+ skus"
psql -d almondyoung_wms -c "\dt sku_*"
```

#### Step 4.6: Update DTOs

This is a summary - create comprehensive DTOs for all new fields:

**File:** `apps/wms/src/inventory/dto/sku/create-sku.dto.ts`

Add ~35 new fields with proper validation decorators. Example:

```typescript
@ApiProperty({ description: '상품 무게 (g)', required: false, minimum: 0 })
@IsInt()
@Min(0)
@IsOptional()
productWeight?: number;

@ApiProperty({ description: '가로 (Width in cm)', required: false, minimum: 0 })
@IsInt()
@Min(0)
@IsOptional()
dimensionWidth?: number;

// ... repeat for all 35+ fields
```

**Time-saving tip:** Use a code generator or template for repetitive field definitions.

#### ✅ Week 4 Checkpoint

- [ ] 35+ fields added to SKU schema
- [ ] 3 new tables created (pricing, managers, movements)
- [ ] Migrations run successfully
- [ ] DTOs updated with all new fields
- [ ] Indexes created for performance

---

### Week 5: Barcode Printing System

#### Objective
Implement a complete barcode printing queue system with job tracking.

#### Step 5.1: Create Barcode Print Tables

**Add to schema:**

```typescript
export const printJobStatusEnum = pgEnum('print_job_status', [
    'pending',
    'printing',
    'completed',
    'failed'
]);

export const barcodePrintJobs = pgTable('barcode_print_jobs', {
    id: uuid('id').primaryKey().defaultRandom(),

    // What to print (one of these will be set)
    inboundListId: uuid('inbound_list_id').references(() => inboundLists.id),
    skuId: uuid('sku_id').references(() => skus.id),
    locationId: uuid('location_id').references(() => locations.id),

    barcodeValue: varchar('barcode_value', { length: 64 }).notNull(),
    barcodeFormat: varchar('barcode_format', { length: 20 }).default('CODE128'),

    status: printJobStatusEnum('status').default('pending'),
    printerName: varchar('printer_name', { length: 100 }),
    copies: integer('copies').default(1),

    printedAt: timestamp('printed_at', { withTimezone: true }),
    printedBy: uuid('printed_by'),
    errorMessage: text('error_message'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
    idxPrintJobStatus: index('idx_print_job_status').on(t.status),
    idxPrintJobCreated: index('idx_print_job_created').on(t.createdAt),
}));

export const locationBarcodes = pgTable('location_barcodes', {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: uuid('location_id')
        .references(() => locations.id, { onDelete: 'cascade' })
        .notNull(),
    barcodeValue: varchar('barcode_value', { length: 64 }).notNull().unique(),
    format: varchar('format', { length: 20 }).default('CODE128'),
    generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow(),
    generatedBy: uuid('generated_by'),
});
```

#### Step 5.2: Install Barcode Library

```bash
npm install bwip-js
npm install @types/bwip-js --save-dev
```

#### Step 5.3: Create Barcode Service

**Create file:** `apps/wms/src/common/services/barcode.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import * as bwipjs from 'bwip-js';

@Injectable()
export class BarcodeService {
    /**
     * Generate barcode image as base64 PNG
     */
    async generateBarcodeImage(
        value: string,
        format: 'CODE128' | 'QR' = 'CODE128'
    ): Promise<string> {
        try {
            const barcodeType = format === 'QR' ? 'qrcode' : 'code128';

            const png = await bwipjs.toBuffer({
                bcid: barcodeType,
                text: value,
                scale: 3,
                height: 10,
                includetext: true,
                textxalign: 'center',
            });

            return png.toString('base64');
        } catch (error) {
            throw new Error(`Failed to generate barcode: ${error.message}`);
        }
    }

    /**
     * Validate barcode format
     */
    validateBarcode(value: string, format: string): boolean {
        // Add format-specific validation
        if (format === 'CODE128') {
            return value.length >= 1 && value.length <= 128;
        }
        if (format === 'QR') {
            return value.length >= 1 && value.length <= 1000;
        }
        return false;
    }
}
```

#### Step 5.4: Create Print Queue Service

**Create file:** `apps/wms/src/common/services/print-queue.service.ts`

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { DbTx, barcodePrintJobs } from '../../database/schemas/wms-schema';
import { eq } from 'drizzle-orm';
import { BarcodeService } from './barcode.service';

@Injectable()
export class PrintQueueService {
    constructor(
        @Inject('DB') private db: DbTx,
        private readonly barcodeService: BarcodeService,
    ) {}

    /**
     * Create print job
     */
    async createPrintJob(
        barcodeValue: string,
        options: {
            skuId?: string;
            locationId?: string;
            inboundListId?: string;
            copies?: number;
            format?: string;
        },
        tx?: DbTx
    ) {
        return this.inTx(async (tx) => {
            const result = await tx
                .insert(barcodePrintJobs)
                .values({
                    barcodeValue,
                    barcodeFormat: options.format ?? 'CODE128',
                    skuId: options.skuId,
                    locationId: options.locationId,
                    inboundListId: options.inboundListId,
                    copies: options.copies ?? 1,
                    status: 'pending',
                })
                .returning();

            return result[0];
        }, tx);
    }

    /**
     * Get pending print jobs
     */
    async getPendingJobs(tx?: DbTx) {
        return this.inTx(async (tx) => {
            return await tx
                .select()
                .from(barcodePrintJobs)
                .where(eq(barcodePrintJobs.status, 'pending'))
                .orderBy(barcodePrintJobs.createdAt);
        }, tx);
    }

    /**
     * Mark job as completed
     */
    async markAsCompleted(jobId: string, userId?: string, tx?: DbTx) {
        return this.inTx(async (tx) => {
            await tx
                .update(barcodePrintJobs)
                .set({
                    status: 'completed',
                    printedAt: new Date(),
                    printedBy: userId,
                })
                .where(eq(barcodePrintJobs.id, jobId));
        }, tx);
    }

    private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> {
        return tx ? fn(tx) : this.db.transaction(fn);
    }
}
```

#### ✅ Week 5 Checkpoint

- [ ] Barcode print tables created
- [ ] Barcode generation service implemented
- [ ] Print queue service operational
- [ ] Location barcode support added
- [ ] API endpoints for printing created

---

### Week 6: Location Management & SKU APIs

Complete the remaining Phase 2 features by implementing location movement tracking and enhanced SKU management endpoints.

*(Due to length, abbreviated - full implementation follows same pattern as above)*

Key deliverables:
- SKU location move APIs
- Movement history tracking
- Pricing update endpoints
- Manager assignment endpoints

---

## Phase 3: Medium Priority (Weeks 7-9)

**Abbreviated - Key Features:**
- Option/variant management as separate entities
- Purchase order audit workflow (draft → pending_audit → approved)
- Manager assignments UI integration
- Sales product enhancements

---

## Phase 4: Polish & Testing (Weeks 10-12)

### Week 10: Advanced Filtering

Implement complex filtering across all modules based on UI requirements.

### Week 11: Testing & Documentation

- Unit test coverage: 80%+
- Integration tests for critical paths
- E2E test scenarios
- API documentation updates

### Week 12: Deployment

- Performance optimization
- Load testing
- Production deployment
- Monitoring setup

---

## Testing Strategy

### Unit Testing Template

```typescript
describe('ServiceName', () => {
    it('should perform operation successfully', async () => {
        // Arrange
        const input = { /* test data */ };

        // Act
        const result = await service.method(input);

        // Assert
        expect(result).toBeDefined();
    });
});
```

### Integration Testing Checklist

- [ ] End-to-end workflows tested
- [ ] Transaction integrity verified
- [ ] Error scenarios covered
- [ ] Performance benchmarks met

---

## Deployment Checklist

### Pre-Deployment

- [ ] All migrations tested on staging
- [ ] Rollback scripts prepared
- [ ] Database backup created
- [ ] Environment variables configured

### Deployment

- [ ] Deploy to staging
- [ ] Run smoke tests
- [ ] Deploy to production
- [ ] Monitor error rates
- [ ] Verify critical paths

### Post-Deployment

- [ ] Monitor performance metrics
- [ ] Check error logs
- [ ] Gather user feedback
- [ ] Document lessons learned

---

## Conclusion

This implementation guide provides a complete roadmap for implementing all Figma design requirements over 10-12 weeks. Follow the phases sequentially, checking off items as you complete them.

**Key Success Factors:**
- Start with Phase 1 (critical blockers)
- Test thoroughly at each checkpoint
- Keep frontend team updated on progress
- Document as you go

**Questions?** Refer to the detailed analysis documents in `docs/figma-comparison/` for specific implementation details.

**Good luck with your implementation! 🚀**

