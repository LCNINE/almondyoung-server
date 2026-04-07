import { Module } from '@medusajs/framework/utils';
import KafkaBridgeModuleService from './service';
import userEventsLoader from './loaders/user-events';

export const KAFKA_BRIDGE_MODULE = 'kafkaBridge';

export default Module(KAFKA_BRIDGE_MODULE, {
  service: KafkaBridgeModuleService,
  loaders: [userEventsLoader],
});
