import { Module } from '@nestjs/common';
import { INTERNAL_KEY_ENV } from '@app/authorization';
import { SalesChannelsController } from './sales-channels.controller';
import { SalesChannelsInternalController } from './sales-channels-internal.controller';
import { ChannelCategoriesController } from './channel-categories.controller';
import { ChannelListingController } from './channel-listing.controller';
import { SalesChannelsService } from './sales-channels.service';
import { ChannelCategoriesService } from './channel-categories.service';
import { ChannelListingService } from './channel-listing.service';
import { ProductsModule } from '../products/products.module';
import { ProductSellableQuantityModule } from '../../../inventory/product-sellable-quantity/product-sellable-quantity.module';

@Module({
  imports: [ProductsModule, ProductSellableQuantityModule],
  controllers: [
    SalesChannelsController,
    SalesChannelsInternalController,
    ChannelCategoriesController,
    ChannelListingController,
  ],
  providers: [
    SalesChannelsService,
    ChannelCategoriesService,
    ChannelListingService,
    // `InternalKeyGuard` 가 읽을 env 이름. core 로 들어오는 서비스 간 호출은 이 키 하나를 쓴다.
    { provide: INTERNAL_KEY_ENV, useValue: 'CORE_INTERNAL_KEY' },
  ],
  exports: [SalesChannelsService, ChannelCategoriesService, ChannelListingService],
})
export class ChannelsModule {}
