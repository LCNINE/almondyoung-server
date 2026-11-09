import { Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '@app/shared';
import { ReservationReconcileRunRepository, type ReconcileRunRow } from './reservation-reconcile-run.repository';
import { ReservationReconcileService } from './reservation-reconcile.service';

/** 멈춘 대사 회차를 사람이 다루는 길 (#1247) — 확인하고 고치기 / 사유 남기고 종결. */
@Injectable()
export class ReservationReconcileRunsService {
  constructor(
    private readonly runs: ReservationReconcileRunRepository,
    private readonly reconcile: ReservationReconcileService,
  ) {}

  async overview(): Promise<{ open: ReconcileRunRow[]; latest: ReconcileRunRow | null }> {
    const [open, latest] = await Promise.all([this.runs.listOpenHalted(), this.runs.latest()]);
    return { open, latest };
  }

  async apply(id: string, actorId: string) {
    await this.requireOpenHalted(id);
    const record = await this.reconcile.run({ limit: null, forcedBy: actorId });
    // 고쳐졌을 때(applied)만 원래 회차를 닫는다. skipped·halted 면 열어 두고 새 회차(오류 포함)를 그대로 보여 준다.
    if (record.status === 'applied') await this.runs.closeOpenHalted(id, actorId, 'forced');
    return record;
  }

  async close(id: string, actorId: string, reason: string) {
    await this.requireOpenHalted(id);
    if (!(await this.runs.closeOpenHalted(id, actorId, reason))) {
      throw new ConflictError('이미 닫힌 회차입니다');
    }
    return this.runs.findById(id);
  }

  private async requireOpenHalted(id: string): Promise<void> {
    const run = await this.runs.findById(id);
    if (!run) throw new NotFoundError(`Reconcile run not found: ${id}`);
    if (run.status !== 'halted') throw new ConflictError('멈춘 회차가 아닙니다');
    if (run.closedAt) throw new ConflictError('이미 닫힌 회차입니다');
  }
}
