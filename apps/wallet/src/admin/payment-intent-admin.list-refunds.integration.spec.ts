import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray } from 'drizzle-orm';
import type { DbService } from '@app/db';
import { charges, paymentIntents, paymentMethods, refunds, walletSchema, WalletSchema } from '../schema';
import { PaymentIntentAdminService } from './payment-intent-admin.service';

/**
 * 관리자 환불 «목록»의 manualConfirmable 이 상세와 같은 규칙(isManuallyConfirmable)인가 — 목록에 [완료 처리]를 두는 근거(#1016 36번 PR 6).
 * 실행: DATABASE_URL=<wallet 마이그 적용된 스크래치 DB> REQUIRE_WALLET_DB=1 npx jest apps/wallet/src/admin/payment-intent-admin.list-refunds.integration.spec.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
if (process.env.REQUIRE_WALLET_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_WALLET_DB=1 인데 DATABASE_URL 이 없습니다');
}

describeIfDb('PaymentIntentAdminService.listRefunds — manualConfirmable (실 Postgres)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<WalletSchema>>;
  let service: PaymentIntentAdminService;

  const methodTossId = randomUUID();
  const methodBankId = randomUUID();
  const intentId = randomUUID();
  const chargeTossId = randomUUID();
  const chargeBankId = randomUUID();
  const refundIds = { manualToss: randomUUID(), autoToss: randomUUID(), autoBank: randomUUID(), doneManual: randomUUID() };

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: walletSchema });
    service = new PaymentIntentAdminService({ db } as unknown as DbService<WalletSchema>, {} as never);
    await db.insert(paymentMethods).values([
      { id: methodTossId, userId: 'itest-user', type: 'TOSS' },
      { id: methodBankId, userId: 'itest-user', type: 'BANK_TRANSFER' },
    ]);
    await db.insert(paymentIntents).values({
      id: intentId,
      payableAmount: 30_000,
      currency: 'KRW',
      status: 'SUCCEEDED' as const,
      clientSecret: `itest-${intentId.slice(0, 20)}`,
      expiresAt: new Date('2031-04-01T00:00:00+09:00'),
    });
    await db.insert(charges).values([
      { id: chargeTossId, intentId, paymentMethodId: methodTossId, amount: 20_000, currency: 'KRW', operation: 'CAPTURE', status: 'SUCCEEDED', providerIdempotencyKey: `itest-${chargeTossId}` },
      { id: chargeBankId, intentId, paymentMethodId: methodBankId, amount: 10_000, currency: 'KRW', operation: 'CAPTURE', status: 'SUCCEEDED', providerIdempotencyKey: `itest-${chargeBankId}` },
    ]);
    await db.insert(refunds).values([
      { id: refundIds.manualToss, chargeId: chargeTossId, intentId, amount: 5_000, currency: 'KRW', status: 'PENDING', execution: 'MANUAL' },
      { id: refundIds.autoToss, chargeId: chargeTossId, intentId, amount: 5_000, currency: 'KRW', status: 'PENDING', execution: 'AUTO' },
      { id: refundIds.autoBank, chargeId: chargeBankId, intentId, amount: 5_000, currency: 'KRW', status: 'PENDING', execution: 'AUTO' },
      { id: refundIds.doneManual, chargeId: chargeTossId, intentId, amount: 5_000, currency: 'KRW', status: 'SUCCEEDED', execution: 'MANUAL' },
    ]);
  });

  afterAll(async () => {
    if (db) {
      await db.delete(refunds).where(inArray(refunds.id, Object.values(refundIds)));
      await db.delete(charges).where(inArray(charges.id, [chargeTossId, chargeBankId]));
      await db.delete(paymentIntents).where(inArray(paymentIntents.id, [intentId]));
      await db.delete(paymentMethods).where(inArray(paymentMethods.id, [methodTossId, methodBankId]));
    }
    await sql?.end();
  });

  it('목록과 상세가 같은 규칙 — MANUAL PENDING·무통장 PENDING 만 true, 카드 AUTO PENDING·끝난 행은 false', async () => {
    const list = await service.listRefunds({ intentId, page: 1, limit: 20 } as never);
    const byId = new Map(list.data.map((r) => [r.id, r.manualConfirmable]));
    expect(byId.get(refundIds.manualToss)).toBe(true);
    expect(byId.get(refundIds.autoBank)).toBe(true);
    expect(byId.get(refundIds.autoToss)).toBe(false);
    expect(byId.get(refundIds.doneManual)).toBe(false);
    expect(list.total).toBe(4);
  });

  it('종류 필터 — kind=RETURN 은 그 행만, kind=UNKNOWN 은 kind 가 null 인 행만', async () => {
    await db.update(refunds).set({ kind: 'RETURN' }).where(inArray(refunds.id, [refundIds.manualToss]));
    const ret = await service.listRefunds({ intentId, kind: 'RETURN', page: 1, limit: 20 } as never);
    expect(ret.data.map((r) => r.id)).toEqual([refundIds.manualToss]);
    const unknown = await service.listRefunds({ intentId, kind: 'UNKNOWN', page: 1, limit: 20 } as never);
    expect(unknown.data.map((r) => r.id).sort()).toEqual(
      [refundIds.autoToss, refundIds.autoBank, refundIds.doneManual].sort(),
    );
    expect(unknown.total).toBe(3);
  });
});
