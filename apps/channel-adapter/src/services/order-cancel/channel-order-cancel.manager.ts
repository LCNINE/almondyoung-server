// apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.ts
import { Injectable, Logger } from '@nestjs/common';
import type {
  CancelChannelOrderPayload,
  ChannelOrderCancelRefundFailure,
  ChannelOrderCancelRejectionCode,
} from '@packages/event-contracts/streams';
import { MedusaClient } from '../../adapters/medusa/medusa.client';
import { getChannelFulfillmentCapabilities } from '../channel-capabilities';
import { OrderPollerOrchestrator } from '../order-collection/order-poller.orchestrator';
import { ChannelOrderCancelRepository } from './channel-order-cancel.repository';

type Rejection = {
  reasonCode: ChannelOrderCancelRejectionCode;
  message: string;
  unresolvedRefundAmount?: number;
  refundFailure?: ChannelOrderCancelRefundFailure;
};

/**
 * core 의 `CancelChannelOrder` 를 채널에 실행한다 (#1016 35번 행, ADR-0042 · 스펙 §7.3).
 *
 * 정해진 실패는 `ChannelOrderCancelRejected` 를 내고 정상 종료한다 — 재시도해도 같다.
 * wallet 의 영구 환불 거절(Medusa 가 표지를 단 400)은 `REFUND_FAILED` 로 낸다 — core 는 요청을 닫지 않고 보류를 유지한다(#1016 36번).
 * 일시 실패(채널 5xx·네트워크·재수집 실패)는 던져 재시도·DLQ 를 탄다. 채널 호출이 멱등이라 다시 해도 안전하다:
 * 전체는 «이미 취소됨»이 성공이고, 부분은 Medusa 가 같은 requestId 의 진행 단계부터 이어 간다.
 * 성공은 사실로 내지 않는다(D11) — 즉시 재수집한 `OrderCancelled`/`OrderModified` 가 곧 사실이다.
 */
@Injectable()
export class ChannelOrderCancelManager {
  private readonly logger = new Logger(ChannelOrderCancelManager.name);

  constructor(
    private readonly repository: ChannelOrderCancelRepository,
    private readonly medusaClient: MedusaClient,
    private readonly orderPoller: OrderPollerOrchestrator,
  ) {}

  /** `deliveryId` 는 명령 봉투의 messageId — 사실의 멱등 키에 쓴다(같은 전달의 재전달은 한 번, 다시 보내기는 새로). */
  async execute(command: CancelChannelOrderPayload, deliveryId: string): Promise<void> {
    const { requestId, salesChannel, externalOrderId } = command;
    // 실행기가 Medusa 하나뿐이라 채널 이름을 함께 본다 — 다른 채널이 능력을 켜면 여기에 실행기를 더해야 하고, 그 전엔 거절한다
    if (salesChannel !== 'medusa' || !getChannelFulfillmentCapabilities(salesChannel)?.automatedCancellation) {
      return this.reject(command, deliveryId, {
        reasonCode: 'NOT_SUPPORTED',
        message: `${salesChannel} 주문은 자동 취소를 지원하지 않습니다`,
      });
    }
    if (!(await this.repository.hasCollectedOrder(salesChannel, externalOrderId))) {
      return this.reject(command, deliveryId, {
        reasonCode: 'ORDER_NOT_FOUND',
        message: `수집된 적 없는 주문입니다: ${salesChannel}:${externalOrderId}`,
      });
    }

    const rejection =
      command.scope === 'full' ? await this.cancelFull(command) : await this.cancelPartial(command, deliveryId);
    if (rejection) return this.reject(command, deliveryId, rejection);

    const { outcome } = await this.orderPoller.syncOrder(salesChannel, externalOrderId, { force: true });
    const done = `[CANCEL] ${requestId} ${salesChannel}:${externalOrderId} ${command.scope} 완료 → 재수집 ${outcome}`;
    if (outcome === 'channel_inactive' || outcome === 'not_found') {
      // Medusa 는 취소됐는데 core 로 돌아가는 사실이 없다 — 정체 보드가 잡을 때까지 보이지 않는다
      this.logger.warn(done);
    } else {
      this.logger.log(done);
    }
  }

  private async cancelFull(command: CancelChannelOrderPayload): Promise<Rejection | undefined> {
    const outcome = await this.medusaClient.cancelOrder(command.externalOrderId);
    switch (outcome.kind) {
      case 'cancelled':
      case 'already_cancelled':
        return undefined;
      case 'not_found':
        return { reasonCode: 'ORDER_NOT_FOUND', message: outcome.message };
      case 'not_cancelable':
        return { reasonCode: 'NOT_CANCELABLE', message: outcome.message };
      case 'refund_refused':
        return { reasonCode: 'REFUND_FAILED', message: outcome.message, refundFailure: outcome.refundFailure };
      default: {
        // 새 결과 종류를 빠뜨리면 성공(undefined)으로 읽혀 거절도 재시도도 없이 넘어간다 — 컴파일에서 막는다
        const unhandled: never = outcome;
        throw new Error(`처리하지 않은 Medusa 취소 결과: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private async cancelPartial(command: CancelChannelOrderPayload, deliveryId: string): Promise<Rejection | undefined> {
    const { requestId, salesChannel, externalOrderId } = command;
    if (!command.lines || command.lines.length === 0) {
      throw new Error(`부분취소 명령에 줄이 없습니다: ${requestId}`);
    }
    const outcome = await this.medusaClient.partialCancelOrder(externalOrderId, {
      requestId,
      items: command.lines.map((line) => ({ itemId: line.channelOrderItemId, quantity: line.quantity })),
      ...(command.alreadyRefundedAmount !== undefined ? { alreadyRefunded: command.alreadyRefundedAmount } : {}),
    });
    switch (outcome.kind) {
      case 'cancelled':
        return undefined;
      case 'rejected':
        return { reasonCode: 'NOT_CANCELABLE', message: outcome.message };
      case 'external_refund':
        return {
          reasonCode: 'EXTERNAL_REFUND_UNRESOLVED',
          message: outcome.message,
          unresolvedRefundAmount: outcome.unresolvedAmount,
        };
      case 'refund_pending':
        // 주문은 줄었는데 돈은 아직 — core 가 정체 보드에서 이 상태를 따로 보이게 진행 사실을 먼저 내고, 던져서 재시도한다
        await this.repository.recordStalled(
          {
            requestId,
            salesChannel,
            externalOrderId,
            stage: 'edited',
            message: outcome.message,
            ...(outcome.refundFailure ? { refundFailure: outcome.refundFailure } : {}),
          },
          deliveryId,
        );
        throw new Error(`부분취소 환불 미완(${requestId}): ${outcome.message}`);
      default: {
        // 새 결과 종류를 빠뜨리면 성공(undefined)으로 읽혀 거절도 재시도도 없이 넘어간다 — 컴파일에서 막는다
        const unhandled: never = outcome;
        throw new Error(`처리하지 않은 Medusa 취소 결과: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private async reject(command: CancelChannelOrderPayload, deliveryId: string, rejection: Rejection): Promise<void> {
    const { requestId, salesChannel, externalOrderId } = command;
    this.logger.warn(
      `[CANCEL] ${requestId} ${salesChannel}:${externalOrderId} 거절 ${rejection.reasonCode}: ${rejection.message}`,
    );
    await this.repository.recordRejected({ requestId, salesChannel, externalOrderId, ...rejection }, deliveryId);
  }
}
