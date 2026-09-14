export const PRODUCT_AI_IMAGE_CONTEXT = 'product-ai-image';
export const PRODUCT_AI_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const PRODUCT_AI_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_AI_IMAGES_PER_MESSAGE = 4;
export const PRODUCT_AI_IMAGES_PER_SESSION = 12;
export const PRODUCT_AI_IMAGES_TOTAL_BYTES = 20 * 1024 * 1024;
export type ProductAiAttachment = { fileId: string; fileName: string; mimeType: string; size: number };
