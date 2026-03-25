import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ReturnStatusEnum, returnStatusValues } from 'apps/wms/database/schemas/enum-values';

export class ReturnFiltersDto {
  @ApiProperty({
    description: '창고 ID (선택적)',
    required: false,
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @ApiProperty({
    description: '반품 상태 (선택적)',
    required: false,
    enum: returnStatusValues,
    example: 'received',
  })
  @IsOptional()
  @IsEnum(returnStatusValues)
  status?: ReturnStatusEnum;

  @ApiProperty({
    description: '주문 ID (선택적)',
    required: false,
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiProperty({
    description: '페이지 크기',
    required: false,
    minimum: 1,
    maximum: 100,
    default: 50,
    example: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @ApiProperty({
    description: '오프셋',
    required: false,
    minimum: 0,
    default: 0,
    example: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
