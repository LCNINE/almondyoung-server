import EventModuleService from './service';
import { Module } from '@medusajs/framework/utils';

export const EVENT_MODULE = 'events';

export default Module(EVENT_MODULE, {
  service: EventModuleService,
  loaders: [
    async ({ options }) => {
      if (!options.kafka) {
        throw new Error('Events Module requires a kafka option.');
      }
    },
  ],
});
