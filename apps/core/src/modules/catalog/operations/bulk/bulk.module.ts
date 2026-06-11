import { Module } from '@nestjs/common';
import { ProductBulkController } from './product-bulk.controller';
import { ProductBulkService } from './product-bulk.service';
import { ProductsModule } from '../../core/products/products.module';

@Module({
  imports: [ProductsModule],
  controllers: [ProductBulkController],
  providers: [ProductBulkService],
  exports: [ProductBulkService],
})
export class BulkModule {}
