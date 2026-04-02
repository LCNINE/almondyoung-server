import { Module } from '@medusajs/framework/utils';
import ProductSortingModuleService from './service';

export const PRODUCT_SORTING_MODULE = 'productSorting';

export default Module(PRODUCT_SORTING_MODULE, {
  service: ProductSortingModuleService,
});
