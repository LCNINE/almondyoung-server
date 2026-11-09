import { Injectable, Logger } from '@nestjs/common';
import { BadRequestError, NotFoundError } from '@app/shared';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import { PrintOrderReader } from '../../print-order/services/print-order.reader';
import { isLivePrint } from '../../print-order/services/print-order-board.rules';
import {
  PrintInProductionError,
  PrintOrderCancellationManager,
  PrintPartialCancelAvailableError,
  PrintShippedError,
  type PrintCancelResult,
} from '../../print-order/services/print-order-cancellation.manager';
import { SalesOrdersService } from '../services/sales-orders.service';
import { CancellationRefundManager } from '../cancellation-refund/cancellation-refund.manager';
import { REFUND_REQUESTED, type RefundPolicy } from '../cancellation-refund/cancellation-refund.types';
import { ChannelCancelRequestService } from '../channel-cancel-request/channel-cancel-request.service';
import { ChannelCancelSettler } from '../channel-cancel-request/channel-cancel-settler';
import type { CancelRequestView } from '../channel-cancel-request/channel-cancel-request.types';
import { errorDetail, isBadRequestRefusal, isDomainRefusal } from '../channel-order-change/channel-change-blockers';
import { cancellationCapabilityOf, sellerCenterMessage } from './channel-cancellation-capability';
import { OrderCancellationReader } from './order-cancellation.reader';
import type {
  CancelLine,
  CancellationOutcome,
  CancellationRefundResult,
  CancellationRequest,
  ChannelCancellationReceipt,
  ChannelCancelledNotice,
  ChannelCustomerCancelOutcome,
  ChannelCustomerCancelRequest,
  ChannelDecreaseNotice,
  DecreaseOutcome,
  WalletApprovalNotice,
} from './order-cancellation.types';

type OperatorRequest = Extract<CancellationRequest, { requester: { kind: 'operator' } }>;
type CustomerRequest = Extract<CancellationRequest, { requester: { kind: 'customer' } }>;
type SalesOrderRow = NonNullable<Awaited<ReturnType<OrderCancellationReader['salesOrder']>>>;

/** 수신 트랜잭션이 커밋된 뒤 커널이 할 일 — 와우프레스 record. 재수신이면 그 이벤트를 처음 기록한 시각을 넘긴다 */
type RecordAfterCommit = { salesOrderId: string; lines: CancelLine[] | undefined; redeliveredSince: Date | undefined };

/** savepoint 를 되돌리려고 던지는 표지. 커널 밖으로 새지 않는다 */
class Refused extends Error {
  constructor(readonly refusal: string) {
    super(refusal);
  }
}

/** 인쇄 gate 의 «멈출 수 없다» — 제작 중·출고됨. 바빠서 못 물었다(409 재시도·503)는 거절이 아니라 던진다 */
function isPrintRefusal(error: unknown): boolean {
  return error instanceof PrintInProductionError || error instanceof PrintShippedError;
}

// 요청자 종류는 requester 안에 있어 TS 가 바깥 합집합을 좁히지 못한다 — 판정을 한 곳에 둔다
function isOperatorRequest(intent: CancellationRequest): intent is OperatorRequest {
  return intent.requester.kind === 'operator';
}

/**
 * 환불 방침은 요청자에서 정한다(N16) — 고객이 직접 취소하면 결제도 바로 취소되고, 관리자는 취소 뒤 환불을 따로 결정한다.
 * 둘은 1:1 이라 의도에 칸을 두면 늘 같은 값을 적는 칸이 된다. 효과는 core 가 돈을 쥔 주문에만 있다(스펙 §5.5)
 */
function refundPolicyOf(requester: CancellationRequest['requester']): RefundPolicy {
  return requester.kind === 'customer' ? 'immediate' : 'decide_later';
}

/** 채널 줄 취소의 목표(누적 수량)를 줄별로 — 같은 줄이 둘이면 큰 쪽이 더 나중 상태다(합하지 않는다) */
function latestTargets(lines: CancelLine[]): Map<string, number> {
  const targets = new Map<string, number>();
  for (const line of lines) {
    targets.set(line.salesOrderLineId, Math.max(targets.get(line.salesOrderLineId) ?? 0, line.quantity));
  }
  return targets;
}

/** 수집된 채널 취소를 판매주문 취소에 넘기는 칸. `lines` 가 없으면 전체취소 */
function channelCancelOptions(intent: ChannelCancelledNotice, lines: CancelLine[] | undefined) {
  return {
    reasonCode: intent.reasonCode,
    reasonDetail: intent.reasonDetail,
    cancelledBy: intent.cancelledBy,
    occurredAt: intent.occurredAt,
    ...(lines ? { lines } : {}),
    metadata: intent.metadata,
  };
}

/** 환불 효과 metadata 는 jsonb 로 남는 레코드다 — 결과에 실을 두 칸만 형을 보고 꺼낸다 */
function refundResultOf(refundStatus: string, metadata: Record<string, unknown> | undefined): CancellationRefundResult {
  const estimate = metadata?.refundEstimateAmount;
  const reason = metadata?.manualReason;
  return {
    refundStatus,
    ...(typeof estimate === 'number' ? { refundEstimateAmount: estimate } : {}),
    ...(typeof reason === 'string' ? { manualReason: reason } : {}),
  };
}

/**
 * 주문 취소 커널 (K7 PR1, 스펙 §5).
 *
 * 호출자(고객·운영자 문)는 «무엇을 왜 취소하나»만 말하고, 채널 판정 → 키 → 재전송 → 줄 → 판정 → 인쇄 gate → 확정
 * 순서는 여기 한 곳이 정한다. 채널 주문은 채널이 환불하고 core 는 문지기다(ADR-0042·0044). core 가 돈을 쥔 주문(K7 PR4)은
 * 환불 방침을 취소와 같은 트랜잭션의 환불 링크로 남기고, 실행은 결제 쪽(`CancellationRefundManager`)이 한다 — 커널은 Wallet 을 모른다.
 */
@Injectable()
export class OrderCancellation {
  private readonly logger = new Logger(OrderCancellation.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly db: DbService<typeof wmsSchema>,
    private readonly salesOrders: SalesOrdersService,
    private readonly cancelRequests: ChannelCancelRequestService,
    private readonly printOrders: PrintOrderReader,
    private readonly printCancellation: PrintOrderCancellationManager,
    private readonly settler: ChannelCancelSettler,
    private readonly reader: OrderCancellationReader,
    private readonly refunds: CancellationRefundManager,
  ) {}

  async request(intent: CancellationRequest): Promise<CancellationOutcome> {
    const so = await this.db.run((tx) => this.reader.salesOrder(intent.salesOrderId, tx));
    if (!so) throw new NotFoundError('주문을 찾을 수 없습니다.');

    // 마켓은 판매자센터로 — 키가 없어도 이 안내가 먼저다
    const route = cancellationCapabilityOf(so.salesChannel).cancel;
    if (route === 'seller_center') throw new BadRequestError(sellerCenterMessage(so.salesChannel));

    if (!intent.sourceKey) throw new BadRequestError('Idempotency-Key header is required');
    if (route === 'core') return this.requestCoreSettled(intent, so, intent.sourceKey);

    const replay = await this.cancelRequests.findBySourceKey(so.id, intent.sourceKey);
    if (replay) return { kind: 'channel_request', view: replay };

    const view = isOperatorRequest(intent)
      ? await this.requestAsOperator(intent, intent.sourceKey)
      : await this.requestAsCustomer(intent, intent.sourceKey);
    return { kind: 'channel_request', view };
  }

  /**
   * core 가 돈을 쥔 주문의 취소 요청 (K7 PR4, 스펙 §5.5, D1·D2). 판정 → 인쇄 gate → 트랜잭션[환불 방침 기록 + 취소] → 커밋 뒤
   * 즉시 환불 실행. 환불 효과는 `cancel()` 의 `walletRefund` 로 넘겨 취소와 같은 트랜잭션·같은 취소 id 의 링크가 된다 —
   * 취소가 롤백되면 링크도 없고, 커밋되면 «환불 요청»은 프로세스가 죽어도 남는다(실행이 안 됐으면 관리자 목록에 뜬다).
   */
  private async requestCoreSettled(
    intent: CancellationRequest,
    so: SalesOrderRow,
    sourceKey: string,
  ): Promise<CancellationOutcome> {
    // 문은 취소 경로(cancel === 'core')로 여기 오지만 환불 방침의 근거는 «돈을 누가 쥐나»(settlesMoney)다(스펙 §5.5).
    // 지금 표에선 둘이 늘 같이 core 라 닿지 않는다 — 표가 갈라지면 채널이 정산할 주문에 Wallet 환불을 적지 않게 결함으로 멈춘다
    const settlesMoney = cancellationCapabilityOf(so.salesChannel).settlesMoney;
    if (settlesMoney !== 'core') {
      throw new Error(
        `core-settled cancellation for SO ${so.id} on ${so.salesChannel}, but settlesMoney=${settlesMoney}`,
      );
    }
    if (isOperatorRequest(intent) && intent.alreadyRefundedAmount !== undefined) {
      throw new BadRequestError('이미 환불한 금액은 Medusa 주문 부분취소에만 적을 수 있습니다.');
    }
    // 재전송은 상태 판정보다 먼저다 — 첫 요청이 이미 취소했으면 400 이 아니라 그 결과를 돌려준다.
    // 고객 «인쇄 빼고» 줄은 다시 계산할 수 없다(첫 취소가 계획을 바꿨다) — 재전송 판정은 의도의 줄(=없음)로 한다
    const replayed = await this.salesOrders.validateCancellationReplay(so.id, {
      sourceKey,
      reasonCode: intent.reasonCode,
      reasonDetail: intent.reasonDetail,
      lines: isOperatorRequest(intent) ? intent.lines : undefined,
    });
    if (replayed) return { kind: 'replayed' };
    if (so.status === 'cancelled') throw new BadRequestError('이미 취소된 주문입니다.');
    if (so.status === 'timeout') throw new BadRequestError('타임아웃된 주문은 취소할 수 없습니다.');

    const { lines, printed } = isOperatorRequest(intent)
      ? { lines: intent.lines, printed: await this.operatorGate(intent) }
      : await this.customerGate(intent);
    const actor = isOperatorRequest(intent)
      ? { cancelledBy: 'admin', actorId: intent.requester.actorId, actorRoles: intent.actorRoles }
      : { cancelledBy: 'customer', actorId: intent.requester.customerId, actorRoles: [] };

    const effect = await this.afterPrintCancel(printed, () =>
      this.db.run(async (tx) => {
        const walletRefund = await this.refunds.effectFor(
          refundPolicyOf(intent.requester),
          so,
          lines,
          intent.reasonCode,
          tx,
        );
        await this.salesOrders.cancel(
          so.id,
          {
            reasonCode: intent.reasonCode,
            reasonDetail: intent.reasonDetail,
            ...(lines ? { lines } : {}),
            cancelledBy: actor.cancelledBy,
            fulfillmentCommandContext: {
              idempotencyKey: sourceKey,
              actorId: actor.actorId,
              actorRoles: actor.actorRoles,
            },
            walletRefund,
          },
          tx,
        );
        return walletRefund;
      }),
    );

    const scope = lines && lines.length > 0 ? 'partial' : 'full';
    if (effect.refundStatus === REFUND_REQUESTED) {
      return { kind: 'applied', scope, refund: { refundStatus: await this.executeAfterCommit(so.id) } };
    }
    // effectFor 는 늘 상태를 적는다(DTO 칸이 선택일 뿐) — 비어 있으면 «관리자가 볼 것»으로 답한다
    return { kind: 'applied', scope, refund: refundResultOf(effect.refundStatus ?? 'manual_pending', effect.metadata) };
  }

  /**
   * 커밋 뒤 즉시 환불. 취소는 이미 커밋됐으니 던지지 않는다 — 실패하면 링크가 `requested` 로 남아 관리자 목록에서 다시 실행한다(N17).
   * 실행할 게 없었으면(상자 후 취소가 대기로 끝나 아직 취소되지 않았다 등) 기록한 상태 그대로다
   */
  private async executeAfterCommit(salesOrderId: string): Promise<string> {
    try {
      return (await this.refunds.executeRequested(salesOrderId)) ?? REFUND_REQUESTED;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 스택까지 남긴다 — 취소는 이미 커밋돼 사용자에겐 성공으로 보이므로 원인을 찾을 단서는 이 로그뿐이다
      this.logger.error(
        `[OrderCancellation] refund after cancel failed for SO ${salesOrderId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      return REFUND_REQUESTED;
    }
  }

  /**
   * 무통장 환불 승인 (K7 PR2, D6·N8). 전체취소 확정과 안 보낸 인쇄 붙잡기를 커널이 연 한 트랜잭션에서 하고,
   * 커밋 뒤 와우프레스 record. 확정이 던지면(동시 승인 뒤 «이미 취소된 주문» 등) 붙잡기도 함께 롤백되고 record 는 없다.
   */
  async noticeWalletRefundApproval(intent: WalletApprovalNotice): Promise<CancelRequestView> {
    const view = await this.db.run(async (tx) => {
      // 환불은 wallet 에서 끝났고 Medusa 장부에는 환불 투영(스펙 §6.4)이 넣는다 — Medusa 취소는 환불 없이 끝난다.
      // 31번 전환을 하지 않는다: 돈이 이미 다 나갔으므로 전체취소가 맞다(계획 단계 발견 8).
      const requestView = await this.cancelRequests.request(
        {
          salesOrderId: intent.salesOrderId,
          requester: { kind: 'wallet-refund-approval', intentId: intent.intentId },
          sourceKey: `wallet-refund-approval:${intent.intentId}`,
          reasonCode: intent.reasonCode,
        },
        tx,
      );
      await this.printCancellation.holdUnsent(intent.salesOrderId, undefined, tx);
      return requestView;
    });
    // 돈은 이미 나갔다 — 승인 전 인쇄 gate 가 살아 있는 인쇄를 막았으니 record 는 경합 대비, 거절은 보드로.
    // 던지면 삼키지 않는다 — 취소는 남고 승인 결과에 실패가 뜬다(N8)
    await this.printCancellation.cancelForOrder(intent.salesOrderId, 'record');
    return view;
  }

  /**
   * 채널 취소 수신 (K7 PR2, N7). 커널이 수신 트랜잭션을 열고, 이벤트 중복 기록·줄 해석은 호출자(컨슈머)가
   * `receive` 안에서 같은 트랜잭션으로 한다 — 그 판정(새 통보 / 재수신 / 할 일 없음)을 돌려받아 취소한다.
   * 커밋 뒤 와우프레스 record 도 여기서 한다 — 호출자가 잊을 수 없다.
   */
  async receiveChannelCancellation(receive: (tx: DbTx) => Promise<ChannelCancellationReceipt | null>): Promise<void> {
    const after = await this.db.run(async (tx): Promise<RecordAfterCommit | null> => {
      const receipt = await receive(tx);
      if (!receipt) return null;
      if ('redelivered' in receipt) {
        const { salesOrderId, lines, since } = receipt.redelivered;
        return { salesOrderId, lines, redeliveredSince: since };
      }
      await this.cancelForChannel(receipt.notice, tx);
      return { salesOrderId: receipt.notice.salesOrderId, lines: receipt.notice.lines, redeliveredSince: undefined };
    });
    if (!after) return;
    // 와우프레스 호출은 트랜잭션 밖에서 한다. 이미 취소된 주문이라 막을 수 없으니 거절·장애는 보드에 남긴다.
    // 던지면 삼키지 않는다 — 컨슈머 재시도가 재수신 경로로 다시 record 한다
    await this.printCancellation.cancelForOrder(after.salesOrderId, 'record', after.lines, {
      redeliveredSince: after.redeliveredSince,
    });
  }

  /**
   * 수집된 채널 취소 (스펙 §5.4). 줄 취소의 수량은 «이번에 N개 더»가 아니라 «이 줄의 채널 누적 취소 수량»이다 —
   * 요청 순간 core 가 이미 취소했으면(마켓 고객 취소요청 문) 같은 취소가 수집으로 다시 와도 할 일이 없고, 모자라면 그 차이만 취소한다.
   * 전체취소는 모든 줄이 이미 전량 취소돼 있으면 취소하지 않는다(줄마다 따로 취소된 주문). 어느 쪽이든 요청 행은 닫는다.
   */
  private async cancelForChannel(intent: ChannelCancelledNotice, tx: DbTx): Promise<void> {
    const { salesOrderId, lines } = intent;
    const order = await this.reader.lockOrderLines(salesOrderId, tx);
    if (!order) throw new NotFoundError(`Sales order ${salesOrderId} not found`);
    const cancelled = await this.salesOrders.cancelledQuantities(
      salesOrderId,
      order.lines.map((line) => line.id),
      tx,
    );
    const alreadyCancelled = (lineId: string): number => {
      const quantity = cancelled.get(lineId);
      if (quantity === undefined) throw new Error(`Cancelled quantity is missing SalesOrder line ${lineId}`);
      return quantity;
    };
    const targets = lines ? latestTargets(lines) : undefined;
    // 전체취소면 채널은 모든 줄을 전량 취소했다 — 줄마다 남은 몫이 목표다(전체취소가 거절되면 이 줄들로 멈출 수 있는 몫만 취소한다)
    const remainder = this.remainderToCancel(
      salesOrderId,
      targets ?? new Map(order.lines.map((line) => [line.id, line.quantity])),
      alreadyCancelled,
    );
    if (remainder.length > 0) {
      await this.applyChannelCancel(intent, targets ? remainder : undefined, remainder, order.salesChannel, tx);
    } else if (!lines) {
      // 줄마다 따로 전량 취소된 주문 — 다시 취소하지 않고 상태만 맞춘다(부분취소는 판매주문 상태를 바꾸지 않는다)
      await this.salesOrders.markCancelledAfterLineCancellations(salesOrderId, tx);
    }
    await this.printCancellation.holdUnsent(salesOrderId, lines, tx);
    // 마켓 고객 취소요청 행을 채널 누적 수량으로 닫는다. 전체취소면 채널은 모든 줄을 전량 취소했다.
    // 전체취소 종결(settleCancelled)보다 먼저다 — 거기서는 부분 요청이 «덮였다»(superseded)로 닫혀 요청의 결과를 잃는다
    const channelLines = targets
      ? order.lines.flatMap((line) => {
          const target = targets.get(line.id);
          return line.channelOrderItemId && target !== undefined
            ? [{ channelOrderItemId: line.channelOrderItemId, quantity: target }]
            : [];
        })
      : order.lines.flatMap((line) =>
          line.channelOrderItemId ? [{ channelOrderItemId: line.channelOrderItemId, quantity: line.quantity }] : [],
        );
    await this.settler.settleLinesCancelled(salesOrderId, channelLines, tx);
    // 우리가 낸 취소 요청을 닫는다 — 정산 중 행은 확정 때 이미 적용됐다(위에서 취소할 게 없었거나 cancel() 이 이미 취소된 주문에 아무것도 안 했다)
    if (!lines) await this.settler.settleCancelled(salesOrderId, tx);
  }

  /** 줄마다 «목표(채널 누적) − 이미 취소». 0 이하인 줄은 뺀다 — core 가 채널보다 많이 취소했으면 갈림이라 남긴다 */
  private remainderToCancel(
    salesOrderId: string,
    targets: Map<string, number>,
    alreadyCancelled: (lineId: string) => number,
  ): CancelLine[] {
    const remainder: CancelLine[] = [];
    for (const [salesOrderLineId, target] of targets) {
      const already = alreadyCancelled(salesOrderLineId);
      if (already > target) {
        // 대사(#1016 45번)가 볼 갈림이다 — 채널을 따라 취소를 되돌리지 않는다
        this.logger.warn(
          `[OrderCancellation] SO ${salesOrderId} line ${salesOrderLineId}: core cancelled ${already}, channel says ${target}`,
        );
      }
      if (target > already) remainder.push({ salesOrderLineId, quantity: target - already });
    }
    return remainder;
  }

  /**
   * 채널 취소를 판매주문에 적용한다. `lines` 가 없으면 전체취소, `wanted` 는 줄마다 취소하려는 몫(전체취소면 줄마다 남은 몫).
   * 판매자센터가 취소를 확정하는 채널(마켓)은 core 가 거절해도 취소가 되돌아가지 않는다 — 400 거절(이미 나간 수량 등)을 던지면
   * 재시도가 이길 수 없는 DLQ 가 될 뿐이라(스펙 반목표), savepoint 를 되돌리고 줄마다 core 가 아직 취소할 수 있는 몫으로 줄여
   * 다시 취소한다 — 한 단위가 나갔다고 멈출 수 있는 나머지까지 나가지 않게. 줄일 수 없는 몫(나간 단위)만 경고로 남기고,
   * 그건 회수·반품 같은 출고 뒤 후속 효과의 몫이다. 400 이 아닌 거절(409 데이터 어긋남 등)·예외는 그대로 던진다.
   * 우리가 명령으로 취소하는 채널(Medusa)의 거절은 지금처럼 던진다.
   */
  private async applyChannelCancel(
    intent: ChannelCancelledNotice,
    lines: CancelLine[] | undefined,
    wanted: CancelLine[],
    salesChannel: string,
    tx: DbTx,
  ): Promise<void> {
    const salesOrderId = intent.salesOrderId;
    if (cancellationCapabilityOf(salesChannel).cancel !== 'seller_center') {
      await this.salesOrders.cancel(salesOrderId, channelCancelOptions(intent, lines), tx);
      return;
    }
    const first = await this.cancelInSavepoint(intent, lines, tx);
    if (!first) return;

    const cancellable = await this.salesOrders.cancellableQuantities(
      salesOrderId,
      wanted.map((line) => line.salesOrderLineId),
      tx,
    );
    const clamped: CancelLine[] = [];
    for (const line of wanted) {
      const can = cancellable.get(line.salesOrderLineId);
      if (can === undefined)
        throw new Error(`Cancellable quantity is missing SalesOrder line ${line.salesOrderLineId}`);
      const quantity = Math.min(line.quantity, can);
      if (quantity > 0) clamped.push({ salesOrderLineId: line.salesOrderLineId, quantity });
      if (line.quantity > quantity) {
        this.logger.warn(
          `[OrderCancellation] ${salesChannel} SO ${salesOrderId} line ${line.salesOrderLineId}: ` +
            `${line.quantity - quantity} of ${line.quantity} not cancellable (${errorDetail(first.refusal)})`,
        );
      }
    }
    if (clamped.length === 0) return;
    const second = await this.cancelInSavepoint(intent, clamped, tx);
    if (second) {
      this.logger.warn(
        `[OrderCancellation] ${salesChannel} cancel for SO ${salesOrderId} not applied: ${errorDetail(second.refusal)}`,
      );
    }
  }

  /** savepoint 안에서 취소한다. 400 거절이면 savepoint 를 되돌리고 그 거절을 돌려준다. 그 밖은 던진다 */
  private async cancelInSavepoint(
    intent: ChannelCancelledNotice,
    lines: CancelLine[] | undefined,
    tx: DbTx,
  ): Promise<{ refusal: unknown } | null> {
    try {
      await tx.transaction((sp) =>
        this.salesOrders.cancel(intent.salesOrderId, channelCancelOptions(intent, lines), sp),
      );
      return null;
    } catch (error) {
      if (!isBadRequestRefusal(error)) throw error;
      return { refusal: error };
    }
  }

  /**
   * 마켓 고객 취소요청 (스펙 §5.2). 마켓이 «고객이 이 줄들을 취소해 달라»고 알렸다 — 멈출 수 있으면 요청 순간 core 가 그 줄·수량을
   * 취소하고, 채널 취소 요청 행(정산 중)과 승인 명령(`CancelChannelOrder.answers`)을 남긴다. 그 뒤는 기존 정산 수명주기다.
   * 판정은 운영자 문과 같은 순서다: 사전검사 → 인쇄 gate(물을 고객이 없어 «인쇄 빼고»를 묻지 않고, 거절은 인쇄 보드에 남긴다) → 확정.
   * 요청 수량 전부를 멈출 수 없으면 아무것도 하지 않는다(일부만 취소하고 승인하는 갈래는 없다) — 행·명령 없이 경고만 남기고,
   * 판매자센터 몫이다(네이버는 우리 발송처리가 곧 거부다). 400 거절·인쇄 거절만 «못 멈춤»이고 409 같은 데이터 어긋남은 던진다.
   */
  async receiveChannelCustomerRequest(req: ChannelCustomerCancelRequest): Promise<ChannelCustomerCancelOutcome> {
    const order = await this.db.run((tx) => this.reader.channelOrder(req.salesChannel, req.externalOrderId, tx));
    if (!order) {
      // 컷오버 전 주문(셀메이트 몫) 등 — 실패가 아니다(스펙 §5.2)
      this.logger.log(
        `[OrderCancellation] ${req.salesChannel} cancel request ${req.channelRequestKey}: order ${req.externalOrderId} not in core, ignored`,
      );
      return { kind: 'order_unknown' };
    }
    if (!cancellationCapabilityOf(order.salesChannel).answersCustomerCancelRequest) {
      throw new Error(`Sales channel ${order.salesChannel} does not answer customer cancel requests`);
    }
    const sourceKey = `channel-request:${req.channelRequestKey}`;
    const replay = await this.cancelRequests.findBySourceKey(order.id, sourceKey);
    if (replay) return { kind: 'replayed', view: replay };

    const lineIdByItem = new Map(
      order.lines.flatMap((line) => (line.channelOrderItemId ? [[line.channelOrderItemId, line.id] as const] : [])),
    );
    const lines: CancelLine[] = [];
    const unknownItems: string[] = [];
    for (const item of req.items) {
      const salesOrderLineId = lineIdByItem.get(item.channelOrderItemId);
      if (salesOrderLineId) lines.push({ salesOrderLineId, quantity: item.quantity });
      else unknownItems.push(item.channelOrderItemId);
    }
    if (unknownItems.length > 0) {
      return this.notStoppable(req, order.id, `channel lines not in the sales order: ${unknownItems.join(', ')}`);
    }

    try {
      await this.cancelRequests.precheck(order.id, lines);
      const printed = await this.printCancellation.cancelForOrder(order.id, 'gate', lines);
      const view = await this.afterPrintCancel(printed, () =>
        this.db.run((tx) =>
          this.cancelRequests.request(
            {
              salesOrderId: order.id,
              lines,
              requester: {
                kind: 'channel-customer',
                channelRequestRef: req.channelRequestRef,
                channelRequestKey: req.channelRequestKey,
                needsApproval: req.needsApproval,
              },
              sourceKey,
            },
            tx,
          ),
        ),
      );
      return { kind: 'stopped', view };
    } catch (error) {
      if (!isBadRequestRefusal(error) && !isPrintRefusal(error)) throw error;
      return this.notStoppable(req, order.id, errorDetail(error));
    }
  }

  private notStoppable(
    req: ChannelCustomerCancelRequest,
    salesOrderId: string,
    reason: string,
  ): ChannelCustomerCancelOutcome {
    this.logger.warn(
      `[OrderCancellation] ${req.salesChannel} cancel request ${req.channelRequestKey} on SO ${salesOrderId} not stoppable — seller center: ${reason}`,
    );
    return { kind: 'not_stoppable', reason };
  }

  /**
   * 채널 수량 감소 (스펙 §7.2, D7). 수신 트랜잭션(변경 기록과 한 묶음) 안에서만 부른다.
   * 어느 길로 끝나든 감소가 대기로 남으면 운영자 몫이다 — 그사이 원래 수량으로 주문되지 않게, 거절이 되돌리는
   * savepoint 밖에서 그 줄의 안 보낸 인쇄를 먼저 붙잡는다. 채널 변경 규칙이 이미 대기로 정했으면(`attempt: false`) 붙잡기만 한다.
   * 시도는 기존 취소 그대로 — 그 자리에서 끝나지 않으면(박스 대기, 출고분 회수 이관) savepoint 를 되돌린다
   * (R1: 새 대기·회수를 만들지 않는다). 도메인 거절이 아닌 예외(교착·버그)는 그대로 던져 바깥 트랜잭션을 되돌린다(스펙 §11).
   */
  async noticeChannelDecrease(intent: ChannelDecreaseNotice, tx: DbTx): Promise<DecreaseOutcome> {
    await this.printCancellation.holdForDecrease(intent.line.salesOrderLineId, tx);
    if (!intent.attempt) return { applied: false, refusal: 'deferred by the channel change rule' };
    try {
      await tx.transaction(async (sp) => {
        // 판매주문 취소는 외주 줄을 그냥 통과시킨다. 인쇄 줄을 줄이면 와우프레스는 원래 수량대로 주문·제작된다
        if (await this.reader.hasActivePrintOrder(intent.line.salesOrderLineId, sp)) {
          throw new Refused('print order on this line — decide on WowPress');
        }
        try {
          await this.salesOrders.cancel(
            intent.salesOrderId,
            {
              lines: [intent.line],
              cancelledBy: 'channel',
              reasonCode: intent.reasonCode,
              occurredAt: intent.occurredAt,
              // walletRefund 를 넘기지 않는다 — 채널 변경의 환불은 채널이 한다(스펙 R6).
              metadata: { sourceEventId: intent.sourceEventId },
            },
            sp,
          );
        } catch (error) {
          if (!isDomainRefusal(error)) throw error;
          throw new Refused(errorDetail(error));
        }
        const followUp = await this.reader.cancellationNeedsFollowUp(intent.salesOrderId, intent.sourceEventId, sp);
        if (followUp) throw new Refused(followUp);
      });
      return { applied: true };
    } catch (error) {
      if (error instanceof Refused) return { applied: false, refusal: error.refusal };
      throw error;
    }
  }

  private async requestAsOperator(intent: OperatorRequest, sourceKey: string): Promise<CancelRequestView> {
    const printed = await this.operatorGate(intent);
    return this.afterPrintCancel(printed, () =>
      this.cancelRequests.request({
        salesOrderId: intent.salesOrderId,
        ...(intent.lines ? { lines: intent.lines } : {}),
        requester: intent.requester,
        sourceKey,
        reasonCode: intent.reasonCode,
        reasonDetail: intent.reasonDetail,
        ...(intent.alreadyRefundedAmount !== undefined ? { alreadyRefundedAmount: intent.alreadyRefundedAmount } : {}),
      }),
    );
  }

  private async requestAsCustomer(intent: CustomerRequest, sourceKey: string): Promise<CancelRequestView> {
    const { lines, printed } = await this.customerGate(intent);
    return this.afterPrintCancel(printed, () =>
      this.cancelRequests.request({
        salesOrderId: intent.salesOrderId,
        ...(lines ? { lines } : {}),
        requester: intent.requester,
        sourceKey,
        reasonCode: intent.reasonCode,
        reasonDetail: intent.reasonDetail,
      }),
    );
  }

  /** 운영자 요청의 판정 → 인쇄 gate. 채널 경로와 core 정산 경로가 함께 쓴다 */
  private async operatorGate(intent: OperatorRequest): Promise<PrintCancelResult> {
    // 판정은 잠그지 않고 먼저 한다 — 인쇄 취소는 되돌릴 수 없어 그 전에 부른다
    await this.cancelRequests.precheck(intent.salesOrderId, intent.lines, intent.alreadyRefundedAmount);
    // 와우프레스는 외부 HTTP 라 트랜잭션 밖에서 부른다 — 잠금을 쥔 채 기다리지 않는다
    return this.printCancellation.cancelForOrder(intent.salesOrderId, 'gate', intent.lines);
  }

  /**
   * 고객 요청의 줄 → 판정 → 인쇄 gate. 채널 경로와 core 정산 경로가 함께 쓴다.
   * 고객 요청이면 와우프레스 거절을 보드로 넘기지 않고 고객에게 바로 알리고(`keepOnRefusal`), 인쇄 때문에 전체취소를 못 하는데
   * 인쇄 외 줄이 남으면 «인쇄 빼고 취소»를 묻는다(스펙 §5.3)
   */
  private async customerGate(
    intent: CustomerRequest,
  ): Promise<{ lines: CancelLine[] | undefined; printed: PrintCancelResult }> {
    const salesOrderId = intent.salesOrderId;
    // 고객이 인쇄 상품을 빼고 나머지만 취소하겠다고 동의한 두 번째 요청이다
    const lines = intent.excludePrint ? await this.linesWithoutPrint(salesOrderId) : undefined;
    if (lines?.length === 0) throw new PrintInProductionError();
    await this.cancelRequests.precheck(salesOrderId, lines);
    const printed = await this.printCancellation
      .cancelForOrder(salesOrderId, 'gate', lines, { keepOnRefusal: true })
      .catch(async (error: unknown) => {
        const locked = error instanceof PrintInProductionError || error instanceof PrintShippedError;
        if (locked && !lines && (await this.linesWithoutPrint(salesOrderId)).length > 0) {
          throw new PrintPartialCancelAvailableError();
        }
        throw error;
      });
    return { lines, printed };
  }

  // 인쇄를 이미 멈춘 뒤 판매주문 취소가 실패하면 인쇄 행에 남겨 운영자가 찾게 한다
  private async afterPrintCancel<T>(printed: PrintCancelResult, salesCancel: () => Promise<T>): Promise<T> {
    try {
      return await salesCancel();
    } catch (error) {
      await this.printCancellation.noteSalesCancelFailed(printed, error);
      throw error;
    }
  }

  /**
   * 고객이 인쇄를 빼고 취소할 줄. 전체 취소 계획에서 취소되지 않은 인쇄 줄(실패·미지원도 재전송될 수 있다)과
   * 디지털 줄을 뺀다 — 부분 취소는 디지털 이용권을 회수하지 않으므로 디지털은 전체 취소로만 돌려준다
   */
  private async linesWithoutPrint(salesOrderId: string): Promise<CancelLine[]> {
    const printLineIds = new Set(
      (await this.printOrders.forSalesOrder(salesOrderId)).filter(isLivePrint).map((r) => r.salesOrderLineId),
    );
    // 디지털 줄과 취소 계획은 한 트랜잭션에서 읽는다(READ COMMITTED 라 한 스냅샷은 아니고, 인쇄 줄은 그 밖에서 읽었다)
    const { digitalLineIds, plan } = await this.db.run(async (tx) => ({
      digitalLineIds: await this.reader.digitalLineIds(salesOrderId, tx),
      plan: await this.salesOrders.planCancellation(salesOrderId, undefined, tx),
    }));
    return plan.lines
      .filter((line) => !printLineIds.has(line.salesOrderLineId) && !digitalLineIds.has(line.salesOrderLineId))
      .map((line) => ({ salesOrderLineId: line.salesOrderLineId, quantity: line.quantity }));
  }
}
