import { Module } from '@nestjs/common';
import { ProductCategoriesController } from './categories.controller';
import { ProductCategoriesService } from './categories.service';

@Module({
  controllers: [ProductCategoriesController],
  providers: [ProductCategoriesService],
  exports: [ProductCategoriesService],
})
export class CategoriesModule {}

