import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { Inject, Injectable } from '@nestjs/common';
import { seoulDate } from '@packages/domain-types/attendance';
import {
  DEFAULT_WAGE_RULES,
  type MinimumWage,
  type PayGroup,
  type PayPolicy,
  type WageRate,
  type WorkSchedule,
} from '@packages/domain-types/attendance-wage';
import type { UserServiceTx } from '../../../../database/drizzle/schema';
import type {
  CreateMinimumWageDto,
  CreatePayGroupDto,
  CreatePayPolicyDto,
  CreateWageRateDto,
  CreateWorkScheduleDto,
  SaveWorkerDto,
  UpdateMinimumWageDto,
  UpdatePayGroupDto,
  UpdatePayPolicyDto,
  UpdateWageRateDto,
  UpdateWorkScheduleDto,
} from './dto/wage-settings.dto';
import { toPayGroup, toPayPolicy, toWageRate, toWorkSchedule } from './wage-settings.reader';
import { parseScheduleDays, parseWageRules, requireDate } from './wage-validation';
import { WageRepository, type WorkerRow } from './wage.repository';

const STALE = '다른 사람이 먼저 바꿨어요. 새로 불러온 뒤 다시 저장해 주세요.';
/** 모든 확정 기간을 덮는 날짜. */
const OPEN_START = '1900-01-01';

function optionalDate(value: string | null | undefined, name: string): string | null {
  return value ? requireDate(value, name) : null;
}

@Injectable()
export class WageSettingsManager {
  constructor(
    @Inject(WageRepository)
    private readonly repository: Pick<
      WageRepository,
      | 'run'
      | 'group'
      | 'insertGroup'
      | 'updateGroup'
      | 'policies'
      | 'insertPolicy'
      | 'worker'
      | 'insertWorker'
      | 'updateWorker'
      | 'userName'
      | 'insertRate'
      | 'schedules'
      | 'insertSchedule'
      | 'insertMinimumWage'
      | 'confirmedThrough'
      | 'hasConfirmed'
      | 'personConfirmedThrough'
      | 'lockGroup'
      | 'rate'
      | 'rates'
      | 'updateRate'
      | 'deleteRate'
      | 'schedule'
      | 'updateSchedule'
      | 'deleteSchedule'
      | 'policy'
      | 'updatePolicy'
      | 'deletePolicy'
      | 'updateMinimumWage'
      | 'deleteMinimumWage'
      | 'deleteWorker'
      | 'groupInUse'
      | 'deleteGroup'
      | 'audit'
    >,
  ) {}

  async createGroup(actorId: string, dto: CreatePayGroupDto): Promise<PayGroup> {
    const rules = parseWageRules(dto.rules ?? DEFAULT_WAGE_RULES);
    const effectiveFrom = dto.rulesEffectiveFrom
      ? requireDate(dto.rulesEffectiveFrom, '규칙 적용 시작일')
      : seoulDate(new Date());

    return this.repository.run(async (tx) => {
      const group = await this.repository.insertGroup(tx, {
        name: dto.name.trim(),
        payBasis: dto.payBasis,
        payday: dto.payday,
        periodCloseDay: dto.periodCloseDay,
        payMonthOffset: dto.payMonthOffset,
      });

      await this.repository.insertPolicy(tx, { groupId: group.id, effectiveFrom, rules, createdBy: actorId });

      await this.repository.audit(tx, {
        actorId,
        subjectId: actorId,
        kind: 'wage.group.created',
        entityId: group.id,
        after: { ...toPayGroup(group), rules, effectiveFrom },
      });

      return toPayGroup(group);
    });
  }

  async updateGroup(actorId: string, id: string, dto: UpdatePayGroupDto): Promise<PayGroup> {
    return this.repository.run(async (tx) => {
      const before = await this.requireGroup(tx, id);
      const calendarChanged =
        (dto.payday !== undefined && dto.payday !== before.payday) ||
        (dto.periodCloseDay !== undefined && dto.periodCloseDay !== before.periodCloseDay) ||
        (dto.payMonthOffset !== undefined && dto.payMonthOffset !== before.payMonthOffset);

      // 지급일·마감일이 바뀌면 같은 지급 달이 다른 기간을 가리켜 확정본과 어긋난다.
      if (calendarChanged && (await this.repository.hasConfirmed(tx, id))) {
        throw new ConflictError(
          '확정한 정산이 있는 그룹은 지급일·정산 기간을 바꿀 수 없어요. 새 그룹을 만들어 옮겨 주세요.',
        );
      }
      const after = await this.repository.updateGroup(tx, id, dto.version, {
        name: dto.name?.trim(),
        payday: dto.payday,
        periodCloseDay: dto.periodCloseDay,
        payMonthOffset: dto.payMonthOffset,
        active: dto.active,
      });

      if (!after) {
        throw new ConflictError(STALE);
      }

      await this.repository.audit(tx, {
        actorId,
        subjectId: actorId,
        kind: 'wage.group.updated',
        entityId: id,
        before: { ...toPayGroup(before) },
        after: { ...toPayGroup(after) },
      });

      return toPayGroup(after);
    });
  }

  async addPolicy(actorId: string, groupId: string, dto: CreatePayPolicyDto): Promise<PayPolicy> {
    const effectiveFrom = requireDate(dto.effectiveFrom, '규칙 적용 시작일');
    const rules = parseWageRules(dto.rules);

    return this.repository.run(async (tx) => {
      await this.requireGroup(tx, groupId);

      await this.refuseConfirmed(
        tx,
        groupId,
        await this.policyImpactDates(tx, groupId, [effectiveFrom]),
        '계산 규칙은',
      );

      if ((await this.repository.policies(groupId, tx)).some((policy) => policy.effectiveFrom === effectiveFrom)) {
        throw new ConflictError('같은 날짜에 시작하는 계산 규칙이 이미 있어요.');
      }

      const policy = await this.repository.insertPolicy(tx, { groupId, effectiveFrom, rules, createdBy: actorId });

      await this.repository.audit(tx, {
        actorId,
        subjectId: actorId,
        kind: 'wage.policy.created',
        entityId: policy.id,
        after: { groupId, effectiveFrom, rules },
      });

      return toPayPolicy(policy);
    });
  }

  async saveWorker(actorId: string, userId: string, dto: SaveWorkerDto): Promise<void> {
    const hireDate = optionalDate(dto.hireDate, '입사일');
    const leaveDate = optionalDate(dto.leaveDate, '퇴사일');

    if (hireDate && leaveDate && leaveDate < hireDate) {
      throw new BadRequestError('퇴사일이 입사일보다 앞서요.');
    }

    return this.repository.run(async (tx) => {
      if ((await this.repository.userName(tx, userId)) === null) {
        throw new NotFoundError('사용자를 찾을 수 없어요.');
      }

      await this.requireGroup(tx, dto.groupId);

      const values = {
        groupId: dto.groupId,
        hireDate,
        leaveDate,
        label: dto.label?.trim() || null,
        note: dto.note?.trim() || null,
      };
      const before = await this.repository.worker(tx, userId);
      let after: WorkerRow | null;

      if (before && before.groupId !== dto.groupId) {
        await this.repository.lockGroup(tx, before.groupId);
      }

      if (before) {
        if (dto.version === undefined) {
          throw new ConflictError(STALE);
        }

        after = await this.repository.updateWorker(tx, userId, dto.version, values);
      } else {
        after = await this.repository.insertWorker(tx, { userId, ...values });
      }

      if (!after) {
        throw new ConflictError(STALE);
      }

      await this.repository.audit(tx, {
        actorId,
        subjectId: userId,
        kind: 'wage.worker.saved',
        entityId: userId,
        before: before ? { ...before } : null,
        after: { ...after },
      });
    });
  }

  async addRate(actorId: string, userId: string, dto: CreateWageRateDto): Promise<WageRate> {
    const effectiveFrom = requireDate(dto.effectiveFrom, '시급 적용 시작일');

    return this.repository.run(async (tx) => {
      const worker = await this.requireWorker(tx, userId);

      await this.refuseConfirmed(tx, worker.groupId, [effectiveFrom], '시급은', userId);

      const rate = await this.repository.insertRate(tx, {
        userId,
        effectiveFrom,
        hourlyWage: dto.hourlyWage,
        createdBy: actorId,
      });

      if (!rate) {
        throw new ConflictError('같은 날짜에 시작하는 시급이 이미 있어요.');
      }

      await this.repository.audit(tx, {
        actorId,
        subjectId: userId,
        kind: 'wage.rate.created',
        entityId: rate.id,
        after: { effectiveFrom, hourlyWage: dto.hourlyWage },
      });

      return toWageRate(rate);
    });
  }

  async addSchedule(actorId: string, userId: string, dto: CreateWorkScheduleDto): Promise<WorkSchedule> {
    const effectiveFrom = requireDate(dto.effectiveFrom, '시간표 시작일');
    const effectiveTo = optionalDate(dto.effectiveTo, '시간표 종료일');
    const days = parseScheduleDays(dto.days);

    if (effectiveTo && effectiveTo < effectiveFrom) {
      throw new BadRequestError('시간표 종료일이 시작일보다 앞서요.');
    }

    return this.repository.run(async (tx) => {
      const worker = await this.requireWorker(tx, userId);

      await this.refuseConfirmed(tx, worker.groupId, [effectiveFrom], '시간표는', userId);

      // 겹치는 기간은 시작일이 늦은 쪽이 이긴다(기간 한정 시간표). 시작일까지 같으면 어느 쪽인지 정할 수 없다.
      if ((await this.repository.schedules([userId], tx)).some((row) => row.effectiveFrom === effectiveFrom)) {
        throw new ConflictError('같은 날짜에 시작하는 시간표가 이미 있어요.');
      }

      const schedule = await this.repository.insertSchedule(tx, {
        userId,
        effectiveFrom,
        effectiveTo,
        days,
        createdBy: actorId,
      });

      if (!schedule) {
        throw new ConflictError('같은 날짜에 시작하는 시간표가 이미 있어요.');
      }

      await this.repository.audit(tx, {
        actorId,
        subjectId: userId,
        kind: 'wage.schedule.created',
        entityId: schedule.id,
        after: { effectiveFrom, effectiveTo, days },
      });

      return toWorkSchedule(schedule);
    });
  }

  async addMinimumWage(actorId: string, dto: CreateMinimumWageDto): Promise<MinimumWage> {
    const effectiveFrom = requireDate(dto.effectiveFrom, '최저임금 적용 시작일');

    return this.repository.run(async (tx) => {
      const row = await this.repository.insertMinimumWage(tx, { effectiveFrom, hourlyWage: dto.hourlyWage });

      if (!row) {
        throw new ConflictError('같은 날짜에 시작하는 최저임금이 이미 있어요.');
      }

      // 최저임금 행은 날짜가 키라 식별자가 없다 — 바꾼 사람을 대상으로 남긴다.
      await this.repository.audit(tx, {
        actorId,
        subjectId: actorId,
        kind: 'wage.minimum_wage.created',
        entityId: actorId,
        after: { effectiveFrom, hourlyWage: dto.hourlyWage },
      });

      return { effectiveFrom: row.effectiveFrom, hourlyWage: row.hourlyWage };
    });
  }

  /** 계약 시급을 고친다 — 옛 시작일·새 시작일 중 이른 날부터 확정 기간과 겹치면 막는다. */
  async updateRate(actorId: string, userId: string, rateId: string, dto: UpdateWageRateDto): Promise<WageRate> {
    const nextFrom = dto.effectiveFrom ? requireDate(dto.effectiveFrom, '시급 적용 시작일') : undefined;

    return this.repository.run(async (tx) => {
      const worker = await this.requireWorker(tx, userId);
      const before = await this.requireRate(tx, userId, rateId);
      const effectiveFrom = nextFrom ?? before.effectiveFrom;

      await this.refuseConfirmed(tx, worker.groupId, [before.effectiveFrom, effectiveFrom], '시급은', userId);

      if (
        effectiveFrom !== before.effectiveFrom &&
        (await this.repository.rates([userId], tx)).some(
          (row) => row.id !== rateId && row.effectiveFrom === effectiveFrom,
        )
      ) {
        throw new ConflictError('같은 날짜에 시작하는 시급이 이미 있어요.');
      }

      const after = await this.repository.updateRate(tx, rateId, {
        effectiveFrom,
        hourlyWage: dto.hourlyWage ?? before.hourlyWage,
      });

      await this.repository.audit(tx, {
        actorId,
        subjectId: userId,
        kind: 'wage.rate.updated',
        entityId: rateId,
        before: { ...toWageRate(before) },
        after: { ...toWageRate(after) },
      });

      return toWageRate(after);
    });
  }

  async deleteRate(actorId: string, userId: string, rateId: string): Promise<void> {
    await this.repository.run(async (tx) => {
      const worker = await this.requireWorker(tx, userId);
      const before = await this.requireRate(tx, userId, rateId);

      await this.refuseConfirmed(tx, worker.groupId, [before.effectiveFrom], '시급은', userId);
      await this.repository.deleteRate(tx, rateId);
      await this.repository.audit(tx, {
        actorId,
        subjectId: userId,
        kind: 'wage.rate.deleted',
        entityId: rateId,
        before: { ...toWageRate(before) },
      });
    });
  }

  async updateSchedule(
    actorId: string,
    userId: string,
    scheduleId: string,
    dto: UpdateWorkScheduleDto,
  ): Promise<WorkSchedule> {
    const nextFrom = dto.effectiveFrom ? requireDate(dto.effectiveFrom, '시간표 시작일') : undefined;
    const nextTo = dto.effectiveTo === undefined ? undefined : optionalDate(dto.effectiveTo, '시간표 종료일');
    const days = dto.days ? parseScheduleDays(dto.days) : undefined;

    return this.repository.run(async (tx) => {
      const worker = await this.requireWorker(tx, userId);
      const before = await this.repository.schedule(tx, scheduleId);

      if (!before || before.userId !== userId) {
        throw new NotFoundError('시간표를 찾을 수 없어요.');
      }

      const values = {
        effectiveFrom: nextFrom ?? before.effectiveFrom,
        effectiveTo: nextTo === undefined ? before.effectiveTo : nextTo,
        days: days ?? before.days,
      };

      if (values.effectiveTo && values.effectiveTo < values.effectiveFrom) {
        throw new BadRequestError('시간표 종료일이 시작일보다 앞서요.');
      }

      await this.refuseConfirmed(tx, worker.groupId, [before.effectiveFrom, values.effectiveFrom], '시간표는', userId);

      if (
        values.effectiveFrom !== before.effectiveFrom &&
        (await this.repository.schedules([userId], tx)).some(
          (row) => row.id !== scheduleId && row.effectiveFrom === values.effectiveFrom,
        )
      ) {
        throw new ConflictError('같은 날짜에 시작하는 시간표가 이미 있어요.');
      }

      const after = await this.repository.updateSchedule(tx, scheduleId, values);

      await this.repository.audit(tx, {
        actorId,
        subjectId: userId,
        kind: 'wage.schedule.updated',
        entityId: scheduleId,
        before: { ...toWorkSchedule(before) },
        after: { ...toWorkSchedule(after) },
      });

      return toWorkSchedule(after);
    });
  }

  async deleteSchedule(actorId: string, userId: string, scheduleId: string): Promise<void> {
    await this.repository.run(async (tx) => {
      const worker = await this.requireWorker(tx, userId);
      const before = await this.repository.schedule(tx, scheduleId);

      if (!before || before.userId !== userId) {
        throw new NotFoundError('시간표를 찾을 수 없어요.');
      }

      await this.refuseConfirmed(tx, worker.groupId, [before.effectiveFrom], '시간표는', userId);
      await this.repository.deleteSchedule(tx, scheduleId);
      await this.repository.audit(tx, {
        actorId,
        subjectId: userId,
        kind: 'wage.schedule.deleted',
        entityId: scheduleId,
        before: { ...toWorkSchedule(before) },
      });
    });
  }

  async updatePolicy(actorId: string, groupId: string, policyId: string, dto: UpdatePayPolicyDto): Promise<PayPolicy> {
    const nextFrom = dto.effectiveFrom ? requireDate(dto.effectiveFrom, '규칙 적용 시작일') : undefined;
    const rules = dto.rules ? parseWageRules(dto.rules) : undefined;

    return this.repository.run(async (tx) => {
      await this.requireGroup(tx, groupId);

      const before = await this.requirePolicy(tx, groupId, policyId);
      const effectiveFrom = nextFrom ?? before.effectiveFrom;

      await this.refuseConfirmed(
        tx,
        groupId,
        await this.policyImpactDates(tx, groupId, [before.effectiveFrom, effectiveFrom], policyId),
        '계산 규칙은',
      );

      if (
        effectiveFrom !== before.effectiveFrom &&
        (await this.repository.policies(groupId, tx)).some(
          (row) => row.id !== policyId && row.effectiveFrom === effectiveFrom,
        )
      ) {
        throw new ConflictError('같은 날짜에 시작하는 계산 규칙이 이미 있어요.');
      }

      const after = await this.repository.updatePolicy(tx, policyId, { effectiveFrom, rules: rules ?? before.rules });

      await this.repository.audit(tx, {
        actorId,
        subjectId: actorId,
        kind: 'wage.policy.updated',
        entityId: policyId,
        before: { effectiveFrom: before.effectiveFrom, rules: before.rules },
        after: { effectiveFrom: after.effectiveFrom, rules: after.rules },
      });

      return toPayPolicy(after);
    });
  }

  async deletePolicy(actorId: string, groupId: string, policyId: string): Promise<void> {
    await this.repository.run(async (tx) => {
      await this.requireGroup(tx, groupId);

      const before = await this.requirePolicy(tx, groupId, policyId);

      if ((await this.repository.policies(groupId, tx)).length <= 1) {
        throw new ConflictError('계산 규칙은 하나 이상 있어야 해요. 지우는 대신 고쳐 주세요.');
      }

      await this.refuseConfirmed(
        tx,
        groupId,
        await this.policyImpactDates(tx, groupId, [before.effectiveFrom], policyId),
        '계산 규칙은',
      );
      await this.repository.deletePolicy(tx, policyId);
      await this.repository.audit(tx, {
        actorId,
        subjectId: actorId,
        kind: 'wage.policy.deleted',
        entityId: policyId,
        before: { effectiveFrom: before.effectiveFrom, rules: before.rules },
      });
    });
  }

  async updateMinimumWage(actorId: string, effectiveFrom: string, dto: UpdateMinimumWageDto): Promise<MinimumWage> {
    requireDate(effectiveFrom, '최저임금 적용 시작일');

    return this.repository.run(async (tx) => {
      const row = await this.repository.updateMinimumWage(tx, effectiveFrom, dto.hourlyWage);

      if (!row) {
        throw new NotFoundError('그 날짜의 최저임금이 없어요.');
      }

      await this.repository.audit(tx, {
        actorId,
        subjectId: actorId,
        kind: 'wage.minimum_wage.updated',
        entityId: actorId,
        after: { effectiveFrom, hourlyWage: dto.hourlyWage },
      });

      return { effectiveFrom: row.effectiveFrom, hourlyWage: row.hourlyWage };
    });
  }

  async deleteMinimumWage(actorId: string, effectiveFrom: string): Promise<void> {
    requireDate(effectiveFrom, '최저임금 적용 시작일');

    await this.repository.run(async (tx) => {
      if (!(await this.repository.deleteMinimumWage(tx, effectiveFrom))) {
        throw new NotFoundError('그 날짜의 최저임금이 없어요.');
      }

      await this.repository.audit(tx, {
        actorId,
        subjectId: actorId,
        kind: 'wage.minimum_wage.deleted',
        entityId: actorId,
        before: { effectiveFrom },
      });
    });
  }

  /** 명단에서 뺀다. 확정본은 그대로 남고, 시급·시간표 이력도 지우지 않는다(다시 넣으면 이어 쓴다). */
  async removeWorker(actorId: string, userId: string): Promise<void> {
    await this.repository.run(async (tx) => {
      const before = await this.requireWorker(tx, userId);

      await this.repository.deleteWorker(tx, userId);
      await this.repository.audit(tx, {
        actorId,
        subjectId: userId,
        kind: 'wage.worker.removed',
        entityId: userId,
        before: { ...before },
      });
    });
  }

  async deleteGroup(actorId: string, groupId: string): Promise<void> {
    await this.repository.run(async (tx) => {
      const before = await this.requireGroup(tx, groupId);

      if (await this.repository.groupInUse(tx, groupId)) {
        throw new ConflictError('근무자나 정산 기록이 있는 그룹은 지울 수 없어요. «쓰지 않기»로 바꿔 주세요.');
      }

      await this.repository.deleteGroup(tx, groupId);
      await this.repository.audit(tx, {
        actorId,
        subjectId: actorId,
        kind: 'wage.group.deleted',
        entityId: groupId,
        before: { ...toPayGroup(before) },
      });
    });
  }

  /**
   * 이 날짜부터의 변경이 확정 금액을 바꾸는가. 그룹의 확정본과, 사람별 이력이면 그 사람이 든 다른 그룹의
   * 확정본(소속을 옮긴 경우)까지 본다.
   */
  private async refuseConfirmed(
    tx: UserServiceTx,
    groupId: string,
    dates: readonly string[],
    what: string,
    userId?: string,
  ) {
    const earliest = [...dates].sort()[0];

    if (!earliest) {
      return;
    }

    const confirmed =
      (await this.repository.confirmedThrough(tx, groupId, earliest)) ||
      (userId !== undefined && (await this.repository.personConfirmedThrough(tx, userId, earliest)));

    if (confirmed) {
      throw new ConflictError(`확정한 기간 안의 ${what} 바꿀 수 없어요. 정산을 다시 연 뒤 바꿔 주세요.`);
    }
  }

  /** 첫 규칙은 그보다 앞선 기간에도 쓰인다 — 첫 규칙이 바뀌면 모든 기간이 영향을 받는다. */
  private async policyImpactDates(tx: UserServiceTx, groupId: string, dates: readonly string[], policyId?: string) {
    const policies = await this.repository.policies(groupId, tx);
    const earliest = policies.map((policy) => policy.effectiveFrom).sort()[0];
    const touchesFirst =
      !earliest ||
      dates.some((date) => date <= earliest) ||
      (policyId !== undefined && policies.find((policy) => policy.id === policyId)?.effectiveFrom === earliest);

    return touchesFirst ? [OPEN_START] : dates;
  }

  private async requireRate(tx: UserServiceTx, userId: string, rateId: string) {
    const rate = await this.repository.rate(tx, rateId);

    if (!rate || rate.userId !== userId) {
      throw new NotFoundError('시급을 찾을 수 없어요.');
    }

    return rate;
  }

  private async requirePolicy(tx: UserServiceTx, groupId: string, policyId: string) {
    const policy = await this.repository.policy(tx, policyId);

    if (!policy || policy.groupId !== groupId) {
      throw new NotFoundError('계산 규칙을 찾을 수 없어요.');
    }

    return policy;
  }

  /** 그룹을 잠근 뒤 읽는다 — 확정과 설정 변경이 서로의 사이에 끼지 않게. */
  private async requireGroup(tx: UserServiceTx, id: string) {
    await this.repository.lockGroup(tx, id);

    const group = await this.repository.group(tx, id);

    if (!group) {
      throw new NotFoundError('급여 그룹을 찾을 수 없어요.');
    }

    return group;
  }

  private async requireWorker(tx: UserServiceTx, userId: string) {
    const worker = await this.repository.worker(tx, userId);

    if (!worker) {
      throw new NotFoundError('근무자 명단에 먼저 추가해 주세요.');
    }

    await this.repository.lockGroup(tx, worker.groupId);

    // 잠금을 기다리는 사이 소속이 바뀌었으면 잠근 그룹이 틀렸다 — 다시 시도하게 한다.
    const locked = await this.repository.worker(tx, userId);

    if (!locked || locked.groupId !== worker.groupId) {
      throw new ConflictError(STALE);
    }

    return locked;
  }
}
