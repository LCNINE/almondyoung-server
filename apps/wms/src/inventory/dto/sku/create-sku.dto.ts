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

    @ApiProperty({ description: '안전 재고 (Safety stock)', example: 10, required: false, default: 0, minimum: 0 })
    @IsNumber()
    @IsOptional()
    safetyStock?: number;

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

    // ===== Phase 2 Step 4: Extended Metadata Fields =====

    // 기본 정보 확장
    @ApiProperty({ description: '사업자용 상품명', required: false })
    @IsString()
    @IsOptional()
    businessProductName?: string;

    @ApiProperty({ description: '수입신고번호', required: false })
    @IsString()
    @IsOptional()
    importDeclarationNumber?: string;

    @ApiProperty({ description: '물류 파트너 ID', required: false })
    @IsUUID()
    @IsOptional()
    logisticsPartnerId?: string;

    @ApiProperty({ description: '할인 정보', required: false })
    @IsString()
    @IsOptional()
    discount?: string;

    @ApiProperty({ description: '제조사 등급', required: false })
    @IsString()
    @IsOptional()
    manufacturerStar?: string;

    // 물리 속성
    @ApiProperty({ description: '상품 무게 (그램)', required: false, minimum: 0 })
    @IsNumber()
    @IsOptional()
    productWeight?: number;

    @ApiProperty({ description: '가로 (cm)', required: false, minimum: 0 })
    @IsNumber()
    @IsOptional()
    dimensionWidth?: number;

    @ApiProperty({ description: '세로 (cm)', required: false, minimum: 0 })
    @IsNumber()
    @IsOptional()
    dimensionHeight?: number;

    @ApiProperty({ description: '높이 (cm)', required: false, minimum: 0 })
    @IsNumber()
    @IsOptional()
    dimensionDepth?: number;

    @ApiProperty({ description: '상품 소재', required: false })
    @IsString()
    @IsOptional()
    productMaterial?: string;

    // 추가 메타데이터
    @ApiProperty({ description: '한글 상품명', required: false })
    @IsString()
    @IsOptional()
    koreanName?: string;

    @ApiProperty({ description: '최대 할인 수량', required: false, minimum: 0 })
    @IsNumber()
    @IsOptional()
    maxDiscountQuantity?: number;

    @ApiProperty({ description: '포장 수입자명', required: false })
    @IsString()
    @IsOptional()
    packagingImporterName?: string;

    // 판매 정보
    @ApiProperty({ description: '상품 설명', required: false })
    @IsString()
    @IsOptional()
    productDescription?: string;

    @ApiProperty({ description: 'MOQ (최소 주문 수량)', required: false, minimum: 1 })
    @IsNumber()
    @IsOptional()
    moq?: number;

    @ApiProperty({ description: '메모 2', required: false })
    @IsString()
    @IsOptional()
    memo2?: string;

    @ApiProperty({ description: '메모 3', required: false })
    @IsString()
    @IsOptional()
    memo3?: string;

    // 이미지 관리
    @ApiProperty({ description: '메인 이미지 URL', required: false })
    @IsString()
    @IsOptional()
    mainImageUrl?: string;

    @ApiProperty({ description: '현재 재고 (계산/캐시)', required: false, default: 0 })
    @IsNumber()
    @IsOptional()
    currentStock?: number;

    // 유효기간 및 날짜 관리
    @ApiProperty({ description: '유효기간 관리 여부', required: false, default: false })
    @IsOptional()
    expiryDateManagement?: boolean;

    @ApiProperty({ description: '유효기간 시작일', required: false })
    @IsOptional()
    expiryStartDate?: Date;

    @ApiProperty({ description: '유효기간 종료일', required: false })
    @IsOptional()
    expiryEndDate?: Date;

    @ApiProperty({ description: '제조일 관리 여부', required: false, default: false })
    @IsOptional()
    manufacturingDateManagement?: boolean;

    @ApiProperty({ description: '일반 재고 여부', required: false, default: true })
    @IsOptional()
    isGeneralInventory?: boolean;

    @ApiProperty({ description: '유효 시작일', required: false })
    @IsOptional()
    validityStartDate?: Date;

    @ApiProperty({ description: '유효 종료일', required: false })
    @IsOptional()
    validityEndDate?: Date;

    // 로케이션 추적
    @ApiProperty({ description: '주 보관 위치 ID', required: false })
    @IsUUID()
    @IsOptional()
    primaryLocationId?: string;

    @ApiProperty({ description: '보조 보관 위치 ID', required: false })
    @IsUUID()
    @IsOptional()
    secondaryLocationId?: string;

    // 옵션 그룹
    @ApiProperty({ description: '변형 그룹 코드', required: false })
    @IsString()
    @IsOptional()
    variantGroupCode?: string;
}