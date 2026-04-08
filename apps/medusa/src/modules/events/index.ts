import { Module, Modules } from '@medusajs/framework/utils';
import MyKafkaEventService from './service';

export default Module(Modules.EVENT_BUS, {
  service: MyKafkaEventService,
});
