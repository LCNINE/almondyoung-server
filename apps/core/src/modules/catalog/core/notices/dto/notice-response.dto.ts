import { ApiProperty } from '@nestjs/swagger';

export class NoticeResponseDto {
  @ApiProperty({ description: '공지 ID' })
  id: string;

  @ApiProperty({ description: '공지 제목' })
  title: string;

  @ApiProperty({ description: '공지 본문' })
  content: string;

  @ApiProperty({ description: '공지 분류', example: 'general' })
  category: string;

  @ApiProperty({ description: '시각적 강조 뱃지', required: false, nullable: true, example: 'important' })
  badge: string | null;

  @ApiProperty({ description: '상단 고정 여부' })
  isPinned: boolean;

  @ApiProperty({
    description: '게시 시작 일시 (ISO 8601)',
    required: false,
    nullable: true,
    example: '2026-01-25T00:00:00.000Z',
  })
  displayStartAt: string | null;

  @ApiProperty({
    description: '게시 종료 일시 (ISO 8601)',
    required: false,
    nullable: true,
    example: '2026-02-13T00:00:00.000Z',
  })
  displayEndAt: string | null;

  @ApiProperty({ description: '활성화 여부' })
  isActive: boolean;

  @ApiProperty({ description: '정렬 순서' })
  sortOrder: number;

  @ApiProperty({
    description: '삭제 시간 (ISO 8601)',
    required: false,
    nullable: true,
  })
  deletedAt: string | null;

  @ApiProperty({ description: '생성 시간 (ISO 8601)', example: '2026-01-25T00:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: '수정 시간 (ISO 8601)', example: '2026-01-25T00:00:00.000Z' })
  updatedAt: string;
}
