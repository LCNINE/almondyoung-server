import { ApiProperty } from '@nestjs/swagger';
import { ProductMasterEntity } from '../entities/master.entity';
import { ProductVersionDto } from '../entities/master-version.entity';
import { ProductImageDto } from './product-image.dto';

export class PriceSummaryDto {
  @ApiProperty({ description: '최소 일반가' })
  minBasePrice: number;

  @ApiProperty({ description: '최대 일반가' })
  maxBasePrice: number;

  @ApiProperty({ description: '최소 멤버십가' })
  minMembershipPrice: number;

  @ApiProperty({ description: '최대 멤버십가' })
  maxMembershipPrice: number;

  @ApiProperty({ description: '도매가 존재 여부' })
  hasTieredPrices: boolean;
}

export class ProductDto {
  @ApiProperty({ description: 'Version ID' })
  id: string;

  @ApiProperty({ description: 'Master ID' })
  masterId: string;

  @ApiProperty({ description: 'Version number' })
  version: number;

  @ApiProperty({ description: 'Version status', enum: ['draft', 'inactive', 'active'] })
  status: string;

  @ApiProperty({ description: '제품명' })
  name: string;

  @ApiProperty({ description: '제품 설명', nullable: true })
  description: string | null;

  @ApiProperty({ description: '브랜드', nullable: true })
  brand: string | null;

  @ApiProperty({ description: '썸네일', nullable: true })
  thumbnail: string | null;

  @ApiProperty({
    description: '제품 이미지 목록',
    type: [ProductImageDto],
    required: false,
    nullable: true,
  })
  images: ProductImageDto[] | null;

  @ApiProperty({ description: 'SEO 제목', nullable: true })
  seoTitle: string | null;

  @ApiProperty({ description: 'SEO 설명', nullable: true })
  seoDescription: string | null;

  @ApiProperty({ description: 'SEO 키워드', type: [String], nullable: true })
  seoKeywords: string[] | null;

  @ApiProperty({ description: '승인 상태' })
  approvalStatus: string;

  @ApiProperty({ description: '제품 타입' })
  productType: string;

  @ApiProperty({ description: '제품 코드', nullable: true })
  productCode: string | null;

  @ApiProperty({ description: '도매회원 전용 여부' })
  isWholesaleOnly: boolean;

  @ApiProperty({ description: '멤버십가 비공개 여부 (비회원에게 멤버십가 숨김 — 상품 노출·구매 제한 아님)' })
  isMembershipOnly: boolean;

  @ApiProperty({ description: '생성일시' })
  createdAt: string;

  @ApiProperty({ description: '수정일시' })
  updatedAt: string;

  @ApiProperty({ description: '삭제일시', nullable: true })
  deletedAt: string | null;

  @ApiProperty({
    description: '가격 요약 (일반가/멤버십가 최소·최대, 도매가 여부)',
    type: PriceSummaryDto,
    nullable: true,
  })
  priceSummary: PriceSummaryDto | null;
}

export class ProductListItemDto {
  @ApiProperty({ description: 'Version ID' })
  id: string;

  @ApiProperty({ description: 'Master ID' })
  masterId: string;

  @ApiProperty({ description: '제품명' })
  name: string;

  @ApiProperty({ description: '썸네일', nullable: true })
  thumbnail: string | null;

  @ApiProperty({ description: '제품 상태' })
  status: string;

  @ApiProperty({ description: '생성일시' })
  createdAt: string;
}

export class ProductListResponseDto {
  @ApiProperty({ description: '제품 목록', type: [ProductListItemDto] })
  data: ProductListItemDto[];

  @ApiProperty({ description: '페이지 번호' })
  page: number;

  @ApiProperty({ description: '페이지당 아이템 수' })
  limit: number;

  @ApiProperty({ description: '전체 아이템 수' })
  total: number;
}

export class MasterProductWithPrimaryVersionDto extends ProductMasterEntity {
  @ApiProperty({ description: '주 버전', type: ProductVersionDto, nullable: true })
  primaryVersion: ProductVersionDto | null;
}

export class ProductSummaryDto {
  @ApiProperty({ description: '마스터 상품 ID' })
  masterId: string;

  @ApiProperty({ description: '상품 버전 ID' })
  versionId: string;

  @ApiProperty({ description: '상품명' })
  name: string;

  @ApiProperty({ description: '썸네일 이미지 URL', nullable: true })
  thumbnail: string | null;

  @ApiProperty({ description: '브랜드', nullable: true })
  brand: string | null;

  @ApiProperty({ description: '멤버십가 비공개 여부 (비회원에게 멤버십가 숨김 — 상품 노출·구매 제한 아님)' })
  isMembershipOnly: boolean;

  @ApiProperty({ description: '상품 상태', enum: ['draft', 'inactive', 'active'] })
  status: string;

  @ApiProperty({ description: '생성일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: '옵션 그룹 이름 리스트' })
  optionGroupNames: string[];

  @ApiProperty({ description: '변형 개수' })
  variantCount: number;

  @ApiProperty({
    description: '가격 요약 (일반가/멤버십가 최소·최대, 도매가 여부)',
    type: PriceSummaryDto,
    nullable: true,
  })
  priceSummary: PriceSummaryDto | null;
}
