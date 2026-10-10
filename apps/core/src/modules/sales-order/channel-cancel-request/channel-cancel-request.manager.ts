import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { InjectPublisher, PublisherFor } from '@app/events';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import {
  CHANNEL_ORDERS_COMMAND_STREAM,
  CancelChannelOrderPayload,
  ChannelOrderCancelRefundFailure,
  ChannelOrderCancelRejectedPayload,
  ChannelOrderCancelStalledPayload,
  channelOrderPartitionKey,
} from '@packages/event-contracts/streams';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { SalesOrdersService } from '../services/sales-orders.service';
import { channelCancelRoute, sellerCenterMessage } from './channel-cancel-route';
import { ChannelCancelRequestReader } from './channel-cancel-request.reader';
import {
  CHANNEL_CANCEL_REQUEST_REASON,
  CancelRequestLine,
  CancelRequestMetadata,
  CancelRequestView,
  CancelRequester,
  readCancelRequestMetadata,
  toCancelRequestView,
} from './channel-cancel-request.types';

/**
 * 계약 payload 에서 파생한다 — 소비자 → 서비스 → 매니저가 같은 객체를 넘기는 것에 기대지 않고 `refundFailure` 를
 * 선언된 타입으로 실어 나르기 위해서다. 중간에서 객체를 다시 짜면 REFUND_FAILED 가 갈래를 잃고 닫힐 수 있다(36번 스펙 §1.2).
 */
export type CancelRejectedFact = Pick<
  ChannelOrderCancelRejectedPayload,
  'requestId' | 'reasonCode' | 'message' | 'unresolvedRefundAmount' | 'refundFailure'
>;
export type CancelStalledFact = Pick<ChannelOrderCancelStalledPayload, 'requestId' | 'refundFailure'> &
  Partial<Pick<ChannelOrderCancelStalledPayload, 'message'>>;

export interface CancelRequestInput {
  salesOrderId: string;
  /** 없으면 전체취소 */
  lines?: Array<{ salesOrderLineId: string; quantity: number }>;
  requester: CancelRequester;
  /** 운영자·고객은 Idempotency-Key, wallet 승인은 `wallet-refund-approval:<intentId>` */
  sourceKey: string;
  reasonCode?: string;
  reasonDetail?: string;
  /** 부분취소만. 이번 취소 품목에 이미 다른 경로로 돌려준 금액(원) — 채널이 상계한다(#1016 37번) */
  alreadyRefundedAmount?: number;
}

/** 보류가 거는 박스 — 아직 떠나지 않은 상자(취소 코드가 빼는 대상과 같다) */
const OPEN_SHIPMENT_STATUSES = ['draft', 'planned', 'recovery_required'] as const;

/**
 * 채널 주문 취소 요청 (#1016 35번, ADR-0042 원칙 2). core 는 문지기다 — 판정하고, 요청을 기록해 출고를 보류한 뒤
 * `CancelChannelOrder` 를 낸다. 확정은 수집(`ChannelCancelSettler`), 거절은 `ChannelOrderCancelRejected` 로 받는다.
 * 환불은 채널이 한다 — 여기는 wallet 을 부르지 않는다.
 */
@Injectable()
export class ChannelCancelRequestManager {
  private readonly logger = new Logger(ChannelCancelRequestManager.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly db: DbService<typeof wmsSchema>,
    private readonly reader: ChannelCancelRequestReader,
    private readonly salesOrders: SalesOrdersService,
    @InjectPublisher(CHANNEL_ORDERS_COMMAND_STREAM)
    private readonly commands: PublisherFor<typeof CHANNEL_ORDERS_COMMAND_STREAM>,
  ) {}

  async request(input: CancelRequestInput, tx?: DbTx): Promise<CancelRequestView> {
    return this.db.run(async (trx) => {
      const so = await this.lockSalesOrder(input.salesOrderId, trx);
      // 같은 키는 닫힌 요청이어도 그 행이다(재전송). 그다음이 열린 요청(동시 요청은 먼저 온 것을 받는다, 스펙 §9-2).
      const replay = await this.reader.findBySourceKey(so.id, input.sourceKey, trx);
      if (replay) return toCancelRequestView(replay);
      const open = await this.reader.findOpen(so.id, trx);
      if (open) {
        // 운영자 부분취소가 열려 있는데 고객이 전체취소를 누르면 «이미 접수됨»으로 보이게 돌려주면 거짓이다 — 다른 요청이다.
        if (input.requester.kind === 'customer' && readCancelRequestMetadata(open.metadata).request.scope === 'partial') {
          throw new ConflictError('처리 중인 부분취소가 있어 지금은 전체 취소를 요청할 수 없습니다. 잠시 뒤 다시 시도해 주세요.');
        }
        return toCancelRequestView(open);
      }

      const route = channelCancelRoute(so.salesChannel);
      if (route === 'seller_center') throw new BadRequestError(sellerCenterMessage(so.salesChannel));
      if (route === 'core') throw new Error(`Sales channel ${so.salesChannel} does not take cancel commands`);
      if (so.status === 'cancelled') throw new BadRequestError('이미 취소된 주문입니다.');
      if (so.status === 'timeout') throw new BadRequestError('타임아웃된 주문은 취소할 수 없습니다.');

      // 관문(송장 발급·배치 시작·발송)도 같은 박스 행을 잠근 뒤 보류를 묻는다 — 둘이 직렬화된다(스펙 §5.3).
      await this.lockOpenShipments(so.id, trx);
      const plan = await this.salesOrders.planCancellation(so.id, input.lines, trx);
      const convertedFromFull = !input.lines && plan.hasShippedQuantity && input.requester.kind === 'operator';
      const scope: 'full' | 'partial' = convertedFromFull
        ? 'partial'
        : !input.lines || plan.leavesNothing
          ? 'full'
          : 'partial';

      // 상계는 Medusa 부분취소만 안다(ADR-0043) — 전체취소는 «캡처 − 환불»을 돌려주므로 상계할 게 없다.
      if (input.alreadyRefundedAmount !== undefined) {
        if (so.salesChannel !== 'medusa') {
          throw new BadRequestError('이미 환불한 금액은 Medusa 주문 부분취소에만 적을 수 있습니다.');
        }
        if (scope !== 'partial') throw new BadRequestError('이미 환불한 금액은 부분취소에만 적을 수 있습니다.');
      }

      const channelItems = await this.channelItemIds(so.id, trx);
      const lines: CancelRequestLine[] = plan.lines.map((line) => ({
        type: 'cancel_line',
        salesOrderLineId: line.salesOrderLineId,
        channelOrderItemId: channelItems.get(line.salesOrderLineId) ?? null,
        quantity: line.quantity,
      }));
      // 부분취소는 채널 줄 번호로 말한다 — 없는 줄이 하나라도 있으면 채널에 보낼 수 없다.
      const channelLines: Array<{ channelOrderItemId: string; quantity: number }> = [];
      for (const line of lines) {
        if (line.channelOrderItemId) {
          channelLines.push({ channelOrderItemId: line.channelOrderItemId, quantity: line.quantity });
        } else if (scope === 'partial') {
          throw new BadRequestError(
            `채널 줄 번호가 없는 줄은 채널에 취소를 요청할 수 없습니다: ${line.salesOrderLineId}`,
          );
        }
      }

      const id = randomUUID();
      const requestedAt = new Date();
      const command: CancelChannelOrderPayload = {
        requestId: id,
        salesChannel: so.salesChannel,
        externalOrderId: so.channelOrderId,
        scope,
        ...(scope === 'partial' ? { lines: channelLines } : {}),
        ...(input.alreadyRefundedAmount !== undefined ? { alreadyRefundedAmount: input.alreadyRefundedAmount } : {}),
        ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
        requestedBy: input.requester.kind,
        requestedAt: requestedAt.toISOString(),
      };
      const metadata: CancelRequestMetadata = {
        salesChannel: so.salesChannel,
        externalOrderId: so.channelOrderId,
        request: {
          kind: 'cancel',
          scope,
          requestedBy: requesterLabel(input.requester),
          sourceKey: input.sourceKey,
          ...(convertedFromFull ? { convertedFromFull: true } : {}),
          command,
        },
      };
      const [row] = await trx
        .insert(wmsTables.salesOrderAmendments)
        .values({
          id,
          salesOrderId: so.id,
          amendmentKind: 'commercial',
          reasonCode: CHANNEL_CANCEL_REQUEST_REASON,
          note: input.reasonDetail ?? null,
          deltas: lines,
          metadata,
          origin: 'operator',
          status: 'requested',
          occurredAt: requestedAt,
        })
        .returning();
      await this.enqueue(command, `cancel-request:${id}`, trx);
      this.logger.log(`[CancelRequest] ${id} ${scope} so=${so.id} by=${metadata.request.requestedBy}`);
      return toCancelRequestView(row);
    }, tx);
  }

  /** 종결 사실(스펙 §5.5). [다시 보내기]마다 같은 사실이 다시 올 수 있다 — requested 가 아니면 무시한다. */
  async reject(fact: CancelRejectedFact, tx?: DbTx): Promise<void> {
    // REFUND_FAILED 는 «취소 의사는 유효한데 자동으로 끝낼 수 없다»다. 닫으면 보류가 풀려 고객이 취소한 주문이
    // 출고로 돌아가고 보드에서도 사라진다 — 열어 둔 채 사유만 적는다(#1016 36번 스펙 §1.2·§6.1)
    if (fact.reasonCode === 'REFUND_FAILED') {
      if (fact.refundFailure) return this.markRefundFailed(fact.requestId, fact.message, fact.refundFailure, tx);
      // 갈래가 빠졌다고 닫는 길로 보내면 위의 사고가 그대로 난다 — 쓰지 않고 연 채 둔다(fail closed).
      // 보류는 남고, 정체 보드의 5분 규칙이 이 요청을 운영자에게 올린다
      this.logger.warn(`[CancelRequest] REFUND_FAILED without refundFailure kept open: ${fact.requestId}`);
      return;
    }
    await this.db.run(async (trx) => {
      const row = await this.reader.findById(fact.requestId, trx, { lock: true });
      if (!row || row.status !== 'requested') {
        this.logger.log(`[CancelRequest] rejection ignored: ${fact.requestId} is ${row?.status ?? 'unknown'}`);
        return;
      }
      const meta = readCancelRequestMetadata(row.metadata);
      const rejection = {
        reasonCode: fact.reasonCode,
        message: fact.message,
        at: new Date().toISOString(),
        ...(fact.unresolvedRefundAmount !== undefined ? { unresolvedRefundAmount: fact.unresolvedRefundAmount } : {}),
      };
      await this.write(row.id, 'rejected', { ...meta, rejection }, trx);
    }, tx);
  }

  private async markRefundFailed(
    requestId: string,
    message: string,
    refundFailure: ChannelOrderCancelRefundFailure,
    tx?: DbTx,
  ): Promise<void> {
    await this.db.run(async (trx) => {
      const row = await this.reader.findById(requestId, trx, { lock: true });
      if (!row || row.status !== 'requested') {
        this.logger.log(`[CancelRequest] refund failure ignored: ${requestId} is ${row?.status ?? 'unknown'}`);
        return;
      }
      const meta = readCancelRequestMetadata(row.metadata);
      if (meta.request.refundFailure?.walletCode === refundFailure.walletCode) return;
      await this.write(row.id, 'requested', withRefundFailure(meta, message, refundFailure), trx);
    }, tx);
  }

  /** 진행 사실 — 요청을 연 채 «수정됨 · 환불 미완»과, 분류된 거절이면 그 사유를 적는다(스펙 §7.2, 36번 §6.1). */
  async markStalled(fact: CancelStalledFact, tx?: DbTx): Promise<void> {
    await this.db.run(async (trx) => {
      const row = await this.reader.findById(fact.requestId, trx, { lock: true });
      if (!row || row.status !== 'requested') return;
      const meta = readCancelRequestMetadata(row.metadata);
      const failure = fact.refundFailure;
      // 사유 없는 사실(일시 실패)은 저장된 사유를 지우지 않는다 — 한 번의 일시 실패가 영구 거절이 풀렸다는 증거는 아니다
      const sameFailure = !failure || meta.request.refundFailure?.walletCode === failure.walletCode;
      if (meta.request.stage === 'edited' && sameFailure) return;
      const staged: CancelRequestMetadata = { ...meta, request: { ...meta.request, stage: 'edited' } };
      await this.write(
        row.id,
        'requested',
        failure ? withRefundFailure(staged, fact.message ?? '', failure) : staged,
        trx,
      );
    }, tx);
  }

  /** [다시 보내기] — 처음 낸 명령 그대로(같은 requestId). 채널 쪽이 멱등이다(전체: 이미 취소됨 = 성공, 부분: 단계 기록). */
  async resend(salesOrderId: string, tx?: DbTx): Promise<CancelRequestView> {
    return this.db.run(async (trx) => {
      await this.lockSalesOrder(salesOrderId, trx);
      const row = await this.reader.findOpen(salesOrderId, trx, { lock: true });
      if (!row) throw new ConflictError(`열린 취소 요청이 없습니다: ${salesOrderId}`);
      const meta = readCancelRequestMetadata(row.metadata);
      await this.enqueue(meta.request.command, `cancel-request:${row.id}:resend:${Date.now()}`, trx);
      // 거절 사유는 이번 시도의 결과로 다시 받는다 — 남겨 두면 새 시도 중에도 보드가 «환불 불가»로 보인다.
      // undefined 키는 jsonb 직렬화에서 빠진다
      const next: CancelRequestMetadata = { ...meta, request: { ...meta.request, refundFailure: undefined } };
      // updated_at 을 밀어 정체 보드가 다시 판정하게 한다 — 단계 진입 시각(stage_entered_at)은 그대로라 체류 시간이 이어진다.
      await this.write(row.id, 'requested', next, trx);
      return toCancelRequestView({ ...row, metadata: next });
    }, tx);
  }

  /** [요청 접기] — 보류를 푼다. 실제로는 채널이 취소했는데 수집만 늦었어도 수집이 오면 판단 10 대로 반영된다(스펙 §9-8). */
  async withdraw(salesOrderId: string, operatorId: string | null, tx?: DbTx): Promise<CancelRequestView> {
    return this.db.run(async (trx) => {
      await this.lockSalesOrder(salesOrderId, trx);
      const row = await this.reader.findOpen(salesOrderId, trx, { lock: true });
      if (!row) throw new ConflictError(`열린 취소 요청이 없습니다: ${salesOrderId}`);
      const meta = readCancelRequestMetadata(row.metadata);
      // 수정됨·미반영 — Medusa 주문은 이미 줄었다. 보류를 풀면 창고가 취소분을 보내는데 채널 어댑터는 환불을 계속 재시도한다.
      if (meta.request.stage === 'edited' && !meta.request.appliedAt) {
        throw new ConflictError('채널 주문이 이미 줄었습니다 — 다시 보내기로 환불을 마치거나 수집을 기다려 주세요.');
      }
      const next: CancelRequestMetadata = {
        ...meta,
        rejection: {
          reasonCode: 'OPERATOR_WITHDRAWN',
          message: operatorId ? `운영자가 요청을 접었습니다 (${operatorId})` : '운영자가 요청을 접었습니다',
          at: new Date().toISOString(),
        },
      };
      await this.write(row.id, 'rejected', next, trx);
      return toCancelRequestView({ ...row, status: 'rejected', metadata: next });
    }, tx);
  }

  private async write(
    id: string,
    status: 'requested' | 'rejected',
    metadata: CancelRequestMetadata,
    trx: DbTx,
  ): Promise<void> {
    await trx
      .update(wmsTables.salesOrderAmendments)
      .set({ status, metadata, updatedAt: new Date() })
      .where(eq(wmsTables.salesOrderAmendments.id, id));
  }

  protected async enqueue(command: CancelChannelOrderPayload, idempotencyKey: string, trx: DbTx): Promise<void> {
    const key = channelOrderPartitionKey(command.salesChannel, command.externalOrderId);
    await this.commands.enqueue(
      { idempotencyKey, eventType: 'CancelChannelOrder', aggregateId: key, partitionKey: key, payload: command },
      trx,
    );
  }

  private async lockSalesOrder(salesOrderId: string, trx: DbTx) {
    const [so] = await trx
      .select()
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, salesOrderId))
      .for('update');
    if (!so) throw new NotFoundError(`Sales order ${salesOrderId} not found`);
    return so;
  }

  private async lockOpenShipments(salesOrderId: string, trx: DbTx): Promise<void> {
    const shipmentIds = trx
      .select({ id: wmsTables.shipmentLines.shipmentId })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
    await trx
      .select({ id: wmsTables.shipments.id })
      .from(wmsTables.shipments)
      .where(
        and(
          inArray(wmsTables.shipments.id, shipmentIds),
          inArray(wmsTables.shipments.status, [...OPEN_SHIPMENT_STATUSES]),
        ),
      )
      .orderBy(asc(wmsTables.shipments.id))
      .for('update');
  }

  private async channelItemIds(salesOrderId: string, trx: DbTx): Promise<Map<string, string>> {
    const rows = await trx
      .select({ id: wmsTables.salesOrderLines.id, item: wmsTables.salesOrderLines.channelOrderItemId })
      .from(wmsTables.salesOrderLines)
      .where(eq(wmsTables.salesOrderLines.salesOrderId, salesOrderId));
    return new Map(rows.flatMap((row) => (row.item ? [[row.id, row.item] as const] : [])));
  }
}

function requesterLabel(requester: CancelRequester): string {
  switch (requester.kind) {
    case 'operator':
      return `admin:${requester.actorId}`;
    case 'customer':
      return `customer:${requester.customerId}`;
    case 'wallet-refund-approval':
      return `wallet-refund-approval:${requester.intentId}`;
  }
}

/** 열린 요청에 환불 거절 사유를 붙인다 — 상태는 그대로(보류 유지) */
function withRefundFailure(
  meta: CancelRequestMetadata,
  message: string,
  refundFailure: ChannelOrderCancelRefundFailure,
): CancelRequestMetadata {
  return {
    ...meta,
    request: { ...meta.request, refundFailure: { ...refundFailure, message, at: new Date().toISOString() } },
  };
}
