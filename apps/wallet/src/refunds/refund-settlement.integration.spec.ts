// apps/wallet/src/refunds/refund-settlement.integration.spec.ts
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import { HttpException } from '@nestjs/common';
import type { DbService } from '@app/db';
import {
  charges,
  paymentIntents,
  paymentMethods,
  paymentStateTransitions,
  pointEventDetails,
  pointEvents,
  pointHoldDetails,
  pointHolds,
  refunds,
  walletSchema,
  WalletSchema,
} from '../schema';
import { ChargesService } from '../charges/charges.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import type { ProviderRegistry } from '../providers/provider.registry';
import type { CashReceiptsService } from '../cash-receipts/cash-receipts.service';
import type { PaymentProvider, RefundParams, RefundResult } from '../providers/payment-provider.interface';
import { PointsAdminService } from '../admin/points-admin.service';
import { PointsLedgerService } from '../providers/points/points-ledger.service';
import { PointsPaymentProvider } from '../providers/points/points.provider';
import { RefundsService } from './refunds.service';

/**
 * #1016 36번 PR 1 — 환불 수동 실행·실패 분류·송금 완료·목록을 실 Postgres 로.
 * 외부 PG provider 와 outbox 발행자만 가짜다. 포인트는 진짜 원장(PR 0 의 확정분 원장 키 포함)을 지난다.
 *
 * 실행: 스크래치 DB 에 wallet 마이그레이션 적용 후
 *   DATABASE_URL=postgresql://postgres:<pw>@localhost:5432/wallet_itest REQUIRE_WALLET_DB=1 \
 *     npx jest apps/wallet/src/refunds/refund-settlement.integration.spec.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

if (process.env.REQUIRE_WALLET_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_WALLET_DB=1 인데 DATABASE_URL 이 없습니다');
}

type Seeded = {
  intentId: string;
  userId: string;
  tossChargeId?: string;
  pointsChargeId?: string;
  cmsChargeId?: string;
  bankChargeId?: string;
};

describeIfDb('환불 정산 — 수동 실행·실패 분류·송금 완료·목록 (실 Postgres)', () => {
  jest.setTimeout(60_000);

  let sql: postgres.Sql;
  let db: PostgresJsDatabase<WalletSchema>;
  let service: RefundsService;
  let pointsProvider: PointsPaymentProvider;
  let pointsAdmin: PointsAdminService;
  const externalRefund = jest.fn<Promise<RefundResult>, [RefundParams]>();
  const enqueue = jest.fn().mockResolvedValue(undefined);
  const intentIds: string[] = [];
  const methodIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: walletSchema });
    const dbService = { db } as unknown as DbService<WalletSchema>;
    pointsProvider = new PointsPaymentProvider(dbService, new PointsLedgerService());
    pointsAdmin = new PointsAdminService(dbService);
    const externalProvider = { refund: externalRefund } as unknown as PaymentProvider;
    const registry = {
      getProviderOrThrow: (type: string) => (type === 'POINTS' ? pointsProvider : externalProvider),
    } as unknown as ProviderRegistry;
    const cashReceipts = { cancelForRefund: async () => undefined } as unknown as CashReceiptsService;
    service = new RefundsService(
      dbService,
      new ChargesService(dbService),
      cashReceipts,
      new PaymentMethodsService(dbService, registry),
      registry,
      new StateTransitionService(dbService, { enqueue } as never),
    );
  });

  beforeEach(() => {
    externalRefund.mockReset();
    enqueue.mockClear();
  });

  afterAll(async () => {
    if (intentIds.length > 0) {
      const refundRows = await db.select({ id: refunds.id }).from(refunds).where(inArray(refunds.intentId, intentIds));
      const chargeRows = await db.select({ id: charges.id }).from(charges).where(inArray(charges.intentId, intentIds));
      const entityIds = [...refundRows.map((r) => r.id), ...chargeRows.map((c) => c.id)];
      if (entityIds.length > 0) {
        await db.delete(paymentStateTransitions).where(inArray(paymentStateTransitions.entityId, entityIds));
      }
      await db.delete(refunds).where(inArray(refunds.intentId, intentIds));
      await db.delete(charges).where(inArray(charges.intentId, intentIds));
      await db.delete(paymentIntents).where(inArray(paymentIntents.id, intentIds));
    }
    if (methodIds.length > 0) await db.delete(paymentMethods).where(inArray(paymentMethods.id, methodIds));
    if (userIds.length > 0) {
      const holds = await db.select({ id: pointHolds.id }).from(pointHolds).where(inArray(pointHolds.userId, userIds));
      if (holds.length > 0) {
        await db.delete(pointHoldDetails).where(
          inArray(
            pointHoldDetails.holdId,
            holds.map((h) => h.id),
          ),
        );
        await db.delete(pointHolds).where(inArray(pointHolds.userId, userIds));
      }
      await db.delete(pointEventDetails).where(inArray(pointEventDetails.userId, userIds));
      await db.delete(pointEvents).where(inArray(pointEvents.userId, userIds));
    }
    await sql.end();
  });

  async function method(userId: string, type: 'TOSS' | 'POINTS' | 'CMS_BATCH' | 'BANK_TRANSFER'): Promise<string> {
    const id = randomUUID();
    methodIds.push(id);
    await db.insert(paymentMethods).values({ id, userId, type });
    return id;
  }

  async function capturedCharge(
    intentId: string,
    paymentMethodId: string,
    amount: number,
    createdAt: Date,
    requestPayload: Record<string, unknown> | null = null,
  ) {
    const id = randomUUID();
    await db.insert(charges).values({
      id,
      intentId,
      paymentMethodId,
      amount,
      currency: 'KRW',
      operation: 'CAPTURE',
      status: 'SUCCEEDED',
      providerTransactionId: `itest-${id}`,
      providerIdempotencyKey: `itest-${id}`,
      requestPayload,
      createdAt,
    });
    return id;
  }

  /** 확정까지 끝난 결제 하나. 포인트는 진짜 원장으로 승인·확정한다(capture.service.ts 와 같이 원장 키 = 승인 결제분 id). */
  async function seed(legs: { toss?: number; points?: number; cms?: number; bank?: number }): Promise<Seeded> {
    const userId = `itest-settle-${randomUUID()}`;
    userIds.push(userId);
    const intentId = randomUUID();
    intentIds.push(intentId);
    const total = (legs.toss ?? 0) + (legs.points ?? 0) + (legs.cms ?? 0) + (legs.bank ?? 0);
    await db.insert(paymentIntents).values({
      id: intentId,
      userId,
      payableAmount: total,
      currency: 'KRW',
      status: 'SUCCEEDED',
      clientSecret: `itest-${intentId.slice(0, 20)}`,
      expiresAt: new Date('2031-01-01T00:00:00Z'),
      metadata: {},
    });
    const seeded: Seeded = { intentId, userId };
    const t0 = Date.now() - 60_000;

    if (legs.points) {
      await pointsAdmin.earn(userId, 10_000, 'ITEST');
      const pmId = await method(userId, 'POINTS');
      const authorizeId = randomUUID();
      const base = {
        intentId,
        paymentMethodId: pmId,
        userId,
        amount: legs.points,
        currency: 'KRW',
        correlationId: 'itest',
      };
      expect(
        (
          await pointsProvider.authorize({
            ...base,
            chargeId: authorizeId,
            idempotencyKey: `wallet:authorize:${authorizeId}`,
          })
        ).status,
      ).toBe('SUCCEEDED');
      expect(
        (
          await pointsProvider.capture({
            ...base,
            chargeId: authorizeId,
            idempotencyKey: `wallet:capture:${authorizeId}`,
          })
        ).status,
      ).toBe('SUCCEEDED');
      seeded.pointsChargeId = await capturedCharge(intentId, pmId, legs.points, new Date(t0), {
        intentId,
        authorizeChargeId: authorizeId,
      });
    }
    if (legs.toss) {
      seeded.tossChargeId = await capturedCharge(
        intentId,
        await method(userId, 'TOSS'),
        legs.toss,
        new Date(t0 + 1_000),
      );
    }
    if (legs.cms) {
      seeded.cmsChargeId = await capturedCharge(
        intentId,
        await method(userId, 'CMS_BATCH'),
        legs.cms,
        new Date(t0 + 2_000),
      );
    }
    if (legs.bank) {
      seeded.bankChargeId = await capturedCharge(
        intentId,
        await method(userId, 'BANK_TRANSFER'),
        legs.bank,
        new Date(t0 + 3_000),
      );
    }
    return seeded;
  }

  async function rowsOf(intentId: string) {
    return db.select().from(refunds).where(eq(refunds.intentId, intentId));
  }

  async function refusalOf(p: Promise<unknown>): Promise<Record<string, unknown>> {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      return (e as HttpException).getResponse() as Record<string, unknown>;
    }
    throw new Error('expected rejection');
  }

  it('기본(AUTO): 외부 결제분은 provider 를 부르고 행은 execution AUTO, 실패 칸 null', async () => {
    const s = await seed({ toss: 10_000 });
    externalRefund.mockResolvedValue({ status: 'SUCCEEDED', providerRefundId: 'pk' });

    const [row] = await service.createByIntent(s.intentId, { amount: 4_000 });

    expect(externalRefund).toHaveBeenCalledTimes(1);
    expect(row).toMatchObject({ status: 'SUCCEEDED', execution: 'AUTO', failureCode: null, failureRetryable: null });
  });

  it('AUTO + PG 영구 거절: FAILED 행에 failure_code·failure_retryable=false 가 남는다', async () => {
    const s = await seed({ toss: 10_000 });
    externalRefund.mockResolvedValue({
      status: 'FAILED',
      errorCode: 'ALREADY_CANCELED_PAYMENT',
      errorMessage: '이미 취소된 결제 입니다.',
      retryable: false,
    });

    await service.createByIntent(s.intentId, { amount: 10_000 });

    expect(await rowsOf(s.intentId)).toEqual([
      expect.objectContaining({
        status: 'FAILED',
        execution: 'AUTO',
        failureCode: 'ALREADY_CANCELED_PAYMENT',
        failureRetryable: false,
        reasonMessage: '이미 취소된 결제 입니다.',
      }),
    ]);
  });

  it('MANUAL 카드+포인트: 카드 몫은 PG 없이 송금 대기, 포인트 몫은 원장으로 되돌린다 — 남은 금액 0', async () => {
    const s = await seed({ toss: 7_000, points: 3_000 });

    const result = await service.createByIntent(s.intentId, { amount: 10_000, execution: 'MANUAL' });

    expect(externalRefund).not.toHaveBeenCalled();
    expect(result.map((r) => [r.chargeId, r.status, r.execution, r.amount])).toEqual([
      [s.tossChargeId, 'PENDING', 'MANUAL', 7_000],
      [s.pointsChargeId, 'SUCCEEDED', 'AUTO', 3_000],
    ]);
    const cancels = await sql`
      select amount from point_events where user_id = ${s.userId} and event_type = 'REDEEM_CANCEL'`;
    expect(cancels).toEqual([{ amount: 3_000 }]);

    const refundability = await service.getRefundability(s.intentId);
    expect(refundability).toMatchObject({ pendingRefundAmount: 7_000, remainingRefundableAmount: 0 });
  });

  it('같은 MANUAL 요청이 다시 오면 400 REFUND_AMOUNT_EXCEEDS_TOTAL(retryable) — 송금 대기가 두 줄 생기지 않는다', async () => {
    const s = await seed({ toss: 7_000, points: 3_000 });
    await service.createByIntent(s.intentId, { amount: 10_000, execution: 'MANUAL' });

    const refusal = await refusalOf(service.createByIntent(s.intentId, { amount: 10_000, execution: 'MANUAL' }));

    expect(refusal).toMatchObject({ error: 'REFUND_AMOUNT_EXCEEDS_TOTAL', retryable: true });
    expect(await rowsOf(s.intentId)).toHaveLength(2);
  });

  it('confirmManual 이 카드 결제분의 수동 행을 받는다 — SUCCEEDED, 결제분 REFUNDED, 환불 성공 이벤트', async () => {
    const s = await seed({ toss: 7_000, points: 3_000 });
    const [manual] = await service.createByIntent(s.intentId, { amount: 10_000, execution: 'MANUAL' });
    enqueue.mockClear(); // 포인트 몫 환불이 낸 이벤트를 지운다 — 아래 단언은 송금 완료가 낸 것만 본다

    const confirmed = await service.confirmManual(manual.id);

    expect(confirmed).toMatchObject({ status: 'SUCCEEDED', execution: 'MANUAL' });
    const [tossCharge] = await db
      .select()
      .from(charges)
      .where(eq(charges.id, s.tossChargeId as string));
    expect(tossCharge.status).toBe('REFUNDED');
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'gateway.refund.succeeded' }),
      expect.anything(),
    );
  });

  it('MANUAL 은 자동 환불 못 하는 수단(효성 CMS)도 받는다 — AUTO 는 지금처럼 REFUND_NOT_AUTOMATABLE(영구)', async () => {
    const s = await seed({ cms: 10_000 });

    expect(await refusalOf(service.createByIntent(s.intentId, { amount: 10_000 }))).toMatchObject({
      error: 'REFUND_NOT_AUTOMATABLE',
      retryable: false,
    });
    const [row] = await service.createByIntent(s.intentId, { amount: 10_000, execution: 'MANUAL' });

    expect(externalRefund).not.toHaveBeenCalled();
    expect(row).toMatchObject({ chargeId: s.cmsChargeId, status: 'PENDING', execution: 'MANUAL', amount: 10_000 });
  });

  it('무통장 «계좌 없음» 폴백은 MANUAL 송금 대기로 남는다 — 목록·[완료 처리]가 수동 행으로 다룬다', async () => {
    const s = await seed({ bank: 8_000 });
    externalRefund.mockResolvedValue({ status: 'PENDING', manualTransfer: true });

    const [row] = await service.createByIntent(s.intentId, { amount: 8_000 });

    expect(row).toMatchObject({ status: 'PENDING', execution: 'MANUAL', failureCode: null });
    expect((await service.listByIntent(s.intentId)).map((r) => r.execution)).toEqual(['MANUAL']);
    expect((await service.confirmManual(row.id)).status).toBe('SUCCEEDED');
  });

  it('manualTransfer 없는 PENDING(PG 비동기)은 AUTO 그대로', async () => {
    const s = await seed({ toss: 5_000 });
    externalRefund.mockResolvedValue({ status: 'PENDING' });

    const [row] = await service.createByIntent(s.intentId, { amount: 5_000 });

    expect(row).toMatchObject({ status: 'PENDING', execution: 'AUTO' });
  });

  it('listByIntent: 상태 무관 전부, 만든 순서 — FAILED 는 남은 금액을 줄이지 않는다', async () => {
    const s = await seed({ toss: 10_000 });
    externalRefund.mockResolvedValue({ status: 'FAILED', errorCode: 'PROVIDER_ERROR', retryable: true });
    await service.createByIntent(s.intentId, { amount: 10_000 });
    await service.createByIntent(s.intentId, { amount: 10_000, execution: 'MANUAL' });

    const list = await service.listByIntent(s.intentId);

    expect(list.map((r) => [r.status, r.execution, r.failureCode, r.failureRetryable])).toEqual([
      ['FAILED', 'AUTO', 'PROVIDER_ERROR', true],
      ['PENDING', 'MANUAL', null, null],
    ]);
  });

  /** 결제사 응답이 끊긴 환불 한 번 — provider 가 던지면 wallet 은 FAILED·PROVIDER_EXCEPTION 행을 남긴다 */
  async function ambiguousRefund(intentId: string, amount: number) {
    externalRefund.mockRejectedValueOnce(new Error('socket hang up'));
    const [row] = await service.createByIntent(intentId, { amount, reasonCode: 'MEDUSA_REFUND' });
    expect(row).toMatchObject({ status: 'FAILED', failureCode: 'PROVIDER_EXCEPTION', failureRetryable: true });
    return row;
  }

  it('응답 끊긴 환불 뒤 같은 금액 요청 — 새 행 없이 같은 행이 같은 멱등 키로 다시 나가고, 그 행 하나가 응답이다', async () => {
    const s = await seed({ toss: 10_000 });
    const first = await ambiguousRefund(s.intentId, 3_000);
    externalRefund.mockResolvedValueOnce({ status: 'SUCCEEDED', providerRefundId: 'pk' });

    const result = await service.createByIntent(s.intentId, { amount: 3_000, reasonCode: 'MEDUSA_REFUND' });

    expect(result.map((r) => [r.id, r.status])).toEqual([[first.id, 'SUCCEEDED']]);
    expect(externalRefund).toHaveBeenLastCalledWith(
      expect.objectContaining({ refundId: first.id, idempotencyKey: `wallet:refund:${first.id}`, amount: 3_000 }),
    );
    expect(await rowsOf(s.intentId)).toHaveLength(1);
  });

  it('응답 끊긴 환불 뒤 다른 금액 요청 — 옛 행만 확정하고 이번 요청은 일시 거절(장부를 다시 맞추게)', async () => {
    const s = await seed({ toss: 10_000 });
    const first = await ambiguousRefund(s.intentId, 3_000);
    externalRefund.mockResolvedValueOnce({ status: 'SUCCEEDED', providerRefundId: 'pk' });

    const refusal = await refusalOf(service.createByIntent(s.intentId, { amount: 5_000 }));

    expect(refusal).toMatchObject({ error: 'AMBIGUOUS_REFUND_RESOLVED', retryable: true });
    expect(externalRefund).toHaveBeenCalledTimes(2);
    expect(externalRefund).toHaveBeenLastCalledWith(
      expect.objectContaining({ refundId: first.id, idempotencyKey: `wallet:refund:${first.id}` }),
    );
    expect((await rowsOf(s.intentId)).map((r) => [r.id, r.status])).toEqual([[first.id, 'SUCCEEDED']]);
  });

  it('되살려 보냈는데 또 끊김 — 같은 행이 다시 FAILED·PROVIDER_EXCEPTION, 새 행 없음', async () => {
    const s = await seed({ toss: 10_000 });
    const first = await ambiguousRefund(s.intentId, 3_000);
    externalRefund.mockRejectedValueOnce(new Error('ETIMEDOUT'));

    const [row] = await service.createByIntent(s.intentId, { amount: 3_000 });

    expect(row).toMatchObject({ id: first.id, status: 'FAILED', failureCode: 'PROVIDER_EXCEPTION' });
    expect(await rowsOf(s.intentId)).toHaveLength(1);
  });

  it('14일 지난 응답 끊긴 행은 되살리지 않는다 — 토스 멱등 키가 만료됐다, 지금처럼 새 행', async () => {
    const s = await seed({ toss: 10_000 });
    const first = await ambiguousRefund(s.intentId, 3_000);
    await db
      .update(refunds)
      .set({ createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) })
      .where(eq(refunds.id, first.id));
    externalRefund.mockResolvedValueOnce({ status: 'SUCCEEDED', providerRefundId: 'pk' });

    const [row] = await service.createByIntent(s.intentId, { amount: 3_000 });

    expect(row.id).not.toBe(first.id);
    expect(await rowsOf(s.intentId)).toHaveLength(2);
  });

  it('복합결제 — 앞 leg 가 나간 뒤 포인트 leg 가 끊겨도, 다음 요청은 돈을 더 움직이기 전에 옛 행만 확정하고 거절한다', async () => {
    const s = await seed({ toss: 7_000, points: 3_000 });
    externalRefund.mockResolvedValue({ status: 'SUCCEEDED', providerRefundId: 'pk' });
    const spy = jest.spyOn(pointsProvider, 'refund').mockRejectedValueOnce(new Error('socket hang up'));
    try {
      const first = await service.createByIntent(s.intentId, { amount: 5_000 });
      expect(first.map((r) => [r.status, r.amount])).toEqual([
        ['SUCCEEDED', 3_500],
        ['FAILED', 1_500],
      ]);
    } finally {
      spy.mockRestore();
    }
    const callsBefore = externalRefund.mock.calls.length;

    const refusal = await refusalOf(service.createByIntent(s.intentId, { amount: 1_500 }));

    expect(refusal).toMatchObject({ error: 'AMBIGUOUS_REFUND_RESOLVED', retryable: true });
    expect(externalRefund.mock.calls.length).toBe(callsBefore);
    const rows = await rowsOf(s.intentId);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.status === 'SUCCEEDED').reduce((sum, r) => sum + r.amount, 0)).toBe(5_000);
  });

  it('무통장 응답 끊긴 환불 — 계좌 없이 다시 요청하면 아무것도 보내지 않고 영구 거절', async () => {
    const s = await seed({ bank: 8_000 });
    externalRefund.mockRejectedValueOnce(new Error('socket hang up'));
    const account = { bank: '004', accountNumber: '123456789', holderName: '홍길동' };
    const [first] = await service.createByIntent(s.intentId, { amount: 8_000, refundReceiveAccount: account });
    expect(first).toMatchObject({ status: 'FAILED', failureCode: 'PROVIDER_EXCEPTION' });

    const refusal = await refusalOf(service.createByIntent(s.intentId, { amount: 8_000 }));

    expect(refusal).toMatchObject({ error: 'AMBIGUOUS_REFUND_NEEDS_ACCOUNT', retryable: false });
    expect(externalRefund).toHaveBeenCalledTimes(1);
    expect(await rowsOf(s.intentId)).toEqual([
      expect.objectContaining({ id: first.id, status: 'FAILED', failureCode: 'PROVIDER_EXCEPTION' }),
    ]);
  });

  it('MANUAL 요청은 응답 끊긴 행을 되살리지 않는다 — PG 를 부르지 않는다', async () => {
    const s = await seed({ toss: 10_000 });
    const first = await ambiguousRefund(s.intentId, 3_000);

    const [row] = await service.createByIntent(s.intentId, { amount: 3_000, execution: 'MANUAL' });

    expect(row).toMatchObject({ status: 'PENDING', execution: 'MANUAL' });
    expect(row.id).not.toBe(first.id);
    expect(externalRefund).toHaveBeenCalledTimes(1);
    expect((await rowsOf(s.intentId)).find((r) => r.id === first.id)).toMatchObject({
      status: 'FAILED',
      failureCode: 'PROVIDER_EXCEPTION',
    });
  });

  it('다른 금액 요청인데 다시 보낸 것도 또 끊김 — 아직 모르니 UNRESOLVED(일시), 행은 그대로 하나', async () => {
    const s = await seed({ toss: 10_000 });
    const first = await ambiguousRefund(s.intentId, 3_000);
    externalRefund.mockRejectedValueOnce(new Error('ETIMEDOUT'));

    const refusal = await refusalOf(service.createByIntent(s.intentId, { amount: 5_000 }));

    expect(refusal).toMatchObject({ error: 'AMBIGUOUS_REFUND_UNRESOLVED', retryable: true });
    expect(await rowsOf(s.intentId)).toEqual([
      expect.objectContaining({ id: first.id, status: 'FAILED', failureCode: 'PROVIDER_EXCEPTION' }),
    ]);
  });
});
