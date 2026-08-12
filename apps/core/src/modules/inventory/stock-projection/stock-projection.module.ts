import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { CoreInventoryModule } from '../core/inventory.module';
import { WarehouseTransferModule } from '../warehouse-transfer/warehouse-transfer.module';
import { StockProjectionController } from './controllers/stock-projection.controller';
import { StockProjectionService } from './services/stock-projection.service';
import { StockProjectionReader } from './services/stock-projection.reader';
import { StockProjectionManager } from './services/stock-projection.manager';
import { InboundPipelineReader } from './services/inbound-pipeline.reader';

@Module({
  // 파이프라인 ③(이동 중 잔량)의 뺄셈은 WarehouseTransferReader 가 소유한다 — 다시 쓰지 않고 빌려온다.
  imports: [SharedModule, CoreInventoryModule, WarehouseTransferModule],
  controllers: [StockProjectionController],
  providers: [StockProjectionService, StockProjectionReader, StockProjectionManager, InboundPipelineReader],
  exports: [StockProjectionService],
})
export class StockProjectionModule {}
