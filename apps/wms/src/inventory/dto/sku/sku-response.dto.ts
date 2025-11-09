import { ApiProperty } from '@nestjs/swagger';

export class BarcodeDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    barcode: string;

    @ApiProperty()
    barcodeType: string;

    @ApiProperty({ required: false })
    packingUnit?: string;
}

export class SkuResponseDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    name: string;

    @ApiProperty()
    code: string;

    @ApiProperty({ required: false })
    defaultBarcode?: string;

    @ApiProperty({ required: false })
    deliveryProfileId?: string;


    @ApiProperty({ required: false })
    sale1m?: number;

    @ApiProperty({ required: false })
    sale3m?: number;

    @ApiProperty({ description: '안전 재고 (Safety stock)', example: 10, default: 0 })
    safetyStock: number;

    @ApiProperty({ required: true })
    masterId: string;

    @ApiProperty({
        required: false,
        type: String,
        description: '옵션 식별자',
        example: "M / 흰색",
        nullable: true
    })
    optionKey?: string | null;

    @ApiProperty({ required: false, type: Object })
    master?: {
        id: string;
        name: string;
        code: string;
        hasOptions: boolean;
    };

    @ApiProperty({ type: [BarcodeDto] })
    barcodes: BarcodeDto[];

    @ApiProperty({ type: [String] })
    supplierNames: string[];

    @ApiProperty({ type: [String] })
    categoryNames: string[];

    // ===== Phase 2 Step 4: Extended Metadata Fields =====

    // 기본 정보 확장
    @ApiProperty({ required: false })
    businessProductName?: string;

    @ApiProperty({ required: false })
    importDeclarationNumber?: string;

    @ApiProperty({ required: false })
    logisticsPartnerId?: string;

    @ApiProperty({ required: false })
    discount?: string;

    @ApiProperty({ required: false })
    manufacturerStar?: string;

    // 물리 속성
    @ApiProperty({ required: false })
    productWeight?: number;

    @ApiProperty({ required: false })
    dimensionWidth?: number;

    @ApiProperty({ required: false })
    dimensionHeight?: number;

    @ApiProperty({ required: false })
    dimensionDepth?: number;

    @ApiProperty({ required: false })
    productMaterial?: string;

    // 추가 메타데이터
    @ApiProperty({ required: false })
    koreanName?: string;

    @ApiProperty({ required: false })
    maxDiscountQuantity?: number;

    @ApiProperty({ required: false })
    packagingImporterName?: string;

    // 판매 정보
    @ApiProperty({ required: false })
    productDescription?: string;

    @ApiProperty({ required: false })
    moq?: number;

    @ApiProperty({ required: false })
    memo2?: string;

    @ApiProperty({ required: false })
    memo3?: string;

    // 이미지 관리
    @ApiProperty({ required: false })
    mainImageUrl?: string;

    @ApiProperty({ required: false, default: 0 })
    currentStock?: number;

    // 유효기간 및 날짜 관리
    @ApiProperty({ required: false, default: false })
    expiryDateManagement?: boolean;

    @ApiProperty({ required: false })
    expiryStartDate?: Date;

    @ApiProperty({ required: false })
    expiryEndDate?: Date;

    @ApiProperty({ required: false, default: false })
    manufacturingDateManagement?: boolean;

    @ApiProperty({ required: false, default: true })
    isGeneralInventory?: boolean;

    @ApiProperty({ required: false })
    validityStartDate?: Date;

    @ApiProperty({ required: false })
    validityEndDate?: Date;

    // 로케이션 추적
    @ApiProperty({ required: false })
    primaryLocationId?: string;

    @ApiProperty({ required: false })
    secondaryLocationId?: string;

    // 옵션 그룹
    @ApiProperty({ required: false })
    variantGroupCode?: string;

    @ApiProperty()
    createdAt: Date;

    @ApiProperty()
    updatedAt: Date;
}