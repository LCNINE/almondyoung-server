import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsArray,
  IsInt,
  IsEnum,
  Min,
  Max,
  ValidateNested,
  IsNumber,
} from 'class-validator';

export class TagFilterDto {
  @ApiProperty({ description: 'Tag group ID' })
  @IsString()
  groupId: string;

  @ApiProperty({ description: 'Tag value IDs (OR within group)', type: [String] })
  @IsArray()
  @IsString({ each: true })
  valueIds: string[];
}

export class ProductSearchRequestDto {
  @ApiPropertyOptional({ description: 'Search keyword' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: 'Category ID' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Brand names', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  brands?: string[];

  @ApiPropertyOptional({ description: 'Minimum price' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  minPrice?: number;

  @ApiPropertyOptional({ description: 'Maximum price' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  maxPrice?: number;

  @ApiPropertyOptional({ description: 'Product status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description: 'Tag filters (inter-group AND, intra-group OR)',
    type: [TagFilterDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TagFilterDto)
  tagFilters?: TagFilterDto[];

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ['relevance', 'price', 'createdAt'],
    default: 'relevance',
  })
  @IsOptional()
  @IsEnum(['relevance', 'price', 'createdAt'])
  sortBy?: 'relevance' | 'price' | 'createdAt';

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @ApiPropertyOptional({ description: 'Page number', default: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Items per page',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;
}

