import { Module } from '@nestjs/common';
import { Sku3dModelsModule } from '../sku-3d-models/sku-3d-models.module';
import { FileServiceClient } from '../../library/clients/file-service.client';
import { Sku3dWorkshopController } from './sku-3d-workshop.controller';
import { Sku3dWorkshopManager } from './sku-3d-workshop.manager';
import { Sku3dWorkshopPublisher } from './sku-3d-workshop.publisher';
import { Sku3dWorkshopReader } from './sku-3d-workshop.reader';
import { Sku3dWorkshopService } from './sku-3d-workshop.service';
import { Sku3dWorkerController } from './worker/sku-3d-worker.controller';
import { Sku3dWorkerKeyInterceptor } from './worker/sku-3d-worker-key.interceptor';
import { Sku3dWorkerManager } from './worker/sku-3d-worker.manager';

@Module({
  imports: [Sku3dModelsModule],
  controllers: [Sku3dWorkshopController, Sku3dWorkerController],
  providers: [
    Sku3dWorkshopService,
    Sku3dWorkshopReader,
    Sku3dWorkshopManager,
    Sku3dWorkshopPublisher,
    Sku3dWorkerManager,
    Sku3dWorkerKeyInterceptor,
    FileServiceClient,
  ],
})
export class Sku3dWorkshopModule {}
