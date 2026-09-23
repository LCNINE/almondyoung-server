import { Module } from '@nestjs/common';
import { autoDecisionPolicyFromEnv, SHOP_LISTING_AUTO_DECISION_POLICY } from './classifier/auto-decision';
import { NullShopListingClassifier, SHOP_LISTING_CLASSIFIER } from './classifier/shop-listing-classifier';
import { AdminShopListingsController } from './controllers/admin-shop-listings.controller';
import { MemberShopListingsController } from './controllers/member-shop-listings.controller';
import { PublicShopListingsController } from './controllers/public-shop-listings.controller';
import { ShopListingUserWithdrawalConsumer } from './consumers/user-withdrawal.consumer';
import { ShopListingModerationManager } from './shop-listing-moderation.manager';
import { ShopListingViewManager } from './shop-listing-view.manager';
import { ShopListingManager } from './shop-listing.manager';
import { ShopListingReader } from './shop-listing.reader';
import { ShopListingsService } from './shop-listings.service';

@Module({
  controllers: [PublicShopListingsController, MemberShopListingsController, AdminShopListingsController, ShopListingUserWithdrawalConsumer],
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
