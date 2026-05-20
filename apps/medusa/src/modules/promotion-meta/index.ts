import { Module } from '@medusajs/framework/utils';
import PromotionMetaModuleService from './service';

export const PROMOTION_META_MODULE = 'promotionMeta';

export default Module(PROMOTION_META_MODULE, {
  service: PromotionMetaModuleService,
});
