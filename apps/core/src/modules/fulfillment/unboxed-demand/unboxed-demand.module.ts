import { Module } from '@nestjs/common';
import { UnboxedDemandCancellation } from './unboxed-demand-cancellation';

// 의존이 전역 DbService 하나뿐 → imports 불필요. SalesOrderModule 이 이 소형 모듈만 import 한다.
@Module({
  providers: [UnboxedDemandCancellation],
  exports: [UnboxedDemandCancellation],
})
export class UnboxedDemandModule {}
