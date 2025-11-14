import { ApiProperty } from '@nestjs/swagger';

export class ChannelProductDto {
  @ApiProperty({ description: '채널 제품 ID' })
  id: string;

  @ApiProperty({ description: '제품 마스터 ID' })
  masterId: string;

  @ApiProperty({ description: '판매 채널 ID' })
  channelId: string;

  @ApiProperty({ description: '채널별 제품명', nullable: true })
  name: string | null;

  @ApiProperty({ description: '채널에서의 활성 상태', nullable: true })
  isActive: boolean | null;

  @ApiProperty({ description: '채널별 특화 데이터' })
  channelSpecificData: any;

  @ApiProperty({ description: '생성일시', nullable: true })
  createdAt: Date | null;

  @ApiProperty({ description: '수정일시', nullable: true })
  updatedAt: Date | null;
}

export class ChannelInfoDto {
  @ApiProperty({ description: '채널 ID' })
  id: string;

  @ApiProperty({ description: '채널명' })
  name: string;

  @ApiProperty({ description: '채널 타입' })
  type: string;

  @ApiProperty({ description: '채널 활성 상태' })
  isActive: boolean;
}

export class ChannelProductWithChannelDto {
  @ApiProperty({ description: '채널 제품 ID (UUID 형식)' })
  id: string;

  @ApiProperty({ description: '제품 마스터 ID (UUID 형식)' })
  masterId: string;

  @ApiProperty({ description: '판매 채널 ID (UUID 형식)' })
  channelId: string;

  @ApiProperty({ description: '채널별 제품명', nullable: true })
  name: string | null;

  @ApiProperty({ description: '채널별 제품 설명', nullable: true })
  description: string | null;

  @ApiProperty({ description: '채널별 제품 이미지 URL 배열', type: [String] })
  images: string[];

  @ApiProperty({ description: '채널에서의 활성 상태' })
  isActive: boolean;

  @ApiProperty({ description: '채널별 특화 데이터' })
  channelSpecificData: Record<string, any>;

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;

  @ApiProperty({ description: '판매 채널 정보', type: ChannelInfoDto })
  channel: ChannelInfoDto;
}

export class ProductMasterInfoDto {
  @ApiProperty({ description: '마스터 ID' })
  id: string;

  @ApiProperty({ description: '마스터 제품명' })
  name: string;

  @ApiProperty({ description: '브랜드명', nullable: true })
  brand: string | null;

  @ApiProperty({ description: '기본 가격' })
  basePrice: number;

  @ApiProperty({ description: '마스터 상태' })
  status: string;
}

export class ChannelProductWithMasterDto {
  @ApiProperty({ description: '채널 제품 ID (UUID 형식)' })
  id: string;

  @ApiProperty({ description: '제품 마스터 ID (UUID 형식)' })
  masterId: string;

  @ApiProperty({ description: '판매 채널 ID (UUID 형식)' })
  channelId: string;

  @ApiProperty({ description: '채널별 제품명', nullable: true })
  name: string | null;

  @ApiProperty({ description: '채널별 제품 설명', nullable: true })
  description: string | null;

  @ApiProperty({ description: '채널별 제품 이미지 URL 배열', type: [String] })
  images: string[];

  @ApiProperty({ description: '채널에서의 활성 상태' })
  isActive: boolean;

  @ApiProperty({ description: '채널별 특화 데이터' })
  channelSpecificData: Record<string, any>;

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;

  @ApiProperty({ description: '제품 마스터 정보', type: ProductMasterInfoDto })
  master: ProductMasterInfoDto;
}

export class ChannelProductListResponseDto {
  @ApiProperty({ description: '채널 제품 목록', type: [ChannelProductWithMasterDto] })
  data: ChannelProductWithMasterDto[];

  @ApiProperty({ description: '전체 아이템 수', minimum: 0 })
  total: number;

  @ApiProperty({ description: '현재 페이지 번호', minimum: 1 })
  page: number;

  @ApiProperty({ description: '페이지당 아이템 수', minimum: 1 })
  limit: number;
}

export class MergedChannelProductDto {
  @ApiProperty({ description: '채널 제품 ID' })
  id: string;

  @ApiProperty({ description: '제품 마스터 ID' })
  masterId: string;

  @ApiProperty({ description: '판매 채널 ID' })
  channelId: string;

  @ApiProperty({ description: '제품명 (채널별 또는 마스터)' })
  name: string;

  @ApiProperty({ description: '제품 설명 (채널별 또는 마스터)' })
  description: string;

  @ApiProperty({ description: '제품 이미지 URL 배열', type: [String] })
  images: string[];

  @ApiProperty({ description: '활성 상태' })
  isActive: boolean;

  @ApiProperty({ description: '기본 가격' })
  basePrice: number;

  @ApiProperty({ description: '채널별 특화 데이터', required: false })
  channelSpecificData?: Record<string, any>;
}

