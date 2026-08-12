import { Module } from '@nestjs/common';
import { ShopListingsController } from './shop-listings.controller';
import { ShopListingsService } from './shop-listings.service';
import { ShopListingManager } from './shop-listing.manager';
import { ShopListingReader } from './shop-listing.reader';

@Module({
  controllers: [ShopListingsController],
  providers: [ShopListingsService, ShopListingReader, ShopListingManager],
  exports: [ShopListingsService],
})
export class ShopListingsModule {}
