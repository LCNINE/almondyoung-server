// apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.ts
import { Injectable, Logger } from '@nestjs/common';
import type { CancelChannelOrderPayload } from '@packages/event-contracts/streams';
import { MedusaClient } from '../../adapters/medusa/medusa.client';
import { getChannelFulfillmentCapabilities } from '../channel-capabilities';
import { OrderPollerOrchestrator } from '../order-collection/order-poller.orchestrator';
import { ChannelOrderCancelRepository } from './channel-order-cancel.repository';

/** 정산이 끝나지 못한 결과 */
type SettlementFailure = { retryable: boolean; failureCode: string; message: string };

/**
 * core 의 `CancelChannelOrder` 를 채널에 실행한다 (#1016 35번 행, ADR-0042 · 36번 재설계 스펙 §7.2).
 *
 * 정산이 끝나지 못한 모든 결과는 `ChannelOrderSettlementFailed` 로 낸 뒤 명령을 ack 한다 — Kafka 재시도·DLQ 에 기대지 않는다(스펙 S7).
 * 다시 부르는 곳은 core 리컨실러 «정산 재시도»(#36) 하나다. 사실을 못 낸 경우(아웃박스 쓰기 실패)만 던져 재배달을 탄다.
 * 채널 호출이 멱등이라 다시 해도 안전하다: 전체는 «이미 취소됨»과 장부 맞추기, 부분은 Medusa 가 같은 requestId 의 진행 단계부터 이어 간다.
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

  /** `deliveryId` 는 명령 봉투의 messageId — 사실의 멱등 키에 쓴다(같은 전달의 재전달은 한 번, 재발행은 새로). */
  async execute(command: CancelChannelOrderPayload, deliveryId: string): Promise<void> {
    const { requestId, salesChannel, externalOrderId } = command;
    // 실행기가 Medusa 하나뿐이라 채널 이름을 함께 본다 — 다른 채널이 능력을 켜면 여기에 실행기를 더해야 하고, 그 전엔 거절한다.
    // execute 안에 두는 이유: 이 검사가 salesChannel 을 'medusa' 로 좁혀 아래 재수집에 넘긴다
    if (salesChannel !== 'medusa' || !getChannelFulfillmentCapabilities(salesChannel)?.automatedCancellation) {
      const message = `${salesChannel} 주문은 자동 취소를 지원하지 않습니다`;
      return this.fail(command, deliveryId, {
        retryable: false,
        failureCode: 'channel_not_supported',
        message,
      });
    }
    const failure =
      (await this.checkCollected(command)) ??
      (command.scope === 'full' ? await this.settleFull(command) : await this.settlePartial(command));
    if (failure) return this.fail(command, deliveryId, failure);

    const { outcome } = await this.orderPoller.syncOrder(salesChannel, externalOrderId, { force: true });
    const done = `[CANCEL] ${requestId} ${salesChannel}:${externalOrderId} ${command.scope} 완료 → 재수집 ${outcome}`;
    if (outcome === 'channel_inactive' || outcome === 'not_found') {
      // Medusa 는 취소됐는데 core 로 돌아가는 사실이 없다 — 정체 보드가 잡을 때까지 보이지 않는다
      this.logger.warn(done);
    } else {
      this.logger.log(done);
    }
  }

  /** 우리가 수집하지 않은 주문 id 로 채널을 건드리지 않는다 */
  private async checkCollected(command: CancelChannelOrderPayload): Promise<SettlementFailure | undefined> {
    const { salesChannel, externalOrderId } = command;
    if (!(await this.repository.hasCollectedOrder(salesChannel, externalOrderId))) {
      const message = `수집된 적 없는 주문입니다: ${salesChannel}:${externalOrderId}`;
      return { retryable: false, failureCode: 'order_not_collected', message };
    }
    return undefined;
  }

  private async settleFull(command: CancelChannelOrderPayload): Promise<SettlementFailure | undefined> {
    const outcome = await this.medusaClient.cancelOrder(command.externalOrderId, { refundMode: command.refundMode ?? 'auto' });
    switch (outcome.kind) {
      case 'cancelled':
      case 'already_cancelled':
        return undefined;
      case 'refund_refused':
        return { retryable: false, failureCode: outcome.failureCode, message: outcome.message };
      case 'not_found':
        return { retryable: false, failureCode: 'not_found', message: outcome.message };
      case 'not_cancelable':
        return { retryable: false, failureCode: outcome.failureCode, message: outcome.message };
      case 'transient':
        return { retryable: true, failureCode: outcome.failureCode, message: outcome.message };
      default: {
        // 새 결과 종류를 빠뜨리면 성공(undefined)으로 읽혀 사실도 재시도도 없이 넘어간다 — 컴파일에서 막는다
        const unhandled: never = outcome;
        throw new Error(`처리하지 않은 Medusa 전체취소 결과: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private async settlePartial(command: CancelChannelOrderPayload): Promise<SettlementFailure | undefined> {
    const { requestId, externalOrderId } = command;
    if (!command.lines || command.lines.length === 0) {
      throw new Error(`부분취소 명령에 줄이 없습니다: ${requestId}`);
    }
    const outcome = await this.medusaClient.partialCancelOrder(externalOrderId, {
      requestId,
      items: command.lines.map((line) => ({ itemId: line.channelOrderItemId, quantity: line.quantity })),
      ...(command.alreadyRefundedAmount !== undefined ? { alreadyRefunded: command.alreadyRefundedAmount } : {}),
      refundMode: command.refundMode ?? 'auto',
    });
    switch (outcome.kind) {
      case 'cancelled':
        return undefined;
      case 'rejected':
        return {
          retryable: false,
          failureCode: 'partial_cancel_rejected',
          message: outcome.message,
        };
      case 'external_refund':
        return {
          retryable: false,
          failureCode: outcome.reason,
          message: outcome.message,
        };
      case 'refund_refused':
        return {
          retryable: false,
          failureCode: outcome.failureCode,
          message: outcome.message,
        };
      case 'refund_pending':
        return { retryable: true, failureCode: 'refund_pending', message: outcome.message };
      case 'not_cancelable':
        return { retryable: false, failureCode: outcome.failureCode, message: outcome.message };
      case 'transient':
        return { retryable: true, failureCode: outcome.failureCode, message: outcome.message };
      default: {
        const unhandled: never = outcome;
        throw new Error(`처리하지 않은 Medusa 부분취소 결과: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private async fail(command: CancelChannelOrderPayload, deliveryId: string, failure: SettlementFailure): Promise<void> {
    const { requestId, salesChannel, externalOrderId, scope } = command;
    this.logger.warn(
      `[CANCEL] ${requestId} ${salesChannel}:${externalOrderId} ${scope} 정산 실패 ${failure.failureCode}` +
        ` (retryable=${failure.retryable}): ${failure.message}`,
    );
    await this.repository.recordSettlementFailure(
      {
        requestId,
        salesChannel,
        externalOrderId,
        scope,
        retryable: failure.retryable,
        failureCode: failure.failureCode,
        message: failure.message,
        at: new Date().toISOString(),
      },
      deliveryId,
    );
  }
}
