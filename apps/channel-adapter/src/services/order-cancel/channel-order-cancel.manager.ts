// apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.ts
import { Injectable, Logger } from '@nestjs/common';
import type { CancelChannelOrderPayload, ChannelOrderCancelRejectionCode } from '@packages/event-contracts/streams';
import { MedusaClient } from '../../adapters/medusa/medusa.client';
import { getChannelFulfillmentCapabilities } from '../channel-capabilities';
import { OrderPollerOrchestrator } from '../order-collection/order-poller.orchestrator';
import { ChannelOrderCancelRepository, type LegacyCancelFact } from './channel-order-cancel.repository';

/** 정산이 끝나지 못한 결과. `legacy` 는 오늘의 channel-adapter 가 같은 응답에 내던 옛 사실 — 옛 core(PR 5 전)가 읽는다 */
type SettlementFailure = { retryable: boolean; failureCode: string; message: string; legacy?: LegacyCancelFact };

/**
 * core 의 `CancelChannelOrder` 를 채널에 실행한다 (#1016 35번 행, ADR-0042 · 36번 재설계 스펙 §7.2).
 *
 * 정산이 끝나지 못한 모든 결과는 `ChannelOrderSettlementFailed` 로 낸다 — 영구(`retryable: false`)는 낸 뒤 정상 종료(ack),
 * 일시(`retryable: true`)는 낸 뒤 던져 Kafka 재시도(3회·1/2/4초)·DLQ 를 탄다. 일시 실패의 ack 는 core 리컨실러가 실행 모드가 되는
 * 정리 PR 에서 켠다(PR 3 판정 2) — 그 전에 ack 하면 짧은 순단마저 아무도 다시 부르지 않는다.
 * 옛 core 는 새 사실을 버리므로 오늘 내던 옛 사실(`Rejected`·`Stalled`)을 같은 트랜잭션에 함께 낸다(판정 1). 정리 PR 에서 지운다.
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
        legacy: rejected(command, 'NOT_SUPPORTED', message),
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
      return { retryable: false, failureCode: 'order_not_collected', message, legacy: rejected(command, 'ORDER_NOT_FOUND', message) };
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
        // 옛 사실을 내지 않는다 — 옛 core 는 Rejected 를 받으면 요청을 닫고 보류를 풀어 고객이 취소한 물건을 내보낸다
        return { retryable: false, failureCode: outcome.failureCode, message: outcome.message };
      case 'not_found':
        return { retryable: false, failureCode: 'not_found', message: outcome.message, legacy: rejected(command, 'ORDER_NOT_FOUND', outcome.message) };
      case 'not_cancelable':
        return { retryable: false, failureCode: outcome.failureCode, message: outcome.message, legacy: rejected(command, 'NOT_CANCELABLE', outcome.message) };
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
          legacy: rejected(command, 'NOT_CANCELABLE', outcome.message),
        };
      case 'external_refund':
        return {
          retryable: false,
          failureCode: outcome.reason,
          message: outcome.message,
          legacy: rejected(command, 'EXTERNAL_REFUND_UNRESOLVED', outcome.message, outcome.unresolvedAmount),
        };
      case 'refund_refused':
        // 수정이 확정된 뒤의 거절이면 옛 core 에 «수정됨 · 환불 미완»을 알린다(PR 2 전엔 같은 상황이 502 + Stalled 였다)
        return {
          retryable: false,
          failureCode: outcome.failureCode,
          message: outcome.message,
          ...(outcome.edited ? { legacy: stalled(command, outcome.message) } : {}),
        };
      case 'refund_pending':
        return { retryable: true, failureCode: 'refund_pending', message: outcome.message, legacy: stalled(command, outcome.message) };
      case 'not_cancelable':
        // 옛 adapter 는 이 400 을 던졌다(옛 사실 없음). 옛 Rejected 를 새로 내면 수정 전 주문의 보류가 풀린다
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
      failure.legacy,
    );
    if (failure.retryable) {
      // 정리 PR(리컨실러 실행 모드)까지 던져 Kafka 재시도를 탄다 — 사실은 이미 적재됐다(판정 2)
      throw new Error(`채널 정산 일시 실패(${requestId}) ${failure.failureCode}: ${failure.message}`);
    }
  }
}

function rejected(
  command: CancelChannelOrderPayload,
  reasonCode: ChannelOrderCancelRejectionCode,
  message: string,
  unresolvedRefundAmount?: number,
): LegacyCancelFact {
  const { requestId, salesChannel, externalOrderId } = command;
  return {
    eventType: 'ChannelOrderCancelRejected',
    payload: {
      requestId,
      salesChannel,
      externalOrderId,
      reasonCode,
      message,
      ...(unresolvedRefundAmount !== undefined ? { unresolvedRefundAmount } : {}),
    },
  };
}

function stalled(command: CancelChannelOrderPayload, message: string): LegacyCancelFact {
  const { requestId, salesChannel, externalOrderId } = command;
  return { eventType: 'ChannelOrderCancelStalled', payload: { requestId, salesChannel, externalOrderId, stage: 'edited', message } };
}
