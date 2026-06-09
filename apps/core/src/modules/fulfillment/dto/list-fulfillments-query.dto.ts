import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListFulfillmentsQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiProperty({ required: false, enum: ['in_house', '3pl', 'drop_ship'] })
  @IsOptional()
  @IsEnum(['in_house', '3pl', 'drop_ship'])
  fulfillmentMode?: 'in_house' | '3pl' | 'drop_ship';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  salesOrderId?: string;

  @ApiProperty({ required: false, enum: ['normal', 'high', 'urgent'] })
  @IsOptional()
  @IsEnum(['normal', 'high', 'urgent'])
  priority?: 'normal' | 'high' | 'urgent';

  @ApiProperty({ required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
