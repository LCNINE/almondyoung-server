import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';

export interface ArrearsRow {
  id: string;
  userId: string;
  contractId: string;
  invoiceRef: string;
  cause: string;
  causeCode: string | null;
  amount: number;
  currency: string;
  amountSource: string;
  periodStart: string | null;
  periodEnd: string | null;
  status: string;
  settlementRef: string | null;
  settledAt: string | null;
  settledBy: string | null;
  createdAt: string;
}

/** 미수 원장의 읽기. 쓰기는 ArrearsManager 가 맡는다. */
@Injectable()
export class ArrearsReader {
  constructor(private readonly dbService: DbService<typeof membershipSchema>) {}

  /** 한 계정의 미수 이력 전부(청산·면제분 포함) — 관리자가 판단하려면 지나간 것도 보여야 한다. */
  async findByUserId(userId: string): Promise<ArrearsRow[]> {
    const rows = await this.dbService.db
      .select()
      .from(schema.membershipArrears)
      .where(eq(schema.membershipArrears.userId, userId))
      .orderBy(desc(schema.membershipArrears.createdAt));

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      contractId: r.contractId,
      invoiceRef: r.invoiceRef,
      cause: r.cause,
      causeCode: r.causeCode,
      amount: r.amount,
      currency: r.currency,
      amountSource: r.amountSource,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      status: r.status,
      settlementRef: r.settlementRef,
      settledAt: r.settledAt ? r.settledAt.toISOString() : null,
      settledBy: r.settledBy,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** 미청산 잔액 한 줄. 고객 화면·게이트가 이것만 본다. */
  async outstandingSummary(userId: string): Promise<{ total: number; count: number; currency: string }> {
    const [row] = await this.dbService.db
      .select({
        total: sql<number>`COALESCE(SUM(${schema.membershipArrears.amount}), 0)::int`,
        count: sql<number>`COUNT(*)::int`,
        currency: sql<string>`COALESCE(MIN(${schema.membershipArrears.currency}), 'KRW')`,
      })
      .from(schema.membershipArrears)
      .where(and(eq(schema.membershipArrears.userId, userId), eq(schema.membershipArrears.status, 'OUTSTANDING')));

    return { total: row?.total ?? 0, count: row?.count ?? 0, currency: row?.currency ?? 'KRW' };
  }
}
