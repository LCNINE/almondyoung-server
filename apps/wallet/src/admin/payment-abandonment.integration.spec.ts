import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray } from 'drizzle-orm';
import { BadRequestException } from '@nestjs/common';
import type { DbService } from '@app/db';
import {
  paymentIntents,
  paymentMethods,
  paymentStateTransitions,
  walletSchema,
  WalletSchema,
} from '../schema';
import { PaymentAbandonmentService } from './payment-abandonment.service';

/**
 * 결제 이탈 집계를 실 Postgres 로 검증한다 — 검증 대상이 KST 날짜 변환과 LATERAL 종료 전이
 * 조회, GROUPING SETS 자체라 목으로는 아무것도 못 지킨다. 기간을 미래(2032-05)로 격리하고
 * 끝나면 시드를 지운다.
 *
 * 실행: 스크래치 DB 에 wallet 마이그레이션 적용 후
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wallet_itest \
 *     npx jest --testPathPattern="payment-abandonment.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

if (process.env.REQUIRE_WALLET_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_WALLET_DB=1 인데 DATABASE_URL 이 없습니다');
}

describeIfDb('PaymentAbandonmentService (실 Postgres)', () => {
  jest.setTimeout(120_000);

  const FROM = '2032-05-01';
  const TO = '2032-05-31';

  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<WalletSchema>>;
  let service: PaymentAbandonmentService;

  const methodCardId = randomUUID();
  const methodBankId = randomUUID();
  // 0 성공(CAPTURED) / 1 이탈-결제창(CANCELED) / 2 이탈-무통장(CANCELED) / 3 이탈-사유없음(FAILED)
  // 4 진행중(AWAITING_DEPOSIT) / 5 진행중(AUTHORIZED) / 6 정기결제(모수 밖) / 7 기간 밖
  // 8 이탈인데 전이 기록이 아예 없음(감사 로그 이전의 옛 데이터)
  const intentIds = Array.from({ length: 9 }, () => randomUUID());

  const expiresAt = new Date('2032-06-01T00:00:00+09:00');
  const intent = (
    index: number,
    status: (typeof paymentIntents.$inferInsert)['status'],
    createdAt: Date,
    extra: Partial<typeof paymentIntents.$inferInsert> = {},
  ) => ({
    id: intentIds[index],
    payableAmount: 10_000 * (index + 1),
    currency: 'KRW',
    status,
    purpose: 'PURCHASE' as const,
    clientSecret: `itest-ab-${intentIds[index].slice(0, 18)}`,
    expiresAt,
    createdAt,
    ...extra,
  });

  const terminal = (index: number, previous: string, next: string, reason: string | null, occurredAt: Date) => ({
    entityType: 'INTENT' as const,
    entityId: intentIds[index],
    previousStatus: previous,
    newStatus: next,
    reasonCode: reason,
    triggeredByType: 'SYSTEM' as const,
    correlationId: `itest-ab-${index}`,
    occurredAt,
  });

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: walletSchema });
    service = new PaymentAbandonmentService({ db } as unknown as DbService<WalletSchema>);

    await db.insert(paymentMethods).values([
      { id: methodCardId, userId: 'itest-ab-user', type: 'CARD' },
      { id: methodBankId, userId: 'itest-ab-user', type: 'BANK_TRANSFER' },
    ]);

    await db.insert(paymentIntents).values([
      intent(0, 'CAPTURED', new Date('2032-05-10T12:00:00+09:00'), { paymentMethodId: methodCardId }),
      intent(1, 'CANCELED', new Date('2032-05-10T12:00:00+09:00'), { paymentMethodId: methodCardId }),
      // KST 경계: UTC 로는 5/9 지만 KST 로는 5/10 이다
      intent(2, 'CANCELED', new Date('2032-05-10T00:30:00+09:00'), { paymentMethodId: methodBankId }),
      // 결제수단을 고르기 전에 이탈 → byMethod 의 UNSELECTED
      intent(3, 'FAILED', new Date('2032-05-11T12:00:00+09:00')),
      intent(4, 'AWAITING_DEPOSIT', new Date('2032-05-12T12:00:00+09:00'), { paymentMethodId: methodBankId }),
      intent(5, 'AUTHORIZED', new Date('2032-05-12T12:00:00+09:00'), { paymentMethodId: methodCardId }),
      intent(6, 'CANCELED', new Date('2032-05-13T12:00:00+09:00'), { purpose: 'SUBSCRIPTION' }),
      intent(7, 'CANCELED', new Date('2032-06-05T12:00:00+09:00'), { paymentMethodId: methodCardId }),
      intent(8, 'CANCELED', new Date('2032-05-11T18:00:00+09:00'), { paymentMethodId: methodBankId }),
    ]);

    await db.insert(paymentStateTransitions).values([
      // 성공: 생성 10분 뒤 캡처
      terminal(0, 'AUTHORIZED', 'CAPTURED', null, new Date('2032-05-10T12:10:00+09:00')),
      // 결제창까지 갔다가 만료. 같은 종료 상태로 가는 전이를 **둘** 넣어 가장 최근 것이
      // 골라지는지 본다 — 하나만 두면 ORDER BY 를 뒤집어도 테스트가 통과해 버린다.
      terminal(1, 'CREATED', 'PROCESSING', null, new Date('2032-05-10T12:01:00+09:00')),
      terminal(1, 'PROCESSING', 'CANCELED', 'USER_CANCELED', new Date('2032-05-10T12:05:00+09:00')),
      terminal(1, 'REQUIRES_ACTION', 'CANCELED', 'INTENT_EXPIRED', new Date('2032-05-10T12:30:00+09:00')),
      // 무통장 미입금
      terminal(2, 'AWAITING_DEPOSIT', 'CANCELED', 'INTENT_EXPIRED', new Date('2032-05-11T00:30:00+09:00')),
      // 사유 미기록
      terminal(3, 'PROCESSING', 'FAILED', null, new Date('2032-05-11T12:05:00+09:00')),
      // 모수 밖(정기결제)인데도 전이는 존재한다 — 집계에 섞이면 안 된다
      terminal(6, 'PROCESSING', 'CANCELED', 'USER_CANCELED', new Date('2032-05-13T12:05:00+09:00')),
    ]);
  });

  afterAll(async () => {
    await db.delete(paymentStateTransitions).where(inArray(paymentStateTransitions.entityId, intentIds));
    await db.delete(paymentIntents).where(inArray(paymentIntents.id, intentIds));
    await db.delete(paymentMethods).where(inArray(paymentMethods.id, [methodCardId, methodBankId]));
    await sql.end({ timeout: 5 });
  });

  it('진행 중을 이탈로 세지 않고, 이탈률 분모에서도 뺀다', async () => {
    const result = await service.getAbandonment(FROM, TO);

    // 모수 = PURCHASE·기간 내 = intent 0~5 (6 은 SUBSCRIPTION, 7 은 기간 밖)
    expect(result.summary.attemptedCount).toBe(7);
    expect(result.summary.succeededCount).toBe(1);
    expect(result.summary.abandonedCount).toBe(4);
    expect(result.summary.openCount).toBe(2);
    // 분모는 결말이 난 것(1+4)뿐 — 진행 중 2건이 들어가면 4/7 이 된다
    expect(result.summary.settledCount).toBe(5);
    expect(result.summary.abandonRate).toBeCloseTo(0.8, 10);
  });

  it('금액도 결말별로 나뉘고 시도 금액 합과 맞는다', async () => {
    const result = await service.getAbandonment(FROM, TO);
    const { summary } = result;
    expect(summary.succeededAmount).toBe(10_000);
    expect(summary.abandonedAmount).toBe(20_000 + 30_000 + 40_000 + 90_000);
    expect(summary.openAmount).toBe(50_000 + 60_000);
    expect(summary.attemptedAmount).toBe(summary.succeededAmount + summary.abandonedAmount + summary.openAmount);
  });

  it('단계·사유는 종료 전이에서 오고, 합계가 요약과 어긋나지 않는다', async () => {
    const result = await service.getAbandonment(FROM, TO);

    const stageTotal = result.byStage.reduce((sum, row) => sum + row.count, 0);
    expect(stageTotal).toBe(result.summary.abandonedCount);

    // intent 1 은 CANCELED 로 가는 전이가 둘인데, 가장 최근 것(REQUIRES_ACTION)이 골라져야 한다
    expect(result.byStage).toContainEqual({
      stage: 'REQUIRES_ACTION',
      reason: 'INTENT_EXPIRED',
      count: 1,
      amount: 20_000,
    });
    expect(result.byStage).toContainEqual({
      stage: 'AWAITING_DEPOSIT',
      reason: 'INTENT_EXPIRED',
      count: 1,
      amount: 30_000,
    });
    // 사유 미기록은 다른 사유에 섞이지 않고 null 로 따로 남는다
    expect(result.byStage).toContainEqual({ stage: 'PROCESSING', reason: null, count: 1, amount: 40_000 });
    // 전이 기록이 아예 없는 이탈 건도 떨구지 않고 '미기록'으로 남긴다 — 떨구면 위 합계가 어긋난다
    expect(result.byStage).toContainEqual({ stage: null, reason: null, count: 1, amount: 90_000 });
  });

  it('진행 중을 상태별로 쪼개 보여준다 — 만료 잡이 회수하지 않는 상태가 드러나야 한다', async () => {
    const result = await service.getAbandonment(FROM, TO);

    expect(result.openByStatus).toEqual(
      expect.arrayContaining([
        { status: 'AWAITING_DEPOSIT', count: 1, amount: 50_000 },
        { status: 'AUTHORIZED', count: 1, amount: 60_000 },
      ]),
    );
    const openTotal = result.openByStatus.reduce((sum, row) => sum + row.count, 0);
    expect(openTotal).toBe(result.summary.openCount);
  });

  it('결제수단 미선택을 UNSELECTED 로 분리한다', async () => {
    const result = await service.getAbandonment(FROM, TO);

    const unselected = result.byMethod.find((row) => row.methodType === 'UNSELECTED');
    expect(unselected).toMatchObject({ attemptedCount: 1, abandonedCount: 1, succeededCount: 0 });

    const card = result.byMethod.find((row) => row.methodType === 'CARD');
    // CARD = 성공 1 + 이탈 1 + 진행중 1
    expect(card).toMatchObject({ attemptedCount: 3, succeededCount: 1, abandonedCount: 1, openCount: 1 });
    expect(card?.abandonRate).toBeCloseTo(0.5, 10);

    const totalByMethod = result.byMethod.reduce((sum, row) => sum + row.attemptedCount, 0);
    expect(totalByMethod).toBe(result.summary.attemptedCount);
  });

  it('일별 귀속은 KST 달력일이고 빈 날도 0 으로 채운다', async () => {
    const result = await service.getAbandonment(FROM, TO);

    expect(result.daily).toHaveLength(31);
    // UTC 로는 5/9 인 intent 2 도 KST 5/10 에 붙는다
    const may10 = result.daily.find((point) => point.bucket === '2032-05-10');
    expect(may10).toMatchObject({ attemptedCount: 3, succeededCount: 1, abandonedCount: 2 });

    const may12 = result.daily.find((point) => point.bucket === '2032-05-12');
    expect(may12).toMatchObject({ attemptedCount: 2, openCount: 2, abandonedCount: 0 });

    // 아무 일도 없던 날이 빠지지 않는다
    expect(result.daily.find((point) => point.bucket === '2032-05-20')).toMatchObject({ attemptedCount: 0 });

    const dailyAttempted = result.daily.reduce((sum, point) => sum + point.attemptedCount, 0);
    expect(dailyAttempted).toBe(result.summary.attemptedCount);
  });

  it('소요 시간은 결말별로 나온다', async () => {
    const result = await service.getAbandonment(FROM, TO);

    expect(result.duration.succeeded.sampleCount).toBe(1);
    expect(result.duration.succeeded.p50Seconds).toBe(600); // 12:00 → 12:10
    // 전이 기록이 없는 intent 8 은 소요 시간 표본에서 빠진다 — count(seconds) 라 null 을 안 센다
    expect(result.duration.abandoned.sampleCount).toBe(3);
    expect(result.duration.abandoned.p50Seconds).toBe(1800); // 중앙값 = intent 1 의 30분
  });

  it('기간 형식이 틀리거나 뒤집히면 400', async () => {
    await expect(service.getAbandonment('2032-5-1', TO)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.getAbandonment(TO, FROM)).rejects.toBeInstanceOf(BadRequestException);
  });
});
