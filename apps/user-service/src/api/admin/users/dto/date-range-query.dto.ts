import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class DateRangeQueryDto {
  @ApiProperty({ description: '조회 시작일 (KST, YYYY-MM-DD)' })
  @Matches(DATE_ONLY)
  from: string;

  @ApiProperty({ description: '조회 종료일 (KST, YYYY-MM-DD, inclusive)' })
  @Matches(DATE_ONLY)
  to: string;
}
