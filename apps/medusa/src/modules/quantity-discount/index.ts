import { Module } from '@medusajs/framework/utils';
import QuantityDiscountModuleService from './service';

export const QUANTITY_DISCOUNT_MODULE = 'quantityDiscount';

export default Module(QUANTITY_DISCOUNT_MODULE, {
  service: QuantityDiscountModuleService,
});
