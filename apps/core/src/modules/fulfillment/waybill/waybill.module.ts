import { Module } from '@nestjs/common';
import { FulfillmentCommandModule } from '../fulfillment-command.module';
import { HANJIN_CONFIG } from './waybill.tokens';
import { CarrierGatewayRegistry } from './carrier/carrier-gateway.registry';
import { buildCarrierGatewayRegistry, buildHanjinConfig } from './carrier/hanjin/carrier-gateway.factory';
import { WaybillRepository } from './waybill.repository';
import { WaybillReader } from './waybill.reader';
import { WaybillIssueMachine } from './waybill-issue.machine';
import { WaybillManager } from './waybill.manager';
import { WaybillService } from './waybill.service';
import { WaybillController } from './waybill.controller';
import { DemoCarrierRepository } from './carrier/demo/demo-carrier.repository';

@Module({
  // FulfillmentCommandService(WaybillManager 의존) 획득. 방향 반전 완료 — FulfillmentModule 이 WaybillModule 을 import(spec §12.1).
  imports: [FulfillmentCommandModule],
  controllers: [WaybillController],
  providers: [
    { provide: HANJIN_CONFIG, useFactory: buildHanjinConfig },
    {
      provide: CarrierGatewayRegistry,
      useFactory: buildCarrierGatewayRegistry,
      inject: [HANJIN_CONFIG, DemoCarrierRepository],
    },
    DemoCarrierRepository,
    WaybillRepository,
    WaybillReader,
    WaybillIssueMachine,
    WaybillManager,
    WaybillService,
  ],
  // CarrierGatewayRegistry: 배송추적 폴러(FulfillmentModule)가 캐리어 추적을 부른다(#917).
  exports: [WaybillService, CarrierGatewayRegistry],
})
export class WaybillModule {}
