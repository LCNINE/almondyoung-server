import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsInt, IsUUID, Max, Min } from 'class-validator';
import { WarehouseOperationDto } from '../../core/services/warehouse-operation-contract';

const POSTGRES_INTEGER_MAX = 2_147_483_647;

export class AddCountItemDto extends WarehouseOperationDto {
  @Equals(2)
  declare contractVersion: number;

  @ApiProperty({ description: 'Session ID' })
  @IsUUID()
  sessionId: string;

  @ApiProperty({ description: 'Location ID' })
  @IsUUID()
  locationId: string;

  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  skuId: string;

  @ApiProperty({ description: 'Counted total quantity', minimum: 0, maximum: POSTGRES_INTEGER_MAX })
  @IsInt()
  @Min(0)
  @Max(POSTGRES_INTEGER_MAX)
  countedQuantity: number;
}
