import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateNoticeDto {
  @ApiProperty({ description: '공지 제목', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiProperty({ description: '공지 본문', required: false })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiProperty({ description: '공지 분류', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @ApiProperty({ description: '시각적 강조 뱃지', required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  badge?: string | null;

  @ApiProperty({ description: '상단 고정 여부', required: false })
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

  @ApiProperty({ description: '활성화 여부', required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ description: '정렬 순서', required: false })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiProperty({ description: '수정자 ID', required: false })
  @IsOptional()
  @IsString()
  updatedBy?: string;
}
