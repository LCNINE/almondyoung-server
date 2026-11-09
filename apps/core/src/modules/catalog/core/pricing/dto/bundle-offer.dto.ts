import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, ValidateIf, ValidateNested } from 'class-validator';
import { MAX_BUNDLE_OFFERS } from '../bundle-offer.math';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class BundleOfferDto {
  @ApiProperty({ description: '구성품(B) 상품 마스터 id' })
  @IsUUID()
  addonMasterId: string;

  @ApiProperty({ type: [String], required: false, nullable: true, description: '할인 대상 구성품 옵션(variant id). 없으면 모든 옵션' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsArray()
  @IsUUID('all', { each: true })
  allowedVariantIds?: string[] | null;

  @ApiProperty({ description: '일반 고객 할인율(정가 기준), 1/100 % 단위(10% = 1000). 0 이면 일반 고객은 할인 없음', example: 1000 })
  @IsInt()
  regularRateBp: number;

  @ApiProperty({ description: '멤버십 회원 할인율(멤버십가 기준), 1/100 % 단위. 0 이면 회원은 할인 없음', example: 1500 })
  @IsInt()
  membershipRateBp: number;

  @ApiProperty()
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ required: false, nullable: true, description: 'KST 시작일(YYYY-MM-DD). 없으면 상시' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DATE_ONLY)
  startsOn?: string | null;

  @ApiProperty({ required: false, nullable: true, description: 'KST 종료일(YYYY-MM-DD, 그날 끝까지)' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DATE_ONLY)
  endsOn?: string | null;

  @ApiProperty({ required: false, nullable: true, description: '상세에 보일 안내 문구. 없으면 기본 문구' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  label?: string | null;
}

export class ReplaceBundleOffersDto {
  @ApiProperty({ type: [BundleOfferDto], description: `구성품 전체(순서 = 화면 순서, 최대 ${MAX_BUNDLE_OFFERS}개). 빈 배열이면 모두 해제` })
  @IsArray()
  @ArrayMaxSize(MAX_BUNDLE_OFFERS)
  @ValidateNested({ each: true })
  @Type(() => BundleOfferDto)
  offers: BundleOfferDto[];
}

export class BundleOfferResponseDto extends BundleOfferDto {
  @ApiProperty({ description: '구성품 이름(활성 버전, 판매 중이 아니면 마지막 버전)' })
  addonName: string;

  @ApiProperty()
  sort: number;
}
