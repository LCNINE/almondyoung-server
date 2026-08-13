import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import {
  SHOP_LISTING_BUSINESS_TYPES,
  SHOP_LISTING_DEAL_TYPES,
  SHOP_LISTING_REGIONS,
  ShopListingBusinessType,
  ShopListingDealType,
  ShopListingRegion,
} from '../shop-listing.constants';
import { SHOP_LISTING_SLUG_PATTERN } from './create-shop-listing.dto';

export class UpdateShopListingDto {
  @ApiProperty({ description: '상세 URL 주소', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(SHOP_LISTING_SLUG_PATTERN, {
    message: '주소는 한글, 영문 소문자, 숫자, 하이픈(-)만 사용할 수 있습니다.',
  })
  slug?: string;

  @ApiProperty({ description: '글 제목', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiProperty({ description: '본문 (HTML)', required: false })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiProperty({ description: '지역 (시·도)', enum: SHOP_LISTING_REGIONS, required: false })
  @IsOptional()
  @IsIn(SHOP_LISTING_REGIONS)
  region?: ShopListingRegion;

  @ApiProperty({ description: '업종', enum: SHOP_LISTING_BUSINESS_TYPES, required: false })
  @IsOptional()
  @IsIn(SHOP_LISTING_BUSINESS_TYPES)
  businessType?: ShopListingBusinessType;

  @ApiProperty({ description: '거래 유형', enum: SHOP_LISTING_DEAL_TYPES, required: false })
  @IsOptional()
  @IsIn(SHOP_LISTING_DEAL_TYPES)
  dealType?: ShopListingDealType;

  @ApiProperty({ description: '전용 평수', required: false, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  areaPyeong?: number | null;

  @ApiProperty({ description: '보증금 (원)', required: false, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  deposit?: number | null;

  @ApiProperty({ description: '월세 (원)', required: false, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyRent?: number | null;

  @ApiProperty({ description: '권리금 (원)', required: false, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  keyMoney?: number | null;

  @ApiProperty({ description: '대표 이미지 fileId', required: false })
  @IsOptional()
  @IsUUID()
  thumbnailFileId?: string;

  @ApiProperty({
    description: '샵 사진 갤러리 fileId 목록. 보낸 배열로 통째로 교체한다.',
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  images?: string[];

  @ApiProperty({ description: '노출 여부', required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
