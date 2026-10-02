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

export const ALMOND_PRINT_SIDE_GAP_MM = 10;
export const ALMOND_PRINT_TIMEOUT_MS = 120_000;
export const ALMOND_PRINT_DEFAULT_DPI = 300;
export const ALMOND_PRINT_MIN_DPI = 150;
export const ALMOND_PRINT_MAX_DPI = 400;
export const ALMOND_PRINT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const ALMOND_PRINT_IMAGE_FETCH_TIMEOUT_MS = 15_000;
