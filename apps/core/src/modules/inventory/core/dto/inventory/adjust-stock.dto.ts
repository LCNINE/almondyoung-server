import { IsUUID, IsNotEmpty, IsInt, Min, Max, NotEquals, IsString, IsOptional, MaxLength } from 'class-validator';
import { WarehouseOperationDto } from '../../services/warehouse-operation-contract';
import { ApiProperty } from '@nestjs/swagger';

export class AdjustStockDto extends WarehouseOperationDto {
  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  @IsNotEmpty()
  skuId: string;

  @ApiProperty({ description: '창고 ID' })
  @IsUUID()
  @IsNotEmpty()
  warehouseId: string;

  @ApiProperty({ description: '위치 ID', required: false })
  @IsUUID()
  @IsOptional()
  locationId?: string;

  @ApiProperty({ description: '변경할 수량(양수=가산, 음수=감산)' })
  @IsInt()
  @Min(-Number.MAX_SAFE_INTEGER)
  @Max(Number.MAX_SAFE_INTEGER)
  @NotEquals(0)
  @IsNotEmpty()
  delta: number;

  @ApiProperty({ description: '조정 사유' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
