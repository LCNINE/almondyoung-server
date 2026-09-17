import { Module } from '@nestjs/common';
import { ProductDescriptionController } from './controllers/product-description.controller';
import { ProductDescriptionService } from './services/product-description.service';

@Module({
  controllers: [ProductDescriptionController],
  providers: [ProductDescriptionService],
})
export class ProductDescriptionModule {}
