import { Module } from '@nestjs/common';
import { PricingModule } from '../catalog/core/pricing/pricing.module';
import { ProductsModule } from '../catalog/core/products/products.module';
import { BulkSessionComboResolver } from '../catalog/operations/bulk-session/services/bulk-session.combos';
import { ProductMatchingModule } from '../product-matching/product-matching.module';
import { SalesOrderModule } from '../sales-order/sales-order.module';
import { AdminPrintOrdersController } from './controllers/admin-print-orders.controller';
import { PrintCatalogController } from './print-catalog/print-catalog.controller';
import { PrintCatalogReader } from './print-catalog/print-catalog.reader';
import { PrintCatalogService } from './print-catalog/print-catalog.service';
import { PrintProductPublisher } from './print-catalog/print-product-publisher';
import { PrintOrderModule } from './print-order.module';
import { PrintCancelRemainingReader } from './services/print-cancel-remaining.reader';
import { PrintOrdersService } from './services/print-orders.service';

// 취소 마무리가 판매주문 취소(StoreSalesOrdersService)를 부른다. SalesOrderModule 이 PrintOrderModule 을 import 하므로 별도 모듈로 둔다
// 템플릿 게시가 상품 생성·가격·매칭·공개를 한 트랜잭션에서 부르므로 ProductsModule·PricingModule·ProductMatchingModule 을 가져오고, 조합 해석기는 OptionReadLoader 만 쓰므로 여기서 등록한다
@Module({
  imports: [PrintOrderModule, SalesOrderModule, ProductsModule, PricingModule, ProductMatchingModule],
  controllers: [AdminPrintOrdersController, PrintCatalogController],
  providers: [
    PrintOrdersService,
    PrintCancelRemainingReader,
    PrintCatalogReader,
    PrintCatalogService,
    PrintProductPublisher,
    BulkSessionComboResolver,
  ],
})
export class PrintOrderAdminModule {}
