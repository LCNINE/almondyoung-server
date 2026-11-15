import { Module } from '@nestjs/common';
import { InboundShipmentController } from './controllers/inbound-shipment.controller';
import { InboundShipmentService } from './services/inbound-shipment.service';
import { InboundShipmentReader } from './services/inbound-shipment.reader';
import { InboundShipmentDraftManager } from './services/inbound-shipment-draft.manager';
import { InboundShipmentSkuMatcherReader } from './services/inbound-shipment-sku-matcher.reader';

/** 중국 선적 입고(상자 단위 리스트·확정). 설계: docs/superpowers/specs/2026-11-16-inbound-shipment-boxes-design.md */
@Module({
  controllers: [InboundShipmentController],
  providers: [InboundShipmentService, InboundShipmentReader, InboundShipmentDraftManager, InboundShipmentSkuMatcherReader],
  exports: [InboundShipmentService, InboundShipmentReader],
})
export class InboundShipmentModule {}
