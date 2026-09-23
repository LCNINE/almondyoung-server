import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MAX_SHOP_LISTING_CONTENT_LENGTH,
  MAX_SHOP_LISTING_IMAGES,
  SHOP_LISTING_AUTHOR_TYPES,
  SHOP_LISTING_BUSINESS_TYPES,
  SHOP_LISTING_DEAL_TYPES,
  SHOP_LISTING_REGIONS,
  SHOP_LISTING_SLUG_PATTERN,
  SHOP_LISTING_STATUSES,
  type ShopListingAuthorType,
  type ShopListingBusinessType,
  type ShopListingDealType,
  type ShopListingRegion,
  type ShopListingStatus,
} from '../shop-listing.constants';
import { stripPhoneSeparators } from '../shop-listing.util';

const PHONE_PATTERN = /^0\d{8,10}$/;
const PHONE_MESSAGE = '전화번호는 0 으로 시작하는 9~11자리 숫자여야 합니다.';
const KAKAO_OPEN_CHAT_PATTERN = /^https:\/\/open\.kakao\.com\//;
const NOT_BLANK = /\S/;

// 두 DTO 가 필드를 상속으로 공유하지 않는다 — class-validator 가 부모의 @IsOptional 을 자식에 합쳐
// 「회원은 전화번호 필수」가 조용히 무력화된다. 필드를 고칠 땐 두 클래스를 같이 고칠 것.

export class MemberShopListingDto {
  @ApiProperty({ example: '강남 네일샵 양도합니다' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiProperty({ description: '본문 (마크다운)', maxLength: MAX_SHOP_LISTING_CONTENT_LENGTH })
  @IsString()
  @MaxLength(MAX_SHOP_LISTING_CONTENT_LENGTH)
  @Matches(NOT_BLANK, { message: '본문을 입력해주세요.' })
  content: string;

  @ApiProperty({ enum: SHOP_LISTING_REGIONS })
  @IsIn(SHOP_LISTING_REGIONS)
  region: ShopListingRegion;

  @ApiProperty({ enum: SHOP_LISTING_BUSINESS_TYPES })
  @IsIn(SHOP_LISTING_BUSINESS_TYPES)
  businessType: ShopListingBusinessType;

  @ApiProperty({ enum: SHOP_LISTING_DEAL_TYPES })
  @IsIn(SHOP_LISTING_DEAL_TYPES)
  dealType: ShopListingDealType;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  areaPyeong?: number | null;

  @ApiProperty({ required: false, nullable: true, description: '보증금(원). 비우면 협의' })
  @IsOptional()
  @IsInt()
  @Min(0)
  deposit?: number | null;

  @ApiProperty({ required: false, nullable: true, description: '월세(원). 비우면 협의' })
  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyRent?: number | null;

  @ApiProperty({ required: false, nullable: true, description: '권리금(원). 비우면 협의' })
  @IsOptional()
  @IsInt()
  @Min(0)
  keyMoney?: number | null;

  @ApiProperty({ type: [String], description: 'file-service fileId. 첫 장이 썸네일. 1~15장' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SHOP_LISTING_IMAGES)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  imageFileIds: string[];

  @ApiProperty({ example: '010-1234-5678', description: '하이픈·공백은 서버가 제거한다' })
  @Transform(({ value }) => stripPhoneSeparators(value))
  @IsString()
  @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  contactPhone: string;

  @ApiProperty({ required: false, nullable: true, example: 'https://open.kakao.com/o/abcdef' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(KAKAO_OPEN_CHAT_PATTERN, { message: '카카오 오픈채팅 주소(https://open.kakao.com/…)만 넣을 수 있습니다.' })
  kakaoOpenChatUrl?: string | null;
}

export class AdminShopListingDto {
  @ApiProperty({ required: false, description: '비우면 제목에서 자동 생성. 수정 시 보내면 다시 만든다' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(SHOP_LISTING_SLUG_PATTERN, { message: '주소는 한글, 영문 소문자, 숫자, 하이픈(-)만 사용할 수 있습니다.' })
  slug?: string;

  @ApiProperty({ example: '강남 네일샵 양도합니다' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiProperty({ description: '본문 (마크다운)', maxLength: MAX_SHOP_LISTING_CONTENT_LENGTH })
  @IsString()
  @MaxLength(MAX_SHOP_LISTING_CONTENT_LENGTH)
  @Matches(NOT_BLANK, { message: '본문을 입력해주세요.' })
  content: string;

  @ApiProperty({ enum: SHOP_LISTING_REGIONS })
  @IsIn(SHOP_LISTING_REGIONS)
  region: ShopListingRegion;

  @ApiProperty({ enum: SHOP_LISTING_BUSINESS_TYPES })
  @IsIn(SHOP_LISTING_BUSINESS_TYPES)
  businessType: ShopListingBusinessType;

  @ApiProperty({ enum: SHOP_LISTING_DEAL_TYPES })
  @IsIn(SHOP_LISTING_DEAL_TYPES)
  dealType: ShopListingDealType;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  areaPyeong?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  deposit?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyRent?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  keyMoney?: number | null;

  @ApiProperty({ type: [String], description: 'file-service fileId. 첫 장이 썸네일. 1~15장' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SHOP_LISTING_IMAGES)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  imageFileIds: string[];

  @ApiProperty({ required: false, nullable: true, description: '관리자 글은 선택' })
  @IsOptional()
  @Transform(({ value }) => stripPhoneSeparators(value))
  @IsString()
  @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  contactPhone?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(KAKAO_OPEN_CHAT_PATTERN, { message: '카카오 오픈채팅 주소(https://open.kakao.com/…)만 넣을 수 있습니다.' })
  kakaoOpenChatUrl?: string | null;
}

export class RejectShopListingDto {
  @ApiProperty({ description: '회원에게 보이는 거절 사유', maxLength: 500 })
  @IsString()
  @Matches(NOT_BLANK, { message: '거절 사유를 입력해주세요.' })
  @MaxLength(500)
  reason: string;
}

export class AdminShopListingListQueryDto {
  @ApiProperty({ required: false, enum: SHOP_LISTING_STATUSES })
  @IsOptional()
  @IsIn(SHOP_LISTING_STATUSES)
  status?: ShopListingStatus;

  @ApiProperty({ required: false, enum: SHOP_LISTING_AUTHOR_TYPES })
  @IsOptional()
  @IsIn(SHOP_LISTING_AUTHOR_TYPES)
  authorType?: ShopListingAuthorType;

  @ApiProperty({ required: false, description: '제목 부분일치' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;
}
