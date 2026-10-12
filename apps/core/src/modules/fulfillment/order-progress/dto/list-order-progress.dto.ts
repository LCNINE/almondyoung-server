import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { salesChannelEnum } from '../../../inventory/schema/inventory.schema';
import { ORDER_PROGRESS_STAGES, OrderProgressStage } from '../order-progress.thresholds';

export class ListOrderProgressQueryDto {
  @ApiProperty({ enum: ORDER_PROGRESS_STAGES })
  @IsIn(ORDER_PROGRESS_STAGES)
  stage!: OrderProgressStage;

  @ApiPropertyOptional({ description: '세부 상태(요약의 states[].state)' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ description: '기준 시간을 넘긴 주문만' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  stuck?: boolean;

  @ApiPropertyOptional({ enum: salesChannelEnum.enumValues })
  @IsOptional()
  @IsIn(salesChannelEnum.enumValues)
  channel?: string;

  @ApiPropertyOptional({ enum: ['dwell', 'ordered'], default: 'dwell' })
  @IsOptional()
  @IsIn(['dwell', 'ordered'])
  sort?: 'dwell' | 'ordered';

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: '다음 쪽 커서 = 응답의 nextCursor' })
  @IsOptional()
  @IsString()
  @Matches(/^[^|]+\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  cursor?: string;
}
