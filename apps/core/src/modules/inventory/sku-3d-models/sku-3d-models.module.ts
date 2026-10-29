import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { ProductsModule } from '../../catalog/core/products/products.module';
import { FileServiceClient } from '../../library/clients/file-service.client';
import { Sku3dModelsController } from './sku-3d-models.controller';
import { Sku3dModelsManager } from './sku-3d-models.manager';

@Module({
  imports: [ProductsModule, EventsModule],
  controllers: [Sku3dModelsController],
  providers: [Sku3dModelsManager, FileServiceClient],
})
export class Sku3dModelsModule {}
