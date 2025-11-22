export const FILE_CONTEXTS = {
  PRODUCT_IMAGE: 'product-image',
  PRODUCT_DOCUMENT: 'product-document',
  USER_AVATAR: 'user-avatar',
  USER_DOCUMENT: 'user-document',
  INVOICE: 'invoice',
  RECEIPT: 'receipt',
  SHIPMENT_LABEL: 'shipment-label',
} as const;

export type FileContext = (typeof FILE_CONTEXTS)[keyof typeof FILE_CONTEXTS];

