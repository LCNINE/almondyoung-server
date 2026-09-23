import { ApiProperty } from '@nestjs/swagger';
import {
  SHOP_LISTING_AUTHOR_TYPES,
  SHOP_LISTING_MODERATION_DECISIONS,
  SHOP_LISTING_STATUSES,
  type ShopListingAuthorType,
  type ShopListingModerationDecision,
  type ShopListingStatus,
} from '../shop-listing.constants';

/** 공개 목록·상세. 연락처와 작성자는 넣지 않는다. */
export class PublicShopListingResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() slug: string;
  @ApiProperty() title: string;
  @ApiProperty({ description: '본문 (마크다운)' }) content: string;
  @ApiProperty({ nullable: true }) region: string | null;
  @ApiProperty({ nullable: true }) businessType: string | null;
  @ApiProperty({ nullable: true }) dealType: string | null;
  @ApiProperty({ nullable: true }) areaPyeong: number | null;
  @ApiProperty({ nullable: true }) deposit: number | null;
  @ApiProperty({ nullable: true }) monthlyRent: number | null;
  @ApiProperty({ nullable: true }) keyMoney: number | null;
  @ApiProperty({ nullable: true, description: 'imageFileIds[0]. 목록 카드·OG 이미지' }) thumbnailFileId: string | null;
  @ApiProperty({ type: [String], description: '순서 = 노출 순서' }) imageFileIds: string[];
  @ApiProperty({ enum: SHOP_LISTING_STATUSES, description: 'published 또는 closed(거래완료)' })
  status: ShopListingStatus;
  @ApiProperty() viewCount: number;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}

export class ShopListingContactResponseDto {
  @ApiProperty({ nullable: true, description: '숫자만' }) contactPhone: string | null;
  @ApiProperty({ nullable: true }) kakaoOpenChatUrl: string | null;
}

/** 작성 회원 본인에게. 상태·거절 사유·연락처를 포함한다. */
export class MyShopListingResponseDto extends PublicShopListingResponseDto {
  @ApiProperty({ nullable: true, description: 'status 가 rejected 일 때만 값이 있다' }) rejectReason: string | null;
  @ApiProperty({ nullable: true }) contactPhone: string | null;
  @ApiProperty({ nullable: true }) kakaoOpenChatUrl: string | null;
  @ApiProperty({ nullable: true }) submittedAt: string | null;
}

export class AdminShopListingResponseDto extends MyShopListingResponseDto {
  @ApiProperty({ enum: SHOP_LISTING_AUTHOR_TYPES }) authorType: ShopListingAuthorType;
  @ApiProperty({ nullable: true }) authorUserId: string | null;
}

export class ShopListingModerationResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ['admin', 'classifier'] }) decidedBy: 'admin' | 'classifier';
  @ApiProperty({ enum: SHOP_LISTING_MODERATION_DECISIONS }) decision: ShopListingModerationDecision;
  @ApiProperty({ nullable: true }) label: string | null;
  @ApiProperty({ nullable: true }) confidence: number | null;
  @ApiProperty({ nullable: true }) reason: string | null;
  @ApiProperty({ nullable: true }) actorUserId: string | null;
  @ApiProperty() createdAt: string;
}

export class AdminShopListingDetailResponseDto extends AdminShopListingResponseDto {
  @ApiProperty({ type: [ShopListingModerationResponseDto], description: '최신순' })
  moderations: ShopListingModerationResponseDto[];
}
