import { Module } from '@medusajs/framework/utils';
import { WmsModuleService } from './service';

export const WMS_MODULE = 'wms';

export default Module(WMS_MODULE, {
  service: WmsModuleService,

  loaders: [
    async ({ options }) => {
      if (!options.apiKey) {
        throw new Error('WMS Module requires an apiKey option.');
      }
    },
  ],
});
