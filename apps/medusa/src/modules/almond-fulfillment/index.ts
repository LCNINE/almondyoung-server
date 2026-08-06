import { ModuleProvider, Modules } from '@medusajs/framework/utils';

import { AlmondFulfillmentProviderService } from './service';

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [AlmondFulfillmentProviderService],
});

export { AlmondFulfillmentProviderService };
export * from './types';
export * from './calculate-shipping-fee';
export * from './korea-postal-area';
