import { ApiProperty } from '@nestjs/swagger';

export class ProductDto {
  @ApiProperty({ description: 'Version ID' })
  id: string;

  @ApiProperty({ description: 'Master ID' })
  masterId: string;

  @ApiProperty({ description: 'Version number' })
  version: number;

  @ApiProperty({ description: 'Version status', enum: ['draft', 'inactive', 'active'] })
  versionStatus: string;

  @ApiProperty({ description: '제품명' })
  name: string;

  @ApiProperty({ description: '제품 설명', nullable: true })
  description: string | null;

  @ApiProperty({ description: '브랜드', nullable: true })
  brand: string | null;

  @ApiProperty({ description: '썸네일', nullable: true })
  thumbnail: string | null;

  @ApiProperty({ description: '이미지', nullable: true })
  images: any;

  @ApiProperty({ description: '속성', nullable: true })
  attributes: any;

  @ApiProperty({ description: 'SEO 제목', nullable: true })
  seoTitle: string | null;

  @ApiProperty({ description: 'SEO 설명', nullable: true })
  seoDescription: string | null;

  @ApiProperty({ description: 'SEO 키워드', type: [String], nullable: true })
  seoKeywords: string[] | null;

  @ApiProperty({ description: '제품 상태' })
  status: string;

  @ApiProperty({ description: '승인 상태' })
  approvalStatus: string;

  @ApiProperty({ description: '제품 타입' })
  productType: string;

  @ApiProperty({ description: '제품 코드', nullable: true })
  productCode: string | null;

  @ApiProperty({ description: '도매회원 전용 여부' })
  isWholesaleOnly: boolean;

  @ApiProperty({ description: '멤버십회원 전용 여부' })
  isMembershipOnly: boolean;

  @ApiProperty({ description: '생성일시' })
  createdAt: string;

  @ApiProperty({ description: '수정일시' })
  updatedAt: string;

  @ApiProperty({ description: '삭제일시', nullable: true })
  deletedAt: string | null;
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

