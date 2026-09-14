import { WarehouseOperationDto } from '../../core/services/warehouse-operation-contract';
import { IsNotEmpty, IsUUID, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ScanLocationDto extends WarehouseOperationDto {
  @ApiProperty({ description: 'Session ID' })
  @IsUUID()
  @IsNotEmpty()
  sessionId: string;

  @ApiProperty({ description: 'Location barcode or code', example: 'A-01-02' })
  @IsString()
  @IsNotEmpty()
  locationBarcode: string;
}
