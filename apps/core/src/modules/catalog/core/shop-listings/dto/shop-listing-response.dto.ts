import { ApiProperty } from '@nestjs/swagger';

export class ShopListingResponseDto {
  @ApiProperty({ description: '샵매매 글 ID' })
  id: string;

  @ApiProperty({ description: '상세 URL 주소' })
  slug: string;

  @ApiProperty({ description: '글 제목' })
  title: string;

  @ApiProperty({ description: '본문 (HTML)' })
  content: string;

  @ApiProperty({ description: '지역 (시·도)', required: false, nullable: true })
  region: string | null;

  @ApiProperty({ description: '업종', required: false, nullable: true })
  businessType: string | null;

  @ApiProperty({ description: '거래 유형', required: false, nullable: true })
  dealType: string | null;

  @ApiProperty({ description: '전용 평수', required: false, nullable: true })
  areaPyeong: number | null;

  @ApiProperty({ description: '보증금 (원)', required: false, nullable: true })
  deposit: number | null;

  @ApiProperty({ description: '월세 (원)', required: false, nullable: true })
  monthlyRent: number | null;

  @ApiProperty({ description: '권리금 (원)', required: false, nullable: true })
  keyMoney: number | null;

  @ApiProperty({ description: '대표 이미지 fileId', required: false, nullable: true })
  thumbnailFileId: string | null;

  @ApiProperty({ description: '노출 여부' })
  isActive: boolean;

  @ApiProperty({ description: '삭제 시간 (ISO 8601)', required: false, nullable: true })
  deletedAt: string | null;

  @ApiProperty({ description: '생성 시간 (ISO 8601)' })
  createdAt: string;

  @ApiProperty({ description: '수정 시간 (ISO 8601)' })
  updatedAt: string;
}
