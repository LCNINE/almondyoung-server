import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { InjectPublisher, PublisherFor } from '@app/events';
import { BadRequestError, NotFoundError } from '@app/shared';
import {
  CHANNEL_ORDERS_COMMAND_STREAM,
  CancelChannelOrderPayload,
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
      if (open) return toCancelRequestView(open);

      const route = channelCancelRoute(so.salesChannel);
      if (route === 'seller_center') throw new BadRequestError(sellerCenterMessage(so.salesChannel));
      if (route === 'core') throw new Error(`Sales channel ${so.salesChannel} does not take cancel commands`);
      if (so.status === 'cancelled') throw new BadRequestError('이미 취소된 주문입니다.');
      if (so.status === 'timeout') throw new BadRequestError('타임아웃된 주문은 취소할 수 없습니다.');

      // 관문(송장 발급·배치 시작·발송)도 같은 박스 행을 잠근 뒤 보류를 묻는다 — 둘이 직렬화된다(스펙 §5.3).
      await this.lockOpenShipments(so.id, trx);
      const plan = await this.salesOrders.planCancellation(so.id, input.lines, trx);
      const convertedFromFull = !input.lines && plan.hasShippedQuantity && input.requester.kind === 'operator';
      const scope: 'full' | 'partial' = convertedFromFull ? 'partial' : !input.lines || plan.leavesNothing ? 'full' : 'partial';

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
          throw new BadRequestError(`채널 줄 번호가 없는 줄은 채널에 취소를 요청할 수 없습니다: ${line.salesOrderLineId}`);
        }
      }

      const id = randomUUID();
      const requestedAt = new Date();
      const command: CancelChannelOrderPayload = {
        requestId: id,
        salesChannel: so.salesChannel,
        externalOrderId: so.channelOrderId,
        scope,
        ...(scope === 'partial'
          ? { lines: channelLines }
          : {}),
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
      .where(and(inArray(wmsTables.shipments.id, shipmentIds), inArray(wmsTables.shipments.status, [...OPEN_SHIPMENT_STATUSES])))
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
