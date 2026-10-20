import { NotFoundError, ServiceUnavailableError } from '@app/shared';
import { Inject, Injectable } from '@nestjs/common';
import { seoulDate } from '@packages/domain-types/attendance';
import type {
  MinimumWage,
  PayGroup,
  PayPolicy,
  WageRate,
  WageWorker,
  WageWorkerDetail,
  WorkSchedule,
} from '@packages/domain-types/attendance-wage';
import { AttendanceStaffUnavailableError } from '../attendance-staff';
import { AttendanceRepository } from '../repositories/attendance.repository';
import {
  WageRepository,
  type PayGroupRow,
  type PayPolicyRow,
  type WageRateRow,
  type WorkerRow,
  type WorkScheduleRow,
} from './wage.repository';

export function toPayGroup(row: PayGroupRow): PayGroup {
  return {
    id: row.id,
    name: row.name,
    payBasis: row.payBasis,
    payday: row.payday,
    periodCloseDay: row.periodCloseDay,
    payMonthOffset: row.payMonthOffset,
    active: row.active,
    version: row.version,
  };
}

export function toPayPolicy(row: PayPolicyRow): PayPolicy {
  return {
    id: row.id,
    groupId: row.groupId,
    effectiveFrom: row.effectiveFrom,
    rules: row.rules,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toWageRate(row: WageRateRow): WageRate {
  return { id: row.id, effectiveFrom: row.effectiveFrom, hourlyWage: row.hourlyWage };
}

export function toWorkSchedule(row: WorkScheduleRow): WorkSchedule {
  return { id: row.id, effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, days: row.days };
}

/** 이력에서 그 날짜에 유효한 행 — 시작일이 가장 늦은 것이 이긴다(기간 한정 시간표가 그 기간 동안 앞선다). */
export function effectiveAt<T extends { effectiveFrom: string; effectiveTo?: string | null }>(
  history: readonly T[],
  date: string,
): T | null {
  let found: T | null = null;

  for (const entry of history) {
    const covers = entry.effectiveFrom <= date && (!entry.effectiveTo || date <= entry.effectiveTo);

    if (covers && (!found || entry.effectiveFrom > found.effectiveFrom)) {
      found = entry;
    }
  }

  return found;
}

@Injectable()
export class WageSettingsReader {
  constructor(
    private readonly repository: WageRepository,
    @Inject(AttendanceRepository) private readonly attendance: Pick<AttendanceRepository, 'staff'>,
  ) {}

  async groups(): Promise<PayGroup[]> {
    return (await this.repository.groups()).map(toPayGroup);
  }

  async policies(groupId: string): Promise<PayPolicy[]> {
    return (await this.repository.policies(groupId)).map(toPayPolicy);
  }

  async minimumWages(): Promise<MinimumWage[]> {
    return (await this.repository.minimumWages()).map((row) => ({
      effectiveFrom: row.effectiveFrom,
      hourlyWage: row.hourlyWage,
    }));
  }

  /** 명단 ∪ 근태 직원. 명단에 없는 직원도 보여야 «명단에 추가»할 수 있다. */
  async workers(): Promise<WageWorker[]> {
    const [staff, roster] = await Promise.all([this.staff(), this.repository.workers()]);
    const userIds = [...new Set([...staff.map((person) => person.userId), ...roster.map((row) => row.userId)])];
    const [rates, schedules] = await Promise.all([this.repository.rates(userIds), this.repository.schedules(userIds)]);
    const today = seoulDate(new Date());

    return userIds
      .map((userId) =>
        this.worker(
          userId,
          staff.find((person) => person.userId === userId),
          roster.find((row) => row.userId === userId),
          rates.filter((row) => row.userId === userId),
          schedules.filter((row) => row.userId === userId),
          today,
        ),
      )
      .sort((a, b) => Number(b.onRoster) - Number(a.onRoster) || a.name.localeCompare(b.name, 'ko'));
  }

  async workerDetail(userId: string): Promise<WageWorkerDetail> {
    const [staff, roster, rates, schedules] = await Promise.all([
      this.staff(),
      this.repository.workers(),
      this.repository.rates([userId]),
      this.repository.schedules([userId]),
    ]);
    const person = staff.find((entry) => entry.userId === userId);
    const row = roster.find((entry) => entry.userId === userId);

    if (!person && !row) {
      throw new NotFoundError('근무자를 찾을 수 없어요.');
    }

    return {
      ...this.worker(userId, person, row, rates, schedules, seoulDate(new Date())),
      rates: rates.map(toWageRate),
      schedules: schedules.map(toWorkSchedule),
    };
  }

  private worker(
    userId: string,
    person: { name: string } | undefined,
    row: (WorkerRow & { name: string }) | undefined,
    rates: WageRateRow[],
    schedules: WorkScheduleRow[],
    today: string,
  ): WageWorker {
    const schedule = effectiveAt(schedules, today);

    return {
      userId,
      name: row?.name ?? person?.name ?? '',
      isStaff: !!person,
      onRoster: !!row,
      groupId: row?.groupId ?? null,
      hireDate: row?.hireDate ?? null,
      leaveDate: row?.leaveDate ?? null,
      label: row?.label ?? null,
      note: row?.note ?? null,
      version: row?.version ?? null,
      currentRate: effectiveAt(rates, today)?.hourlyWage ?? null,
      currentSchedule: schedule ? toWorkSchedule(schedule) : null,
    };
  }

  private async staff() {
    try {
      return await this.attendance.staff();
    } catch (error) {
      if (error instanceof AttendanceStaffUnavailableError) {
        throw new ServiceUnavailableError('권한 정보를 아직 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.');
      }

      throw error;
    }
  }
}
