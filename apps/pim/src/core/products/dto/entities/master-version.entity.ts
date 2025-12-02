import { ApiProperty } from "@nestjs/swagger";

export class ProductMasterVersionEntity {
  @ApiProperty({ description: '버전 ID' })
  id: string;

  @ApiProperty({ description: '버전 번호' })
  version: number;

  @ApiProperty({ description: '부모 버전 ID', nullable: true })
  parentVersionId: string | null;

  @ApiProperty({ description: '버전 상태', enum: ['draft', 'inactive', 'active'] })
  versionStatus: 'draft' | 'inactive' | 'active';

  @ApiProperty({ description: '버전 초안 소유자 ID' })
  draftOwnerId: string | null; // nullable

  @ApiProperty({ description: '상품명' })
  name: string;

  @ApiProperty({ description: '상품 설명', nullable: true })
  description: string | null;

  @ApiProperty({ description: '브랜드', nullable: true })
  brand: string | null;

  @ApiProperty({ description: '썸네일 이미지 파일 ID', nullable: true })
  thumbnail: string | null;

  @ApiProperty({ description: '마케팅 태그', nullable: true })
  tags: string[] | null;

  @ApiProperty({ description: '상품 이미지' })
  images: string[];

  @ApiProperty({ description: '판매 관련 속성' })
  attributes: Record<string, any>;

  @ApiProperty({ description: 'SEO 제목' })
  seoTitle: string;

  @ApiProperty({ description: 'SEO 설명' })
  seoDescription: string;

  @ApiProperty({ description: 'SEO 키워드' })
  seoKeywords: string[];

  @ApiProperty({ description: '상품 상태 (아마 Legacy)', enum: ['active', 'inactive', 'draft'] })
  status: 'active' | 'inactive' | 'draft';

  @ApiProperty({ description: '도매회원 전용' })
  isWholesaleOnly: boolean;

  @ApiProperty({ description: '멤버십회원 전용' })
  isMembershipOnly: boolean;

  @ApiProperty({ description: '상품 타입', enum: ['limited_edition', 'regular_sale'] })
  productType: 'limited_edition' | 'regular_sale';

  @ApiProperty({ description: '상품 코드' })
  productCode: string;

  @ApiProperty({ description: '상품 별칭', nullable: true })
  alternativeName: string | null;

  @ApiProperty({ description: '원재료', nullable: true })
  material: string | null;

  @ApiProperty({ description: '판매 분류', nullable: true })
  salesClassification: string | null;

  @ApiProperty({ description: '구매 분류', nullable: true })
  purchaseClassification: string | null;

  @ApiProperty({ description: '배송 방법 ID', nullable: true })
  shippingMethodId: string | null;

  @ApiProperty({ description: '소비자가', nullable: true })
  marketPrice: number | null;

  @ApiProperty({ description: '공급가', nullable: true })
  supplyPrice: number | null;

  @ApiProperty({ description: '공급자 ID', nullable: true })
  supplierId: string | null;

  @ApiProperty({ description: '나이 제한' })
  ageRestriction: number;

  @ApiProperty({ description: '최소 수량' })
  minQuantity: number;

  @ApiProperty({ description: '최대 수량' })
  maxQuantity: number | null;

  @ApiProperty({ description: '판매 시작일', nullable: true })
  salesStartDate: Date | null;

  @ApiProperty({ description: '판매 종료일', nullable: true })
  salesEndDate: Date | null;

  @ApiProperty({ description: '승인 상태', enum: ['draft', 'pending', 'approved', 'rejected'] })
  approvalStatus: 'draft' | 'pending' | 'approved' | 'rejected';

  @ApiProperty({ description: '승인 일시', nullable: true })
  approvedAt: Date | null;

  @ApiProperty({ description: '승인자', nullable: true })
  approvedBy: string | null;

  @ApiProperty({ description: '거절 이유', nullable: true })
  rejectionReason: string | null;

  @ApiProperty({ description: '삭제 일시', nullable: true })
  deletedAt: Date | null;

  @ApiProperty({ description: '삭제자', nullable: true })
  deletedBy: string | null;

  @ApiProperty({ description: '판매자', nullable: true })
  seller: string | null;

  @ApiProperty({ description: '등록일시' })
  registrationDate: Date;

  @ApiProperty({ description: '최종 수정일시' })
  lastEditDate: Date;

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;

  @ApiProperty({ description: '생성자' })
  createdBy: string;

  @ApiProperty({ description: '수정자' })
  updatedBy: string;
}
