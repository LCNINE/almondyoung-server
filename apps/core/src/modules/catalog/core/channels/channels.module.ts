import { Module } from '@nestjs/common';
import { SalesChannelsController } from './sales-channels.controller';
import { ChannelProductsController } from './channel-products.controller';
import { ChannelCategoriesController } from './channel-categories.controller';
import { ChannelListingController } from './channel-listing.controller';
import { SalesChannelsService } from './sales-channels.service';
import { ChannelProductsService } from './channel-products.service';
import { ChannelCategoriesService } from './channel-categories.service';
import { ChannelListingService } from './channel-listing.service';
import { ProductsModule } from '../products/products.module';
import { ProductSellableQuantityModule } from '../../../inventory/product-sellable-quantity/product-sellable-quantity.module';

@Module({
  imports: [ProductsModule, ProductSellableQuantityModule],
  controllers: [
    SalesChannelsController,
    ChannelProductsController,
    ChannelCategoriesController,
    ChannelListingController,
  ],
  providers: [SalesChannelsService, ChannelProductsService, ChannelCategoriesService, ChannelListingService],
  exports: [SalesChannelsService, ChannelProductsService, ChannelCategoriesService, ChannelListingService],
})
export class ChannelsModule {}
