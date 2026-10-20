import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { SettlementPerson } from '@packages/domain-types/attendance-wage';
import {
  attendanceAbsenceDecisions,
  attendanceLeaves,
  attendanceAudit,
  attendanceMinimumWages,
  attendanceOvertimeDecisions,
  attendancePayGroups,
  attendancePayPolicies,
  attendancePaySettlements,
  attendanceWageRates,
  attendanceWorkers,
  attendanceSessions,
  attendanceWorkSchedules,
  users,
  type UserServiceSchema,
  type UserServiceTx,
} from '../../../../database/drizzle/schema';

export type PayGroupRow = typeof attendancePayGroups.$inferSelect;
export type PayPolicyRow = typeof attendancePayPolicies.$inferSelect;
export type WorkerRow = typeof attendanceWorkers.$inferSelect;
export type WageRateRow = typeof attendanceWageRates.$inferSelect;
export type WorkScheduleRow = typeof attendanceWorkSchedules.$inferSelect;
export type MinimumWageRow = typeof attendanceMinimumWages.$inferSelect;
export type OvertimeDecisionRow = typeof attendanceOvertimeDecisions.$inferSelect;
export type AbsenceDecisionRow = typeof attendanceAbsenceDecisions.$inferSelect;
export type SettlementRow = typeof attendancePaySettlements.$inferSelect;

export interface WageAuditEntry {
  actorId: string;
  subjectId: string;
  kind: `wage.${string}`;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/** 급여 설정 표(그룹·규칙·명단·시급·시간표·최저임금)와 그 변경 이력. */
@Injectable()
export class WageRepository {
  constructor(@InjectDb() private readonly dbService: DbService<UserServiceSchema>) {}

  run<T>(work: (tx: UserServiceTx) => Promise<T>, tx?: UserServiceTx): Promise<T> {
    return this.dbService.run(work, tx);
  }

  groups(tx?: UserServiceTx): Promise<PayGroupRow[]> {
    return (tx ?? this.dbService.db).select().from(attendancePayGroups).orderBy(asc(attendancePayGroups.createdAt));
  }

  async group(tx: UserServiceTx, id: string): Promise<PayGroupRow | null> {
    const [row] = await tx.select().from(attendancePayGroups).where(eq(attendancePayGroups.id, id));

    return row ?? null;
  }

  async insertGroup(tx: UserServiceTx, values: typeof attendancePayGroups.$inferInsert): Promise<PayGroupRow> {
    const [row] = await tx.insert(attendancePayGroups).values(values).returning();

    if (!row) {
      throw new Error('pay group insert returned no row');
    }

    return row;
  }

  /** 버전이 맞을 때만 바꾼다. 맞지 않으면 null. */
  async updateGroup(
    tx: UserServiceTx,
    id: string,
    version: number,
    values: Partial<typeof attendancePayGroups.$inferInsert>,
  ): Promise<PayGroupRow | null> {
    const [row] = await tx
      .update(attendancePayGroups)
      .set({ ...values, version: version + 1, updatedAt: new Date() })
      .where(and(eq(attendancePayGroups.id, id), eq(attendancePayGroups.version, version)))
      .returning();

    return row ?? null;
  }

  policies(groupId: string, tx?: UserServiceTx): Promise<PayPolicyRow[]> {
    return (tx ?? this.dbService.db)
      .select()
      .from(attendancePayPolicies)
      .where(eq(attendancePayPolicies.groupId, groupId))
      .orderBy(asc(attendancePayPolicies.effectiveFrom));
  }

  async insertPolicy(tx: UserServiceTx, values: typeof attendancePayPolicies.$inferInsert): Promise<PayPolicyRow> {
    const [row] = await tx.insert(attendancePayPolicies).values(values).returning();

    if (!row) {
      throw new Error('pay policy insert returned no row');
    }

    return row;
  }

  workers(
    tx?: UserServiceTx,
    filter: { userId?: string; groupId?: string } = {},
  ): Promise<(WorkerRow & { name: string })[]> {
    return (tx ?? this.dbService.db)
      .select({
        userId: attendanceWorkers.userId,
        groupId: attendanceWorkers.groupId,
        hireDate: attendanceWorkers.hireDate,
        leaveDate: attendanceWorkers.leaveDate,
        label: attendanceWorkers.label,
        note: attendanceWorkers.note,
        version: attendanceWorkers.version,
        createdAt: attendanceWorkers.createdAt,
        updatedAt: attendanceWorkers.updatedAt,
        name: users.username,
      })
      .from(attendanceWorkers)
      .innerJoin(users, eq(users.id, attendanceWorkers.userId))
      .where(
        and(
          filter.userId ? eq(attendanceWorkers.userId, filter.userId) : undefined,
          filter.groupId ? eq(attendanceWorkers.groupId, filter.groupId) : undefined,
        ),
      );
  }

  async worker(tx: UserServiceTx, userId: string): Promise<WorkerRow | null> {
    const [row] = await tx.select().from(attendanceWorkers).where(eq(attendanceWorkers.userId, userId));

    return row ?? null;
  }

  async insertWorker(tx: UserServiceTx, values: typeof attendanceWorkers.$inferInsert): Promise<WorkerRow> {
    const [row] = await tx.insert(attendanceWorkers).values(values).returning();

    if (!row) {
      throw new Error('worker insert returned no row');
    }

    return row;
  }

  async updateWorker(
    tx: UserServiceTx,
    userId: string,
    version: number,
    values: Partial<typeof attendanceWorkers.$inferInsert>,
  ): Promise<WorkerRow | null> {
    const [row] = await tx
      .update(attendanceWorkers)
      .set({ ...values, version: version + 1, updatedAt: new Date() })
      .where(and(eq(attendanceWorkers.userId, userId), eq(attendanceWorkers.version, version)))
      .returning();

    return row ?? null;
  }

  async userName(tx: UserServiceTx, userId: string): Promise<string | null> {
    const [row] = await tx
      .select({ name: users.username })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)));

    return row?.name ?? null;
  }

  rates(userIds: readonly string[], tx?: UserServiceTx): Promise<(WageRateRow & { userId: string })[]> {
    if (userIds.length === 0) {
      return Promise.resolve([]);
    }

    return (tx ?? this.dbService.db)
      .select()
      .from(attendanceWageRates)
      .where(inArray(attendanceWageRates.userId, [...userIds]))
      .orderBy(asc(attendanceWageRates.effectiveFrom));
  }

  async insertRate(tx: UserServiceTx, values: typeof attendanceWageRates.$inferInsert): Promise<WageRateRow | null> {
    const [row] = await tx.insert(attendanceWageRates).values(values).onConflictDoNothing().returning();

    return row ?? null;
  }

  schedules(userIds: readonly string[], tx?: UserServiceTx): Promise<WorkScheduleRow[]> {
    if (userIds.length === 0) {
      return Promise.resolve([]);
    }

    return (tx ?? this.dbService.db)
      .select()
      .from(attendanceWorkSchedules)
      .where(inArray(attendanceWorkSchedules.userId, [...userIds]))
      .orderBy(asc(attendanceWorkSchedules.effectiveFrom));
  }

  async insertSchedule(
    tx: UserServiceTx,
    values: typeof attendanceWorkSchedules.$inferInsert,
  ): Promise<WorkScheduleRow> {
    const [row] = await tx.insert(attendanceWorkSchedules).values(values).onConflictDoNothing().returning();

    return row ?? null;
  }

  minimumWages(tx?: UserServiceTx): Promise<MinimumWageRow[]> {
    return (tx ?? this.dbService.db)
      .select()
      .from(attendanceMinimumWages)
      .orderBy(asc(attendanceMinimumWages.effectiveFrom));
  }

  async insertMinimumWage(tx: UserServiceTx, values: MinimumWageRow): Promise<MinimumWageRow | null> {
    const [row] = await tx.insert(attendanceMinimumWages).values(values).onConflictDoNothing().returning();

    return row ?? null;
  }

  /** 이 날짜 이후까지 걸친 확정 정산이 있는가 — 있으면 그 날짜부터의 변경이 확정 금액을 바꾼다. */
  async confirmedThrough(tx: UserServiceTx, groupId: string, from: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: attendancePaySettlements.id })
      .from(attendancePaySettlements)
      .where(
        and(
          eq(attendancePaySettlements.groupId, groupId),
          eq(attendancePaySettlements.status, 'confirmed'),
          gte(attendancePaySettlements.periodEnd, from),
        ),
      )
      .limit(1);

    return !!row;
  }

  sessions(
    userIds: readonly string[],
    from: string,
    to: string,
    tx?: UserServiceTx,
  ): Promise<{ userId: string; workDate: string; checkIn: Date; checkOut: Date | null }[]> {
    if (userIds.length === 0) {
      return Promise.resolve([]);
    }

    return (tx ?? this.dbService.db)
      .select({
        userId: attendanceSessions.userId,
        workDate: attendanceSessions.workDate,
        checkIn: attendanceSessions.checkIn,
        checkOut: attendanceSessions.checkOut,
      })
      .from(attendanceSessions)
      .where(
        and(
          inArray(attendanceSessions.userId, [...userIds]),
          gte(attendanceSessions.workDate, from),
          lte(attendanceSessions.workDate, to),
        ),
      );
  }

  overtimeDecisions(
    userIds: readonly string[],
    from: string,
    to: string,
    tx?: UserServiceTx,
  ): Promise<OvertimeDecisionRow[]> {
    if (userIds.length === 0) {
      return Promise.resolve([]);
    }

    return (tx ?? this.dbService.db)
      .select()
      .from(attendanceOvertimeDecisions)
      .where(
        and(
          inArray(attendanceOvertimeDecisions.userId, [...userIds]),
          gte(attendanceOvertimeDecisions.workDate, from),
          lte(attendanceOvertimeDecisions.workDate, to),
        ),
      );
  }

  absenceDecisions(
    userIds: readonly string[],
    from: string,
    to: string,
    tx?: UserServiceTx,
  ): Promise<AbsenceDecisionRow[]> {
    if (userIds.length === 0) {
      return Promise.resolve([]);
    }

    return (tx ?? this.dbService.db)
      .select()
      .from(attendanceAbsenceDecisions)
      .where(
        and(
          inArray(attendanceAbsenceDecisions.userId, [...userIds]),
          gte(attendanceAbsenceDecisions.workDate, from),
          lte(attendanceAbsenceDecisions.workDate, to),
        ),
      );
  }

  async overtimeDecision(tx: UserServiceTx, userId: string, workDate: string): Promise<OvertimeDecisionRow | null> {
    const [row] = await tx
      .select()
      .from(attendanceOvertimeDecisions)
      .where(and(eq(attendanceOvertimeDecisions.userId, userId), eq(attendanceOvertimeDecisions.workDate, workDate)));

    return row ?? null;
  }

  async insertOvertimeDecision(
    tx: UserServiceTx,
    values: typeof attendanceOvertimeDecisions.$inferInsert,
  ): Promise<OvertimeDecisionRow | null> {
    const [row] = await tx.insert(attendanceOvertimeDecisions).values(values).onConflictDoNothing().returning();

    return row ?? null;
  }

  async updateOvertimeDecision(
    tx: UserServiceTx,
    id: string,
    version: number,
    values: Partial<typeof attendanceOvertimeDecisions.$inferInsert>,
  ): Promise<OvertimeDecisionRow | null> {
    const [row] = await tx
      .update(attendanceOvertimeDecisions)
      .set({ ...values, version: version + 1, decidedAt: new Date() })
      .where(and(eq(attendanceOvertimeDecisions.id, id), eq(attendanceOvertimeDecisions.version, version)))
      .returning();

    return row ?? null;
  }

  async absenceDecision(tx: UserServiceTx, userId: string, workDate: string): Promise<AbsenceDecisionRow | null> {
    const [row] = await tx
      .select()
      .from(attendanceAbsenceDecisions)
      .where(and(eq(attendanceAbsenceDecisions.userId, userId), eq(attendanceAbsenceDecisions.workDate, workDate)));

    return row ?? null;
  }

  async insertAbsenceDecision(
    tx: UserServiceTx,
    values: typeof attendanceAbsenceDecisions.$inferInsert,
  ): Promise<AbsenceDecisionRow | null> {
    const [row] = await tx.insert(attendanceAbsenceDecisions).values(values).onConflictDoNothing().returning();

    return row ?? null;
  }

  async updateAbsenceDecision(
    tx: UserServiceTx,
    id: string,
    version: number,
    values: Partial<typeof attendanceAbsenceDecisions.$inferInsert>,
  ): Promise<AbsenceDecisionRow | null> {
    const [row] = await tx
      .update(attendanceAbsenceDecisions)
      .set({ ...values, version: version + 1, decidedAt: new Date() })
      .where(and(eq(attendanceAbsenceDecisions.id, id), eq(attendanceAbsenceDecisions.version, version)))
      .returning();

    return row ?? null;
  }

  settlements(groupId: string, tx?: UserServiceTx): Promise<SettlementRow[]> {
    return (tx ?? this.dbService.db)
      .select()
      .from(attendancePaySettlements)
      .where(eq(attendancePaySettlements.groupId, groupId))
      .orderBy(desc(attendancePaySettlements.periodStart), desc(attendancePaySettlements.confirmedAt));
  }

  async settlement(id: string, tx?: UserServiceTx): Promise<SettlementRow | null> {
    const [row] = await (tx ?? this.dbService.db)
      .select()
      .from(attendancePaySettlements)
      .where(eq(attendancePaySettlements.id, id));

    return row ?? null;
  }

  async confirmedSettlement(groupId: string, periodStart: string, tx?: UserServiceTx): Promise<SettlementRow | null> {
    const [row] = await (tx ?? this.dbService.db)
      .select()
      .from(attendancePaySettlements)
      .where(
        and(
          eq(attendancePaySettlements.groupId, groupId),
          eq(attendancePaySettlements.periodStart, periodStart),
          eq(attendancePaySettlements.status, 'confirmed'),
        ),
      );

    return row ?? null;
  }

  /** 같은 기간의 확정본이 이미 있으면(부분 유일 색인) null. */
  async insertSettlement(
    tx: UserServiceTx,
    values: typeof attendancePaySettlements.$inferInsert,
  ): Promise<SettlementRow | null> {
    const [row] = await tx.insert(attendancePaySettlements).values(values).onConflictDoNothing().returning();

    return row ?? null;
  }

  async reopenSettlement(
    tx: UserServiceTx,
    id: string,
    actorId: string,
    reason: string,
  ): Promise<SettlementRow | null> {
    const [row] = await tx
      .update(attendancePaySettlements)
      .set({ status: 'reopened', reopenedBy: actorId, reopenedAt: new Date(), reopenReason: reason })
      .where(and(eq(attendancePaySettlements.id, id), eq(attendancePaySettlements.status, 'confirmed')))
      .returning();

    return row ?? null;
  }

  /** 같은 그룹의 확정·다시 열기·설정 변경을 줄 세운다 — 확정이 읽은 값을 다른 변경이 사이에 바꾸지 못하게. */
  async lockGroup(tx: UserServiceTx, groupId: string): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`attendance-wage:${groupId}`}, 0))`);
  }

  async hasConfirmed(tx: UserServiceTx, groupId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: attendancePaySettlements.id })
      .from(attendancePaySettlements)
      .where(and(eq(attendancePaySettlements.groupId, groupId), eq(attendancePaySettlements.status, 'confirmed')))
      .limit(1);

    return !!row;
  }

  /** 이 날짜들 중 하나라도 확정 기간 안에 있는가. */
  async confirmedCovering(tx: UserServiceTx, groupId: string, dates: readonly string[]): Promise<boolean> {
    const [row] = await tx
      .select({ id: attendancePaySettlements.id })
      .from(attendancePaySettlements)
      .where(
        and(
          eq(attendancePaySettlements.groupId, groupId),
          eq(attendancePaySettlements.status, 'confirmed'),
          or(
            ...dates.map((date) =>
              and(lte(attendancePaySettlements.periodStart, date), gte(attendancePaySettlements.periodEnd, date)),
            ),
          ),
        ),
      )
      .limit(1);

    return !!row;
  }

  /** 다른 그룹의 확정 정산에 이미 들어 있는 사람(같은 기간을 두 번 지급하지 않게). */
  async confirmedElsewhere(
    tx: UserServiceTx,
    groupId: string,
    userIds: readonly string[],
    periodStart: string,
    periodEnd: string,
  ): Promise<string[]> {
    if (userIds.length === 0) {
      return [];
    }

    const rows = await tx.execute<{ userId: string }>(sql`
      SELECT DISTINCT person->>'userId' AS "userId"
      FROM ${attendancePaySettlements}, jsonb_array_elements(${attendancePaySettlements.snapshot}->'people') AS person
      WHERE ${attendancePaySettlements.status} = 'confirmed'
        AND ${attendancePaySettlements.groupId} <> ${groupId}
        AND ${attendancePaySettlements.periodStart} <= ${periodEnd}
        AND ${attendancePaySettlements.periodEnd} >= ${periodStart}
        AND person->>'userId' IN ${sql`(${sql.join(
          userIds.map((id) => sql`${id}`),
          sql`, `,
        )})`}
    `);

    return [...rows].map((row) => row.userId);
  }

  /** 지급 달의 확정 정산에서 이 사람 몫만 꺼낸다 — 다른 사람의 급여는 읽지 않는다. */
  async confirmedShare(
    userId: string,
    paydayFrom: string,
    paydayTo: string,
  ): Promise<{ periodStart: string; periodEnd: string; payday: string; person: SettlementPerson } | null> {
    const [row] = await this.dbService.db.execute<{
      periodStart: string;
      periodEnd: string;
      payday: string;
      person: SettlementPerson;
    }>(sql`
      SELECT ${attendancePaySettlements.periodStart} AS "periodStart",
             ${attendancePaySettlements.periodEnd} AS "periodEnd",
             ${attendancePaySettlements.payday} AS "payday",
             jsonb_path_query_first(
               ${attendancePaySettlements.snapshot},
               '$.people[*] ? (@.userId == $user)',
               jsonb_build_object('user', ${userId}::text)
             ) AS "person"
      FROM ${attendancePaySettlements}
      WHERE ${attendancePaySettlements.status} = 'confirmed'
        AND ${attendancePaySettlements.payday} BETWEEN ${paydayFrom} AND ${paydayTo}
        AND jsonb_path_exists(
          ${attendancePaySettlements.snapshot},
          '$.people[*] ? (@.userId == $user)',
          jsonb_build_object('user', ${userId}::text)
        )
      ORDER BY ${attendancePaySettlements.confirmedAt} DESC
      LIMIT 1
    `);

    return row ?? null;
  }

  leaves(
    userIds: readonly string[],
    from: string,
    to: string,
    tx?: UserServiceTx,
  ): Promise<{ userId: string; date: string; type: 'full' | 'am' | 'pm' }[]> {
    if (userIds.length === 0) {
      return Promise.resolve([]);
    }

    return (tx ?? this.dbService.db)
      .select({ userId: attendanceLeaves.userId, date: attendanceLeaves.date, type: attendanceLeaves.type })
      .from(attendanceLeaves)
      .where(
        and(
          inArray(attendanceLeaves.userId, [...userIds]),
          gte(attendanceLeaves.date, from),
          lte(attendanceLeaves.date, to),
          isNull(attendanceLeaves.deletedAt),
        ),
      );
  }

  async audit(tx: UserServiceTx, entry: WageAuditEntry): Promise<void> {
    await tx.insert(attendanceAudit).values(entry);
  }
}
