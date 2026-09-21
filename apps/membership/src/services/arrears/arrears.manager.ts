import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq, sql } from 'drizzle-orm';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { DrizzleTransaction } from '../../shared/schemas/types';

/** 원장에 한 줄을 만들 때 필요한 것. period/amount 는 인보이스가 준다. */
export interface RecordArrearsInput {
  userId: string;
  contractId: string;
  /** wallet 인보이스 id. 인보이스 행 없이 거절된 경로는 계약 단위 합성 키가 온다. */
  invoiceRef: string;
  cause: 'UNCOLLECTIBLE' | 'MANDATE_REJECTED';
  causeCode: string | null;
  amount: number;
  currency: string;
  amountSource: 'INVOICE' | 'PLAN_FALLBACK';
  periodStart: string | null;
  periodEnd: string | null;
}

/**
 * 미수(외상) 원장의 쓰기. 읽기는 ArrearsReader 가 맡는다.
 *
 * 이 표에 한 줄이 생기는 것과 자격이 회수되는 것은 «같은 트랜잭션»이어야 한다 — 회수만 되고
 * 원장이 비면 그 주기는 영원히 공짜가 되고, 원장만 쓰이고 회수가 안 되면 쓰지도 않은 빚이 달린다.
 */
@Injectable()
export class ArrearsManager {
  private readonly logger = new Logger(ArrearsManager.name);

  constructor(private readonly dbService: DbService<typeof membershipSchema>) {}

  /**
   * 미수 한 줄을 적는다. 같은 인보이스가 두 번 오면 두 번째는 조용히 무시된다 —
   * 결과 이벤트는 재전달되며, 유니크 없이 두면 같은 주기를 두 번 걷는다.
   * 반환값은 «이번에 새로 적혔는지» 다(감사 로그가 그걸 구분해야 한다).
   */
  async record(tx: DrizzleTransaction, input: RecordArrearsInput): Promise<boolean> {
    const inserted = await tx
      .insert(schema.membershipArrears)
      .values({
        userId: input.userId,
        contractId: input.contractId,
        invoiceRef: input.invoiceRef,
        cause: input.cause,
        causeCode: input.causeCode,
        amount: input.amount,
        currency: input.currency,
        amountSource: input.amountSource,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      })
      .onConflictDoNothing({ target: schema.membershipArrears.invoiceRef })
      .returning({ id: schema.membershipArrears.id });

    if (inserted.length === 0) {
      this.logger.log(`[arrears] 이미 적힌 미수 — skip (invoiceRef=${input.invoiceRef})`);
      return false;
    }
    this.logger.warn(
      `[arrears] 미수 발생: userId=${input.userId}, contractId=${input.contractId}, amount=${input.amount}, cause=${input.cause}:${input.causeCode ?? '-'}`,
    );
    return true;
  }

  /**
   * 수금으로 청산. 이미 청산·면제된 줄은 건드리지 않는다(WHERE 로 막는다) —
   * 두 결제가 같은 미수를 동시에 갚으려 하면 한쪽만 이겨야 한다.
   */
  async settle(tx: DrizzleTransaction, arrearsId: string, settlementRef: string): Promise<boolean> {
    const rows = await tx
      .update(schema.membershipArrears)
      .set({ status: 'SETTLED', settlementRef, settledAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.membershipArrears.id, arrearsId), eq(schema.membershipArrears.status, 'OUTSTANDING')))
      .returning({ id: schema.membershipArrears.id });
    return rows.length > 0;
  }

  /**
   * 관리자 면제. 오판정(정상 고객이 일시적 잔액부족으로 끊긴 경우)을 사람이 되돌리는 유일한 수단이다 —
   * 이게 없으면 CS 가 DB 를 직접 만진다.
   */
  async waive(arrearsId: string, adminId: string, reason: string): Promise<boolean> {
    const rows = await this.dbService.db
      .update(schema.membershipArrears)
      .set({
        status: 'WAIVED',
        settlementRef: reason,
        settledBy: adminId,
        settledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.membershipArrears.id, arrearsId), eq(schema.membershipArrears.status, 'OUTSTANDING')))
      .returning({ id: schema.membershipArrears.id });
    return rows.length > 0;
  }

  /**
   * 관리자 금액 조정. 인보이스 금액이 진실이지만, 플랜가로 유도된 줄(amountSource='PLAN_FALLBACK')이나
   * 부분 수금이 있었던 줄은 사람이 고쳐야 한다. 0 이하로는 못 내린다 — 0 이면 면제가 맞는 표현이다.
   */
  async adjustAmount(arrearsId: string, amount: number, adminId: string, reason: string): Promise<boolean> {
    if (!Number.isInteger(amount) || amount <= 0) return false;
    const rows = await this.dbService.db
      .update(schema.membershipArrears)
      .set({
        amount,
        amountSource: 'ADMIN_ADJUSTED',
        settlementRef: reason,
        settledBy: adminId,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.membershipArrears.id, arrearsId), eq(schema.membershipArrears.status, 'OUTSTANDING')))
      .returning({ id: schema.membershipArrears.id });
    return rows.length > 0;
  }

  /** 잔액 한 줄 요약. 게이트가 이것만 보고 판단한다. */
  async outstandingTotal(tx: DrizzleTransaction, userId: string): Promise<number> {
    const [row] = await tx
      .select({ total: sql<number>`COALESCE(SUM(${schema.membershipArrears.amount}), 0)::int` })
      .from(schema.membershipArrears)
      .where(and(eq(schema.membershipArrears.userId, userId), eq(schema.membershipArrears.status, 'OUTSTANDING')));
    return row?.total ?? 0;
  }
}
