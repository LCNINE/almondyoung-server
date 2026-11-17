import { Module } from '@nestjs/common';
import { LabelRendererModule } from '../../../platform/label/label-renderer.module';
import { SharedModule } from '../shared/shared.module';
import { InventoryLabelsController } from './inventory-labels.controller';
import { InventoryLabelsManager } from './inventory-labels.manager';
import { InventoryLabelsReader } from './inventory-labels.reader';
import { InventoryLabelsService } from './inventory-labels.service';

@Module({
  imports: [SharedModule, LabelRendererModule],
  controllers: [InventoryLabelsController],
  providers: [InventoryLabelsService, InventoryLabelsManager, InventoryLabelsReader],
})
export class InventoryLabelsModule {}
