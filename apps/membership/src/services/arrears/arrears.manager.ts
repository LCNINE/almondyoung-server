import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
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
   * 청산 대상 줄의 미청산 합. **청산과 같은 트랜잭션에서** 불러 잠근다 — 결제 생성과 입금 확인
   * 사이에 관리자가 금액을 조정하면 받은 돈과 지울 빚이 어긋나는데, 잠그지 않으면 그 대조 자체가
   * 낡은 값 위에서 이뤄진다.
   */
  async lockOutstandingSum(tx: DrizzleTransaction, userId: string, arrearsIds: string[]): Promise<number> {
    if (arrearsIds.length === 0) return 0;

    const rows = await tx
      .select({ amount: schema.membershipArrears.amount })
      .from(schema.membershipArrears)
      .where(
        and(
          eq(schema.membershipArrears.userId, userId),
          inArray(schema.membershipArrears.id, arrearsIds),
          eq(schema.membershipArrears.status, 'OUTSTANDING'),
        ),
      )
      .for('update');

    return rows.reduce((sum, r) => sum + r.amount, 0);
  }

  /**
   * 수금으로 청산. 한 결제가 덮는 줄을 한 문장으로 닫는다 — 건별로 나눠 쏘면 중간에 끊겼을 때
   * 「일부만 갚힌」 상태가 남고, 게이트는 잔액 합으로 판단하므로 그건 돈만 받고 안 풀린 상태다.
   *
   * `WHERE` 에 세 조건이 다 필요하다: 소유자(다른 사람의 줄을 닫지 못하게) · 대상 목록 ·
   * `OUTSTANDING`(이미 청산·면제된 줄은 안 건드린다 — 같은 결제 이벤트가 두 번 와도 두 번째는 0건).
   * 반환은 «이번에 실제로 닫힌» id 들이다. 요청한 것보다 적으면 호출자가 그걸 알아야 한다.
   */
  async settleMany(
    tx: DrizzleTransaction,
    userId: string,
    arrearsIds: string[],
    settlementRef: string,
  ): Promise<string[]> {
    if (arrearsIds.length === 0) return [];

    const rows = await tx
      .update(schema.membershipArrears)
      .set({ status: 'SETTLED', settlementRef, settledAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.membershipArrears.userId, userId),
          inArray(schema.membershipArrears.id, arrearsIds),
          eq(schema.membershipArrears.status, 'OUTSTANDING'),
        ),
      )
      .returning({ id: schema.membershipArrears.id });

    return rows.map((r) => r.id);
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
