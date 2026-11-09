import { Injectable, Logger } from '@nestjs/common';
import { ConflictError, NotFoundError } from '@app/shared';
import { ReservationReconcileRunRepository, type ReconcileRunRow } from './reservation-reconcile-run.repository';
import { ReservationReconcileService } from './reservation-reconcile.service';

/** 멈춘 대사 회차를 사람이 다루는 길 (#1247) — 확인하고 고치기 / 사유 남기고 종결. */
@Injectable()
export class ReservationReconcileRunsService {
  private readonly logger = new Logger(ReservationReconcileRunsService.name);

  constructor(
    private readonly runs: ReservationReconcileRunRepository,
    private readonly reconcile: ReservationReconcileService,
  ) {}

  async overview(): Promise<{ open: ReconcileRunRow[]; latest: ReconcileRunRow | null }> {
    const [open, latest] = await Promise.all([this.runs.listOpenHalted(), this.runs.latest()]);
    return { open, latest };
  }

  /**
   * 한도 없는 회차를 뒤에서 시작하고 그 회차 행(`running`)을 바로 돌려준다 — 회차는 정착 대기만 5분이라
   * HTTP 로 기다리면 프록시가 먼저 끊는다. 결과는 화면이 회차 목록을 다시 읽어 본다.
   * 도는 회차가 있으면 409. 고쳐졌을 때(applied)만 원래 회차를 닫는다 — skipped·halted 면 열어 두고 새 회차가 오류를 보인다.
   */
  async apply(id: string, actorId: string): Promise<ReconcileRunRow> {
    await this.requireOpenHalted(id);
    const start = await this.reconcile.startForced(actorId);
    if (start.kind === 'not_ready') throw new ConflictError('예약 전환 시각이 없어 고칠 수 없습니다');
    if (start.kind === 'busy') throw new ConflictError('예약 대사가 도는 중입니다 — 끝난 뒤 다시 누르세요');
    void start.done.then(async (record) => {
      if (record?.status !== 'applied') return;
      try {
        await this.runs.closeOpenHalted(id, actorId, 'forced');
      } catch (error) {
        this.logger.error(`멈춘 회차 ${id} 닫기 실패: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    const started = await this.runs.findById(start.id);
    if (!started) throw new Error(`방금 시작한 대사 회차가 없다: ${start.id}`);
    return started;
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
