import { Module } from '@nestjs/common';
import { OrderCollectService } from './order-collect.service';
import { OrderCollectController } from './order-collect.controller';

@Module({
  controllers: [OrderCollectController],
  providers: [OrderCollectService],
})
export class OrderCollectModule {}
