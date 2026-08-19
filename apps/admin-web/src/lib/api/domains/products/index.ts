// src/lib/api/domains/products/index.ts
// Products 도메인 통합 클라이언트

import { auditClient } from './audit.client';
import { bannerGroupsClient } from './banner-groups.client';
import { bannersClient } from './banners.client';
import { noticesClient } from './notices.client';
import { shopListingsClient } from './shop-listings.client';
import { sitePopupsClient } from './site-popups.client';
import { bulkClient } from './bulk.client';
import { bulkSessionClient } from './bulk-session.client';
import { categoriesClient } from './categories.client';
import { channelsClient } from './channels.client';
import { formExportClient } from './form-export.client';
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
  bannerGroups: bannerGroupsClient,
  banners: bannersClient,
  notices: noticesClient,
  shopListings: shopListingsClient,
  sitePopups: sitePopupsClient,
  tags: tagsClient,
  pricing: pricingClient,
  versions: versionsClient,
  bulk: bulkClient,
  bulkSession: bulkSessionClient,
  formExport: formExportClient,
  audit: auditClient,
};

export { categoriesClient } from './categories.client';
export { mastersClient } from './masters.client';
export { variantsClient } from './variants.client';
export { channelsClient } from './channels.client';
export { bannerGroupsClient } from './banner-groups.client';
export { bannersClient } from './banners.client';
export { noticesClient } from './notices.client';
export { shopListingsClient } from './shop-listings.client';
export { sitePopupsClient } from './site-popups.client';
export { tagsClient } from './tags.client';
export { pricingClient } from './pricing.client';
export { versionsClient } from './versions.client';
export { bulkClient } from './bulk.client';
export { bulkSessionClient } from './bulk-session.client';
export { formExportClient } from './form-export.client';
export { auditClient } from './audit.client';
