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
    // 원래 회차는 «고쳤다» 로 닫는다. 그 사이 다른 사람이 먼저 닫았어도 새 회차는 이미 돌았으므로 결과를 돌려준다.
    await this.runs.closeOpenHalted(id, actorId, 'forced');
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
