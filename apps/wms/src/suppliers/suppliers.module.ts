import { Module } from '@nestjs/common';
import { DbModule } from '@app/db';
import { wmsTables, wmsSchema } from '../../database/schemas/wms-schema';
import { ConfigModule } from '@nestjs/config';
import { SuppliersController } from './controllers/suppliers.controller';
import { SupplierCategoriesController } from './controllers/supplier-categories.controller';
import { SuppliersService } from './services/suppliers.service';
import { SupplierCategoriesService } from './services/supplier-categories.service';

@Module({
  imports: [
    ConfigModule.forRoot(),
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: wmsTables,
    }),
  ],
  controllers: [
    SuppliersController,
    SupplierCategoriesController,
  ],
  providers: [
    SuppliersService,
    SupplierCategoriesService,
  ],
  exports: [
    SuppliersService,
    SupplierCategoriesService,
  ],
})
export class SuppliersModule {}

