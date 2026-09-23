import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { shopListings, shopListingViews, type UgcServiceSchema, type UgcTx } from '../db/schema';
import { PUBLIC_SHOP_LISTING_STATUSES } from './shop-listing.constants';
import { hashVisitor, kstToday } from './shop-listing.util';

@Injectable()
export class ShopListingViewManager {
  constructor(@InjectDb() private readonly db: DbService<UgcServiceSchema>) {}

  /**
   * 조회수 +1. 같은 방문자·같은 매물·같은 날은 unique 제약이 걸러내므로,
   * 로그 행이 실제로 새로 생겼을 때만 카운터를 올린다.
   */
  async recordView(slug: string, visitorIp: string, tx?: UgcTx): Promise<void> {
    await this.db.run(async (trx) => {
      const [listing] = await trx
        .select({ id: shopListings.id })
        .from(shopListings)
        .where(
          and(
            eq(shopListings.slug, slug),
            inArray(shopListings.status, [...PUBLIC_SHOP_LISTING_STATUSES]),
            isNull(shopListings.deletedAt),
          ),
        )
        .limit(1);
      if (!listing) return;

      const inserted = await trx
        .insert(shopListingViews)
        .values({ listingId: listing.id, visitorHash: hashVisitor(visitorIp, listing.id), viewedOn: kstToday() })
        .onConflictDoNothing()
        .returning({ id: shopListingViews.id });
      if (inserted.length === 0) return;

      await trx
        .update(shopListings)
        .set({ viewCount: sql`${shopListings.viewCount} + 1` })
        .where(eq(shopListings.id, listing.id));
    }, tx);
  }
}
