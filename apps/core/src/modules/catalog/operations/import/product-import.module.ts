import { Module } from '@nestjs/common';
import { ProductImportController } from './product-import.controller';
import { ProductImportService } from './services/product-import.service';
import { ProductImportParser } from './services/product-import.parser';
import { ProductImportNormalizer } from './services/product-import.normalizer';
import { ProductImportValidator } from './services/product-import.validator';
import { ProductImportSessionReader } from './services/product-import-session.reader';
import { ProductImportManager } from './services/product-import.manager';
import { ProductsModule } from '../../core/products/products.module';

@Module({
  imports: [ProductsModule],
  controllers: [ProductImportController],
  providers: [
    ProductImportService,
    ProductImportParser,
    ProductImportNormalizer,
    ProductImportValidator,
    ProductImportSessionReader,
    ProductImportManager,
  ],
  exports: [ProductImportService],
})
export class ProductImportModule {}
