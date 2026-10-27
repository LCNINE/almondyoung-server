// apps/channel-adapter/src/services/order-cancel/channel-return-prepay.manager.ts
import { Injectable, Logger } from '@nestjs/common';
import type { PrepayChannelReturnPayload } from '@packages/event-contracts/streams';
import { MedusaClient } from '../../adapters/medusa/medusa.client';
import { getChannelFulfillmentCapabilities } from '../channel-capabilities';
import { OrderPollerOrchestrator } from '../order-collection/order-poller.orchestrator';
import { ChannelOrderCancelRepository } from './channel-order-cancel.repository';

/** 선환불이 끝나지 못한 결과. 정산과 달리 «수령은 확정» 같은 중간 상태가 없다 */
type ReturnPrepayFailure = { retryable: boolean; failureCode: string; message: string };

/**
 * core 의 `PrepayChannelReturn` 을 Medusa 반품 선환불 라우트에 실행한다 (K8 PR6b).
 *
 * `ChannelReturnSettleManager` 와 같은 길이다: 끝나지 못한 모든 결과는 `ChannelReturnPrepayFailed` 로 낸 뒤 명령을 ack 한다 —
 * 다시 부르는 곳은 core 다. 사실을 못 낸 경우(아웃박스 쓰기 실패)만 던져 재배달을 탄다.
 * 성공은 사실로 내지 않는다 — 즉시 재수집한 `ChannelReturnPrepaid` 관측이 곧 사실이다. 같은 requestId 로 다시 불러도 안전하다.
 */
@Injectable()
export class ChannelReturnPrepayManager {
  private readonly logger = new Logger(ChannelReturnPrepayManager.name);

  constructor(
    private readonly repository: ChannelOrderCancelRepository,
    private readonly medusaClient: MedusaClient,
    private readonly orderPoller: OrderPollerOrchestrator,
  ) {}

  /** `deliveryId` 는 명령 봉투의 messageId — 사실의 멱등 키에 쓴다(같은 전달의 재전달은 한 번, 재발행은 새로). */
  async execute(command: PrepayChannelReturnPayload, deliveryId: string): Promise<void> {
    const { requestId, salesChannel, externalOrderId, returnId } = command;
    if (salesChannel !== 'medusa' || !getChannelFulfillmentCapabilities(salesChannel)?.automatedCancellation) {
      return this.fail(command, deliveryId, {
        retryable: false,
        failureCode: 'channel_not_supported',
        message: `${salesChannel} 주문은 자동 반품 선환불을 지원하지 않습니다`,
      });
    }
    if (!(await this.repository.hasCollectedOrder(salesChannel, externalOrderId))) {
      return this.fail(command, deliveryId, {
        retryable: false,
        failureCode: 'order_not_collected',
        message: `수집된 적 없는 주문입니다: ${salesChannel}:${externalOrderId}`,
      });
    }

    const failure = await this.prepay(command);
    if (failure) return this.fail(command, deliveryId, failure);

    const { outcome } = await this.orderPoller.syncOrder(salesChannel, externalOrderId, { force: true });
    const done = `[RETURN-PREPAY] ${requestId} ${salesChannel}:${externalOrderId} ${returnId} 완료 → 재수집 ${outcome}`;
    if (outcome === 'channel_inactive' || outcome === 'not_found') {
      // Medusa 는 선환불됐는데 core 로 돌아가는 사실이 없다
      this.logger.warn(done);
    } else {
      this.logger.log(done);
    }
  }

  private async prepay(command: PrepayChannelReturnPayload): Promise<ReturnPrepayFailure | undefined> {
    const outcome = await this.medusaClient.prepayReturn(command.externalOrderId, command.returnId, {
      requestId: command.requestId,
      ...(command.amount !== undefined ? { amount: command.amount } : {}),
      refundMode: command.refundMode,
      memo: command.memo,
    });
    switch (outcome.kind) {
      case 'prepaid':
        return undefined;
      case 'rejected':
        // core 가 이 문자열 그대로 읽는다 — `return_prepay_rejected:return_already_settled` 는 선환불을 superseded 로 닫는다
        return { retryable: false, failureCode: `return_prepay_rejected:${outcome.reason}`, message: outcome.message };
      case 'refund_refused':
        return { retryable: false, failureCode: outcome.failureCode, message: outcome.message };
      case 'refund_pending':
        return { retryable: true, failureCode: 'refund_pending', message: outcome.message };
      case 'not_found':
        return { retryable: false, failureCode: 'not_found', message: outcome.message };
      case 'transient':
        return { retryable: true, failureCode: outcome.failureCode, message: outcome.message };
      default: {
        // 새 결과 종류를 빠뜨리면 성공(undefined)으로 읽혀 사실도 재시도도 없이 넘어간다 — 컴파일에서 막는다
        const unhandled: never = outcome;
        throw new Error(`처리하지 않은 Medusa 반품 선환불 결과: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private async fail(
    command: PrepayChannelReturnPayload,
    deliveryId: string,
    failure: ReturnPrepayFailure,
  ): Promise<void> {
    const { requestId, salesChannel, externalOrderId, returnId } = command;
    this.logger.warn(
      `[RETURN-PREPAY] ${requestId} ${salesChannel}:${externalOrderId} ${returnId} 선환불 실패 ${failure.failureCode}` +
        ` (retryable=${failure.retryable}): ${failure.message}`,
    );
    await this.repository.recordReturnPrepayFailure(
      {
        requestId,
        salesChannel,
        externalOrderId,
        returnId,
        retryable: failure.retryable,
        failureCode: failure.failureCode,
        message: failure.message,
        at: new Date().toISOString(),
      },
      deliveryId,
    );
  }
}
