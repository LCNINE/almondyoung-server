import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { CoreInventoryModule } from '../core/inventory.module';
import { WarehouseController } from './controllers/warehouse.controller';
import { WarehouseService } from './services/warehouse.service';
import { WarehouseReader } from './services/warehouse.reader';
import { WarehouseManager } from './services/warehouse.manager';

@Module({
  imports: [SharedModule, CoreInventoryModule],
  controllers: [WarehouseController],
  providers: [WarehouseService, WarehouseReader, WarehouseManager],
  exports: [WarehouseService],
})
export class WarehouseModule {}
