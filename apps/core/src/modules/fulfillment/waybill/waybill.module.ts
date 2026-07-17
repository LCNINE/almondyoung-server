import { Module } from '@nestjs/common';
import { FulfillmentModule } from '../fulfillment.module';
import { HANJIN_CONFIG } from './waybill.tokens';
import { CarrierGatewayRegistry } from './carrier/carrier-gateway.registry';
import { buildCarrierGatewayRegistry, buildHanjinConfig } from './carrier/hanjin/carrier-gateway.factory';
import { WaybillRepository } from './waybill.repository';
import { WaybillReader } from './waybill.reader';
import { WaybillIssueMachine } from './waybill-issue.machine';
import { WaybillManager } from './waybill.manager';
import { WaybillService } from './waybill.service';
import { WaybillController } from './waybill.controller';

@Module({
  // FulfillmentCommandService 획득 목적(WaybillManager 의존성). 플랜 3 에서 방향 반전 예정 — 이 플랜에선 하지 않음.
  imports: [FulfillmentModule],
  controllers: [WaybillController],
  providers: [
    { provide: HANJIN_CONFIG, useFactory: buildHanjinConfig },
    { provide: CarrierGatewayRegistry, useFactory: buildCarrierGatewayRegistry, inject: [HANJIN_CONFIG] },
    WaybillRepository,
    WaybillReader,
    WaybillIssueMachine,
    WaybillManager,
    WaybillService,
  ],
  exports: [WaybillService],
})
export class WaybillModule {}
