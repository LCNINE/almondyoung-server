import { ModuleProvider, Modules } from '@medusajs/framework/utils';
import { AuthProviderService } from './service';

export default ModuleProvider(Modules.AUTH, {
  services: [AuthProviderService],
});
