import { Module } from '@nestjs/common';
import { ProductCategoriesController } from './categories.controller';
import { ProductCategoriesService } from './categories.service';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [ProductsModule],
  controllers: [ProductCategoriesController],
  providers: [ProductCategoriesService],
  exports: [ProductCategoriesService],
})
export class CategoriesModule {}
