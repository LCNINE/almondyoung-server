import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  SITE_POPUP_AUDIENCES,
  SITE_POPUP_CONTENT_TYPES,
  SITE_POPUP_DISMISS_MODES,
  SITE_POPUP_MAX_SIZE,
  SITE_POPUP_MIN_SIZE,
  SITE_POPUP_PLACEMENTS,
  SitePopupAudience,
  SitePopupContentType,
  SitePopupDismissMode,
  SitePopupPlacement,
} from '../site-popup.constants';

/** 값을 비우려면 null 을 보낸다. 필드를 생략하면 기존 값이 유지된다. */
const Nullable = () => ValidateIf((_object, value) => value !== null);

export class UpdateSitePopupDto {
  @ApiProperty({ description: '팝업 제목', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiProperty({ description: '본문 형식', enum: SITE_POPUP_CONTENT_TYPES, required: false })
  @IsOptional()
  @IsIn(SITE_POPUP_CONTENT_TYPES)
  contentType?: SitePopupContentType;

  @ApiProperty({ description: '본문 HTML', required: false, nullable: true })
  @IsOptional()
  @Nullable()
  @IsString()
  content?: string | null;

  @ApiProperty({ description: 'PC 이미지 파일 ID', required: false, nullable: true })
  @IsOptional()
  @Nullable()
  @IsUUID()
  pcImageFileId?: string | null;

  @ApiProperty({ description: '모바일 이미지 파일 ID', required: false, nullable: true })
  @IsOptional()
  @Nullable()
  @IsUUID()
  mobileImageFileId?: string | null;

  @ApiProperty({ description: '이미지 대체 텍스트', required: false, nullable: true })
  @IsOptional()
  @Nullable()
  @IsString()
  @MaxLength(255)
  imageAlt?: string | null;

  @ApiProperty({ description: '팝업 클릭 시 이동할 URL', required: false, nullable: true })
  @IsOptional()
  @Nullable()
  @IsString()
  linkUrl?: string | null;

  @ApiProperty({ description: '연결할 공지사항 ID', required: false, nullable: true })
  @IsOptional()
  @Nullable()
  @IsUUID()
  noticeId?: string | null;

  @ApiProperty({ description: 'PC 노출 폭(px)', required: false, nullable: true })
  @IsOptional()
  @Nullable()
  @IsInt()
  @Min(SITE_POPUP_MIN_SIZE)
  @Max(SITE_POPUP_MAX_SIZE)
  pcWidth?: number | null;

  @ApiProperty({ description: 'PC 노출 높이(px)', required: false, nullable: true })
  @IsOptional()
  @Nullable()
  @IsInt()
  @Min(SITE_POPUP_MIN_SIZE)
  @Max(SITE_POPUP_MAX_SIZE)
  pcHeight?: number | null;

  @ApiProperty({ description: '모바일 노출 폭(px)', required: false, nullable: true })
  @IsOptional()
  @Nullable()
  @IsInt()
  @Min(SITE_POPUP_MIN_SIZE)
  @Max(SITE_POPUP_MAX_SIZE)
  mobileWidth?: number | null;

  @ApiProperty({ description: '모바일 노출 높이(px)', required: false, nullable: true })
  @IsOptional()
  @Nullable()
  @IsInt()
  @Min(SITE_POPUP_MIN_SIZE)
  @Max(SITE_POPUP_MAX_SIZE)
  mobileHeight?: number | null;

  @ApiProperty({ description: '노출 위치', enum: SITE_POPUP_PLACEMENTS, required: false })
  @IsOptional()
  @IsIn(SITE_POPUP_PLACEMENTS)
  placement?: SitePopupPlacement;

  @ApiProperty({ description: '경로 prefix 목록', type: [String], required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  placementPaths?: string[];

  @ApiProperty({ description: '노출 대상', enum: SITE_POPUP_AUDIENCES, required: false })
  @IsOptional()
  @IsIn(SITE_POPUP_AUDIENCES)
  audience?: SitePopupAudience;

  @ApiProperty({ description: '다시 보지 않기 방식', enum: SITE_POPUP_DISMISS_MODES, required: false })
  @IsOptional()
  @IsIn(SITE_POPUP_DISMISS_MODES)
  dismissMode?: SitePopupDismissMode;

  @ApiProperty({ description: 'dismissMode=days 일 때 숨김 일수', required: false, nullable: true })
  @IsOptional()
  @Nullable()
  @IsInt()
  @Min(1)
  @Max(365)
  dismissDays?: number | null;

  @ApiProperty({ description: '게시 시작 일시', required: false, nullable: true })
  @IsOptional()
  @Nullable()
  @IsDateString()
  displayStartAt?: string | null;

  @ApiProperty({ description: '게시 종료 일시', required: false, nullable: true })
  @IsOptional()
  @Nullable()
  @IsDateString()
  displayEndAt?: string | null;

  @ApiProperty({ description: '활성화 여부', required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ description: '정렬 순서', required: false })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
