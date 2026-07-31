import { Module } from '@nestjs/common';
import { ProductExportController } from './product-export.controller';
import { ProductExportService } from './product-export.service';
import { ProductsModule } from '../../core/products/products.module';
import { SuppliersModule } from '../../../inventory/suppliers/suppliers.module';

@Module({
  imports: [ProductsModule, SuppliersModule],
  controllers: [ProductExportController],
  providers: [ProductExportService],
})
export class ProductExportModule {}
