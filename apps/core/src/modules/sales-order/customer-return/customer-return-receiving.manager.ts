import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { InjectPublisher, PublisherFor } from '@app/events';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { CHANNEL_ORDERS_COMMAND_STREAM, CORE_ORDER_STREAM } from '@packages/event-contracts/streams';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { InventoryCommandService } from '../../inventory/core/services/inventory-command.service';
import { enqueueSalesOrderClaimProgress } from '../common/claim-progress';
import { deliveredParcelsSql } from '../line-quantities/line-quantities.sql';
import { transitionCustomerReturn } from './customer-return-transition';
import { enqueueSettleChannelReturn, loadSettleLines, toSettleItems } from './customer-return-settle-command';
import { CustomerReturnReader, CustomerReturnView } from './customer-return.reader';
import type { CustomerReturn, CustomerReturnSettlement, CustomerReturnStatus } from './customer-return.types';

export type RecordCustomerReturnArrivalInput = {
  customerReturnId: string;
  warehouseId: string;
  items: Array<{ customerReturnItemId: string; quantity: number }>;
  /** 호출자(창고 스테이션)의 키. 항목마다 `<key>:<itemId>` 로 넓혀 도착 행이 멱등을 진다(N4) */
  idempotencyKey: string;
  actorId: string;
};

export type RecordCustomerReturnInspectionInput = {
  customerReturnId: string;
  items: Array<{ customerReturnItemId: string; accepted: number; rejected: number; held: number }>;
  actorId: string;
};

/** 검수가 끝난 뒤의 상태 — 같은 결과의 재요청은 그대로 돌려주고, 다른 결과는 거절한다(N6) */
const INSPECTED_STATUSES: readonly CustomerReturnStatus[] = ['inspected', 'held', 'refund_pending', 'settled'];

type ReturnItemRow = {
  id: string;
  skuId: string;
  qtyPerUnit: number;
  expectedQty: number;
  acceptedQty: number | null;
  rejectedQty: number | null;
  heldQty: number | null;
};

/**
 * 반품 도착·검수 명령 (K8 PR6). 창고가 받은 수량을 원장 RETURNED 로 적고, 검수 결과로 RETURNED 를 ON_HAND·DEFECTIVE 로
 * 나눈 뒤, 환불 보류가 없으면 채널에 수령·환불 정산 명령(`SettleChannelReturn`)을 싣는다.
 * 같은 반품의 도착·검수는 `customer_returns` 행 잠금으로 줄을 세운다.
 */
@Injectable()
export class CustomerReturnReceivingManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly reader: CustomerReturnReader,
    private readonly inventoryCommand: InventoryCommandService,
    @InjectPublisher(CORE_ORDER_STREAM)
    private readonly coreOrders: PublisherFor<typeof CORE_ORDER_STREAM>,
    @InjectPublisher(CHANNEL_ORDERS_COMMAND_STREAM)
    private readonly commands: PublisherFor<typeof CHANNEL_ORDERS_COMMAND_STREAM>,
  ) {}

  async recordArrival(input: RecordCustomerReturnArrivalInput, tx?: DbTx): Promise<CustomerReturnView> {
    return this.dbService.run(async (trx) => {
      const record = await this.lockReturn(trx, input.customerReturnId);
      if (record.status !== 'expected' && record.status !== 'arrived') {
        throw new ConflictError(`Customer return ${record.id} cannot receive arrivals: status is ${record.status}`);
      }
      if (!input.idempotencyKey.trim()) throw new BadRequestError('idempotencyKey is required');
      this.assertDistinctItems(input.items.map((item) => item.customerReturnItemId));
      const invalid = input.items.find((item) => !Number.isInteger(item.quantity) || item.quantity <= 0);
      if (invalid) {
        throw new BadRequestError(`Arrival quantity must be a positive integer: ${invalid.customerReturnItemId}`);
      }
      await this.assertReceivingWarehouse(trx, record, input.warehouseId);

      const itemById = new Map((await this.loadItems(trx, record.id)).map((item) => [item.id, item]));
      const foreign = input.items.find((item) => !itemById.has(item.customerReturnItemId));
      if (foreign) {
        throw new BadRequestError(
          `Item ${foreign.customerReturnItemId} does not belong to customer return ${record.id}`,
        );
      }

      // 이미 받은 키(재시도)는 같은 항목·수량인지만 보고 원장을 다시 부르지 않는다(N4). 새 키는 합이 기대를 넘으면
      // 아무것도 쓰기 전에 거절한다.
      const keyOf = (itemId: string) => `${input.idempotencyKey}:${itemId}`;
      const existing = await trx
        .select()
        .from(wmsTables.customerReturnArrivals)
        .where(
          inArray(
            wmsTables.customerReturnArrivals.idempotencyKey,
            input.items.map((item) => keyOf(item.customerReturnItemId)),
          ),
        );
      const existingByKey = new Map(existing.map((row) => [row.idempotencyKey, row]));
      const arrived = await this.arrivedByItem(trx, [...itemById.keys()]);
      const fresh: typeof input.items = [];
      for (const item of input.items) {
        const prior = existingByKey.get(keyOf(item.customerReturnItemId));
        if (prior) {
          if (prior.customerReturnItemId !== item.customerReturnItemId || prior.quantity !== item.quantity) {
            throw new ConflictError(
              `idempotencyKey ${input.idempotencyKey} already recorded a different arrival for item ${item.customerReturnItemId}`,
            );
          }
          continue;
        }
        // 미도착으로 닫은 반품은 새 소포를 받지 않는다(N8) — 닫기 전에 받은 키의 재전송만 위에서 그대로 돌려준다
        if (record.csResolution?.missing) throw new ConflictError('미도착으로 닫은 반품입니다');
        const target = itemById.get(item.customerReturnItemId);
        const sum = (arrived.get(item.customerReturnItemId) ?? 0) + item.quantity;
        if (target && sum > target.expectedQty) {
          throw new BadRequestError(
            `Arrival exceeds expected quantity for item ${item.customerReturnItemId}: ${sum} > ${target.expectedQty}`,
          );
        }
        fresh.push(item);
      }

      const now = new Date();
      for (const item of fresh) {
        const target = itemById.get(item.customerReturnItemId);
        if (!target) throw new Error(`Customer return item vanished: ${item.customerReturnItemId}`);
        const [row] = await trx
          .insert(wmsTables.customerReturnArrivals)
          .values({
            customerReturnItemId: item.customerReturnItemId,
            quantity: item.quantity,
            idempotencyKey: keyOf(item.customerReturnItemId),
            arrivedBy: input.actorId,
            arrivedAt: now,
          })
          .onConflictDoNothing({ target: wmsTables.customerReturnArrivals.idempotencyKey })
          .returning({ id: wmsTables.customerReturnArrivals.id });
        // 키에 항목 id 가 들어 있고 반품 행 잠금 아래에서 위 대조를 지났으므로 충돌은 없다 — 있으면 불변식이 깨진 것
        if (!row) throw new ConflictError(`Arrival key collision: ${keyOf(item.customerReturnItemId)}`);
        const { eventId } = await this.inventoryCommand.returnReceive(
          {
            skuId: target.skuId,
            warehouseId: input.warehouseId,
            quantity: item.quantity,
            idempotencyKey: `customer-return-arrival:${row.id}`,
            occurredAt: now,
            reason: `customer-return:${record.id}`,
          },
          trx,
        );
        await trx
          .update(wmsTables.customerReturnArrivals)
          .set({ stockEventId: eventId })
          .where(eq(wmsTables.customerReturnArrivals.id, row.id));
      }

      if (record.status === 'expected' && fresh.length > 0) {
        const moved = await transitionCustomerReturn(trx, {
          id: record.id,
          from: ['expected'],
          to: 'arrived',
          set: { warehouseId: input.warehouseId, arrivedAt: now },
        });
        if (!moved) throw new ConflictError(`Customer return ${record.id} changed while recording arrival`);
        await enqueueSalesOrderClaimProgress(this.coreOrders, trx, {
          salesOrderId: record.salesOrderId,
          kind: 'return',
          stage: 'collected',
          requestId: record.id,
          requestedBy: record.requestedBy === 'operator' ? 'admin' : 'customer',
          occurredAt: now,
        });
      }

      return this.reader.findById(record.id, trx);
    }, tx);
  }

  async recordInspection(input: RecordCustomerReturnInspectionInput, tx?: DbTx): Promise<CustomerReturnView> {
    return this.dbService.run(async (trx) => {
      const record = await this.lockReturn(trx, input.customerReturnId);
      const items = await this.loadItems(trx, record.id);
      this.assertDistinctItems(input.items.map((item) => item.customerReturnItemId));
      const itemIds = new Set(items.map((item) => item.id));
      const foreign = input.items.find((item) => !itemIds.has(item.customerReturnItemId));
      if (foreign) {
        throw new BadRequestError(
          `Item ${foreign.customerReturnItemId} does not belong to customer return ${record.id}`,
        );
      }
      if (input.items.length !== items.length) {
        throw new BadRequestError(`Inspection must cover every item of customer return ${record.id} exactly once`);
      }
      const invalid = input.items.find((item) =>
        [item.accepted, item.rejected, item.held].some((qty) => !Number.isInteger(qty) || qty < 0),
      );
      if (invalid) {
        throw new BadRequestError(
          `Inspection quantities must be non-negative integers: ${invalid.customerReturnItemId}`,
        );
      }
      const resultByItem = new Map(input.items.map((item) => [item.customerReturnItemId, item]));

      // 이미 검수한 반품 — 같은 결과(더블클릭·재시도)면 그대로, 다르면 거절(N6)
      if (INSPECTED_STATUSES.includes(record.status)) {
        const same = items.every((item) => {
          const result = resultByItem.get(item.id);
          return (
            result !== undefined &&
            item.acceptedQty === result.accepted &&
            item.rejectedQty === result.rejected &&
            item.heldQty === result.held
          );
        });
        if (!same) {
          throw new ConflictError(`Customer return ${record.id} was already inspected with a different result`);
        }
        return this.reader.findById(record.id, trx);
      }
      if (record.status !== 'expected' && record.status !== 'arrived') {
        throw new ConflictError(`Customer return ${record.id} cannot be inspected: status is ${record.status}`);
      }

      const arrived = await this.arrivedByItem(
        trx,
        items.map((item) => item.id),
      );
      // 부분 도착은 «미도착으로 닫기»(PR 6b N8) 뒤에만 검수한다 — 닫혔으면 «합 = 도착»만 본다
      const closesMissing = record.csResolution?.missing !== undefined;
      const short = closesMissing ? undefined : items.find((item) => (arrived.get(item.id) ?? 0) < item.expectedQty);
      if (short) {
        throw new BadRequestError(
          `아직 도착하지 않은 수량이 있습니다 — item ${short.id}: ${arrived.get(short.id) ?? 0}/${short.expectedQty}`,
        );
      }
      const mismatch = items.find((item) => {
        const result = resultByItem.get(item.id);
        return !result || result.accepted + result.rejected + result.held !== (arrived.get(item.id) ?? 0);
      });
      if (mismatch) {
        throw new BadRequestError(
          `Inspection total must equal arrived quantity ${arrived.get(mismatch.id) ?? 0} for item ${mismatch.id}`,
        );
      }
      const warehouseId = record.warehouseId;
      if (!warehouseId) throw new Error(`Arrived customer return ${record.id} has no warehouse`);

      const now = new Date();
      for (const item of items) {
        const result = resultByItem.get(item.id);
        if (!result) throw new Error(`Inspection result vanished for item ${item.id}`);
        await trx
          .update(wmsTables.customerReturnItems)
          .set({ acceptedQty: result.accepted, rejectedQty: result.rejected, heldQty: result.held })
          .where(eq(wmsTables.customerReturnItems.id, item.id));
        const base = { skuId: item.skuId, warehouseId, occurredAt: now, reason: `customer-return:${record.id}` };
        // 원장은 수량 0 을 거절한다 — 0 인 쪽은 부르지 않는다. 보류도 판매할 수 없으니 불량과 같이 DEFECTIVE
        if (result.accepted > 0) {
          await this.inventoryCommand.returnAccept(
            { ...base, quantity: result.accepted, idempotencyKey: `customer-return-inspect:${item.id}:accept` },
            trx,
          );
        }
        if (result.rejected + result.held > 0) {
          await this.inventoryCommand.returnReject(
            {
              ...base,
              quantity: result.rejected + result.held,
              idempotencyKey: `customer-return-inspect:${item.id}:reject`,
            },
            trx,
          );
        }
      }

      if (input.items.some((item) => item.held > 0)) {
        // 환불 보류 — 명령도 정산 칸도 없다. CS 의 보류 정산(`CustomerReturnCsManager.settleHeld`)이 연다
        await this.transition(trx, record.id, 'held', { inspectedAt: now, inspectedBy: input.actorId });
        return this.reader.findById(record.id, trx);
      }

      const settlement: CustomerReturnSettlement = {
        state: 'in_progress',
        refundMode: 'auto',
        startedAt: now.toISOString(),
        lastIssuedAt: now.toISOString(),
        attempts: 1,
        issues: 1,
        lastFailure: null,
        command: closesMissing ? { closesMissing: true } : {},
      };
      await this.transition(trx, record.id, 'inspected', { inspectedAt: now, inspectedBy: input.actorId, settlement });
      await enqueueSettleChannelReturn(this.commands, trx, {
        customerReturnId: record.id,
        salesOrderId: record.salesOrderId,
        channelReturnId: record.channelReturnId,
        // 검수 결과는 위에서 항목에 적었다 — 재발행과 같은 읽기로 줄을 만든다
        items: toSettleItems(await loadSettleLines(trx, record.id)),
        refundMode: 'auto',
        command: settlement.command,
        issue: 1,
      });
      return this.reader.findById(record.id, trx);
    }, tx);
  }

  private async transition(
    trx: DbTx,
    id: string,
    to: 'inspected' | 'held',
    set: Parameters<typeof transitionCustomerReturn>[1]['set'],
  ): Promise<void> {
    const moved = await transitionCustomerReturn(trx, { id, from: ['arrived'], to, set });
    if (!moved) throw new ConflictError(`Customer return ${id} changed while recording inspection`);
  }

  private async lockReturn(trx: DbTx, id: string): Promise<CustomerReturn> {
    const [record] = await trx
      .select()
      .from(wmsTables.customerReturns)
      .where(eq(wmsTables.customerReturns.id, id))
      .for('update');
    if (!record) throw new NotFoundError(`Customer return not found: ${id}`);
    return record;
  }

  private assertDistinctItems(itemIds: string[]): void {
    if (itemIds.length === 0) throw new BadRequestError('items must not be empty');
    const duplicated = itemIds.find((id, i) => itemIds.indexOf(id) !== i);
    if (duplicated) throw new BadRequestError(`Duplicate customer return item: ${duplicated}`);
  }

  /**
   * 받는 창고(N5) — 첫 도착이 정한 창고가 있으면 그 창고여야 하고, 그 판매주문을 배송완료한 창고 중 하나여야 한다.
   * 입점사 상자(warehouse_id NULL)는 창고 후보가 아니다.
   */
  private async assertReceivingWarehouse(trx: DbTx, record: CustomerReturn, warehouseId: string): Promise<void> {
    if (record.warehouseId && record.warehouseId !== warehouseId) {
      throw new BadRequestError(
        `Customer return ${record.id} is being received at warehouse ${record.warehouseId}, not ${warehouseId}`,
      );
    }
    const s = wmsTables.shipments;
    const [delivering] = await trx
      .select({ id: s.id })
      .from(s)
      .where(
        and(
          eq(s.warehouseId, warehouseId),
          inArray(
            s.id,
            sql`(select delivered_parcel.shipment_id from (${deliveredParcelsSql(sql`select ${record.salesOrderId}::uuid`)}) as delivered_parcel)`,
          ),
        ),
      )
      .limit(1);
    if (!delivering) {
      throw new BadRequestError(`Warehouse ${warehouseId} did not deliver sales order ${record.salesOrderId}`);
    }
  }

  private async loadItems(trx: DbTx, customerReturnId: string): Promise<ReturnItemRow[]> {
    const i = wmsTables.customerReturnItems;
    const l = wmsTables.customerReturnLines;
    return trx
      .select({
        id: i.id,
        skuId: i.skuId,
        qtyPerUnit: i.qtyPerUnit,
        expectedQty: i.expectedQty,
        acceptedQty: i.acceptedQty,
        rejectedQty: i.rejectedQty,
        heldQty: i.heldQty,
      })
      .from(i)
      .innerJoin(l, eq(l.id, i.customerReturnLineId))
      .where(eq(l.customerReturnId, customerReturnId));
  }

  private async arrivedByItem(trx: DbTx, itemIds: string[]): Promise<Map<string, number>> {
    if (itemIds.length === 0) return new Map();
    const a = wmsTables.customerReturnArrivals;
    const rows = await trx
      .select({ itemId: a.customerReturnItemId, qty: sql<number>`sum(${a.quantity})::int` })
      .from(a)
      .where(inArray(a.customerReturnItemId, itemIds))
      .groupBy(a.customerReturnItemId);
    return new Map(rows.map((row) => [row.itemId, row.qty]));
  }
}
