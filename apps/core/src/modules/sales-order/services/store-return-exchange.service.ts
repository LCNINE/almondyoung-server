import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, max, ne } from 'drizzle-orm';
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
  DbTx,
} from '../../inventory/schema/inventory.schema';
import {
  StoreCreateReturnRequestDto,
  StoreReturnRequestResponseDto,
  StoreOrderLinesResponseDto,
  StoreOrderLineDto,
  StoreReturnEligibilityResponseDto,
} from '../dto/store-return-request.dto';
import { StoreCreateExchangeRequestDto, StoreExchangeRequestResponseDto } from '../dto/store-exchange-request.dto';
import { InjectPublisher, PublisherFor } from '@app/events';
import { CORE_ORDER_STREAM } from '@packages/event-contracts/streams';
import {
  SalesOrderClaimProgressedPayload,
  SalesOrderReturnedPayload,
} from '@packages/event-contracts/streams/orders.stream';
import { WalletRefundClient, WalletRefundOutcome } from './wallet-refund.client';
import { classifyRefundOutcome } from './return-refund-classification';
import { PriorCompletedReturn, returnRefundCap } from './return-refund-cap';
import { lockShipmentConnectedComponentGraph } from '../../fulfillment/services/shipment-reservation.service';
import { ACTIVE_EXCHANGE_STATUSES, ACTIVE_RETURN_STATUSES } from '../line-quantities/claim-statuses';
import { LineQuantities, readLineQuantities } from '../line-quantities/line-quantities.reader';
import { readReturnRequestSalesUnits } from '../line-quantities/claim-quantities.reader';
import { completedSetUnits } from '../line-quantities/line-sales-units';
import { ParcelClaimEligibility, readParcelClaimEligibility } from '../line-quantities/parcel-claim-eligibility.reader';

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

type ClaimKind = 'return' | 'exchange';
/** 반품 요청의 자동 환불 금액 — 세트 일부만 돌아온 라인이 있으면 금액을 정할 수 없다(N5). 그 요청은 관리자가 금액을 넣는다(3b). */
type ReturnRefundAmount = { kind: 'amount'; amount: number } | { kind: 'set_partial' };
/** 반품 환불 금액 견적 — 자동 금액이 있으면 그 값, 세트 일부 반품이면 관리자가 넣을 수 있는 상한(K6 PR3b). */
export type ReturnRefundQuote = { kind: 'automatic'; amount: number } | { kind: 'admin_amount'; cap: number };
/** 환불 판단에 쓰는 주문 칸. */
type RefundSalesOrder = { id: string; walletIntentId: string | null; totalAmount: number | null; shippingFee: number };
/** 요청 줄 — 소포(`shipmentLineId`·`dispatchAttemptId`)는 둘 다 있거나 둘 다 없다. 없으면 게이트가 라인 단위로 펼친다(N2). */
type RequestedClaimLine = {
  salesOrderLineId: string;
  shipmentLineId?: string;
  dispatchAttemptId?: string;
  quantity: number;
};
/** 게이트를 지난 줄 — 소포 칸이 언제나 찬다(N1). 수량은 SKU 단위다(C3). */
type ResolvedClaimLine = {
  salesOrderLineId: string;
  skuId: string;
  shipmentLineId: string;
  dispatchAttemptId: string;
  quantity: number;
};

export const CUSTOM_MADE_CLAIM_MESSAGE =
  '주문제작 인쇄 상품은 반품·교환 신청을 받지 않습니다. 인쇄 불량은 받으신 날부터 5일 안에 고객센터로 문의해 주세요.';

@Injectable()
export class StoreReturnExchangeService {
  private readonly logger = new Logger(StoreReturnExchangeService.name);

  constructor(
    @InjectTypedDb<typeof inventorySchema>()
    private readonly db: { db: PostgresJsDatabase<typeof inventorySchema> },
    private readonly walletRefundClient: WalletRefundClient,
    @InjectPublisher(CORE_ORDER_STREAM)
    private readonly coreOrders: PublisherFor<typeof CORE_ORDER_STREAM>,
  ) {}

  // ── Store: create return request ─────────────────────────────────────────

  async createReturnRequest(
    orderId: string,
    customerId: string,
    dto: StoreCreateReturnRequestDto,
  ): Promise<StoreReturnRequestResponseDto> {
    const so = await this.findSoOrThrow(orderId);
    this.assertOwnership(so, customerId);
    return this.createReturnRequestForActor(orderId, dto, {
      customerId: so.customerId ?? null,
      requestedBy: 'customer',
      actorId: customerId,
    });
  }

  async adminCreateReturnRequest(
    orderId: string,
    adminId: string,
    dto: StoreCreateReturnRequestDto,
  ): Promise<StoreReturnRequestResponseDto> {
    const so = await this.findSoOrThrow(orderId);
    return this.createReturnRequestForActor(orderId, dto, {
      customerId: so.customerId ?? null,
      requestedBy: 'admin',
      actorId: adminId,
    });
  }

  private async createReturnRequestForActor(
    orderId: string,
    dto: StoreCreateReturnRequestDto,
    actor: { customerId: string | null; requestedBy: 'customer' | 'admin'; actorId: string },
  ): Promise<StoreReturnRequestResponseDto> {
    const lineIds = dto.lines.map((l) => l.salesOrderLineId);
    await this.assertLinesBelongToOrder(orderId, lineIds);

    return this.db.db.transaction(async (tx) => {
      // 잠금 뒤 같은 트랜잭션에서 자격을 읽고 검사한다(C4) — 같은 소포를 노리는 두 요청이 남은 수량을 함께 쓰지 못한다.
      const resolvedLines = await this.prepareClaimLines(tx as unknown as DbTx, 'return', orderId, dto.lines);

      const [returnRequest] = await tx
        .insert(returnExchangeTables.returnRequests)
        .values({
          salesOrderId: orderId,
          customerId: actor.customerId,
          status: 'requested',
          reasonCode: dto.reasonCode,
          reasonDetail: dto.reasonDetail ?? null,
          returnAddress: dto.returnAddress ? (dto.returnAddress as Record<string, unknown>) : null,
        })
        .returning();

      if (!returnRequest) throw new Error('RETURN_REQUEST_INSERT_FAILED');

      // 소포 칸은 언제나 찬다(N1) — 라인 단위 요청도 게이트가 펼친 소포를 적는다. 줄 순서는 요청 순서 그대로다
      await tx.insert(returnExchangeTables.returnRequestItems).values(
        resolvedLines.map((line, index) => ({
          returnRequestId: returnRequest.id,
          salesOrderLineId: line.salesOrderLineId,
          shipmentLineId: line.shipmentLineId,
          dispatchAttemptId: line.dispatchAttemptId,
          quantity: line.quantity,
          reasonCode: (dto.lines[index].reasonCode as typeof dto.reasonCode) ?? null,
        })),
      );

      const items = await tx
        .select()
        .from(returnExchangeTables.returnRequestItems)
        .where(eq(returnExchangeTables.returnRequestItems.returnRequestId, returnRequest.id));

      await this.insertBusinessLink(tx, 'return_request', returnRequest.id, orderId, 'return_lifecycle_event', {
        event: 'return_requested',
        requestedBy: actor.requestedBy,
        actorId: actor.actorId,
        customerId: actor.customerId,
        timestamp: new Date().toISOString(),
      });
      await this.enqueueClaimProgress(tx as unknown as DbTx, {
        salesOrderId: orderId,
        kind: 'return',
        stage: 'requested',
        requestId: returnRequest.id,
        requestedBy: actor.requestedBy,
        occurredAt: new Date(),
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

    const lineIds = dto.lines.map((l) => l.salesOrderLineId);
    await this.assertLinesBelongToOrder(orderId, lineIds);
    await this.assertNoCustomMadeLines(lineIds);

    return this.db.db.transaction(async (tx) => {
      // 반품과 같은 게이트(C1·C2) — 자격은 배송완료 소포이고, 잠금 뒤 같은 트랜잭션에서 같은 claimable 로 검사한다(C4)
      const resolvedLines = await this.prepareClaimLines(tx as unknown as DbTx, 'exchange', orderId, dto.lines);

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

      // 소포 칸은 언제나 찬다(N1·C3). 줄 순서는 요청 순서 그대로라 희망 변형은 같은 index 의 요청 줄에서 가져온다
      await tx.insert(returnExchangeTables.exchangeRequestItems).values(
        resolvedLines.map((line, index) => ({
          exchangeRequestId: exchangeRequest.id,
          salesOrderLineId: line.salesOrderLineId,
          shipmentLineId: line.shipmentLineId,
          dispatchAttemptId: line.dispatchAttemptId,
          quantity: line.quantity,
          desiredVariantId: dto.lines[index].desiredVariantId ?? null,
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
      await this.enqueueClaimProgress(tx as unknown as DbTx, {
        salesOrderId: orderId,
        kind: 'exchange',
        stage: 'requested',
        requestId: exchangeRequest.id,
        requestedBy: 'customer',
        occurredAt: new Date(),
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

  async getOrderLinesByChannelOrder(channelOrderId: string, customerId: string): Promise<StoreOrderLinesResponseDto> {
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
      lines: lines.map(
        (l): StoreOrderLineDto => ({
          id: l.id,
          productName: l.productName,
          quantity: l.quantity,
          unitPrice: l.unitPrice ?? null,
          totalPrice: l.totalPrice ?? null,
          variantId: l.variantId,
          customMade: l.almondDesignId != null,
        }),
      ),
    };
  }

  async getReturnEligibility(orderId: string, customerId: string): Promise<StoreReturnEligibilityResponseDto> {
    const so = await this.findSoOrThrow(orderId);
    this.assertOwnership(so, customerId);
    return this.buildReturnEligibility(so.id);
  }

  async adminGetReturnEligibility(orderId: string): Promise<StoreReturnEligibilityResponseDto> {
    const so = await this.findSoOrThrow(orderId);
    return this.buildReturnEligibility(so.id);
  }

  async adminGetReturnEligibilityByChannelOrder(channelOrderId: string): Promise<StoreReturnEligibilityResponseDto> {
    const so = await this.findSoByChannelOrderOrThrow(channelOrderId);
    return this.buildReturnEligibility(so.id);
  }

  /**
   * 배송완료 소포별 청구 자격(K6 PR3a) — `readParcelClaimEligibility` 의 행을 그대로 옮긴다. 산술은 커널 SQL 이 끝냈다.
   * 칸 이름은 그대로 둔다(admin-web `return-attempt-view-model.ts` 가 읽는다). 음수 자격은 표시에서만 0 으로 클램프한다.
   */
  private async buildReturnEligibility(orderId: string): Promise<StoreReturnEligibilityResponseDto> {
    const parcels = await readParcelClaimEligibility(this.db.db, orderId);
    return {
      orderId,
      items: parcels.map((parcel) => ({
        salesOrderLineId: parcel.salesOrderLineId,
        shipmentId: parcel.shipmentId,
        shipmentLineId: parcel.shipmentLineId,
        dispatchAttemptId: parcel.dispatchAttemptId,
        deliveredAt: parcel.deliveredAt,
        shippedQty: parcel.deliveredQty,
        claimedQty: parcel.claimedQty,
        remainingEligibleQty: Math.max(0, parcel.claimable),
        salesOrderLineRemainingEligibleQty: Math.max(0, parcel.skuClaimable),
      })),
    };
  }

  async getReturnEligibilityByChannelOrder(
    channelOrderId: string,
    customerId: string,
  ): Promise<StoreReturnEligibilityResponseDto> {
    const so = await this.findSoByChannelOrderOrThrow(channelOrderId);
    return this.getReturnEligibility(so.id, customerId);
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

      // 승인 시점의 항목 사본(감사 기록). 수량은 SKU 단위 그대로 싣는다 — 합산은 수량 문의 몫이다.
      // 저장된 행을 그대로 옮기는 감사 사본이지 수량 산술이 아니다(읽기 가드는 drizzle `.quantity` 토큰만 막는다).
      const returnReceiptItems = await tx
        .select()
        .from(returnExchangeTables.returnRequestItems)
        .where(eq(returnExchangeTables.returnRequestItems.returnRequestId, returnRequestId))
        .then((items) =>
          items.map((item) => ({
            salesOrderLineId: item.salesOrderLineId,
            shipmentLineId: item.shipmentLineId,
            dispatchAttemptId: item.dispatchAttemptId,
            quantity: item.quantity,
          })),
        );

      const [updated] = await tx
        .update(returnExchangeTables.returnRequests)
        .set({ status: 'approved', decidedAt: new Date(), adminNote: adminNote ?? null, updatedAt: new Date() })
        .where(eq(returnExchangeTables.returnRequests.id, returnRequestId))
        .returning();

      await this.insertBusinessLink(tx, 'return_request', returnRequestId, rr.salesOrderId, 'return_lifecycle_event', {
        event: 'return_approved',
        adminId,
        adminNote: adminNote ?? null,
        returnReceiptItemsVersion: 1,
        returnReceiptItems,
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
      await this.enqueueClaimProgress(tx as unknown as DbTx, {
        salesOrderId: rr.salesOrderId,
        kind: 'return',
        stage: 'collected',
        requestId: returnRequestId,
        occurredAt: new Date(),
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

  /**
   * 반품 완료를 아웃박스로 알린다. 반품 완료 «종점 3곳»이 전부 이 한 줄을 부른다 —
   * `completeReturnRequest`(환불액 0 즉시 완료) · `attemptReturnRefund`(Wallet 환불 성공) ·
   * `manualCompleteReturn`(관리자 수동 완료). 종점이 늘면 여기 호출도 같이 늘려야 한다.
   *
   * 멱등키가 `returnRequestId` 하나이므로 어느 종점을 거쳐도, 몇 번 재시도해도 이벤트는 한 번만
   * 나간다(아웃박스 unique + `onConflictDoNothing`).
   *
   * **반품 완료와 같은 트랜잭션에서 적재한다** — 별도 커밋이면 「반품은 됐는데 알림만 유실」되는
   * 창이 생긴다.
   */
  private async enqueueClaimProgress(
    tx: DbTx,
    claim: Pick<SalesOrderClaimProgressedPayload, 'kind' | 'stage' | 'requestId' | 'requestedBy'> & {
      salesOrderId: string;
      occurredAt: Date;
    },
  ): Promise<void> {
    const [so] = await tx
      .select({
        channelOrderId: wmsTables.salesOrders.channelOrderId,
        displayOrderNo: wmsTables.salesOrders.displayOrderNo,
        salesChannel: wmsTables.salesOrders.salesChannel,
        customerId: wmsTables.salesOrders.customerId,
        customerEmail: wmsTables.salesOrders.customerEmail,
        customerName: wmsTables.salesOrders.customerName,
      })
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, claim.salesOrderId))
      .limit(1);
    if (!so || so.salesChannel !== 'medusa' || !so.customerId) return;

    await this.coreOrders.enqueue(
      {
        idempotencyKey: `so-claim:${claim.kind}:${claim.requestId}:${claim.stage}`,
        eventType: 'SalesOrderClaimProgressed',
        aggregateId: claim.salesOrderId,
        partitionKey: claim.salesOrderId,
        payload: {
          orderId: claim.salesOrderId,
          channelOrderId: so.channelOrderId,
          ...(so.displayOrderNo ? { displayOrderNo: so.displayOrderNo } : {}),
          customerId: so.customerId,
          ...(so.customerEmail ? { customerEmail: so.customerEmail } : {}),
          ...(so.customerName ? { customerName: so.customerName } : {}),
          kind: claim.kind,
          stage: claim.stage,
          requestId: claim.requestId,
          ...(claim.requestedBy ? { requestedBy: claim.requestedBy } : {}),
          occurredAt: claim.occurredAt.toISOString(),
        } satisfies SalesOrderClaimProgressedPayload,
      },
      tx,
    );
  }

  private async enqueueReturnCompletedEvent(
    tx: DbTx,
    returnRequest: ReturnRequestRow,
    completedAt: Date,
  ): Promise<void> {
    await this.enqueueClaimProgress(tx, {
      salesOrderId: returnRequest.salesOrderId,
      kind: 'return',
      stage: 'completed',
      requestId: returnRequest.id,
      occurredAt: completedAt,
    });
    const salesOrder = await tx
      .select({ channelOrderId: wmsTables.salesOrders.channelOrderId })
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, returnRequest.salesOrderId))
      .limit(1)
      .then((rows) => rows[0]);

    // 이 요청의 라인. 주문 라인을 못 찾는 항목은 수량 축을 알 수 없으므로 페이로드에서 «빼되
    // 로그로 센다» — 0으로 뭉개면 소비자가 「전량 반품 아님」과 구별하지 못한다.
    // 항목은 (SKU, 소포) 마다 한 줄이라(C3) 한 라인이 여러 줄일 수 있다 — 페이로드는 라인마다 한 번.
    const requestLineRows = await tx
      .select({
        salesOrderLineId: returnExchangeTables.returnRequestItems.salesOrderLineId,
        channelOrderItemId: wmsTables.salesOrderLines.channelOrderItemId,
        orderedQuantity: wmsTables.salesOrderLines.quantity,
      })
      .from(returnExchangeTables.returnRequestItems)
      .leftJoin(
        wmsTables.salesOrderLines,
        eq(wmsTables.salesOrderLines.id, returnExchangeTables.returnRequestItems.salesOrderLineId),
      )
      .where(eq(returnExchangeTables.returnRequestItems.returnRequestId, returnRequest.id));
    const requestLines = [...new Map(requestLineRows.map((line) => [line.salesOrderLineId, line])).values()];

    const resolved = requestLines.filter(
      (line): line is { salesOrderLineId: string; channelOrderItemId: string | null; orderedQuantity: number } =>
        line.orderedQuantity !== null,
    );
    const unresolved = requestLines.length - resolved.length;
    if (unresolved > 0) {
      this.logger.warn(
        `[ReturnCompleted] ${unresolved} return line(s) of ${returnRequest.id} have no matching sales order line; excluded from SalesOrderReturned payload.`,
      );
    }
    if (resolved.length === 0) {
      this.logger.warn(`[ReturnCompleted] No resolvable lines for return ${returnRequest.id}; event not published.`);
      return;
    }

    // 「이 건의 수량」이 아니라 **그 주문 라인의 완료 반품에서 통째로 돌아온 세트 수**를 싣는다(C7). 이 요청은
    // 방금 completed 로 바뀌었으므로 같은 트랜잭션의 수량 문(`returnConsumed`)에 이미 들어 있다. 나눠 반품해도,
    // 이벤트가 재전달돼도 소비자가 상태 없이 같은 판정을 내릴 수 있게 하는 것이 이 필드의 목적이다.
    // 세트 일부만 돌아온 라인은 0 이라 아래에서 빠진다 — 적립을 과하게 회수하지 않는다(스펙 §6.5).
    const lineQuantities = await readLineQuantities(tx, returnRequest.salesOrderId);
    const returnedSets = (lineId: string): number => {
      const line = lineQuantities.get(lineId);
      return line ? completedSetUnits(line, (sku) => sku.returnConsumed) : 0;
    };

    const returnedLines = resolved
      .map((line) => {
        const remaining = lineQuantities.get(line.salesOrderLineId)?.remaining;
        return {
          salesOrderLineId: line.salesOrderLineId,
          channelOrderItemId: line.channelOrderItemId ?? undefined,
          orderedQuantity: line.orderedQuantity,
          returnedQuantity: returnedSets(line.salesOrderLineId),
          // 주문 − 취소 전부. 출고 뒤 취소가 있으면 소비자가 전량 반품을 이 값으로 판정한다(U3).
          // 음수(초과 취소)는 데이터 오류지만 Wallet 이 이미 환불한 뒤라 발행이 계약 검증에서 죽으면 안 된다 — 0 으로 낸다
          remainingQuantity: remaining === undefined ? undefined : Math.max(0, remaining),
        };
      })
      .filter((line) => line.returnedQuantity > 0);

    if (returnedLines.length === 0) {
      this.logger.warn(
        `[ReturnCompleted] No completed return quantity for return ${returnRequest.id}; event not published.`,
      );
      return;
    }

    await this.coreOrders.enqueue(
      {
        idempotencyKey: `so-returned:${returnRequest.id}`,
        eventType: 'SalesOrderReturned',
        aggregateId: returnRequest.salesOrderId,
        partitionKey: returnRequest.salesOrderId,
        payload: {
          orderId: returnRequest.salesOrderId,
          channelOrderId: salesOrder?.channelOrderId ?? undefined,
          returnRequestId: returnRequest.id,
          reason: returnRequest.reasonCode,
          reasonDetail: returnRequest.reasonDetail ?? undefined,
          returnedAt: completedAt.toISOString(),
          returnedLines,
        } satisfies SalesOrderReturnedPayload,
      },
      tx,
    );
  }

  async completeReturnRequest(returnRequestId: string, adminId: string): Promise<ReturnRequest> {
    // Phase 1: inspected → refund_pending (or completed). 금액 계산도 tx 내에서.
    const phase1 = await this.db.db.transaction(async (tx) => {
      const rr = await this.findReturnRequestOrThrow(returnRequestId, tx, { forUpdate: true });
      if (rr.status !== 'inspected') {
        throw new ConflictException(`반품 요청 상태가 'inspected'가 아닙니다. 현재 상태: ${rr.status}`);
      }

      const salesOrder = await this.findRefundSalesOrder(tx, rr.salesOrderId);
      const refund: ReturnRefundAmount = salesOrder
        ? await this.computeReturnRefundAmount(returnRequestId, salesOrder, tx)
        : { kind: 'amount', amount: 0 };
      // 세트 일부 반품은 자동 금액이 없다 — 관리자가 상한 안에서 금액을 넣어 완료한다(A3)
      if (refund.kind === 'set_partial') {
        throw new BadRequestException('세트 구성품 일부 반품입니다. 환불 금액을 입력해 완료하세요.');
      }
      return this.finishInspectedReturn(tx, rr, salesOrder, refund.amount, adminId, {});
    });

    if (phase1.immediateComplete || !phase1.needsRefund) {
      return phase1.updatedRequest;
    }

    // Phase 2+: 통합 상태기계 (intent-first attempt 행 + 결정적 key)
    return this.attemptReturnRefund(returnRequestId, adminId);
  }

  /**
   * 세트 일부 반품을 관리자가 넣은 금액으로 완료한다(K6 PR3b, U2). 금액은 0 이상 상한 이하(A1)이고
   * 반품 행에 저장돼 재시도가 다시 계산하지 않는다(A6). 그 뒤 갈래는 자동 완료와 같다.
   */
  async completeReturnRequestWithAmount(
    returnRequestId: string,
    adminId: string,
    input: { refundAmount: number; adminNote: string },
  ): Promise<ReturnRequest> {
    const { refundAmount, adminNote } = input;
    const phase1 = await this.db.db.transaction(async (tx) => {
      const rr = await this.findReturnRequestOrThrow(returnRequestId, tx, { forUpdate: true });
      if (rr.status !== 'inspected') {
        throw new ConflictException(`반품 요청 상태가 'inspected'가 아닙니다. 현재 상태: ${rr.status}`);
      }

      const salesOrder = await this.findRefundSalesOrder(tx, rr.salesOrderId);
      const refund: ReturnRefundAmount = salesOrder
        ? await this.computeReturnRefundAmount(returnRequestId, salesOrder, tx)
        : { kind: 'amount', amount: 0 };
      if (!salesOrder || refund.kind !== 'set_partial') {
        throw new BadRequestException('자동 환불 금액이 정해지는 반품입니다. 완료 처리를 사용하세요.');
      }
      const cap = await this.computeAdminRefundCap(tx, returnRequestId, salesOrder);
      if (refundAmount > cap) {
        throw new BadRequestException(`환불 금액이 상한(${cap}원)을 넘습니다.`);
      }

      await tx
        .update(returnExchangeTables.returnRequests)
        .set({ adminRefundAmount: refundAmount, adminNote, updatedAt: new Date() })
        .where(eq(returnExchangeTables.returnRequests.id, returnRequestId));
      return this.finishInspectedReturn(tx, rr, salesOrder, refundAmount, adminId, {
        refundAmountSource: 'admin_input',
        refundAmount,
        refundCap: cap,
        adminNote,
      });
    });

    if (phase1.immediateComplete || !phase1.needsRefund) {
      return phase1.updatedRequest;
    }
    return this.attemptReturnRefund(returnRequestId, adminId);
  }

  /**
   * 검수 끝난 반품의 환불 금액 견적(A7). admin-web 이 «완료 처리» 때 불러 자동 완료와 금액 완료 중 하나를 고른다.
   */
  async getReturnRefundQuote(returnRequestId: string): Promise<ReturnRefundQuote> {
    return this.db.db.transaction(async (tx) => {
      const rr = await this.findReturnRequestOrThrow(returnRequestId, tx);
      if (rr.status !== 'inspected') {
        throw new ConflictException(`환불 금액 견적은 'inspected' 상태에서만 볼 수 있습니다. 현재 상태: ${rr.status}`);
      }
      const salesOrder = await this.findRefundSalesOrder(tx, rr.salesOrderId);
      if (!salesOrder) return { kind: 'automatic', amount: 0 };
      const refund = await this.computeReturnRefundAmount(returnRequestId, salesOrder, tx);
      if (refund.kind === 'amount') return { kind: 'automatic', amount: refund.amount };
      return { kind: 'admin_amount', cap: await this.computeAdminRefundCap(tx, returnRequestId, salesOrder) };
    });
  }

  /**
   * 검수 끝난 반품을 금액으로 다음 상태로 보낸다 — 두 완료(자동·관리자 금액)가 같이 쓴다.
   * 0 → 즉시 `completed` + 완료 이벤트, 그 밖 → `refund_pending`(Wallet 환불 또는 수동 완료 대기).
   */
  private async finishInspectedReturn(
    tx: DbTx,
    rr: ReturnRequestRow,
    salesOrder: RefundSalesOrder | undefined,
    amount: number,
    adminId: string,
    linkExtra: Record<string, unknown>,
  ): Promise<{ updatedRequest: ReturnRequest; immediateComplete: boolean; needsRefund: boolean }> {
    const immediateComplete = amount <= 0;
    const needsRefund = !immediateComplete && !!salesOrder?.walletIntentId;

    const now = new Date();
    const nextStatus = immediateComplete ? 'completed' : 'refund_pending';
    const [result] = await tx
      .update(returnExchangeTables.returnRequests)
      .set({ status: nextStatus, ...(immediateComplete ? { completedAt: now } : {}), updatedAt: now })
      .where(eq(returnExchangeTables.returnRequests.id, rr.id))
      .returning();
    await this.insertBusinessLink(tx, 'return_request', rr.id, rr.salesOrderId, 'return_lifecycle_event', {
      event: immediateComplete ? 'return_completed' : 'return_refund_pending',
      adminId,
      timestamp: now.toISOString(),
      ...linkExtra,
    });
    if (immediateComplete) {
      await this.enqueueReturnCompletedEvent(tx, rr, now);
    }

    if (!immediateComplete && salesOrder && !salesOrder.walletIntentId) {
      this.logger.warn(
        `[ReturnRefund] No walletIntentId for SO ${salesOrder.id}, return ${rr.id}. Manual refund required.`,
      );
    }
    return { updatedRequest: result, immediateComplete, needsRefund };
  }

  /**
   * refund_pending 반품을 Wallet 환불로 종결(성공)하거나 재시도 가능 상태로 유지한다.
   * intent-first attempt 행이 idempotency key·amount 의 SoT (규율 2). 초회·재시도 공용.
   *
   * Phase A(tx, FOR UPDATE): 행 잠금 + pending attempt 재사용 or 신규 attempt INSERT (Wallet 호출 전 durable)
   * Phase B(tx 밖): attempt 행의 key·amount 로 Wallet 호출
   * Phase C(tx, FOR UPDATE): classifyRefundOutcome 로 attempt 행 + 반품 상태 전이
   */
  private async attemptReturnRefund(returnRequestId: string, adminId: string): Promise<ReturnRequest> {
    // ── Phase A ──────────────────────────────────────────────────────────────
    const claim = await this.db.db.transaction(async (tx) => {
      const rr = await this.findReturnRequestOrThrow(returnRequestId, tx, { forUpdate: true });
      if (rr.status === 'completed') {
        return { done: rr, attempt: null, walletIntentId: null as string | null };
      }
      if (rr.status !== 'refund_pending') {
        throw new ConflictException(`환불 시도는 'refund_pending' 상태에서만 가능합니다. 현재 상태: ${rr.status}`);
      }

      const salesOrder = await tx
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
        throw new BadRequestException('walletIntentId가 없어 환불이 불가합니다. 수동 완료를 사용하세요.');
      }

      // pending attempt 재사용 (복구/in-flight) — 같은 key·amount (규율 2)
      const pending = await tx
        .select()
        .from(returnExchangeTables.returnRefundAttempts)
        .where(
          and(
            eq(returnExchangeTables.returnRefundAttempts.returnRequestId, returnRequestId),
            eq(returnExchangeTables.returnRefundAttempts.status, 'pending'),
          ),
        )
        .orderBy(desc(returnExchangeTables.returnRefundAttempts.attemptNumber))
        .limit(1)
        .then((r) => r[0]);

      if (pending) {
        return { done: null, attempt: pending, walletIntentId: salesOrder.walletIntentId };
      }

      // 신규 attempt (N = max+1) — 규율 1: pending 없을 때만(직전 확정 failed 또는 최초)
      // 관리자가 넣은 금액이 있으면 다시 계산하지 않는다(A6). 없으면 자동 금액 — 세트 일부인데 금액이 없는 행은
      // 3a 의 임시 갈래(N5)가 남긴 refund_pending 이라 수동 완료로 보낸다.
      let amount: number;
      if (rr.adminRefundAmount !== null) {
        amount = rr.adminRefundAmount;
      } else {
        const refund = await this.computeReturnRefundAmount(returnRequestId, salesOrder, tx);
        if (refund.kind === 'set_partial') {
          throw new BadRequestException('세트 구성품 일부 반품은 자동 환불 금액이 없습니다. 수동 완료를 사용하세요.');
        }
        amount = refund.amount;
      }
      if (amount <= 0) {
        throw new BadRequestException('환불 금액이 0원 이하입니다. 수동 완료를 사용하세요.');
      }
      const maxRow = await tx
        .select({ maxN: max(returnExchangeTables.returnRefundAttempts.attemptNumber) })
        .from(returnExchangeTables.returnRefundAttempts)
        .where(eq(returnExchangeTables.returnRefundAttempts.returnRequestId, returnRequestId))
        .then((r) => r[0]);
      const attemptNumber = (maxRow?.maxN ?? 0) + 1;
      const idempotencyKey = `return:${returnRequestId}:refund:${attemptNumber}`;
      const [attempt] = await tx
        .insert(returnExchangeTables.returnRefundAttempts)
        .values({ returnRequestId, attemptNumber, idempotencyKey, amount, status: 'pending' })
        .returning();
      return { done: null, attempt, walletIntentId: salesOrder.walletIntentId };
    });

    if (claim.done) return claim.done;
    const attempt = claim.attempt;

    // ── Phase B (tx 밖) ────────────────────────────────────────────────────────
    let outcome: WalletRefundOutcome;
    try {
      outcome = await this.walletRefundClient.refundByIntent(claim.walletIntentId, attempt.amount, {
        kind: 'RETURN',
        reasonCode: 'RETURN_COMPLETED',
        correlationId: attempt.idempotencyKey,
      });
    } catch (err) {
      // 네트워크 예외 등 = 불확정. attempt pending 유지 → 같은 key 재생 (규율 1).
      this.logger.error(
        `[ReturnRefund] Wallet call threw for return ${returnRequestId} attempt ${attempt.attemptNumber}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return this.db.db.transaction((tx) => this.findReturnRequestOrThrow(returnRequestId, tx));
    }

    // ── Phase C ──────────────────────────────────────────────────────────────
    const decision = classifyRefundOutcome(outcome);
    return this.db.db.transaction(async (tx) => {
      const rr = await this.findReturnRequestOrThrow(returnRequestId, tx, { forUpdate: true });
      await this.insertRefundAuditLink(tx, returnRequestId, attempt, outcome, adminId);

      const walletOutcomeMeta = {
        kind: outcome.kind,
        errorCode: 'errorCode' in outcome ? outcome.errorCode : undefined,
      };

      if (decision === 'succeeded') {
        await tx
          .update(returnExchangeTables.returnRefundAttempts)
          .set({ status: 'succeeded', walletOutcome: walletOutcomeMeta, updatedAt: new Date() })
          .where(eq(returnExchangeTables.returnRefundAttempts.id, attempt.id));
        if (rr.status === 'completed') return rr; // 경합: 이미 완료
        const now = new Date();
        const [completed] = await tx
          .update(returnExchangeTables.returnRequests)
          .set({ status: 'completed', completedAt: now, updatedAt: now })
          .where(eq(returnExchangeTables.returnRequests.id, returnRequestId))
          .returning();
        await this.enqueueReturnCompletedEvent(tx, rr, now);
        return completed;
      }

      if (decision === 'failed') {
        // 경합 방어: 동시 success 가 이미 완료시킨 attempt 를 stale failed 로 뒤집지 않는다
        // (뒤집으면 다음 재시도가 N+1 새 key 로 이중환불 경로를 연다). Phase C 는 return_request
        // FOR UPDATE 로 직렬화 → rr.status==='completed' 확인이 "first terminal wins" 를 보장.
        if (rr.status === 'completed') return rr;
        // 확정 실패 → attempt 닫음 (다음 재시도가 N+1). RR refund_pending 유지.
        await tx
          .update(returnExchangeTables.returnRefundAttempts)
          .set({ status: 'failed', walletOutcome: walletOutcomeMeta, updatedAt: new Date() })
          .where(eq(returnExchangeTables.returnRefundAttempts.id, attempt.id));
        this.logger.error(
          `[ReturnRefund] Determinate failure for return ${returnRequestId} attempt ${attempt.attemptNumber}: ${JSON.stringify(walletOutcomeMeta)}`,
        );
        return rr;
      }

      // decision === 'pending' — 불확정. attempt pending 유지(같은 key 재생), RR refund_pending 유지.
      if (rr.status === 'completed') return rr; // 경합: 동시 success 완료분을 덮어쓰지 않음
      await tx
        .update(returnExchangeTables.returnRefundAttempts)
        .set({ walletOutcome: walletOutcomeMeta, updatedAt: new Date() })
        .where(eq(returnExchangeTables.returnRefundAttempts.id, attempt.id));
      this.logger.warn(
        `[ReturnRefund] Indeterminate outcome for return ${returnRequestId} attempt ${attempt.attemptNumber} (${outcome.kind}). Staying refund_pending; same key retries.`,
      );
      return rr;
    });
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

      await this.insertBusinessLink(
        tx,
        'exchange_request',
        exchangeRequestId,
        er.salesOrderId,
        'exchange_lifecycle_event',
        {
          event: 'exchange_collection_pending',
          adminId,
          timestamp: new Date().toISOString(),
        },
      );

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

      await this.insertBusinessLink(
        tx,
        'exchange_request',
        exchangeRequestId,
        er.salesOrderId,
        'exchange_lifecycle_event',
        {
          event: 'exchange_collected',
          adminId,
          timestamp: new Date().toISOString(),
        },
      );
      await this.enqueueClaimProgress(tx as unknown as DbTx, {
        salesOrderId: er.salesOrderId,
        kind: 'exchange',
        stage: 'collected',
        requestId: exchangeRequestId,
        occurredAt: new Date(),
      });

      return updated;
    });
  }

  async approveExchangeRequest(
    exchangeRequestId: string,
    adminId: string,
    adminNote?: string,
  ): Promise<ExchangeRequest> {
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

      await this.insertBusinessLink(
        tx,
        'exchange_request',
        exchangeRequestId,
        er.salesOrderId,
        'exchange_lifecycle_event',
        {
          event: 'exchange_approved',
          adminId,
          adminNote: adminNote ?? null,
          timestamp: new Date().toISOString(),
        },
      );

      return updated;
    });
  }

  async rejectExchangeRequest(
    exchangeRequestId: string,
    adminId: string,
    adminNote?: string,
  ): Promise<ExchangeRequest> {
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

      await this.insertBusinessLink(
        tx,
        'exchange_request',
        exchangeRequestId,
        er.salesOrderId,
        'exchange_lifecycle_event',
        {
          event: 'exchange_rejected',
          adminId,
          adminNote: adminNote ?? null,
          timestamp: new Date().toISOString(),
        },
      );

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

      await this.insertBusinessLink(
        tx,
        'exchange_request',
        exchangeRequestId,
        er.salesOrderId,
        'exchange_lifecycle_event',
        {
          event: 'exchange_inspected',
          adminId,
          timestamp: new Date().toISOString(),
        },
      );

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
    // walletIntentId·금액 가드는 attemptReturnRefund Phase A 가 수행(BadRequestException).
    return this.attemptReturnRefund(returnRequestId, adminId);
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
      await this.enqueueReturnCompletedEvent(tx, rr, now);

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

      await this.insertBusinessLink(
        tx,
        'exchange_request',
        exchangeRequestId,
        er.salesOrderId,
        'exchange_lifecycle_event',
        {
          event: 'exchange_completed',
          adminId,
          timestamp: new Date().toISOString(),
        },
      );
      await this.enqueueClaimProgress(tx as unknown as DbTx, {
        salesOrderId: er.salesOrderId,
        kind: 'exchange',
        stage: 'completed',
        requestId: exchangeRequestId,
        occurredAt: new Date(),
      });

      return updated;
    });
  }

  // ── Admin: list / detail ─────────────────────────────────────────────────

  async adminListReturnRequests(filters: {
    salesOrderId?: string;
    status?: string;
    createdFrom?: Date;
    createdTo?: Date;
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
    if (filters.createdFrom) conditions.push(gte(returnExchangeTables.returnRequests.createdAt, filters.createdFrom));
    if (filters.createdTo) conditions.push(lte(returnExchangeTables.returnRequests.createdAt, filters.createdTo));
    if (filters.status) {
      conditions.push(
        inArray(returnExchangeTables.returnRequests.status, filters.status.split(',') as ReturnRequestRow['status'][]),
      );
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
    createdFrom?: Date;
    createdTo?: Date;
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
    if (filters.createdFrom) conditions.push(gte(returnExchangeTables.exchangeRequests.createdAt, filters.createdFrom));
    if (filters.createdTo) conditions.push(lte(returnExchangeTables.exchangeRequests.createdAt, filters.createdTo));
    if (filters.status) {
      conditions.push(
        inArray(
          returnExchangeTables.exchangeRequests.status,
          filters.status.split(',') as ExchangeRequestRow['status'][],
        ),
      );
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
    opts?: { forUpdate?: boolean },
  ): Promise<ReturnRequestRow> {
    const base = tx
      .select()
      .from(returnExchangeTables.returnRequests)
      .where(eq(returnExchangeTables.returnRequests.id, returnRequestId));
    const rr = await (opts?.forUpdate ? base.for('update') : base).limit(1).then((r) => r[0]);

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

  // 인쇄물은 주문제작품이라 회수·재판매가 안 된다. 불량은 고객센터가 와우프레스 재작업으로 처리한다.
  // 반품은 창고 배송 기록이 있어야 신청되므로 와우프레스가 직접 보낸 인쇄 줄은 애초에 고를 수 없다 — 교환만 막는다
  private async assertNoCustomMadeLines(lineIds: string[]): Promise<void> {
    if (lineIds.length === 0) return;
    const [customMade] = await this.db.db
      .select({ id: wmsTables.salesOrderLines.id })
      .from(wmsTables.salesOrderLines)
      .where(and(inArray(wmsTables.salesOrderLines.id, lineIds), isNotNull(wmsTables.salesOrderLines.almondDesignId)))
      .limit(1);
    if (customMade) throw new BadRequestException(CUSTOM_MADE_CLAIM_MESSAGE);
  }

  /**
   * 반품·교환 생성 게이트 (K6 PR3a, 스펙 §6.5). 호출자 트랜잭션 안에서 이 순서로 한다:
   *  ① 요청 라인의 FOI 로 연결 그래프 잠금 — 회수·발송·예약 변경과 같은 «그래프 먼저» 순서
   *  ② 주문의 모든 라인을 id 정렬 순으로 `FOR NO KEY UPDATE`(R8) ③ 그 종류의 «진행 중 요청 있음» 409
   *  ④ 소포 단위 청구 자격을 읽는다(잠금 뒤라 동시 요청이 같은 남은 수량을 쓰지 못한다 — F7)
   *  ⑤ 소포 반쪽만 온 줄 400 ⑥ 라인 단위 줄을 소포로 펼친다(N2) ⑦ 소포 합 ≤ 그 소포 `claimable`, (라인, SKU) 합 ≤ `skuClaimable`.
   * 돌려준 줄은 요청 순서를 지키고 같은 소포 줄도 합치지 않는다 — 저장은 요청 모양대로, 검사만 합산한다.
   * 수량은 SKU 단위다(C3). 소포가 이 라인의 배송완료 소포인지는 자격 행(`dispatch_attempt_sources` 기반)에 있는지로 판정한다.
   */
  private async prepareClaimLines(
    tx: DbTx,
    kind: ClaimKind,
    orderId: string,
    lines: RequestedClaimLine[],
  ): Promise<ResolvedClaimLine[]> {
    const label = kind === 'return' ? '반품' : '교환';
    const lineIds = [...new Set(lines.map((line) => line.salesOrderLineId))].sort();

    // ① FOI 가 없는 라인(FO 전·인쇄 외주)은 잠글 그래프가 없다 — 자격 행도 없어 아래에서 400 이 된다
    const foiRows = await tx
      .select({ id: wmsTables.fulfillmentOrderItems.id })
      .from(wmsTables.fulfillmentOrderItems)
      .where(
        and(
          eq(wmsTables.fulfillmentOrderItems.salesOrderId, orderId),
          inArray(wmsTables.fulfillmentOrderItems.salesOrderLineId, lineIds),
        ),
      );
    if (foiRows.length > 0) {
      await lockShipmentConnectedComponentGraph(
        tx,
        foiRows.map((row) => row.id),
      );
    }

    // ② 요청 라인만이 아니라 주문의 모든 라인을 잠근다 — 서로 다른 라인·이어지지 않은 FO 를 건드린 두 요청도
    //    여기서 주문 단위로 줄을 서야 ③ «진행 중 요청 있음» 확인이 둘을 함께 통과시키지 않는다(R8).
    //    NO KEY UPDATE 는 같은 잠금끼리 막아 청구 생성자는 줄을 세우지만, 취소 라인·구성 INSERT 의 FK KEY SHARE 는 막지 않는다.
    await tx
      .select({ id: wmsTables.salesOrderLines.id })
      .from(wmsTables.salesOrderLines)
      .where(eq(wmsTables.salesOrderLines.salesOrderId, orderId))
      .orderBy(asc(wmsTables.salesOrderLines.id))
      .for('no key update');

    // ③
    await this.assertNoActiveClaimRequest(tx, kind, orderId);

    // ④
    const parcels = await readParcelClaimEligibility(tx, orderId);
    const parcelKey = (dispatchAttemptId: string, shipmentLineId: string) => `${dispatchAttemptId}:${shipmentLineId}`;
    const parcelByKey = new Map(
      parcels.map((parcel) => [parcelKey(parcel.dispatchAttemptId, parcel.shipmentLineId), parcel]),
    );

    // ⑤
    if (lines.some((line) => Boolean(line.shipmentLineId) !== Boolean(line.dispatchAttemptId))) {
      throw new BadRequestException('shipmentLineId 와 dispatchAttemptId 는 함께 보내야 합니다.');
    }

    // ⑥
    let lineQuantities: Map<string, LineQuantities> | undefined;
    const resolved: Array<{ line: ResolvedClaimLine; parcel: ParcelClaimEligibility }> = [];
    for (const line of lines) {
      if (line.shipmentLineId && line.dispatchAttemptId) {
        const parcel = parcelByKey.get(parcelKey(line.dispatchAttemptId, line.shipmentLineId));
        if (!parcel || parcel.salesOrderLineId !== line.salesOrderLineId) {
          throw new BadRequestException(
            `배송 완료된 소포가 아니거나 이 주문 라인의 것이 아닙니다: ${line.dispatchAttemptId}/${line.shipmentLineId}`,
          );
        }
        resolved.push({ line: this.toResolvedClaimLine(parcel, line.quantity), parcel });
        continue;
      }

      const candidates = parcels.filter(
        (parcel) => parcel.salesOrderLineId === line.salesOrderLineId && parcel.claimable > 0,
      );
      if (candidates.length === 0) {
        throw new BadRequestException(
          `주문 라인 ${line.salesOrderLineId}에 ${label}할 수 있는 배송 완료 소포가 없습니다.`,
        );
      }
      lineQuantities ??= await readLineQuantities(tx, orderId);
      const composition = (lineQuantities.get(line.salesOrderLineId)?.skus ?? []).filter(
        (sku) => sku.qtyPerUnit !== null,
      );
      // 1개당 수량이 1 인 단품이어야 판매 단위 수량과 SKU 수량이 같은 숫자다 — 그 밖은 같은 숫자가 두 뜻이 된다
      const [only] = candidates;
      if (composition.length !== 1 || composition[0].qtyPerUnit !== 1 || candidates.length !== 1) {
        throw new BadRequestException(
          `주문 라인 ${line.salesOrderLineId}은 소포와 구성품을 지정해야 합니다(후보 ${candidates.length}개). ${label} 가능 목록에서 고르세요.`,
        );
      }
      resolved.push({ line: this.toResolvedClaimLine(only, line.quantity), parcel: only });
    }

    // ⑦ 같은 소포·같은 (라인, SKU) 줄은 합산해 검사한다(F7). 비교는 원값, 문구의 수량만 0 으로 클램프한다(R6)
    const requestedByParcel = new Map<string, { parcel: ParcelClaimEligibility; quantity: number }>();
    const requestedBySku = new Map<string, { parcel: ParcelClaimEligibility; quantity: number }>();
    for (const { line, parcel } of resolved) {
      const byParcel = parcelKey(line.dispatchAttemptId, line.shipmentLineId);
      requestedByParcel.set(byParcel, {
        parcel,
        quantity: (requestedByParcel.get(byParcel)?.quantity ?? 0) + line.quantity,
      });
      const bySku = `${line.salesOrderLineId}:${line.skuId}`;
      requestedBySku.set(bySku, { parcel, quantity: (requestedBySku.get(bySku)?.quantity ?? 0) + line.quantity });
    }
    for (const { parcel, quantity } of requestedByParcel.values()) {
      if (quantity > parcel.claimable) {
        throw new BadRequestException(
          `배송 시도 ${parcel.dispatchAttemptId}의 라인 ${parcel.shipmentLineId} ${label} 가능 수량(${Math.max(0, parcel.claimable)})을 초과하였습니다. (요청: ${quantity})`,
        );
      }
    }
    for (const { parcel, quantity } of requestedBySku.values()) {
      if (quantity > parcel.skuClaimable) {
        throw new BadRequestException(
          `주문 라인 ${parcel.salesOrderLineId} 구성품 ${parcel.skuId}의 ${label} 가능 수량(${Math.max(0, parcel.skuClaimable)})을 초과하였습니다. (요청: ${quantity})`,
        );
      }
    }

    return resolved.map(({ line }) => line);
  }

  private toResolvedClaimLine(parcel: ParcelClaimEligibility, quantity: number): ResolvedClaimLine {
    return {
      salesOrderLineId: parcel.salesOrderLineId,
      skuId: parcel.skuId,
      shipmentLineId: parcel.shipmentLineId,
      dispatchAttemptId: parcel.dispatchAttemptId,
      quantity,
    };
  }

  /** 게이트 ③ — 주문당 진행 중 요청은 종류마다 하나. 옛 `assertNoActiveReturnRequest`·`assertNoActiveExchangeRequest` 의 문구 그대로다. */
  private async assertNoActiveClaimRequest(tx: DbTx, kind: ClaimKind, orderId: string): Promise<void> {
    const [existing] =
      kind === 'return'
        ? await tx
            .select({ id: returnExchangeTables.returnRequests.id })
            .from(returnExchangeTables.returnRequests)
            .where(
              and(
                eq(returnExchangeTables.returnRequests.salesOrderId, orderId),
                inArray(returnExchangeTables.returnRequests.status, [...ACTIVE_RETURN_STATUSES]),
              ),
            )
            .limit(1)
        : await tx
            .select({ id: returnExchangeTables.exchangeRequests.id })
            .from(returnExchangeTables.exchangeRequests)
            .where(
              and(
                eq(returnExchangeTables.exchangeRequests.salesOrderId, orderId),
                inArray(returnExchangeTables.exchangeRequests.status, [...ACTIVE_EXCHANGE_STATUSES]),
              ),
            )
            .limit(1);
    if (existing) {
      throw new ConflictException(
        kind === 'return' ? '이미 진행 중인 반품 요청이 있습니다.' : '이미 진행 중인 교환 요청이 있습니다.',
      );
    }
  }

  /**
   * Verify that every salesOrderLineId in the request belongs to the given order.
   */
  private async assertLinesBelongToOrder(orderId: string, lineIds: string[]): Promise<void> {
    if (lineIds.length === 0) return;

    const rows = await this.db.db
      .select({ id: wmsTables.salesOrderLines.id })
      .from(wmsTables.salesOrderLines)
      .where(and(eq(wmsTables.salesOrderLines.salesOrderId, orderId), inArray(wmsTables.salesOrderLines.id, lineIds)));

    const foundIds = new Set(rows.map((r) => r.id));
    const invalid = lineIds.filter((id) => !foundIds.has(id));
    if (invalid.length > 0) {
      throw new BadRequestException(`다음 주문 라인이 해당 주문에 속하지 않습니다: ${invalid.join(', ')}`);
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
        shipmentLineId: item.shipmentLineId,
        dispatchAttemptId: item.dispatchAttemptId,
        quantity: item.quantity,
      })),
      createdAt: returnRequest.createdAt,
    };
  }

  /**
   * 반품 환불 금액 계산 — 주문 라인과 이 요청의 라인별 판매 단위(수량 문, C6)를 읽어 calculateReturnRefund 위임.
   * 요청 항목 수량은 SKU 단위라(C3) 여기서 직접 읽지 않는다. 세트 일부만 돌아온 라인이 하나라도 있으면 `set_partial`(N5).
   * tx 컨텍스트 전용.
   */
  private async computeReturnRefundAmount(
    returnRequestId: string,
    salesOrder: { id: string; totalAmount: number | null; shippingFee: number },
    tx: Parameters<Parameters<typeof this.db.db.transaction>[0]>[0],
  ): Promise<ReturnRefundAmount> {
    const allOrderLines = await tx
      .select({
        id: wmsTables.salesOrderLines.id,
        quantity: wmsTables.salesOrderLines.quantity,
        unitPrice: wmsTables.salesOrderLines.unitPrice,
        totalPrice: wmsTables.salesOrderLines.totalPrice,
      })
      .from(wmsTables.salesOrderLines)
      .where(eq(wmsTables.salesOrderLines.salesOrderId, salesOrder.id));
    const salesUnits = await readReturnRequestSalesUnits(tx, returnRequestId);

    const unitsByLine = new Map<string, number>();
    for (const [lineId, units] of salesUnits) {
      if (units.kind === 'set_partial') return { kind: 'set_partial' };
      unitsByLine.set(lineId, units.units);
    }
    // 관리자 금액으로 완료한 앞선 반품이 건드린 라인은 자동 공식이 그 몫을 모른다 — 관리자 경로와 상한으로 보낸다(A8)
    const priors = await this.readPriorCompletedReturns(tx, salesOrder.id, returnRequestId);
    const touchedByAdminAmount = [...priors.values()].some(
      (prior) => prior.adminRefundAmount !== null && [...prior.lineIds].some((lineId) => unitsByLine.has(lineId)),
    );
    if (touchedByAdminAmount) return { kind: 'set_partial' };
    return {
      kind: 'amount',
      amount: this.calculateReturnRefund(
        unitsByLine,
        allOrderLines,
        salesOrder.totalAmount ?? null,
        salesOrder.shippingFee ?? 0,
      ),
    };
  }

  /**
   * 세트 일부 반품의 관리자 환불 상한(K6 PR3b) — 주문 라인·남은 수량(U1)·이 요청이 건드린 라인·앞선 완료 반품의
   * 아는 환불액(A4)을 모아 `returnRefundCap` 에 넘긴다. 청구 항목은 라인 id 만 읽는다(수량은 수량 문의 몫).
   */
  private async computeAdminRefundCap(
    tx: DbTx,
    returnRequestId: string,
    salesOrder: { id: string; totalAmount: number | null; shippingFee: number },
  ): Promise<number> {
    const orderLines = await tx
      .select({
        id: wmsTables.salesOrderLines.id,
        quantity: wmsTables.salesOrderLines.quantity,
        unitPrice: wmsTables.salesOrderLines.unitPrice,
        totalPrice: wmsTables.salesOrderLines.totalPrice,
      })
      .from(wmsTables.salesOrderLines)
      .where(eq(wmsTables.salesOrderLines.salesOrderId, salesOrder.id));
    const lineQuantities = await readLineQuantities(tx, salesOrder.id);
    const touchedLineIds = new Set((await readReturnRequestSalesUnits(tx, returnRequestId)).keys());

    const lineIdsByPrior = await this.readPriorCompletedReturns(tx, salesOrder.id, returnRequestId);

    const attempts = returnExchangeTables.returnRefundAttempts;
    const succeededRows =
      lineIdsByPrior.size === 0
        ? []
        : await tx
            .select({ returnRequestId: attempts.returnRequestId, amount: attempts.amount })
            .from(attempts)
            .where(
              and(inArray(attempts.returnRequestId, [...lineIdsByPrior.keys()]), eq(attempts.status, 'succeeded')),
            );
    const refundedByPrior = new Map<string, number>();
    for (const row of succeededRows) {
      refundedByPrior.set(row.returnRequestId, (refundedByPrior.get(row.returnRequestId) ?? 0) + row.amount);
    }
    const priorReturns: PriorCompletedReturn[] = [...lineIdsByPrior].map(([id, { lineIds }]) => ({
      lineIds: [...lineIds],
      refundedAmount: refundedByPrior.get(id) ?? null,
    }));

    return returnRefundCap({
      // 수량 문이 늘 주문의 모든 라인을 낸다 — 못 찾으면 0(과환불 쪽으로 기울지 않는다)
      orderLines: orderLines.map((line) => ({ ...line, remaining: lineQuantities.get(line.id)?.remaining ?? 0 })),
      touchedLineIds,
      priorReturns,
      totalAmount: salesOrder.totalAmount ?? null,
      shippingFee: salesOrder.shippingFee ?? 0,
    });
  }

  /**
   * 같은 주문의 앞선 완료 반품(이 요청 제외) — 요청마다 건드린 라인 id 와 관리자가 넣은 금액(없으면 null).
   * 상한(A4)과 자동 금액의 관리자 경로 판정(A8)이 같이 쓴다. 청구 항목은 라인 id 만 읽는다(수량은 수량 문의 몫).
   */
  private async readPriorCompletedReturns(
    tx: DbTx,
    salesOrderId: string,
    returnRequestId: string,
  ): Promise<Map<string, { lineIds: Set<string>; adminRefundAmount: number | null }>> {
    const requests = returnExchangeTables.returnRequests;
    const items = returnExchangeTables.returnRequestItems;
    const rows = await tx
      .select({
        returnRequestId: requests.id,
        adminRefundAmount: requests.adminRefundAmount,
        salesOrderLineId: items.salesOrderLineId,
      })
      .from(requests)
      .innerJoin(items, eq(items.returnRequestId, requests.id))
      .where(
        and(
          eq(requests.salesOrderId, salesOrderId),
          eq(requests.status, 'completed'),
          ne(requests.id, returnRequestId),
        ),
      );
    const priors = new Map<string, { lineIds: Set<string>; adminRefundAmount: number | null }>();
    for (const row of rows) {
      const prior = priors.get(row.returnRequestId) ?? {
        lineIds: new Set<string>(),
        adminRefundAmount: row.adminRefundAmount,
      };
      prior.lineIds.add(row.salesOrderLineId);
      priors.set(row.returnRequestId, prior);
    }
    return priors;
  }

  /** 환불 판단에 쓰는 주문 칸 — 없으면 undefined. */
  private async findRefundSalesOrder(tx: DbTx, salesOrderId: string): Promise<RefundSalesOrder | undefined> {
    return tx
      .select({
        id: wmsTables.salesOrders.id,
        walletIntentId: wmsTables.salesOrders.walletIntentId,
        totalAmount: wmsTables.salesOrders.totalAmount,
        shippingFee: wmsTables.salesOrders.shippingFee,
      })
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, salesOrderId))
      .limit(1)
      .then((r) => r[0]);
  }

  /** 환불 시도 감사 로그 (기존 return_linked_wallet_refund businessLink 연속 — 상태 SoT 는 attempt 행). */
  private async insertRefundAuditLink(
    tx: Parameters<Parameters<typeof this.db.db.transaction>[0]>[0],
    returnRequestId: string,
    attempt: { idempotencyKey: string; amount: number; attemptNumber: number },
    outcome: WalletRefundOutcome,
    adminId: string,
  ): Promise<void> {
    const refundId =
      outcome.kind === 'success' || outcome.kind === 'partial_pending' ? outcome.refunds?.[0]?.refundId : undefined;
    await tx.insert(wmsTables.businessLinks).values({
      sourceType: 'return_request',
      sourceId: returnRequestId,
      targetType: 'wallet_refund',
      targetExternalRef: refundId ? `wallet:refund:${refundId}` : `wallet:key:${attempt.idempotencyKey}`,
      relationName: 'return_linked_wallet_refund',
      metadata: {
        outcome: outcome.kind,
        amount: attempt.amount,
        correlationId: attempt.idempotencyKey,
        attemptN: attempt.attemptNumber,
        retriedBy: adminId,
      },
    });
  }

  /**
   * 반품 환불 금액 계산. `unitsByLine` = 판매 라인별 반품 판매 단위(같은 라인의 여러 항목을 수량 문이 합했다, F2).
   * - 전체 반품: totalAmount (배송비 포함한 실제 결제 금액)
   * - 부분 반품: (반품 라인 합계 / 전체 라인 합계) × (totalAmount - shippingFee)
   *   → 주문 레벨 할인을 라인 비중으로 배분. 부분 반품에는 배송비 미포함.
   * - totalAmount 없음 또는 라인 무게 합 0: unitPrice × 판매 단위 합.
   */
  private calculateReturnRefund(
    unitsByLine: ReadonlyMap<string, number>,
    allLines: { id: string; quantity: number; unitPrice: number | null; totalPrice: number | null }[],
    orderTotalAmount: number | null,
    orderShippingFee: number,
  ): number {
    const orderTotal = orderTotalAmount ?? 0;
    const unitPriceSum = (): number =>
      allLines.reduce((acc, l) => acc + (unitsByLine.get(l.id) ?? 0) * (l.unitPrice ?? 0), 0);

    if (orderTotal <= 0 || allLines.length === 0) {
      // totalAmount 정보 없음: 단순 unitPrice × 수량 합산으로 폴백
      return unitPriceSum();
    }

    const isFullReturn = allLines.every((l) => (unitsByLine.get(l.id) ?? 0) >= l.quantity);

    if (isFullReturn) {
      return orderTotal;
    }

    // totalPrice 또는 unitPrice × quantity를 라인 무게로 사용 (분모·분자 동일 기준)
    const lineWeight = (l: { unitPrice: number | null; quantity: number; totalPrice: number | null }): number =>
      l.totalPrice ?? (l.unitPrice ?? 0) * l.quantity;

    const allLinesTotals = allLines.reduce((acc, l) => acc + lineWeight(l), 0);
    if (allLinesTotals <= 0) {
      return unitPriceSum();
    }

    const returnedLinesTotals = allLines.reduce((acc, l) => {
      const returnQty = unitsByLine.get(l.id) ?? 0;
      if (returnQty <= 0 || l.quantity <= 0) return acc;
      // 라인 무게를 반품수량 비율로 배분 (할인 포함 기준)
      return acc + (lineWeight(l) * returnQty) / l.quantity;
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
        shipmentLineId: item.shipmentLineId ?? null,
        dispatchAttemptId: item.dispatchAttemptId ?? null,
        quantity: item.quantity,
        desiredVariantId: item.desiredVariantId ?? undefined,
      })),
      createdAt: exchangeRequest.createdAt,
    };
  }
}
