import { Module } from '@medusajs/framework/utils';
import TimeSaleModuleService from './service';

export const TIME_SALE_MODULE = 'timeSale';

export default Module(TIME_SALE_MODULE, {
  service: TimeSaleModuleService,
});
