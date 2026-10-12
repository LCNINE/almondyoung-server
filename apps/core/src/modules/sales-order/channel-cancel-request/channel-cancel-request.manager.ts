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
  ChannelOrderSettlementFailedPayload,
  channelOrderPartitionKey,
} from '@packages/event-contracts/streams';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { SETTLEMENT_REISSUE_GRACE_MS, SETTLE_DELAYED_AFTER_MS } from '../../fulfillment/order-progress/order-progress.thresholds';
import { SalesOrdersService } from '../services/sales-orders.service';
import { channelCancelRoute, sellerCenterMessage } from './channel-cancel-route';
import { ChannelCancelRequestReader } from './channel-cancel-request.reader';
import {
  CHANNEL_CANCEL_REQUEST_REASON,
  CancelRequestLine,
  CancelRequestMetadata,
  CancelRequestView,
  CancelRequester,
  isReissuable,
  readCancelRequestMetadata,
  settlementPhase,
  toCancelRequestView,
} from './channel-cancel-request.types';

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

export type SettlementFailedFact = Pick<ChannelOrderSettlementFailedPayload, 'requestId' | 'retryable' | 'failureCode' | 'message' | 'at'>;

/** 확정이 취소할 수 있는 박스 — 아직 떠나지 않은 상자(취소 코드가 빼는 대상과 같다) */
const OPEN_SHIPMENT_STATUSES = ['draft', 'planned', 'recovery_required'] as const;

/**
 * 채널 주문 취소 요청 (#1016 35번, ADR-0044). core 는 요청 순간 «물리 취소»를 확정한다 — 출고를 막을 수 있으면 박스·출고지시·예약을 그 자리에서
 * 취소하고, 요청 행을 정산 중(settling)으로 남긴 뒤 `CancelChannelOrder` 를 낸다. 돈의 정산은 채널이 하고(사실·수집으로 돌아온다),
 * 막히면 리컨실러·운영자가 다시 부른다. 여기는 wallet 을 부르지 않는다.
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
      // 같은 키는 닫힌 요청이어도 그 행이다(재전송). 다른 키의 동시 요청은 판매주문 잠금으로 줄을 서고,
      // 뒤의 것은 앞이 확정한 뒤의 주문으로 판정한다(전체 뒤면 «이미 취소된 주문», 부분 뒤면 남은 몫).
      const replay = await this.reader.findBySourceKey(so.id, input.sourceKey, trx);
      if (replay) return toCancelRequestView(replay);

      const route = channelCancelRoute(so.salesChannel);
      if (route === 'seller_center') throw new BadRequestError(sellerCenterMessage(so.salesChannel));
      if (route === 'core') throw new Error(`Sales channel ${so.salesChannel} does not take cancel commands`);
      if (so.status === 'cancelled') throw new BadRequestError('이미 취소된 주문입니다.');
      if (so.status === 'timeout') throw new BadRequestError('타임아웃된 주문은 취소할 수 없습니다.');

      // 확정은 박스·출고지시를 취소한다 — 송장 발급(같은 박스 행 FOR UPDATE)·배치 시작과 직렬화한다.
      // 확정(cancel)이 출고 불변식의 FOI → 박스 순서로 잠그므로 FOI 를 박스보다 먼저 잡는다 — 배치 시작(FOI → 박스)과 순서가 뒤집히면 교착(40P01).
      await this.lockFulfillmentOrderItems(so.id, trx);
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
      const at = requestedAt.toISOString();

      // 확정(스펙 §7.3, ADR-0044) — 계획이 받은 범위를 지금 적용한다. 거절이면 던져 요청 전체가 롤백된다(행·명령 없음).
      // 같은 취소가 수집으로 다시 와도(`OrderCancelled`) cancel() 은 이미 전체 취소된 주문에 아무것도 하지 않는다.
      await this.salesOrders.cancel(
        so.id,
        {
          ...(scope === 'partial'
            ? {
                lines: plan.lines.map((line) => ({ salesOrderLineId: line.salesOrderLineId, quantity: line.quantity })),
              }
            : {}),
          cancelledBy: cancelledByOf(input.requester),
          reasonCode: input.reasonCode ?? CHANNEL_CANCEL_REQUEST_REASON,
          ...(input.reasonDetail ? { reasonDetail: input.reasonDetail } : {}),
          occurredAt: at,
          metadata: { sourceEventId: `cancel-request:${id}` },
        },
        trx,
      );

      const command: CancelChannelOrderPayload = {
        requestId: id,
        salesChannel: so.salesChannel,
        externalOrderId: so.channelOrderId,
        scope,
        ...(scope === 'partial' ? { lines: channelLines } : {}),
        ...(input.alreadyRefundedAmount !== undefined ? { alreadyRefundedAmount: input.alreadyRefundedAmount } : {}),
        refundMode: 'auto',
        ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
        requestedBy: input.requester.kind,
        requestedAt: at,
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
          appliedAt: at,
          command,
        },
        settlement: { state: 'in_progress', mode: 'auto', since: at },
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
          status: 'settling',
          occurredAt: requestedAt,
          // 확정 시각의 정본(D13) — 판정 SQL·뷰가 이 칸으로 30분·3영업일을 잰다
          createdAt: requestedAt,
        })
        .returning();
      await this.enqueue(command, `cancel-request:${id}`, trx);
      this.logger.log(`[CancelRequest] ${id} ${scope} confirmed so=${so.id} by=${metadata.request.requestedBy}`);
      return toCancelRequestView(row, requestedAt);
    }, tx);
  }

  /**
   * 정산 실패 사실(#1016 36번 재설계 §7.3). 정산 중(settling) 행만 읽는다 — 끝난 요청에 늦게 온 사실은 버린다.
   * 같은 requestId 의 사실은 순서 없이 여러 번 온다(리컨실러 재발행): 지난 시도(since 이전)·더 이른 사실은 버린다(D2).
   */
  async recordSettlementFailure(fact: SettlementFailedFact, tx?: DbTx): Promise<void> {
    await this.db.run(async (trx) => {
      const row = await this.reader.findById(fact.requestId, trx, { lock: true });
      if (!row || row.status !== 'settling') {
        this.logger.log(`[CancelRequest] settlement failure ignored: ${fact.requestId} is ${row?.status ?? 'unknown'}`);
        return;
      }
      const meta = readCancelRequestMetadata(row.metadata);
      const settlement = meta.settlement;
      if (!settlement) throw new Error(`Settling request ${row.id} has no settlement`);
      const at = Date.parse(fact.at);
      if (at < Date.parse(settlement.since)) return;
      if (settlement.lastFailure && at <= Date.parse(settlement.lastFailure.at)) return;
      const next: CancelRequestMetadata = {
        ...meta,
        settlement: {
          ...settlement,
          state: fact.retryable ? 'in_progress' : 'refused',
          lastFailure: { code: fact.failureCode, message: fact.message, retryable: fact.retryable, at: fact.at },
        },
      };
      await this.write(row.id, 'settling', next, trx);
      this.logger.warn(`[CancelRequest] ${row.id} settlement failed ${fact.failureCode} retryable=${fact.retryable}`);
    }, tx);
  }

  /** [다시 시도] — 환불 지연·거절인 정산을 같은 requestId·같은 방식으로 다시 낸다(스펙 §7.3) */
  async retrySettlement(salesOrderId: string, requestId: string, tx?: DbTx): Promise<CancelRequestView> {
    return this.restartSettlement(salesOrderId, requestId, 'retry', tx);
  }

  /** [계좌 송금으로 환불] — 같은 requestId 를 refundMode manual 로 다시 낸다. wallet 이 PG 없이 송금 대기 행을 만든다(스펙 §6.3) */
  async switchToManualRefund(salesOrderId: string, requestId: string, tx?: DbTx): Promise<CancelRequestView> {
    return this.restartSettlement(salesOrderId, requestId, 'manual', tx);
  }

  private async restartSettlement(
    salesOrderId: string,
    requestId: string,
    kind: 'retry' | 'manual',
    tx?: DbTx,
  ): Promise<CancelRequestView> {
    return this.db.run(async (trx) => {
      await this.lockSalesOrder(salesOrderId, trx);
      const row = await this.reader.findById(requestId, trx, { lock: true });
      if (!row || row.salesOrderId !== salesOrderId) throw new NotFoundError(`취소 요청을 찾을 수 없습니다: ${requestId}`);
      if (row.status !== 'settling') throw new ConflictError('정산 중인 취소 요청이 아닙니다.');
      const meta = readCancelRequestMetadata(row.metadata);
      const settlement = meta.settlement;
      if (!settlement) throw new Error(`Settling request ${row.id} has no settlement`);
      const now = new Date();
      // 막 보낸 명령이 아직 돌고 있다 — 겹치면 같은 주문에 정산이 둘 돈다(D8)
      if (settlementPhase(settlement, row.createdAt, now) === 'in_progress') {
        throw new ConflictError(
          `정산이 진행 중입니다. 확정 뒤 ${SETTLE_DELAYED_AFTER_MS / 60_000}분이 지나도 끝나지 않으면 다시 시도할 수 있습니다.`,
        );
      }
      // 같은 requestId 의 명령은 Medusa 에서 멱등이다 — 이 유예는 더블클릭·겹침 소음을 막는다. 거절(refused)은 늘 조치할 수 있다.
      if (settlement.state === 'in_progress' && now.getTime() - Date.parse(settlement.since) < SETTLEMENT_REISSUE_GRACE_MS) {
        throw new ConflictError(`방금 정산을 다시 시작했습니다. ${SETTLEMENT_REISSUE_GRACE_MS / 1000}초 뒤에 다시 시도할 수 있습니다.`);
      }
      if (kind === 'manual' && settlement.mode === 'manual') throw new ConflictError('이미 계좌 송금으로 환불하고 있습니다.');
      const mode = kind === 'manual' ? 'manual' : settlement.mode;
      const next: CancelRequestMetadata = {
        ...meta,
        settlement: { ...settlement, state: 'in_progress', mode, since: now.toISOString() },
      };
      await this.enqueue({ ...meta.request.command, refundMode: mode }, `cancel-request:${row.id}:${kind}:${now.getTime()}`, trx);
      await this.write(row.id, 'settling', next, trx);
      this.logger.log(`[CancelRequest] ${row.id} settlement restarted (${kind}, ${mode})`);
      return toCancelRequestView({ ...row, metadata: next }, now);
    }, tx);
  }

  /** 리컨실러 36번의 지문 — 다시 낼 수 있는 정산(거절 아님)의 id·방식·시작 시각. 운영자 조치가 since 를 바꾸면 리셋된다(판정 4) */
  async settlementFingerprint(salesOrderId: string, tx?: DbTx): Promise<string> {
    return this.db.run(async (trx) => {
      const rows = await this.reader.findSettling(salesOrderId, trx);
      return rows
        .flatMap((row) => {
          const s = readCancelRequestMetadata(row.metadata).settlement;
          return s && s.state === 'in_progress' ? [`${row.id}:${s.mode}:${s.since}`] : [];
        })
        .join(',');
    }, tx);
  }

  async hasSettlementToReissue(salesOrderId: string, now: Date, tx?: DbTx): Promise<boolean> {
    return this.db.run(async (trx) => {
      const rows = await this.reader.findSettling(salesOrderId, trx);
      return rows.some((row) => {
        const s = readCancelRequestMetadata(row.metadata).settlement;
        return s !== undefined && isReissuable(s, now);
      });
    }, tx);
  }

  /** 같은 requestId·같은 방식으로 명령을 다시 낸다(멱등 — 스펙 §6.1·§10). since 는 그대로 — 시도 횟수는 리컨실러 상태가 센다(스펙 §7.3) */
  async reissueSettlements(salesOrderId: string, now: Date, tx?: DbTx): Promise<number> {
    return this.db.run(async (trx) => {
      let count = 0;
      for (const row of await this.reader.findSettling(salesOrderId, trx, { lock: true })) {
        const meta = readCancelRequestMetadata(row.metadata);
        const settlement = meta.settlement;
        if (!settlement || !isReissuable(settlement, now)) continue;
        await this.enqueue(
          { ...meta.request.command, refundMode: settlement.mode },
          `cancel-request:${row.id}:reconcile:${now.getTime()}`,
          trx,
        );
        // updated_at 을 밀어 투영이 다시 판정하게 한다
        await this.write(row.id, 'settling', meta, trx);
        count++;
      }
      return count;
    }, tx);
  }

  private async write(id: string, status: 'settling', metadata: CancelRequestMetadata, trx: DbTx): Promise<void> {
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

  /** 이 주문의 FOI 행 — 정본 잠금 순서(FOI → 박스 → 라인 → 예약)의 첫 칸, id 순 */
  private async lockFulfillmentOrderItems(salesOrderId: string, trx: DbTx): Promise<void> {
    await trx
      .select({ id: wmsTables.fulfillmentOrderItems.id })
      .from(wmsTables.fulfillmentOrderItems)
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId))
      .orderBy(asc(wmsTables.fulfillmentOrderItems.id))
      .for('update', { of: wmsTables.fulfillmentOrderItems });
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

/** 취소 기록의 cancelled_by — 누가 취소를 확정했나 */
function cancelledByOf(requester: CancelRequester): string {
  switch (requester.kind) {
    case 'operator':
      return 'admin';
    case 'customer':
      return 'customer';
    case 'wallet-refund-approval':
      return 'wallet';
  }
}
