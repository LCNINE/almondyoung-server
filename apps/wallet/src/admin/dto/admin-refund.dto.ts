import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '@app/shared';

export class AdminRefundListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by status (PENDING, SUCCEEDED, FAILED)' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Date range start (ISO date)' })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Date range end (ISO date)' })
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Filter by payment intent ID' })
  @IsOptional()
  @IsString()
  intentId?: string;
}
