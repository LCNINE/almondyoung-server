import { Module } from '@nestjs/common';
import { CoreInventoryModule } from '../../inventory/core/inventory.module';
import { FulfillmentOrderCreationBacklogService } from './fulfillment-order-creation-backlog.service';

@Module({
  imports: [CoreInventoryModule],
  providers: [FulfillmentOrderCreationBacklogService],
  exports: [FulfillmentOrderCreationBacklogService],
})
export class FulfillmentOrderCreationBacklogModule {}
