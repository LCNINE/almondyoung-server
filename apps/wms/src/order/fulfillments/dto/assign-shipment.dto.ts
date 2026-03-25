import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsDateString, IsOptional } from 'class-validator';

export class AssignShipmentDto {
  @ApiProperty({ description: 'Tracking number' })
  @IsString()
  @IsNotEmpty()
  trackingNo: string;

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
