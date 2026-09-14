import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, ValidateIf } from 'class-validator';
import { WarehouseOperationDto } from '../../core/services/warehouse-operation-contract';

export class CompleteSessionDto extends WarehouseOperationDto {
  @ApiProperty({ required: false })
  @ValidateIf((object) => object.contractVersion === 2)
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  previewToken?: string;
}
