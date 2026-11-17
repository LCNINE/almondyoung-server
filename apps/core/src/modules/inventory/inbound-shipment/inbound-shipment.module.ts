import { Module } from '@nestjs/common';
import { CoreInventoryModule } from '../core/inventory.module';
import { InboundModule } from '../inbound/inbound.module';
import { ProductSellableQuantityModule } from '../product-sellable-quantity/product-sellable-quantity.module';
import { InboundShipmentController } from './controllers/inbound-shipment.controller';
import { InboundShipmentBoxController } from './controllers/inbound-shipment-box.controller';
import { InboundShipmentService } from './services/inbound-shipment.service';
import { InboundShipmentReader } from './services/inbound-shipment.reader';
import { InboundShipmentDraftManager } from './services/inbound-shipment-draft.manager';
import { InboundShipmentReceivingManager } from './services/inbound-shipment-receiving.manager';
import { InboundShipmentSkuMatcherReader } from './services/inbound-shipment-sku-matcher.reader';

/** 중국 선적 입고(상자 단위 리스트·확정). 설계: docs/superpowers/specs/2026-11-16-inbound-shipment-boxes-design.md */
@Module({
  imports: [CoreInventoryModule, InboundModule, ProductSellableQuantityModule],
  controllers: [InboundShipmentController, InboundShipmentBoxController],
  providers: [
    InboundShipmentService,
    InboundShipmentReader,
    InboundShipmentDraftManager,
    InboundShipmentReceivingManager,
    InboundShipmentSkuMatcherReader,
  ],
  exports: [InboundShipmentService, InboundShipmentReader],
})
export class InboundShipmentModule {}
