import { Module } from '@nestjs/common';
import { ProductBulkController } from './product-bulk.controller';
import { ProductBulkService } from './product-bulk.service';

@Module({
  controllers: [ProductBulkController],
  providers: [ProductBulkService],
  exports: [ProductBulkService],
})
export class BulkModule {}
