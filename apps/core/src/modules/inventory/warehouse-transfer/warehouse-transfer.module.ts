import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { CoreInventoryModule } from '../core/inventory.module';
import { WarehouseTransferService } from './services/warehouse-transfer.service';
import { WarehouseTransferManager } from './services/warehouse-transfer.manager';
import { WarehouseTransferReader } from './services/warehouse-transfer.reader';
import { TransferStagnationMonitor } from './services/transfer-stagnation.monitor';
import { WarehouseTransferController } from './controllers/warehouse-transfer.controller';

@Module({
  imports: [SharedModule, CoreInventoryModule],
  controllers: [WarehouseTransferController],
  providers: [WarehouseTransferService, WarehouseTransferManager, WarehouseTransferReader, TransferStagnationMonitor],
  exports: [WarehouseTransferService, WarehouseTransferReader],
})
export class WarehouseTransferModule {}
