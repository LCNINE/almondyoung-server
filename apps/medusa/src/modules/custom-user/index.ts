import { Module } from '@medusajs/framework/utils';
import CustomUserModuleService from './service';

export const CUSTOM_USER_MODULE = 'custom_user';

export default Module(CUSTOM_USER_MODULE, {
  service: CustomUserModuleService,
});
