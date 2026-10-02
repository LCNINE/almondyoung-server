import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray } from 'drizzle-orm';
import type { DbService } from '@app/db';
import { billingMethods, invoices, walletSchema, WalletSchema } from '../schema';
import { RecurringBillingFinanceReader } from './recurring-billing-finance.reader';
import { summarizeFinance } from './recurring-billing-finance';

/**
 * 정기결제 «돈» 요약의 달 묶기·필터를 실 Postgres 로 확인한다. 기간을 먼 미래(2032-01~02)로 격리하고
 * 끝나면 시드를 지운다.
 *
 * 실행: DATABASE_URL=postgresql://…/wallet npx jest --testPathPattern="recurring-billing-finance.integration" --runInBand
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('RecurringBillingFinanceReader (실 Postgres)', () => {
  jest.setTimeout(60_000);

  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<WalletSchema>>;
  let reader: RecurringBillingFinanceReader;
  const billingMethodId = randomUUID();
  const invoiceIds: string[] = [];

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 2 });
    db = drizzle(sql, { schema: walletSchema });
    reader = new RecurringBillingFinanceReader({ db } as unknown as DbService<WalletSchema>);

    await db.insert(billingMethods).values([{ id: billingMethodId, userId: 'itest-finance', providerType: 'CMS' }]);

    const invoice = (
      dueDate: string,
      status: 'PAID' | 'PAST_DUE' | 'OPEN' | 'UNCOLLECTIBLE' | 'VOID',
      amountDue: number,
      attemptCount = 0,
      subscriberType = 'MEMBERSHIP',
    ) => {
      const id = randomUUID();
      invoiceIds.push(id);
      const terminal = status === 'PAID' || status === 'UNCOLLECTIBLE' || status === 'VOID';
      return {
        id,
        billingMethodId,
        subscriberType,
        subscriberRef: `itest-${id}`,
        amountDue,
        currency: 'KRW',
        periodStart: dueDate,
        periodEnd: dueDate,
        dueDate,
        status,
        attemptCount,
        nextAttemptAt: terminal ? null : new Date(`${dueDate}T09:00:00+09:00`),
        finalizedAt: terminal ? new Date(`${dueDate}T10:00:00+09:00`) : null,
        idempotencyKey: `itest-finance-${id}`,
      };
    };

    await db.insert(invoices).values([
      invoice('2032-01-05', 'PAID', 10_000),
      invoice('2032-01-31', 'PAID', 10_000, 1), // 한 번 실패 뒤 수금
      invoice('2032-01-10', 'UNCOLLECTIBLE', 10_000, 3),
      invoice('2032-01-12', 'PAST_DUE', 10_000, 1),
      invoice('2032-01-15', 'VOID', 10_000),
      invoice('2032-01-20', 'PAID', 99_000, 0, 'OTHER'), // 멤버십 아님 — 제외
      invoice('2032-02-01', 'OPEN', 10_000),
      invoice('2032-03-01', 'PAID', 10_000), // 범위 밖 — 제외
    ]);
  });

  afterAll(async () => {
    if (db) {
      await db.delete(invoices).where(inArray(invoices.id, invoiceIds));
      await db.delete(billingMethods).where(inArray(billingMethods.id, [billingMethodId]));
    }
    await sql?.end();
  });

  it('due_date 의 달로 묶고, 멤버십이 아닌 청구와 범위 밖 달은 빼며, 달 끝날(31일)도 그 달에 넣는다', async () => {
    const rows = await reader.statusRows('2032-01', '2032-02');
    const [jan, feb] = summarizeFinance(rows, ['2032-01', '2032-02']);

    expect(jan.billed).toEqual({ amount: 40_000, invoices: 4 });
    expect(jan.paid).toEqual({ amount: 20_000, invoices: 2 });
    expect(jan.uncollectible).toEqual({ amount: 10_000, invoices: 1 });
    expect(jan.inProgress).toEqual({ amount: 10_000, invoices: 1 });
    expect(jan.collectionRate).toBeCloseTo(20_000 / 30_000);
    expect(jan.retryRecovery).toEqual({ recovered: 1, lost: 1, rate: 0.5 });

    expect(feb.billed).toEqual({ amount: 10_000, invoices: 1 });
    expect(feb.collectionRate).toBeNull();
  });
});
