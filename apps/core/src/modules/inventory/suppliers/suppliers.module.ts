import { Module } from '@nestjs/common';
import { SuppliersController } from './controllers/suppliers.controller';
import { SupplierCategoriesController } from './controllers/supplier-categories.controller';
import { SuppliersService } from './services/suppliers.service';
import { SupplierCategoriesService } from './services/supplier-categories.service';

@Module({
  imports: [],
  controllers: [SuppliersController, SupplierCategoriesController],
  providers: [SuppliersService, SupplierCategoriesService],
  exports: [SuppliersService, SupplierCategoriesService],
})
export class SuppliersModule {}
