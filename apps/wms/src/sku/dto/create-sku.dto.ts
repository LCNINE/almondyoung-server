// apps/wms/src/sku/dto/create-sku.dto.ts
import { IsString, IsNotEmpty, IsBoolean, IsOptional, IsUUID, IsNumber, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// SKU 생성의 맥락을 정의하는 Enum
export enum SkuCreationSource {
    AUTO_MATCHING = 'auto_matching',
    MANUAL_MATCHING = 'manual_matching',
    MANUAL_ENTRY = "MANUAL_ENTRY",
}

export class CreateSkuDto {

    @ApiProperty({ description: 'SKU 이름 (수동 매칭 시 직접 입력, 자동 매칭 시 PIM 정보로 자동 생성)', })
    @IsString()
    @IsNotEmpty()
    name: string; // 수동 매칭 시 직접 입력받을 이름

    @ApiProperty({ description: 'SKU 생성 맥락', enum: SkuCreationSource, required: false })
    @IsEnum(SkuCreationSource)
    @IsOptional()
    source?: SkuCreationSource; // SKU 생성의 맥락 (자동 매칭, 수동 매칭)

    @ApiProperty({ description: 'PIM 상품 이름 (자동 매칭 시 SKU 이름 생성에 사용)', required: false })
    @IsString()
    @IsOptional()
    productName?: string; // 자동 매칭 시 SKU 이름 생성에 사용

    @ApiProperty({ description: 'PIM Variant 이름 (자동 매칭 시 SKU 이름 생성에 사용)', required: false })
    @IsString()
    @IsOptional()
    variantName?: string; // 자동 매칭 시 SKU 이름 생성에 사용

    @ApiProperty({ description: '배송 프로필 ID', example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef', required: false })
    @IsUUID()
    @IsOptional()
    deliveryProfileId?: string;

    @ApiProperty({ description: '재고 관리 여부 (true: 물리 재고, false: 디지털/무한 재고 등)', example: false })
    @IsBoolean()
    inventoryManagement: boolean;

    @ApiProperty({ description: '재고 0이어도 항상 판매 가능한 상품 여부 (직배/신상품 등)', required: false })
    @IsBoolean()
    @IsOptional()
    alwaysSellableZeroStock?: boolean;
    @ApiProperty({ description: '최근 1개월 판매량', example: 100, required: false })
    @IsNumber()
    @IsOptional()
    sale1m?: number;

    @ApiProperty({ description: '최근 3개월 판매량', example: 250, required: false })
    @IsNumber()
    @IsOptional()
    sale3m?: number;
}