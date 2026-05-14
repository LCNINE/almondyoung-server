import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { SkuCatalogController } from './controllers/sku-catalog.controller';
import { SkuCatalogService } from './services/sku-catalog.service';
import { SkuCatalogReader } from './services/sku-catalog.reader';
import { SkuCatalogManager } from './services/sku-catalog.manager';

@Module({
  imports: [SharedModule],
  controllers: [SkuCatalogController],
  providers: [SkuCatalogService, SkuCatalogReader, SkuCatalogManager],
  exports: [SkuCatalogService],
})
export class SkuCatalogModule {}
