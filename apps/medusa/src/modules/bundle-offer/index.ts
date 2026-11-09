import { Module } from '@medusajs/framework/utils';
import BundleOfferModuleService from './service';

export const BUNDLE_OFFER_MODULE = 'bundleOffer';

export default Module(BUNDLE_OFFER_MODULE, {
  service: BundleOfferModuleService,
});
