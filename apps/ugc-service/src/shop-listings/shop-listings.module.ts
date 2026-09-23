import { Module } from '@nestjs/common';
import { UgcEventsModule } from '../ugc-events.module';
import { autoDecisionPolicyFromEnv, SHOP_LISTING_AUTO_DECISION_POLICY } from './classifier/auto-decision';
import { NullShopListingClassifier, SHOP_LISTING_CLASSIFIER } from './classifier/shop-listing-classifier';
import { AdminShopListingsController } from './controllers/admin-shop-listings.controller';
import { MemberShopListingsController } from './controllers/member-shop-listings.controller';
import { PublicShopListingsController } from './controllers/public-shop-listings.controller';
import { ShopListingUserPermanentDeletedConsumer } from './consumers/user-permanent-deleted.consumer';
import { ShopListingModerationManager } from './shop-listing-moderation.manager';
import { ShopListingViewManager } from './shop-listing-view.manager';
import { ShopListingManager } from './shop-listing.manager';
import { ShopListingReader } from './shop-listing.reader';
import { ShopListingsService } from './shop-listings.service';

@Module({
  imports: [UgcEventsModule],
  controllers: [PublicShopListingsController, MemberShopListingsController, AdminShopListingsController, ShopListingUserPermanentDeletedConsumer],
  providers: [
    ShopListingsService,
    ShopListingReader,
    ShopListingManager,
    ShopListingModerationManager,
    ShopListingViewManager,
    // v1: Jev 키가 나오기 전까지 모든 회원 글을 관리자 대기로 보낸다 (spec §6).
    { provide: SHOP_LISTING_CLASSIFIER, useClass: NullShopListingClassifier },
    { provide: SHOP_LISTING_AUTO_DECISION_POLICY, useFactory: () => autoDecisionPolicyFromEnv() },
  ],
})
export class ShopListingsModule {}
