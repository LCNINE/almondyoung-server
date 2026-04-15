import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, IsOptional, IsArray, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class TransferItemDto {
  @ApiProperty({
    description: 'SKU ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  skuId: string;

  @ApiProperty({
    description: '출발 위치 ID',
    example: '550e8400-e29b-41d4-a716-446655440010',
  })
  @IsString()
  fromLocationId: string;

  @ApiProperty({
    description: '도착 위치 ID',
    example: '550e8400-e29b-41d4-a716-446655440020',
  })
  @IsString()
  toLocationId: string;

  @ApiProperty({
    description: '이동 수량',
    example: 10,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateTransferJobDto {
  @ApiProperty({
    description: '출발 창고 ID',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsString()
  fromWarehouseId: string;

  @ApiProperty({
    description: '도착 창고 ID',
    example: '550e8400-e29b-41d4-a716-446655440002',
  })
  @IsString()
  toWarehouseId: string;

  @ApiProperty({
    description: '이동 아이템 목록',
    type: [TransferItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransferItemDto)
  items: TransferItemDto[];

  @ApiProperty({
    description: '작업자 ID',
    example: '550e8400-e29b-41d4-a716-446655440100',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiProperty({
    description: '메모',
    example: 'Regular stock rebalancing',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  memo?: string;
}

export class ExecuteTransferJobDto {
  @ApiProperty({
    description: '이동 작업 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  jobId: string;
}

export class MoveWithinWarehouseDto {
  @ApiProperty({
    description: 'SKU ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  skuId: string;

  @ApiProperty({
    description: '창고 ID',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsString()
  warehouseId: string;

  @ApiProperty({
    description: '출발 위치 ID',
    example: '550e8400-e29b-41d4-a716-446655440010',
  })
  @IsString()
  fromLocationId: string;

  @ApiProperty({
    description: '도착 위치 ID',
    example: '550e8400-e29b-41d4-a716-446655440020',
  })
  @IsString()
  toLocationId: string;

  @ApiProperty({
    description: '이동 수량',
    example: 10,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({
    description: '작업자 ID',
    example: '550e8400-e29b-41d4-a716-446655440100',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiProperty({
    description: '메모',
    example: 'Move to better location',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  memo?: string;
}
