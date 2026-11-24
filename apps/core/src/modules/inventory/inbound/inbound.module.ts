import { Module } from '@nestjs/common';
import { CoreInventoryModule } from '../core/inventory.module';
import { SkuCatalogModule } from '../sku-catalog/sku-catalog.module';
import { SharedModule } from '../shared/shared.module';
import { InboundController } from './controllers/inbound.controllers';
import { InboundService } from './services/inbound.service';
import { InboundPutawayReader } from './services/inbound-putaway.reader';
import { InboundReceiptStateReader } from './services/inbound-receipt-state.reader';
import { StockRemovalModule } from '../../fulfillment/stock-removal/stock-removal.module';
import { InboundReceiptKernel } from './kernel/inbound-receipt.kernel';
import { InboundArrivalFollowUp } from './services/inbound-arrival-follow-up';

@Module({
  imports: [CoreInventoryModule, SkuCatalogModule, SharedModule, StockRemovalModule],
  controllers: [InboundController],
  providers: [
    InboundService,
    InboundPutawayReader,
    InboundReceiptStateReader,
    InboundReceiptKernel,
    InboundArrivalFollowUp,
  ],
  exports: [InboundService, InboundReceiptKernel, InboundArrivalFollowUp],
})
export class InboundModule {}
