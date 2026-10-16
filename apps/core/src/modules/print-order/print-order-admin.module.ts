import { Module } from '@nestjs/common';
import { SalesOrderModule } from '../sales-order/sales-order.module';
import { AdminPrintOrdersController } from './controllers/admin-print-orders.controller';
import { PrintOrderModule } from './print-order.module';
import { PrintCancelRemainingReader } from './services/print-cancel-remaining.reader';
import { PrintOrdersService } from './services/print-orders.service';

// 취소 마무리가 판매주문 취소(StoreSalesOrdersService)를 부른다. SalesOrderModule 이 PrintOrderModule 을 import 하므로 별도 모듈로 둔다
@Module({
  imports: [PrintOrderModule, SalesOrderModule],
  controllers: [AdminPrintOrdersController],
  providers: [PrintOrdersService, PrintCancelRemainingReader],
})
export class PrintOrderAdminModule {}
