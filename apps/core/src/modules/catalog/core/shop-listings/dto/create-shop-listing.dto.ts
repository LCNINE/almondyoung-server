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

// 한글 완성형은 코드포인트로 escape 한다 — 리터럴로 쓰면 겉보기 같은 CJK 문자가 섞인다.
const HANGUL = '\\uAC00-\\uD7A3';
export const SHOP_LISTING_SLUG_PATTERN = new RegExp(`^[a-z0-9${HANGUL}]+(?:-[a-z0-9${HANGUL}]+)*$`);

export class CreateShopListingDto {
  @ApiProperty({
    description: '상세 URL 주소. 비워두면 제목에서 자동 생성하고, 중복이면 뒤에 번호를 붙인다.',
    required: false,
    example: '강남-네일샵-양도합니다',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(SHOP_LISTING_SLUG_PATTERN, {
    message: '주소는 한글, 영문 소문자, 숫자, 하이픈(-)만 사용할 수 있습니다.',
  })
  slug?: string;

  @ApiProperty({ description: '글 제목', example: '강남 네일샵 양도합니다' })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiProperty({ description: '본문 (HTML)' })
  @IsString()
  content: string;

  @ApiProperty({ description: '지역 (시·도)', enum: SHOP_LISTING_REGIONS, example: 'seoul' })
  @IsIn(SHOP_LISTING_REGIONS)
  region: ShopListingRegion;

  @ApiProperty({ description: '업종', enum: SHOP_LISTING_BUSINESS_TYPES, example: 'nail' })
  @IsIn(SHOP_LISTING_BUSINESS_TYPES)
  businessType: ShopListingBusinessType;

  @ApiProperty({ description: '거래 유형', enum: SHOP_LISTING_DEAL_TYPES, example: 'transfer' })
  @IsIn(SHOP_LISTING_DEAL_TYPES)
  dealType: ShopListingDealType;

  @ApiProperty({ description: '전용 평수', required: false, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  areaPyeong?: number | null;

  @ApiProperty({ description: '보증금 (원). 생략하면 협의로 표시', required: false, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  deposit?: number | null;

  @ApiProperty({ description: '월세 (원). 생략하면 협의로 표시', required: false, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyRent?: number | null;

  @ApiProperty({ description: '권리금 (원). 생략하면 협의로 표시', required: false, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  keyMoney?: number | null;

  @ApiProperty({ description: '대표 이미지 fileId (목록 카드 · 공유 OG 이미지로 쓰이므로 필수)' })
  @IsUUID()
  thumbnailFileId: string;

  @ApiProperty({
    description: '샵 사진 갤러리 fileId 목록. 배열 순서가 그대로 노출 순서다.',
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  images?: string[];

  @ApiProperty({ description: '노출 여부', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
