import { getTableConfig } from 'drizzle-orm/pg-core';
import { shopListingImages, shopListings, ugcServiceSchema } from '../../db/schema';
import { PUBLIC_SHOP_LISTING_STATUSES, SHOP_LISTING_STATUSES } from '../shop-listing.constants';

describe('샵 매매 스키마', () => {
  it('ugcServiceSchema 에 네 테이블이 등록돼 있다 — 빠지면 DbService 가 못 본다', () => {
    expect(Object.keys(ugcServiceSchema)).toEqual(
      expect.arrayContaining(['shopListings', 'shopListingImages', 'shopListingModerations', 'shopListingViews']),
    );
  });

  it('slug unique 는 살아 있는 행에만 걸린다 — 삭제된 글의 slug 를 재사용할 수 있어야 한다', () => {
    const slugIndex = getTableConfig(shopListings).indexes.find((i) => i.config.name === 'shop_listings_slug_unique');
    expect(slugIndex?.config.unique).toBe(true);
    expect(slugIndex?.config.where).toBeDefined();
  });

  it('이미지 순서는 글 안에서 유일하다', () => {
    const orderIndex = getTableConfig(shopListingImages).indexes.find(
      (i) => i.config.name === 'shop_listing_images_listing_order_unique',
    );
    expect(orderIndex?.config.unique).toBe(true);
  });

  it('공개 상태는 전체 상태의 부분집합이다', () => {
    for (const status of PUBLIC_SHOP_LISTING_STATUSES) {
      expect(SHOP_LISTING_STATUSES).toContain(status);
    }
  });
});
