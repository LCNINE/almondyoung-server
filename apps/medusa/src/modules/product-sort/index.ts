import { Module } from '@medusajs/framework/utils';
import { ProductSortModuleService } from './service';

export const PRODUCT_SORT_MODULE = 'productSort';

export default Module(PRODUCT_SORT_MODULE, {
  service: ProductSortModuleService,
});
