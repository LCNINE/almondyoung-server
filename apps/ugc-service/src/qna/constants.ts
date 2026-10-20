export const MAX_QUESTION_MEDIA_COUNT = 5;

export const QUESTION_STATUSES = ['active', 'answered'] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

// 상품 Q&A 는 category 없이, 1:1 문의는 category 필수로 들어온다 — 출처는 category 유무로 갈린다
export const QUESTION_SOURCES = ['product_qna', 'inquiry'] as const;
export type QuestionSource = (typeof QUESTION_SOURCES)[number];

export const QUESTION_CATEGORIES = ['product', 'delivery', 'order', 'exchange', 'account', 'etc'] as const;
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

export const QUESTION_SUB_CATEGORIES: Record<QuestionCategory, string[]> = {
  product: ['info', 'restock', 'defect', 'etc'],
  delivery: ['status', 'address_change', 'delay', 'etc'],
  order: ['cancel', 'change', 'payment_error', 'refund', 'etc'],
  exchange: ['exchange_request', 'return_request', 'exchange_status', 'etc'],
  account: ['info_change', 'withdraw', 'point', 'etc'],
  etc: ['suggestion', 'partnership', 'etc'],
};
