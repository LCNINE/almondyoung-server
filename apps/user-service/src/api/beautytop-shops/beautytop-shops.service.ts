import { DbService, InjectDb } from '@app/db';
import { ConflictError } from '@app/shared';
import { Injectable } from '@nestjs/common';
import * as schema from 'apps/user-service/database/drizzle/schema';
import { type UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { and, asc, eq } from 'drizzle-orm';
import { BeautytopShopDto } from './dto/beautytop-shops.dto';

/** 관심 샵 상한. 화면이 한 번에 비교하는 수와 같다. */
export const MAX_WATCHED_SHOPS = 7;

type SavedShop = Pick<schema.BeautytopSavedShop, 'shopKind' | 'shopId' | 'name' | 'sido' | 'gugun' | 'category'>;

const toShop = (row: schema.BeautytopSavedShop): SavedShop => ({
  shopKind: row.shopKind,
  shopId: row.shopId,
  name: row.name,
  sido: row.sido,
  gugun: row.gugun,
  category: row.category,
});

const values = (userId: string, role: 'MY_SHOP' | 'WATCH', shop: BeautytopShopDto) => ({
  userId,
  role,
  shopKind: shop.shopKind,
  shopId: shop.shopId,
  name: shop.name,
  sido: shop.sido ?? null,
  gugun: shop.gugun ?? null,
  category: shop.category ?? null,
});

@Injectable()
export class BeautytopShopsService {
  constructor(@InjectDb() private readonly dbService: DbService<UserServiceSchema>) {}

  async list(userId: string): Promise<{ myShop: SavedShop | null; watch: SavedShop[] }> {
    const rows = await this.dbService.db
      .select()
      .from(schema.beautytopSavedShops)
      .where(eq(schema.beautytopSavedShops.userId, userId))
      .orderBy(asc(schema.beautytopSavedShops.createdAt));
    const myShop = rows.find((r) => r.role === 'MY_SHOP');
    return { myShop: myShop ? toShop(myShop) : null, watch: rows.filter((r) => r.role === 'WATCH').map(toShop) };
  }

  async setMyShop(userId: string, shop: BeautytopShopDto | null) {
    await this.dbService.db.transaction(async (tx) => {
      await tx
        .delete(schema.beautytopSavedShops)
        .where(and(eq(schema.beautytopSavedShops.userId, userId), eq(schema.beautytopSavedShops.role, 'MY_SHOP')));
      if (shop) await tx.insert(schema.beautytopSavedShops).values(values(userId, 'MY_SHOP', shop));
    });
    return this.list(userId);
  }

  async addWatch(userId: string, shop: BeautytopShopDto) {
    const { watch } = await this.list(userId);
    const already = watch.some((w) => w.shopKind === shop.shopKind && w.shopId === shop.shopId);
    if (!already && watch.length >= MAX_WATCHED_SHOPS) {
      throw new ConflictError(`관심 샵은 ${MAX_WATCHED_SHOPS}곳까지 저장할 수 있습니다.`);
    }
    if (!already) {
      await this.dbService.db
        .insert(schema.beautytopSavedShops)
        .values(values(userId, 'WATCH', shop))
        .onConflictDoNothing();
    }
    return this.list(userId);
  }

  async removeWatch(userId: string, shopKind: string, shopId: number) {
    await this.dbService.db
      .delete(schema.beautytopSavedShops)
      .where(
        and(
          eq(schema.beautytopSavedShops.userId, userId),
          eq(schema.beautytopSavedShops.role, 'WATCH'),
          eq(schema.beautytopSavedShops.shopKind, shopKind),
          eq(schema.beautytopSavedShops.shopId, shopId),
        ),
      );
    return this.list(userId);
  }
}
