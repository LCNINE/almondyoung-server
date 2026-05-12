import { IsArray, ValidateNested, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CreateSkuLocationMovementDto } from './create-sku-location-movement.dto';

export class BulkMoveSkuLocationDto {
  @ApiProperty({
    description: 'Array of SKU movement records to process',
    type: [CreateSkuLocationMovementDto],
    minItems: 1,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSkuLocationMovementDto)
  movements: CreateSkuLocationMovementDto[];
}

export class BulkMoveResultDto {
  @ApiProperty({ description: 'Total number of movements attempted' })
  total: number;

  @ApiProperty({ description: 'Number of successful movements' })
  successCount: number;

  @ApiProperty({ description: 'Number of failed movements' })
  failCount: number;

  @ApiProperty({ description: 'Overall operation success status' })
  success: boolean;

  @ApiProperty({
    description: 'Individual movement results',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        skuId: { type: 'string' },
        movementId: { type: 'string' },
        error: { type: 'string' },
      },
    },
  })
  results: Array<{
    success: boolean;
    skuId?: string;
    movementId?: string;
    error?: string;
  }>;
}
