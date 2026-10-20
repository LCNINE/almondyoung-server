import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { SkuFieldCaptureController } from './controllers/sku-field-capture.controller';
import { SkuFieldCaptureService } from './services/sku-field-capture.service';
import { SkuFieldCaptureReader } from './services/sku-field-capture.reader';
import { SkuFieldCaptureManager } from './services/sku-field-capture.manager';

@Module({
  imports: [SharedModule],
  controllers: [SkuFieldCaptureController],
  providers: [SkuFieldCaptureService, SkuFieldCaptureReader, SkuFieldCaptureManager],
})
export class SkuFieldCaptureModule {}
