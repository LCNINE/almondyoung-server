import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { and, desc, eq, ilike, isNull, ne, SQL } from 'drizzle-orm';
import { type PimSchema, pimSchema } from '../../schema/catalog.schema';
import { DbTransaction } from '../../catalog.types';
import { ShopListingEntity } from '../../schema/catalog.schema.types';
import { ShopListingListQueryDto } from './dto';

@Injectable()
export class ShopListingReader {
  constructor(@InjectDb() private readonly db: DbService<PimSchema>) {}

  async findById(id: string, tx?: DbTransaction): Promise<ShopListingEntity> {
    return this.db.run(async (trx) => {
      const [listing] = await trx
        .select()
        .from(pimSchema.shopListings)
        .where(and(eq(pimSchema.shopListings.id, id), isNull(pimSchema.shopListings.deletedAt)))
        .limit(1);

      if (!listing) {
        throw new NotFoundError(`Shop listing not found: ${id}`);
      }

      return listing;
    }, tx);
  }

  async findPublicBySlug(slug: string, tx?: DbTransaction): Promise<ShopListingEntity> {
    return this.db.run(async (trx) => {
      const [listing] = await trx
        .select()
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
        throw new NotFoundError(`Shop listing not found: ${slug}`);
      }

      return listing;
    }, tx);
  }

  async findAll(query: ShopListingListQueryDto = {}, tx?: DbTransaction): Promise<ShopListingEntity[]> {
    return this.db.run(async (trx) => {
      const conditions: SQL[] = [isNull(pimSchema.shopListings.deletedAt)];

      if (query.isActive !== undefined) {
        conditions.push(eq(pimSchema.shopListings.isActive, query.isActive));
      } else if (!query.includeInactive) {
        conditions.push(eq(pimSchema.shopListings.isActive, true));
      }

      if (query.q?.trim()) {
        conditions.push(ilike(pimSchema.shopListings.title, `%${query.q.trim()}%`));
      }

      return trx
        .select()
        .from(pimSchema.shopListings)
        .where(and(...conditions))
        .orderBy(desc(pimSchema.shopListings.createdAt));
    }, tx);
  }

  async findPublic(tx?: DbTransaction): Promise<ShopListingEntity[]> {
    return this.db.run(async (trx) => {
      return trx
        .select()
        .from(pimSchema.shopListings)
        .where(and(eq(pimSchema.shopListings.isActive, true), isNull(pimSchema.shopListings.deletedAt)))
        .orderBy(desc(pimSchema.shopListings.createdAt));
    }, tx);
  }

  async slugTaken(slug: string, excludeId: string | null, tx?: DbTransaction): Promise<boolean> {
    return this.db.run(async (trx) => {
      const conditions: SQL[] = [eq(pimSchema.shopListings.slug, slug), isNull(pimSchema.shopListings.deletedAt)];

      if (excludeId) {
        conditions.push(ne(pimSchema.shopListings.id, excludeId));
      }

      const [row] = await trx
        .select({ id: pimSchema.shopListings.id })
        .from(pimSchema.shopListings)
        .where(and(...conditions))
        .limit(1);

      return row !== undefined;
    }, tx);
  }
}
