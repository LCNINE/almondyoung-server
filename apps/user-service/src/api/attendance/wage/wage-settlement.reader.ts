import { BadRequestError, NotFoundError, ServiceUnavailableError } from '@app/shared';
import { Inject, Injectable } from '@nestjs/common';
import { seoulDate } from '@packages/domain-types/attendance';
import {
  DEFAULT_WAGE_RULES,
  payPeriodFor,
  type MyWage,
  type PayGroup,
  type SettlementRecord,
  type SettlementResult,
  type SettlementSummary,
  type WageDecisionItem,
  type WageDecisions,
  type WagePeriod,
} from '@packages/domain-types/attendance-wage';
import type { UserServiceTx } from '../../../../database/drizzle/schema';
import { AttendanceStaffUnavailableError } from '../attendance-staff';
import { AttendanceRepository } from '../repositories/attendance.repository';
import { computeSettlement, type SettlementInput } from './settlement-calculator';
import { effectiveAt, toPayGroup } from './wage-settings.reader';
import {
  WageRepository,
  type AbsenceDecisionRow,
  type OvertimeDecisionRow,
  type SettlementRow,
} from './wage.repository';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_MS = 24 * 3600000;

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export interface LoadedSettlement {
  period: WagePeriod;
  input: SettlementInput;
  overtimeDecisions: OvertimeDecisionRow[];
  absenceDecisions: AbsenceDecisionRow[];
}

export function toSettlementSummary(row: SettlementRow): SettlementSummary {
  return {
    id: row.id,
    groupId: row.groupId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    payday: row.payday,
    status: row.status,
    total: row.total,
    confirmedAt: row.confirmedAt.toISOString(),
    reopenedAt: row.reopenedAt?.toISOString() ?? null,
    reopenReason: row.reopenReason,
  };
}

export function toSettlementRecord(row: SettlementRow): SettlementRecord {
  return { ...toSettlementSummary(row), snapshot: row.snapshot };
}

@Injectable()
export class WageSettlementReader {
  constructor(
    private readonly repository: WageRepository,
    @Inject(AttendanceRepository) private readonly attendance: Pick<AttendanceRepository, 'staff'>,
  ) {}

  /**
   * 한 그룹·지급 달의 계산 입력. 사람 수와 무관하게 표마다 한 번씩 읽는다.
   * `onlyUserId` 를 주면 그 사람만 읽는다(본인 급여 — 남의 기록을 읽지 않는다).
   */
  async load(
    groupId: string,
    paydayMonth: string,
    options: { onlyUserId?: string; tx?: UserServiceTx } = {},
  ): Promise<LoadedSettlement> {
    if (!MONTH.test(paydayMonth)) {
      throw new BadRequestError('지급 달을 YYYY-MM 형식으로 골라 주세요.');
    }

    return this.repository.run(async (tx) => {
      const group = await this.repository.group(tx, groupId);

      if (!group) {
        throw new NotFoundError('급여 그룹을 찾을 수 없어요.');
      }

      const period = { paydayMonth, ...payPeriodFor(group, paydayMonth) };
      const policies = await this.repository.policies(groupId, tx);
      const rules = (effectiveAt(policies, period.periodStart) ?? policies[0])?.rules ?? DEFAULT_WAGE_RULES;

      const roster = (await this.repository.workers(tx, { groupId, userId: options.onlyUserId })).filter(
        (row) =>
          (!row.hireDate || row.hireDate <= period.periodEnd) &&
          (!row.leaveDate || row.leaveDate >= period.periodStart),
      );
      // 명단에 없는 근태 직원은 «명단 없음»으로 알린다. 본인 조회에는 필요 없다.
      const missing = options.onlyUserId ? [] : await this.unrosteredStaff(tx);

      const userIds = roster.map((row) => row.userId);
      const from = shiftDate(period.periodStart, -6);
      const [rates, schedules, sessions, overtimeDecisions, absenceDecisions, minimumWages] = await Promise.all([
        this.repository.rates(userIds, tx),
        this.repository.schedules(userIds, tx),
        this.repository.sessions(userIds, from, period.periodEnd, tx),
        this.repository.overtimeDecisions(userIds, from, period.periodEnd, tx),
        this.repository.absenceDecisions(userIds, from, period.periodEnd, tx),
        this.repository.minimumWages(tx),
      ]);

      const input: SettlementInput = {
        group: { id: group.id, payBasis: group.payBasis },
        period,
        today: seoulDate(new Date()),
        rules,
        minimumWages,
        people: [
          ...roster.map((row) => ({
            userId: row.userId,
            name: row.name,
            onRoster: true,
            hireDate: row.hireDate,
            leaveDate: row.leaveDate,
            rates: rates.filter((rate) => rate.userId === row.userId),
            schedules: schedules.filter((schedule) => schedule.userId === row.userId),
            sessions: sessions.filter((session) => session.userId === row.userId),
            overtime: overtimeDecisions.filter((decision) => decision.userId === row.userId),
            absences: absenceDecisions.filter((decision) => decision.userId === row.userId),
          })),
          ...missing.map((person) => ({
            userId: person.userId,
            name: person.name,
            onRoster: false,
            hireDate: null,
            leaveDate: null,
            rates: [],
            schedules: [],
            sessions: [],
            overtime: [],
            absences: [],
          })),
        ],
      };

      return { period, input, overtimeDecisions, absenceDecisions };
    }, options.tx);
  }

  async groups(): Promise<PayGroup[]> {
    return (await this.repository.groups()).map(toPayGroup);
  }

  async preview(groupId: string, paydayMonth: string): Promise<SettlementResult> {
    return computeSettlement((await this.load(groupId, paydayMonth)).input);
  }

  async decisions(groupId: string, paydayMonth: string): Promise<WageDecisions> {
    const loaded = await this.load(groupId, paydayMonth);
    const result = computeSettlement(loaded.input);
    const items: WageDecisionItem[] = [];
    const leaves = await this.repository.leaves(
      result.people.map((person) => person.userId),
      shiftDate(loaded.period.periodStart, -6),
      loaded.period.periodEnd,
    );
    const leavePaid = loaded.input.rules.leavePaidDefault;

    for (const person of result.people) {
      for (const day of person.days) {
        const overtime = loaded.overtimeDecisions.find(
          (row) => row.userId === person.userId && row.workDate === day.workDate,
        );
        const absence = loaded.absenceDecisions.find(
          (row) => row.userId === person.userId && row.workDate === day.workDate,
        );
        const base = { userId: person.userId, name: person.name, workDate: day.workDate };

        if (day.overtimeRecordedMinutes > 0) {
          items.push({
            ...base,
            kind: 'overtime',
            recordedMinutes: day.overtimeRecordedMinutes,
            overtime: overtime
              ? {
                  status: overtime.status,
                  recognizedMinutes: overtime.recognizedMinutes,
                  reason: overtime.reason,
                  version: overtime.version,
                }
              : null,
            absence: null,
            leave: null,
            suggested: null,
          });
        }

        if (day.absence !== 'none') {
          const leave = leaves.find((row) => row.userId === person.userId && row.date === day.workDate)?.type ?? null;

          items.push({
            ...base,
            kind: 'absence',
            recordedMinutes: day.scheduledMinutes,
            overtime: null,
            absence: absence ? { kind: absence.kind, reason: absence.reason, version: absence.version } : null,
            leave,
            suggested: leave ? (leavePaid[leave] ? 'excused_paid' : 'excused_unpaid') : null,
          });
        }
      }
    }

    return { ...loaded.period, items };
  }

  async settlements(groupId: string): Promise<SettlementSummary[]> {
    return (await this.repository.settlements(groupId)).map(toSettlementSummary);
  }

  async settlement(id: string): Promise<SettlementRecord> {
    const row = await this.repository.settlement(id);

    if (!row) {
      throw new NotFoundError('정산을 찾을 수 없어요.');
    }

    return toSettlementRecord(row);
  }

  /** 본인 급여 — 확정본이 있으면 그 안의 내 몫만, 없으면 내 기록만으로 계산한 예상. 남의 행은 읽지 않는다. */
  async mine(userId: string, paydayMonth: string): Promise<MyWage> {
    if (!MONTH.test(paydayMonth)) {
      throw new BadRequestError('지급 달을 YYYY-MM 형식으로 골라 주세요.');
    }

    const [, year, month] = /^(\d{4})-(\d{2})$/.exec(paydayMonth) ?? [];
    const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).toISOString().slice(0, 10);
    const confirmed = await this.repository.confirmedShare(userId, `${paydayMonth}-01`, lastDay);

    if (confirmed) {
      return {
        paydayMonth,
        periodStart: confirmed.periodStart,
        periodEnd: confirmed.periodEnd,
        payday: confirmed.payday,
        status: 'confirmed',
        person: confirmed.person,
        issues: [],
      };
    }

    const [worker] = await this.repository.workers(undefined, { userId });

    if (!worker) {
      throw new NotFoundError('급여 명단에 없어요. 관리자에게 문의해 주세요.');
    }

    const loaded = await this.load(worker.groupId, paydayMonth, { onlyUserId: userId });
    const result = computeSettlement(loaded.input);

    return {
      ...loaded.period,
      status: 'estimate',
      person: result.people[0] ?? null,
      issues: result.issues.filter((issue) => issue.userId === userId),
    };
  }

  private async unrosteredStaff(tx: UserServiceTx) {
    let staff: { userId: string; name: string }[];

    try {
      staff = await this.attendance.staff();
    } catch (error) {
      if (error instanceof AttendanceStaffUnavailableError) {
        throw new ServiceUnavailableError('권한 정보를 아직 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.');
      }

      throw error;
    }

    const rostered = new Set((await this.repository.workers(tx)).map((row) => row.userId));

    return staff.filter((person) => !rostered.has(person.userId));
  }
}
