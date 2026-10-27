// apps/channel-adapter/src/services/order-cancel/channel-return-settle.manager.ts
import { Injectable, Logger } from '@nestjs/common';
import type { SettleChannelReturnPayload } from '@packages/event-contracts/streams';
import { MedusaClient } from '../../adapters/medusa/medusa.client';
import { getChannelFulfillmentCapabilities } from '../channel-capabilities';
import { OrderPollerOrchestrator } from '../order-collection/order-poller.orchestrator';
import { ChannelOrderCancelRepository } from './channel-order-cancel.repository';

/** 정산이 끝나지 못한 결과. `received` = Medusa 수령은 확정됐고 환불만 남았다 */
type ReturnSettlementFailure = { retryable: boolean; received: boolean; failureCode: string; message: string };

/**
 * core 의 `SettleChannelReturn` 을 Medusa 반품 정산 라우트에 실행한다 (K8 PR6, N1).
 *
 * `ChannelOrderCancelManager` 와 같은 길이다: 끝나지 못한 모든 결과는 `ChannelReturnSettlementFailed` 로 낸 뒤 명령을 ack 한다 —
 * 다시 부르는 곳은 core 크론(N9) 하나다. 사실을 못 낸 경우(아웃박스 쓰기 실패)만 던져 재배달을 탄다.
 * 성공은 사실로 내지 않는다 — 즉시 재수집한 `ChannelReturnSettled` 관측이 곧 사실이다. Medusa 호출은 같은 requestId 의 진행 단계부터 이어 가므로 다시 해도 안전하다.
 */
@Injectable()
export class ChannelReturnSettleManager {
  private readonly logger = new Logger(ChannelReturnSettleManager.name);

  constructor(
    private readonly repository: ChannelOrderCancelRepository,
    private readonly medusaClient: MedusaClient,
    private readonly orderPoller: OrderPollerOrchestrator,
  ) {}

  /** `deliveryId` 는 명령 봉투의 messageId — 사실의 멱등 키에 쓴다(같은 전달의 재전달은 한 번, 재발행은 새로). */
  async execute(command: SettleChannelReturnPayload, deliveryId: string): Promise<void> {
    const { requestId, salesChannel, externalOrderId, returnId } = command;
    // 취소와 같은 이유로 execute 안에 둔다: 이 검사가 salesChannel 을 'medusa' 로 좁혀 아래 재수집에 넘긴다
    if (salesChannel !== 'medusa' || !getChannelFulfillmentCapabilities(salesChannel)?.automatedCancellation) {
      return this.fail(command, deliveryId, {
        retryable: false,
        received: false,
        failureCode: 'channel_not_supported',
        message: `${salesChannel} 주문은 자동 반품 정산을 지원하지 않습니다`,
      });
    }
    if (!(await this.repository.hasCollectedOrder(salesChannel, externalOrderId))) {
      return this.fail(command, deliveryId, {
        retryable: false,
        received: false,
        failureCode: 'order_not_collected',
        message: `수집된 적 없는 주문입니다: ${salesChannel}:${externalOrderId}`,
      });
    }

    const failure = await this.settle(command);
    if (failure) return this.fail(command, deliveryId, failure);

    const { outcome } = await this.orderPoller.syncOrder(salesChannel, externalOrderId, { force: true });
    const done = `[RETURN-SETTLE] ${requestId} ${salesChannel}:${externalOrderId} ${returnId} 완료 → 재수집 ${outcome}`;
    if (outcome === 'channel_inactive' || outcome === 'not_found') {
      // Medusa 는 정산됐는데 core 로 돌아가는 사실이 없다 — 정체 보드가 잡을 때까지 보이지 않는다
      this.logger.warn(done);
    } else {
      this.logger.log(done);
    }
  }

  private async settle(command: SettleChannelReturnPayload): Promise<ReturnSettlementFailure | undefined> {
    const outcome = await this.medusaClient.settleReturn(command.externalOrderId, command.returnId, {
      requestId: command.requestId,
      items: command.items.map((item) => ({
        itemId: item.channelOrderItemId,
        received: item.received,
        dismissed: item.dismissed,
      })),
      refundMode: command.refundMode ?? 'auto',
      // 명령 칸을 그대로 넘긴다 — 빠지면 차감·상계 없이 정산돼 과환불이다
      ...(command.holdDeduction !== undefined ? { holdDeduction: command.holdDeduction } : {}),
      ...(command.alreadyRefundedAmount !== undefined ? { alreadyRefundedAmount: command.alreadyRefundedAmount } : {}),
      ...(command.closesMissing !== undefined ? { closesMissing: command.closesMissing } : {}),
    });
    switch (outcome.kind) {
      case 'settled':
        return undefined;
      case 'rejected':
        return {
          retryable: false,
          received: false,
          failureCode: `return_settle_rejected:${outcome.reason}`,
          message: outcome.message,
        };
      case 'refund_refused':
        return { retryable: false, received: true, failureCode: outcome.failureCode, message: outcome.message };
      case 'refund_pending':
        return { retryable: true, received: true, failureCode: 'refund_pending', message: outcome.message };
      case 'not_found':
        return { retryable: false, received: false, failureCode: 'not_found', message: outcome.message };
      case 'transient':
        return { retryable: true, received: false, failureCode: outcome.failureCode, message: outcome.message };
      default: {
        // 새 결과 종류를 빠뜨리면 성공(undefined)으로 읽혀 사실도 재시도도 없이 넘어간다 — 컴파일에서 막는다
        const unhandled: never = outcome;
        throw new Error(`처리하지 않은 Medusa 반품 정산 결과: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private async fail(
    command: SettleChannelReturnPayload,
    deliveryId: string,
    failure: ReturnSettlementFailure,
  ): Promise<void> {
    const { requestId, salesChannel, externalOrderId, returnId } = command;
    this.logger.warn(
      `[RETURN-SETTLE] ${requestId} ${salesChannel}:${externalOrderId} ${returnId} 정산 실패 ${failure.failureCode}` +
        ` (retryable=${failure.retryable}, received=${failure.received}): ${failure.message}`,
    );
    await this.repository.recordReturnSettlementFailure(
      {
        requestId,
        salesChannel,
        externalOrderId,
        returnId,
        received: failure.received,
        retryable: failure.retryable,
        failureCode: failure.failureCode,
        message: failure.message,
        at: new Date().toISOString(),
      },
      deliveryId,
    );
  }
}
