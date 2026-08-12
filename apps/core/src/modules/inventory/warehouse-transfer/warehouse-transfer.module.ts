import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { CoreInventoryModule } from '../core/inventory.module';
import { WarehouseTransferService } from './services/warehouse-transfer.service';
import { WarehouseTransferManager } from './services/warehouse-transfer.manager';
import { WarehouseTransferReader } from './services/warehouse-transfer.reader';

@Module({
  imports: [SharedModule, CoreInventoryModule],
  providers: [WarehouseTransferService, WarehouseTransferManager, WarehouseTransferReader],
  exports: [WarehouseTransferService, WarehouseTransferReader],
})
export class WarehouseTransferModule {}
