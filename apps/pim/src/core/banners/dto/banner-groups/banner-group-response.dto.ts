import { ApiProperty } from '@nestjs/swagger';

export class BannerGroupResponseDto {
  @ApiProperty({ description: '배너 그룹 ID' })
  id: string;

  @ApiProperty({ description: '배너 그룹 코드' })
  code: string;

  @ApiProperty({ description: '배너 그룹 제목' })
  title: string;

  @ApiProperty({ description: '배너 그룹 카테고리' })
  category: string;

  @ApiProperty({ description: 'PC 이미지 너비(px)', required: false, nullable: true })
  pcWidth: number | null;

  @ApiProperty({ description: 'PC 이미지 높이(px)', required: false, nullable: true })
  pcHeight: number | null;

  @ApiProperty({ description: '모바일 이미지 너비(px)', required: false, nullable: true })
  mobileWidth: number | null;

  @ApiProperty({ description: '모바일 이미지 높이(px)', required: false, nullable: true })
  mobileHeight: number | null;

  @ApiProperty({ description: '설명', required: false, nullable: true })
  description: string | null;

  @ApiProperty({ description: '활성화 여부' })
  isActive: boolean;

  @ApiProperty({ description: '정렬 순서' })
  sortOrder: number;

  @ApiProperty({ description: '삭제 시간', required: false, nullable: true })
  deletedAt: Date | null;

  @ApiProperty({ description: '생성 시간' })
  createdAt: Date;

  @ApiProperty({ description: '수정 시간' })
  updatedAt: Date;
}

