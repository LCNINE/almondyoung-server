import { IsString, IsNotEmpty, IsOptional, IsUUID, IsNumber, IsEnum, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum SkuCreationSource {
    AUTO_MATCHING = 'auto_matching',
    MANUAL_MATCHING = 'manual_matching',
    MANUAL_ENTRY = 'manual_entry',
}

export class CreateSkuDto {
    @ApiProperty({ description: '기존 마스터 ID (지정 시 사용)', required: false })
    @IsUUID()
    @IsOptional()
    masterId?: string;

    @ApiProperty({ description: '새 마스터 이름 (masterId 미지정 시 자동 생성용)', required: false })
    @IsString()
    @IsOptional()
    masterName?: string;

    @ApiProperty({ description: 'SKU 이름 (수동 매칭 시 직접 입력, 자동 매칭 시 PIM 정보로 자동 생성)' })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiProperty({ description: '옵션 조합 키 (예: {"색상":"퍼플","용량":"256GB"})', required: false, type: Object })
    @IsOptional()
    optionKey?: Record<string, string>;

    @ApiProperty({ description: 'SKU 생성 맥락', enum: SkuCreationSource, required: false })
    @IsEnum(SkuCreationSource)
    @IsOptional()
    source?: SkuCreationSource;

    @ApiProperty({ description: 'PIM 상품 이름 (자동 매칭 시 SKU 이름 생성에 사용)', required: false })
    @IsString()
    @IsOptional()
    productName?: string;

    @ApiProperty({ description: 'PIM Variant 이름 (자동 매칭 시 SKU 이름 생성에 사용)', required: false })
    @IsString()
    @IsOptional()
    variantName?: string;

    @ApiProperty({ description: '배송 프로필 ID', example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef', required: false })
    @IsUUID()
    @IsOptional()
    deliveryProfileId?: string;

    // 재고 정책 필드들 제거 (이제 product_matchings에서 관리)
    // @ApiProperty({ description: '재고 관리 여부 (true: 물리 재고, false: 디지털/무한 재고 등)', example: true })
    // @IsBoolean()
    // inventoryManagement: boolean;

    // @ApiProperty({ description: '재고 0이어도 항상 판매 가능한 상품 여부 (직배/신상품 등)', required: false, default: false })
    // @IsBoolean()
    // @IsOptional()
    // alwaysSellableZeroStock?: boolean;

    @ApiProperty({ description: '최근 1개월 판매량', example: 100, required: false })
    @IsNumber()
    @IsOptional()
    sale1m?: number;

    @ApiProperty({ description: '최근 3개월 판매량', example: 250, required: false })
    @IsNumber()
    @IsOptional()
    sale3m?: number;

    @ApiProperty({ description: '공급사 ID 목록', type: [String], required: false })
    @IsArray()
    @IsUUID('4', { each: true })
    @IsOptional()
    supplierIds?: string[];

    @ApiProperty({ description: '카테고리 ID 목록', type: [String], required: false })
    @IsArray()
    @IsUUID('4', { each: true })
    @IsOptional()
    categoryIds?: string[];
}