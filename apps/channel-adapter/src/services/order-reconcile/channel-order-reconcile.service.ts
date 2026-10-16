import { Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '@app/shared';
import type { SalesChannel } from '@packages/event-contracts/streams';
import { ChannelOrderReconcileManager, ReconcileCycleReport } from './channel-order-reconcile.manager';
import { ChannelOrderRedeliveryManager, RedeliveryResult } from './channel-order-redelivery.manager';
import { OrderReconcileFinding, OrderReconcileFindingRepository } from './order-reconcile-finding.repository';
import type { FindingStatus } from './order-reconcile.types';

@Injectable()
export class ChannelOrderReconcileService {
  constructor(
    private readonly findings: OrderReconcileFindingRepository,
    private readonly redelivery: ChannelOrderRedeliveryManager,
    private readonly manager: ChannelOrderReconcileManager,
  ) {}

  list(options: { status?: FindingStatus; limit: number; offset: number }): Promise<OrderReconcileFinding[]> {
    return this.findings.list(options);
  }

  summary() {
    return this.findings.summary();
  }

  /** 사람의 [다시 배달] — 창(D5)·규칙 모드와 무관하게 한 번 실행한다(스펙 §8.2). */
  async redeliverFinding(id: string): Promise<{ result: RedeliveryResult }> {
    const finding = await this.findings.findById(id);
    if (!finding || finding.status !== 'open') throw new NotFoundError(`Open reconcile finding not found: ${id}`);
    if (finding.humanReason === 'event_failure_open') {
      throw new ConflictError('이 주문의 이벤트 실패가 열려 있다 — «이벤트 실패» 화면에서 먼저 처리한다');
    }
    return { result: await this.redelivery.redeliver(finding) };
  }

  async closeFinding(id: string, actor: string | null, memo: string): Promise<OrderReconcileFinding> {
    const closed = await this.findings.close(id, actor, memo);
    if (!closed) throw new NotFoundError(`Open reconcile finding not found: ${id}`);
    return closed;
  }

  runCycle(
    channel: SalesChannel,
    options: { updatedAfter: Date; now: Date; observeOnly: boolean },
  ): Promise<ReconcileCycleReport> {
    return this.manager.runCycle(channel, options);
  }
}
