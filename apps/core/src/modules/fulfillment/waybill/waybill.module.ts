import { Module } from '@nestjs/common';
import { FulfillmentCommandModule } from '../fulfillment-command.module';
import { HANJIN_CONFIG } from './waybill.tokens';
import { CarrierGatewayRegistry } from './carrier/carrier-gateway.registry';
import { buildCarrierGatewayRegistry, buildHanjinConfig } from './carrier/hanjin/carrier-gateway.factory';
import { SvgRasterizer } from './label/svg-rasterizer';
import { WaybillRepository } from './waybill.repository';
import { WaybillReader } from './waybill.reader';
import { WaybillIssueMachine } from './waybill-issue.machine';
import { WaybillManager } from './waybill.manager';
import { WaybillService } from './waybill.service';
import { WaybillController } from './waybill.controller';
import { WaybillLabelManager } from './waybill-label.manager';
import { WaybillLabelService } from './waybill-label.service';
import { WaybillLabelController } from './waybill-label.controller';
import { DemoCarrierRepository } from './carrier/demo/demo-carrier.repository';

@Module({
  // FulfillmentCommandService(WaybillManager 의존) 획득. 방향 반전 완료 — FulfillmentModule 이 WaybillModule 을 import(spec §12.1).
  imports: [FulfillmentCommandModule],
  controllers: [WaybillController, WaybillLabelController],
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
    // 생성자 인자가 함수라 Nest 가 주입할 수 없다 — 팩토리로 만든다. 폰트는 첫 렌더 때 찾는다(#913).
    { provide: SvgRasterizer, useFactory: () => new SvgRasterizer() },
    WaybillLabelManager,
    WaybillLabelService,
  ],
  // CarrierGatewayRegistry: 배송추적 폴러(FulfillmentModule)가 캐리어 추적을 부른다(#917).
  exports: [WaybillService, CarrierGatewayRegistry],
})
export class WaybillModule {}
