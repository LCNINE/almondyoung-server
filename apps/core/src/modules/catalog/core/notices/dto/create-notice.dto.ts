import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateNoticeDto {
  @ApiProperty({ description: '공지 제목', example: '[공지] 2024년 설 연휴 배송 안내' })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiProperty({ description: '공지 본문 (HTML/마크다운 가능)' })
  @IsString()
  content: string;

  @ApiProperty({
    description: '공지 분류',
    example: 'general',
    enum: ['general', 'event', 'delivery', 'service'],
    default: 'general',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @ApiProperty({
    description: '시각적 강조 뱃지',
    required: false,
    nullable: true,
    example: 'important',
    enum: ['important', 'urgent', 'new'],
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  badge?: string;

  @ApiProperty({ description: '상단 고정 여부', default: false })
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @ApiProperty({ description: '게시 시작 일시 (ISO 8601)', required: false })
  @IsOptional()
  @IsDateString()
  displayStartAt?: string;

  @ApiProperty({ description: '게시 종료 일시 (ISO 8601)', required: false })
  @IsOptional()
  @IsDateString()
  displayEndAt?: string;

  @ApiProperty({ description: '활성화 여부', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ description: '정렬 순서 (낮을수록 위)', default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiProperty({ description: '생성자 ID', required: false })
  @IsOptional()
  @IsString()
  createdBy?: string;
}
