export const MIN_LOGO_CONTEST_MEDIA_COUNT = 2;
export const MAX_LOGO_CONTEST_MEDIA_COUNT = 2;

export const LOGO_CONTEST_IMAGE_CONTEXT_ID = 'logo-contest-image';

/**
 * svg 는 스크립트를 품을 수 있어 뺀다. file-service 컨텍스트가 이미 같은 목록으로 막지만,
 * 컨텍스트 행은 운영에서 손으로 고칠 수 있으므로 붙이는 쪽에서도 확인한다.
 */
export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const LOGO_CONTEST_ENTRY_STATUS_VALUES = ['active', 'hidden'] as const;
export type LogoContestEntryStatus = (typeof LOGO_CONTEST_ENTRY_STATUS_VALUES)[number];

export const LOGO_CONTEST_SORT_VALUES = ['latest', 'popular'] as const;
export type LogoContestSort = (typeof LOGO_CONTEST_SORT_VALUES)[number];

/** 메인 페이지 상위 섹션 개수. */
export const LOGO_CONTEST_TOP_LIMIT = 10;
