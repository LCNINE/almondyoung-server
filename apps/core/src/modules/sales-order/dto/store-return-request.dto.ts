import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class StoreCreateReturnRequestLineDto {
  @ApiProperty({ description: '판매 주문 라인 ID' })
  @IsString()
  @IsNotEmpty()
  salesOrderLineId: string;

  @ApiProperty({ description: '반품 수량', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({ description: '라인별 사유 코드' })
  @IsOptional()
  @IsString()
  reasonCode?: string;
}

const RETURN_REASON_CODES = [
  'defective',
  'not_as_described',
  'change_of_mind',
  'wrong_item',
  'damaged_in_shipping',
  'other',
] as const;

export type ReturnReasonCode = (typeof RETURN_REASON_CODES)[number];

export class StoreCreateReturnRequestDto {
  @ApiProperty({
    description: '반품 요청 라인 목록',
    type: [StoreCreateReturnRequestLineDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StoreCreateReturnRequestLineDto)
  lines: StoreCreateReturnRequestLineDto[];

  @ApiProperty({
    description: '반품 사유 코드',
    enum: RETURN_REASON_CODES,
  })
  @IsIn(RETURN_REASON_CODES)
  reasonCode: ReturnReasonCode;

  @ApiPropertyOptional({ description: '반품 사유 상세 설명', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonDetail?: string;

  @ApiPropertyOptional({ description: '반품 수거 주소' })
  @IsOptional()
  @IsObject()
  returnAddress?: object;
}

export class StoreReturnRequestItemDto {
  @ApiProperty({ description: '판매 주문 라인 ID' })
  salesOrderLineId: string;

  @ApiProperty({ description: '반품 수량' })
  quantity: number;
}

export class StoreReturnRequestResponseDto {
  @ApiProperty({ description: '반품 요청 ID' })
  id: string;

  @ApiProperty({ description: '판매 주문 ID' })
  salesOrderId: string;

  @ApiProperty({ description: '반품 요청 상태' })
  status: string;

  @ApiProperty({ description: '반품 사유 코드', enum: RETURN_REASON_CODES })
  reasonCode: ReturnReasonCode;

  @ApiPropertyOptional({ description: '반품 사유 상세 설명' })
  reasonDetail?: string;

  @ApiProperty({ description: '반품 요청 라인 목록', type: [StoreReturnRequestItemDto] })
  items: StoreReturnRequestItemDto[];

  @ApiProperty({ description: '생성 일시' })
  createdAt: Date;
}

export class StoreOrderLineDto {
  @ApiProperty({ description: 'Core 판매 주문 라인 ID' })
  id: string;

  @ApiProperty({ description: '상품명' })
  productName: string;

  @ApiProperty({ description: '수량' })
  quantity: number;

  @ApiPropertyOptional({ description: '단가' })
  unitPrice?: number | null;

  @ApiPropertyOptional({ description: '총 가격' })
  totalPrice?: number | null;

  @ApiProperty({ description: '상품 변형 ID' })
  variantId: string;
}

export class StoreOrderLinesResponseDto {
  @ApiProperty({ description: 'Core 판매 주문 ID' })
  orderId: string;

  @ApiProperty({ description: '채널 주문 ID (Medusa order ID)' })
  channelOrderId: string;

  @ApiProperty({ description: '주문 상태' })
  orderStatus: string;

  @ApiProperty({ description: '주문 라인 목록', type: [StoreOrderLineDto] })
  lines: StoreOrderLineDto[];
}
