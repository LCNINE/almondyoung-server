import { WarehouseOperationDto } from '../../core/services/warehouse-operation-contract';
import { IsNotEmpty, IsUUID, IsString, IsInt, Min, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ScanProductDto extends WarehouseOperationDto {
  @ApiProperty({ description: 'Session ID' })
  @IsUUID()
  @IsNotEmpty()
  sessionId: string;

  @ApiProperty({ description: 'Location ID' })
  @IsUUID()
  @IsNotEmpty()
  locationId: string;

  @ApiProperty({ description: 'Product barcode' })
  @IsString()
  @IsNotEmpty()
  productBarcode: string;

  @ApiProperty({ description: 'Quantity scanned (default: 1)', required: false, minimum: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number = 1;
}
