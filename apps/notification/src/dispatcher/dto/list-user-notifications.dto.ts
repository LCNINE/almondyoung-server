import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class ListUserNotificationsDto {
  @ApiProperty({ enum: ['SMS', 'KAKAO'] })
  @IsIn(['SMS', 'KAKAO'])
  channel: 'SMS' | 'KAKAO';

  @ApiProperty({ description: '시작일(KST, YYYY-MM-DD)' })
  @Matches(DATE_RE)
  from: string;

  @ApiProperty({ description: '종료일(KST, YYYY-MM-DD). 시작일과 30일 넘게 떨어질 수 없다' })
  @Matches(DATE_RE)
  to: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
