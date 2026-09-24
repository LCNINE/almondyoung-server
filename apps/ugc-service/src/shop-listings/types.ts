import { type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { shopListingModerations, shopListings } from '../db/schema';

export type ShopListingEntity = InferSelectModel<typeof shopListings>;
export type ShopListingInsert = InferInsertModel<typeof shopListings>;
export type ShopListingModerationEntity = InferSelectModel<typeof shopListingModerations>;

/** 이미지는 order 오름차순 fileId 배열로 붙는다. [0] 이 썸네일. */
export type ShopListingWithImages = ShopListingEntity & { imageFileIds: string[] };
