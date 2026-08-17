import { Module } from '@nestjs/common';
import { SalesChannelsController } from './sales-channels.controller';
import { ChannelCategoriesController } from './channel-categories.controller';
import { ChannelListingController } from './channel-listing.controller';
import { SalesChannelsService } from './sales-channels.service';
import { ChannelCategoriesService } from './channel-categories.service';
import { ChannelListingService } from './channel-listing.service';
import { ProductsModule } from '../products/products.module';
import { ProductSellableQuantityModule } from '../../../inventory/product-sellable-quantity/product-sellable-quantity.module';

@Module({
  imports: [ProductsModule, ProductSellableQuantityModule],
  controllers: [SalesChannelsController, ChannelCategoriesController, ChannelListingController],
  providers: [SalesChannelsService, ChannelCategoriesService, ChannelListingService],
  exports: [SalesChannelsService, ChannelCategoriesService, ChannelListingService],
})
export class ChannelsModule {}
