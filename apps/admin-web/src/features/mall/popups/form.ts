// 배럴(index.tsx)이 아니라 잎 모듈에서 가져온다 — 배럴은 tiptap 에디터를 함께 끌고 와서
// 이 순수 폼 모델을 브라우저 밖(스펙)에서 불러올 수 없게 만든다.
import { isEmptyHtml } from '@/components/common/rich-text-editor/is-empty-html';
import { localInputToIso } from '@/lib/utils/datetime';
import type {
  CreateSitePopupDto,
  SitePopupAudience,
  SitePopupContentType,
  SitePopupDismissMode,
  SitePopupDto,
  SitePopupPlacement,
  UpdateSitePopupDto,
} from '@/lib/types/dto/products';

/**
 * 팝업 등록/수정 폼의 값. 입력 요소에 맞춰 숫자·일시도 문자열로 들고 있다가
 * 전송 직전에 DTO 로 바꾼다. 등록 다이얼로그와 수정 화면이 같은 모델을 쓰므로
 * 검증·변환 규칙이 한 곳에만 존재한다.
 */
export type SitePopupFormValue = {
  title: string;
  contentType: SitePopupContentType;
  content: string;
  pcImageFileId: string | null;
  mobileImageFileId: string | null;
  imageAlt: string;
  linkUrl: string;
  noticeId: string | null;
  pcWidth: string;
  pcHeight: string;
  mobileWidth: string;
  mobileHeight: string;
  placement: SitePopupPlacement;
  /** 줄바꿈으로 구분된 경로 목록 */
  placementPathsText: string;
  audience: SitePopupAudience;
  dismissMode: SitePopupDismissMode;
  dismissDays: string;
  displayStartAt: string;
  displayEndAt: string;
  isActive: boolean;
  sortOrder: string;
};

export const DEFAULT_PC_WIDTH = 460;
export const DEFAULT_MOBILE_WIDTH = 340;
export const MIN_SIZE = 100;
export const MAX_SIZE = 2000;

export const EMPTY_POPUP_FORM: SitePopupFormValue = {
  title: '',
  contentType: 'rich_text',
  content: '',
  pcImageFileId: null,
  mobileImageFileId: null,
  imageAlt: '',
  linkUrl: '',
  noticeId: null,
  pcWidth: String(DEFAULT_PC_WIDTH),
  pcHeight: '',
  mobileWidth: String(DEFAULT_MOBILE_WIDTH),
  mobileHeight: '',
  placement: 'main',
  placementPathsText: '',
  audience: 'all',
  dismissMode: 'today',
  dismissDays: '',
  displayStartAt: '',
  displayEndAt: '',
  isActive: true,
  sortOrder: '0',
};

export const CONTENT_TYPE_LABEL: Record<SitePopupContentType, string> = {
  rich_text: '본문(글·이미지 혼합)',
  image: '이미지 한 장',
};

export const PLACEMENT_LABEL: Record<SitePopupPlacement, string> = {
  main: '메인 페이지만',
  all: '쇼핑몰 전체 페이지',
  paths: '지정한 경로',
};

export const AUDIENCE_LABEL: Record<SitePopupAudience, string> = {
  all: '전체',
  guest: '비로그인 방문자',
  member: '로그인 회원',
  membership: '멤버십 회원',
};

export const DISMISS_MODE_LABEL: Record<SitePopupDismissMode, string> = {
  none: '사용 안 함 (매번 노출)',
  today: '오늘 하루 보지 않기',
  days: 'N일간 보지 않기',
};

export function popupFormFromDto(dto: SitePopupDto): SitePopupFormValue {
  return {
    title: dto.title,
    contentType: dto.contentType,
    content: dto.content ?? '',
    pcImageFileId: dto.pcImageFileId,
    mobileImageFileId: dto.mobileImageFileId,
    imageAlt: dto.imageAlt ?? '',
    linkUrl: dto.linkUrl ?? '',
    noticeId: dto.noticeId,
    pcWidth: numToInput(dto.pcWidth),
    pcHeight: numToInput(dto.pcHeight),
    mobileWidth: numToInput(dto.mobileWidth),
    mobileHeight: numToInput(dto.mobileHeight),
    placement: dto.placement,
    placementPathsText: (dto.placementPaths ?? []).join('\n'),
    audience: dto.audience,
    dismissMode: dto.dismissMode,
    dismissDays: numToInput(dto.dismissDays),
    displayStartAt: isoToLocalInput(dto.displayStartAt),
    displayEndAt: isoToLocalInput(dto.displayEndAt),
    isActive: dto.isActive,
    sortOrder: String(dto.sortOrder ?? 0),
  };
}

/** 저장 전에 사람이 고칠 수 있는 문제를 잡는다. 통과하면 null. */
export function validatePopupForm(value: SitePopupFormValue): string | null {
  if (!value.title.trim()) return '제목을 입력해 주세요.';

  if (value.contentType === 'rich_text' && isEmptyHtml(value.content)) {
    return '본문을 입력해 주세요.';
  }

  if (value.contentType === 'image' && !value.pcImageFileId) {
    return 'PC 이미지를 업로드해 주세요.';
  }

  if (value.placement === 'paths' && parsePaths(value.placementPathsText).length === 0) {
    return '노출할 경로를 한 줄에 하나씩 입력해 주세요.';
  }

  if (
    value.placement === 'paths' &&
    parsePaths(value.placementPathsText).some((path) => !path.startsWith('/'))
  ) {
    return '노출 경로는 "/" 로 시작해야 합니다. (예: /products)';
  }

  if (value.dismissMode === 'days') {
    const days = Number(value.dismissDays);
    if (!value.dismissDays || Number.isNaN(days) || days < 1) {
      return '숨김 일수를 1일 이상으로 입력해 주세요.';
    }
  }

  for (const [label, raw] of [
    ['PC 너비', value.pcWidth],
    ['PC 높이', value.pcHeight],
    ['모바일 너비', value.mobileWidth],
    ['모바일 높이', value.mobileHeight],
  ] as const) {
    if (!raw) continue;
    const size = Number(raw);
    if (Number.isNaN(size) || size < MIN_SIZE || size > MAX_SIZE) {
      return `${label}는 ${MIN_SIZE}~${MAX_SIZE}px 사이로 입력해 주세요.`;
    }
  }

  const start = localInputToIso(value.displayStartAt);
  const end = localInputToIso(value.displayEndAt);
  if (start && end && new Date(end) <= new Date(start)) {
    return '게시 종료 일시는 시작 일시보다 뒤여야 합니다.';
  }

  if (value.linkUrl.trim() && !isSafeLink(value.linkUrl)) {
    return '링크는 http(s) 주소이거나 "/" 로 시작하는 사이트 내 경로여야 합니다.';
  }

  return null;
}

export function popupFormToCreateDto(value: SitePopupFormValue): CreateSitePopupDto {
  const isImage = value.contentType === 'image';

  return {
    title: value.title.trim(),
    contentType: value.contentType,
    content: isImage ? undefined : value.content,
    pcImageFileId: isImage ? (value.pcImageFileId ?? undefined) : undefined,
    mobileImageFileId: isImage ? (value.mobileImageFileId ?? undefined) : undefined,
    imageAlt: isImage ? orUndefined(value.imageAlt) : undefined,
    linkUrl: orUndefined(value.linkUrl),
    noticeId: value.noticeId ?? undefined,
    pcWidth: inputToNum(value.pcWidth) ?? undefined,
    pcHeight: inputToNum(value.pcHeight) ?? undefined,
    mobileWidth: inputToNum(value.mobileWidth) ?? undefined,
    mobileHeight: inputToNum(value.mobileHeight) ?? undefined,
    placement: value.placement,
    placementPaths: value.placement === 'paths' ? parsePaths(value.placementPathsText) : [],
    audience: value.audience,
    dismissMode: value.dismissMode,
    dismissDays: value.dismissMode === 'days' ? (inputToNum(value.dismissDays) ?? undefined) : undefined,
    displayStartAt: localInputToIso(value.displayStartAt),
    displayEndAt: localInputToIso(value.displayEndAt),
    isActive: value.isActive,
    sortOrder: inputToNum(value.sortOrder) ?? 0,
  };
}

/**
 * 수정은 전체 필드를 보낸다 — 부분 전송이면 "이미지형에서 본문형으로 되돌리기" 처럼
 * 값을 비우는 조작이 표현되지 않는다. 비우는 필드는 명시적으로 null 을 보낸다.
 */
export function popupFormToUpdateDto(value: SitePopupFormValue): UpdateSitePopupDto {
  const isImage = value.contentType === 'image';

  return {
    title: value.title.trim(),
    contentType: value.contentType,
    content: isImage ? null : value.content,
    pcImageFileId: isImage ? value.pcImageFileId : null,
    mobileImageFileId: isImage ? value.mobileImageFileId : null,
    imageAlt: isImage ? (orUndefined(value.imageAlt) ?? null) : null,
    linkUrl: orUndefined(value.linkUrl) ?? null,
    noticeId: value.noticeId ?? null,
    pcWidth: inputToNum(value.pcWidth),
    pcHeight: inputToNum(value.pcHeight),
    mobileWidth: inputToNum(value.mobileWidth),
    mobileHeight: inputToNum(value.mobileHeight),
    placement: value.placement,
    placementPaths: value.placement === 'paths' ? parsePaths(value.placementPathsText) : [],
    audience: value.audience,
    dismissMode: value.dismissMode,
    dismissDays: value.dismissMode === 'days' ? inputToNum(value.dismissDays) : null,
    displayStartAt: localInputToIso(value.displayStartAt) ?? null,
    displayEndAt: localInputToIso(value.displayEndAt) ?? null,
    isActive: value.isActive,
    sortOrder: inputToNum(value.sortOrder) ?? 0,
  };
}

export function parsePaths(text: string): string[] {
  const paths = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return [...new Set(paths)];
}

function orUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function inputToNum(value: string): number | null {
  if (!value.trim()) return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

function numToInput(value: number | null): string {
  return value === null || value === undefined ? '' : String(value);
}

function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function isSafeLink(url: string): boolean {
  const value = url.trim();
  if (value.startsWith('/')) return !value.startsWith('//');
  return /^https?:\/\//i.test(value);
}
