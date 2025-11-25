import { ApiProperty } from '@nestjs/swagger';

export class LookupChannelListingResponseDto {
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

  @ApiProperty({ description: '생성일시', nullable: true })
  createdAt: Date | null;

  @ApiProperty({ description: '수정일시', nullable: true })
  updatedAt: Date | null;
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

  @ApiProperty({ description: '생성일시', nullable: true })
  createdAt: Date | null;

  @ApiProperty({ description: '채널 정보', type: ChannelSiteInfoDto })
  channel: ChannelSiteInfoDto;
}

export class ChannelListingListResponseDto {
  @ApiProperty({ description: '채널 매핑 목록', type: [ChannelListingWithChannelDto] })
  items: ChannelListingWithChannelDto[];

  @ApiProperty({ description: '전체 개수' })
  total: number;
}

