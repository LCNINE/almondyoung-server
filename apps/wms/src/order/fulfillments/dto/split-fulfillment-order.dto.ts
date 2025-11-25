import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsNotEmpty, IsArray, IsNumber, Min, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

export class SplitFulfillmentOrderLineDto {
  @ApiProperty({ description: 'Fulfillment Order Line ID' })
  @IsUUID()
  @IsNotEmpty()
  fulfillmentOrderLineId: string;

  @ApiProperty({ description: 'Quantity to split', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;
}

export class SplitFulfillmentOrderDto {
  @ApiProperty({ 
    description: 'Lines to split',
    type: [SplitFulfillmentOrderLineDto],
    minItems: 1
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SplitFulfillmentOrderLineDto)
  lines: SplitFulfillmentOrderLineDto[];
}

