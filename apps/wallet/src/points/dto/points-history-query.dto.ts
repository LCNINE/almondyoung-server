import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '@app/shared';

export class PointsHistoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Date range start (ISO date)' })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Date range end (ISO date)' })
  @IsOptional()
  @IsString()
  dateTo?: string;
}
