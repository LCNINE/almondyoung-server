import { Injectable } from '@nestjs/common';
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
import { ChannelCancelRequestService } from '../channel-cancel-request/channel-cancel-request.service';
import { ChannelCancelSettler } from '../channel-cancel-request/channel-cancel-settler';
import type { CancelRequestView } from '../channel-cancel-request/channel-cancel-request.types';
import { errorDetail, isDomainRefusal } from '../channel-order-change/channel-change-blockers';
import { cancellationCapabilityOf, sellerCenterMessage } from './channel-cancellation-capability';
import { OrderCancellationReader } from './order-cancellation.reader';
import type {
  CancelLine,
  CancellationRequest,
  ChannelCancellationReceipt,
  ChannelCancelledNotice,
  ChannelDecreaseNotice,
  DecreaseOutcome,
  WalletApprovalNotice,
} from './order-cancellation.types';

type OperatorRequest = Extract<CancellationRequest, { requester: { kind: 'operator' } }>;
type CustomerRequest = Extract<CancellationRequest, { requester: { kind: 'customer' } }>;

/** 수신 트랜잭션이 커밋된 뒤 커널이 할 일 — 와우프레스 record. 재수신이면 그 이벤트를 처음 기록한 시각을 넘긴다 */
type RecordAfterCommit = { salesOrderId: string; lines: CancelLine[] | undefined; redeliveredSince: Date | undefined };

/** savepoint 를 되돌리려고 던지는 표지. 커널 밖으로 새지 않는다 */
class Refused extends Error {
  constructor(readonly refusal: string) {
    super(refusal);
  }
}

// 요청자 종류는 requester 안에 있어 TS 가 바깥 합집합을 좁히지 못한다 — 판정을 한 곳에 둔다
function isOperatorRequest(intent: CancellationRequest): intent is OperatorRequest {
  return intent.requester.kind === 'operator';
}

/**
 * 주문 취소 커널 (K7 PR1, 스펙 §5).
 *
 * 호출자(고객·운영자 문)는 «무엇을 왜 취소하나»만 말하고, 채널 판정 → 키 → 재전송 → 줄 → 판정 → 인쇄 gate → 확정
 * 순서는 여기 한 곳이 정한다. 채널 주문은 채널이 환불하고 core 는 문지기다(ADR-0042·0044) — 커널은 Wallet 을 부르지 않는다.
 */
@Injectable()
export class OrderCancellation {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly db: DbService<typeof wmsSchema>,
    private readonly salesOrders: SalesOrdersService,
    private readonly cancelRequests: ChannelCancelRequestService,
    private readonly printOrders: PrintOrderReader,
    private readonly printCancellation: PrintOrderCancellationManager,
    private readonly settler: ChannelCancelSettler,
    private readonly reader: OrderCancellationReader,
  ) {}

  async request(intent: CancellationRequest): Promise<CancelRequestView> {
    const so = await this.db.run((tx) => this.reader.salesOrder(intent.salesOrderId, tx));
    if (!so) throw new NotFoundError('주문을 찾을 수 없습니다.');

    // 마켓은 판매자센터로 — 키가 없어도 이 안내가 먼저다
    const route = cancellationCapabilityOf(so.salesChannel).cancel;
    if (route === 'seller_center') throw new BadRequestError(sellerCenterMessage(so.salesChannel));
    if (route === 'core') throw new Error(`Sales channel ${so.salesChannel} does not take cancel commands`);

    if (!intent.sourceKey) throw new BadRequestError('Idempotency-Key header is required');
    const replay = await this.cancelRequests.findBySourceKey(so.id, intent.sourceKey);
    if (replay) return replay;

    return isOperatorRequest(intent)
      ? this.requestAsOperator(intent, intent.sourceKey)
      : this.requestAsCustomer(intent, intent.sourceKey);
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

  private async cancelForChannel(intent: ChannelCancelledNotice, tx: DbTx): Promise<void> {
    const { salesOrderId, lines } = intent;
    await this.salesOrders.cancel(
      salesOrderId,
      {
        reasonCode: intent.reasonCode,
        reasonDetail: intent.reasonDetail,
        cancelledBy: intent.cancelledBy,
        occurredAt: intent.occurredAt,
        ...(lines ? { lines } : {}),
        metadata: intent.metadata,
      },
      tx,
    );
    await this.printCancellation.holdUnsent(salesOrderId, lines, tx);
    // 우리가 낸 취소 요청을 닫는다 — 정산 중 행(확정 때 적용, 위 cancel() 은 이미 취소된 주문이라 아무것도 안 했다). 줄 단위 취소(마켓)는 요청과 무관하다.
    if (!lines) await this.settler.settleCancelled(salesOrderId, tx);
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
    // 판정은 잠그지 않고 먼저 한다 — 인쇄 취소는 되돌릴 수 없어 그 전에 부른다
    await this.cancelRequests.precheck(intent.salesOrderId, intent.lines, intent.alreadyRefundedAmount);
    // 와우프레스는 외부 HTTP 라 트랜잭션 밖에서 부른다 — 잠금을 쥔 채 기다리지 않는다
    const printed = await this.printCancellation.cancelForOrder(intent.salesOrderId, 'gate', intent.lines);
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
    return this.afterPrintCancel(printed, () =>
      this.cancelRequests.request({
        salesOrderId,
        ...(lines ? { lines } : {}),
        requester: intent.requester,
        sourceKey,
        reasonCode: intent.reasonCode,
        reasonDetail: intent.reasonDetail,
      }),
    );
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
    // 디지털 줄과 취소 계획을 한 트랜잭션에서 — 같은 스냅샷으로 판정한다
    const { digitalLineIds, plan } = await this.db.run(async (tx) => ({
      digitalLineIds: await this.reader.digitalLineIds(salesOrderId, tx),
      plan: await this.salesOrders.planCancellation(salesOrderId, undefined, tx),
    }));
    return plan.lines
      .filter((line) => !printLineIds.has(line.salesOrderLineId) && !digitalLineIds.has(line.salesOrderLineId))
      .map((line) => ({ salesOrderLineId: line.salesOrderLineId, quantity: line.quantity }));
  }
}
