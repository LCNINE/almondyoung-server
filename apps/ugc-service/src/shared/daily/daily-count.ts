import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BadRequestError } from '@app/shared';
import { IsISO8601, IsOptional, Matches } from 'class-validator';
import { and, gte, lt, lte, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class DailyRangeQueryDto {
  @ApiProperty({ description: '조회 시작일 (KST, YYYY-MM-DD)' })
  @Matches(DATE_ONLY)
  from: string;

  @ApiProperty({ description: '조회 종료일 (KST, YYYY-MM-DD, inclusive)' })
  @Matches(DATE_ONLY)
  to: string;
}

export class CreatedRangeQueryDto {
  @ApiPropertyOptional({ description: '작성 시각 하한 (ISO 8601, 포함)' })
  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @ApiPropertyOptional({ description: '작성 시각 상한 (ISO 8601, 포함)' })
  @IsOptional()
  @IsISO8601()
  createdTo?: string;
}

export interface DailyCountPoint {
  bucket: string;
  count: number;
}

export function assertDailyRange(from: string, to: string): void {
  if (from > to) throw new BadRequestError(`조회 기간이 뒤집혔습니다: ${from} > ${to}`);
}

/** created_at 은 timezone 없는 UTC timestamp 다 */
export function kstDaySql(column: PgColumn): SQL<string> {
  return sql<string>`(((${column} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::date)::text`;
}

export function kstDayRangeCondition(column: PgColumn, from: string, to: string): SQL | undefined {
  return and(
    gte(column, sql`((${from}::date)::timestamp AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC'`),
    lt(column, sql`((${to}::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC'`),
  );
}

export function createdRangeConditions(column: PgColumn, range: CreatedRangeQueryDto): SQL[] {
  const conditions: SQL[] = [];
  if (range.createdFrom) conditions.push(gte(column, new Date(range.createdFrom)));
  if (range.createdTo) conditions.push(lte(column, new Date(range.createdTo)));
  return conditions;
}

export function buildDailyCountSeries(rows: Array<{ day: string; count: number }>, from: string, to: string): DailyCountPoint[] {
  const countByDay = new Map(rows.map((row) => [row.day, Number(row.count)]));
  const series: DailyCountPoint[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    const bucket = cursor.toISOString().slice(0, 10);
    series.push({ bucket, count: countByDay.get(bucket) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return series;
}
