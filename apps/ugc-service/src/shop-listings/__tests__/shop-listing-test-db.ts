import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray } from 'drizzle-orm';
import type { DbService } from '@app/db';
import {
  shopListingImages,
  shopListings,
  ugcServiceSchema,
  type UgcServiceSchema,
} from '../../db/schema';
import { type ShopListingInsert } from '../types';

export type TestDrizzle = ReturnType<typeof drizzle<UgcServiceSchema>>;

export function makeTestDb(url: string): { sql: postgres.Sql; db: TestDrizzle; dbService: DbService<UgcServiceSchema> } {
  const sql = postgres(url, { max: 6 });
  const db = drizzle(sql, { schema: ugcServiceSchema });
  // 기존 ugc 통합 스펙과 같은 모양의 더블 — run 의 전파 규칙만 흉내 낸다.
  const dbService = {
    db,
    run: (fn: (trx: unknown) => unknown, tx?: unknown) => (tx ? fn(tx) : db.transaction(fn as never)),
  } as unknown as DbService<UgcServiceSchema>;
  return { sql, db, dbService };
}

export async function insertListing(db: TestDrizzle, overrides: Partial<ShopListingInsert> = {}): Promise<string> {
  const id = randomUUID();
  await db.insert(shopListings).values({
    id,
    slug: `test-${id}`,
    title: '테스트 매물',
    content: '본문',
    region: 'seoul',
    businessType: 'nail',
    dealType: 'transfer',
    authorType: 'member',
    authorUserId: randomUUID(),
    status: 'pending',
    contactPhone: '01012345678',
    submittedAt: new Date(),
    ...overrides,
  });
  await db.insert(shopListingImages).values({ listingId: id, fileId: randomUUID(), order: 0 });
  return id;
}

/** 이미지·판정 이력·조회 기록은 FK cascade 로 같이 지워진다. */
export async function cleanup(db: TestDrizzle, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(shopListings).where(inArray(shopListings.id, ids));
}
