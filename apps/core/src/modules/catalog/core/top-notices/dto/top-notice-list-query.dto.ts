import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

const toBool = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : value === 'true');

export class TopNoticeListQueryDto {
  @ApiPropertyOptional({ description: '비활성 띠 포함 여부 (isActive 미지정 시에만 적용)', type: Boolean })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeInactive?: boolean;

  @ApiPropertyOptional({ description: '활성 여부', type: Boolean })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: '문구 검색 (부분 일치, 대소문자 무시)' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;
}
