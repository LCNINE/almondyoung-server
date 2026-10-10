import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray } from 'drizzle-orm';
import type { DbService } from '@app/db';
import { pointEventDetails, pointEvents, pointHoldDetails, pointHolds, walletSchema, WalletSchema } from '../../schema';
import { PointsAdminService } from '../../admin/points-admin.service';
import { PointsLedgerService } from './points-ledger.service';
import { PointsPaymentProvider } from './points.provider';

/**
 * #1016 36번 PR 0 — 확정된 포인트 결제분의 환불이 원장을 찾는가.
 * 확정은 provider 에 승인 결제분 id 를 넘기므로(capture.service.ts captureOneLeg) 사용(REDEEM)은 승인 id 로 쌓인다.
 * provider 를 mock 하지 않는다 — 기존 스펙이 mock 이라 이 결함을 못 잡았다.
 *
 * 실행: 스크래치 DB 에 wallet 마이그레이션 적용 후
 *   DATABASE_URL=postgresql://postgres:<pw>@localhost:5432/wallet_itest REQUIRE_WALLET_DB=1 \
 *     npx jest apps/wallet/src/providers/points/points-refund-leg.integration.spec.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

if (process.env.REQUIRE_WALLET_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_WALLET_DB=1 인데 DATABASE_URL 이 없습니다');
}

interface PaidWithPoints {
  userId: string;
  intentId: string;
  authorizeId: string;
  captureId: string;
}

describeIfDb('포인트 환불 원장 키 (실 Postgres)', () => {
  jest.setTimeout(60_000);

  let sql: postgres.Sql;
  let provider: PointsPaymentProvider;
  let pointsAdmin: PointsAdminService;
  const userIds: string[] = [];

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    const db = drizzle(sql, { schema: walletSchema });
    const dbService = { db } as unknown as DbService<WalletSchema>;
    provider = new PointsPaymentProvider(dbService, new PointsLedgerService());
    pointsAdmin = new PointsAdminService(dbService);
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      const db = drizzle(sql, { schema: walletSchema });
      const holds = await db.select({ id: pointHolds.id }).from(pointHolds).where(inArray(pointHolds.userId, userIds));
      if (holds.length > 0) {
        await db.delete(pointHoldDetails).where(inArray(pointHoldDetails.holdId, holds.map((h) => h.id)));
        await db.delete(pointHolds).where(inArray(pointHolds.userId, userIds));
      }
      await db.delete(pointEventDetails).where(inArray(pointEventDetails.userId, userIds));
      await db.delete(pointEvents).where(inArray(pointEvents.userId, userIds));
    }
    await sql.end();
  });

  /** 포인트 3,000 을 승인·확정한 결제를 만든다. 반환: 승인 결제분 id 와 확정 결제분 id */
  async function paidWithPoints(): Promise<PaidWithPoints> {
    const userId = `itest-points-${randomUUID()}`;
    userIds.push(userId);
    await pointsAdmin.earn(userId, 10_000, 'ITEST');
    const intentId = randomUUID();
    const authorizeId = randomUUID();
    const captureId = randomUUID();
    const base = { intentId, paymentMethodId: randomUUID(), userId, amount: 3_000, currency: 'KRW' };

    const authorized = await provider.authorize({
      ...base,
      chargeId: authorizeId,
      idempotencyKey: `wallet:authorize:${authorizeId}`,
      correlationId: 'itest',
    });
    expect(authorized.status).toBe('SUCCEEDED');

    // capture.service.ts captureOneLeg 와 같다 — 확정 결제분 행을 따로 만들지만 provider 엔 승인 id 를 넘긴다
    const captured = await provider.capture({
      ...base,
      chargeId: authorizeId,
      idempotencyKey: `wallet:capture:${authorizeId}`,
      correlationId: 'itest',
    });
    expect(captured.status).toBe('SUCCEEDED');
    return { userId, intentId, authorizeId, captureId };
  }

  function refund(p: PaidWithPoints, amount: number, authorizeChargeId?: string, refundId: string = randomUUID()) {
    return provider.refund({
      refundId,
      chargeId: p.captureId,
      authorizeChargeId,
      intentId: p.intentId,
      userId: p.userId,
      amount,
      currency: 'KRW',
      idempotencyKey: `wallet:refund:${refundId}`,
      correlationId: 'itest',
    });
  }

  it('authorizeChargeId 없이 확정 결제분 id 로만 부르면 원장을 못 찾는다(결함 재현 — 옛 호출 모양)', async () => {
    const p = await paidWithPoints();
    const result = await refund(p, 3_000);
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('NO_CAPTURED_REDEEM');
  });

  it('authorizeChargeId 로 승인 결제분 id 를 주면 전액 환불된다', async () => {
    const p = await paidWithPoints();
    const result = await refund(p, 3_000, p.authorizeId);
    expect(result.status).toBe('SUCCEEDED');

    const cancels = await sql`
      select amount, leg_id from point_events
       where user_id = ${p.userId} and event_type = 'REDEEM_CANCEL'`;
    expect(cancels.map((r) => ({ amount: r.amount, legId: r.leg_id }))).toEqual([{ amount: 3_000, legId: p.authorizeId }]);
  });

  it('부분 환불 두 번은 남은 금액 안에서 되고, 넘치면 거절된다', async () => {
    const p = await paidWithPoints();
    expect((await refund(p, 1_000, p.authorizeId)).status).toBe('SUCCEEDED');
    expect((await refund(p, 2_000, p.authorizeId)).status).toBe('SUCCEEDED');
    const over = await refund(p, 1, p.authorizeId);
    expect(over.status).toBe('FAILED');
    expect(over.errorCode).toBe('REFUND_AMOUNT_EXCEEDS_REMAINING');
  });

  it('같은 멱등 키로 두 번 부르면 두 번째는 재생이다', async () => {
    const p = await paidWithPoints();
    const refundId = randomUUID();
    expect((await refund(p, 3_000, p.authorizeId, refundId)).status).toBe('SUCCEEDED');
    const second = await refund(p, 3_000, p.authorizeId, refundId);
    expect(second.status).toBe('SUCCEEDED');
    expect(second.raw).toEqual(expect.objectContaining({ idempotentReplay: true }));

    const cancels = await sql`
      select count(*)::int as n from point_events
       where user_id = ${p.userId} and event_type = 'REDEEM_CANCEL'`;
    expect(cancels[0].n).toBe(1);
  });
});
