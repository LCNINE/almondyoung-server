import { ApiProperty } from '@nestjs/swagger';

export class TopNoticeResponseDto {
  @ApiProperty({ description: '띠 ID' })
  id: string;

  @ApiProperty({ description: '띠 문구' })
  text: string;

  @ApiProperty({ description: '띠 클릭 시 이동할 주소', required: false, nullable: true })
  linkUrl: string | null;

  @ApiProperty({ description: '게시 시작 일시 (ISO 8601)', required: false, nullable: true })
  displayStartAt: string | null;

  @ApiProperty({ description: '게시 종료 일시 (ISO 8601)', required: false, nullable: true })
  displayEndAt: string | null;

  @ApiProperty({ description: '활성화 여부' })
  isActive: boolean;

  @ApiProperty({ description: '정렬 순서 (낮을수록 먼저 노출)' })
  sortOrder: number;

  @ApiProperty({ description: '생성 시간 (ISO 8601)' })
  createdAt: string;

  @ApiProperty({ description: '수정 시간 (ISO 8601)' })
  updatedAt: string;
}

/** 스토어프론트가 받는 모양. 띠를 그리는 데 필요한 값만 내보낸다. */
export class TopNoticePublicDto {
  @ApiProperty({ description: '띠 ID' })
  id: string;

  @ApiProperty({ description: '띠 문구' })
  text: string;

  @ApiProperty({ description: '띠 클릭 시 이동할 주소', required: false, nullable: true })
  linkUrl: string | null;
}
