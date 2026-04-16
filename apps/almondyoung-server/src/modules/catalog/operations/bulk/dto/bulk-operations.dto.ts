import { IsArray, IsString, IsOptional, IsEnum, IsInt, Min } from 'class-validator';

export class BulkUpdateDto {
  @IsArray()
  @IsString({ each: true })
  productIds: string[];

  @IsOptional()
  @IsEnum(['active', 'inactive'])
  status?: string;

  @IsOptional()
  @IsEnum(['draft', 'pending', 'approved', 'rejected'])
  approvalStatus?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  basePrice?: number;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  seller?: string;
}

export class BulkDeleteDto {
  @IsArray()
  @IsString({ each: true })
  productIds: string[];
}

export class BulkRestoreDto {
  @IsArray()
  @IsString({ each: true })
  productIds: string[];
}
