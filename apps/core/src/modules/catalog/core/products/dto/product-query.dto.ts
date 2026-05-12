import { IsOptional, IsString, IsEnum, IsInt, Min, IsDateString, IsArray, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export class ProductQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsEnum(['draft', 'pending', 'approved', 'rejected'])
  approvalStatus?: 'draft' | 'pending' | 'approved' | 'rejected';

  @IsOptional()
  @IsEnum(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @IsOptional()
  @IsString()
  productType?: string; // 'limited_edition' | 'regular_sale'

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  seller?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(['today', 'yesterday', 'week', 'month', 'custom'])
  dateRange?: string;

  @IsOptional()
  @IsEnum(['createdAt', 'updatedAt', 'name'])
  sortBy?: string;

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @IsBoolean()
  includeDeleted?: boolean = false;
}
