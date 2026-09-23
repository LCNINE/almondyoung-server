import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, type SQL } from 'drizzle-orm';
import {
  shopListingImages,
  shopListingModerations,
  shopListings,
  type UgcServiceSchema,
  type UgcTx,
} from '../db/schema';
import { type AdminShopListingListQueryDto } from './dto';
import { PUBLIC_SHOP_LISTING_STATUSES } from './shop-listing.constants';
import { type ShopListingEntity, type ShopListingModerationEntity, type ShopListingWithImages } from './types';

@Injectable()
export class ShopListingReader {
  constructor(@InjectDb() private readonly db: DbService<UgcServiceSchema>) {}

  async listPublic(tx?: UgcTx): Promise<ShopListingWithImages[]> {
    return this.db.run(async (trx) => {
      const rows = await trx
        .select()
        .from(shopListings)
        .where(and(inArray(shopListings.status, [...PUBLIC_SHOP_LISTING_STATUSES]), isNull(shopListings.deletedAt)))
        .orderBy(desc(shopListings.createdAt));
      return this.attachImages(trx, rows);
    }, tx);
  }

  async findPublicBySlug(slug: string, tx?: UgcTx): Promise<ShopListingWithImages> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select()
        .from(shopListings)
        .where(this.publicSlugCondition(slug))
        .limit(1);
      if (!row) throw new NotFoundError(`Shop listing not found: ${slug}`);
      const [withImages] = await this.attachImages(trx, [row]);
      return withImages;
    }, tx);
  }

  async findContactBySlug(
    slug: string,
    tx?: UgcTx,
  ): Promise<Pick<ShopListingEntity, 'contactPhone' | 'kakaoOpenChatUrl'>> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select({ contactPhone: shopListings.contactPhone, kakaoOpenChatUrl: shopListings.kakaoOpenChatUrl })
        .from(shopListings)
        .where(this.publicSlugCondition(slug))
        .limit(1);
      if (!row) throw new NotFoundError(`Shop listing not found: ${slug}`);
      return row;
    }, tx);
  }

  /**
   * 회원 쪽 조회는 전부 `author_type='member'` 로 좁힌다 — 이관된 관리자 글은 author_user_id 에 그 직원의
   * id 를 들고 있어, 좁히지 않으면 직원이 스토어프론트 「내 글」에서 관리자 글을 고치고 지울 수 있다.
   */
  async listByAuthor(userId: string, tx?: UgcTx): Promise<ShopListingWithImages[]> {
    return this.db.run(async (trx) => {
      const rows = await trx
        .select()
        .from(shopListings)
        .where(
          and(
            eq(shopListings.authorUserId, userId),
            eq(shopListings.authorType, 'member'),
            isNull(shopListings.deletedAt),
          ),
        )
        .orderBy(desc(shopListings.createdAt));
      return this.attachImages(trx, rows);
    }, tx);
  }

  /** 남의 글·삭제된 글은 존재를 숨기고 404 — 소유권은 WHERE 에서 판정한다. */
  async findOwned(id: string, userId: string, tx?: UgcTx): Promise<ShopListingWithImages> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select()
        .from(shopListings)
        .where(
          and(
            eq(shopListings.id, id),
            eq(shopListings.authorUserId, userId),
            eq(shopListings.authorType, 'member'),
            isNull(shopListings.deletedAt),
          ),
        )
        .limit(1);
      if (!row) throw new NotFoundError(`Shop listing not found: ${id}`);
      const [withImages] = await this.attachImages(trx, [row]);
      return withImages;
    }, tx);
  }

  async listForAdmin(query: AdminShopListingListQueryDto, tx?: UgcTx): Promise<ShopListingWithImages[]> {
    return this.db.run(async (trx) => {
      const conditions: SQL[] = [isNull(shopListings.deletedAt)];
      if (query.status) conditions.push(eq(shopListings.status, query.status));
      if (query.authorType) conditions.push(eq(shopListings.authorType, query.authorType));
      if (query.q) conditions.push(ilike(shopListings.title, `%${query.q}%`));

      // 검토 대기열은 오래 기다린 순서대로 본다.
      const order = query.status === 'pending' ? asc(shopListings.submittedAt) : desc(shopListings.createdAt);

      const rows = await trx
        .select()
        .from(shopListings)
        .where(and(...conditions))
        .orderBy(order);
      return this.attachImages(trx, rows);
    }, tx);
  }

  async findForAdmin(id: string, tx?: UgcTx): Promise<ShopListingWithImages> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select()
        .from(shopListings)
        .where(and(eq(shopListings.id, id), isNull(shopListings.deletedAt)))
        .limit(1);
      if (!row) throw new NotFoundError(`Shop listing not found: ${id}`);
      const [withImages] = await this.attachImages(trx, [row]);
      return withImages;
    }, tx);
  }

  async listModerations(listingId: string, tx?: UgcTx): Promise<ShopListingModerationEntity[]> {
    return this.db.run(async (trx) => {
      return trx
        .select()
        .from(shopListingModerations)
        .where(eq(shopListingModerations.listingId, listingId))
        .orderBy(desc(shopListingModerations.createdAt));
    }, tx);
  }

  async slugTaken(slug: string, excludeId: string | null, tx?: UgcTx): Promise<boolean> {
    return this.db.run(async (trx) => {
      const conditions: SQL[] = [eq(shopListings.slug, slug), isNull(shopListings.deletedAt)];
      if (excludeId) conditions.push(ne(shopListings.id, excludeId));
      const [row] = await trx
        .select({ id: shopListings.id })
        .from(shopListings)
        .where(and(...conditions))
        .limit(1);
      return row !== undefined;
    }, tx);
  }

  /** 동시 게시 한도의 분자. 호출자는 advisory lock 을 잡은 트랜잭션에서 부른다. */
  async countActiveByAuthor(userId: string, tx?: UgcTx): Promise<number> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select({ n: count() })
        .from(shopListings)
        .where(
          and(
            eq(shopListings.authorUserId, userId),
            eq(shopListings.authorType, 'member'),
            inArray(shopListings.status, ['pending', 'published']),
            isNull(shopListings.deletedAt),
          ),
        );
      return row?.n ?? 0;
    }, tx);
  }

  private publicSlugCondition(slug: string): SQL | undefined {
    return and(
      eq(shopListings.slug, slug),
      inArray(shopListings.status, [...PUBLIC_SHOP_LISTING_STATUSES]),
      isNull(shopListings.deletedAt),
    );
  }

  private async attachImages(trx: UgcTx, rows: ShopListingEntity[]): Promise<ShopListingWithImages[]> {
    if (rows.length === 0) return [];
    const images = await trx
      .select({ listingId: shopListingImages.listingId, fileId: shopListingImages.fileId })
      .from(shopListingImages)
      .where(
        inArray(
          shopListingImages.listingId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(shopListingImages.listingId), asc(shopListingImages.order));

    const byListing = new Map<string, string[]>();
    for (const image of images) {
      const list = byListing.get(image.listingId) ?? [];
      list.push(image.fileId);
      byListing.set(image.listingId, list);
    }
    return rows.map((r) => ({ ...r, imageFileIds: byListing.get(r.id) ?? [] }));
  }
}
