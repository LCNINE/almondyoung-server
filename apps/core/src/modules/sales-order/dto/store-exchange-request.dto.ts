import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class StoreCreateExchangeRequestLineDto {
  @ApiProperty({ description: '판매 주문 라인 ID' })
  @IsString()
  @IsNotEmpty()
  salesOrderLineId: string;

  @ApiProperty({ description: '교환 수량', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({ description: '교환 희망 상품 변형 ID' })
  @IsOptional()
  @IsString()
  desiredVariantId?: string;
}

const EXCHANGE_REASON_CODES = [
  'defective',
  'not_as_described',
  'change_of_mind',
  'wrong_item',
  'damaged_in_shipping',
  'other',
] as const;

export type ExchangeReasonCode = (typeof EXCHANGE_REASON_CODES)[number];

export class StoreCreateExchangeRequestDto {
  @ApiProperty({
    description: '교환 요청 라인 목록',
    type: [StoreCreateExchangeRequestLineDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StoreCreateExchangeRequestLineDto)
  lines: StoreCreateExchangeRequestLineDto[];

  @ApiProperty({
    description: '교환 사유 코드',
    enum: EXCHANGE_REASON_CODES,
  })
  @IsIn(EXCHANGE_REASON_CODES)
  reasonCode: ExchangeReasonCode;

  @ApiPropertyOptional({ description: '교환 사유 상세 설명', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonDetail?: string;
}

export class StoreExchangeRequestItemDto {
  @ApiProperty({ description: '판매 주문 라인 ID' })
  salesOrderLineId: string;

  @ApiProperty({ description: '교환 수량' })
  quantity: number;

  @ApiPropertyOptional({ description: '교환 희망 상품 변형 ID' })
  desiredVariantId?: string;
}

export class StoreExchangeRequestResponseDto {
  @ApiProperty({ description: '교환 요청 ID' })
  id: string;

  @ApiProperty({ description: '판매 주문 ID' })
  salesOrderId: string;

  @ApiProperty({ description: '교환 요청 상태' })
  status: string;

  @ApiProperty({ description: '교환 사유 코드', enum: EXCHANGE_REASON_CODES })
  reasonCode: ExchangeReasonCode;

  @ApiPropertyOptional({ description: '교환 사유 상세 설명' })
  reasonDetail?: string;

  @ApiProperty({ description: '교환 요청 라인 목록', type: [StoreExchangeRequestItemDto] })
  items: StoreExchangeRequestItemDto[];

  @ApiProperty({ description: '생성 일시' })
  createdAt: Date;
}
