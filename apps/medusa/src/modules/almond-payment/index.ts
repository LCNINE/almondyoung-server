import AlmondPaymentProviderService from './service';
import { ModuleProvider } from '@medusajs/framework/utils';

export const ALMOND_PAYMENT_MODULE = 'almond-payment';

export default ModuleProvider(ALMOND_PAYMENT_MODULE, {
  services: [AlmondPaymentProviderService],
});
