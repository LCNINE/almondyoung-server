import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray } from 'drizzle-orm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { DbService } from '@app/db';
import {
  billingMethods,
  charges,
  invoices,
  paymentFeeRates,
  paymentIntents,
  paymentMethods,
  refunds,
  walletSchema,
  WalletSchema,
} from '../schema';
import { StatisticsAdminService } from './statistics-admin.service';

/**
 * 수수료·멤버십 수입 집계를 실 Postgres 로 검증한다 — 검증 대상이 KST 날짜 변환과
 * 조인·그룹핑 SQL 자체다. 기간을 미래(2031-03)로 격리해 기존 데이터와 겹치지 않게 하고
 * 끝나면 시드를 지운다. 빈 스크래치 DB 사용 권장.
 *
 * 실행: 스크래치 DB 에 wallet 마이그레이션 적용 후
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wallet_itest \
 *     npx jest --testPathPattern="statistics-admin.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

if (process.env.REQUIRE_WALLET_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_WALLET_DB=1 인데 DATABASE_URL 이 없습니다');
}

describeIfDb('StatisticsAdminService (실 Postgres)', () => {
  jest.setTimeout(120_000);

  const FROM = '2031-03-01';
  const TO = '2031-03-31';

  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<WalletSchema>>;
  let service: StatisticsAdminService;

  const methodCardId = randomUUID();
  const methodTossId = randomUUID();
  const intentIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const chargeIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const refundIds = [randomUUID(), randomUUID()];
  const billingMethodId = randomUUID();
  const invoiceIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const createdFeeRateIds: string[] = [];

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: walletSchema });
    service = new StatisticsAdminService({ db } as unknown as DbService<WalletSchema>);

    await db.insert(paymentMethods).values([
      { id: methodCardId, userId: 'itest-user', type: 'CARD' },
      { id: methodTossId, userId: 'itest-user', type: 'TOSS' },
    ]);

    const expiresAt = new Date('2031-04-01T00:00:00+09:00');
    await db.insert(paymentIntents).values(
      intentIds.map((id) => ({
        id,
        payableAmount: 100_000,
        currency: 'KRW',
        status: 'SUCCEEDED' as const,
        clientSecret: `itest-${id.slice(0, 20)}`,
        expiresAt,
      })),
    );

    await db.insert(charges).values([
      // CARD: 3/10 KST 캡처 100,000 (요율 290bp 구간)
      {
        id: chargeIds[0],
        intentId: intentIds[0],
        paymentMethodId: methodCardId,
        amount: 100_000,
        currency: 'KRW',
        operation: 'CAPTURE',
        status: 'SUCCEEDED',
        providerIdempotencyKey: `itest-${chargeIds[0]}`,
        createdAt: new Date('2031-03-10T23:30:00+09:00'),
      },
      // CARD: 3/11 KST 00:10 (UTC 로는 3/10) 캡처 200,000 — KST 경계 검증, 요율 250bp 구간
      {
        id: chargeIds[1],
        intentId: intentIds[1],
        paymentMethodId: methodCardId,
        amount: 200_000,
        currency: 'KRW',
        operation: 'CAPTURE',
        status: 'SUCCEEDED',
        providerIdempotencyKey: `itest-${chargeIds[1]}`,
        createdAt: new Date('2031-03-11T00:10:00+09:00'),
      },
      // TOSS: 요율 미설정 — uncovered 로 나와야 한다
      {
        id: chargeIds[2],
        intentId: intentIds[2],
        paymentMethodId: methodTossId,
        amount: 50_000,
        currency: 'KRW',
        operation: 'CAPTURE',
        status: 'SUCCEEDED',
        providerIdempotencyKey: `itest-${chargeIds[2]}`,
        createdAt: new Date('2031-03-15T12:00:00+09:00'),
      },
      // 제외 대상: AUTHORIZE, 실패 캡처, 기간 밖 캡처
      {
        id: chargeIds[3],
        intentId: intentIds[3],
        paymentMethodId: methodCardId,
        amount: 70_000,
        currency: 'KRW',
        operation: 'AUTHORIZE',
        status: 'SUCCEEDED',
        providerIdempotencyKey: `itest-${chargeIds[3]}`,
        createdAt: new Date('2031-03-12T12:00:00+09:00'),
      },
      {
        id: chargeIds[4],
        intentId: intentIds[3],
        paymentMethodId: methodCardId,
        amount: 80_000,
        currency: 'KRW',
        operation: 'CAPTURE',
        status: 'FAILED',
        providerIdempotencyKey: `itest-${chargeIds[4]}`,
        createdAt: new Date('2031-03-12T13:00:00+09:00'),
      },
      {
        id: chargeIds[5],
        intentId: intentIds[3],
        paymentMethodId: methodCardId,
        amount: 90_000,
        currency: 'KRW',
        operation: 'CAPTURE',
        status: 'SUCCEEDED',
        providerIdempotencyKey: `itest-${chargeIds[5]}`,
        createdAt: new Date('2031-04-02T12:00:00+09:00'),
      },
    ]);

    await db.insert(refunds).values([
      {
        id: refundIds[0],
        chargeId: chargeIds[0],
        intentId: intentIds[0],
        amount: 30_000,
        currency: 'KRW',
        status: 'SUCCEEDED',
        createdAt: new Date('2031-03-20T12:00:00+09:00'),
      },
      // FAILED 환불은 집계 제외
      {
        id: refundIds[1],
        chargeId: chargeIds[1],
        intentId: intentIds[1],
        amount: 10_000,
        currency: 'KRW',
        status: 'FAILED',
        createdAt: new Date('2031-03-21T12:00:00+09:00'),
      },
    ]);

    await db.insert(billingMethods).values([{ id: billingMethodId, userId: 'itest-user', providerType: 'CMS' }]);

    const invoiceBase = {
      billingMethodId,
      currency: 'KRW',
      periodStart: '2031-03-01',
      periodEnd: '2031-03-31',
      dueDate: '2031-03-05',
    };
    await db.insert(invoices).values([
      {
        ...invoiceBase,
        id: invoiceIds[0],
        subscriberType: 'MEMBERSHIP',
        subscriberRef: 'itest-m1',
        amountDue: 9_900,
        status: 'PAID',
        finalizedAt: new Date('2031-03-05T10:00:00+09:00'),
        idempotencyKey: `itest-${invoiceIds[0]}`,
      },
      {
        ...invoiceBase,
        id: invoiceIds[1],
        subscriberType: 'MEMBERSHIP',
        subscriberRef: 'itest-m2',
        amountDue: 9_900,
        status: 'PAID',
        finalizedAt: new Date('2031-03-05T11:00:00+09:00'),
        idempotencyKey: `itest-${invoiceIds[1]}`,
      },
      // 기간 밖 PAID — 제외
      {
        ...invoiceBase,
        id: invoiceIds[2],
        subscriberType: 'MEMBERSHIP',
        subscriberRef: 'itest-m3',
        amountDue: 9_900,
        status: 'PAID',
        finalizedAt: new Date('2031-04-01T10:00:00+09:00'),
        idempotencyKey: `itest-${invoiceIds[2]}`,
      },
      // 다른 subscriberType — 제외
      {
        ...invoiceBase,
        id: invoiceIds[3],
        subscriberType: 'OTHER',
        subscriberRef: 'itest-o1',
        amountDue: 5_000,
        status: 'PAID',
        finalizedAt: new Date('2031-03-06T10:00:00+09:00'),
        idempotencyKey: `itest-${invoiceIds[3]}`,
      },
    ]);
  });

  afterAll(async () => {
    if (db) {
      if (createdFeeRateIds.length > 0) {
        await db.delete(paymentFeeRates).where(inArray(paymentFeeRates.id, createdFeeRateIds));
      }
      await db.delete(refunds).where(inArray(refunds.id, refundIds));
      await db.delete(charges).where(inArray(charges.id, chargeIds));
      await db.delete(paymentIntents).where(inArray(paymentIntents.id, intentIds));
      await db.delete(paymentMethods).where(inArray(paymentMethods.id, [methodCardId, methodTossId]));
      await db.delete(invoices).where(inArray(invoices.id, invoiceIds));
      await db.delete(billingMethods).where(inArray(billingMethods.id, [billingMethodId]));
    }
    await sql?.end();
  });

  it('요율 CRUD — 등록·중복 거절·삭제·목록', async () => {
    const first = await service.createFeeRate({ methodType: 'CARD', feeRateBp: 290, effectiveFrom: '2031-03-01' });
    createdFeeRateIds.push(first.id);
    const second = await service.createFeeRate({
      methodType: 'CARD',
      feeRateBp: 250,
      effectiveFrom: '2031-03-11',
      memo: '인하 협상',
    });
    createdFeeRateIds.push(second.id);

    await expect(
      service.createFeeRate({ methodType: 'CARD', feeRateBp: 300, effectiveFrom: '2031-03-01' }),
    ).rejects.toBeInstanceOf(ConflictException);

    const list = await service.listFeeRates();
    const mine = list.items.filter((item) => createdFeeRateIds.includes(item.id));
    expect(mine).toHaveLength(2);
    // 같은 결제수단 안에서 적용일 내림차순
    expect(mine[0].feeRateBp).toBe(250);
    expect(mine[0].memo).toBe('인하 협상');

    await expect(service.deleteFeeRate(randomUUID())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('수수료 요약 — KST 경계·시점 요율·미설정 분리·환불 (손계산 대조)', async () => {
    const result = await service.getFeeSummary(FROM, TO);

    const card = result.methods.find((row) => row.methodType === 'CARD');
    expect(card).toBeDefined();
    // 100,000(3/10) + 200,000(3/11 KST — UTC 로는 3/10 이라 경계 검증) = 300,000
    expect(card?.capturedAmount).toBe(300_000);
    expect(card?.capturedCount).toBe(2);
    // 100,000×2.9% + 200,000×2.5% = 2,900 + 5,000
    expect(card?.estimatedFee).toBe(7_900);
    expect(card?.coveredAmount).toBe(300_000);
    expect(card?.uncoveredAmount).toBe(0);
    expect(card?.refundedAmount).toBe(30_000);
    expect(card?.appliedFeeRateBp).toBe(250);

    const toss = result.methods.find((row) => row.methodType === 'TOSS');
    expect(toss?.capturedAmount).toBe(50_000);
    expect(toss?.coveredAmount).toBe(0);
    expect(toss?.uncoveredAmount).toBe(50_000);
    expect(toss?.estimatedFee).toBe(0);
    expect(toss?.appliedFeeRateBp).toBeNull();

    expect(result.totals.capturedAmount).toBe(350_000);
    expect(result.totals.estimatedFee).toBe(7_900);
    expect(result.totals.uncoveredAmount).toBe(50_000);
    expect(result.totals.refundedAmount).toBe(30_000);
  });

  it('멤버십 수입 — PAID·MEMBERSHIP·기간 내만, 일별 시리즈', async () => {
    const result = await service.getMembershipRevenue(FROM, TO);
    expect(result.totalAmount).toBe(19_800);
    expect(result.invoiceCount).toBe(2);
    expect(result.series).toEqual([{ bucket: '2031-03-05', amount: 19_800, count: 2 }]);
  });

  it('기간 뒤집힘은 400', async () => {
    await expect(service.getFeeSummary(TO, FROM)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.getMembershipRevenue(TO, FROM)).rejects.toBeInstanceOf(BadRequestException);
  });
});
