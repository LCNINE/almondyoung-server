import { Module } from '@nestjs/common';
import { CoreInventoryModule } from '../../inventory/core/inventory.module';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';
import { FulfillmentOrderCreationBacklogService } from './fulfillment-order-creation-backlog.service';

@Module({
  imports: [CoreInventoryModule],
  providers: [FulfillmentWorkflowGate, FulfillmentOrderCreationBacklogService],
  exports: [FulfillmentWorkflowGate, FulfillmentOrderCreationBacklogService],
})
export class FulfillmentOrderCreationBacklogModule {}
