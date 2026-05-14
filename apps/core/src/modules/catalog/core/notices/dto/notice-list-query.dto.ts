import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

const toBool = ({ value }: { value: unknown }) =>
  value === undefined || value === '' ? undefined : value === 'true';

export class NoticeListQueryDto {
  @ApiPropertyOptional({
    description: '공지 분류',
    enum: ['general', 'event', 'delivery', 'service'],
  })
  @IsOptional()
  @IsIn(['general', 'event', 'delivery', 'service'])
  category?: string;

  @ApiPropertyOptional({
    description: '비활성 공지 포함 여부 (isActive 미지정 시에만 적용)',
    type: Boolean,
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeInactive?: boolean;

  @ApiPropertyOptional({ description: '공개 여부', type: Boolean })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: '상단 고정 여부', type: Boolean })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isPinned?: boolean;

  @ApiPropertyOptional({
    description: '뱃지',
    enum: ['important', 'urgent', 'new'],
  })
  @IsOptional()
  @IsIn(['important', 'urgent', 'new'])
  badge?: string;

  @ApiPropertyOptional({ description: '제목 검색 (부분 일치, 대소문자 무시)' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;
}
