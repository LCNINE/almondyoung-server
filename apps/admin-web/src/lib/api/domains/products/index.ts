// src/lib/api/domains/products/index.ts
// Products 도메인 통합 클라이언트

import { categories } from './categories.client';
import { masters } from './masters.client';
import { variants } from './variants.client';
import { channelProducts } from './channel-products.client';
import { channels } from './channels.client';
import { bannerGroupsClient } from './banner-groups.client';
import { bannersClient } from './banners.client';
import { tagsClient } from './tags.client';
import { pricingClient } from './pricing.client';
import { versionsClient } from './versions.client';
import { bulkClient } from './bulk.client';
import { csvClient } from './csv.client';
import { auditClient } from './audit.client';
import { approvalClient } from './approval.client';

export const products = {
  categories,
  masters,
  variants,
  channels,
  channelProducts,
  bannerGroups: bannerGroupsClient,
  banners: bannersClient,
  tags: tagsClient,
  pricing: pricingClient,
  versions: versionsClient,
  bulk: bulkClient,
  csv: csvClient,
  audit: auditClient,
  approval: approvalClient,
};

export { categories } from './categories.client';
export { masters } from './masters.client';
export { variants } from './variants.client';
export { channelProducts } from './channel-products.client';
export { channels } from './channels.client';
export { bannerGroupsClient } from './banner-groups.client';
export { bannersClient } from './banners.client';
export { tagsClient } from './tags.client';
export { pricingClient } from './pricing.client';
export { versionsClient } from './versions.client';
export { bulkClient } from './bulk.client';
export { csvClient } from './csv.client';
export { auditClient } from './audit.client';
export { approvalClient } from './approval.client';
