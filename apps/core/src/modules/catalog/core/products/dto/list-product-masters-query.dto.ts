import { IsOptional, IsString, IsUUID, IsIn, IsInt, Min, IsDateString, IsArray, IsBoolean } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class ListProductMastersQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;

  @IsOptional() @IsString() q?: string;

  /** @deprecated q 와 동일하게 취급되는 별칭 */
  @IsOptional() @IsString() name?: string;

  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() brand?: string;

  @IsOptional()
  @IsIn(['active', 'active-or-inactive', 'all'])
  mode?: 'active' | 'active-or-inactive' | 'all';

  @IsOptional()
  @IsIn(['regular_sale', 'limited_edition'])
  productType?: 'regular_sale' | 'limited_edition';

  @IsOptional()
  @IsIn(['draft', 'pending', 'approved', 'rejected'])
  approvalStatus?: 'draft' | 'pending' | 'approved' | 'rejected';

  @IsOptional() @IsDateString() createdFrom?: string;
  @IsOptional() @IsDateString() createdTo?: string;

  @IsOptional()
  @IsIn(['createdAt', 'name', 'updatedAt'])
  sort?: 'createdAt' | 'name' | 'updatedAt';

  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  deleted?: boolean;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
      : value,
  )
  @IsArray()
  @IsString({ each: true })
  ids?: string[];
}
