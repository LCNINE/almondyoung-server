import { Module } from '@nestjs/common';
import { ProductImportController } from './product-import.controller';
import { ProductImportService } from './services/product-import.service';
import { ProductImportParser } from './services/product-import.parser';
import { ProductImportNormalizer } from './services/product-import.normalizer';
import { ProductImportValidator } from './services/product-import.validator';
import { ProductImportSessionReader } from './services/product-import-session.reader';
import { ProductImportManager } from './services/product-import.manager';
import { ProductImportPricingBuilder } from './services/product-import-pricing.builder';
import { ProductImportProgressBuilder } from './services/product-import-progress.builder';
import { ProductImportVariantCodeChecker } from './services/product-import-variant-code.checker';
import { ProductImportJobManager } from './services/product-import-job.manager';
import { ProductImportJobWorker } from './services/product-import-job.worker';
import { ProductsModule } from '../../core/products/products.module';
import { PricingModule } from '../../core/pricing/pricing.module';

@Module({
  imports: [ProductsModule, PricingModule],
  controllers: [ProductImportController],
  providers: [
    ProductImportService,
    ProductImportParser,
    ProductImportNormalizer,
    ProductImportValidator,
    ProductImportSessionReader,
    ProductImportManager,
    ProductImportPricingBuilder,
    ProductImportProgressBuilder,
    ProductImportVariantCodeChecker,
    ProductImportJobManager,
    ProductImportJobWorker,
  ],
  exports: [ProductImportService],
})
export class ProductImportModule {}
