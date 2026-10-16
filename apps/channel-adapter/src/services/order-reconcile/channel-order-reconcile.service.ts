import { Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '@app/shared';
import type { SalesChannel } from '@packages/event-contracts/streams';
import { errorMessage } from '../order-collection/order-processing-stage.error';
import {
  ChannelOrderReconcileManager,
  ManualRedeliveryBlock,
  ReconcileCycleReport,
} from './channel-order-reconcile.manager';
import { ChannelOrderRedeliveryManager, RedeliveryResult } from './channel-order-redelivery.manager';
import { OrderReconcileFinding, OrderReconcileFindingRepository } from './order-reconcile-finding.repository';
import type { FindingStatus } from './order-reconcile.types';

const BLOCK_MESSAGES: Record<ManualRedeliveryBlock, string> = {
  event_failure_open: '이 주문의 이벤트 실패가 열려 있다 — «이벤트 실패» 화면에서 먼저 처리한다',
  in_flight: '이 주문의 이벤트가 아직 나가는 중이다 — 잠시 뒤 다시 확인한다',
  already_in_core: '이미 core 에 반영돼 있다 — 다음 대사 주기에 해소로 닫힌다',
  core_status: 'core 판매주문이 취소를 받을 수 없는 상태다(출고됨 등) — 사람이 처리하고 종결한다',
};

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
    const block = await this.manager.manualRedeliveryBlock(finding);
    if (block) throw new ConflictError(BLOCK_MESSAGES[block]);
    try {
      return { result: await this.redelivery.redeliver(finding) };
    } catch (error) {
      // 적재는 롤백됐다 — 실패도 시도로 남겨 왜 안 됐는지 목록에서 보이게 한다(리뷰 I-7)
      await this.findings.recordAttempt(id, `error: ${errorMessage(error)}`);
      throw error;
    }
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
