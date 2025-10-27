# Almondyoung WMS - Figma Design Implementation Guide
## Phases 2-4 Detailed Continuation (Revised)

**Version:** 2.0
**Date:** 2025-10-27
**Companion to:** IMPLEMENTATION_GUIDE.md
**Focus:** Detailed expansion of Weeks 6-12 implementation steps
**Architectural Revision:** Clean domain separation between PIM and WMS

---

## Architectural Principles

### Core Design Philosophy
1. **Domain Separation**: WMS manages warehouse operations, PIM manages product catalog
2. **Physical Reality**: Every SKU row represents ONE physical product in the warehouse
3. **No Phantom Entities**: No abstract "parent" products that don't exist on shelves
4. **Loose Coupling**: WMS references PIM only via string IDs for order matching
5. **WMS-Internal Organization**: Use `sku_groups` for warehouse grouping, separate from PIM hierarchy

### Key Entities
- **WMS**: `inventoryProductMasters` (WMS-internal), `sku_groups` (warehouse organization), `skus` (physical products)
- **PIM**: `product_masters` (catalog), `product_variants` (sellable SKUs)
- **Boundary**: String references only, no foreign keys across services

---

## Table of Contents

1. [Phase 2 Continuation: Week 6](#phase-2-continuation-week-6)
2. [Phase 3: Medium Priority (Weeks 7-9)](#phase-3-medium-priority-weeks-7-9)
3. [Phase 4: Polish & Testing (Weeks 10-12)](#phase-4-polish--testing-weeks-10-12)
4. [Complete API Reference](#complete-api-reference)
5. [Testing Implementation Details](#testing-implementation-details)
6. [Deployment Guide](#deployment-guide)

---

## Phase 2 Continuation: Week 6

**Estimated Effort:** 4-5 developer days
**Priority:** 🟡 HIGH

### Week 6, Day 1-2: SKU Location Management APIs

#### Objective
Implement complete location movement tracking with barcode scanning support.

#### Step 6.1: Create Location Movement DTOs

**Create file:** `apps/wms/src/inventory/dto/sku-location-movements/move-sku-by-identifier.dto.ts`

```typescript
import { IsString, IsNotEmpty, IsUUID, IsOptional, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MoveSkuByIdentifierDto {
    @ApiProperty({
        description: 'SKU ID or Barcode for identification',
        example: '550e8400-e29b-41d4-a716-446655440000'
    })
    @IsString()
    @IsNotEmpty()
    skuIdentifier: string; // Can be UUID or barcode

    @ApiProperty({
        description: '현재 위치 ID (From location ID)',
        example: '550e8400-e29b-41d4-a716-446655440001'
    })
    @IsUUID()
    @IsNotEmpty()
    fromLocationId: string;

    @ApiProperty({
        description: '이동 위치 ID (To location ID)',
        example: '550e8400-e29b-41d4-a716-446655440002'
    })
    @IsUUID()
    @IsNotEmpty()
    toLocationId: string;

    @ApiProperty({
        description: '이동 수량 (Quantity to move)',
        required: false,
        minimum: 1
    })
    @IsInt()
    @Min(1)
    @IsOptional()
    quantity?: number; // Nullable for full SKU moves

    @ApiProperty({
        description: '이동 사유 (Reason for move)',
        required: false
    })
    @IsString()
    @IsOptional()
    reason?: string;
}
```

**Create file:** `apps/wms/src/inventory/dto/sku-location-movements/bulk-move-sku-location.dto.ts`

```typescript
import { IsArray, ValidateNested, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { MoveSkuByIdentifierDto } from './move-sku-by-identifier.dto';

export class BulkMoveSkuLocationDto {
    @ApiProperty({
        description: 'Array of SKU move operations',
        type: [MoveSkuByIdentifierDto]
    })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => MoveSkuByIdentifierDto)
    @IsNotEmpty()
    moves: MoveSkuByIdentifierDto[];
}
```

#### Step 6.2: Implement Location Movement Service Methods

**File:** `apps/wms/src/inventory/services/sku-location-movement.service.ts`

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import {
    DbTx,
    skuLocationMovements,
    skus,
    locations
} from '../../database/schemas/wms-schema';
import { MoveSkuByIdentifierDto } from '../dto/sku-location-movements/move-sku-by-identifier.dto';
import { BulkMoveSkuLocationDto } from '../dto/sku-location-movements/bulk-move-sku-location.dto';

@Injectable()
export class SkuLocationMovementService {
    constructor(@Inject('DB') private db: DbTx) {}

    private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> {
        return tx ? fn(tx) : this.db.transaction(fn);
    }

    /**
     * Move SKU to different location
     */
    async moveSkuLocation(moveDto: MoveSkuByIdentifierDto, tx?: DbTx): Promise<{
        success: boolean;
        movementId: string;
        fromLocation: string;
        toLocation: string;
    }> {
        return this.inTx(async (tx) => {
            // Step 1: Resolve SKU (by ID or barcode)
            const resolvedSku = await this.resolveSkuIdentifier(moveDto.skuIdentifier, tx);

            if (!resolvedSku) {
                throw new NotFoundException(`SKU with identifier ${moveDto.skuIdentifier} not found`);
            }

            // Step 2: Validate locations exist
            const [fromLoc] = await tx
                .select({ id: locations.id, code: locations.code })
                .from(locations)
                .where(eq(locations.id, moveDto.fromLocationId))
                .limit(1);

            const [toLoc] = await tx
                .select({ id: locations.id, code: locations.code })
                .from(locations)
                .where(eq(locations.id, moveDto.toLocationId))
                .limit(1);

            if (!fromLoc) {
                throw new NotFoundException(`From location ${moveDto.fromLocationId} not found`);
            }
            if (!toLoc) {
                throw new NotFoundException(`To location ${moveDto.toLocationId} not found`);
            }

            // Step 3: Create movement record
            const [movement] = await tx
                .insert(skuLocationMovements)
                .values({
                    skuId: resolvedSku.id,
                    barcode: resolvedSku.barcode ?? '',
                    fromLocationId: moveDto.fromLocationId,
                    toLocationId: moveDto.toLocationId,
                    quantity: moveDto.quantity,
                    reason: moveDto.reason ?? '',
                    status: 'completed',
                })
                .returning({ id: skuLocationMovements.id });

            // Step 4: Update SKU primary location
            await tx
                .update(skus)
                .set({
                    primaryLocationId: moveDto.toLocationId,
                    updatedAt: new Date(),
                })
                .where(eq(skus.id, resolvedSku.id));

            return {
                success: true,
                movementId: movement.id,
                fromLocation: fromLoc.code,
                toLocation: toLoc.code,
            };
        }, tx);
    }

    /**
     * Bulk move multiple SKUs
     */
    async bulkMoveSkuLocation(bulkMoveDto: BulkMoveSkuLocationDto, tx?: DbTx): Promise<{
        success: boolean;
        totalMoves: number;
        successfulMoves: number;
        failedMoves: number;
        results: Array<{
            skuIdentifier: string;
            success: boolean;
            movementId?: string;
            error?: string;
        }>;
    }> {
        return this.inTx(async (tx) => {
            const results = [];
            let successCount = 0;
            let failCount = 0;

            for (const move of bulkMoveDto.moves) {
                try {
                    const result = await this.moveSkuLocation(move, tx);
                    results.push({
                        skuIdentifier: move.skuIdentifier,
                        success: true,
                        movementId: result.movementId,
                    });
                    successCount++;
                } catch (error) {
                    results.push({
                        skuIdentifier: move.skuIdentifier,
                        success: false,
                        error: error.message,
                    });
                    failCount++;
                }
            }

            return {
                success: successCount > 0,
                totalMoves: bulkMoveDto.moves.length,
                successfulMoves: successCount,
                failedMoves: failCount,
                results,
            };
        }, tx);
    }

    /**
     * Get location movement history for SKU
     */
    async getSkuLocationHistory(
        skuId: string,
        limit: number = 50,
        offset: number = 0,
        tx?: DbTx
    ): Promise<Array<{
        id: string;
        fromLocation: { id: string; code: string };
        toLocation: { id: string; code: string };
        quantity: number | null;
        reason: string | null;
        movementTimestamp: Date;
        movedBy: string | null;
    }>> {
        return this.inTx(async (tx) => {
            const movements = await tx
                .select({
                    id: skuLocationMovements.id,
                    fromLocationId: skuLocationMovements.fromLocationId,
                    toLocationId: skuLocationMovements.toLocationId,
                    quantity: skuLocationMovements.quantity,
                    reason: skuLocationMovements.reason,
                    movementTimestamp: skuLocationMovements.movementTimestamp,
                    movedBy: skuLocationMovements.movedBy,
                    fromLocCode: sql<string>`from_loc.code`,
                    toLocCode: sql<string>`to_loc.code`,
                })
                .from(skuLocationMovements)
                .innerJoin(
                    sql`${locations} AS from_loc`,
                    eq(skuLocationMovements.fromLocationId, sql`from_loc.id`)
                )
                .innerJoin(
                    sql`${locations} AS to_loc`,
                    eq(skuLocationMovements.toLocationId, sql`to_loc.id`)
                )
                .where(eq(skuLocationMovements.skuId, skuId))
                .orderBy(sql`${skuLocationMovements.movementTimestamp} DESC`)
                .limit(limit)
                .offset(offset);

            return movements.map(m => ({
                id: m.id,
                fromLocation: {
                    id: m.fromLocationId,
                    code: m.fromLocCode,
                },
                toLocation: {
                    id: m.toLocationId,
                    code: m.toLocCode,
                },
                quantity: m.quantity,
                reason: m.reason,
                movementTimestamp: m.movementTimestamp,
                movedBy: m.movedBy,
            }));
        }, tx);
    }

    /**
     * Helper: Resolve SKU by ID or barcode
     */
    private async resolveSkuIdentifier(
        identifier: string,
        tx: DbTx
    ): Promise<{ id: string; barcode: string } | null> {
        // Try as UUID first
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

        if (isUuid) {
            const [result] = await tx
                .select({
                    id: skus.id,
                    barcode: skus.defaultBarcode,
                })
                .from(skus)
                .where(eq(skus.id, identifier))
                .limit(1);

            if (result) {
                return {
                    id: result.id,
                    barcode: result.barcode ?? identifier,
                };
            }
        }

        // Try as barcode
        const [barcodeResult] = await tx
            .select({
                id: skus.id,
                barcode: skus.defaultBarcode,
            })
            .from(skus)
            .where(eq(skus.defaultBarcode, identifier))
            .limit(1);

        return barcodeResult ? {
            id: barcodeResult.id,
            barcode: barcodeResult.barcode ?? identifier,
        } : null;
    }
}
```

#### Step 6.3: Add Controller Endpoints

**File:** `apps/wms/src/inventory/controllers/sku-location-movement.controller.ts`

```typescript
import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';
import { SkuLocationMovementService } from '../services/sku-location-movement.service';
import { MoveSkuByIdentifierDto } from '../dto/sku-location-movements/move-sku-by-identifier.dto';
import { BulkMoveSkuLocationDto } from '../dto/sku-location-movements/bulk-move-sku-location.dto';

@ApiTags('SKU Location Movement')
@Controller('inventory/sku-location-movements')
export class SkuLocationMovementController {
    constructor(
        private readonly skuLocationMovementService: SkuLocationMovementService
    ) {}

    @Post('move')
    @ApiOperation({ summary: 'SKU 위치 이동 (Move SKU to different location)' })
    @ApiResponse({
        status: 200,
        description: '위치 이동이 성공적으로 완료되었습니다.',
        schema: {
            type: 'object',
            properties: {
                success: { type: 'boolean', example: true },
                movementId: { type: 'string', example: 'uuid' },
                fromLocation: { type: 'string', example: 'A-01-02' },
                toLocation: { type: 'string', example: 'B-03-05' }
            }
        }
    })
    @ApiResponse({ status: 400, description: '잘못된 요청 (유효하지 않은 위치 등)' })
    @ApiResponse({ status: 404, description: 'SKU 또는 위치를 찾을 수 없습니다.' })
    async moveSkuLocation(
        @Body() moveDto: MoveSkuByIdentifierDto
    ): Promise<{ success: boolean; movementId: string; fromLocation: string; toLocation: string }> {
        return this.skuLocationMovementService.moveSkuLocation(moveDto);
    }

    @Post('bulk-move')
    @ApiOperation({ summary: '다중 SKU 위치 이동 (Bulk move multiple SKUs)' })
    @ApiResponse({
        status: 200,
        description: '일괄 이동이 완료되었습니다.',
        schema: {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                totalMoves: { type: 'number' },
                successfulMoves: { type: 'number' },
                failedMoves: { type: 'number' },
                results: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            skuIdentifier: { type: 'string' },
                            success: { type: 'boolean' },
                            movementId: { type: 'string' },
                            error: { type: 'string' }
                        }
                    }
                }
            }
        }
    })
    async bulkMoveSkuLocation(
        @Body() bulkMoveDto: BulkMoveSkuLocationDto
    ): Promise<any> {
        return this.skuLocationMovementService.bulkMoveSkuLocation(bulkMoveDto);
    }

    @Get('history/:skuId')
    @ApiOperation({ summary: 'SKU 위치 이동 이력 조회 (Get location movement history)' })
    @ApiQuery({ name: 'limit', required: false, description: '조회할 이력 수', example: 50 })
    @ApiQuery({ name: 'offset', required: false, description: '페이지 오프셋', example: 0 })
    @ApiParam({ name: 'skuId', description: 'SKU ID' })
    @ApiResponse({
        status: 200,
        description: '위치 이동 이력',
        schema: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    fromLocation: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            code: { type: 'string' }
                        }
                    },
                    toLocation: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            code: { type: 'string' }
                        }
                    },
                    quantity: { type: 'number', nullable: true },
                    reason: { type: 'string', nullable: true },
                    movementTimestamp: { type: 'string' },
                    movedBy: { type: 'string', nullable: true }
                }
            }
        }
    })
    async getSkuLocationHistory(
        @Param('skuId') skuId: string,
        @Query('limit') limit?: number,
        @Query('offset') offset?: number
    ): Promise<any[]> {
        return this.skuLocationMovementService.getSkuLocationHistory(
            skuId,
            limit ?? 50,
            offset ?? 0
        );
    }
}
```

#### Step 6.4: Test Location Movement

```bash
# Test single location move
curl -X POST http://localhost:3000/wms/inventory/sku-location-movements/move \
  -H "Content-Type: application/json" \
  -d '{
    "skuIdentifier": "sku-uuid-or-barcode",
    "fromLocationId": "location-uuid-1",
    "toLocationId": "location-uuid-2",
    "reason": "Reorganization"
  }'

# Test bulk move
curl -X POST http://localhost:3000/wms/inventory/sku-location-movements/bulk-move \
  -H "Content-Type: application/json" \
  -d '{
    "moves": [
      {
        "skuIdentifier": "barcode1",
        "fromLocationId": "loc-uuid-1",
        "toLocationId": "loc-uuid-2"
      },
      {
        "skuIdentifier": "barcode2",
        "fromLocationId": "loc-uuid-1",
        "toLocationId": "loc-uuid-2"
      }
    ]
  }'

# Get movement history
curl "http://localhost:3000/wms/inventory/sku-location-movements/history/{sku-id}?limit=10&offset=0"
```

#### ✅ Week 6, Day 1-2 Checkpoint

- [ ] Location movement DTOs created
- [ ] Service methods implemented
- [ ] Controller endpoints added
- [ ] Barcode and UUID resolution working
- [ ] Movement history tracking functional
- [ ] Manual testing completed

---

### Week 6, Day 3-4: Pricing & Manager APIs

#### Step 6.5: Implement Pricing Management

**Create file:** `apps/wms/src/inventory/dto/sku/sku-pricing.dto.ts`

```typescript
import { IsInt, Min, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSkuPricingDto {
    @ApiProperty({
        description: '판매가 (Retail price in cents)',
        required: false,
        minimum: 0,
        example: 1200000
    })
    @IsInt()
    @Min(0)
    @IsOptional()
    retailPrice?: number;

    @ApiProperty({
        description: '특별 판매가 (Special sale price in cents)',
        required: false,
        minimum: 0,
        example: 800000
    })
    @IsInt()
    @Min(0)
    @IsOptional()
    specialSalePrice?: number;

    @ApiProperty({
        description: '도매가 (Wholesale price in cents)',
        required: false,
        minimum: 0,
        example: 0
    })
    @IsInt()
    @Min(0)
    @IsOptional()
    wholesalePrice?: number;

    @ApiProperty({
        description: '현재 판매가 (Current selling price in cents)',
        required: false,
        minimum: 0,
        example: 1300000
    })
    @IsInt()
    @Min(0)
    @IsOptional()
    sellingPrice?: number;

    @ApiProperty({
        description: '가격 유효 시작일 (Price effective date)',
        required: false,
        example: '2025-01-01'
    })
    @IsDateString()
    @IsOptional()
    priceEffectiveDate?: string;

    @ApiProperty({
        description: '가격 유효 종료일 (Price expiry date)',
        required: false,
        example: '2025-12-31'
    })
    @IsDateString()
    @IsOptional()
    priceExpiryDate?: string;
}
```

**Add to inventory.service.ts:**

```typescript
import { skuVariantPricing } from '../../database/schemas/wms-schema';

/**
 * Update SKU pricing tiers
 */
async updateSkuPricing(
    skuId: string,
    pricingDto: UpdateSkuPricingDto,
    tx?: DbTx
): Promise<SkuResponseDto> {
    return this.inTx(async (tx) => {
        // Check if SKU exists
        const [sku] = await tx
            .select()
            .from(skus)
            .where(eq(skus.id, skuId))
            .limit(1);

        if (!sku) {
            throw new NotFoundException(`SKU ${skuId} not found`);
        }

        // Upsert pricing record
        const [existingPricing] = await tx
            .select()
            .from(skuVariantPricing)
            .where(eq(skuVariantPricing.skuId, skuId))
            .limit(1);

        if (existingPricing) {
            // Update existing
            await tx
                .update(skuVariantPricing)
                .set({
                    ...pricingDto,
                    priceEffectiveDate: pricingDto.priceEffectiveDate
                        ? new Date(pricingDto.priceEffectiveDate)
                        : undefined,
                    priceExpiryDate: pricingDto.priceExpiryDate
                        ? new Date(pricingDto.priceExpiryDate)
                        : undefined,
                    updatedAt: new Date(),
                })
                .where(eq(skuVariantPricing.skuId, skuId));
        } else {
            // Insert new
            await tx
                .insert(skuVariantPricing)
                .values({
                    skuId,
                    ...pricingDto,
                    priceEffectiveDate: pricingDto.priceEffectiveDate
                        ? new Date(pricingDto.priceEffectiveDate)
                        : undefined,
                    priceExpiryDate: pricingDto.priceExpiryDate
                        ? new Date(pricingDto.priceExpiryDate)
                        : undefined,
                });
        }

        // Return updated SKU with pricing
        return this.getSkuById(skuId, tx);
    }, tx);
}

/**
 * Get SKU pricing details
 */
async getSkuPricing(skuId: string, tx?: DbTx): Promise<{
    retailPrice: number | null;
    specialSalePrice: number | null;
    wholesalePrice: number | null;
    sellingPrice: number | null;
    priceEffectiveDate: Date | null;
    priceExpiryDate: Date | null;
}> {
    return this.inTx(async (tx) => {
        const [pricing] = await tx
            .select()
            .from(skuVariantPricing)
            .where(eq(skuVariantPricing.skuId, skuId))
            .limit(1);

        if (!pricing) {
            return {
                retailPrice: null,
                specialSalePrice: null,
                wholesalePrice: null,
                sellingPrice: null,
                priceEffectiveDate: null,
                priceExpiryDate: null,
            };
        }

        return {
            retailPrice: pricing.retailPrice,
            specialSalePrice: pricing.specialSalePrice,
            wholesalePrice: pricing.wholesalePrice,
            sellingPrice: pricing.sellingPrice,
            priceEffectiveDate: pricing.priceEffectiveDate,
            priceExpiryDate: pricing.priceExpiryDate,
        };
    }, tx);
}
```

#### Step 6.6: Implement Manager Assignment

**Create file:** `apps/wms/src/inventory/dto/sku/sku-managers.dto.ts`

```typescript
import { IsUUID, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSkuManagersDto {
    @ApiProperty({
        description: '상품디자이너 ID (Designer ID)',
        required: false
    })
    @IsUUID()
    @IsOptional()
    designerId?: string;

    @ApiProperty({
        description: '발주담당자 ID (Purchase manager ID)',
        required: false
    })
    @IsUUID()
    @IsOptional()
    purchaseManagerId?: string;

    @ApiProperty({
        description: '상품등록자 ID (Registration manager ID)',
        required: false
    })
    @IsUUID()
    @IsOptional()
    registrationManagerId?: string;
}
```

**Add to inventory.service.ts:**

```typescript
import { skuManagers } from '../../database/schemas/wms-schema';

/**
 * Update SKU manager assignments
 */
async updateSkuManagers(
    skuId: string,
    managersDto: UpdateSkuManagersDto,
    tx?: DbTx
): Promise<SkuResponseDto> {
    return this.inTx(async (tx) => {
        // Check if SKU exists
        const [sku] = await tx
            .select()
            .from(skus)
            .where(eq(skus.id, skuId))
            .limit(1);

        if (!sku) {
            throw new NotFoundException(`SKU ${skuId} not found`);
        }

        // Upsert managers record
        const [existingManagers] = await tx
            .select()
            .from(skuManagers)
            .where(eq(skuManagers.skuId, skuId))
            .limit(1);

        if (existingManagers) {
            // Update existing
            await tx
                .update(skuManagers)
                .set({
                    ...managersDto,
                    updatedAt: new Date(),
                })
                .where(eq(skuManagers.skuId, skuId));
        } else {
            // Insert new
            await tx
                .insert(skuManagers)
                .values({
                    skuId,
                    ...managersDto,
                });
        }

        // Return updated SKU with managers
        return this.getSkuById(skuId, tx);
    }, tx);
}

/**
 * Get SKU manager assignments
 */
async getSkuManagers(skuId: string, tx?: DbTx): Promise<{
    designerId: string | null;
    purchaseManagerId: string | null;
    registrationManagerId: string | null;
}> {
    return this.inTx(async (tx) => {
        const [managers] = await tx
            .select()
            .from(skuManagers)
            .where(eq(skuManagers.skuId, skuId))
            .limit(1);

        if (!managers) {
            return {
                designerId: null,
                purchaseManagerId: null,
                registrationManagerId: null,
            };
        }

        return {
            designerId: managers.designerId,
            purchaseManagerId: managers.purchaseManagerId,
            registrationManagerId: managers.registrationManagerId,
        };
    }, tx);
}
```

#### Step 6.7: Add Pricing & Manager Endpoints

**Add to inventory.controller.ts:**

```typescript
@Put('skus/:id/pricing')
@ApiOperation({ summary: 'SKU 가격 정보 수정 (Update SKU pricing tiers)' })
@ApiParam({ name: 'id', description: 'SKU ID' })
@ApiResponse({ status: 200, description: '가격이 수정되었습니다.', type: SkuResponseDto })
@ApiResponse({ status: 404, description: 'SKU를 찾을 수 없습니다.' })
async updateSkuPricing(
    @Param('id') skuId: string,
    @Body() pricingDto: UpdateSkuPricingDto
): Promise<SkuResponseDto> {
    return this.inventoryService.updateSkuPricing(skuId, pricingDto);
}

@Get('skus/:id/pricing')
@ApiOperation({ summary: 'SKU 가격 정보 조회 (Get SKU pricing tiers)' })
@ApiParam({ name: 'id', description: 'SKU ID' })
@ApiResponse({
    status: 200,
    description: '가격 정보'
})
async getSkuPricing(@Param('id') skuId: string): Promise<any> {
    return this.inventoryService.getSkuPricing(skuId);
}

@Put('skus/:id/managers')
@ApiOperation({ summary: 'SKU 담당자 정보 수정 (Update SKU managers)' })
@ApiParam({ name: 'id', description: 'SKU ID' })
@ApiResponse({ status: 200, description: '담당자 정보가 수정되었습니다.', type: SkuResponseDto })
async updateSkuManagers(
    @Param('id') skuId: string,
    @Body() managersDto: UpdateSkuManagersDto
): Promise<SkuResponseDto> {
    return this.inventoryService.updateSkuManagers(skuId, managersDto);
}

@Get('skus/:id/managers')
@ApiOperation({ summary: 'SKU 담당자 정보 조회 (Get SKU managers)' })
@ApiParam({ name: 'id', description: 'SKU ID' })
@ApiResponse({
    status: 200,
    description: '담당자 정보'
})
async getSkuManagers(@Param('id') skuId: string): Promise<any> {
    return this.inventoryService.getSkuManagers(skuId);
}
```

#### ✅ Week 6 Complete Checkpoint

- [ ] Pricing management implemented
- [ ] Manager assignment implemented
- [ ] All controller endpoints added
- [ ] Testing completed
- [ ] Phase 2 fully operational

---

## Phase 3: Medium Priority (Weeks 7-9)

**Estimated Effort:** 12-15 developer days
**Priority:** 🟢 MEDIUM - Enhances workflow and user experience

### Overview

Phase 3 focuses on:
1. **SKU Groups** - Warehouse-internal organizational grouping (replaces parent SKU anti-pattern)
2. Purchase order audit workflow
3. Advanced filtering capabilities
4. Clean domain separation between WMS and PIM

---

## Week 7: SKU Group Management

### Objective
Implement SKU grouping as WMS-internal organizational tool, separate from PIM product hierarchy.

### Architectural Decision: SKU Groups Approach ✅

**Why SKU Groups instead of Parent SKU:**

| Parent SKU (Anti-Pattern) | SKU Groups (Correct) |
|---------------------------|---------------------|
| ❌ Creates phantom "parent" products | ✅ Groups are metadata labels |
| ❌ Mix physical and abstract entities | ✅ All SKUs are physical products |
| ❌ Cascade delete children | ✅ Set null on delete, SKUs survive |
| ❌ Confusing self-referencing FK | ✅ Clear separate table |
| ❌ Hard to query "real" products | ✅ Simple filter: groupId IS NULL |

**Domain Separation:**
- **PIM**: Manages `product_masters` → `product_variants` (catalog hierarchy)
- **WMS**: Manages `inventoryProductMasters` → `skus` (physical products) + `sku_groups` (warehouse organization)
- **Boundary**: String references only for order matching

### Step 7.1: Create SKU Groups Schema

**File:** `apps/wms/database/schemas/wms-schema.ts`

Add after `inventoryProductMasters` definition:

```typescript
// ===== SKU GROUPS (WMS-internal warehouse organization) =====
export const skuGroups = pgTable('sku_groups', {
    id: uuid('id').primaryKey().defaultRandom(),

    // Basic info
    name: varchar('name', { length: 255 }).notNull(),
    code: varchar('code', { length: 100 }).notNull().unique(),
    description: text('description'),

    // Optional link to WMS inventory master for consistency
    inventoryMasterId: uuid('inventory_master_id')
        .references(() => inventoryProductMasters.id, { onDelete: 'set null' }),

    // Metadata
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, t => ({
    idxSkuGroupsCode: index('idx_sku_groups_code').on(t.code),
    idxSkuGroupsName: index('idx_sku_groups_name').on(t.name),
    idxSkuGroupsMaster: index('idx_sku_groups_master').on(t.inventoryMasterId),
}));

// ===== MODIFY: Add groupId to skus table =====
// Add this field to the existing skus table definition:
export const skus = pgTable('skus', {
    // ... existing fields ...

    // ADD: Optional grouping (nullable - most SKUs won't have a group)
    groupId: uuid('group_id')
        .references(() => skuGroups.id, { onDelete: 'set null' }),

    // ... rest of existing fields ...
}, t => ({
    // ... existing indexes ...
    idxSkusGroupId: index('idx_skus_group_id').on(t.groupId),
}));
```

**Generate and apply migration:**

```bash
npm run db:generate.wms
# Review generated migration file
npm run db:push.wms
```

### Step 7.2: Create SKU Group DTOs

**Create file:** `apps/wms/src/inventory/dto/sku-groups/create-sku-group.dto.ts`

```typescript
import { IsString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSkuGroupDto {
    @ApiProperty({
        description: '그룹명 (Group name)',
        example: 'Eyelash Extensions Collection'
    })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiProperty({
        description: '그룹 코드 (Group code)',
        example: 'LASH-GROUP-001'
    })
    @IsString()
    @IsNotEmpty()
    code: string;

    @ApiProperty({
        description: '설명 (Description)',
        required: false,
        example: 'All diameter and length combinations for premium lashes'
    })
    @IsString()
    @IsOptional()
    description?: string;

    @ApiProperty({
        description: 'Inventory Master ID (optional link to WMS master)',
        required: false
    })
    @IsUUID()
    @IsOptional()
    inventoryMasterId?: string;
}

export class UpdateSkuGroupDto {
    @ApiProperty({ description: '그룹명', required: false })
    @IsString()
    @IsOptional()
    name?: string;

    @ApiProperty({ description: '설명', required: false })
    @IsString()
    @IsOptional()
    description?: string;
}
```

**Create file:** `apps/wms/src/inventory/dto/sku-groups/manage-group-members.dto.ts`

```typescript
import { IsUUID, IsNotEmpty, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddSkuToGroupDto {
    @ApiProperty({ description: 'SKU ID to add to group' })
    @IsUUID()
    @IsNotEmpty()
    skuId: string;
}

export class BulkAddSkusToGroupDto {
    @ApiProperty({
        description: 'Array of SKU IDs to add to group',
        type: [String]
    })
    @IsArray()
    @IsUUID(undefined, { each: true })
    @IsNotEmpty()
    skuIds: string[];
}
```

### Step 7.3: Implement SKU Group Service

**Create file:** `apps/wms/src/inventory/services/sku-group.service.ts`

```typescript
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import {
    DbTx,
    skuGroups,
    skus,
    inventoryProductMasters,
    stockSummary
} from '../../database/schemas/wms-schema';
import { CreateSkuGroupDto, UpdateSkuGroupDto } from '../dto/sku-groups/create-sku-group.dto';
import { AddSkuToGroupDto, BulkAddSkusToGroupDto } from '../dto/sku-groups/manage-group-members.dto';

export interface SkuGroupResponseDto {
    id: string;
    name: string;
    code: string;
    description: string | null;
    inventoryMasterId: string | null;
    memberCount: number;
    createdAt: Date;
    updatedAt: Date;
}

@Injectable()
export class SkuGroupService {
    constructor(@Inject('DB') private db: DbTx) {}

    private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> {
        return tx ? fn(tx) : this.db.transaction(fn);
    }

    /**
     * Create a new SKU group
     */
    async createSkuGroup(createDto: CreateSkuGroupDto, tx?: DbTx): Promise<SkuGroupResponseDto> {
        return this.inTx(async (tx) => {
            // Validate inventory master if provided
            if (createDto.inventoryMasterId) {
                const [master] = await tx
                    .select()
                    .from(inventoryProductMasters)
                    .where(eq(inventoryProductMasters.id, createDto.inventoryMasterId))
                    .limit(1);

                if (!master) {
                    throw new NotFoundException(
                        `Inventory master ${createDto.inventoryMasterId} not found`
                    );
                }
            }

            // Check code uniqueness
            const [existingCode] = await tx
                .select()
                .from(skuGroups)
                .where(eq(skuGroups.code, createDto.code))
                .limit(1);

            if (existingCode) {
                throw new ConflictException(`Group code ${createDto.code} already exists`);
            }

            // Create group
            const [group] = await tx
                .insert(skuGroups)
                .values({
                    name: createDto.name,
                    code: createDto.code,
                    description: createDto.description ?? null,
                    inventoryMasterId: createDto.inventoryMasterId ?? null,
                })
                .returning();

            return {
                id: group.id,
                name: group.name,
                code: group.code,
                description: group.description,
                inventoryMasterId: group.inventoryMasterId,
                memberCount: 0,
                createdAt: group.createdAt,
                updatedAt: group.updatedAt,
            };
        }, tx);
    }

    /**
     * Get SKU group by ID with member count
     */
    async getSkuGroupById(groupId: string, tx?: DbTx): Promise<SkuGroupResponseDto> {
        return this.inTx(async (tx) => {
            const [group] = await tx
                .select()
                .from(skuGroups)
                .where(eq(skuGroups.id, groupId))
                .limit(1);

            if (!group) {
                throw new NotFoundException(`SKU group ${groupId} not found`);
            }

            // Count members
            const members = await tx
                .select()
                .from(skus)
                .where(eq(skus.groupId, groupId));

            return {
                id: group.id,
                name: group.name,
                code: group.code,
                description: group.description,
                inventoryMasterId: group.inventoryMasterId,
                memberCount: members.length,
                createdAt: group.createdAt,
                updatedAt: group.updatedAt,
            };
        }, tx);
    }

    /**
     * List all SKU groups
     */
    async listSkuGroups(tx?: DbTx): Promise<SkuGroupResponseDto[]> {
        return this.inTx(async (tx) => {
            const groups = await tx
                .select()
                .from(skuGroups)
                .orderBy(skuGroups.createdAt);

            // Get member counts for all groups
            return Promise.all(
                groups.map(async (group) => {
                    const members = await tx
                        .select()
                        .from(skus)
                        .where(eq(skus.groupId, group.id));

                    return {
                        id: group.id,
                        name: group.name,
                        code: group.code,
                        description: group.description,
                        inventoryMasterId: group.inventoryMasterId,
                        memberCount: members.length,
                        createdAt: group.createdAt,
                        updatedAt: group.updatedAt,
                    };
                })
            );
        }, tx);
    }

    /**
     * Update SKU group
     */
    async updateSkuGroup(
        groupId: string,
        updateDto: UpdateSkuGroupDto,
        tx?: DbTx
    ): Promise<SkuGroupResponseDto> {
        return this.inTx(async (tx) => {
            const [existing] = await tx
                .select()
                .from(skuGroups)
                .where(eq(skuGroups.id, groupId))
                .limit(1);

            if (!existing) {
                throw new NotFoundException(`SKU group ${groupId} not found`);
            }

            await tx
                .update(skuGroups)
                .set({
                    ...updateDto,
                    updatedAt: new Date(),
                })
                .where(eq(skuGroups.id, groupId));

            return this.getSkuGroupById(groupId, tx);
        }, tx);
    }

    /**
     * Delete SKU group (sets groupId to null for all members)
     */
    async deleteSkuGroup(groupId: string, tx?: DbTx): Promise<void> {
        return this.inTx(async (tx) => {
            const [group] = await tx
                .select()
                .from(skuGroups)
                .where(eq(skuGroups.id, groupId))
                .limit(1);

            if (!group) {
                throw new NotFoundException(`SKU group ${groupId} not found`);
            }

            // Note: ON DELETE SET NULL will automatically set groupId to null for all members
            await tx
                .delete(skuGroups)
                .where(eq(skuGroups.id, groupId));
        }, tx);
    }

    /**
     * Add SKU to group
     */
    async addSkuToGroup(
        groupId: string,
        addDto: AddSkuToGroupDto,
        tx?: DbTx
    ): Promise<{ success: boolean; skuId: string; groupId: string }> {
        return this.inTx(async (tx) => {
            // Validate group exists
            const [group] = await tx
                .select()
                .from(skuGroups)
                .where(eq(skuGroups.id, groupId))
                .limit(1);

            if (!group) {
                throw new NotFoundException(`SKU group ${groupId} not found`);
            }

            // Validate SKU exists
            const [sku] = await tx
                .select()
                .from(skus)
                .where(eq(skus.id, addDto.skuId))
                .limit(1);

            if (!sku) {
                throw new NotFoundException(`SKU ${addDto.skuId} not found`);
            }

            // Update SKU to link to group
            await tx
                .update(skus)
                .set({
                    groupId,
                    updatedAt: new Date(),
                })
                .where(eq(skus.id, addDto.skuId));

            return {
                success: true,
                skuId: addDto.skuId,
                groupId,
            };
        }, tx);
    }

    /**
     * Bulk add SKUs to group
     */
    async bulkAddSkusToGroup(
        groupId: string,
        bulkDto: BulkAddSkusToGroupDto,
        tx?: DbTx
    ): Promise<{
        success: boolean;
        addedCount: number;
        failedCount: number;
        results: Array<{ skuId: string; success: boolean; error?: string }>;
    }> {
        return this.inTx(async (tx) => {
            const results = [];
            let addedCount = 0;
            let failedCount = 0;

            for (const skuId of bulkDto.skuIds) {
                try {
                    await this.addSkuToGroup(groupId, { skuId }, tx);
                    results.push({ skuId, success: true });
                    addedCount++;
                } catch (error) {
                    results.push({ skuId, success: false, error: error.message });
                    failedCount++;
                }
            }

            return {
                success: addedCount > 0,
                addedCount,
                failedCount,
                results,
            };
        }, tx);
    }

    /**
     * Remove SKU from group
     */
    async removeSkuFromGroup(skuId: string, tx?: DbTx): Promise<{ success: boolean }> {
        return this.inTx(async (tx) => {
            const [sku] = await tx
                .select()
                .from(skus)
                .where(eq(skus.id, skuId))
                .limit(1);

            if (!sku) {
                throw new NotFoundException(`SKU ${skuId} not found`);
            }

            await tx
                .update(skus)
                .set({
                    groupId: null,
                    updatedAt: new Date(),
                })
                .where(eq(skus.id, skuId));

            return { success: true };
        }, tx);
    }

    /**
     * Get all SKUs in a group
     */
    async getGroupMembers(
        groupId: string,
        tx?: DbTx
    ): Promise<Array<{
        id: string;
        name: string;
        code: string;
        defaultBarcode: string | null;
        safetyStock: number;
        primaryLocationId: string | null;
    }>> {
        return this.inTx(async (tx) => {
            // Validate group exists
            const [group] = await tx
                .select()
                .from(skuGroups)
                .where(eq(skuGroups.id, groupId))
                .limit(1);

            if (!group) {
                throw new NotFoundException(`SKU group ${groupId} not found`);
            }

            // Get all SKUs in group
            const members = await tx
                .select({
                    id: skus.id,
                    name: skus.name,
                    code: skus.code,
                    defaultBarcode: skus.defaultBarcode,
                    safetyStock: skus.safetyStock,
                    primaryLocationId: skus.primaryLocationId,
                })
                .from(skus)
                .where(eq(skus.groupId, groupId))
                .orderBy(skus.createdAt);

            return members;
        }, tx);
    }

    /**
     * Get ungrouped SKUs (groupId is null)
     */
    async getUngroupedSkus(
        limit: number = 50,
        offset: number = 0,
        tx?: DbTx
    ): Promise<Array<{
        id: string;
        name: string;
        code: string;
        defaultBarcode: string | null;
    }>> {
        return this.inTx(async (tx) => {
            const ungrouped = await tx
                .select({
                    id: skus.id,
                    name: skus.name,
                    code: skus.code,
                    defaultBarcode: skus.defaultBarcode,
                })
                .from(skus)
                .where(isNull(skus.groupId))
                .orderBy(skus.createdAt)
                .limit(limit)
                .offset(offset);

            return ungrouped;
        }, tx);
    }
}
```

### Step 7.4: Add SKU Group Controller

**Create file:** `apps/wms/src/inventory/controllers/sku-group.controller.ts`

```typescript
import {
    Controller,
    Post,
    Get,
    Put,
    Delete,
    Body,
    Param,
    Query,
    HttpCode,
    HttpStatus
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { SkuGroupService } from '../services/sku-group.service';
import { CreateSkuGroupDto, UpdateSkuGroupDto } from '../dto/sku-groups/create-sku-group.dto';
import { AddSkuToGroupDto, BulkAddSkusToGroupDto } from '../dto/sku-groups/manage-group-members.dto';

@ApiTags('SKU Groups')
@Controller('inventory/sku-groups')
export class SkuGroupController {
    constructor(private readonly skuGroupService: SkuGroupService) {}

    @Post()
    @ApiOperation({ summary: 'SKU 그룹 생성 (Create SKU group)' })
    @ApiResponse({
        status: 201,
        description: '그룹이 성공적으로 생성되었습니다.',
    })
    @ApiResponse({ status: 409, description: '그룹 코드가 이미 존재합니다.' })
    async createSkuGroup(@Body() createDto: CreateSkuGroupDto) {
        return this.skuGroupService.createSkuGroup(createDto);
    }

    @Get()
    @ApiOperation({ summary: '모든 SKU 그룹 조회 (List all SKU groups)' })
    @ApiResponse({ status: 200, description: 'SKU 그룹 목록' })
    async listSkuGroups() {
        return this.skuGroupService.listSkuGroups();
    }

    @Get(':id')
    @ApiOperation({ summary: 'SKU 그룹 상세 조회 (Get SKU group detail)' })
    @ApiParam({ name: 'id', description: 'Group ID' })
    @ApiResponse({ status: 200, description: '그룹 상세 정보' })
    @ApiResponse({ status: 404, description: '그룹을 찾을 수 없습니다.' })
    async getSkuGroup(@Param('id') groupId: string) {
        return this.skuGroupService.getSkuGroupById(groupId);
    }

    @Put(':id')
    @ApiOperation({ summary: 'SKU 그룹 수정 (Update SKU group)' })
    @ApiParam({ name: 'id', description: 'Group ID' })
    @ApiResponse({ status: 200, description: '그룹이 수정되었습니다.' })
    @ApiResponse({ status: 404, description: '그룹을 찾을 수 없습니다.' })
    async updateSkuGroup(
        @Param('id') groupId: string,
        @Body() updateDto: UpdateSkuGroupDto
    ) {
        return this.skuGroupService.updateSkuGroup(groupId, updateDto);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'SKU 그룹 삭제 (Delete SKU group)' })
    @ApiParam({ name: 'id', description: 'Group ID' })
    @ApiResponse({ status: 204, description: '그룹이 삭제되었습니다. (멤버 SKU들은 그룹 해제됨)' })
    @ApiResponse({ status: 404, description: '그룹을 찾을 수 없습니다.' })
    async deleteSkuGroup(@Param('id') groupId: string) {
        return this.skuGroupService.deleteSkuGroup(groupId);
    }

    @Get(':id/members')
    @ApiOperation({ summary: '그룹의 모든 SKU 조회 (Get all SKUs in group)' })
    @ApiParam({ name: 'id', description: 'Group ID' })
    @ApiResponse({ status: 200, description: '그룹 멤버 목록' })
    async getGroupMembers(@Param('id') groupId: string) {
        return this.skuGroupService.getGroupMembers(groupId);
    }

    @Post(':id/members')
    @ApiOperation({ summary: 'SKU를 그룹에 추가 (Add SKU to group)' })
    @ApiParam({ name: 'id', description: 'Group ID' })
    @ApiResponse({ status: 200, description: 'SKU가 그룹에 추가되었습니다.' })
    @ApiResponse({ status: 404, description: 'SKU 또는 그룹을 찾을 수 없습니다.' })
    async addSkuToGroup(
        @Param('id') groupId: string,
        @Body() addDto: AddSkuToGroupDto
    ) {
        return this.skuGroupService.addSkuToGroup(groupId, addDto);
    }

    @Post(':id/members/bulk')
    @ApiOperation({ summary: '여러 SKU를 그룹에 일괄 추가 (Bulk add SKUs to group)' })
    @ApiParam({ name: 'id', description: 'Group ID' })
    @ApiResponse({ status: 200, description: '일괄 추가가 완료되었습니다.' })
    async bulkAddSkusToGroup(
        @Param('id') groupId: string,
        @Body() bulkDto: BulkAddSkusToGroupDto
    ) {
        return this.skuGroupService.bulkAddSkusToGroup(groupId, bulkDto);
    }

    @Delete('members/:skuId')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'SKU를 그룹에서 제거 (Remove SKU from group)' })
    @ApiParam({ name: 'skuId', description: 'SKU ID' })
    @ApiResponse({ status: 204, description: 'SKU가 그룹에서 제거되었습니다.' })
    @ApiResponse({ status: 404, description: 'SKU를 찾을 수 없습니다.' })
    async removeSkuFromGroup(@Param('skuId') skuId: string) {
        return this.skuGroupService.removeSkuFromGroup(skuId);
    }

    @Get('ungrouped/list')
    @ApiOperation({ summary: '그룹에 속하지 않은 SKU 조회 (Get ungrouped SKUs)' })
    @ApiQuery({ name: 'limit', required: false, description: '조회 개수', example: 50 })
    @ApiQuery({ name: 'offset', required: false, description: '페이지 오프셋', example: 0 })
    @ApiResponse({ status: 200, description: '그룹 미지정 SKU 목록' })
    async getUngroupedSkus(
        @Query('limit') limit?: number,
        @Query('offset') offset?: number
    ) {
        return this.skuGroupService.getUngroupedSkus(limit ?? 50, offset ?? 0);
    }
}
```

### Step 7.5: Update Inventory Module

**File:** `apps/wms/src/inventory/inventory.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { InventoryService } from './services/inventory.service';
import { SkuGroupService } from './services/sku-group.service';
import { SkuLocationMovementService } from './services/sku-location-movement.service';
import { InventoryController } from './controllers/inventory.controller';
import { SkuGroupController } from './controllers/sku-group.controller';
import { SkuLocationMovementController } from './controllers/sku-location-movement.controller';
import { DbModule } from '../database/db.module';

@Module({
    imports: [DbModule],
    controllers: [
        InventoryController,
        SkuGroupController,
        SkuLocationMovementController,
    ],
    providers: [
        InventoryService,
        SkuGroupService,
        SkuLocationMovementService,
    ],
    exports: [
        InventoryService,
        SkuGroupService,
        SkuLocationMovementService,
    ],
})
export class InventoryModule {}
```

### ✅ Week 7 Checkpoint

- [ ] `sku_groups` table created with proper schema
- [ ] `groupId` field added to `skus` table
- [ ] Group DTOs created
- [ ] SkuGroupService implemented with all CRUD operations
- [ ] SkuGroupController endpoints added
- [ ] Module updated with new service and controller
- [ ] Testing completed (create group, add members, query members)
- [ ] Verified: Deleting group sets SKU.groupId to null (SKUs survive)

---

## Week 8: Purchase Order Audit Workflow

### Objective
Implement multi-stage approval workflow for purchase orders.

### Step 8.1: Extend Purchase Order Schema

**File:** `apps/wms/database/schemas/wms-schema.ts`

```typescript
// 🔴 ADD: Purchase order audit status enum
export const poAuditStatusEnum = pgEnum('po_audit_status', [
    'draft',           // 초안 - Not yet submitted
    'pending_audit',   // 검토 대기 - Submitted for approval
    'approved',        // 승인됨 - Approved
    'rejected',        // 거부됨 - Rejected
]);

// 🔴 MODIFY: Add audit fields to purchase_orders table
export const purchaseOrders = pgTable('purchase_orders', {
    // ... existing fields ...

    // 🔴 ADD: Audit workflow fields
    auditStatus: poAuditStatusEnum('audit_status').default('draft'),
    submittedForAuditAt: timestamp('submitted_for_audit_at', { withTimezone: true }),
    submittedForAuditBy: uuid('submitted_for_audit_by'),
    auditedAt: timestamp('audited_at', { withTimezone: true }),
    auditedBy: uuid('audited_by'),
    auditNotes: text('audit_notes'),

    // ... existing timestamps ...
});
```

### Step 8.2: Create Audit DTOs

**Create file:** `apps/wms/src/inbound/dto/purchase-order/audit-po.dto.ts`

```typescript
import { IsString, IsOptional, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitForAuditDto {
    @ApiProperty({
        description: '제출 메모 (Submission notes)',
        required: false
    })
    @IsString()
    @IsOptional()
    notes?: string;
}

export class ApprovePoDto {
    @ApiProperty({
        description: '승인 메모 (Approval notes)',
        required: false
    })
    @IsString()
    @IsOptional()
    approvalNotes?: string;
}

export class RejectPoDto {
    @ApiProperty({
        description: '거부 사유 (Rejection reason)',
        required: true
    })
    @IsString()
    @IsNotEmpty()
    rejectionReason: string;
}
```

### Step 8.3: Implement Audit Workflow in Service

**File:** `apps/wms/src/inbound/services/purchase-order.service.ts`

```typescript
/**
 * Submit PO for audit
 */
async submitForAudit(
    poId: string,
    dto: SubmitForAuditDto,
    userId?: string,
    tx?: DbTx
): Promise<{
    id: string;
    auditStatus: string;
    submittedAt: Date;
    message: string;
}> {
    return this.inTx(async (tx) => {
        // Get PO
        const [po] = await tx
            .select()
            .from(purchaseOrders)
            .where(eq(purchaseOrders.id, poId))
            .limit(1);

        if (!po) {
            throw new NotFoundException(`Purchase order ${poId} not found`);
        }

        // Validate current status
        if (po.auditStatus !== 'draft') {
            throw new BadRequestException(
                `Cannot submit: current audit status is ${po.auditStatus}, expected 'draft'`
            );
        }

        // Update status
        await tx
            .update(purchaseOrders)
            .set({
                auditStatus: 'pending_audit',
                submittedForAuditAt: new Date(),
                submittedForAuditBy: userId ?? null,
                auditNotes: dto.notes ?? null,
                updatedAt: new Date(),
            })
            .where(eq(purchaseOrders.id, poId));

        return {
            id: poId,
            auditStatus: 'pending_audit',
            submittedAt: new Date(),
            message: '검토 요청이 제출되었습니다. (Submitted for audit)',
        };
    }, tx);
}

/**
 * Approve PO
 */
async approvePo(
    poId: string,
    dto: ApprovePoDto,
    userId?: string,
    tx?: DbTx
): Promise<{
    id: string;
    auditStatus: string;
    approvedAt: Date;
    message: string;
}> {
    return this.inTx(async (tx) => {
        // Get PO
        const [po] = await tx
            .select()
            .from(purchaseOrders)
            .where(eq(purchaseOrders.id, poId))
            .limit(1);

        if (!po) {
            throw new NotFoundException(`Purchase order ${poId} not found`);
        }

        // Validate current status
        if (po.auditStatus !== 'pending_audit') {
            throw new BadRequestException(
                `Cannot approve: current audit status is ${po.auditStatus}, expected 'pending_audit'`
            );
        }

        // Update status
        await tx
            .update(purchaseOrders)
            .set({
                auditStatus: 'approved',
                auditedAt: new Date(),
                auditedBy: userId ?? null,
                auditNotes: dto.approvalNotes ?? null,
                updatedAt: new Date(),
            })
            .where(eq(purchaseOrders.id, poId));

        return {
            id: poId,
            auditStatus: 'approved',
            approvedAt: new Date(),
            message: '발주가 승인되었습니다. (Purchase order approved)',
        };
    }, tx);
}

/**
 * Reject PO
 */
async rejectPo(
    poId: string,
    dto: RejectPoDto,
    userId?: string,
    tx?: DbTx
): Promise<{
    id: string;
    auditStatus: string;
    rejectedAt: Date;
    reason: string;
    message: string;
}> {
    return this.inTx(async (tx) => {
        // Get PO
        const [po] = await tx
            .select()
            .from(purchaseOrders)
            .where(eq(purchaseOrders.id, poId))
            .limit(1);

        if (!po) {
            throw new NotFoundException(`Purchase order ${poId} not found`);
        }

        // Validate current status
        if (po.auditStatus !== 'pending_audit') {
            throw new BadRequestException(
                `Cannot reject: current audit status is ${po.auditStatus}, expected 'pending_audit'`
            );
        }

        // Update status (back to draft so it can be revised)
        await tx
            .update(purchaseOrders)
            .set({
                auditStatus: 'draft', // Reset to draft for revision
                auditedAt: new Date(),
                auditedBy: userId ?? null,
                auditNotes: `REJECTED: ${dto.rejectionReason}`,
                updatedAt: new Date(),
            })
            .where(eq(purchaseOrders.id, poId));

        return {
            id: poId,
            auditStatus: 'draft',
            rejectedAt: new Date(),
            reason: dto.rejectionReason,
            message: '발주가 거부되었습니다. 수정 후 재제출하세요. (Purchase order rejected, please revise and resubmit)',
        };
    }, tx);
}
```

### Step 8.4: Add Audit Endpoints

**File:** `apps/wms/src/inbound/controllers/purchase-order.controller.ts`

```typescript
@Put(':id/submit-for-audit')
@ApiOperation({ summary: '검토 제출 (Submit PO for audit)' })
@ApiParam({ name: 'id', description: 'Purchase Order ID' })
@ApiResponse({ status: 200, description: '검토 요청 제출 완료' })
@ApiResponse({ status: 400, description: '잘못된 상태' })
@ApiResponse({ status: 404, description: '발주를 찾을 수 없습니다.' })
async submitForAudit(
    @Param('id') id: string,
    @Body() dto: SubmitForAuditDto
): Promise<any> {
    return this.purchaseOrderService.submitForAudit(id, dto);
}

@Put(':id/approve')
@ApiOperation({ summary: '발주 승인 (Approve purchase order)' })
@ApiParam({ name: 'id', description: 'Purchase Order ID' })
@ApiResponse({ status: 200, description: '발주 승인 완료' })
@ApiResponse({ status: 400, description: '잘못된 상태' })
@ApiResponse({ status: 404, description: '발주를 찾을 수 없습니다.' })
async approvePo(
    @Param('id') id: string,
    @Body() dto: ApprovePoDto
): Promise<any> {
    return this.purchaseOrderService.approvePo(id, dto);
}

@Put(':id/reject')
@ApiOperation({ summary: '발주 거부 (Reject purchase order)' })
@ApiParam({ name: 'id', description: 'Purchase Order ID' })
@ApiResponse({ status: 200, description: '발주 거부 완료' })
@ApiResponse({ status: 400, description: '잘못된 상태' })
@ApiResponse({ status: 404, description: '발주를 찾을 수 없습니다.' })
async rejectPo(
    @Param('id') id: string,
    @Body() dto: RejectPoDto
): Promise<any> {
    return this.purchaseOrderService.rejectPo(id, dto);
}
```

### ✅ Week 8 Checkpoint

- [ ] Audit status enum created
- [ ] Purchase order schema extended
- [ ] Audit DTOs created
- [ ] Service methods for audit workflow implemented
- [ ] Controller endpoints added
- [ ] Status transition validation working
- [ ] Testing completed

---

## Week 9: Advanced Filtering & Search

### Objective
Implement comprehensive filtering across all inventory modules with clean domain separation.

### Step 9.1: Create Advanced Filter DTOs

**Create file:** `apps/wms/src/inventory/dto/inventory/advanced-filters.dto.ts`

```typescript
import {
    IsOptional,
    IsString,
    IsEnum,
    IsInt,
    Min,
    IsBoolean,
    IsDateString,
    IsUUID
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum StockDisplayMode {
    ALL = 'all',
    BELOW_SAFETY = 'below_safety',
    WITH_STOCK = 'with_stock',
    OUT_OF_STOCK = 'out_of_stock',
}

export class AdvancedInventoryFiltersDto {
    // Basic search
    @ApiProperty({ description: 'SKU 이름/코드 검색', required: false })
    @IsString()
    @IsOptional()
    search?: string;

    // Stock display mode
    @ApiProperty({
        description: '재고 표시 모드',
        enum: StockDisplayMode,
        required: false
    })
    @IsEnum(StockDisplayMode)
    @IsOptional()
    displayMode?: StockDisplayMode;

    // Supplier filter
    @ApiProperty({ description: '공급처 ID', required: false })
    @IsString()
    @IsOptional()
    supplierId?: string;

    // Location filters
    @ApiProperty({ description: '창고 ID', required: false })
    @IsString()
    @IsOptional()
    warehouseId?: string;

    @ApiProperty({ description: '위치 ID', required: false })
    @IsString()
    @IsOptional()
    locationId?: string;

    // Date range
    @ApiProperty({ description: '시작일 (YYYY-MM-DD)', required: false })
    @IsDateString()
    @IsOptional()
    startDate?: string;

    @ApiProperty({ description: '종료일 (YYYY-MM-DD)', required: false })
    @IsDateString()
    @IsOptional()
    endDate?: string;

    // Stock type
    @ApiProperty({ description: '재고 유형', required: false })
    @IsString()
    @IsOptional()
    stockType?: string;

    // Barcode search
    @ApiProperty({ description: '바코드 검색', required: false })
    @IsString()
    @IsOptional()
    barcode?: string;

    // ===== WMS-INTERNAL GROUPING FILTERS =====

    @ApiProperty({
        description: 'SKU 그룹 ID (WMS-internal grouping)',
        required: false
    })
    @IsUUID()
    @IsOptional()
    groupId?: string;

    @ApiProperty({
        description: 'SKU 그룹 코드 (WMS-internal grouping)',
        required: false
    })
    @IsString()
    @IsOptional()
    groupCode?: string;

    @ApiProperty({
        description: '그룹화된 SKU만 조회 (true=그룹있음, false=그룹없음)',
        required: false
    })
    @IsBoolean()
    @IsOptional()
    isGrouped?: boolean;

    @ApiProperty({
        description: 'Inventory Master ID (WMS-internal master)',
        required: false
    })
    @IsUUID()
    @IsOptional()
    inventoryMasterId?: string;

    // Pagination
    @ApiProperty({
        description: 'Page limit',
        default: 50,
        minimum: 1,
        maximum: 200,
        required: false
    })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @IsOptional()
    limit?: number = 50;

    @ApiProperty({
        description: 'Page offset',
        default: 0,
        minimum: 0,
        required: false
    })
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @IsOptional()
    offset?: number = 0;

    // Sorting
    @ApiProperty({
        description: '정렬 필드',
        enum: ['name', 'code', 'createdAt', 'updatedAt', 'safetyStock'],
        required: false
    })
    @IsString()
    @IsOptional()
    sortBy?: 'name' | 'code' | 'createdAt' | 'updatedAt' | 'safetyStock';

    @ApiProperty({
        description: '정렬 방향',
        enum: ['asc', 'desc'],
        required: false
    })
    @IsEnum(['asc', 'desc'])
    @IsOptional()
    sortOrder?: 'asc' | 'desc';
}
```

### Step 9.2: Implement Advanced Search Service Method

**Add to inventory.service.ts:**

```typescript
import {
    stockSummary,
    suppliers,
    locations,
    skuGroups
} from '../../database/schemas/wms-schema';
import { like, gte, lte, isNull, isNotNull, inArray } from 'drizzle-orm';

/**
 * Advanced inventory search with comprehensive filtering
 */
async searchInventoryAdvanced(
    filters: AdvancedInventoryFiltersDto,
    tx?: DbTx
): Promise<{
    items: SkuResponseDto[];
    total: number;
    limit: number;
    offset: number;
}> {
    return this.inTx(async (tx) => {
        // Build where conditions
        const conditions = [];

        // Search by name or code
        if (filters.search) {
            conditions.push(
                or(
                    like(skus.name, `%${filters.search}%`),
                    like(skus.code, `%${filters.search}%`)
                )
            );
        }

        // Barcode search
        if (filters.barcode) {
            conditions.push(eq(skus.defaultBarcode, filters.barcode));
        }

        // Stock type
        if (filters.stockType) {
            conditions.push(eq(skus.stockType, filters.stockType));
        }

        // ===== WMS-INTERNAL GROUPING FILTERS =====

        // Group ID filter
        if (filters.groupId) {
            conditions.push(eq(skus.groupId, filters.groupId));
        }

        // Group Code filter (requires join to sku_groups)
        if (filters.groupCode) {
            const [group] = await tx
                .select({ id: skuGroups.id })
                .from(skuGroups)
                .where(eq(skuGroups.code, filters.groupCode))
                .limit(1);

            if (group) {
                conditions.push(eq(skus.groupId, group.id));
            } else {
                // No matching group code - return empty results
                return {
                    items: [],
                    total: 0,
                    limit: filters.limit ?? 50,
                    offset: filters.offset ?? 0,
                };
            }
        }

        // Grouped/ungrouped filter
        if (filters.isGrouped !== undefined) {
            conditions.push(
                filters.isGrouped
                    ? isNotNull(skus.groupId)  // Has group
                    : isNull(skus.groupId)     // Standalone SKU
            );
        }

        // Inventory Master filter (WMS-internal)
        if (filters.inventoryMasterId) {
            conditions.push(eq(skus.masterId, filters.inventoryMasterId));
        }

        // Location filter
        if (filters.locationId) {
            conditions.push(eq(skus.primaryLocationId, filters.locationId));
        }

        // Date range
        if (filters.startDate) {
            conditions.push(gte(skus.createdAt, new Date(filters.startDate)));
        }
        if (filters.endDate) {
            conditions.push(lte(skus.createdAt, new Date(filters.endDate)));
        }

        // Build base query
        let query = tx
            .select({
                sku: skus,
                stockSummary: stockSummary,
            })
            .from(skus)
            .leftJoin(stockSummary, eq(skus.id, stockSummary.skuId))
            .where(conditions.length > 0 ? and(...conditions) : undefined);

        // Display mode filters (applied to joined stockSummary)
        if (filters.displayMode) {
            switch (filters.displayMode) {
                case StockDisplayMode.BELOW_SAFETY:
                    query = query.where(
                        sql`COALESCE(${stockSummary.onHand}, 0) < ${skus.safetyStock}`
                    );
                    break;
                case StockDisplayMode.WITH_STOCK:
                    query = query.where(
                        sql`COALESCE(${stockSummary.onHand}, 0) > 0`
                    );
                    break;
                case StockDisplayMode.OUT_OF_STOCK:
                    query = query.where(
                        sql`COALESCE(${stockSummary.onHand}, 0) = 0`
                    );
                    break;
            }
        }

        // Warehouse filter (via stock summary)
        if (filters.warehouseId) {
            query = query.where(eq(stockSummary.warehouseId, filters.warehouseId));
        }

        // Sorting
        const sortField = filters.sortBy ?? 'createdAt';
        const sortDirection = filters.sortOrder ?? 'desc';

        if (sortDirection === 'asc') {
            query = query.orderBy(skus[sortField]);
        } else {
            query = query.orderBy(sql`${skus[sortField]} DESC`);
        }

        // Pagination
        query = query.limit(filters.limit ?? 50).offset(filters.offset ?? 0);

        // Execute query
        const results = await query;

        // Count total
        const [countResult] = await tx
            .select({ count: sql<number>`count(DISTINCT ${skus.id})` })
            .from(skus)
            .leftJoin(stockSummary, eq(skus.id, stockSummary.skuId))
            .where(conditions.length > 0 ? and(...conditions) : undefined);

        const total = Number(countResult?.count ?? 0);

        // Map to DTOs
        const items = await Promise.all(
            results.map(row => this.mapToResponseDto(row.sku))
        );

        return {
            items,
            total,
            limit: filters.limit ?? 50,
            offset: filters.offset ?? 0,
        };
    }, tx);
}
```

### Step 9.3: Add Advanced Search Endpoint

**Add to inventory.controller.ts:**

```typescript
@Get('skus/search/advanced')
@ApiOperation({ summary: '고급 재고 검색 (Advanced inventory search)' })
@ApiResponse({
    status: 200,
    description: '검색 결과',
    schema: {
        type: 'object',
        properties: {
            items: { type: 'array', items: { $ref: '#/components/schemas/SkuResponseDto' } },
            total: { type: 'number' },
            limit: { type: 'number' },
            offset: { type: 'number' }
        }
    }
})
async searchInventoryAdvanced(
    @Query() filters: AdvancedInventoryFiltersDto
): Promise<any> {
    return this.inventoryService.searchInventoryAdvanced(filters);
}
```

### ✅ Week 9 Checkpoint

- [ ] Advanced filter DTO created with clean domain separation
- [ ] Removed PIM concepts (variantGroupCode)
- [ ] Added WMS-internal filters (groupId, groupCode, isGrouped, inventoryMasterId)
- [ ] Complex filter logic implemented
- [ ] Display mode filtering working
- [ ] Sorting and pagination functional
- [ ] Search endpoint added
- [ ] Performance optimized with indexes
- [ ] Testing completed

---

## Phase 4: Polish & Testing (Weeks 10-12)

**Estimated Effort:** 8-10 developer days
**Priority:** 🟢 LOW - Quality assurance and deployment preparation

### Week 10: Reporting & Export Features

#### Objective
Implement PDF/Excel export capabilities and summary reports.

#### Step 10.1: Install PDF Generation Library

```bash
npm install pdfkit
npm install @types/pdfkit --save-dev
```

#### Step 10.2: Create PDF Export Service

**Create file:** `apps/wms/src/common/services/pdf-export.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

export interface InventoryReportData {
    title: string;
    generatedAt: Date;
    warehouse?: string;
    items: Array<{
        skuCode: string;
        skuName: string;
        location: string;
        currentStock: number;
        safetyStock: number;
        status: string;
    }>;
}

@Injectable()
export class PdfExportService {
    /**
     * Generate inventory report as PDF
     */
    async generateInventoryReport(data: InventoryReportData): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({ size: 'A4', margin: 50 });
            const chunks: Buffer[] = [];

            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            // Header
            doc.fontSize(20).text(data.title, { align: 'center' });
            doc.moveDown();
            doc.fontSize(10).text(`Generated: ${data.generatedAt.toISOString()}`);
            if (data.warehouse) {
                doc.text(`Warehouse: ${data.warehouse}`);
            }
            doc.moveDown();

            // Table header
            const tableTop = doc.y;
            doc.fontSize(8);
            doc.text('SKU Code', 50, tableTop);
            doc.text('Name', 150, tableTop);
            doc.text('Location', 300, tableTop);
            doc.text('Stock', 400, tableTop);
            doc.text('Safety', 450, tableTop);
            doc.text('Status', 500, tableTop);

            // Table rows
            let yPos = tableTop + 20;
            data.items.forEach((item) => {
                if (yPos > 700) {
                    doc.addPage();
                    yPos = 50;
                }

                doc.text(item.skuCode, 50, yPos);
                doc.text(item.skuName.substring(0, 30), 150, yPos);
                doc.text(item.location, 300, yPos);
                doc.text(item.currentStock.toString(), 400, yPos);
                doc.text(item.safetyStock.toString(), 450, yPos);
                doc.text(item.status, 500, yPos);

                yPos += 15;
            });

            // Footer
            doc.fontSize(8).text(
                `Total Items: ${data.items.length}`,
                50,
                doc.page.height - 50,
                { align: 'center' }
            );

            doc.end();
        });
    }
}
```

#### Step 10.3: Add Export Endpoints

**Add to inventory.controller.ts:**

```typescript
import { Response } from 'express';
import { Res } from '@nestjs/common';

@Get('reports/inventory/pdf')
@ApiOperation({ summary: '재고 현황 PDF 다운로드 (Download inventory report as PDF)' })
@ApiQuery({ name: 'warehouseId', required: false })
async downloadInventoryReportPdf(
    @Query('warehouseId') warehouseId: string | undefined,
    @Res() res: Response
): Promise<void> {
    const reportData = await this.inventoryService.generateInventoryReportData(warehouseId);
    const pdfBuffer = await this.pdfExportService.generateInventoryReport(reportData);

    res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="inventory-report-${new Date().toISOString()}.pdf"`,
        'Content-Length': pdfBuffer.length,
    });

    res.send(pdfBuffer);
}
```

#### ✅ Week 10 Checkpoint

- [ ] PDF export library installed
- [ ] PDF generation service created
- [ ] Report endpoints added
- [ ] Testing completed

---

### Week 11: Comprehensive Testing

#### Objective
Achieve 80%+ test coverage across all Phase 1-3 features.

#### Step 11.1: Unit Testing Example

**Create file:** `apps/wms/src/inventory/services/sku-group.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { SkuGroupService } from './sku-group.service';
import { NotFoundException, ConflictException } from '@nestjs/common';

describe('SkuGroupService', () => {
    let service: SkuGroupService;
    let mockDb: any;

    beforeEach(async () => {
        mockDb = {
            select: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            insert: jest.fn().mockReturnThis(),
            values: jest.fn().mockReturnThis(),
            returning: jest.fn(),
            update: jest.fn().mockReturnThis(),
            set: jest.fn().mockReturnThis(),
            delete: jest.fn().mockReturnThis(),
            transaction: jest.fn((fn) => fn(mockDb)),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SkuGroupService,
                {
                    provide: 'DB',
                    useValue: mockDb,
                },
            ],
        }).compile();

        service = module.get<SkuGroupService>(SkuGroupService);
    });

    describe('createSkuGroup', () => {
        it('should create SKU group', async () => {
            const createDto = {
                name: 'Test Group',
                code: 'TEST-GROUP-001',
                description: 'Test description',
            };

            mockDb.returning.mockResolvedValue([{
                id: 'group-uuid',
                ...createDto,
                inventoryMasterId: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            }]);

            const result = await service.createSkuGroup(createDto as any);

            expect(result).toBeDefined();
            expect(result.code).toBe('TEST-GROUP-001');
            expect(mockDb.insert).toHaveBeenCalled();
        });

        it('should throw error if code already exists', async () => {
            const createDto = {
                name: 'Test Group',
                code: 'DUPLICATE-CODE',
            };

            // Mock existing code check
            mockDb.returning.mockResolvedValueOnce([{ id: 'existing-id' }]);

            await expect(service.createSkuGroup(createDto as any))
                .rejects.toThrow(ConflictException);
        });
    });

    describe('addSkuToGroup', () => {
        it('should add SKU to group', async () => {
            const groupId = 'group-uuid';
            const addDto = { skuId: 'sku-uuid' };

            // Mock group exists
            mockDb.returning.mockResolvedValueOnce([{ id: groupId }]);
            // Mock SKU exists
            mockDb.returning.mockResolvedValueOnce([{ id: addDto.skuId }]);

            const result = await service.addSkuToGroup(groupId, addDto, undefined);

            expect(result.success).toBe(true);
            expect(result.skuId).toBe(addDto.skuId);
            expect(mockDb.update).toHaveBeenCalled();
        });
    });

    describe('deleteSkuGroup', () => {
        it('should delete group and set SKU groupId to null', async () => {
            const groupId = 'group-uuid';

            // Mock group exists
            mockDb.returning.mockResolvedValueOnce([{ id: groupId }]);

            await service.deleteSkuGroup(groupId);

            expect(mockDb.delete).toHaveBeenCalled();
            // Note: ON DELETE SET NULL is handled by database
        });
    });
});
```

#### ✅ Week 11 Checkpoint

- [ ] Unit tests written for all critical paths
- [ ] Integration tests covering workflows
- [ ] E2E tests for user scenarios
- [ ] Test coverage ≥ 80%
- [ ] All tests passing

---

### Week 12: Deployment & Monitoring

#### Objective
Deploy to production with proper monitoring and rollback plans.

#### Step 12.1: Pre-Deployment Checklist

**Database:**
- [ ] All migrations tested on staging
- [ ] Rollback scripts prepared for each migration
- [ ] Production database backup created
- [ ] Index performance verified

**Code:**
- [ ] All tests passing on CI/CD
- [ ] No linting errors
- [ ] Dependencies updated and secure
- [ ] Environment variables configured

**Documentation:**
- [ ] API documentation updated
- [ ] Changelog created
- [ ] Deployment guide written
- [ ] User guide updated

#### Step 12.2: Deployment Script

**Create file:** `scripts/deploy-production.sh`

```bash
#!/bin/bash

set -e

echo "🚀 Starting production deployment..."

# 1. Pre-deployment checks
echo "✅ Running pre-deployment checks..."
npm run lint
npm run test
npm run build:wms

# 2. Database backup
echo "💾 Creating database backup..."
timestamp=$(date +%Y%m%d_%H%M%S)
pg_dump -U $DB_USER -h $DB_HOST -d almondyoung_wms > "backup_${timestamp}.sql"

# 3. Run migrations
echo "📊 Running database migrations..."
npm run db:push.wms

# 4. Deploy application
echo "🔧 Deploying application..."
pm2 stop almondyoung-wms || true
pm2 start dist/apps/wms/main.js --name almondyoung-wms

# 5. Health check
echo "🏥 Running health check..."
sleep 5
response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health)

if [ $response -eq 200 ]; then
    echo "✅ Deployment successful!"
else
    echo "❌ Health check failed, rolling back..."
    pm2 stop almondyoung-wms
    psql -U $DB_USER -h $DB_HOST -d almondyoung_wms < "backup_${timestamp}.sql"
    exit 1
fi

echo "🎉 Production deployment complete!"
```

#### ✅ Week 12 Final Checkpoint

- [ ] Deployment script tested on staging
- [ ] Production deployment successful
- [ ] Health checks passing
- [ ] Monitoring dashboards configured
- [ ] Documentation published

---

## Complete API Reference

### SKU Group Management APIs

#### Group CRUD
- `POST /wms/inventory/sku-groups` - Create SKU group
- `GET /wms/inventory/sku-groups` - List all groups
- `GET /wms/inventory/sku-groups/:id` - Get group detail
- `PUT /wms/inventory/sku-groups/:id` - Update group
- `DELETE /wms/inventory/sku-groups/:id` - Delete group

#### Group Membership
- `GET /wms/inventory/sku-groups/:id/members` - Get group members
- `POST /wms/inventory/sku-groups/:id/members` - Add SKU to group
- `POST /wms/inventory/sku-groups/:id/members/bulk` - Bulk add SKUs
- `DELETE /wms/inventory/sku-groups/members/:skuId` - Remove SKU from group
- `GET /wms/inventory/sku-groups/ungrouped/list` - Get ungrouped SKUs

### Inventory Management APIs

#### SKU CRUD
- `POST /wms/inventory/skus` - Create SKU
- `GET /wms/inventory/skus` - List SKUs
- `GET /wms/inventory/skus/:id` - Get SKU detail
- `PUT /wms/inventory/skus/:id` - Update SKU
- `DELETE /wms/inventory/skus/:id` - Delete SKU

#### Location Management
- `POST /wms/inventory/sku-location-movements/move` - Move SKU
- `POST /wms/inventory/sku-location-movements/bulk-move` - Bulk move
- `GET /wms/inventory/sku-location-movements/history/:skuId` - Movement history

#### Pricing & Managers
- `PUT /wms/inventory/skus/:id/pricing` - Update pricing
- `GET /wms/inventory/skus/:id/pricing` - Get pricing
- `PUT /wms/inventory/skus/:id/managers` - Update managers
- `GET /wms/inventory/skus/:id/managers` - Get managers

#### Search & Filtering
- `GET /wms/inventory/skus/search/advanced` - Advanced search
  - Supports: groupId, groupCode, isGrouped, inventoryMasterId
  - Removed: variantGroupCode (PIM concept)

### Inbound Management APIs

#### Purchase Orders
- `POST /wms/purchase-orders/:id/submit-for-audit` - Submit for audit
- `PUT /wms/purchase-orders/:id/approve` - Approve PO
- `PUT /wms/purchase-orders/:id/reject` - Reject PO

---

## Architectural Summary

### Clean Domain Separation Achieved

**WMS Domain (Warehouse Operations):**
- ✅ `inventoryProductMasters` - WMS-internal product organization
- ✅ `sku_groups` - Warehouse grouping (metadata labels)
- ✅ `skus` - Physical products (all rows are real products)
- ✅ `skuLocationMovements` - Physical movement tracking
- ✅ `stockEvents` / `stockSummary` - Inventory state

**PIM Domain (Product Catalog):**
- ✅ `product_masters` - Product catalog hierarchy
- ✅ `product_variants` - Sellable variants
- ✅ `productOptionGroups` / `productOptionValues` - Variant options

**Boundary:**
- ✅ String UUIDs only (no foreign keys across services)
- ✅ Used only for order matching
- ✅ Each service can operate independently

### Anti-Patterns Eliminated

| Anti-Pattern | Why Wrong | Fixed With |
|-------------|-----------|-----------|
| Parent SKU self-reference | Creates phantom products | `sku_groups` table |
| `variantGroupCode` in WMS | PIM concept leakage | Removed, use `groupCode` |
| `isOption` flag | Mixes physical and abstract | All SKUs are physical |
| `hasOptions` filter | Tied to parent SKU model | `isGrouped` filter |

---

## Conclusion

This revised implementation guide provides:

✅ **Week 6**: Location management and pricing/manager APIs
✅ **Week 7**: SKU Groups (WMS-internal organization) - Architecturally correct
✅ **Week 8**: Purchase order audit workflow
✅ **Week 9**: Advanced filtering with clean domain separation
✅ **Week 10**: Reporting and export features
✅ **Week 11**: Comprehensive testing strategy
✅ **Week 12**: Production deployment and monitoring

**Key Improvements:**
- ✅ Eliminated parent SKU anti-pattern
- ✅ Introduced `sku_groups` for warehouse organization
- ✅ Removed PIM concept leakage (`variantGroupCode`)
- ✅ Clean domain boundaries (WMS ↔ PIM)
- ✅ All SKUs represent physical products
- ✅ Flexible grouping without cascade issues

**Total Implementation Timeline:** 10-12 weeks
**Estimated Effort:** 53-67 developer days
**Test Coverage Target:** ≥ 80%

**Next Steps:**
1. Review architectural changes with team
2. Begin schema migration for Week 7 (sku_groups)
3. Update existing code to use new grouping pattern
4. Schedule checkpoints with frontend team

**Questions or Issues?**
- Refer to source analysis documents in `docs/figma-comparison/`
- Consult main `IMPLEMENTATION_GUIDE.md` for Phase 1 details
- Review schema definitions in `apps/wms/database/schemas/wms-schema.ts`

**Good luck with your clean, domain-focused implementation! 🚀**
