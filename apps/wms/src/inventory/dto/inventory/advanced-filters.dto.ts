import {
    IsOptional,
    IsString,
    IsEnum,
    IsInt,
    Min,
    IsBoolean,
    IsDateString,
    IsUUID,
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
    @ApiProperty({
        description: 'SKU 이름/코드 검색 (Search by SKU name or code)',
        required: false,
        example: 'lash',
    })
    @IsString()
    @IsOptional()
    search?: string;

    // Stock display mode
    @ApiProperty({
        description: '재고 표시 모드 (Stock display mode)',
        enum: StockDisplayMode,
        required: false,
        example: StockDisplayMode.ALL,
    })
    @IsEnum(StockDisplayMode)
    @IsOptional()
    displayMode?: StockDisplayMode;

    // Supplier filter
    @ApiProperty({
        description: '공급처 ID (Supplier ID)',
        required: false,
        example: '550e8400-e29b-41d4-a716-446655440000',
    })
    @IsString()
    @IsOptional()
    supplierId?: string;

    // Location filters
    @ApiProperty({
        description: '창고 ID (Warehouse ID)',
        required: false,
        example: '550e8400-e29b-41d4-a716-446655440001',
    })
    @IsString()
    @IsOptional()
    warehouseId?: string;

    @ApiProperty({
        description: '위치 ID (Location ID)',
        required: false,
        example: '550e8400-e29b-41d4-a716-446655440002',
    })
    @IsString()
    @IsOptional()
    locationId?: string;

    // Date range
    @ApiProperty({
        description: '시작일 (Start date - YYYY-MM-DD)',
        required: false,
        example: '2025-01-01',
    })
    @IsDateString()
    @IsOptional()
    startDate?: string;

    @ApiProperty({
        description: '종료일 (End date - YYYY-MM-DD)',
        required: false,
        example: '2025-12-31',
    })
    @IsDateString()
    @IsOptional()
    endDate?: string;

    // Stock type
    @ApiProperty({
        description: '재고 유형 (Stock type)',
        required: false,
        example: 'normal',
    })
    @IsString()
    @IsOptional()
    stockType?: string;

    // Barcode search
    @ApiProperty({
        description: '바코드 검색 (Barcode search)',
        required: false,
        example: '8801234567890',
    })
    @IsString()
    @IsOptional()
    barcode?: string;

    // ===== WMS-INTERNAL GROUPING FILTERS =====

    @ApiProperty({
        description: 'SKU 그룹 ID (WMS-internal grouping)',
        required: false,
        example: '550e8400-e29b-41d4-a716-446655440003',
    })
    @IsUUID()
    @IsOptional()
    groupId?: string;

    @ApiProperty({
        description: 'SKU 그룹 코드 (WMS-internal grouping)',
        required: false,
        example: 'LASH-GROUP-001',
    })
    @IsString()
    @IsOptional()
    groupCode?: string;

    @ApiProperty({
        description: '그룹화된 SKU만 조회 (Filter by grouped status: true=has group, false=standalone)',
        required: false,
        example: true,
    })
    @IsBoolean()
    @IsOptional()
    @Type(() => Boolean)
    isGrouped?: boolean;

    // Pagination
    @ApiProperty({
        description: 'Page limit',
        default: 50,
        minimum: 1,
        maximum: 200,
        required: false,
        example: 50,
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
        required: false,
        example: 0,
    })
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @IsOptional()
    offset?: number = 0;

    // Sorting
    @ApiProperty({
        description: '정렬 필드 (Sort field)',
        enum: ['name', 'code', 'createdAt', 'updatedAt', 'safetyStock'],
        required: false,
        example: 'createdAt',
    })
    @IsString()
    @IsOptional()
    sortBy?: 'name' | 'code' | 'createdAt' | 'updatedAt' | 'safetyStock';

    @ApiProperty({
        description: '정렬 방향 (Sort order)',
        enum: ['asc', 'desc'],
        required: false,
        example: 'desc',
    })
    @IsEnum(['asc', 'desc'])
    @IsOptional()
    sortOrder?: 'asc' | 'desc';
}

