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

export class CreateSitePopupDto {
  @ApiProperty({ description: '팝업 제목', example: '회원가입 리뉴얼 안내' })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiProperty({ description: '본문 형식', enum: SITE_POPUP_CONTENT_TYPES, default: 'rich_text' })
  @IsOptional()
  @IsIn(SITE_POPUP_CONTENT_TYPES)
  contentType?: SitePopupContentType;

  @ApiProperty({ description: '본문 HTML (contentType=rich_text 일 때 필수)', required: false })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiProperty({ description: 'PC 이미지 파일 ID (contentType=image 일 때 필수)', required: false })
  @IsOptional()
  @IsUUID()
  pcImageFileId?: string;

  @ApiProperty({ description: '모바일 이미지 파일 ID. 생략하면 PC 이미지를 함께 쓴다.', required: false })
  @IsOptional()
  @IsUUID()
  mobileImageFileId?: string;

  @ApiProperty({ description: '이미지 대체 텍스트', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  imageAlt?: string;

  @ApiProperty({ description: '팝업 클릭 시 이동할 URL', required: false })
  @IsOptional()
  @IsString()
  linkUrl?: string;

  @ApiProperty({ description: '연결할 공지사항 ID (자세히 보기)', required: false })
  @IsOptional()
  @IsUUID()
  noticeId?: string;

  @ApiProperty({ description: 'PC 노출 폭(px)', required: false, minimum: SITE_POPUP_MIN_SIZE })
  @IsOptional()
  @IsInt()
  @Min(SITE_POPUP_MIN_SIZE)
  @Max(SITE_POPUP_MAX_SIZE)
  pcWidth?: number;

  @ApiProperty({ description: 'PC 노출 높이(px). 비우면 내용 비율대로 자동', required: false })
  @IsOptional()
  @IsInt()
  @Min(SITE_POPUP_MIN_SIZE)
  @Max(SITE_POPUP_MAX_SIZE)
  pcHeight?: number;

  @ApiProperty({ description: '모바일 노출 폭(px)', required: false })
  @IsOptional()
  @IsInt()
  @Min(SITE_POPUP_MIN_SIZE)
  @Max(SITE_POPUP_MAX_SIZE)
  mobileWidth?: number;

  @ApiProperty({ description: '모바일 노출 높이(px). 비우면 자동', required: false })
  @IsOptional()
  @IsInt()
  @Min(SITE_POPUP_MIN_SIZE)
  @Max(SITE_POPUP_MAX_SIZE)
  mobileHeight?: number;

  @ApiProperty({ description: '노출 위치', enum: SITE_POPUP_PLACEMENTS, default: 'main' })
  @IsOptional()
  @IsIn(SITE_POPUP_PLACEMENTS)
  placement?: SitePopupPlacement;

  @ApiProperty({
    description: 'placement=paths 일 때 매칭할 경로 prefix 목록 (예: /products)',
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  placementPaths?: string[];

  @ApiProperty({ description: '노출 대상', enum: SITE_POPUP_AUDIENCES, default: 'all' })
  @IsOptional()
  @IsIn(SITE_POPUP_AUDIENCES)
  audience?: SitePopupAudience;

  @ApiProperty({ description: '다시 보지 않기 방식', enum: SITE_POPUP_DISMISS_MODES, default: 'today' })
  @IsOptional()
  @IsIn(SITE_POPUP_DISMISS_MODES)
  dismissMode?: SitePopupDismissMode;

  @ApiProperty({ description: 'dismissMode=days 일 때 숨김 일수', required: false, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  dismissDays?: number;

  @ApiProperty({ description: '게시 시작 일시', required: false })
  @IsOptional()
  @IsDateString()
  displayStartAt?: string;

  @ApiProperty({ description: '게시 종료 일시', required: false })
  @IsOptional()
  @IsDateString()
  displayEndAt?: string;

  @ApiProperty({ description: '활성화 여부', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ description: '정렬 순서 (낮을수록 먼저)', default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
