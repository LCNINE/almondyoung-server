import { Equals, IsInt, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WarehouseOperationDto } from '../../core/services/warehouse-operation-contract';

export class ResetCountDto extends WarehouseOperationDto {
  @Equals(2)
  declare contractVersion: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision: number;
}
