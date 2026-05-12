import { Module } from '@nestjs/common';
import { ProductCategoriesController } from './categories.controller';
import { ProductCategoriesService } from './categories.service';
import { ProductsModule } from '../products/products.module';
import { EventsModule } from '@app/events';

@Module({
  imports: [ProductsModule, EventsModule],
  controllers: [ProductCategoriesController],
  providers: [ProductCategoriesService],
  exports: [ProductCategoriesService],
})
export class CategoriesModule {}
