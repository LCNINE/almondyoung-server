import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class ListSalesOrderAmendmentsQueryDto {
  @ApiPropertyOptional({ enum: ['applied', 'pending', 'superseded', 'dismissed', 'requested', 'rejected'] })
  @IsOptional()
  @IsIn(['applied', 'pending', 'superseded', 'dismissed', 'requested', 'rejected'])
  status?: 'applied' | 'pending' | 'superseded' | 'dismissed' | 'requested' | 'rejected';

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

  @ApiPropertyOptional({ description: '다음 쪽 커서(불투명 문자열) = 응답의 nextCursor' })
  @IsOptional()
  @IsString()
  @Matches(/^[^|]+\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  cursor?: string;
}
