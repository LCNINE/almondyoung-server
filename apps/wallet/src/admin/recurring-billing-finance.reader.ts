import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { WalletSchema, invoices } from '../schema';
import { FinanceStatusRow } from './recurring-billing-finance';

/**
 * 멤버십 인보이스를 (due_date 의 달, 상태) 로 묶어 읽는다. 관리자가 정기결제 화면을 열 때만 불린다.
 * due_date 는 시각이 아니라 날짜 칸이라 시간대 변환 없이 그대로 달을 뗀다.
 */
@Injectable()
export class RecurringBillingFinanceReader {
  constructor(private readonly dbService: DbService<WalletSchema>) {}

  /** `fromMonth`(포함) ~ `toMonth`(포함), 'YYYY-MM' */
  async statusRows(fromMonth: string, toMonth: string): Promise<FinanceStatusRow[]> {
    const month = sql<string>`to_char(${invoices.dueDate}, 'YYYY-MM')`;
    const rows = await this.dbService.db
      .select({
        month,
        status: invoices.status,
        amount: sql<string>`COALESCE(SUM(${invoices.amountDue}), 0)`,
        invoices: sql<string>`COUNT(*)`,
        recovered: sql<string>`COUNT(*) FILTER (WHERE ${invoices.attemptCount} > 0)`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.subscriberType, 'MEMBERSHIP'),
          gte(invoices.dueDate, `${fromMonth}-01`),
          lt(invoices.dueDate, sql`(${`${toMonth}-01`}::date + interval '1 month')::date`),
        ),
      )
      .groupBy(sql`1`, invoices.status);

    return rows.map((row) => ({
      month: row.month,
      status: row.status,
      amount: Number(row.amount),
      invoices: Number(row.invoices),
      recovered: Number(row.recovered),
    }));
  }
}
