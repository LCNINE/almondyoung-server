import { ApiProperty } from '@nestjs/swagger';
import { ProductTagDto } from './product-tag.dto';

export class ProductMasterDto {
  @ApiProperty({ description: '제품 마스터 ID (UUID 형식)' })
  id: string;

  @ApiProperty({ description: '제품 마스터 이름' })
  name: string;

  @ApiProperty({ description: '제품 설명', nullable: true })
  description: string | null;

  @ApiProperty({ description: '브랜드명', nullable: true })
  brand: string | null;

  // basePrice removed - 가격은 pricing rules로 조회
  // tags removed - 별도 태그 테이블로 정규화됨
  // attributes removed - 삭제됨

  @ApiProperty({ description: '제품 이미지 (JSONB)' })
  images: any;

  @ApiProperty({ description: 'SEO 제목', nullable: true })
  seoTitle: string | null;

  @ApiProperty({ description: 'SEO 설명', nullable: true })
  seoDescription: string | null;

  @ApiProperty({ description: 'SEO 키워드', type: [String], nullable: true })
  seoKeywords: string[] | null;

  @ApiProperty({ description: '제품 상태', nullable: true })
  status: string | null;

  @ApiProperty({ description: '도매회원 전용 여부', nullable: true })
  isWholesaleOnly: boolean | null;

  @ApiProperty({ description: '멤버십회원 전용 여부', nullable: true })
  isMembershipOnly: boolean | null;

  @ApiProperty({ description: '생성일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: '수정일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  updatedAt: string;

  @ApiProperty({ description: '생성자', nullable: true })
  createdBy: string | null;

  @ApiProperty({ description: '수정자', nullable: true })
  updatedBy: string | null;
}

export class OptionValueDto {
  @ApiProperty({ description: '옵션 값 ID' })
  id: string;

  @ApiProperty({ description: '옵션 값' })
  value: string;

  @ApiProperty({ description: '옵션 값 표시명' })
  displayName: string;

  @ApiProperty({ description: '정렬 순서' })
  sortOrder: number;

  @ApiProperty({ description: '활성 여부' })
  isActive: boolean;

  @ApiProperty({ description: '생성일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  createdAt: string;
}

export class OptionGroupDto {
  @ApiProperty({ description: '옵션 그룹 ID' })
  id: string;

  @ApiProperty({ description: '옵션 그룹 표시명' })
  displayName: string;

  @ApiProperty({ description: '정렬 순서' })
  sortOrder: number;

  @ApiProperty({ description: '필수 여부' })
  isRequired: boolean;

  @ApiProperty({ description: '생성일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: '옵션 값들', type: [OptionValueDto] })
  values: OptionValueDto[];
}

export class VariantDto {
  @ApiProperty({ description: '변형 ID' })
  id: string;

  @ApiProperty({ description: '마스터 ID' })
  masterId: string;

  @ApiProperty({ description: '변형명', nullable: true })
  variantName: string | null;

  @ApiProperty({ description: '변형 이미지' })
  images: any;

  @ApiProperty({ description: '표시 순서', nullable: true })
  displayOrder: number | null;

  @ApiProperty({ description: '변형 상태', nullable: true })
  status: string | null;

  @ApiProperty({ description: '기본 변형 여부', nullable: true })
  isDefault: boolean | null;

  @ApiProperty({ description: '생성일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: '수정일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  updatedAt: string;

  @ApiProperty({ description: '옵션 값들' })
  optionValues: any[];

  @ApiProperty({ description: '계산된 가격', required: false })
  price?: number;
}

export class ChannelInfoDto {
  @ApiProperty({ description: '채널 ID' })
  id: string;

  @ApiProperty({ description: '채널 타입' })
  type: string;

  @ApiProperty({ description: '채널명' })
  name: string;

  @ApiProperty({ description: '활성 여부', nullable: true })
  isActive: boolean | null;

  @ApiProperty({ description: 'API 설정' })
  apiConfig: any;

  @ApiProperty({ description: '지원 기능' })
  supportedFeatures: any;

  @ApiProperty({ description: '생성일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: '수정일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  updatedAt: string;
}

export class ChannelProductDto {
  @ApiProperty({ description: '채널 제품 ID' })
  id: string;

  @ApiProperty({ description: '마스터 ID' })
  masterId: string;

  @ApiProperty({ description: '채널 ID' })
  channelId: string;

  @ApiProperty({ description: '채널별 제품명', nullable: true })
  name: string | null;

  @ApiProperty({ description: '활성 여부', nullable: true })
  isActive: boolean | null;

  @ApiProperty({ description: '채널별 특화 데이터' })
  channelSpecificData: any;

  @ApiProperty({ description: '생성일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: '수정일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  updatedAt: string;

  @ApiProperty({ description: '채널 정보', type: ChannelInfoDto })
  channel: ChannelInfoDto;
}

export class MasterDetailDto extends ProductMasterDto {
  @ApiProperty({ description: '옵션 그룹들', type: [OptionGroupDto] })
  optionGroups: OptionGroupDto[];

  @ApiProperty({ description: '연결된 제품 변형 목록', type: [VariantDto] })
  variants: VariantDto[];

  @ApiProperty({ description: '채널별 제품들', type: [ChannelProductDto] })
  channelProducts: ChannelProductDto[];

  @ApiProperty({
    description: '상품에 연결된 태그 목록',
    type: [ProductTagDto],
    required: false
  })
  tagValues?: ProductTagDto[];
}

export class MasterListItemDto {
  @ApiProperty({ description: '제품 마스터 ID' })
  id: string;

  @ApiProperty({ description: '제품 마스터 이름' })
  name: string;

  @ApiProperty({ description: '썸네일 이미지 URL', nullable: true })
  thumbnail: string | null;

  // basePrice removed - 가격은 pricing rules로 조회

  @ApiProperty({ description: '멤버십회원 전용 여부' })
  isMembershipOnly: boolean;

  @ApiProperty({ description: '제품 상태' })
  status: string;

  @ApiProperty({ description: '생성일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: '옵션 그룹 개수', minimum: 0 })
  optionGroupCount: number;

  @ApiProperty({ description: '변형 개수', minimum: 1 })
  variantCount: number;
}

export class MasterListResponseDto {
  @ApiProperty({ description: '제품 마스터 목록', type: [MasterListItemDto] })
  data: MasterListItemDto[];

  @ApiProperty({ description: '현재 페이지 번호', minimum: 1 })
  page: number;

  @ApiProperty({ description: '페이지당 아이템 수', minimum: 1 })
  limit: number;

  @ApiProperty({ description: '전체 아이템 수', minimum: 0 })
  total: number;
}

export class MasterUpdateResponseDto {
  @ApiProperty({ description: '수정 성공 여부' })
  success: boolean;

  @ApiProperty({ description: '수정된 제품 마스터 정보', type: ProductMasterDto })
  data: ProductMasterDto;
}

