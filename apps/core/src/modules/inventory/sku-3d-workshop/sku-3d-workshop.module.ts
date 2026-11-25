import { Module } from '@nestjs/common';
import { FileServiceClient } from '../../library/clients/file-service.client';
import { Sku3dWorkshopController } from './sku-3d-workshop.controller';
import { Sku3dWorkshopManager } from './sku-3d-workshop.manager';
import { Sku3dWorkshopReader } from './sku-3d-workshop.reader';
import { Sku3dWorkshopService } from './sku-3d-workshop.service';

@Module({
  controllers: [Sku3dWorkshopController],
  providers: [Sku3dWorkshopService, Sku3dWorkshopReader, Sku3dWorkshopManager, FileServiceClient],
})
export class Sku3dWorkshopModule {}
