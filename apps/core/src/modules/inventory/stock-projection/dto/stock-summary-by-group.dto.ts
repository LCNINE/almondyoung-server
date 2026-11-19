import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../shared/dto';

// 기본 창고 UUID도 허용한다 — IsUUID는 version/variant 니블이 없는 기존 ID를 거부한다.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STOCK_QUEUES = ['unshipped', 'shortage', 'below_safety_stock', 'out_of_stock'];

export class GetStockSummaryByGroupQueryDto extends PaginationQueryDto {
  @ApiProperty({ description: '창고 ID', required: false })
  @IsOptional()
  @Matches(UUID_PATTERN)
  warehouseId?: string;

  @ApiProperty({ description: '공급사 ID (sku_suppliers)', required: false })
  @IsOptional()
  @Matches(UUID_PATTERN)
  supplierId?: string;

  @ApiProperty({ description: 'SKU 이름·코드·활성 상품명 부분 검색', required: false })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ description: '하나 이상의 SKU 행이 해당하는 상품 그룹', required: false, enum: STOCK_QUEUES })
  @IsOptional()
  @IsIn(STOCK_QUEUES)
  queue?: 'unshipped' | 'shortage' | 'below_safety_stock' | 'out_of_stock';
}

export class StockSummaryGroupSkuDto {
  @ApiProperty()
  skuId: string;

  @ApiProperty()
  skuName: string;

  @ApiProperty()
  skuCode: string;

  @ApiProperty()
  warehouseId: string;

  @ApiProperty()
  warehouseName: string;

  @ApiProperty({ type: String, nullable: true })
  shelfPosition: string | null;

  @ApiProperty({ description: 'onHand + defective + inTransfer + returned' })
  currentQuantity: number;

  @ApiProperty({ description: '정상 재고(ON_HAND) — 부족·가용 계산의 기준' })
  onHandQuantity: number;

  @ApiProperty({ description: '가용 = 정상 재고 − 미발송 (셀메이트와 같은 식, 음수 가능)' })
  availableQuantity: number;

  @ApiProperty({ description: 'FOI 주문 수량 − 출고 수량 − 취소 수량의 양수 합계' })
  unshippedQuantity: number;

  @ApiProperty({ description: 'max(미출고 − 정상 재고(ON_HAND), 0)' })
  shortageQuantity: number;

  @ApiProperty({ type: Number, nullable: true, description: '보충 SKU override의 안전재고' })
  safetyStock: number | null;

  @ApiProperty()
  belowSafetyStock: boolean;
}

export class StockSummaryGroupDto {
  @ApiProperty({ type: String, nullable: true })
  groupId: string | null;

  @ApiProperty()
  groupName: string;

  @ApiProperty({ type: String, nullable: true })
  groupCode: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '쇼핑몰 상품(PIM) 대표 이미지 file-service fileId — 그룹 옵션 중 매칭된 활성 상품의 대표 이미지',
  })
  imageFileId: string | null;

  @ApiProperty({ type: [StockSummaryGroupSkuDto] })
  skus: StockSummaryGroupSkuDto[];
}

export class StockSummaryCountsDto {
  @ApiProperty({ description: '미발송이 있는 상품(그룹) 수' })
  unshippedProducts: number;

  @ApiProperty({ description: '부족 수량 합계' })
  shortageQuantity: number;

  @ApiProperty({ description: '부족한 옵션 수' })
  shortageOptions: number;

  @ApiProperty({ description: '안정재고 미만 옵션 수' })
  belowSafetyOptions: number;

  @ApiProperty({ description: '가용재고(정상 재고 − 미발송)가 0 이하인 옵션 수' })
  emptyOptions: number;
}

export class StockSummaryByGroupResponseDto {
  @ApiProperty({ type: [StockSummaryGroupDto] })
  data: StockSummaryGroupDto[];

  @ApiProperty({ description: '그룹 수' })
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty({ type: StockSummaryCountsDto, description: '큐와 상관없는 요약 카드 숫자' })
  summary: StockSummaryCountsDto;
}
