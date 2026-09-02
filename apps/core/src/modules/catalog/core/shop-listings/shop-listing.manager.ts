import { Injectable } from '@nestjs/common';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { type PimSchema, pimSchema } from '../../schema/catalog.schema';
import { DbTransaction } from '../../catalog.types';
import { ShopListingEntity, ShopListingInsert } from '../../schema/catalog.schema.types';
import { CreateShopListingDto, UpdateShopListingDto } from './dto';
import { ShopListingReader } from './shop-listing.reader';

@Injectable()
export class ShopListingManager {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly reader: ShopListingReader,
  ) {}

  async create(dto: CreateShopListingDto, actorId?: string, tx?: DbTransaction): Promise<ShopListingEntity> {
    return this.db.run(async (trx) => {
      const slug = await this.resolveSlug(dto.slug || dto.title, null, trx);

      assertContent(dto.content);

      const values: ShopListingInsert = {
        slug,
        title: dto.title.trim(),
        content: dto.content,
        region: dto.region,
        businessType: dto.businessType,
        dealType: dto.dealType,
        areaPyeong: dto.areaPyeong ?? null,
        deposit: dto.deposit ?? null,
        monthlyRent: dto.monthlyRent ?? null,
        keyMoney: dto.keyMoney ?? null,
        thumbnailFileId: dto.thumbnailFileId,
        images: dto.images ?? [],
        isActive: dto.isActive ?? true,
        createdBy: actorId,
        updatedBy: actorId,
      };

      const [created] = await trx.insert(pimSchema.shopListings).values(values).returning();

      return created;
    }, tx);
  }

  async update(
    id: string,
    dto: UpdateShopListingDto,
    actorId?: string,
    tx?: DbTransaction,
  ): Promise<ShopListingEntity> {
    return this.db.run(async (trx) => {
      const current = await this.reader.findById(id, trx);

      if (dto.content !== undefined) {
        assertContent(dto.content);
      }

      const slug = dto.slug === undefined ? current.slug : await this.resolveSlug(dto.slug, id, trx);

      const [updated] = await trx
        .update(pimSchema.shopListings)
        .set({
          slug,
          title: dto.title?.trim() ?? current.title,
          content: dto.content ?? current.content,
          region: dto.region ?? current.region,
          businessType: dto.businessType ?? current.businessType,
          dealType: dto.dealType ?? current.dealType,
          areaPyeong: dto.areaPyeong === undefined ? current.areaPyeong : dto.areaPyeong,
          deposit: dto.deposit === undefined ? current.deposit : dto.deposit,
          monthlyRent: dto.monthlyRent === undefined ? current.monthlyRent : dto.monthlyRent,
          keyMoney: dto.keyMoney === undefined ? current.keyMoney : dto.keyMoney,
          thumbnailFileId: dto.thumbnailFileId ?? current.thumbnailFileId,
          images: dto.images === undefined ? current.images : dto.images,
          isActive: dto.isActive ?? current.isActive,
          updatedAt: new Date(),
          updatedBy: actorId,
        })
        .where(and(eq(pimSchema.shopListings.id, id), isNull(pimSchema.shopListings.deletedAt)))
        .returning();

      if (!updated) {
        throw new NotFoundError(`Shop listing not found: ${id}`);
      }

      return updated;
    }, tx);
  }

  async softDelete(id: string, actorId?: string, tx?: DbTransaction): Promise<void> {
    return this.db.run(async (trx) => {
      const now = new Date();

      const [deleted] = await trx
        .update(pimSchema.shopListings)
        .set({ deletedAt: now, deletedBy: actorId, updatedAt: now })
        .where(and(eq(pimSchema.shopListings.id, id), isNull(pimSchema.shopListings.deletedAt)))
        .returning();

      if (!deleted) {
        throw new NotFoundError(`Shop listing not found: ${id}`);
      }
    }, tx);
  }

  /**
   * 조회수 +1. 같은 방문자·같은 매물·같은 날은 unique 제약이 걸러내므로,
   * 로그 행이 실제로 새로 생겼을 때만 카운터를 올린다. 새로고침 반복은 첫 회만 센다.
   */
  async incrementViewCount(slug: string, visitorIp: string, tx?: DbTransaction): Promise<void> {
    await this.db.run(async (trx) => {
      const [listing] = await trx
        .select({ id: pimSchema.shopListings.id })
        .from(pimSchema.shopListings)
        .where(
          and(
            eq(pimSchema.shopListings.slug, slug),
            eq(pimSchema.shopListings.isActive, true),
            isNull(pimSchema.shopListings.deletedAt),
          ),
        )
        .limit(1);

      if (!listing) {
        return;
      }

      const inserted = await trx
        .insert(pimSchema.shopListingViews)
        .values({
          listingId: listing.id,
          visitorHash: hashVisitor(visitorIp, listing.id),
          viewedOn: today(),
        })
        .onConflictDoNothing()
        .returning({ id: pimSchema.shopListingViews.id });

      if (inserted.length === 0) {
        return;
      }

      await trx
        .update(pimSchema.shopListings)
        .set({ viewCount: sql`${pimSchema.shopListings.viewCount} + 1` })
        .where(eq(pimSchema.shopListings.id, listing.id));
    }, tx);
  }

  private async resolveSlug(raw: string, excludeId: string | null, tx: DbTransaction): Promise<string> {
    const base = slugify(raw);

    if (!base) {
      throw new BadRequestError('주소를 만들 수 없습니다. 제목에 한글이나 영문을 넣어주세요.');
    }

    for (let suffix = 0; suffix < 100; suffix += 1) {
      const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;

      if (!(await this.reader.slugTaken(candidate, excludeId, tx))) {
        return candidate;
      }
    }

    throw new ConflictError(`같은 주소가 너무 많습니다: ${base}`);
  }
}

// 한글 완성형은 코드포인트로 escape 한다 — 리터럴로 쓰면 겉보기 같은 CJK 문자가 섞여 한글이 통째로 지워진다.
const SLUG_STRIP = new RegExp('[^a-z0-9\\uAC00-\\uD7A3]+', 'g');

export function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(SLUG_STRIP, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function assertContent(content: string): void {
  if (!content.replace(/<[^>]*>/g, '').trim() && !/<img\b/i.test(content)) {
    throw new BadRequestError('본문을 입력해주세요.');
  }
}

/** IP 를 그대로 두지 않는다. 매물 id 를 섞어 매물 간 방문자 대조도 막는다. */
export function hashVisitor(ip: string, listingId: string): string {
  return createHash('sha256').update(`${ip}|${listingId}`).digest('hex').slice(0, 64);
}

/** viewed_on 은 KST 기준 날짜다. 런타임은 UTC 라 직접 더한다. */
export function today(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
