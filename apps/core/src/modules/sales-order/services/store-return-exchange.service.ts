import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, eq, inArray, sum } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { InjectTypedDb } from '@app/db';
import {
  inventorySchema,
  inventoryTables,
  returnExchangeTables,
  wmsTables,
  ReturnRequest,
  ReturnRequestItem,
  ExchangeRequest,
  ExchangeRequestItem,
} from '../../inventory/schema/inventory.schema';
import {
  StoreCreateReturnRequestDto,
  StoreReturnRequestResponseDto,
  StoreOrderLinesResponseDto,
  StoreOrderLineDto,
} from '../dto/store-return-request.dto';
import {
  StoreCreateExchangeRequestDto,
  StoreExchangeRequestResponseDto,
} from '../dto/store-exchange-request.dto';
import { WalletRefundClient } from './wallet-refund.client';

type SalesOrderRow = typeof inventoryTables.salesOrders.$inferSelect;
type ReturnRequestRow = typeof returnExchangeTables.returnRequests.$inferSelect;
type ReturnRequestItemRow = typeof returnExchangeTables.returnRequestItems.$inferSelect;
type ExchangeRequestRow = typeof returnExchangeTables.exchangeRequests.$inferSelect;
type ExchangeRequestItemRow = typeof returnExchangeTables.exchangeRequestItems.$inferSelect;

export interface ReturnRequestWithItems {
  request: ReturnRequest;
  items: ReturnRequestItem[];
}

export interface ExchangeRequestWithItems {
  request: ExchangeRequest;
  items: ExchangeRequestItem[];
}

// Active statuses that block creating a new request for the same order
const ACTIVE_RETURN_STATUSES = ['requested', 'approved', 'collection_pending', 'collected', 'inspected', 'refund_pending'] as const;
const ACTIVE_EXCHANGE_STATUSES = ['requested', 'approved', 'collection_pending', 'collected', 'inspected', 'refund_pending'] as const;

// Statuses where FO is considered fully delivered
const FO_DELIVERED_STATUSES = new Set(['completed']);

@Injectable()
export class StoreReturnExchangeService {
  private readonly logger = new Logger(StoreReturnExchangeService.name);

  constructor(
    @InjectTypedDb<typeof inventorySchema>()
    private readonly db: { db: PostgresJsDatabase<typeof inventorySchema> },
    private readonly walletRefundClient: WalletRefundClient,
  ) {}

  // ── Store: create return request ─────────────────────────────────────────

  async createReturnRequest(
    orderId: string,
    customerId: string,
    dto: StoreCreateReturnRequestDto,
  ): Promise<StoreReturnRequestResponseDto> {
    const so = await this.findSoOrThrow(orderId);
    this.assertOwnership(so, customerId);
    await this.assertOrderDelivered(orderId, so);
    await this.assertNoActiveReturnRequest(orderId);

    const lineIds = dto.lines.map((l) => l.salesOrderLineId);
    await this.assertLinesBelongToOrder(orderId, lineIds);
    await this.assertReturnQuantitiesAvailable(lineIds, dto.lines);

    return this.db.db.transaction(async (tx) => {
      const [returnRequest] = await tx
        .insert(returnExchangeTables.returnRequests)
        .values({
          salesOrderId: orderId,
          customerId: so.customerId ?? null,
          status: 'requested',
          reasonCode: dto.reasonCode,
          reasonDetail: dto.reasonDetail ?? null,
          returnAddress: dto.returnAddress ? (dto.returnAddress as Record<string, unknown>) : null,
        })
        .returning();

      if (!returnRequest) throw new Error('RETURN_REQUEST_INSERT_FAILED');

      await tx.insert(returnExchangeTables.returnRequestItems).values(
        dto.lines.map((line) => ({
          returnRequestId: returnRequest.id,
          salesOrderLineId: line.salesOrderLineId,
          quantity: line.quantity,
          reasonCode: (line.reasonCode as typeof dto.reasonCode) ?? null,
        })),
      );

      const items = await tx
        .select()
        .from(returnExchangeTables.returnRequestItems)
        .where(eq(returnExchangeTables.returnRequestItems.returnRequestId, returnRequest.id));

      await this.insertBusinessLink(tx, 'return_request', returnRequest.id, orderId, 'return_lifecycle_event', {
        event: 'return_requested',
        requestedBy: 'customer',
        customerId,
        timestamp: new Date().toISOString(),
      });

      return this.toReturnResponseDto(returnRequest, items);
    });
  }

  // ── Store: create exchange request ───────────────────────────────────────

  async createExchangeRequest(
    orderId: string,
    customerId: string,
    dto: StoreCreateExchangeRequestDto,
  ): Promise<StoreExchangeRequestResponseDto> {
    const so = await this.findSoOrThrow(orderId);
    this.assertOwnership(so, customerId);
    await this.assertOrderDelivered(orderId, so);
    await this.assertNoActiveExchangeRequest(orderId);

    const lineIds = dto.lines.map((l) => l.salesOrderLineId);
    await this.assertLinesBelongToOrder(orderId, lineIds);
    await this.assertExchangeQuantitiesAvailable(lineIds, dto.lines);

    return this.db.db.transaction(async (tx) => {
      const [exchangeRequest] = await tx
        .insert(returnExchangeTables.exchangeRequests)
        .values({
          salesOrderId: orderId,
          customerId: so.customerId ?? null,
          status: 'requested',
          reasonCode: dto.reasonCode,
          reasonDetail: dto.reasonDetail ?? null,
        })
        .returning();

      if (!exchangeRequest) throw new Error('EXCHANGE_REQUEST_INSERT_FAILED');

      await tx.insert(returnExchangeTables.exchangeRequestItems).values(
        dto.lines.map((line) => ({
          exchangeRequestId: exchangeRequest.id,
          salesOrderLineId: line.salesOrderLineId,
          quantity: line.quantity,
          desiredVariantId: line.desiredVariantId ?? null,
        })),
      );

      const items = await tx
        .select()
        .from(returnExchangeTables.exchangeRequestItems)
        .where(eq(returnExchangeTables.exchangeRequestItems.exchangeRequestId, exchangeRequest.id));

      await this.insertBusinessLink(tx, 'exchange_request', exchangeRequest.id, orderId, 'exchange_lifecycle_event', {
        event: 'exchange_requested',
        requestedBy: 'customer',
        customerId,
        timestamp: new Date().toISOString(),
      });

      return this.toExchangeResponseDto(exchangeRequest, items);
    });
  }

  // ── Store: get return/exchange request ───────────────────────────────────

  async getReturnRequest(returnRequestId: string, customerId: string): Promise<StoreReturnRequestResponseDto> {
    const returnRequest = await this.db.db
      .select()
      .from(returnExchangeTables.returnRequests)
      .where(eq(returnExchangeTables.returnRequests.id, returnRequestId))
      .limit(1)
      .then((r) => r[0]);

    if (!returnRequest) throw new NotFoundException(`반품 요청을 찾을 수 없습니다: ${returnRequestId}`);

    const so = await this.findSoOrThrow(returnRequest.salesOrderId);
    this.assertOwnership(so, customerId);

    const items = await this.db.db
      .select()
      .from(returnExchangeTables.returnRequestItems)
      .where(eq(returnExchangeTables.returnRequestItems.returnRequestId, returnRequestId));

    return this.toReturnResponseDto(returnRequest, items);
  }

  async getExchangeRequest(exchangeRequestId: string, customerId: string): Promise<StoreExchangeRequestResponseDto> {
    const exchangeRequest = await this.db.db
      .select()
      .from(returnExchangeTables.exchangeRequests)
      .where(eq(returnExchangeTables.exchangeRequests.id, exchangeRequestId))
      .limit(1)
      .then((r) => r[0]);

    if (!exchangeRequest) throw new NotFoundException(`교환 요청을 찾을 수 없습니다: ${exchangeRequestId}`);

    const so = await this.findSoOrThrow(exchangeRequest.salesOrderId);
    this.assertOwnership(so, customerId);

    const items = await this.db.db
      .select()
      .from(returnExchangeTables.exchangeRequestItems)
      .where(eq(returnExchangeTables.exchangeRequestItems.exchangeRequestId, exchangeRequestId));

    return this.toExchangeResponseDto(exchangeRequest, items);
  }

  // ── by-channel-order variants (storefront uses Medusa order ID) ──────────

  async getOrderLinesByChannelOrder(
    channelOrderId: string,
    customerId: string,
  ): Promise<StoreOrderLinesResponseDto> {
    const so = await this.findSoByChannelOrderOrThrow(channelOrderId);
    this.assertOwnership(so, customerId);

    const lines = await this.db.db
      .select()
      .from(wmsTables.salesOrderLines)
      .where(eq(wmsTables.salesOrderLines.salesOrderId, so.id));

    return {
      orderId: so.id,
      channelOrderId: so.channelOrderId,
      orderStatus: so.status,
      lines: lines.map((l): StoreOrderLineDto => ({
        id: l.id,
        productName: l.productName,
        quantity: l.quantity,
        unitPrice: l.unitPrice ?? null,
        totalPrice: l.totalPrice ?? null,
        variantId: l.variantId,
      })),
    };
  }

  async createReturnRequestByChannelOrder(
    channelOrderId: string,
    customerId: string,
    dto: StoreCreateReturnRequestDto,
  ): Promise<StoreReturnRequestResponseDto> {
    const so = await this.findSoByChannelOrderOrThrow(channelOrderId);
    return this.createReturnRequest(so.id, customerId, dto);
  }

  async createExchangeRequestByChannelOrder(
    channelOrderId: string,
    customerId: string,
    dto: StoreCreateExchangeRequestDto,
  ): Promise<StoreExchangeRequestResponseDto> {
    const so = await this.findSoByChannelOrderOrThrow(channelOrderId);
    return this.createExchangeRequest(so.id, customerId, dto);
  }

  async getReturnRequestByChannelOrder(
    channelOrderId: string,
    returnRequestId: string,
    customerId: string,
  ): Promise<StoreReturnRequestResponseDto> {
    const so = await this.findSoByChannelOrderOrThrow(channelOrderId);
    this.assertOwnership(so, customerId);
    return this.getReturnRequest(returnRequestId, customerId);
  }

  async getExchangeRequestByChannelOrder(
    channelOrderId: string,
    exchangeRequestId: string,
    customerId: string,
  ): Promise<StoreExchangeRequestResponseDto> {
    const so = await this.findSoByChannelOrderOrThrow(channelOrderId);
    this.assertOwnership(so, customerId);
    return this.getExchangeRequest(exchangeRequestId, customerId);
  }

  // ── Admin: state transitions (return) ────────────────────────────────────

  async approveReturnRequest(returnRequestId: string, adminId: string, adminNote?: string): Promise<ReturnRequest> {
    return this.db.db.transaction(async (tx) => {
      const rr = await this.findReturnRequestOrThrow(returnRequestId, tx);
      if (rr.status !== 'requested') {
        throw new ConflictException(`반품 요청 상태가 'requested'가 아닙니다. 현재 상태: ${rr.status}`);
      }

      const [updated] = await tx
        .update(returnExchangeTables.returnRequests)
        .set({ status: 'approved', decidedAt: new Date(), adminNote: adminNote ?? null, updatedAt: new Date() })
        .where(eq(returnExchangeTables.returnRequests.id, returnRequestId))
        .returning();

      await this.insertBusinessLink(tx, 'return_request', returnRequestId, rr.salesOrderId, 'return_lifecycle_event', {
        event: 'return_approved',
        adminId,
        adminNote: adminNote ?? null,
        timestamp: new Date().toISOString(),
      });

      return updated;
    });
  }

  async rejectReturnRequest(returnRequestId: string, adminId: string, adminNote?: string): Promise<ReturnRequest> {
    return this.db.db.transaction(async (tx) => {
      const rr = await this.findReturnRequestOrThrow(returnRequestId, tx);
      if (rr.status !== 'requested') {
        throw new ConflictException(`반품 요청 상태가 'requested'가 아닙니다. 현재 상태: ${rr.status}`);
      }

      const [updated] = await tx
        .update(returnExchangeTables.returnRequests)
        .set({ status: 'rejected', decidedAt: new Date(), adminNote: adminNote ?? null, updatedAt: new Date() })
        .where(eq(returnExchangeTables.returnRequests.id, returnRequestId))
        .returning();

      await this.insertBusinessLink(tx, 'return_request', returnRequestId, rr.salesOrderId, 'return_lifecycle_event', {
        event: 'return_rejected',
        adminId,
        adminNote: adminNote ?? null,
        timestamp: new Date().toISOString(),
      });

      return updated;
    });
  }

  async markCollectionPending(returnRequestId: string, adminId: string): Promise<ReturnRequest> {
    return this.db.db.transaction(async (tx) => {
      const rr = await this.findReturnRequestOrThrow(returnRequestId, tx);
      if (rr.status !== 'approved') {
        throw new ConflictException(`반품 요청 상태가 'approved'가 아닙니다. 현재 상태: ${rr.status}`);
      }

      const [updated] = await tx
        .update(returnExchangeTables.returnRequests)
        .set({ status: 'collection_pending', updatedAt: new Date() })
        .where(eq(returnExchangeTables.returnRequests.id, returnRequestId))
        .returning();

      await this.insertBusinessLink(tx, 'return_request', returnRequestId, rr.salesOrderId, 'return_lifecycle_event', {
        event: 'return_collection_pending',
        adminId,
        timestamp: new Date().toISOString(),
      });

      return updated;
    });
  }

  async markCollected(returnRequestId: string, adminId: string): Promise<ReturnRequest> {
    return this.db.db.transaction(async (tx) => {
      const rr = await this.findReturnRequestOrThrow(returnRequestId, tx);
      if (rr.status !== 'collection_pending') {
        throw new ConflictException(`반품 요청 상태가 'collection_pending'이 아닙니다. 현재 상태: ${rr.status}`);
      }

      const [updated] = await tx
        .update(returnExchangeTables.returnRequests)
        .set({ status: 'collected', collectedAt: new Date(), updatedAt: new Date() })
        .where(eq(returnExchangeTables.returnRequests.id, returnRequestId))
        .returning();

      await this.insertBusinessLink(tx, 'return_request', returnRequestId, rr.salesOrderId, 'return_lifecycle_event', {
        event: 'return_collected',
        adminId,
        timestamp: new Date().toISOString(),
      });

      return updated;
    });
  }

  async markInspected(returnRequestId: string, adminId: string): Promise<ReturnRequest> {
    return this.db.db.transaction(async (tx) => {
      const rr = await this.findReturnRequestOrThrow(returnRequestId, tx);
      if (rr.status !== 'collected') {
        throw new ConflictException(`반품 요청 상태가 'collected'가 아닙니다. 현재 상태: ${rr.status}`);
      }

      const [updated] = await tx
        .update(returnExchangeTables.returnRequests)
        .set({ status: 'inspected', updatedAt: new Date() })
        .where(eq(returnExchangeTables.returnRequests.id, returnRequestId))
        .returning();

      await this.insertBusinessLink(tx, 'return_request', returnRequestId, rr.salesOrderId, 'return_lifecycle_event', {
        event: 'return_inspected',
        adminId,
        timestamp: new Date().toISOString(),
      });

      return updated;
    });
  }

  async completeReturnRequest(returnRequestId: string, adminId: string): Promise<ReturnRequest> {
    const salesOrder = await this.db.db
      .select({
        id: wmsTables.salesOrders.id,
        walletIntentId: wmsTables.salesOrders.walletIntentId,
        totalAmount: wmsTables.salesOrders.totalAmount,
        shippingFee: wmsTables.salesOrders.shippingFee,
      })
      .from(wmsTables.salesOrders)
      .innerJoin(returnExchangeTables.returnRequests, eq(returnExchangeTables.returnRequests.salesOrderId, wmsTables.salesOrders.id))
      .where(eq(returnExchangeTables.returnRequests.id, returnRequestId))
      .limit(1)
      .then((r) => r[0]);

    const [allOrderLines, returnItems] = await Promise.all([
      this.db.db
        .select({
          id: wmsTables.salesOrderLines.id,
          quantity: wmsTables.salesOrderLines.quantity,
          unitPrice: wmsTables.salesOrderLines.unitPrice,
          totalPrice: wmsTables.salesOrderLines.totalPrice,
        })
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.salesOrderId, salesOrder!.id)),
      this.db.db
        .select({
          salesOrderLineId: returnExchangeTables.returnRequestItems.salesOrderLineId,
          quantity: returnExchangeTables.returnRequestItems.quantity,
          unitPrice: wmsTables.salesOrderLines.unitPrice,
        })
        .from(returnExchangeTables.returnRequestItems)
        .leftJoin(wmsTables.salesOrderLines, eq(returnExchangeTables.returnRequestItems.salesOrderLineId, wmsTables.salesOrderLines.id))
        .where(eq(returnExchangeTables.returnRequestItems.returnRequestId, returnRequestId)),
    ]);

    const refundAmount = this.calculateReturnRefund(
      returnItems,
      allOrderLines,
      salesOrder?.totalAmount ?? null,
      salesOrder?.shippingFee ?? 0,
    );
    // 환불할 금액이 없으면 즉시 완료. 있으면 refund_pending 경유 후 Wallet 성공 시 completed.
    const immediateComplete = refundAmount <= 0;
    const needsRefund = !immediateComplete && !!salesOrder?.walletIntentId;

    // Phase 1: inspected → refund_pending (or completed when no refund needed)
    const updatedRequest = await this.db.db.transaction(async (tx) => {
      const rr = await this.findReturnRequestOrThrow(returnRequestId, tx);
      if (rr.status !== 'inspected') {
        throw new ConflictException(`반품 요청 상태가 'inspected'가 아닙니다. 현재 상태: ${rr.status}`);
      }

      const now = new Date();
      const nextStatus = immediateComplete ? 'completed' : 'refund_pending';
      const [result] = await tx
        .update(returnExchangeTables.returnRequests)
        .set({
          status: nextStatus,
          ...(immediateComplete ? { completedAt: now } : {}),
          updatedAt: now,
        })
        .where(eq(returnExchangeTables.returnRequests.id, returnRequestId))
        .returning();

      await this.insertBusinessLink(tx, 'return_request', returnRequestId, rr.salesOrderId, 'return_lifecycle_event', {
        event: immediateComplete ? 'return_completed' : 'return_refund_pending',
        adminId,
        timestamp: now.toISOString(),
      });

      return result;
    });

    if (immediateComplete || !needsRefund) {
      if (!immediateComplete && salesOrder && !salesOrder.walletIntentId) {
        this.logger.warn(
          `[ReturnRefund] No walletIntentId for SO ${salesOrder.id}, return ${returnRequestId}. Manual refund required.`,
        );
      }
      return updatedRequest;
    }

    // Phase 2: Wallet 환불 시도. 성공 시 completed, 실패 시 refund_pending 유지 (수동 처리 필요)
    const correlationId = `return:${returnRequestId}:refund`;
    try {
      const outcome = await this.walletRefundClient.refundByIntent(salesOrder!.walletIntentId!, refundAmount, {
        reasonCode: 'RETURN_COMPLETED',
        correlationId,
      });

      // partial_pending = 무통장 등 비동기 처리 중 → 실제 환불 완료 아님. success만 completed 허용.
      const refundSucceeded = outcome.kind === 'success';
      await this.db.db.insert(wmsTables.businessLinks).values({
        sourceType: 'return_request',
        sourceId: returnRequestId,
        targetType: 'wallet_refund',
        targetExternalRef: refundSucceeded || outcome.kind === 'partial_pending'
          ? `wallet:refund:${outcome.refunds?.[0]?.refundId ?? correlationId}`
          : `wallet:intent:${salesOrder!.walletIntentId}`,
        relationName: 'return_linked_wallet_refund',
        metadata: { outcome: outcome.kind, amount: refundAmount, correlationId },
      });

      if (refundSucceeded) {
        const now = new Date();
        const [completed] = await this.db.db
          .update(returnExchangeTables.returnRequests)
          .set({ status: 'completed', completedAt: now, updatedAt: now })
          .where(eq(returnExchangeTables.returnRequests.id, returnRequestId))
          .returning();
        return completed;
      }

      if (outcome.kind === 'partial_pending') {
        this.logger.warn(
          `[ReturnRefund] Wallet refund partial_pending for return ${returnRequestId}. Manual confirmation required.`,
        );
      } else {
        this.logger.error(
          `[ReturnRefund] Wallet refund ${outcome.kind} for return ${returnRequestId}. Staying refund_pending for manual resolution.`,
        );
      }
      return updatedRequest;
    } catch (err) {
      this.logger.error(
        `[ReturnRefund] Wallet refund threw for return ${returnRequestId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return updatedRequest;
    }
  }

  // ── Admin: state transitions (exchange) ──────────────────────────────────

  async markExchangeCollectionPending(exchangeRequestId: string, adminId: string): Promise<ExchangeRequest> {
    return this.db.db.transaction(async (tx) => {
      const er = await this.findExchangeRequestOrThrow(exchangeRequestId, tx);
      if (er.status !== 'approved') {
        throw new ConflictException(`교환 요청 상태가 'approved'가 아닙니다. 현재 상태: ${er.status}`);
      }

      const [updated] = await tx
        .update(returnExchangeTables.exchangeRequests)
        .set({ status: 'collection_pending', updatedAt: new Date() })
        .where(eq(returnExchangeTables.exchangeRequests.id, exchangeRequestId))
        .returning();

      await this.insertBusinessLink(tx, 'exchange_request', exchangeRequestId, er.salesOrderId, 'exchange_lifecycle_event', {
        event: 'exchange_collection_pending',
        adminId,
        timestamp: new Date().toISOString(),
      });

      return updated;
    });
  }

  async markExchangeCollected(exchangeRequestId: string, adminId: string): Promise<ExchangeRequest> {
    return this.db.db.transaction(async (tx) => {
      const er = await this.findExchangeRequestOrThrow(exchangeRequestId, tx);
      if (er.status !== 'collection_pending') {
        throw new ConflictException(`교환 요청 상태가 'collection_pending'이 아닙니다. 현재 상태: ${er.status}`);
      }

      const [updated] = await tx
        .update(returnExchangeTables.exchangeRequests)
        .set({ status: 'collected', updatedAt: new Date() })
        .where(eq(returnExchangeTables.exchangeRequests.id, exchangeRequestId))
        .returning();

      await this.insertBusinessLink(tx, 'exchange_request', exchangeRequestId, er.salesOrderId, 'exchange_lifecycle_event', {
        event: 'exchange_collected',
        adminId,
        timestamp: new Date().toISOString(),
      });

      return updated;
    });
  }

  async approveExchangeRequest(exchangeRequestId: string, adminId: string, adminNote?: string): Promise<ExchangeRequest> {
    return this.db.db.transaction(async (tx) => {
      const er = await this.findExchangeRequestOrThrow(exchangeRequestId, tx);
      if (er.status !== 'requested') {
        throw new ConflictException(`교환 요청 상태가 'requested'가 아닙니다. 현재 상태: ${er.status}`);
      }

      const [updated] = await tx
        .update(returnExchangeTables.exchangeRequests)
        .set({ status: 'approved', decidedAt: new Date(), adminNote: adminNote ?? null, updatedAt: new Date() })
        .where(eq(returnExchangeTables.exchangeRequests.id, exchangeRequestId))
        .returning();

      await this.insertBusinessLink(tx, 'exchange_request', exchangeRequestId, er.salesOrderId, 'exchange_lifecycle_event', {
        event: 'exchange_approved',
        adminId,
        adminNote: adminNote ?? null,
        timestamp: new Date().toISOString(),
      });

      return updated;
    });
  }

  async rejectExchangeRequest(exchangeRequestId: string, adminId: string, adminNote?: string): Promise<ExchangeRequest> {
    return this.db.db.transaction(async (tx) => {
      const er = await this.findExchangeRequestOrThrow(exchangeRequestId, tx);
      if (er.status !== 'requested') {
        throw new ConflictException(`교환 요청 상태가 'requested'가 아닙니다. 현재 상태: ${er.status}`);
      }

      const [updated] = await tx
        .update(returnExchangeTables.exchangeRequests)
        .set({ status: 'rejected', decidedAt: new Date(), adminNote: adminNote ?? null, updatedAt: new Date() })
        .where(eq(returnExchangeTables.exchangeRequests.id, exchangeRequestId))
        .returning();

      await this.insertBusinessLink(tx, 'exchange_request', exchangeRequestId, er.salesOrderId, 'exchange_lifecycle_event', {
        event: 'exchange_rejected',
        adminId,
        adminNote: adminNote ?? null,
        timestamp: new Date().toISOString(),
      });

      return updated;
    });
  }

  async markExchangeInspected(exchangeRequestId: string, adminId: string): Promise<ExchangeRequest> {
    return this.db.db.transaction(async (tx) => {
      const er = await this.findExchangeRequestOrThrow(exchangeRequestId, tx);
      if (er.status !== 'collected') {
        throw new ConflictException(`교환 요청 상태가 'collected'가 아닙니다. 현재 상태: ${er.status}`);
      }

      const [updated] = await tx
        .update(returnExchangeTables.exchangeRequests)
        .set({ status: 'inspected', updatedAt: new Date() })
        .where(eq(returnExchangeTables.exchangeRequests.id, exchangeRequestId))
        .returning();

      await this.insertBusinessLink(tx, 'exchange_request', exchangeRequestId, er.salesOrderId, 'exchange_lifecycle_event', {
        event: 'exchange_inspected',
        adminId,
        timestamp: new Date().toISOString(),
      });

      return updated;
    });
  }

  /**
   * refund_pending 상태의 반품 환불을 Wallet에 재시도한다.
   * 성공 시 completed, 실패 시 refund_pending 유지.
   */
  async retryReturnRefund(returnRequestId: string, adminId: string): Promise<ReturnRequest> {
    const rr = await this.db.db
      .select()
      .from(returnExchangeTables.returnRequests)
      .where(eq(returnExchangeTables.returnRequests.id, returnRequestId))
      .limit(1)
      .then((r) => r[0]);

    if (!rr) throw new NotFoundException(`반품 요청을 찾을 수 없습니다: ${returnRequestId}`);
    if (rr.status !== 'refund_pending') {
      throw new ConflictException(`환불 재시도는 'refund_pending' 상태에서만 가능합니다. 현재 상태: ${rr.status}`);
    }

    const salesOrder = await this.db.db
      .select({
        id: wmsTables.salesOrders.id,
        walletIntentId: wmsTables.salesOrders.walletIntentId,
        totalAmount: wmsTables.salesOrders.totalAmount,
        shippingFee: wmsTables.salesOrders.shippingFee,
      })
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, rr.salesOrderId))
      .limit(1)
      .then((r) => r[0]);

    if (!salesOrder?.walletIntentId) {
      throw new BadRequestException('walletIntentId가 없어 환불 재시도가 불가합니다. 수동 완료를 사용하세요.');
    }

    const [allOrderLines, returnItems] = await Promise.all([
      this.db.db
        .select({
          id: wmsTables.salesOrderLines.id,
          quantity: wmsTables.salesOrderLines.quantity,
          unitPrice: wmsTables.salesOrderLines.unitPrice,
          totalPrice: wmsTables.salesOrderLines.totalPrice,
        })
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.salesOrderId, salesOrder.id)),
      this.db.db
        .select({
          salesOrderLineId: returnExchangeTables.returnRequestItems.salesOrderLineId,
          quantity: returnExchangeTables.returnRequestItems.quantity,
          unitPrice: wmsTables.salesOrderLines.unitPrice,
        })
        .from(returnExchangeTables.returnRequestItems)
        .leftJoin(wmsTables.salesOrderLines, eq(returnExchangeTables.returnRequestItems.salesOrderLineId, wmsTables.salesOrderLines.id))
        .where(eq(returnExchangeTables.returnRequestItems.returnRequestId, returnRequestId)),
    ]);

    const refundAmount = this.calculateReturnRefund(
      returnItems,
      allOrderLines,
      salesOrder.totalAmount,
      salesOrder.shippingFee,
    );
    if (refundAmount <= 0) {
      throw new BadRequestException('환불 금액이 0원 이하입니다. 수동 완료를 사용하세요.');
    }

    // UUID로 재시도마다 고유한 correlation ID 생성.
    // 카운트 기반 key는 동시 재시도 시 같은 번호가 나와 Wallet이 첫 실패 응답을 재생할 수 있음.
    const priorAttempts = await this.db.db
      .select({ id: wmsTables.businessLinks.id })
      .from(wmsTables.businessLinks)
      .where(
        and(
          eq(wmsTables.businessLinks.sourceType, 'return_request'),
          eq(wmsTables.businessLinks.sourceId, returnRequestId),
          eq(wmsTables.businessLinks.relationName, 'return_linked_wallet_refund'),
        ),
      )
      .then((r) => r.length);
    const attemptN = priorAttempts + 1;
    const correlationId = `return:${returnRequestId}:refund:retry:${randomUUID()}`;
    try {
      const outcome = await this.walletRefundClient.refundByIntent(salesOrder.walletIntentId, refundAmount, {
        reasonCode: 'RETURN_COMPLETED',
        correlationId,
      });

      await this.db.db.insert(wmsTables.businessLinks).values({
        sourceType: 'return_request',
        sourceId: returnRequestId,
        targetType: 'wallet_refund',
        targetExternalRef: outcome.kind === 'success' || outcome.kind === 'partial_pending'
          ? `wallet:refund:${outcome.refunds?.[0]?.refundId ?? correlationId}`
          : `wallet:intent:${salesOrder.walletIntentId}`,
        relationName: 'return_linked_wallet_refund',
        metadata: { outcome: outcome.kind, amount: refundAmount, correlationId, retriedBy: adminId, attemptN },
      });

      if (outcome.kind === 'success') {
        const now = new Date();
        const [completed] = await this.db.db
          .update(returnExchangeTables.returnRequests)
          .set({ status: 'completed', completedAt: now, updatedAt: now })
          .where(eq(returnExchangeTables.returnRequests.id, returnRequestId))
          .returning();
        return completed;
      }

      this.logger.warn(
        `[ReturnRefund] Retry ${outcome.kind} for return ${returnRequestId}. Staying refund_pending.`,
      );
      return rr;
    } catch (err) {
      this.logger.error(
        `[ReturnRefund] Retry threw for return ${returnRequestId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return rr;
    }
  }

  /**
   * Wallet 환불 없이 관리자가 직접 반품을 완료 처리한다.
   * refund_pending 상태(Wallet 실패/수동 환불 완료)에서만 사용.
   */
  async manualCompleteReturn(returnRequestId: string, adminId: string, adminNote?: string): Promise<ReturnRequest> {
    return this.db.db.transaction(async (tx) => {
      const rr = await this.findReturnRequestOrThrow(returnRequestId, tx);
      if (rr.status !== 'refund_pending') {
        throw new ConflictException(`수동 완료는 'refund_pending' 상태에서만 가능합니다. 현재 상태: ${rr.status}`);
      }

      const now = new Date();
      const [result] = await tx
        .update(returnExchangeTables.returnRequests)
        .set({ status: 'completed', completedAt: now, adminNote: adminNote ?? null, updatedAt: now })
        .where(eq(returnExchangeTables.returnRequests.id, returnRequestId))
        .returning();

      await this.insertBusinessLink(tx, 'return_request', returnRequestId, rr.salesOrderId, 'return_lifecycle_event', {
        event: 'return_manually_completed',
        adminId,
        adminNote: adminNote ?? null,
        timestamp: now.toISOString(),
      });

      return result;
    });
  }

  async completeExchangeRequest(exchangeRequestId: string, adminId: string): Promise<ExchangeRequest> {
    return this.db.db.transaction(async (tx) => {
      const er = await this.findExchangeRequestOrThrow(exchangeRequestId, tx);
      if (er.status !== 'inspected') {
        throw new ConflictException(`교환 요청 상태가 'inspected'가 아닙니다. 현재 상태: ${er.status}`);
      }

      const [updated] = await tx
        .update(returnExchangeTables.exchangeRequests)
        .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
        .where(eq(returnExchangeTables.exchangeRequests.id, exchangeRequestId))
        .returning();

      await this.insertBusinessLink(tx, 'exchange_request', exchangeRequestId, er.salesOrderId, 'exchange_lifecycle_event', {
        event: 'exchange_completed',
        adminId,
        timestamp: new Date().toISOString(),
      });

      return updated;
    });
  }

  // ── Admin: list / detail ─────────────────────────────────────────────────

  async adminListReturnRequests(filters: {
    salesOrderId?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{ items: ReturnRequestWithItems[]; total: number }> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions: ReturnType<typeof eq>[] = [];
    if (filters.salesOrderId) {
      conditions.push(eq(returnExchangeTables.returnRequests.salesOrderId, filters.salesOrderId));
    }
    if (filters.status) {
      conditions.push(eq(returnExchangeTables.returnRequests.status, filters.status as ReturnRequestRow['status']));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const requests = await this.db.db
      .select()
      .from(returnExchangeTables.returnRequests)
      .where(whereClause)
      .orderBy(returnExchangeTables.returnRequests.createdAt)
      .limit(limit)
      .offset(offset);

    const total = await this.db.db
      .select({ count: returnExchangeTables.returnRequests.id })
      .from(returnExchangeTables.returnRequests)
      .where(whereClause)
      .then((r) => r.length);

    const items = await Promise.all(
      requests.map(async (request) => {
        const requestItems = await this.db.db
          .select()
          .from(returnExchangeTables.returnRequestItems)
          .where(eq(returnExchangeTables.returnRequestItems.returnRequestId, request.id));
        return { request, items: requestItems };
      }),
    );

    return { items, total };
  }

  async adminListExchangeRequests(filters: {
    salesOrderId?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{ items: ExchangeRequestWithItems[]; total: number }> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions: ReturnType<typeof eq>[] = [];
    if (filters.salesOrderId) {
      conditions.push(eq(returnExchangeTables.exchangeRequests.salesOrderId, filters.salesOrderId));
    }
    if (filters.status) {
      conditions.push(eq(returnExchangeTables.exchangeRequests.status, filters.status as ExchangeRequestRow['status']));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const requests = await this.db.db
      .select()
      .from(returnExchangeTables.exchangeRequests)
      .where(whereClause)
      .orderBy(returnExchangeTables.exchangeRequests.createdAt)
      .limit(limit)
      .offset(offset);

    const total = await this.db.db
      .select({ count: returnExchangeTables.exchangeRequests.id })
      .from(returnExchangeTables.exchangeRequests)
      .where(whereClause)
      .then((r) => r.length);

    const items = await Promise.all(
      requests.map(async (request) => {
        const requestItems = await this.db.db
          .select()
          .from(returnExchangeTables.exchangeRequestItems)
          .where(eq(returnExchangeTables.exchangeRequestItems.exchangeRequestId, request.id));
        return { request, items: requestItems };
      }),
    );

    return { items, total };
  }

  async adminGetReturnRequest(returnRequestId: string): Promise<ReturnRequestWithItems> {
    const request = await this.db.db
      .select()
      .from(returnExchangeTables.returnRequests)
      .where(eq(returnExchangeTables.returnRequests.id, returnRequestId))
      .limit(1)
      .then((r) => r[0]);

    if (!request) throw new NotFoundException(`반품 요청을 찾을 수 없습니다: ${returnRequestId}`);

    const items = await this.db.db
      .select()
      .from(returnExchangeTables.returnRequestItems)
      .where(eq(returnExchangeTables.returnRequestItems.returnRequestId, returnRequestId));

    return { request, items };
  }

  async adminGetExchangeRequest(exchangeRequestId: string): Promise<ExchangeRequestWithItems> {
    const request = await this.db.db
      .select()
      .from(returnExchangeTables.exchangeRequests)
      .where(eq(returnExchangeTables.exchangeRequests.id, exchangeRequestId))
      .limit(1)
      .then((r) => r[0]);

    if (!request) throw new NotFoundException(`교환 요청을 찾을 수 없습니다: ${exchangeRequestId}`);

    const items = await this.db.db
      .select()
      .from(returnExchangeTables.exchangeRequestItems)
      .where(eq(returnExchangeTables.exchangeRequestItems.exchangeRequestId, exchangeRequestId));

    return { request, items };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async findSoOrThrow(orderId: string): Promise<SalesOrderRow> {
    const so = await this.db.db
      .select()
      .from(inventoryTables.salesOrders)
      .where(eq(inventoryTables.salesOrders.id, orderId))
      .limit(1)
      .then((r) => r[0]);

    if (!so) throw new NotFoundException('주문을 찾을 수 없습니다.');
    return so;
  }

  private async findSoByChannelOrderOrThrow(channelOrderId: string): Promise<SalesOrderRow> {
    const so = await this.db.db
      .select()
      .from(inventoryTables.salesOrders)
      .where(eq(inventoryTables.salesOrders.channelOrderId, channelOrderId))
      .limit(1)
      .then((r) => r[0]);

    if (!so) throw new NotFoundException('주문을 찾을 수 없습니다.');
    return so;
  }

  private async findReturnRequestOrThrow(
    returnRequestId: string,
    tx: Parameters<Parameters<typeof this.db.db.transaction>[0]>[0],
  ): Promise<ReturnRequestRow> {
    const rr = await tx
      .select()
      .from(returnExchangeTables.returnRequests)
      .where(eq(returnExchangeTables.returnRequests.id, returnRequestId))
      .limit(1)
      .then((r) => r[0]);

    if (!rr) throw new NotFoundException(`반품 요청을 찾을 수 없습니다: ${returnRequestId}`);
    return rr;
  }

  private async findExchangeRequestOrThrow(
    exchangeRequestId: string,
    tx: Parameters<Parameters<typeof this.db.db.transaction>[0]>[0],
  ): Promise<ExchangeRequestRow> {
    const er = await tx
      .select()
      .from(returnExchangeTables.exchangeRequests)
      .where(eq(returnExchangeTables.exchangeRequests.id, exchangeRequestId))
      .limit(1)
      .then((r) => r[0]);

    if (!er) throw new NotFoundException(`교환 요청을 찾을 수 없습니다: ${exchangeRequestId}`);
    return er;
  }

  private assertOwnership(so: SalesOrderRow, customerId: string): void {
    if (so.customerId !== customerId) {
      throw new ForbiddenException('본인 주문만 접근할 수 있습니다.');
    }
  }

  private async assertOrderDelivered(orderId: string, so: SalesOrderRow): Promise<void> {
    if (so.status === 'delivered') return;

    const fos = await this.db.db
      .select()
      .from(inventoryTables.fulfillmentOrders)
      .where(eq(inventoryTables.fulfillmentOrders.salesOrderId, orderId));

    const hasDelivered = fos.some((fo) => FO_DELIVERED_STATUSES.has(fo.status));
    if (!hasDelivered) {
      throw new BadRequestException('배송 완료(completed)된 주문만 반품/교환 신청이 가능합니다.');
    }
  }

  private async assertNoActiveReturnRequest(orderId: string): Promise<void> {
    const existing = await this.db.db
      .select({ id: returnExchangeTables.returnRequests.id })
      .from(returnExchangeTables.returnRequests)
      .where(
        and(
          eq(returnExchangeTables.returnRequests.salesOrderId, orderId),
          inArray(returnExchangeTables.returnRequests.status, [...ACTIVE_RETURN_STATUSES]),
        ),
      )
      .limit(1)
      .then((r) => r[0]);

    if (existing) throw new ConflictException('이미 진행 중인 반품 요청이 있습니다.');
  }

  private async assertNoActiveExchangeRequest(orderId: string): Promise<void> {
    const existing = await this.db.db
      .select({ id: returnExchangeTables.exchangeRequests.id })
      .from(returnExchangeTables.exchangeRequests)
      .where(
        and(
          eq(returnExchangeTables.exchangeRequests.salesOrderId, orderId),
          inArray(returnExchangeTables.exchangeRequests.status, [...ACTIVE_EXCHANGE_STATUSES]),
        ),
      )
      .limit(1)
      .then((r) => r[0]);

    if (existing) throw new ConflictException('이미 진행 중인 교환 요청이 있습니다.');
  }

  /**
   * Verify that every salesOrderLineId in the request belongs to the given order.
   */
  private async assertLinesBelongToOrder(orderId: string, lineIds: string[]): Promise<void> {
    if (lineIds.length === 0) return;

    const rows = await this.db.db
      .select({ id: wmsTables.salesOrderLines.id })
      .from(wmsTables.salesOrderLines)
      .where(
        and(
          eq(wmsTables.salesOrderLines.salesOrderId, orderId),
          inArray(wmsTables.salesOrderLines.id, lineIds),
        ),
      );

    const foundIds = new Set(rows.map((r) => r.id));
    const invalid = lineIds.filter((id) => !foundIds.has(id));
    if (invalid.length > 0) {
      throw new BadRequestException(
        `다음 주문 라인이 해당 주문에 속하지 않습니다: ${invalid.join(', ')}`,
      );
    }
  }

  /**
   * Validate that requested return quantities do not exceed available quantities per line.
   * Available = original line quantity - (active return claims + active exchange claims).
   * Both return and exchange count against the same available pool to prevent double-claiming.
   */
  private async assertReturnQuantitiesAvailable(
    lineIds: string[],
    requestedLines: Array<{ salesOrderLineId: string; quantity: number }>,
  ): Promise<void> {
    if (lineIds.length === 0) return;

    // Load original quantities
    const orderLines = await this.db.db
      .select({ id: wmsTables.salesOrderLines.id, quantity: wmsTables.salesOrderLines.quantity })
      .from(wmsTables.salesOrderLines)
      .where(inArray(wmsTables.salesOrderLines.id, lineIds));

    const originalQtyMap = new Map(orderLines.map((l) => [l.id, l.quantity]));

    const [activeReturnItems, activeExchangeItems] = await Promise.all([
      // Active return claims
      this.db.db
        .select({
          salesOrderLineId: returnExchangeTables.returnRequestItems.salesOrderLineId,
          totalClaimed: sum(returnExchangeTables.returnRequestItems.quantity),
        })
        .from(returnExchangeTables.returnRequestItems)
        .innerJoin(
          returnExchangeTables.returnRequests,
          eq(returnExchangeTables.returnRequestItems.returnRequestId, returnExchangeTables.returnRequests.id),
        )
        .where(
          and(
            inArray(returnExchangeTables.returnRequestItems.salesOrderLineId, lineIds),
            inArray(returnExchangeTables.returnRequests.status, [...ACTIVE_RETURN_STATUSES]),
          ),
        )
        .groupBy(returnExchangeTables.returnRequestItems.salesOrderLineId),
      // Active exchange claims (same pool)
      this.db.db
        .select({
          salesOrderLineId: returnExchangeTables.exchangeRequestItems.salesOrderLineId,
          totalClaimed: sum(returnExchangeTables.exchangeRequestItems.quantity),
        })
        .from(returnExchangeTables.exchangeRequestItems)
        .innerJoin(
          returnExchangeTables.exchangeRequests,
          eq(returnExchangeTables.exchangeRequestItems.exchangeRequestId, returnExchangeTables.exchangeRequests.id),
        )
        .where(
          and(
            inArray(returnExchangeTables.exchangeRequestItems.salesOrderLineId, lineIds),
            inArray(returnExchangeTables.exchangeRequests.status, [...ACTIVE_EXCHANGE_STATUSES]),
          ),
        )
        .groupBy(returnExchangeTables.exchangeRequestItems.salesOrderLineId),
    ]);

    const claimedQtyMap = new Map<string, number>();
    for (const r of activeReturnItems) {
      claimedQtyMap.set(r.salesOrderLineId, (claimedQtyMap.get(r.salesOrderLineId) ?? 0) + Number(r.totalClaimed ?? 0));
    }
    for (const r of activeExchangeItems) {
      claimedQtyMap.set(r.salesOrderLineId, (claimedQtyMap.get(r.salesOrderLineId) ?? 0) + Number(r.totalClaimed ?? 0));
    }

    for (const line of requestedLines) {
      const originalQty = originalQtyMap.get(line.salesOrderLineId) ?? 0;
      const claimedQty = claimedQtyMap.get(line.salesOrderLineId) ?? 0;
      const availableQty = originalQty - claimedQty;

      if (line.quantity > availableQty) {
        throw new BadRequestException(
          `주문 라인 ${line.salesOrderLineId}의 반품 가능 수량(${availableQty})을 초과하였습니다. (요청: ${line.quantity})`,
        );
      }
    }
  }

  /**
   * Validate that requested exchange quantities do not exceed available quantities per line.
   * Available = original line quantity - (active exchange claims + active return claims).
   * Both return and exchange count against the same available pool to prevent double-claiming.
   */
  private async assertExchangeQuantitiesAvailable(
    lineIds: string[],
    requestedLines: Array<{ salesOrderLineId: string; quantity: number }>,
  ): Promise<void> {
    if (lineIds.length === 0) return;

    // Load original quantities
    const orderLines = await this.db.db
      .select({ id: wmsTables.salesOrderLines.id, quantity: wmsTables.salesOrderLines.quantity })
      .from(wmsTables.salesOrderLines)
      .where(inArray(wmsTables.salesOrderLines.id, lineIds));

    const originalQtyMap = new Map(orderLines.map((l) => [l.id, l.quantity]));

    const [activeExchangeItems, activeReturnItems] = await Promise.all([
      // Active exchange claims
      this.db.db
        .select({
          salesOrderLineId: returnExchangeTables.exchangeRequestItems.salesOrderLineId,
          totalClaimed: sum(returnExchangeTables.exchangeRequestItems.quantity),
        })
        .from(returnExchangeTables.exchangeRequestItems)
        .innerJoin(
          returnExchangeTables.exchangeRequests,
          eq(returnExchangeTables.exchangeRequestItems.exchangeRequestId, returnExchangeTables.exchangeRequests.id),
        )
        .where(
          and(
            inArray(returnExchangeTables.exchangeRequestItems.salesOrderLineId, lineIds),
            inArray(returnExchangeTables.exchangeRequests.status, [...ACTIVE_EXCHANGE_STATUSES]),
          ),
        )
        .groupBy(returnExchangeTables.exchangeRequestItems.salesOrderLineId),
      // Active return claims (same pool)
      this.db.db
        .select({
          salesOrderLineId: returnExchangeTables.returnRequestItems.salesOrderLineId,
          totalClaimed: sum(returnExchangeTables.returnRequestItems.quantity),
        })
        .from(returnExchangeTables.returnRequestItems)
        .innerJoin(
          returnExchangeTables.returnRequests,
          eq(returnExchangeTables.returnRequestItems.returnRequestId, returnExchangeTables.returnRequests.id),
        )
        .where(
          and(
            inArray(returnExchangeTables.returnRequestItems.salesOrderLineId, lineIds),
            inArray(returnExchangeTables.returnRequests.status, [...ACTIVE_RETURN_STATUSES]),
          ),
        )
        .groupBy(returnExchangeTables.returnRequestItems.salesOrderLineId),
    ]);

    const claimedQtyMap = new Map<string, number>();
    for (const r of activeExchangeItems) {
      claimedQtyMap.set(r.salesOrderLineId, (claimedQtyMap.get(r.salesOrderLineId) ?? 0) + Number(r.totalClaimed ?? 0));
    }
    for (const r of activeReturnItems) {
      claimedQtyMap.set(r.salesOrderLineId, (claimedQtyMap.get(r.salesOrderLineId) ?? 0) + Number(r.totalClaimed ?? 0));
    }

    for (const line of requestedLines) {
      const originalQty = originalQtyMap.get(line.salesOrderLineId) ?? 0;
      const claimedQty = claimedQtyMap.get(line.salesOrderLineId) ?? 0;
      const availableQty = originalQty - claimedQty;

      if (line.quantity > availableQty) {
        throw new BadRequestException(
          `주문 라인 ${line.salesOrderLineId}의 교환 가능 수량(${availableQty})을 초과하였습니다. (요청: ${line.quantity})`,
        );
      }
    }
  }

  private async insertBusinessLink(
    tx: Parameters<Parameters<typeof this.db.db.transaction>[0]>[0],
    sourceType: string,
    sourceId: string,
    targetId: string,
    relationName: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await tx.insert(wmsTables.businessLinks).values({
      sourceType,
      sourceId,
      targetType: 'sales_order',
      targetId,
      relationName,
      metadata,
    });
  }

  private toReturnResponseDto(
    returnRequest: ReturnRequestRow,
    items: ReturnRequestItemRow[],
  ): StoreReturnRequestResponseDto {
    return {
      id: returnRequest.id,
      salesOrderId: returnRequest.salesOrderId,
      status: returnRequest.status,
      reasonCode: returnRequest.reasonCode,
      reasonDetail: returnRequest.reasonDetail ?? undefined,
      items: items.map((item) => ({
        salesOrderLineId: item.salesOrderLineId,
        quantity: item.quantity,
      })),
      createdAt: returnRequest.createdAt,
    };
  }

  /**
   * 반품 환불 금액 계산.
   * - 전체 반품: totalAmount (배송비 포함한 실제 결제 금액)
   * - 부분 반품: (반품 라인 합계 / 전체 라인 합계) × (totalAmount - shippingFee)
   *   → 주문 레벨 할인을 라인 비중으로 배분. 부분 반품에는 배송비 미포함.
   */
  private calculateReturnRefund(
    returnItems: { salesOrderLineId: string | null; quantity: number; unitPrice: number | null }[],
    allLines: { id: string; quantity: number; unitPrice: number | null; totalPrice: number | null }[],
    orderTotalAmount: number | null,
    orderShippingFee: number,
  ): number {
    const orderTotal = orderTotalAmount ?? 0;

    if (orderTotal <= 0 || allLines.length === 0) {
      // totalAmount 정보 없음: 단순 unitPrice × 수량 합산으로 폴백
      return returnItems.reduce((acc, item) => acc + item.quantity * (item.unitPrice ?? 0), 0);
    }

    const returnQtyByLineId = new Map(returnItems.map((r) => [r.salesOrderLineId, r.quantity]));
    const isFullReturn = allLines.every((l) => (returnQtyByLineId.get(l.id) ?? 0) >= l.quantity);

    if (isFullReturn) {
      return orderTotal;
    }

    // totalPrice 또는 unitPrice × quantity를 라인 무게로 사용
    const allLinesTotals = allLines.reduce((acc, l) => acc + (l.totalPrice ?? (l.unitPrice ?? 0) * l.quantity), 0);
    if (allLinesTotals <= 0) {
      return returnItems.reduce((acc, item) => acc + item.quantity * (item.unitPrice ?? 0), 0);
    }

    const returnedLinesTotals = allLines.reduce((acc, l) => {
      const returnQty = returnQtyByLineId.get(l.id) ?? 0;
      return acc + returnQty * (l.unitPrice ?? 0);
    }, 0);

    const productSubtotal = Math.max(0, orderTotal - orderShippingFee);
    return Math.round((returnedLinesTotals * productSubtotal) / allLinesTotals);
  }

  private toExchangeResponseDto(
    exchangeRequest: ExchangeRequestRow,
    items: ExchangeRequestItemRow[],
  ): StoreExchangeRequestResponseDto {
    return {
      id: exchangeRequest.id,
      salesOrderId: exchangeRequest.salesOrderId,
      status: exchangeRequest.status,
      reasonCode: exchangeRequest.reasonCode,
      reasonDetail: exchangeRequest.reasonDetail ?? undefined,
      items: items.map((item) => ({
        salesOrderLineId: item.salesOrderLineId,
        quantity: item.quantity,
        desiredVariantId: item.desiredVariantId ?? undefined,
      })),
      createdAt: exchangeRequest.createdAt,
    };
  }
}
