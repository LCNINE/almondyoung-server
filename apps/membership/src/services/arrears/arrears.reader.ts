import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, desc, eq, InferSelectModel, sql } from 'drizzle-orm';
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

/** 원장 행 → 응답 모양. 조회가 둘이라 매핑을 한 곳에 둔다(갈리면 화면마다 다른 필드가 빈다). */
function toArrearsRow(r: InferSelectModel<typeof schema.membershipArrears>): ArrearsRow {
  return {
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
  };
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

    return rows.map(toArrearsRow);
  }

  /**
   * 한 계정의 «미청산» 줄만. 고객 화면과 청산 결제가 쓰는 목록이라 청산·면제분은 뺀다 —
   * 지나간 것까지 보여주면 고객은 이미 끝난 건에 다시 돈을 내려 한다.
   */
  async findOutstandingByUserId(userId: string): Promise<ArrearsRow[]> {
    const rows = await this.dbService.db
      .select()
      .from(schema.membershipArrears)
      .where(and(eq(schema.membershipArrears.userId, userId), eq(schema.membershipArrears.status, 'OUTSTANDING')))
      .orderBy(desc(schema.membershipArrears.createdAt));

    return rows.map(toArrearsRow);
  }

  /**
   * 미청산 줄에 찍힌 「진행 중 청산 결제」 표식.
   *
   * 결제를 하나 더 만들지 말지는 **지금 갚아야 할 줄 전부가 같은 결제 하나에 묶여 있을 때만**
   * 물어볼 값이 있다. 표식이 없는 줄이 하나라도 있으면(= 결제를 만든 뒤 미수가 더 생겼다)
   * 그 결제는 지금 청구할 금액을 덮지 않으므로 재사용 후보가 아니다.
   * 표식은 고객에게 보여줄 값이 아니라 여기서만 쓰므로 목록 조회(ArrearsRow)에 싣지 않는다.
   */
  async pendingIntentMarks(userId: string): Promise<{ intentIds: string[]; unmarked: number }> {
    const rows = await this.dbService.db
      .select({ pendingIntentId: schema.membershipArrears.pendingIntentId })
      .from(schema.membershipArrears)
      .where(and(eq(schema.membershipArrears.userId, userId), eq(schema.membershipArrears.status, 'OUTSTANDING')));

    const intentIds = [...new Set(rows.map((r) => r.pendingIntentId).filter((id): id is string => !!id))];
    return { intentIds, unmarked: rows.filter((r) => !r.pendingIntentId).length };
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
