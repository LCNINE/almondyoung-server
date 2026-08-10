/**
 * 팝업 공지의 값 집합. 스토어프론트/어드민이 같은 문자열을 쓰므로 여기가 단일 출처다.
 */
export const SITE_POPUP_CONTENT_TYPES = ['rich_text', 'image'] as const;
export type SitePopupContentType = (typeof SITE_POPUP_CONTENT_TYPES)[number];

export const SITE_POPUP_PLACEMENTS = ['main', 'all', 'paths'] as const;
export type SitePopupPlacement = (typeof SITE_POPUP_PLACEMENTS)[number];

export const SITE_POPUP_AUDIENCES = ['all', 'guest', 'member', 'membership'] as const;
export type SitePopupAudience = (typeof SITE_POPUP_AUDIENCES)[number];

export const SITE_POPUP_DISMISS_MODES = ['none', 'today', 'days'] as const;
export type SitePopupDismissMode = (typeof SITE_POPUP_DISMISS_MODES)[number];

/** 공개 조회 시 스토어프론트가 알려주는 방문자 구분 */
export const SITE_POPUP_VIEWER_TYPES = ['guest', 'member', 'membership'] as const;
export type SitePopupViewerType = (typeof SITE_POPUP_VIEWER_TYPES)[number];

/**
 * 방문자 구분별로 볼 수 있는 audience 값.
 * 멤버십 회원은 회원이기도 하므로 'member' 대상 팝업도 본다.
 */
export const AUDIENCES_VISIBLE_TO: Record<SitePopupViewerType, SitePopupAudience[]> = {
  guest: ['all', 'guest'],
  member: ['all', 'member'],
  membership: ['all', 'member', 'membership'],
};

/** 관리자가 크기를 비워둘 때 쓰는 기본 폭(px). 높이는 비면 내용 비율대로 자동. */
export const SITE_POPUP_DEFAULT_PC_WIDTH = 460;
export const SITE_POPUP_DEFAULT_MOBILE_WIDTH = 340;

/** 관리자가 넣을 수 있는 크기 범위 — 화면을 벗어나는 값 방지 */
export const SITE_POPUP_MIN_SIZE = 100;
export const SITE_POPUP_MAX_SIZE = 2000;
