import { ApiProperty } from '@nestjs/swagger';
import {
  SITE_POPUP_AUDIENCES,
  SITE_POPUP_CONTENT_TYPES,
  SITE_POPUP_DISMISS_MODES,
  SITE_POPUP_PLACEMENTS,
  SitePopupAudience,
  SitePopupContentType,
  SitePopupDismissMode,
  SitePopupPlacement,
} from '../site-popup.constants';

export class SitePopupResponseDto {
  @ApiProperty({ description: '팝업 ID' })
  id: string;

  @ApiProperty({ description: '팝업 제목 (헤더에 노출)' })
  title: string;

  @ApiProperty({ description: '본문 형식', enum: SITE_POPUP_CONTENT_TYPES })
  contentType: SitePopupContentType;

  @ApiProperty({ description: '본문 HTML (rich_text 일 때)', required: false, nullable: true })
  content: string | null;

  @ApiProperty({ description: 'PC 이미지 파일 ID (image 일 때)', required: false, nullable: true })
  pcImageFileId: string | null;

  @ApiProperty({
    description: '모바일 이미지 파일 ID. 없으면 PC 이미지를 함께 쓴다.',
    required: false,
    nullable: true,
  })
  mobileImageFileId: string | null;

  @ApiProperty({ description: '이미지 대체 텍스트', required: false, nullable: true })
  imageAlt: string | null;

  @ApiProperty({ description: '팝업 클릭 시 이동할 URL', required: false, nullable: true })
  linkUrl: string | null;

  @ApiProperty({ description: '연결된 공지사항 ID (자세히 보기)', required: false, nullable: true })
  noticeId: string | null;

  @ApiProperty({ description: 'PC 노출 폭(px). null 이면 기본값', required: false, nullable: true })
  pcWidth: number | null;

  @ApiProperty({ description: 'PC 노출 높이(px). null 이면 내용 비율대로 자동', required: false, nullable: true })
  pcHeight: number | null;

  @ApiProperty({ description: '모바일 노출 폭(px). null 이면 기본값', required: false, nullable: true })
  mobileWidth: number | null;

  @ApiProperty({ description: '모바일 노출 높이(px). null 이면 자동', required: false, nullable: true })
  mobileHeight: number | null;

  @ApiProperty({ description: '노출 위치', enum: SITE_POPUP_PLACEMENTS })
  placement: SitePopupPlacement;

  @ApiProperty({ description: 'placement=paths 일 때 매칭할 경로 prefix 목록', type: [String] })
  placementPaths: string[];

  @ApiProperty({ description: '노출 대상', enum: SITE_POPUP_AUDIENCES })
  audience: SitePopupAudience;

  @ApiProperty({ description: '다시 보지 않기 방식', enum: SITE_POPUP_DISMISS_MODES })
  dismissMode: SitePopupDismissMode;

  @ApiProperty({ description: 'dismissMode=days 일 때 숨김 일수', required: false, nullable: true })
  dismissDays: number | null;

  @ApiProperty({ description: '숨김 버전 — 올리면 이미 닫은 방문자에게도 다시 노출된다' })
  dismissVersion: number;

  @ApiProperty({ description: '게시 시작 일시 (ISO 8601)', required: false, nullable: true })
  displayStartAt: string | null;

  @ApiProperty({ description: '게시 종료 일시 (ISO 8601)', required: false, nullable: true })
  displayEndAt: string | null;

  @ApiProperty({ description: '활성화 여부' })
  isActive: boolean;

  @ApiProperty({ description: '정렬 순서 (낮을수록 먼저 노출)' })
  sortOrder: number;

  @ApiProperty({ description: '삭제 시간 (ISO 8601)', required: false, nullable: true })
  deletedAt: string | null;

  @ApiProperty({ description: '생성 시간 (ISO 8601)' })
  createdAt: string;

  @ApiProperty({ description: '수정 시간 (ISO 8601)' })
  updatedAt: string;
}
