import {
  IsOptional,
  IsString,
  IsUUID,
  IsIn,
  IsInt,
  Min,
  IsDateString,
  IsArray,
  IsBoolean,
  Matches,
} from 'class-validator';
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
  @IsIn(['active', 'inactive', 'draft'])
  status?: 'active' | 'inactive' | 'draft';

  @IsOptional()
  @IsIn(['regular_sale', 'limited_edition'])
  productType?: 'regular_sale' | 'limited_edition';

  /** 상품을 등록한 사용자 UUID. product_masters.createdBy 기준 */
  @IsOptional() @IsUUID() createdBy?: string;

  /**
   * 공급처 UUID. 콤마로 여러 개 지정하면 OR 로 묶인다. product_master_versions.supplierId 기준.
   * `unassigned` 를 섞으면 공급처 미지정(IS NULL) 상품도 함께 포함한다 —
   * 공급처가 없는 상품이 963건 있어 UUID 목록만으로는 표현할 수 없다.
   */
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
  @Matches(/^(unassigned|[0-9a-fA-F-]{36})$/, {
    each: true,
    message: 'supplierId 는 UUID 또는 unassigned 여야 합니다.',
  })
  supplierId?: string[];

  @IsOptional() @IsDateString() createdFrom?: string;
  @IsOptional() @IsDateString() createdTo?: string;

  @IsOptional()
  @IsIn(['createdAt', 'name', 'updatedAt'])
  sort?: 'createdAt' | 'name' | 'updatedAt';

  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';

  /** 품절 상태 필터. in_stock=판매가능, partial=부분품절, sold_out=전체품절. all/미지정=필터 없음. */
  @IsOptional()
  @IsIn(['all', 'in_stock', 'partial', 'sold_out'])
  stock?: 'all' | 'in_stock' | 'partial' | 'sold_out';

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
