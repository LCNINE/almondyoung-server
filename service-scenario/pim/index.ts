import { categoryScenarios } from './category';
import { productMasterScenarios } from './product-master';
import { productVariantScenarios } from './product-variants';
import { channelCategoryScenarios } from './channel-categories';
import { salesChannelScenarios } from './sales-channels';
import { channelProductScenarios } from './channel-products';
import { channelListingScenarios } from './channel-listings';
import { channelIntegrationScenarios } from './channel-integration';
import { pricingScenarios } from './pricing';
import { tagScenarios } from './tags';
import { bannerScenarios } from './banners';
import { searchScenarios } from './search';
import type { Scenario } from '../types';

export const allPimScenarios: Scenario[] = [
  ...categoryScenarios,
  ...productMasterScenarios,
  ...productVariantScenarios,
  ...channelCategoryScenarios,
  ...salesChannelScenarios,
  ...channelProductScenarios,
  ...channelListingScenarios,
  ...channelIntegrationScenarios,
  ...pricingScenarios,
  ...tagScenarios,
  ...bannerScenarios,
  ...searchScenarios,
];

export {
  categoryScenarios,
  productMasterScenarios,
  productVariantScenarios,
  channelCategoryScenarios,
  salesChannelScenarios,
  channelProductScenarios,
  channelListingScenarios,
  channelIntegrationScenarios,
  pricingScenarios,
  tagScenarios,
  bannerScenarios,
  searchScenarios,
};
