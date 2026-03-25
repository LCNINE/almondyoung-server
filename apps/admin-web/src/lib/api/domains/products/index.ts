// src/lib/api/domains/products/index.ts
// Products 도메인 통합 클라이언트

import { categories } from './categories.client';
import { masters } from './masters.client';
import { variants } from './variants.client';
import { channelProducts } from './channel-products.client';
import { channels } from './channels.client';

export const products = {
  // Categories Management (PIM API)
  categories,

  // Product Masters Management (PIM API)
  masters,

  // Product Variants Management (PIM API)
  variants,

  // Sales Channels Management (PIM API)
  channels,

  // Channel Products Management (PIM API)
  channelProducts,
};

// 기존 호환성을 위한 별도 export
export { categories } from './categories.client';
export { masters } from './masters.client';
export { variants } from './variants.client';
export { channelProducts } from './channel-products.client';
export { channels } from './channels.client';
