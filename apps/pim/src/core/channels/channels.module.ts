import { Module } from '@nestjs/common';
import { SalesChannelsController } from './sales-channels.controller';
import { ChannelProductsController } from './channel-products.controller';
import { SalesChannelsService } from './sales-channels.service';
import { ChannelProductsService } from './channel-products.service';

@Module({
  controllers: [SalesChannelsController, ChannelProductsController],
  providers: [SalesChannelsService, ChannelProductsService],
  exports: [SalesChannelsService, ChannelProductsService],
})
export class ChannelsModule {}

