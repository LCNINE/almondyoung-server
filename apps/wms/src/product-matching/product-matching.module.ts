import { Module } from '@nestjs/common';
import { ProductMatchingService } from './product-matching.service';
import { ProductMatchingController } from './product-matching.controller';

@Module({
  controllers: [ProductMatchingController],
  providers: [ProductMatchingService],
})
export class ProductMatchingModule { }
