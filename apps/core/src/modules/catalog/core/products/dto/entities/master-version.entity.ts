import { ApiProperty } from '@nestjs/swagger';

export class ProductVersionDto {
  @ApiProperty({ description: '버전 ID' })
  id: string;

  @ApiProperty({ description: '버전 번호' })
  version: number;

  @ApiProperty({ description: '부모 버전 ID', nullable: true })
  parentVersionId: string | null;

  @ApiProperty({ description: '버전 상태', enum: ['draft', 'inactive', 'active'] })
  status: 'draft' | 'inactive' | 'active';

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

  @ApiProperty({ description: 'SEO 제목', nullable: true })
  seoTitle: string | null;

  @ApiProperty({ description: 'SEO 설명', nullable: true })
  seoDescription: string | null;

  @ApiProperty({ description: 'SEO 키워드', nullable: true })
  seoKeywords: string[] | null;

  @ApiProperty({ description: '도매회원 전용' })
  isWholesaleOnly: boolean;

  @ApiProperty({ description: '멤버십가 비공개 여부 (비회원에게 멤버십가 숨김 — 상품 노출·구매 제한 아님)' })
  hideMembershipPriceForNonMembers: boolean;

  @ApiProperty({ description: '멤버십 회원 전용 노출 여부 (비회원 목록·검색·상세에서 숨김)' })
  isVisibleToMembersOnly: boolean;

  @ApiProperty({ description: '해외직구 상품 여부 (체크아웃 시 개인통관고유부호 필수)' })
  isOverseas: boolean;

  @ApiProperty({
    description: 'Deprecated. hideMembershipPriceForNonMembers를 사용하세요.',
    deprecated: true,
  })
  isMembershipOnly: boolean;

  @ApiProperty({ description: '상품 타입' })
  productType: string;

  @ApiProperty({ description: '이행 유형', enum: ['physical', 'digital'], default: 'physical' })
  fulfillmentKind: 'physical' | 'digital';

  @ApiProperty({ description: '상품 코드', nullable: true })
  productCode: string | null;

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

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;

  @ApiProperty({ description: '생성자', nullable: true })
  createdBy: string | null;

  @ApiProperty({ description: '수정자', nullable: true })
  updatedBy: string | null;
}
