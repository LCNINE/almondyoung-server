import { Module } from '@nestjs/common';
import { SkuService } from './sku.service';
import { SkuController } from './sku.controller';

@Module({
  controllers: [SkuController],
  providers: [SkuService],
  exports: [SkuService],
})
export class SkuModule { }