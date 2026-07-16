import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectTypedDb } from '@app/db';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  inventorySchema,
  inventoryTables,
  returnExchangeTables,
  DbTx,
  wmsTables,
} from '../../inventory/schema/inventory.schema';
import { calculatePartialCancellationRefund } from './partial-cancellation-refund-calculator';
import {
  RefundSummaryDto,
  StoreCancelOrderDto,
  StoreCancelUnavailableReason,
  StoreClaimStatus,
  StoreFulfillmentStatus,
  StoreOrderAction,
  StoreOrderActionsResponseDto,
  StoreRefundStatus,
} from '../dto/store-order-actions.dto';
import { StoreOrderTrackingResponseDto, StoreShipmentDto } from '../dto/store-order-tracking.dto';
import { SalesOrdersService } from './sales-orders.service';
import { WalletRefundClient } from './wallet-refund.client';

type SalesOrderRow = typeof inventoryTables.salesOrders.$inferSelect;
type FoRow = { status: string; shippedAt: Date | null };

const CHANNEL_CANCEL_URLS: Record<string, { cancelUrl: string; returnUrl: string }> = {
  naver: {
    cancelUrl: 'https://smartstore.naver.com/my/orders',
    returnUrl: 'https://smartstore.naver.com/my/orders',
  },
  coupang: {
    cancelUrl: 'https://mc.coupang.com/ssr/desktop/order/list',
    returnUrl: 'https://mc.coupang.com/ssr/desktop/order/list',
  },
};

const FO_DELIVERED_STATUSES = new Set(['completed']);
const FO_SHIPPED_STATUSES = new Set(['shipped', 'completed']);
const FO_PACKED_STATUSES = new Set(['picked', 'inspecting', 'invoiced', 'labeled', 'forwarded']);
const FO_PICKING_STATUSES = new Set(['picking', 'allocated']);

const ACTIVE_RETURN_STATUSES = [
  'requested',
  'approved',
  'collection_pending',
  'collected',
  'inspected',
  'refund_pending',
] as const;
const ACTIVE_EXCHANGE_STATUSES = [
  'requested',
  'approved',
  'collection_pending',
  'collected',
  'inspected',
  'refund_pending',
] as const;
const VALID_REFUND_STATUSES = new Set<StoreRefundStatus>(['none', 'pending', 'manual_pending', 'succeeded', 'failed']);

@Injectable()
export class StoreSalesOrdersService {
  private readonly logger = new Logger(StoreSalesOrdersService.name);

  constructor(
    @InjectTypedDb<typeof inventorySchema>()
    private readonly db: { db: import('drizzle-orm/postgres-js').PostgresJsDatabase<typeof inventorySchema> },
    private readonly salesOrdersService: SalesOrdersService,
    private readonly walletRefundClient: WalletRefundClient,
  ) {}

  // ── 공개 메서드: Core SO UUID 기반 ──────────────────────────────────────

  async getActions(orderId: string, customerId: string): Promise<StoreOrderActionsResponseDto> {
    const so = await this.findSoOrThrow({ id: orderId }, customerId);
    return this.buildActionsView(so);
  }

  async cancelRequest(
    orderId: string,
    customerId: string,
    dto: StoreCancelOrderDto,
    fulfillmentCommandContext?: { idempotencyKey: string; actorId: string; actorRoles: string[] },
  ): Promise<StoreOrderActionsResponseDto> {
    const so = await this.findSoOrThrow({ id: orderId }, customerId);
    return this.processCancelRequest(so, customerId, dto, fulfillmentCommandContext);
  }

  /**
   * 관리자 취소 + Wallet 환불 orchestration.
   * 전체취소: Core 취소 → Wallet 자동 환불 시도 → 결과 기록.
   * 부분취소: Core 취소 → 환불 추정액 계산 → manual_pending 기록 (자동 환불 없음).
   * walletIntentId가 없으면 환불은 manual_pending으로 기록되고 취소는 완료된다.
   */
  async adminCancelRequest(
    orderId: string,
    dto: {
      reasonCode?: string;
      reasonDetail?: string;
      lines?: Array<{ salesOrderLineId: string; quantity: number }>;
      fulfillmentCommandContext?: { idempotencyKey: string; actorId: string; actorRoles: string[] };
    },
  ): Promise<{ status: string; refundStatus: string; refundEstimateAmount?: number; manualReason?: string | null }> {
    const so = await this.findSoOrThrow({ id: orderId });
    if (
      dto.fulfillmentCommandContext &&
      (await this.salesOrdersService.validateCancellationReplay(so.id, {
        sourceKey: dto.fulfillmentCommandContext.idempotencyKey,
        reasonCode: dto.reasonCode,
        reasonDetail: dto.reasonDetail,
        lines: dto.lines,
      }))
    ) {
      const replay = await this.buildActionsView(so);
      return { status: so.status, refundStatus: replay.refundStatus };
    }
    if (so.status === 'cancelled') throw new BadRequestException('이미 취소된 주문입니다.');
    if (so.status === 'timeout') throw new BadRequestException('타임아웃된 주문은 취소할 수 없습니다.');

    await this.salesOrdersService.cancel(so.id, {
      reasonCode: dto.reasonCode,
      reasonDetail: dto.reasonDetail,
      lines: dto.lines,
      cancelledBy: 'admin',
      fulfillmentCommandContext: dto.fulfillmentCommandContext,
    });

    if (dto.lines && dto.lines.length > 0) {
      const orderLines = await this.db.db
        .select({
          id: wmsTables.salesOrderLines.id,
          quantity: wmsTables.salesOrderLines.quantity,
          unitPrice: wmsTables.salesOrderLines.unitPrice,
        })
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.salesOrderId, so.id));

      const calcResult = calculatePartialCancellationRefund({
        salesChannel: so.salesChannel,
        walletIntentId: so.walletIntentId,
        totalAmount: so.totalAmount,
        shippingFee: (so as SalesOrderRow & { shippingFee?: number | null }).shippingFee ?? 0,
        allOrderLines: orderLines,
        cancelledLines: dto.lines,
      });

      const refreshed = await this.findSoOrThrow({ id: orderId });

      // 부분취소는 정책상 자동환불 없음 — 항상 manual_pending으로 기록.
      // calcResult.manualRequired는 항상 true이며, refundEstimateAmount는
      // 비례 배분 추정값이다. 실제 환불은 운영자가 검토 후 수동 처리한다.
      await this.recordWalletRefundLink(so.id, {
        refundStatus: 'manual_pending',
        intentId: so.walletIntentId ?? undefined,
        note: `부분취소 수동 검토 필요: ${calcResult.manualReason}`,
        reasonCode: dto.reasonCode,
        extraMetadata: {
          cancellationScope: 'partial',
          manualReason: calcResult.manualReason,
          refundEstimateAmount: calcResult.refundEstimateAmount,
          breakdown: calcResult.breakdown,
          cancelledLines: dto.lines,
          warnings: calcResult.warnings,
        },
      });
      return {
        status: refreshed.status,
        refundStatus: 'manual_pending',
        refundEstimateAmount: calcResult.refundEstimateAmount,
        manualReason: calcResult.manualReason,
      };
    }

    const refundOptions = { actor: 'admin' as const, attemptType: 'initial' as const };
    const refundStatus = dto.fulfillmentCommandContext
      ? await this.requestWalletRefundOnce(
          { ...so, status: 'cancelled' } as SalesOrderRow,
          { reasonCode: dto.reasonCode },
          dto.fulfillmentCommandContext.idempotencyKey,
          refundOptions,
        )
      : await this.requestWalletRefundAfterCancel(
          { ...so, status: 'cancelled' } as SalesOrderRow,
          { reasonCode: dto.reasonCode },
          refundOptions,
        );

    return { status: 'cancelled', refundStatus };
  }

  /**
   * Wallet 에서 이미 환불이 완료된 결제(무통장 환불신청 승인 등)의 주문을 취소한다.
   * core→wallet 재환불 없이 sales_order 취소 + 재고 복원만 수행하고, walletRefund effect 를
   * SUCCEEDED 로 기록해 감사 타임라인에 남긴다. walletIntentId 로 medusa 주문을 찾으며,
   * 없거나(직접결제 등) 이미 취소/출고면 멱등 처리한다.
   */
  async cancelByWalletIntentAfterRefund(
    intentId: string,
    opts: { reasonCode?: string; amount?: number } = {},
  ): Promise<{ status: string; skipped?: string }> {
    const so = await this.db.db
      .select()
      .from(inventoryTables.salesOrders)
      .where(
        and(
          eq(inventoryTables.salesOrders.walletIntentId, intentId),
          eq(inventoryTables.salesOrders.salesChannel, 'medusa'),
        ),
      )
      .limit(1)
      .then((r) => r[0]);

    if (!so) return { status: 'skipped', skipped: 'no_sales_order' };
    if (so.status === 'cancelled') return { status: 'cancelled', skipped: 'already_cancelled' };
    if (so.status === 'shipped' || so.status === 'delivered') {
      this.logger.warn(
        `[cancelByWalletIntentAfterRefund] SO ${so.id} already ${so.status} (intent=${intentId}). 환불은 완료됐으나 출고 이후라 취소 스킵.`,
      );
      return { status: so.status, skipped: 'already_shipped' };
    }

    await this.salesOrdersService.cancel(so.id, {
      reasonCode: opts.reasonCode ?? 'CUSTOMER_REFUND_REQUEST',
      cancelledBy: 'admin:refund-approval',
      walletRefund: {
        externalRef: `wallet:refund:intent:${intentId}`,
        refundStatus: 'SUCCEEDED',
        ...(opts.amount ? { amount: opts.amount } : {}),
      },
    });

    this.logger.log(
      `[cancelByWalletIntentAfterRefund] SO ${so.id} cancelled (intent=${intentId}, refund already done in wallet)`,
    );
    return { status: 'cancelled' };
  }

  /**
   * 운영자 수동 환불 완료 확인.
   *
   * PG/은행 환불을 이미 외부에서 처리한 사실을 운영자가 확인하고 내부 상태를 완료로 기록한다.
   * provider.refund()를 호출하지 않으므로 "자동 환불 완료"와 명확히 구분된다.
   * - succeeded: 이미 완료 → idempotent 반환
   * - manual_pending / failed / 링크 없음: 새 business link로 succeeded(manual) 기록
   * - pending: 비동기 처리 중 — 결제 관리에서 상태 확인 후 처리하도록 안내
   */
  async adminManualRefundComplete(
    orderId: string,
    dto: { adminNote?: string; refundLinkId?: string },
  ): Promise<{ refundStatus: string; completionType: string }> {
    const so = await this.findSoOrThrow({ id: orderId });

    // Resolve target link: if refundLinkId given, target that specific link;
    // otherwise find the most recent manual_pending link (supports partial cancellations).
    const targetRefundLink = await (async () => {
      if (dto.refundLinkId) {
        return this.db.db
          .select({ id: inventoryTables.businessLinks.id, metadata: inventoryTables.businessLinks.metadata })
          .from(inventoryTables.businessLinks)
          .where(
            and(
              eq(inventoryTables.businessLinks.id, dto.refundLinkId),
              eq(inventoryTables.businessLinks.sourceType, 'sales_order'),
              eq(inventoryTables.businessLinks.sourceId, so.id),
              eq(inventoryTables.businessLinks.relationName, 'cancellation_linked_wallet_refund'),
            ),
          )
          .limit(1)
          .then((r) => r[0]);
      }
      // No refundLinkId: find the most recent manual_pending link that hasn't been
      // closed by a subsequent completion record (same exclusion logic as admin-web UI).
      return this.db.db
        .select({ id: inventoryTables.businessLinks.id, metadata: inventoryTables.businessLinks.metadata })
        .from(inventoryTables.businessLinks)
        .where(
          and(
            eq(inventoryTables.businessLinks.sourceType, 'sales_order'),
            eq(inventoryTables.businessLinks.sourceId, so.id),
            eq(inventoryTables.businessLinks.relationName, 'cancellation_linked_wallet_refund'),
          ),
        )
        .orderBy(desc(inventoryTables.businessLinks.createdAt))
        .then((rows) => {
          const completedIds = new Set<string>(
            rows
              .filter((r) => {
                const m = r.metadata as Record<string, unknown>;
                return m?.refundStatus === 'succeeded' && typeof m?.completedRefundLinkId === 'string';
              })
              .map((r) => (r.metadata as Record<string, unknown>).completedRefundLinkId as string),
          );
          return (
            rows.find((r) => {
              const m = r.metadata as Record<string, unknown>;
              return m?.refundStatus === 'manual_pending' && !completedIds.has(r.id);
            }) ?? null
          );
        });
    })();

    const currentStatus = (targetRefundLink?.metadata as Record<string, unknown>)?.refundStatus as string | undefined;

    // Allow fully-cancelled orders OR orders with a manual_pending link (from partial cancellation).
    if (so.status !== 'cancelled' && currentStatus !== 'manual_pending') {
      throw new BadRequestException('취소된 주문 또는 부분취소 환불 대기 건에만 수동 환불 완료 처리를 할 수 있습니다.');
    }

    if (currentStatus === 'succeeded') {
      return { refundStatus: 'succeeded', completionType: 'manual' };
    }

    if (currentStatus === 'pending') {
      throw new BadRequestException(
        '환불이 처리 중입니다. 결제 > 환불 관리에서 상태를 확인한 후 완료 여부를 판단하세요.',
      );
    }

    await this.recordWalletRefundLink(so.id, {
      refundStatus: 'succeeded',
      intentId: so.walletIntentId ?? undefined,
      note: `운영자 수동 환불 완료 확인${dto.adminNote ? `: ${dto.adminNote}` : ''}`,
      actor: 'admin',
      attemptType: 'retry',
      extraMetadata: {
        completionType: 'manual',
        providerRefundExecuted: false,
        completedRefundLinkId: targetRefundLink?.id ?? null,
      },
    });

    return { refundStatus: 'succeeded', completionType: 'manual' };
  }

  /**
   * 취소 주문의 환불 재시도.
   *
   * - succeeded: 이미 완료 → 재시도 없이 succeeded 반환
   * - pending: 처리 중 → 중복 재시도 없이 pending 반환
   * - manual_pending (walletIntentId/amount 없음): 자동 재시도 불가 → 400
   * - failed / 링크 없음: 새 idempotency key `cancel:{id}:retry:{uuid}`로 Wallet 재호출
   */
  async retryWalletRefund(orderId: string): Promise<{ refundStatus: string }> {
    const so = await this.findSoOrThrow({ id: orderId });
    if (so.status !== 'cancelled') {
      throw new BadRequestException('취소된 주문에만 환불 재시도를 할 수 있습니다.');
    }

    const refundLink = await this.db.db
      .select({ metadata: inventoryTables.businessLinks.metadata })
      .from(inventoryTables.businessLinks)
      .where(
        and(
          eq(inventoryTables.businessLinks.sourceType, 'sales_order'),
          eq(inventoryTables.businessLinks.sourceId, so.id),
          eq(inventoryTables.businessLinks.relationName, 'cancellation_linked_wallet_refund'),
        ),
      )
      .orderBy(desc(inventoryTables.businessLinks.createdAt))
      .limit(1)
      .then((r) => r[0]);

    const currentStatus = (refundLink?.metadata as Record<string, unknown>)?.refundStatus as string | undefined;

    if (currentStatus === 'succeeded') {
      return { refundStatus: 'succeeded' };
    }

    if (currentStatus === 'pending') {
      // 비동기 처리 중 — 중복 재시도 없이 그대로 반환
      return { refundStatus: 'pending' };
    }

    // manual_pending이면서 Wallet 호출에 필요한 정보가 없는 경우 → 수동 처리 필요
    if (!so.walletIntentId) {
      throw new BadRequestException(
        'Wallet 결제 정보가 없어 자동 재시도가 불가합니다. 결제 > 환불 관리에서 수동 처리하세요.',
      );
    }
    if (!so.totalAmount || so.totalAmount <= 0) {
      throw new BadRequestException(
        '환불 금액 정보가 없어 자동 재시도가 불가합니다. 결제 > 환불 관리에서 수동 처리하세요.',
      );
    }

    // failed 또는 링크 없음 → 새 per-attempt key로 실제 PG 재호출
    const refundStatus = await this.requestWalletRefundAfterCancel(
      so,
      {},
      {
        attemptType: 'retry',
        actor: 'admin',
      },
    );
    return { refundStatus };
  }

  // ── 공개 메서드: Medusa channelOrderId 기반 ─────────────────────────────

  async getActionsByChannelOrder(channelOrderId: string, customerId: string): Promise<StoreOrderActionsResponseDto> {
    const so = await this.findSoOrThrow({ channelOrderId, salesChannel: 'medusa' }, customerId);
    return this.buildActionsView(so);
  }

  /**
   * 주문목록 페이지용 배치 조회
   */
  async getActionsByChannelOrderBatch(
    channelOrderIds: string[],
    customerId: string,
  ): Promise<StoreOrderActionsResponseDto[]> {
    if (channelOrderIds.length === 0) return [];

    const sos = await this.db.db
      .select()
      .from(inventoryTables.salesOrders)
      .where(
        and(
          inArray(inventoryTables.salesOrders.channelOrderId, channelOrderIds),
          eq(inventoryTables.salesOrders.salesChannel, 'medusa'),
          eq(inventoryTables.salesOrders.customerId, customerId),
        ),
      );

    // SO당 select 1~3개 × 페이지(≤100건 제한) Promise.all. 느려지면 buildActionsView 쿼리 배치화.
    return Promise.all(sos.map((so) => this.buildActionsView(so)));
  }

  async cancelRequestByChannelOrder(
    channelOrderId: string,
    customerId: string,
    dto: StoreCancelOrderDto,
    fulfillmentCommandContext?: { idempotencyKey: string; actorId: string; actorRoles: string[] },
  ): Promise<StoreOrderActionsResponseDto> {
    const so = await this.findSoOrThrow({ channelOrderId, salesChannel: 'medusa' }, customerId);
    return this.processCancelRequest(so, customerId, dto, fulfillmentCommandContext);
  }

  // ── Private 헬퍼 ─────────────────────────────────────────────────────────

  private async findSoOrThrow(
    lookup: { id: string } | { channelOrderId: string; salesChannel: string },
    customerId?: string,
  ): Promise<SalesOrderRow> {
    const where =
      'id' in lookup
        ? eq(inventoryTables.salesOrders.id, lookup.id)
        : and(
            eq(inventoryTables.salesOrders.channelOrderId, lookup.channelOrderId),
            eq(inventoryTables.salesOrders.salesChannel, lookup.salesChannel as 'medusa'),
          );

    const so = await this.db.db
      .select()
      .from(inventoryTables.salesOrders)
      .where(where)
      .limit(1)
      .then((r) => r[0]);

    if (!so) throw new NotFoundException('주문을 찾을 수 없습니다.');
    if (customerId !== undefined && so.customerId !== customerId)
      throw new ForbiddenException('본인 주문만 접근할 수 있습니다.');
    return so;
  }

  private async buildActionsView(
    so: SalesOrderRow,
    overrideRefundStatus?: StoreRefundStatus,
  ): Promise<StoreOrderActionsResponseDto> {
    const fos = await this.db.db
      .select({
        status: inventoryTables.fulfillmentOrders.status,
        shippedAt: inventoryTables.fulfillmentOrders.shippedAt,
      })
      .from(inventoryTables.fulfillmentOrders)
      .where(eq(inventoryTables.fulfillmentOrders.salesOrderId, so.id));

    const fulfillmentStatus = this.deriveFulfillmentStatus(fos);
    const hasShippedEvidence = this.hasShippedEvidence(fos);
    const isChannelOrder = so.salesChannel !== 'medusa';

    const availableActions: StoreOrderAction[] = [];
    let cancelUnavailableReason: StoreCancelUnavailableReason | undefined;
    let refundStatus: StoreRefundStatus = overrideRefundStatus ?? 'none';
    let claimStatus: StoreClaimStatus = 'none';
    let refundSummary: RefundSummaryDto | undefined;

    // cancellation_linked_wallet_refund 조회: 취소된 주문 + 부분취소(manual_pending) 모두 해당
    const needsRefundLookup =
      (so.status === 'cancelled' && !overrideRefundStatus) || (so.status !== 'cancelled' && so.walletIntentId);

    if (needsRefundLookup) {
      const refundLinks = await this.db.db
        .select({
          id: inventoryTables.businessLinks.id,
          metadata: inventoryTables.businessLinks.metadata,
          createdAt: inventoryTables.businessLinks.createdAt,
        })
        .from(inventoryTables.businessLinks)
        .where(
          and(
            eq(inventoryTables.businessLinks.sourceType, 'sales_order'),
            eq(inventoryTables.businessLinks.sourceId, so.id),
            eq(inventoryTables.businessLinks.relationName, 'cancellation_linked_wallet_refund'),
          ),
        )
        .orderBy(desc(inventoryTables.businessLinks.createdAt));

      const latestLink = refundLinks[0];

      if (so.status === 'cancelled' && !overrideRefundStatus) {
        if (latestLink) {
          const stored = (latestLink.metadata as Record<string, unknown>)?.refundStatus;
          refundStatus =
            typeof stored === 'string' && VALID_REFUND_STATUSES.has(stored as StoreRefundStatus)
              ? (stored as StoreRefundStatus)
              : 'pending';
        } else {
          refundStatus = so.walletIntentId ? 'pending' : 'none';
        }
      }

      // refundSummary 조립: 취소/부분취소 모두 지원
      const summaryLink =
        latestLink ??
        // 아직 cancelled가 아닌 주문에서 manual_pending 부분취소 링크 탐색
        refundLinks.find((r) => {
          const m = r.metadata as Record<string, unknown>;
          return m?.refundStatus === 'manual_pending';
        });

      if (summaryLink) {
        const m = summaryLink.metadata as Record<string, unknown>;
        const summaryStatus =
          typeof m?.refundStatus === 'string' && VALID_REFUND_STATUSES.has(m.refundStatus as StoreRefundStatus)
            ? (m.refundStatus as StoreRefundStatus)
            : refundStatus !== 'none'
              ? refundStatus
              : undefined;

        if (summaryStatus && summaryStatus !== 'none') {
          // 부분취소(manual_pending)는 refundEstimateAmount, 전체취소는 amount
          const summaryAmount =
            typeof m?.refundEstimateAmount === 'number'
              ? m.refundEstimateAmount
              : typeof m?.amount === 'number'
                ? m.amount
                : null;
          refundSummary = buildRefundSummary({
            status: summaryStatus,
            amount: summaryAmount,
            manualRequired: summaryStatus === 'manual_pending',
            lastUpdatedAt: summaryLink.createdAt?.toISOString() ?? null,
          });
        }
      } else if (refundStatus !== 'none') {
        // businessLink 없지만 refundStatus가 있는 경우 (walletIntentId 있는 대기 상태)
        refundSummary = buildRefundSummary({
          status: refundStatus,
          amount: null,
          manualRequired: refundStatus === 'manual_pending',
          lastUpdatedAt: null,
        });
      }
    }

    if (so.status === 'timeout') {
      // 아무 액션 없음
    } else if (so.status === 'cancelled') {
      availableActions.push('receipt');
      cancelUnavailableReason = 'already_cancelled';
    } else if (hasShippedEvidence) {
      availableActions.push('track');
      availableActions.push('receipt');
      cancelUnavailableReason = 'already_shipped';
      // return/exchange: 배송완료 상태 + 진행 중인 claim 없을 때만 허용
      const isDelivered = fulfillmentStatus === 'delivered';
      if (isDelivered) {
        const [activeReturn, activeExchange] = await Promise.all([
          this.db.db
            .select({ id: returnExchangeTables.returnRequests.id })
            .from(returnExchangeTables.returnRequests)
            .where(
              and(
                eq(returnExchangeTables.returnRequests.salesOrderId, so.id),
                inArray(returnExchangeTables.returnRequests.status, [...ACTIVE_RETURN_STATUSES]),
              ),
            )
            .limit(1)
            .then((r) => r[0]),
          this.db.db
            .select({ id: returnExchangeTables.exchangeRequests.id })
            .from(returnExchangeTables.exchangeRequests)
            .where(
              and(
                eq(returnExchangeTables.exchangeRequests.salesOrderId, so.id),
                inArray(returnExchangeTables.exchangeRequests.status, [...ACTIVE_EXCHANGE_STATUSES]),
              ),
            )
            .limit(1)
            .then((r) => r[0]),
        ]);
        if (activeReturn) claimStatus = 'return_requested';
        else if (activeExchange) claimStatus = 'exchange_requested';
        if (claimStatus === 'none') {
          availableActions.push('return');
          availableActions.push('exchange');
        }
      }
    } else if (isChannelOrder) {
      availableActions.push('receipt');
      cancelUnavailableReason = 'channel_order';
    } else if (fulfillmentStatus === 'picking' || fulfillmentStatus === 'packed') {
      // 피킹 시작 이후 고객 셀프 취소 불가 — 고객센터 문의 안내
      availableActions.push('receipt');
      cancelUnavailableReason = 'already_processing';
    } else {
      availableActions.push('cancel');
      availableActions.push('receipt');
    }

    return {
      orderId: so.id,
      channelOrderId: so.channelOrderId,
      orderStatus: so.status,
      fulfillmentStatus,
      refundStatus,
      refundSummary,
      claimStatus,
      availableActions,
      cancelUnavailableReason,
      // 현재는 결제확인된 주문(authorized/captured)만 수집되므로 walletIntentId가 있으면 항상 paid.
      // 무통장입금 도입 시 Wallet intent status를 확인해 'awaiting_payment'로 분기한다.
      paymentStatus: so.walletIntentId ? 'paid' : undefined,
      channelInfo: isChannelOrder ? { channel: so.salesChannel, ...CHANNEL_CANCEL_URLS[so.salesChannel] } : undefined,
    };
  }

  private async processCancelRequest(
    so: SalesOrderRow,
    customerId: string,
    dto: StoreCancelOrderDto,
    fulfillmentCommandContext?: { idempotencyKey: string; actorId: string; actorRoles: string[] },
  ): Promise<StoreOrderActionsResponseDto> {
    if (
      fulfillmentCommandContext &&
      (await this.salesOrdersService.validateCancellationReplay(so.id, {
        sourceKey: fulfillmentCommandContext.idempotencyKey,
        reasonCode: dto.reasonCode,
        reasonDetail: dto.reasonDetail,
      }))
    ) {
      return this.buildActionsView(so);
    }
    if (so.status === 'cancelled') throw new BadRequestException('이미 취소된 주문입니다.');
    if (so.status === 'timeout') throw new BadRequestException('타임아웃된 주문은 취소할 수 없습니다.');
    if (so.salesChannel !== 'medusa') {
      throw new BadRequestException(`${so.salesChannel} 채널 주문은 해당 채널에서 직접 취소해 주세요.`);
    }

    const fos = await this.db.db
      .select({
        status: inventoryTables.fulfillmentOrders.status,
        shippedAt: inventoryTables.fulfillmentOrders.shippedAt,
      })
      .from(inventoryTables.fulfillmentOrders)
      .where(eq(inventoryTables.fulfillmentOrders.salesOrderId, so.id));

    const fulfillmentStatus = this.deriveFulfillmentStatus(fos);
    const hasV2Outstanding = await this.hasV2OutstandingShipment(so.id);
    if (fulfillmentStatus === 'picking' || fulfillmentStatus === 'packed') {
      throw new BadRequestException('피킹이 시작된 주문은 직접 취소할 수 없습니다. 고객센터로 문의해 주세요.');
    }
    if (!hasV2Outstanding && (this.hasShippedEvidence(fos) || so.status === 'shipped' || so.status === 'delivered')) {
      throw new BadRequestException('이미 출고된 주문은 취소할 수 없습니다.');
    }

    await this.salesOrdersService.cancel(so.id, {
      reasonCode: dto.reasonCode,
      reasonDetail: dto.reasonDetail,
      cancelledBy: `customer:${customerId}`,
      fulfillmentCommandContext,
    });

    const refundOptions = { actor: 'customer' as const, attemptType: 'initial' as const };
    const refundStatus = fulfillmentCommandContext
      ? await this.requestWalletRefundOnce(so, dto, fulfillmentCommandContext.idempotencyKey, refundOptions)
      : await this.requestWalletRefundAfterCancel(so, dto, refundOptions);
    return this.buildActionsView({ ...so, status: 'cancelled' }, refundStatus);
  }

  private async requestWalletRefundOnce(
    so: SalesOrderRow,
    dto: StoreCancelOrderDto,
    idempotencyKey: string,
    options: { attemptType: 'initial'; actor: 'customer' | 'admin' },
  ): Promise<StoreRefundStatus> {
    const keyDigest = createHash('sha256').update(idempotencyKey.trim()).digest('hex').slice(0, 32);
    const correlationId = `cancel:${so.id}:initial:${keyDigest}`;
    return this.db.db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as DbTx;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${correlationId}, 0))`);
      const rows = await tx.execute(sql`
        SELECT metadata
          FROM business_links
         WHERE source_type = 'sales_order'
           AND source_id = ${so.id}
           AND relation_name = 'cancellation_linked_wallet_refund'
           AND metadata->>'correlationId' = ${correlationId}
         ORDER BY created_at DESC
         LIMIT 1
      `);
      const existing = Array.from(rows as unknown as ArrayLike<{ metadata?: Record<string, unknown> }>)[0];
      const storedStatus = existing?.metadata?.refundStatus;
      if (typeof storedStatus === 'string' && VALID_REFUND_STATUSES.has(storedStatus as StoreRefundStatus)) {
        return storedStatus as StoreRefundStatus;
      }
      return this.requestWalletRefundAfterCancel(so, dto, { ...options, correlationId, tx });
    });
  }

  private async hasV2OutstandingShipment(salesOrderId: string): Promise<boolean> {
    const rows = await this.db.db.execute(sql`
      SELECT s.id
        FROM shipments s
        JOIN shipment_lines sl ON sl.shipment_id = s.id
        JOIN fulfillment_order_items foi ON foi.id = sl.fulfillment_order_item_id
        JOIN fulfillment_orders fo ON fo.id = foi.fulfillment_order_id
       WHERE fo.sales_order_id = ${salesOrderId}
         AND s.opened_for_fulfillment_order_id IS NULL
         AND s.status IN ('draft', 'planned', 'recovery_required')
       LIMIT 1
    `);
    return Array.from(rows as unknown as ArrayLike<unknown>).length > 0;
  }

  /**
   * Core 취소 성공 후 Wallet 환불을 요청하고 결과를 business timeline에 기록한다.
   * Wallet 호출 실패/unavailable은 취소 자체를 롤백하지 않는다.
   *
   * correlationId는 per-attempt UUID를 포함하여 생성된다. 과거 실패 응답이
   * Wallet idempotency에 의해 재생되어 복구를 막는 문제를 방지한다.
   * 중복/초과 환불 방어는 Wallet의 refundable amount 검증이 담당한다.
   */
  private async requestWalletRefundAfterCancel(
    so: SalesOrderRow,
    dto: StoreCancelOrderDto,
    options?: {
      attemptType?: 'initial' | 'retry';
      actor?: 'customer' | 'admin' | 'system';
      correlationId?: string;
      amountOverride?: number;
      extraMetadata?: Record<string, unknown>;
      tx?: DbTx;
    },
  ): Promise<StoreRefundStatus> {
    const attemptType = options?.attemptType ?? 'initial';
    const actor = options?.actor ?? 'system';

    if (!so.walletIntentId) {
      this.logger.warn(
        `[WalletRefund] No walletIntentId for SO ${so.id} (channelOrderId=${so.channelOrderId}). ` +
          'Refund must be processed manually.',
      );
      await this.recordWalletRefundLink(
        so.id,
        {
          refundStatus: 'manual_pending',
          note: 'walletIntentId가 없어 수동 처리 필요',
          reasonCode: dto.reasonCode,
          attemptType,
          actor,
          extraMetadata: options?.extraMetadata,
        },
        options?.tx,
      );
      return 'manual_pending';
    }

    const correlationId = options?.correlationId ?? `cancel:${so.id}:${attemptType}:${crypto.randomUUID()}`;
    const amount = options?.amountOverride ?? so.totalAmount;

    if (!amount || amount <= 0) {
      this.logger.warn(`[WalletRefund] SO ${so.id} has invalid amount=${amount}. Skipping auto-refund.`);
      await this.recordWalletRefundLink(
        so.id,
        {
          refundStatus: 'manual_pending',
          note: `amount=${amount} 이 유효하지 않아 수동 처리 필요`,
          intentId: so.walletIntentId,
          reasonCode: dto.reasonCode,
          attemptType,
          actor,
          correlationId,
          extraMetadata: options?.extraMetadata,
        },
        options?.tx,
      );
      return 'manual_pending';
    }

    const outcome = await this.walletRefundClient.refundByIntent(so.walletIntentId, amount, {
      reasonCode: dto.reasonCode ?? 'CUSTOMER_CANCEL',
      reasonMessage: dto.reasonDetail,
      correlationId,
    });

    switch (outcome.kind) {
      case 'success': {
        const refundId = outcome.refunds[0]?.refundId;
        await this.recordWalletRefundLink(
          so.id,
          {
            refundStatus: 'succeeded',
            intentId: so.walletIntentId,
            refundId,
            amount,
            reasonCode: dto.reasonCode,
            attemptType,
            actor,
            correlationId,
            extraMetadata: options?.extraMetadata,
          },
          options?.tx,
        );
        return 'succeeded';
      }
      case 'partial_pending': {
        const refundId = outcome.refunds[0]?.refundId;
        await this.recordWalletRefundLink(
          so.id,
          {
            refundStatus: 'pending',
            intentId: so.walletIntentId,
            refundId,
            amount,
            note: '무통장 입금 또는 비동기 처리 중 — Wallet에서 확인 필요',
            reasonCode: dto.reasonCode,
            attemptType,
            actor,
            correlationId,
            extraMetadata: options?.extraMetadata,
          },
          options?.tx,
        );
        return 'pending';
      }
      case 'already_refunded': {
        await this.recordWalletRefundLink(
          so.id,
          {
            refundStatus: 'succeeded',
            intentId: so.walletIntentId,
            amount,
            note: `이미 환불 완료 (Wallet: ${outcome.errorCode})`,
            reasonCode: dto.reasonCode,
            attemptType,
            actor,
            correlationId,
            errorCode: outcome.errorCode,
            errorMessage: outcome.errorMessage,
            extraMetadata: options?.extraMetadata,
          },
          options?.tx,
        );
        return 'succeeded';
      }
      case 'failed': {
        await this.recordWalletRefundLink(
          so.id,
          {
            refundStatus: 'failed',
            intentId: so.walletIntentId,
            amount,
            note: `Wallet 환불 실패: ${outcome.errorCode} — ${outcome.errorMessage}`,
            reasonCode: dto.reasonCode,
            attemptType,
            actor,
            correlationId,
            errorCode: outcome.errorCode,
            errorMessage: outcome.errorMessage,
            extraMetadata: options?.extraMetadata,
          },
          options?.tx,
        );
        return 'failed';
      }
      case 'wallet_unavailable': {
        await this.recordWalletRefundLink(
          so.id,
          {
            refundStatus: 'manual_pending',
            intentId: so.walletIntentId,
            amount,
            note: `Wallet 연결 불가: ${outcome.errorMessage}`,
            reasonCode: dto.reasonCode,
            attemptType,
            actor,
            correlationId,
            extraMetadata: options?.extraMetadata,
          },
          options?.tx,
        );
        return 'manual_pending';
      }
      case 'in_flight': {
        await this.recordWalletRefundLink(
          so.id,
          {
            refundStatus: 'manual_pending',
            intentId: so.walletIntentId,
            amount,
            note: `환불 처리 중(Idempotency in-flight): ${outcome.errorMessage}`,
            reasonCode: dto.reasonCode,
            attemptType,
            actor,
            correlationId,
            extraMetadata: options?.extraMetadata,
          },
          options?.tx,
        );
        return 'manual_pending';
      }
      case 'no_intent_id':
      default: {
        return 'manual_pending';
      }
    }
  }

  private async recordWalletRefundLink(
    salesOrderId: string,
    info: {
      refundStatus: StoreRefundStatus;
      intentId?: string;
      refundId?: string;
      amount?: number;
      note?: string;
      reasonCode?: string;
      attemptType?: 'initial' | 'retry';
      actor?: 'customer' | 'admin' | 'system';
      correlationId?: string;
      errorCode?: string;
      errorMessage?: string;
      extraMetadata?: Record<string, unknown>;
    },
    tx?: DbTx,
  ): Promise<void> {
    try {
      await this.salesOrdersService.createBusinessLink(
        salesOrderId,
        {
          relationName: 'cancellation_linked_wallet_refund',
          target: {
            type: 'wallet_refund',
            externalRef: info.refundId
              ? `wallet:refund:${info.refundId}`
              : info.intentId
                ? `wallet:intent:${info.intentId}`
                : `wallet:manual:${salesOrderId}`,
          },
          metadata: {
            refundStatus: info.refundStatus,
            intentId: info.intentId ?? null,
            refundId: info.refundId ?? null,
            amount: info.amount ?? null,
            reasonCode: info.reasonCode ?? null,
            note: info.note ?? null,
            attemptType: info.attemptType ?? null,
            actor: info.actor ?? null,
            correlationId: info.correlationId ?? null,
            errorCode: info.errorCode ?? null,
            errorMessage: info.errorMessage ?? null,
            ...(info.extraMetadata ?? {}),
          },
        },
        tx,
      );
    } catch (err) {
      // A keyed single-flight must persist its replay result before releasing
      // the advisory lock. The stable Wallet correlation makes a retry safe.
      if (tx) throw err;
      // Legacy/unkeyed callers retain the historical best-effort timeline behavior.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[WalletRefund] Failed to record business link for SO ${salesOrderId}: ${message}`);
    }
  }

  private deriveFulfillmentStatus(fos: FoRow[]): StoreFulfillmentStatus {
    if (fos.length === 0) return 'not_created';
    const active = fos.filter((fo) => fo.status !== 'canceled');
    if (active.length === 0) return 'canceled';
    if (active.some((fo) => FO_DELIVERED_STATUSES.has(fo.status))) return 'delivered';
    if (active.some((fo) => FO_SHIPPED_STATUSES.has(fo.status) || fo.shippedAt != null)) return 'shipped';
    if (active.some((fo) => FO_PACKED_STATUSES.has(fo.status))) return 'packed';
    if (active.some((fo) => FO_PICKING_STATUSES.has(fo.status))) return 'picking';
    if (active.some((fo) => fo.status === 'unfulfillable' || fo.status === 'reserving')) return 'awaiting_matching';
    return 'created';
  }

  private hasShippedEvidence(fos: FoRow[]): boolean {
    return fos.some((fo) => FO_SHIPPED_STATUSES.has(fo.status) || fo.shippedAt != null);
  }

  // ── Tracking ──────────────────────────────────────────────────────────────

  async getTrackingByChannelOrder(channelOrderId: string, customerId: string): Promise<StoreOrderTrackingResponseDto> {
    const so = await this.findSoOrThrow({ channelOrderId, salesChannel: 'medusa' }, customerId);
    return this.buildTrackingView(so);
  }

  async getTracking(orderId: string, customerId: string): Promise<StoreOrderTrackingResponseDto> {
    const so = await this.findSoOrThrow({ id: orderId }, customerId);
    return this.buildTrackingView(so);
  }

  private async buildTrackingView(so: SalesOrderRow): Promise<StoreOrderTrackingResponseDto> {
    const fos = await this.db.db
      .select()
      .from(inventoryTables.fulfillmentOrders)
      .where(eq(inventoryTables.fulfillmentOrders.salesOrderId, so.id));

    const foIds = fos.map((fo) => fo.id);

    // 출고주문이 없으면 배송 정보 없음
    if (foIds.length === 0) {
      return {
        orderId: so.id,
        channelOrderId: so.channelOrderId,
        status: 'not_shipped',
        shipments: [],
      };
    }

    const fulfillmentOrderItems = await this.db.db
      .select()
      .from(inventoryTables.fulfillmentOrderItems)
      .where(
        and(
          inArray(inventoryTables.fulfillmentOrderItems.fulfillmentOrderId, foIds),
          eq(inventoryTables.fulfillmentOrderItems.salesOrderId, so.id),
        ),
      );

    const fulfillmentOrderItemIds = fulfillmentOrderItems.map((item) => item.id);
    const shipmentLineRows =
      fulfillmentOrderItemIds.length > 0
        ? await this.db.db
            .select()
            .from(inventoryTables.shipmentLines)
            .where(inArray(inventoryTables.shipmentLines.fulfillmentOrderItemId, fulfillmentOrderItemIds))
        : [];

    const shipmentDtos =
      shipmentLineRows.length > 0
        ? await this.buildV2TrackingShipments(fulfillmentOrderItems, shipmentLineRows)
        : await this.buildLegacyTrackingShipments(fos);

    const overallStatus = deriveOverallTrackingStatus(shipmentDtos);

    return {
      orderId: so.id,
      channelOrderId: so.channelOrderId,
      status: overallStatus,
      shipments: shipmentDtos,
    };
  }

  private async buildV2TrackingShipments(
    fulfillmentOrderItems: Array<typeof inventoryTables.fulfillmentOrderItems.$inferSelect>,
    shipmentLineRows: Array<typeof inventoryTables.shipmentLines.$inferSelect>,
  ): Promise<StoreShipmentDto[]> {
    const shipmentIds = [...new Set(shipmentLineRows.map((line) => line.shipmentId))];
    const shipmentRows = await this.db.db
      .select()
      .from(inventoryTables.shipments)
      .where(and(inArray(inventoryTables.shipments.id, shipmentIds), ne(inventoryTables.shipments.status, 'canceled')));
    const visibleShipmentIds = new Set(shipmentRows.map((shipment) => shipment.id));

    const dispatchAttempts = await this.db.db
      .select()
      .from(inventoryTables.dispatchAttempts)
      .where(inArray(inventoryTables.dispatchAttempts.shipmentId, [...visibleShipmentIds]));
    const invoiceRows =
      visibleShipmentIds.size > 0
        ? await this.db.db
            .select()
            .from(inventoryTables.invoices)
            .where(inArray(inventoryTables.invoices.shipmentId, [...visibleShipmentIds]))
            .orderBy(desc(inventoryTables.invoices.createdAt))
        : [];
    const trackingRows =
      visibleShipmentIds.size > 0
        ? await this.db.db
            .select()
            .from(inventoryTables.shipmentTracking)
            .where(inArray(inventoryTables.shipmentTracking.shipmentId, [...visibleShipmentIds]))
        : [];

    const salesOrderLineIds = [
      ...new Set(fulfillmentOrderItems.flatMap((item) => (item.salesOrderLineId ? [item.salesOrderLineId] : []))),
    ];
    const salesOrderLines =
      salesOrderLineIds.length > 0
        ? await this.db.db
            .select()
            .from(inventoryTables.salesOrderLines)
            .where(inArray(inventoryTables.salesOrderLines.id, salesOrderLineIds))
        : [];

    const fulfillmentOrderItemById = new Map(fulfillmentOrderItems.map((item) => [item.id, item]));
    const salesOrderLineById = new Map(salesOrderLines.map((line) => [line.id, line]));
    const invoiceById = new Map(invoiceRows.map((invoice) => [invoice.id, invoice]));
    const trackingByAttempt = new Map<string, typeof trackingRows>();
    const legacyTrackingByShipment = new Map<string, typeof trackingRows>();
    for (const tracking of trackingRows) {
      if (!tracking.dispatchAttemptId) {
        const rows = legacyTrackingByShipment.get(tracking.shipmentId) ?? [];
        rows.push(tracking);
        legacyTrackingByShipment.set(tracking.shipmentId, rows);
        continue;
      }
      const rows = trackingByAttempt.get(tracking.dispatchAttemptId) ?? [];
      rows.push(tracking);
      trackingByAttempt.set(tracking.dispatchAttemptId, rows);
    }

    return shipmentRows
      .map((shipment): StoreShipmentDto | null => {
        const lines = shipmentLineRows
          .filter((line) => line.shipmentId === shipment.id)
          .flatMap((line) => {
            const item = fulfillmentOrderItemById.get(line.fulfillmentOrderItemId);
            if (!item?.salesOrderLineId) return [];
            return [
              {
                shipmentLineId: line.id,
                fulfillmentOrderItemId: item.id,
                salesOrderLineId: item.salesOrderLineId,
                channelOrderItemId: salesOrderLineById.get(item.salesOrderLineId)?.channelOrderItemId ?? null,
                skuId: line.skuId,
                quantity: line.qty,
              },
            ];
          });
        if (lines.length === 0) return null;

        const attemptDtos = dispatchAttempts
          .filter((attempt) => attempt.shipmentId === shipment.id)
          .sort((a, b) => a.attemptNo - b.attemptNo)
          .map((attempt) => {
            const invoice = attempt.invoiceId ? invoiceById.get(attempt.invoiceId) : undefined;
            const carrier = normalizeCarrierCode(invoice?.carrier ?? null);
            const trackingNumber = invoice?.trackingNo ?? '';
            const events = (trackingByAttempt.get(attempt.id) ?? [])
              .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
              .map((event) => ({
                status: event.status,
                location: event.location ?? null,
                timestamp: event.timestamp,
              }));
            return {
              dispatchAttemptId: attempt.id,
              attemptNo: attempt.attemptNo,
              status: deriveAttemptTrackingStatus(attempt.status, events),
              recalled: attempt.status === 'recalled',
              invoiceId: invoice?.id ?? null,
              carrier,
              carrierName: CARRIER_NAMES[carrier] ?? carrier,
              trackingNumber,
              trackingUrl: trackingNumber ? buildTrackingUrl(carrier, trackingNumber) : null,
              dispatchedAt: attempt.dispatchedAt,
              carrierAcceptedAt: attempt.carrierAcceptedAt,
              recalledAt: attempt.recalledAt,
              trackingEvents: events,
            };
          });
        const currentAttempt = [...attemptDtos].reverse().find((attempt) => !attempt.recalled);
        const fulfillmentOrderIds = [
          ...new Set(
            shipmentLineRows
              .filter((line) => line.shipmentId === shipment.id)
              .flatMap((line) => {
                const item = fulfillmentOrderItemById.get(line.fulfillmentOrderItemId);
                return item ? [item.fulfillmentOrderId] : [];
              }),
          ),
        ];
        const deliveredEvent = [...(currentAttempt?.trackingEvents ?? [])]
          .reverse()
          .find((event) => event.status === 'delivered');
        const legacyInvoice =
          attemptDtos.length === 0
            ? invoiceRows.find(
                (invoice) => invoice.shipmentId === shipment.id && ['issued', 'used'].includes(invoice.status),
              )
            : undefined;
        const legacyCarrier = normalizeCarrierCode(legacyInvoice?.carrier ?? null);
        const legacyTrackingEvents =
          attemptDtos.length === 0
            ? (legacyTrackingByShipment.get(shipment.id) ?? [])
                .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
                .map((event) => ({
                  status: event.status,
                  location: event.location ?? null,
                  timestamp: event.timestamp,
                }))
            : [];

        return {
          shipmentId: shipment.id,
          fulfillmentOrderId: fulfillmentOrderIds[0],
          fulfillmentOrderIds,
          carrier: currentAttempt?.carrier ?? legacyCarrier,
          carrierName: currentAttempt?.carrierName ?? CARRIER_NAMES[legacyCarrier] ?? legacyCarrier,
          trackingNumber: currentAttempt?.trackingNumber ?? legacyInvoice?.trackingNo ?? '',
          trackingUrl:
            currentAttempt?.trackingUrl ??
            (legacyInvoice?.trackingNo ? buildTrackingUrl(legacyCarrier, legacyInvoice.trackingNo) : null),
          status: currentAttempt?.status ?? (attemptDtos.length === 0 ? shipment.status : 'preparing'),
          shippedAt: currentAttempt?.dispatchedAt ?? (attemptDtos.length === 0 ? shipment.shippedAt : null),
          deliveredAt: deliveredEvent?.timestamp ?? (attemptDtos.length === 0 ? (shipment.deliveredAt ?? null) : null),
          eta: null,
          trackingEvents: currentAttempt?.trackingEvents ?? legacyTrackingEvents,
          lines,
          dispatchAttempts: attemptDtos,
        };
      })
      .filter((shipment): shipment is StoreShipmentDto => shipment !== null)
      .sort((a, b) => (a.shipmentId ?? '').localeCompare(b.shipmentId ?? ''));
  }

  private async buildLegacyTrackingShipments(
    fos: Array<typeof inventoryTables.fulfillmentOrders.$inferSelect>,
  ): Promise<StoreShipmentDto[]> {
    const foIds = fos.map((fo) => fo.id);
    const shipmentRows = await this.db.db
      .select()
      .from(inventoryTables.shipments)
      .where(
        and(
          inArray(inventoryTables.shipments.openedForFulfillmentOrderId, foIds),
          ne(inventoryTables.shipments.status, 'canceled'),
        ),
      );
    const invoiceRows = await this.db.db
      .select()
      .from(inventoryTables.invoices)
      .where(
        and(
          inArray(inventoryTables.invoices.issuedForFulfillmentOrderId, foIds),
          inArray(inventoryTables.invoices.status, ['issued', 'used']),
        ),
      )
      .orderBy(desc(inventoryTables.invoices.createdAt));
    const trackingRows =
      shipmentRows.length > 0
        ? await this.db.db
            .select()
            .from(inventoryTables.shipmentTracking)
            .where(
              inArray(
                inventoryTables.shipmentTracking.shipmentId,
                shipmentRows.map((shipment) => shipment.id),
              ),
            )
        : [];
    const invoiceByFo = new Map<string, (typeof invoiceRows)[0]>();
    for (const invoice of invoiceRows) {
      if (!invoiceByFo.has(invoice.issuedForFulfillmentOrderId)) {
        invoiceByFo.set(invoice.issuedForFulfillmentOrderId, invoice);
      }
    }

    const shipmentDtos = shipmentRows.flatMap((shipment) => {
      if (!shipment.openedForFulfillmentOrderId) return [];
      const invoice = invoiceByFo.get(shipment.openedForFulfillmentOrderId);
      const carrier = normalizeCarrierCode(invoice?.carrier ?? null);
      const trackingNumber = invoice?.trackingNo ?? '';
      const trackingEvents = trackingRows
        .filter((event) => event.shipmentId === shipment.id)
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
        .map((event) => ({ status: event.status, location: event.location ?? null, timestamp: event.timestamp }));
      return [
        {
          shipmentId: shipment.id,
          fulfillmentOrderId: shipment.openedForFulfillmentOrderId,
          fulfillmentOrderIds: [shipment.openedForFulfillmentOrderId],
          carrier,
          carrierName: CARRIER_NAMES[carrier] ?? carrier,
          trackingNumber,
          trackingUrl: trackingNumber ? buildTrackingUrl(carrier, trackingNumber) : null,
          status: shipment.status,
          shippedAt: shipment.shippedAt,
          deliveredAt: shipment.deliveredAt,
          eta: null,
          trackingEvents,
          lines: [],
          dispatchAttempts: [],
        },
      ];
    });
    const shipmentFoIds = new Set(shipmentDtos.map((shipment) => shipment.fulfillmentOrderId));
    const foById = new Map(fos.map((fo) => [fo.id, fo]));
    const invoiceOnlyDtos: StoreShipmentDto[] = [];
    for (const [fulfillmentOrderId, invoice] of invoiceByFo) {
      if (shipmentFoIds.has(fulfillmentOrderId)) continue;
      const carrier = normalizeCarrierCode(invoice.carrier ?? null);
      invoiceOnlyDtos.push({
        shipmentId: null,
        fulfillmentOrderId,
        fulfillmentOrderIds: [fulfillmentOrderId],
        carrier,
        carrierName: CARRIER_NAMES[carrier] ?? carrier,
        trackingNumber: invoice.trackingNo,
        trackingUrl: buildTrackingUrl(carrier, invoice.trackingNo),
        status: 'created',
        shippedAt: foById.get(fulfillmentOrderId)?.shippedAt ?? null,
        deliveredAt: null,
        eta: null,
        trackingEvents: [],
        lines: [],
        dispatchAttempts: [],
      });
    }
    return [...shipmentDtos, ...invoiceOnlyDtos];
  }
}

// ── Module-level helpers ───────────────────────────────────────────────────

/**
 * 고객 안내용 환불 summary를 조립한다.
 * 내부 에러/provider 정보는 포함하지 않는다.
 */
function buildRefundSummary(data: {
  status: StoreRefundStatus;
  amount: number | null;
  manualRequired: boolean;
  lastUpdatedAt: string | null;
}): RefundSummaryDto {
  const messages: Record<StoreRefundStatus, string | null> = {
    none: null,
    pending: '환불 처리 중입니다. 결제 수단에 따라 영업일 기준 1~5일 소요될 수 있습니다.',
    manual_pending: '환불 처리에 추가 확인이 필요합니다. 빠른 시일 내에 처리해 드리겠습니다.',
    succeeded: null,
    failed: '환불 처리 중 오류가 발생했습니다. 고객센터로 문의해 주세요.',
  };

  return {
    status: data.status,
    amount: data.amount,
    currency: 'KRW',
    paymentMethodLabel: null, // Wallet provider 정보가 이벤트에 포함될 때 보강 예정
    manualRequired: data.manualRequired,
    expectedProcessingMessage: messages[data.status] ?? null,
    lastUpdatedAt: data.lastUpdatedAt,
  };
}

function computeLineHash(lines: Array<{ salesOrderLineId: string; quantity: number }>): string {
  const sorted = [...lines]
    .sort((a, b) => a.salesOrderLineId.localeCompare(b.salesOrderLineId))
    .map((l) => `${l.salesOrderLineId}:${l.quantity}`)
    .join(',');
  return createHash('sha256').update(sorted).digest('hex').slice(0, 12);
}

const CARRIER_NAMES: Record<string, string> = {
  CJ: 'CJ대한통운',
  HANJIN: '한진택배',
  LOTTE: '롯데택배',
  LOGEN: '로젠택배',
  KDEXP: '경동택배',
  CJGLS: 'CJ GLS',
};

// Invoice carrierCode 필드는 varchar라 실제 값이 다양할 수 있음 — canonical 코드로 정규화
const CARRIER_CODE_ALIASES: Record<string, string> = {
  CJ대한통운: 'CJ',
  'CJ 대한통운': 'CJ',
  cj: 'CJ',
  한진택배: 'HANJIN',
  한진: 'HANJIN',
  hanjin: 'HANJIN',
  롯데택배: 'LOTTE',
  롯데: 'LOTTE',
  롯데글로벌로지스: 'LOTTE',
  lotte: 'LOTTE',
  로젠택배: 'LOGEN',
  로젠: 'LOGEN',
  logen: 'LOGEN',
  경동택배: 'KDEXP',
  경동: 'KDEXP',
  kdexp: 'KDEXP',
  'CJ-GLS': 'CJGLS',
  'CJ GLS': 'CJGLS',
  cjgls: 'CJGLS',
};

function normalizeCarrierCode(raw: string | null | undefined): string {
  if (!raw || raw.trim() === '') return 'UNKNOWN';
  const trimmed = raw.trim();
  if (CARRIER_NAMES[trimmed]) return trimmed;
  const upper = trimmed.toUpperCase();
  if (CARRIER_NAMES[upper]) return upper;
  return CARRIER_CODE_ALIASES[trimmed] ?? CARRIER_CODE_ALIASES[upper] ?? trimmed;
}

function buildTrackingUrl(carrier: string, trackingNo: string): string | null {
  switch (carrier) {
    case 'CJ':
      return `https://www.cjlogistics.com/ko/tool/parcel/tracking?gnbInvcNo=${trackingNo}`;
    case 'HANJIN':
      return `https://www.hanjin.co.kr/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&wblnumText2=${trackingNo}`;
    case 'LOTTE':
      return `https://www.lotteglogis.com/mobile/reservation/tracking/linkView?InvNo=${trackingNo}`;
    case 'LOGEN':
      return `https://www.ilogen.com/m/personal/trace/${trackingNo}`;
    case 'KDEXP':
      return `https://kdexp.com/service/delivery/popup/deliveryinfo.do?barcode=${trackingNo}`;
    case 'CJGLS':
      return `https://www.cjlogistics.com/ko/tool/parcel/tracking?gnbInvcNo=${trackingNo}`;
    default:
      return null;
  }
}

function deriveAttemptTrackingStatus(attemptStatus: string, events: Array<{ status: string }>): string {
  if (attemptStatus === 'recalled') return 'recalled';
  if (attemptStatus === 'recovery_required') return 'recovery_required';
  if (events.some((event) => event.status === 'delivered')) return 'delivered';
  if (events.some((event) => event.status === 'in_transit')) return 'in_transit';
  if (events.some((event) => event.status === 'shipped')) return 'shipped';
  if (attemptStatus === 'dispatched') return 'shipped';
  return 'pending';
}

function deriveOverallTrackingStatus(
  shipments: StoreShipmentDto[],
): 'not_shipped' | 'preparing' | 'shipping' | 'delivered' {
  if (shipments.length === 0) return 'preparing';
  if (shipments.every((s) => s.status === 'delivered')) return 'delivered';
  if (shipments.some((s) => ['shipped', 'in_transit', 'delivered'].includes(s.status))) return 'shipping';
  return 'preparing';
}
