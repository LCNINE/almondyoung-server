import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export const SEARCH_SORT_VALUES = ['relevance', 'newest', 'price_asc', 'price_desc', 'review'] as const;

export type SearchSort = (typeof SEARCH_SORT_VALUES)[number];

function toStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  if (typeof value === 'string' && value.length > 0) {
    return [value];
  }

  return undefined;
}

export class ProductSearchQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => toStringArray(value))
  categoryIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => toStringArray(value))
  brands?: string[];

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  minPrice?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  maxPrice?: number;

  @IsOptional()
  @IsEnum(SEARCH_SORT_VALUES)
  sort: SearchSort = 'relevance';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  size: number = 20;

  // 멤버십 회원이면 true — 멤버십 전용 노출 상품을 결과/집계에 포함한다.
  // 생략/false 면 fail-closed 로 멤버십 전용 상품을 제외(비회원 취급).
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeMembersOnly?: boolean;
}
