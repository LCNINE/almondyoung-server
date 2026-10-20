import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { Inject, Injectable } from '@nestjs/common';
import { seoulDate } from '@packages/domain-types/attendance';
import {
  DEFAULT_WAGE_RULES,
  type SettlementIssueKind,
  type SettlementRecord,
  type SettlementResult,
} from '@packages/domain-types/attendance-wage';
import type { UserServiceTx } from '../../../../database/drizzle/schema';
import { computeSettlement } from './settlement-calculator';
import type {
  ConfirmSettlementDto,
  DecideAbsenceDto,
  DecideOvertimeDto,
  ReopenSettlementDto,
} from './dto/wage-settlement.dto';
import { toSettlementRecord, WageSettlementReader } from './wage-settlement.reader';
import { effectiveAt } from './wage-settings.reader';
import { requireDate } from './wage-validation';
import { WageRepository } from './wage.repository';

const STALE = '다른 사람이 먼저 판정했어요. 새로 불러온 뒤 다시 저장해 주세요.';

/** 그 날짜가 속한 주의 마지막 날. */
export function weekEndOf(date: string, weekStartsOn: 1 | 7): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  const weekday = day === 0 ? 7 : day;
  const back = weekStartsOn === 1 ? weekday - 1 : weekday % 7;

  return new Date(Date.parse(`${date}T00:00:00Z`) + (6 - back) * 24 * 3600000).toISOString().slice(0, 10);
}

const ISSUE_LABELS: Record<SettlementIssueKind, string> = {
  missing_checkout: '퇴근 기록 없음',
  no_rate: '시급 없음',
  overtime_undecided: '연장 미판정',
  absence_undecided: '부재 미판정',
  not_on_roster: '명단 없음',
  outside_employment: '재직 기간 밖 근무',
};

function issueSummary(result: SettlementResult): string {
  const counts = new Map<SettlementIssueKind, number>();

  for (const issue of result.issues) {
    counts.set(issue.kind, (counts.get(issue.kind) ?? 0) + 1);
  }

  return [...counts].map(([kind, count]) => `${ISSUE_LABELS[kind]} ${count}건`).join(', ');
}

@Injectable()
export class WageSettlementManager {
  constructor(
    @Inject(WageRepository)
    private readonly repository: Pick<
      WageRepository,
      | 'run'
      | 'worker'
      | 'policies'
      | 'lockGroup'
      | 'confirmedCovering'
      | 'confirmedElsewhere'
      | 'overtimeDecision'
      | 'insertOvertimeDecision'
      | 'updateOvertimeDecision'
      | 'absenceDecision'
      | 'insertAbsenceDecision'
      | 'updateAbsenceDecision'
      | 'insertSettlement'
      | 'reopenSettlement'
      | 'settlement'
      | 'audit'
    >,
    @Inject(WageSettlementReader) private readonly reader: Pick<WageSettlementReader, 'load' | 'preview'>,
  ) {}

  async decideOvertime(actorId: string, userId: string, workDate: string, dto: DecideOvertimeDto): Promise<void> {
    requireDate(workDate, '근무일');

    const reason = dto.reason?.trim() || null;

    if (dto.status === 'rejected' && !reason) {
      throw new BadRequestError('인정하지 않는 사유를 적어 주세요.');
    }

    if (dto.status === 'recognized' && (dto.recognizedMinutes < 1 || dto.recognizedMinutes > dto.recordedMinutes)) {
      throw new BadRequestError('인정 시간은 1분 이상, 기록된 초과 시간 이하로 넣어 주세요.');
    }

    const recognizedMinutes = dto.status === 'recognized' ? dto.recognizedMinutes : 0;

    await this.repository.run(async (tx) => {
      await this.requireOpenDate(tx, userId, workDate);

      const before = await this.repository.overtimeDecision(tx, userId, workDate);
      const values = {
        recordedMinutes: dto.recordedMinutes,
        recognizedMinutes,
        status: dto.status,
        reason,
        decidedBy: actorId,
      };
      const after = before
        ? dto.version === undefined
          ? null
          : await this.repository.updateOvertimeDecision(tx, before.id, dto.version, values)
        : await this.repository.insertOvertimeDecision(tx, { userId, workDate, ...values });

      if (!after) {
        throw new ConflictError(STALE);
      }

      await this.repository.audit(tx, {
        actorId,
        subjectId: userId,
        kind: 'wage.overtime.decided',
        entityId: after.id,
        before: before ? { ...before } : null,
        after: { ...after },
      });
    });
  }

  async decideAbsence(actorId: string, userId: string, workDate: string, dto: DecideAbsenceDto): Promise<void> {
    requireDate(workDate, '근무일');

    const reason = dto.reason?.trim() || null;

    await this.repository.run(async (tx) => {
      await this.requireOpenDate(tx, userId, workDate);

      const before = await this.repository.absenceDecision(tx, userId, workDate);
      const values = { kind: dto.kind, reason, decidedBy: actorId };
      const after = before
        ? dto.version === undefined
          ? null
          : await this.repository.updateAbsenceDecision(tx, before.id, dto.version, values)
        : await this.repository.insertAbsenceDecision(tx, { userId, workDate, ...values });

      if (!after) {
        throw new ConflictError(STALE);
      }

      await this.repository.audit(tx, {
        actorId,
        subjectId: userId,
        kind: 'wage.absence.decided',
        entityId: after.id,
        before: before ? { ...before } : null,
        after: { ...after },
      });
    });
  }

  /** 계산 결과를 그대로 얼려 둔다. 그 뒤 시급·규칙을 바꿔도 확정 금액은 그대로다. */
  async confirm(actorId: string, dto: ConfirmSettlementDto): Promise<SettlementRecord> {
    return this.repository.run(async (tx) => {
      await this.repository.lockGroup(tx, dto.groupId);

      const loaded = await this.reader.load(dto.groupId, dto.paydayMonth, { tx });

      if (loaded.period.periodEnd >= seoulDate(new Date())) {
        throw new BadRequestError('정산 기간이 끝난 다음 날부터 확정할 수 있어요.');
      }

      const result = computeSettlement(loaded.input);

      if (result.issues.length > 0) {
        throw new BadRequestError(`계산하지 못한 항목을 먼저 정리해 주세요: ${issueSummary(result)}`);
      }

      const elsewhere = await this.repository.confirmedElsewhere(
        tx,
        dto.groupId,
        result.people.map((person) => person.userId),
        result.periodStart,
        result.periodEnd,
      );

      if (elsewhere.length > 0) {
        const names = result.people.filter((person) => elsewhere.includes(person.userId)).map((person) => person.name);

        throw new ConflictError(`다른 급여 그룹에서 이미 확정한 기간과 겹치는 근무자가 있어요: ${names.join(', ')}`);
      }

      const row = await this.repository.insertSettlement(tx, {
        groupId: dto.groupId,
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
        payday: result.payday,
        status: 'confirmed',
        snapshot: result,
        total: result.totals.total,
        confirmedBy: actorId,
      });

      if (!row) {
        throw new ConflictError('이 기간은 이미 확정했어요. 다시 계산하려면 확정본을 먼저 다시 열어 주세요.');
      }

      await this.repository.audit(tx, {
        actorId,
        subjectId: actorId,
        kind: 'wage.settlement.confirmed',
        entityId: row.id,
        after: { groupId: dto.groupId, periodStart: row.periodStart, periodEnd: row.periodEnd, total: row.total },
      });

      return toSettlementRecord(row);
    });
  }

  async reopen(actorId: string, id: string, dto: ReopenSettlementDto): Promise<SettlementRecord> {
    const reason = dto.reason.trim();

    if (!reason) {
      throw new BadRequestError('다시 여는 사유를 적어 주세요.');
    }

    return this.repository.run(async (tx) => {
      const before = await this.repository.settlement(id, tx);

      if (!before) {
        throw new NotFoundError('정산을 찾을 수 없어요.');
      }

      await this.repository.lockGroup(tx, before.groupId);

      const row = await this.repository.reopenSettlement(tx, id, actorId, reason);

      if (!row) {
        throw new ConflictError('이미 다시 연 정산이에요.');
      }

      await this.repository.audit(tx, {
        actorId,
        subjectId: actorId,
        kind: 'wage.settlement.reopened',
        entityId: id,
        before: { status: before.status },
        after: { status: row.status, reason },
      });

      return toSettlementRecord(row);
    });
  }

  /** 내려받기는 화면이 표를 만든다 — 여기서는 누가 무엇을 받았는지 남기고 데이터를 준다. */
  async exportSettlement(actorId: string, id: string): Promise<SettlementRecord> {
    return this.repository.run(async (tx) => {
      const row = await this.repository.settlement(id, tx);

      if (!row) {
        throw new NotFoundError('정산을 찾을 수 없어요.');
      }

      await this.repository.audit(tx, {
        actorId,
        subjectId: actorId,
        kind: 'wage.settlement.exported',
        entityId: id,
        after: { periodStart: row.periodStart, people: row.snapshot.people.length },
      });

      return toSettlementRecord(row);
    });
  }

  async exportPreview(actorId: string, groupId: string, paydayMonth: string): Promise<SettlementResult> {
    const result = await this.reader.preview(groupId, paydayMonth);

    await this.repository.run((tx) =>
      this.repository.audit(tx, {
        actorId,
        subjectId: actorId,
        kind: 'wage.preview.exported',
        entityId: groupId,
        after: { periodStart: result.periodStart, people: result.people.length },
      }),
    );

    return result;
  }

  /**
   * 판정 하루가 바꾸는 것은 그날이 든 기간과, 그 주의 주휴가 들어가는 기간(주 마지막 날)뿐이다 —
   * 그 두 날짜가 확정 기간 안이면 막는다. 다시 연 앞 기간은 뒤 기간이 확정돼 있어도 판정할 수 있다.
   */
  private async requireOpenDate(tx: UserServiceTx, userId: string, workDate: string) {
    const worker = await this.repository.worker(tx, userId);

    if (!worker) {
      throw new NotFoundError('근무자 명단에 없는 사람이에요.');
    }

    await this.repository.lockGroup(tx, worker.groupId);

    const policies = await this.repository.policies(worker.groupId, tx);
    const rules = (effectiveAt(policies, workDate) ?? policies[0])?.rules ?? DEFAULT_WAGE_RULES;

    if (
      await this.repository.confirmedCovering(tx, worker.groupId, [
        workDate,
        weekEndOf(workDate, rules.weeklyHoliday.weekStartsOn),
      ])
    ) {
      throw new ConflictError('확정한 기간 안의 판정은 바꿀 수 없어요. 정산을 다시 연 뒤 바꿔 주세요.');
    }
  }
}
