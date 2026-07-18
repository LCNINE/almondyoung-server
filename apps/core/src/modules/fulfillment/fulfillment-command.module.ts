import { Module } from '@nestjs/common';
import { FulfillmentCommandService } from './services/fulfillment-command.service';

// FulfillmentCommandService 의존성 = global DbService 하나뿐 → imports 불필요.
// FulfillmentModule·WaybillModule 양쪽이 이 소형 모듈만 공유해 순환을 예방한다(spec §12.1).
@Module({
  providers: [FulfillmentCommandService],
  exports: [FulfillmentCommandService],
})
export class FulfillmentCommandModule {}
