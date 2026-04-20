import { ModuleProvider, Modules } from '@medusajs/framework/utils';
import { UserServiceSsoProviderService } from './service';

export default ModuleProvider(Modules.AUTH, {
  services: [UserServiceSsoProviderService],
});
