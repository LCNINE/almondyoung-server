import { ApiProperty } from '@nestjs/swagger';
import { LISTING_RESOLUTION_CAUSES, type ListingResolutionCause } from '@packages/domain-types';

export class LookupChannelListingResponseDto {
  @ApiProperty({ description: 'PIM Master ID' })
  masterId: string;

  @ApiProperty({ description: 'PIM Version ID' })
  versionId: string;

  @ApiProperty({ description: '상품 표시명' })
  productName: string;

  @ApiProperty({ description: 'PIM Variant ID' })
  variantId: string;

  @ApiProperty({ description: 'Variant 코드', nullable: true })
  variantCode: string | null;

  @ApiProperty({ description: 'Variant 이름', nullable: true })
  variantName: string | null;

  @ApiProperty({ description: '매핑 활성 상태' })
  isActive: boolean;
}

export class ChannelSiteInfoDto {
  @ApiProperty({ description: '채널 ID' })
  id: string;

  @ApiProperty({ description: '채널 이름' })
  name: string;

  @ApiProperty({ description: '채널 사이트 코드' })
  site: string;
}

export class ChannelListingDto {
  @ApiProperty({ description: '매핑 ID' })
  id: string;

  @ApiProperty({ description: 'PIM Variant ID' })
  variantId: string;

  @ApiProperty({ description: '판매 채널 ID' })
  salesChannelId: string;

  @ApiProperty({ description: '채널 상품 ID' })
  channelItemId: string;

  @ApiProperty({ description: '채널 상품명', nullable: true })
  channelItemName: string | null;

  @ApiProperty({ description: '채널 옵션명', nullable: true })
  channelOptionName: string | null;

  @ApiProperty({ description: '채널 판매가', nullable: true })
  channelPrice: number | null;

  @ApiProperty({ description: '채널 상품 URL', nullable: true })
  channelProductUrl: string | null;

  @ApiProperty({ description: '활성 상태' })
  isActive: boolean;

  @ApiProperty({ description: '생성일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: '수정일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  updatedAt: string;
}

export class ChannelListingWithChannelDto {
  @ApiProperty({ description: '매핑 ID' })
  id: string;

  @ApiProperty({ description: '채널 상품 ID' })
  channelItemId: string;

  @ApiProperty({ description: '채널 상품명', nullable: true })
  channelItemName: string | null;

  @ApiProperty({ description: '채널 옵션명', nullable: true })
  channelOptionName: string | null;

  @ApiProperty({ description: '채널 판매가', nullable: true })
  channelPrice: number | null;

  @ApiProperty({ description: '활성 상태' })
  isActive: boolean;

  @ApiProperty({ description: '생성일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: '수정일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  updatedAt: string;

  @ApiProperty({ description: '채널 정보', type: ChannelSiteInfoDto })
  channel: ChannelSiteInfoDto;
}

export class ChannelListingListResponseDto {
  @ApiProperty({ description: '채널 매핑 목록', type: [ChannelListingWithChannelDto] })
  data: ChannelListingWithChannelDto[];

  @ApiProperty({ description: '전체 개수' })
  total: number;
}

export class ResolveChannelListingResponseDto {
  @ApiProperty({ description: '매핑 해석 성공 여부' })
  found: boolean;

  @ApiProperty({
    description: '해석된 매핑 (found=true 일 때만)',
    required: false,
    type: LookupChannelListingResponseDto,
  })
  listing?: LookupChannelListingResponseDto;

  @ApiProperty({
    description: '해석 실패 사유 (found=false 일 때만). 어휘 정본은 @packages/domain-types',
    required: false,
    enum: LISTING_RESOLUTION_CAUSES,
  })
  cause?: ListingResolutionCause;
}
