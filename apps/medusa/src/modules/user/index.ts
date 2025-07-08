import { Module, ModuleRegistrationName } from '@medusajs/framework/utils';
import UserService from './service';

export const USER = 'user';

export default Module(USER, {
  service: UserService,
});
