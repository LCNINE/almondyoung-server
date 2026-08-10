import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { SITE_POPUP_AUDIENCES, SITE_POPUP_PLACEMENTS, SitePopupAudience, SitePopupPlacement } from '../site-popup.constants';

const toBool = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : value === 'true');

export class SitePopupListQueryDto {
  @ApiPropertyOptional({ description: '비활성 팝업 포함 여부 (isActive 미지정 시에만 적용)', type: Boolean })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeInactive?: boolean;

  @ApiPropertyOptional({ description: '활성 여부', type: Boolean })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: '노출 위치', enum: SITE_POPUP_PLACEMENTS })
  @IsOptional()
  @IsIn(SITE_POPUP_PLACEMENTS)
  placement?: SitePopupPlacement;

  @ApiPropertyOptional({ description: '노출 대상', enum: SITE_POPUP_AUDIENCES })
  @IsOptional()
  @IsIn(SITE_POPUP_AUDIENCES)
  audience?: SitePopupAudience;

  @ApiPropertyOptional({ description: '제목 검색 (부분 일치, 대소문자 무시)' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;
}
