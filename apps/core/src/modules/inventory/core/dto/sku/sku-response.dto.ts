import { ApiProperty } from '@nestjs/swagger';
import { SkuGroupDto, SkuGroupResponseDto } from '../sku-groups/sku-group-response.dto';
import { SkuImageDto } from './sku-image.dto';

export class SupplierInfoDto {
  @ApiProperty({ description: 'Supplier ID' })
  id: string;

  @ApiProperty({ description: 'Supplier name' })
  name: string;
}

export class BarcodeDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  barcode: string;

  @ApiProperty({ description: 'Whether this is the primary barcode (synced with SKU code)' })
  isPrimary: boolean;

  @ApiProperty({ required: false, nullable: true })
  packingUnit?: string | null;
}

export class SkuResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  code: string;

  @ApiProperty({ required: false, nullable: true })
  deliveryProfileId?: string | null;

  @ApiProperty({
    description: '재고 유형',
    enum: ['physical', 'infinite', 'drop_shipped', 'consignment'],
    default: 'physical',
  })
  stockType: 'physical' | 'infinite' | 'drop_shipped' | 'consignment';

  @ApiProperty({ required: false, nullable: true })
  sale1m?: number | null;

  @ApiProperty({ required: false, nullable: true })
  sale3m?: number | null;

  @ApiProperty({ description: '안전 재고 (Safety stock)', example: 10, default: 0 })
  safetyStock: number;

  @ApiProperty({ required: false, nullable: true })
  groupId?: string | null;

  @ApiProperty({
    required: false,
    type: String,
    description: '옵션 식별자',
    example: 'M / 흰색',
    nullable: true,
  })
  optionKey?: string | null;

  @ApiProperty({ required: false, type: SkuGroupDto, nullable: true })
  skuGroup?: SkuGroupDto | null;

  @ApiProperty({ type: [BarcodeDto] })
  barcodes: BarcodeDto[];

  @ApiProperty({ type: [SupplierInfoDto], description: 'Supplier information (ID and name)' })
  suppliers: SupplierInfoDto[];

  @ApiProperty({ type: [String] })
  categoryNames: string[];

  // ===== Phase 2 Step 4: Extended Metadata Fields =====

  // 기본 정보 확장
  @ApiProperty({ required: false, nullable: true })
  businessProductName?: string | null;

  @ApiProperty({ required: false, nullable: true })
  importDeclarationNumber?: string | null;

  @ApiProperty({ required: false, nullable: true })
  logisticsPartnerId?: string | null;

  @ApiProperty({ required: false, nullable: true })
  discount?: string | null;

  @ApiProperty({ required: false, nullable: true })
  manufacturerStar?: string | null;

  // 물리 속성
  @ApiProperty({ required: false, nullable: true })
  productWeight?: number | null;

  @ApiProperty({ required: false, nullable: true })
  dimensionWidth?: number | null;

  @ApiProperty({ required: false, nullable: true })
  dimensionHeight?: number | null;

  @ApiProperty({ required: false, nullable: true })
  dimensionDepth?: number | null;

  @ApiProperty({ required: false, nullable: true })
  productMaterial?: string | null;

  // 추가 메타데이터
  @ApiProperty({ required: false, nullable: true })
  koreanName?: string | null;

  @ApiProperty({ required: false, nullable: true })
  maxDiscountQuantity?: number | null;

  @ApiProperty({ required: false, nullable: true })
  packagingImporterName?: string | null;

  // 판매 정보
  @ApiProperty({ required: false, nullable: true })
  productDescription?: string | null;

  @ApiProperty({ required: false, nullable: true })
  moq?: number | null;

  @ApiProperty({ required: false, nullable: true })
  memo2?: string | null;

  @ApiProperty({ required: false, nullable: true })
  memo3?: string | null;

  // 이미지 관리
  @ApiProperty({ required: false, nullable: true, deprecated: true })
  mainImageUrl?: string | null;

  @ApiProperty({
    description: 'SKU images',
    type: [SkuImageDto],
    required: false,
  })
  images?: SkuImageDto[];

  @ApiProperty({ required: false, default: 0 })
  currentStock?: number | null;

  // 유효기간 및 날짜 관리
  @ApiProperty({ required: false, default: false })
  expiryDateManagement: boolean;

  @ApiProperty({ required: false, nullable: true })
  expiryStartDate?: Date | null;

  @ApiProperty({ required: false, nullable: true })
  expiryEndDate?: Date | null;

  @ApiProperty({ required: false, default: false })
  manufacturingDateManagement: boolean;

  @ApiProperty({ required: false, default: true })
  isGeneralInventory: boolean;

  @ApiProperty({ required: false, nullable: true })
  validityStartDate?: Date | null;

  @ApiProperty({ required: false, nullable: true })
  validityEndDate?: Date | null;

  // 로케이션 추적
  @ApiProperty({ required: false, nullable: true })
  primaryLocationId?: string | null;

  @ApiProperty({ required: false, nullable: true })
  secondaryLocationId?: string | null;

  // 옵션 그룹
  @ApiProperty({ required: false, nullable: true })
  variantGroupCode?: string | null;

  @ApiProperty({ description: '삭제 여부', example: false })
  isDeleted: boolean;

  @ApiProperty({ description: '삭제 시각', nullable: true, required: false })
  deletedAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
