import { Module } from '@medusajs/framework/utils';
import UserModuleService from './service';

export const USER_MODULE = 'user';

export default Module(USER_MODULE, {
  service: UserModuleService,
});
