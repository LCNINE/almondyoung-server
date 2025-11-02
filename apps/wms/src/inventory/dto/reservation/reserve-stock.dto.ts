import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, IsOptional, IsEnum, IsDateString, Min, IsBoolean, IsArray } from 'class-validator';

export enum ReservationTargetType {
  FULFILLMENT_ORDER = 'FULFILLMENT_ORDER',
  MOVEMENT_TASK = 'MOVEMENT_TASK',
}

export class ReserveStockDto {
  @ApiProperty({
    description: '예약 대상 타입',
    enum: ['FULFILLMENT_ORDER', 'MOVEMENT_TASK'],
    example: 'FULFILLMENT_ORDER',
  })
  @IsEnum(ReservationTargetType)
  targetType: 'FULFILLMENT_ORDER' | 'MOVEMENT_TASK';

  @ApiProperty({
    description: '예약 대상 ID (FO ID 또는 Movement Task ID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  targetId: string;

  @ApiProperty({
    description: 'SKU ID',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsString()
  skuId: string;

  @ApiProperty({
    description: '창고 ID',
    example: '550e8400-e29b-41d4-a716-446655440002',
  })
  @IsString()
  warehouseId: string;

  @ApiProperty({
    description: '예약 수량',
    example: 10,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({
    description: 'Fulfillment Order Item ID (FO 예약시 필요)',
    example: '550e8400-e29b-41d4-a716-446655440003',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  fulfillmentOrderItemId?: string;

  @ApiProperty({
    description: '예약 만료 시간 (ISO 8601 형식)',
    example: '2025-10-21T10:00:00Z',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  timeoutAt?: string;

  @ApiProperty({
    description: '예약 사유',
    example: 'Customer order reservation',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class AllocateStockDto {
  @ApiProperty({
    description: 'SKU ID',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsString()
  skuId: string;

  @ApiProperty({
    description: '요청 수량',
    example: 50,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  requestedQuantity: number;

  @ApiProperty({
    description: '창고 ID (선택적)',
    example: '550e8400-e29b-41d4-a716-446655440002',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @ApiProperty({
    description: '선호 위치 ID 목록 (선택적)',
    example: ['550e8400-e29b-41d4-a716-446655440010', '550e8400-e29b-41d4-a716-446655440011'],
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferredLocationIds?: string[];

  @ApiProperty({
    description: '할당 전략',
    enum: ['FIFO', 'LOCATION_PRIORITY', 'MULTI_WAREHOUSE', 'CLOSEST_EXPIRY'],
    example: 'FIFO',
    required: false,
  })
  @IsOptional()
  @IsEnum(['FIFO', 'LOCATION_PRIORITY', 'MULTI_WAREHOUSE', 'CLOSEST_EXPIRY'])
  strategy?: 'FIFO' | 'LOCATION_PRIORITY' | 'MULTI_WAREHOUSE' | 'CLOSEST_EXPIRY';

  @ApiProperty({
    description: '부분 할당 허용 여부',
    example: true,
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  allowPartial?: boolean;
}

export class ReleaseReservationDto {
  @ApiProperty({
    description: '예약 해제 사유',
    example: 'Order cancelled',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  reason?: string;
}


