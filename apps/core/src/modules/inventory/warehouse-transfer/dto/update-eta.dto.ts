import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class UpdateEtaDto {
  @ApiProperty({ description: '도착 예정일 (ISO 8601)' })
  @IsDateString()
  eta: string;
}
