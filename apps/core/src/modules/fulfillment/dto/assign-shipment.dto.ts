import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsDateString, IsOptional, IsIn } from 'class-validator';

const CARRIER_VALUES = ['CJ', 'HANJIN', 'LOTTE', 'LOGEN', 'KDEXP', 'CJGLS'] as const;

export class AssignShipmentDto {
  @ApiProperty({ description: '운송장 번호' })
  @IsString()
  @IsNotEmpty()
  trackingNo: string;

  @ApiPropertyOptional({ description: '택배사 코드', enum: CARRIER_VALUES })
  @IsIn(CARRIER_VALUES)
  @IsOptional()
  carrier?: typeof CARRIER_VALUES[number];

  @ApiProperty({
    description: 'Estimated time of arrival',
    required: false,
    type: String,
    format: 'date-time',
  })
  @IsDateString()
  @IsOptional()
  eta?: string;
}
