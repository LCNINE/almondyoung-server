import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

export class ListSalesOrderAmendmentsQueryDto {
  @ApiPropertyOptional({ enum: ['applied', 'pending', 'superseded'] })
  @IsOptional()
  @IsIn(['applied', 'pending', 'superseded'])
  status?: 'applied' | 'pending' | 'superseded';

  @ApiPropertyOptional({ enum: ['channel', 'operator'] })
  @IsOptional()
  @IsIn(['channel', 'operator'])
  origin?: 'channel' | 'operator';

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: '이 시각보다 이전 행(다음 쪽 커서 = 응답의 nextBefore)' })
  @IsOptional()
  @IsISO8601()
  before?: string;
}
