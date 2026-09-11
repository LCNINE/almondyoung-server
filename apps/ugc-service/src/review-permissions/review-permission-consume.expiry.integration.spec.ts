import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import type { DbService } from '@app/db';
import { reviewEligibilities, reviews, ugcServiceSchema, type UgcServiceSchema, type UgcTx } from '../db/schema';
import { ReviewPermissionService } from './review-permission.service';

/**
 * 만료가 «소비 문장 안»에서 실제로 강제되는지를 실 Postgres 로 본다.
 *
 * 목으로는 확인할 수 없다 — 관건이 「조건부 UPDATE 가 0행을 돌려준다」이고, 그건 던졌다는
 * 사실이 아니라 «남은 행»으로만 판정된다. 던지기만 하고 소비해 버리는 구현을 배제하려면
 * `consumed_at` 이 null 로 남는 것까지 봐야 한다.
 *
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc \
 *   npx jest --testPathPattern="review-permission-consume.expiry.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('만료된 자격으로는 리뷰를 쓸 수 없다 (실 Postgres)', () => {
  jest.setTimeout(120_000);

  const userId = randomUUID();
  const productId = randomUUID();

  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<UgcServiceSchema>>;
  let service: ReviewPermissionService;

  const createdPermissionIds: string[] = [];
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 2 });
    db = drizzle(sql, { schema: ugcServiceSchema });
    service = new ReviewPermissionService({
      db,
      run: (fn: (trx: unknown) => unknown, tx?: unknown) => (tx ? fn(tx) : db.transaction(fn as never)),
    } as unknown as DbService<UgcServiceSchema>);
  });

  afterAll(async () => {
    if (createdPermissionIds.length > 0) {
      await db.delete(reviews).where(inArray(reviews.reviewPermissionId, createdPermissionIds));
      await db.delete(reviewEligibilities).where(inArray(reviewEligibilities.id, createdPermissionIds));
    }
    if (createdOrderIds.length > 0) {
      await db.delete(reviewEligibilities).where(inArray(reviewEligibilities.orderId, createdOrderIds));
    }
    await sql.end();
  });

  async function seedPermission(expiresAt: Date): Promise<string> {
    const permissionId = randomUUID();
    createdPermissionIds.push(permissionId);
    await db.insert(reviewEligibilities).values({
      id: permissionId,
      userId,
      productId,
      orderId: `order-${permissionId}`,
      provider: 'order',
      orderLineId: `line-${permissionId}`,
      orderLineAmount: 20000,
      expiresAt,
    });
    return permissionId;
  }

  async function consumedAtOf(permissionId: string): Promise<Date | null> {
    const [row] = await db
      .select({ consumedAt: reviewEligibilities.consumedAt })
      .from(reviewEligibilities)
      .where(eq(reviewEligibilities.id, permissionId));
    return row.consumedAt;
  }

  it('만료된 자격은 거절되고, 그 자격이 «소비되지 않은 채» 남는다', async () => {
    const permissionId = await seedPermission(new Date(Date.now() - 24 * 60 * 60 * 1000));

    await expect(
      db.transaction(async (tx) => service.consume({ permissionId, userId, productId }, tx as unknown as UgcTx)),
    ).rejects.toMatchObject({ message: '리뷰 작성 자격이 없습니다.' });

    // 🔴 판정은 부수효과로 한다 — 던졌다는 사실만으로는 「던지고 소비까지 했다」를 배제하지 못한다.
    expect(await consumedAtOf(permissionId)).toBeNull();
  });

  it('아직 만료되지 않은 자격은 정상 소비된다 (경계값)', async () => {
    const permissionId = await seedPermission(new Date(Date.now() + 60 * 1000));

    const consumed = await db.transaction(async (tx) =>
      service.consume({ permissionId, userId, productId }, tx as unknown as UgcTx),
    );

    expect(consumed.id).toBe(permissionId);
    expect(await consumedAtOf(permissionId)).not.toBeNull();
  });

  it('발급되는 자격의 만료가 90일 뒤다', async () => {
    const orderId = `order-${randomUUID()}`;
    createdOrderIds.push(orderId);

    const before = Date.now();
    const [created] = await service.create({
      userId,
      orderId,
      items: [{ productId, orderLineId: `line-${randomUUID()}`, orderLineAmount: 10000 }],
    });
    const after = Date.now();

    const ninetyDays = 90 * 24 * 60 * 60 * 1000;
    expect(created.expiresAt.getTime()).toBeGreaterThanOrEqual(before + ninetyDays - 5_000);
    expect(created.expiresAt.getTime()).toBeLessThanOrEqual(after + ninetyDays + 5_000);
  });
});
