import { IsArray, IsString, IsOptional, IsEnum, IsInt, IsBoolean, Min, ArrayMaxSize, ArrayNotEmpty } from 'class-validator';

/** 한 번에 다룰 수 있는 상품 수. 양식 다운로드(MAX_FORM_EXPORT_PRODUCTS)와 같은 값이다. */
export const MAX_BULK_PRODUCTS = 5000;

export class BulkUpdateDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BULK_PRODUCTS, { message: `한 번에 최대 ${MAX_BULK_PRODUCTS}개까지 선택할 수 있습니다.` })
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
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BULK_PRODUCTS, { message: `한 번에 최대 ${MAX_BULK_PRODUCTS}개까지 선택할 수 있습니다.` })
  @IsString({ each: true })
  productIds: string[];
}

export class BulkRestoreDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BULK_PRODUCTS, { message: `한 번에 최대 ${MAX_BULK_PRODUCTS}개까지 선택할 수 있습니다.` })
  @IsString({ each: true })
  productIds: string[];
}

export class BulkPolicyDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BULK_PRODUCTS, { message: `한 번에 최대 ${MAX_BULK_PRODUCTS}개까지 선택할 수 있습니다.` })
  @IsString({ each: true })
  productIds: string[];

  @IsOptional()
  @IsBoolean()
  hideMembershipPriceForNonMembers?: boolean;

  @IsOptional()
  @IsBoolean()
  isVisibleToMembersOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  isOverseas?: boolean;

  /** 배송비 그룹 코드. null 이면 기본 그룹으로 되돌린다. */
  @IsOptional()
  @IsString()
  shippingGroupCode?: string | null;
}
