// src/lib/api/domains/products/index.ts
// Products 도메인 통합 클라이언트

import { approvalClient } from './approval.client';
import { auditClient } from './audit.client';
import { bannerGroupsClient } from './banner-groups.client';
import { bannersClient } from './banners.client';
import { bulkClient } from './bulk.client';
import { categoriesClient } from './categories.client';
import { channelProductsClient } from './channel-products.client';
import { channelsClient } from './channels.client';
import { csvClient } from './csv.client';
import { mastersClient } from './masters.client';
import { pricingClient } from './pricing.client';
import { tagsClient } from './tags.client';
import { variantsClient } from './variants.client';
import { versionsClient } from './versions.client';

export const products = {
  categories: categoriesClient,
  masters: mastersClient,
  variants: variantsClient,
  channels: channelsClient,
  channelProducts: channelProductsClient,
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

export { categoriesClient } from './categories.client';
export { mastersClient } from './masters.client';
export { variantsClient } from './variants.client';
export { channelsClient } from './channels.client';
export { channelProductsClient } from './channel-products.client';
export { bannerGroupsClient } from './banner-groups.client';
export { bannersClient } from './banners.client';
export { tagsClient } from './tags.client';
export { pricingClient } from './pricing.client';
export { versionsClient } from './versions.client';
export { bulkClient } from './bulk.client';
export { csvClient } from './csv.client';
export { auditClient } from './audit.client';
export { approvalClient } from './approval.client';
