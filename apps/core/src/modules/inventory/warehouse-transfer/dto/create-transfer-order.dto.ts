import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsInt, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';

export class CreateTransferOrderLineDto {
  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  skuId: string;

  @ApiProperty({ description: '출발 로케이션 ID' })
  @IsUUID()
  fromLocationId: string;

  @ApiProperty({ description: '이동 수량', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateTransferOrderDto {
  @ApiProperty({ description: '출발 창고 ID' })
  @IsUUID()
  fromWarehouseId: string;

  @ApiProperty({ description: '도착 창고 ID' })
  @IsUUID()
  toWarehouseId: string;

  @ApiPropertyOptional({ description: '도착 예정일 (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  eta?: string;

  @ApiPropertyOptional({ description: '메모' })
  @IsOptional()
  @IsString()
  memo?: string;

  @ApiPropertyOptional({ description: '작업자 ID' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiProperty({ description: '이동 라인', type: [CreateTransferOrderLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTransferOrderLineDto)
  lines: CreateTransferOrderLineDto[];
}
