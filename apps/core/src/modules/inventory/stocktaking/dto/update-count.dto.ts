import { WarehouseOperationDto } from '../../core/services/warehouse-operation-contract';
import { IsInt, Min, IsOptional, IsString, ValidateIf, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCountDto extends WarehouseOperationDto {
  @ApiProperty({ required: false })
  @ValidateIf((object) => object.contractVersion === 2)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision?: number;

  @ApiProperty({ description: 'Counted quantity', minimum: 0 })
  @IsInt()
  @Min(0)
  countedQuantity: number;

  @ApiProperty({ description: 'Notes', required: false })
  @IsString()
  @IsOptional()
  notes?: string;
}
