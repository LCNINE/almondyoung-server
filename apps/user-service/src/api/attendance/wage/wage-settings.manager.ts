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
  UpdatePayGroupDto,
} from './dto/wage-settings.dto';
import { toPayGroup, toPayPolicy, toWageRate, toWorkSchedule } from './wage-settings.reader';
import { parseScheduleDays, parseWageRules, requireDate } from './wage-validation';
import { WageRepository, type WorkerRow } from './wage.repository';

const STALE = '다른 사람이 먼저 바꿨어요. 새로 불러온 뒤 다시 저장해 주세요.';

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
      | 'lockGroup'
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

      if (await this.repository.confirmedThrough(tx, groupId, effectiveFrom)) {
        throw new ConflictError('확정한 기간 안의 계산 규칙은 바꿀 수 없어요. 정산을 다시 연 뒤 바꿔 주세요.');
      }

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

      if (await this.repository.confirmedThrough(tx, worker.groupId, effectiveFrom)) {
        throw new ConflictError('확정한 기간 안의 시급은 바꿀 수 없어요. 정산을 다시 연 뒤 바꿔 주세요.');
      }

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

      if (await this.repository.confirmedThrough(tx, worker.groupId, effectiveFrom)) {
        throw new ConflictError('확정한 기간 안의 시간표는 바꿀 수 없어요. 정산을 다시 연 뒤 바꿔 주세요.');
      }

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

    return worker;
  }
}
