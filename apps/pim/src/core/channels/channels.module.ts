import { Module } from '@nestjs/common';
import { SalesChannelsController } from './sales-channels.controller';
import { ChannelProductsController } from './channel-products.controller';
import { ChannelCategoriesController } from './channel-categories.controller';
import { SalesChannelsService } from './sales-channels.service';
import { ChannelProductsService } from './channel-products.service';
import { ChannelCategoriesService } from './channel-categories.service';

@Module({
  controllers: [
    SalesChannelsController,
    ChannelProductsController,
    ChannelCategoriesController,
  ],
  providers: [
    SalesChannelsService,
    ChannelProductsService,
    ChannelCategoriesService,
  ],
  exports: [
    SalesChannelsService,
    ChannelProductsService,
    ChannelCategoriesService,
  ],
})
export class ChannelsModule {}

