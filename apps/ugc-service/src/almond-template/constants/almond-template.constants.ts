export const ALMOND_TEMPLATE_STATUSES = ['draft', 'published'] as const;
export type AlmondTemplateStatus = (typeof ALMOND_TEMPLATE_STATUSES)[number];

export const ALMOND_TEMPLATE_MAX_LAYERS_PER_SIDE = 150;
export const ALMOND_TEMPLATE_MIN_SIZE_MM = 35;
export const ALMOND_TEMPLATE_MAX_TITLE_LENGTH = 80;
export const ALMOND_TEMPLATE_MAX_TAG_LENGTH = 40;
export const ALMOND_TEMPLATE_DEFAULT_INDUSTRY = '미용·뷰티';
export const ALMOND_TEMPLATE_DEFAULT_PURPOSE = '이벤트·홍보';

export const ALMOND_TEMPLATE_MAX_THUMBNAIL_LENGTH = 10 * 1024 * 1024;

export const ALMOND_TEMPLATE_THUMBNAIL_HEADERS = {
  'content-type': 'image/svg+xml; charset=utf-8',
  'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
  'x-content-type-options': 'nosniff',
} as const;

export const ALMOND_TEMPLATE_UPSERT_ROUTE = { method: 'PUT', url: '/admin/almond-templates' } as const;
export const ALMOND_TEMPLATE_UPSERT_BODY_LIMIT = 20 * 1024 * 1024;

export const ALMOND_DESIGN_MAX_SVG_LENGTH = 3 * 1024 * 1024;
export const ALMOND_DESIGN_CREATE_ROUTE = { method: 'POST', url: '/almond-designs' } as const;
export const ALMOND_DESIGN_CREATE_BODY_LIMIT = 5 * 1024 * 1024;

export const ALMOND_SAVED_DESIGN_MAX_PER_USER = 50;
export const ALMOND_SAVED_DESIGN_UPSERT_ROUTE = { method: 'PUT', url: '/me/almond-saved-designs' } as const;
export const ALMOND_SAVED_DESIGN_UPSERT_BODY_LIMIT = 20 * 1024 * 1024;

export const ALMOND_PRINT_FILE_CONTEXT_ID = 'almond-print-file';
export const ALMOND_PRINT_LINK_EXPIRES_SEC = 300;

export const ALMOND_PRINT_SIDE_GAP_MM = 10;
export const ALMOND_PRINT_TIMEOUT_MS = 120_000;
export const ALMOND_PRINT_DEFAULT_DPI = 300;
export const ALMOND_PRINT_MIN_DPI = 150;
export const ALMOND_PRINT_MAX_DPI = 700;
export const ALMOND_PRINT_MAX_JPG_PIXELS = 300_000_000;
export const ALMOND_PREVIEW_LONG_SIDE_PX = 1200;
// 실물보다 줄여서 넘기는 상품. 스토어프론트 PRINT_SPECS 의 fileScale 과 같아야 한다.
// 2026-09-30~10월 사이 시안은 이 축소 없이 실물 크기로 저장됐으므로 인쇄할 때 맞춘다.
export const ALMOND_PRINT_FILE_SCALE: Readonly<Record<string, number>> = { window: 0.1 };
export const ALMOND_PRINT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const ALMOND_PRINT_IMAGE_FETCH_TIMEOUT_MS = 15_000;
export const ALMOND_FONT_MAX_BYTES = 50 * 1024 * 1024;
export const ALMOND_FONT_FETCH_TIMEOUT_MS = 60_000;
export const ALMOND_FONT_MAX_NAME_LENGTH = 60;
