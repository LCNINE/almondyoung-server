import { ApiProperty } from '@nestjs/swagger';

export class BannerResponseDto {
  @ApiProperty({ description: '배너 ID' })
  id: string;

  @ApiProperty({ description: '배너 그룹 ID' })
  bannerGroupId: string;

  @ApiProperty({ description: '배너 제목' })
  title: string;

  @ApiProperty({ description: '배너 설명', required: false, nullable: true })
  description: string | null;

  @ApiProperty({ description: 'PC 이미지 파일 ID (file-service)' })
  pcImageFileId: string;

  @ApiProperty({ description: '모바일 이미지 파일 ID (file-service)' })
  mobileImageFileId: string;

  @ApiProperty({ description: '클릭 시 이동할 URL', required: false, nullable: true })
  linkUrl: string | null;

  @ApiProperty({
    description: '연결된 제품 마스터 ID 배열',
    type: [String],
    required: false,
    nullable: true,
  })
  linkedProductMasterIds: string[] | null;

  @ApiProperty({
    description: '게시 시작 일시 (ISO 8601 형식)',
    required: false,
    nullable: true,
    example: '2025-12-05T10:30:00.000Z',
  })
  displayStartAt: string | null;

  @ApiProperty({
    description: '게시 종료 일시 (ISO 8601 형식)',
    required: false,
    nullable: true,
    example: '2025-12-05T10:30:00.000Z',
  })
  displayEndAt: string | null;

  @ApiProperty({ description: '활성화 여부' })
  isActive: boolean;

  @ApiProperty({ description: '정렬 순서' })
  sortOrder: number;

  @ApiProperty({
    description: '삭제 시간 (ISO 8601 형식)',
    required: false,
    nullable: true,
    example: '2025-12-05T10:30:00.000Z',
  })
  deletedAt: string | null;

  @ApiProperty({ description: '생성 시간 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: '수정 시간 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  updatedAt: string;
}
