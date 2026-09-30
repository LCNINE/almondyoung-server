export const ALMOND_TEMPLATE_STATUSES = ['draft', 'published'] as const;
export type AlmondTemplateStatus = (typeof ALMOND_TEMPLATE_STATUSES)[number];

export const ALMOND_TEMPLATE_MAX_LAYERS_PER_SIDE = 150;
export const ALMOND_TEMPLATE_MIN_SIZE_MM = 35;
export const ALMOND_TEMPLATE_MAX_TITLE_LENGTH = 80;
export const ALMOND_TEMPLATE_MAX_TAG_LENGTH = 40;
export const ALMOND_TEMPLATE_DEFAULT_INDUSTRY = '미용·뷰티';
export const ALMOND_TEMPLATE_DEFAULT_PURPOSE = '이벤트·홍보';

export const ALMOND_TEMPLATE_MAX_THUMBNAIL_LENGTH = 10 * 1024 * 1024;

export const ALMOND_TEMPLATE_UPSERT_ROUTE = { method: 'PUT', url: '/admin/almond-templates' } as const;
export const ALMOND_TEMPLATE_UPSERT_BODY_LIMIT = 20 * 1024 * 1024;
