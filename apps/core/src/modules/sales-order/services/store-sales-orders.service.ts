import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { inventorySchema, inventoryTables, returnExchangeTables } from '../../inventory/schema/inventory.schema';
import {
  StoreCancelOrderDto,
  StoreCancelUnavailableReason,
  StoreClaimStatus,
  StoreFulfillmentStatus,
  StoreOrderAction,
  StoreOrderActionsResponseDto,
  StoreRefundStatus,
} from '../dto/store-order-actions.dto';
import {
  StoreOrderTrackingResponseDto,
  StoreShipmentDto,
} from '../dto/store-order-tracking.dto';
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

const ACTIVE_RETURN_STATUSES = ['requested', 'approved', 'collection_pending', 'collected', 'inspected', 'refund_pending'] as const;
const ACTIVE_EXCHANGE_STATUSES = ['requested', 'approved', 'collection_pending', 'collected', 'inspected', 'refund_pending'] as const;
const VALID_REFUND_STATUSES = new Set<StoreRefundStatus>(['none', 'pending', 'manual_pending', 'succeeded', 'failed']);

@Injectable()
export class StoreSalesOrdersService {
  private readonly logger = new Logger(StoreSalesOrdersService.name);

  constructor(
    @InjectTypedDb<typeof inventorySchema>() private readonly db: { db: import('drizzle-orm/postgres-js').PostgresJsDatabase<typeof inventorySchema> },
    private readonly salesOrdersService: SalesOrdersService,
    private readonly walletRefundClient: WalletRefundClient,
  ) {}

  // ── 공개 메서드: Core SO UUID 기반 ──────────────────────────────────────

  async getActions(orderId: string, customerId: string): Promise<StoreOrderActionsResponseDto> {
    const so = await this.findSoOrThrow({ id: orderId }, customerId);
    return this.buildActionsView(so);
  }

  async cancelRequest(orderId: string, customerId: string, dto: StoreCancelOrderDto): Promise<StoreOrderActionsResponseDto> {
    const so = await this.findSoOrThrow({ id: orderId }, customerId);
    return this.processCancelRequest(so, customerId, dto);
  }

  /**
   * 관리자 취소 + Wallet 자동 환불 orchestration.
   * 고객 취소와 동일하게 Core 취소 → Wallet 환불 → 결과 기록 순서를 보장한다.
   * walletIntentId가 없으면 환불은 manual_pending으로 기록되고 취소는 완료된다.
   */
  async adminCancelRequest(
    orderId: string,
    dto: { reasonCode?: string; reasonDetail?: string; lines?: Array<{ salesOrderLineId: string; quantity: number }> },
  ): Promise<{ status: string; refundStatus: string }> {
    const so = await this.findSoOrThrow({ id: orderId });
    if (so.status === 'cancelled') throw new BadRequestException('이미 취소된 주문입니다.');
    if (so.status === 'timeout') throw new BadRequestException('타임아웃된 주문은 취소할 수 없습니다.');

    await this.salesOrdersService.cancel(so.id, {
      reasonCode: dto.reasonCode,
      reasonDetail: dto.reasonDetail,
      lines: dto.lines,
      cancelledBy: 'admin',
    });

    // 부분 취소는 라인/할인/배송비 기준 환불 금액 계산이 복잡하므로 자동 환불 건너뜀 — 수동 처리 필요
    if (dto.lines && dto.lines.length > 0) {
      await this.recordWalletRefundLink(so.id, {
        refundStatus: 'manual_pending',
        intentId: so.walletIntentId ?? undefined,
        note: '부분 취소 — 취소 라인 기준 환불 금액 수동 계산 필요',
        reasonCode: dto.reasonCode,
      });
      // 부분 취소 후 실제 SO 상태를 재조회하여 반환 (전체가 취소되지 않을 수 있음)
      const refreshed = await this.findSoOrThrow({ id: orderId });
      return { status: refreshed.status, refundStatus: 'manual_pending' };
    }

    const refundStatus = await this.requestWalletRefundAfterCancel(
      { ...so, status: 'cancelled' } as SalesOrderRow,
      { reasonCode: dto.reasonCode },
    );

    return { status: 'cancelled', refundStatus };
  }

  // ── 공개 메서드: Medusa channelOrderId 기반 ─────────────────────────────

  async getActionsByChannelOrder(channelOrderId: string, customerId: string): Promise<StoreOrderActionsResponseDto> {
    const so = await this.findSoOrThrow({ channelOrderId, salesChannel: 'medusa' }, customerId);
    return this.buildActionsView(so);
  }

  async cancelRequestByChannelOrder(
    channelOrderId: string,
    customerId: string,
    dto: StoreCancelOrderDto,
  ): Promise<StoreOrderActionsResponseDto> {
    const so = await this.findSoOrThrow({ channelOrderId, salesChannel: 'medusa' }, customerId);
    return this.processCancelRequest(so, customerId, dto);
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
    if (customerId !== undefined && so.customerId !== customerId) throw new ForbiddenException('본인 주문만 접근할 수 있습니다.');
    return so;
  }

  private async buildActionsView(so: SalesOrderRow, overrideRefundStatus?: StoreRefundStatus): Promise<StoreOrderActionsResponseDto> {
    const fos = await this.db.db
      .select({ status: inventoryTables.fulfillmentOrders.status, shippedAt: inventoryTables.fulfillmentOrders.shippedAt })
      .from(inventoryTables.fulfillmentOrders)
      .where(eq(inventoryTables.fulfillmentOrders.salesOrderId, so.id));

    const fulfillmentStatus = this.deriveFulfillmentStatus(fos);
    const hasShippedEvidence = this.hasShippedEvidence(fos);
    const isChannelOrder = so.salesChannel !== 'medusa';

    const availableActions: StoreOrderAction[] = [];
    let cancelUnavailableReason: StoreCancelUnavailableReason | undefined;
    let refundStatus: StoreRefundStatus = overrideRefundStatus ?? 'none';
    let claimStatus: StoreClaimStatus = 'none';

    if (so.status === 'cancelled' && !overrideRefundStatus) {
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

      if (refundLink) {
        const stored = (refundLink.metadata as Record<string, unknown>)?.refundStatus;
        refundStatus = (typeof stored === 'string' && VALID_REFUND_STATUSES.has(stored as StoreRefundStatus))
          ? (stored as StoreRefundStatus)
          : 'pending';
      } else {
        refundStatus = so.walletIntentId ? 'pending' : 'none';
      }
    }

    if (so.status === 'timeout') {
      // 아무 액션 없음
    } else if (so.status === 'cancelled') {
      availableActions.push('receipt');
      cancelUnavailableReason = 'already_cancelled';
    } else if (hasShippedEvidence || so.status === 'shipped' || so.status === 'delivered') {
      availableActions.push('track');
      availableActions.push('receipt');
      cancelUnavailableReason = 'already_shipped';
      // return/exchange: 배송완료 상태 + 진행 중인 claim 없을 때만 허용
      const isDelivered = so.status === 'delivered' || fulfillmentStatus === 'delivered';
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
      availableActions.push('cancel'); // 시도 가능하지만 실패할 수 있음
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
      claimStatus,
      availableActions,
      cancelUnavailableReason,
      channelInfo: isChannelOrder
        ? { channel: so.salesChannel, ...CHANNEL_CANCEL_URLS[so.salesChannel] }
        : undefined,
    };
  }

  private async processCancelRequest(
    so: SalesOrderRow,
    customerId: string,
    dto: StoreCancelOrderDto,
  ): Promise<StoreOrderActionsResponseDto> {
    if (so.status === 'cancelled') throw new BadRequestException('이미 취소된 주문입니다.');
    if (so.status === 'timeout') throw new BadRequestException('타임아웃된 주문은 취소할 수 없습니다.');
    if (so.salesChannel !== 'medusa') {
      throw new BadRequestException(`${so.salesChannel} 채널 주문은 해당 채널에서 직접 취소해 주세요.`);
    }

    await this.salesOrdersService.cancel(so.id, {
      reasonCode: dto.reasonCode,
      reasonDetail: dto.reasonDetail,
      cancelledBy: `customer:${customerId}`,
    });

    const refundStatus = await this.requestWalletRefundAfterCancel(so, dto);
    return this.buildActionsView({ ...so, status: 'cancelled' }, refundStatus);
  }

  /**
   * Core 취소 성공 후 Wallet 환불을 요청하고 결과를 business timeline에 기록한다.
   * Wallet 호출 실패/unavailable은 취소 자체를 롤백하지 않는다.
   */
  private async requestWalletRefundAfterCancel(
    so: SalesOrderRow,
    dto: StoreCancelOrderDto,
  ): Promise<StoreRefundStatus> {
    if (!so.walletIntentId) {
      // walletIntentId가 없으면 Wallet 자동 환불 불가 — 수동 처리 필요
      this.logger.warn(
        `[WalletRefund] No walletIntentId for SO ${so.id} (channelOrderId=${so.channelOrderId}). ` +
          'Refund must be processed manually.',
      );
      await this.recordWalletRefundLink(so.id, {
        refundStatus: 'manual_pending',
        note: 'walletIntentId가 없어 수동 처리 필요',
        reasonCode: dto.reasonCode,
      });
      return 'manual_pending';
    }

    const correlationId = `cancel:${so.id}`;
    const amount = so.totalAmount;

    if (!amount || amount <= 0) {
      this.logger.warn(
        `[WalletRefund] SO ${so.id} has invalid totalAmount=${amount}. Skipping auto-refund.`,
      );
      await this.recordWalletRefundLink(so.id, {
        refundStatus: 'manual_pending',
        note: `totalAmount=${amount} 이 유효하지 않아 수동 처리 필요`,
        intentId: so.walletIntentId,
        reasonCode: dto.reasonCode,
      });
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
        await this.recordWalletRefundLink(so.id, {
          refundStatus: 'succeeded',
          intentId: so.walletIntentId,
          refundId,
          amount,
          reasonCode: dto.reasonCode,
        });
        return 'succeeded';
      }
      case 'partial_pending': {
        const refundId = outcome.refunds[0]?.refundId;
        await this.recordWalletRefundLink(so.id, {
          refundStatus: 'pending',
          intentId: so.walletIntentId,
          refundId,
          amount,
          note: '무통장 입금 또는 비동기 처리 중 — Wallet에서 확인 필요',
          reasonCode: dto.reasonCode,
        });
        return 'pending';
      }
      case 'failed': {
        await this.recordWalletRefundLink(so.id, {
          refundStatus: 'failed',
          intentId: so.walletIntentId,
          amount,
          note: `Wallet 환불 실패: ${outcome.errorCode} — ${outcome.errorMessage}`,
          reasonCode: dto.reasonCode,
        });
        return 'failed';
      }
      case 'wallet_unavailable': {
        await this.recordWalletRefundLink(so.id, {
          refundStatus: 'manual_pending',
          intentId: so.walletIntentId,
          amount,
          note: `Wallet 연결 불가: ${outcome.errorMessage}`,
          reasonCode: dto.reasonCode,
        });
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
    },
  ): Promise<void> {
    try {
      await this.salesOrdersService.createBusinessLink(salesOrderId, {
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
        },
      });
    } catch (err) {
      // business link 기록 실패는 취소/환불 결과에 영향을 주지 않는다
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

    // shipments + 연결된 tracking 이벤트 조회
    const shipmentRows = await this.db.db
      .select()
      .from(inventoryTables.shipments)
      .where(inArray(inventoryTables.shipments.fulfillmentOrderId, foIds));

    const shipmentIds = shipmentRows.map((s) => s.id);
    const trackingEvents =
      shipmentIds.length > 0
        ? await this.db.db
            .select()
            .from(inventoryTables.shipmentTracking)
            .where(inArray(inventoryTables.shipmentTracking.shipmentId, shipmentIds))
        : [];

    // invoices에서 송장번호/carrier 보완 (shipments에 없는 경우 대비)
    const invoiceRows = await this.db.db
      .select()
      .from(inventoryTables.invoices)
      .where(
        and(
          inArray(inventoryTables.invoices.fulfillmentOrderId, foIds),
          inArray(inventoryTables.invoices.status, ['shipped', 'printed', 'issued']),
        ),
      );

    // FO별 invoice 맵
    const invoiceByFo = new Map(invoiceRows.map((inv) => [inv.fulfillmentOrderId, inv]));
    // shipment별 tracking 이벤트 맵
    const eventsByShipment = new Map<string, typeof trackingEvents>();
    for (const evt of trackingEvents) {
      const list = eventsByShipment.get(evt.shipmentId) ?? [];
      list.push(evt);
      eventsByShipment.set(evt.shipmentId, list);
    }

    // shipments로 배송 정보 조립. shipments가 없으면 invoices로 대체
    const foById = new Map(fos.map((fo) => [fo.id, fo]));
    const shipmentDtos: StoreShipmentDto[] = [];

    if (shipmentRows.length > 0) {
      for (const s of shipmentRows) {
        if (!s.fulfillmentOrderId) continue;
        const fo = foById.get(s.fulfillmentOrderId);
        const events = (eventsByShipment.get(s.id) ?? [])
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
          .map((e) => ({ status: e.status, location: e.location ?? null, timestamp: e.timestamp }));
        const delivered = events.find((e) => e.status === 'delivered');

        shipmentDtos.push({
          fulfillmentOrderId: s.fulfillmentOrderId,
          carrier: s.carrier,
          carrierName: CARRIER_NAMES[s.carrier] ?? s.carrier,
          trackingNumber: s.trackingNo,
          trackingUrl: buildTrackingUrl(s.carrier, s.trackingNo) ?? s.invoiceUrl ?? null,
          status: s.status,
          shippedAt: fo?.shippedAt ?? null,
          deliveredAt: delivered?.timestamp ?? null,
          eta: s.eta ?? null,
          trackingEvents: events,
        });
      }
    } else {
      // shipments 없음 → invoices에서 기본 정보 조립
      for (const [foId, inv] of invoiceByFo) {
        const fo = foById.get(foId);
        const carrier = normalizeCarrierCode(inv.carrierCode);
        shipmentDtos.push({
          fulfillmentOrderId: foId,
          carrier,
          carrierName: CARRIER_NAMES[carrier] ?? carrier,
          trackingNumber: inv.invoiceNumber,
          trackingUrl: buildTrackingUrl(carrier, inv.invoiceNumber),
          status: inv.status === 'shipped' ? 'in_transit' : 'created',
          shippedAt: fo?.shippedAt ?? inv.shippedAt ?? null,
          deliveredAt: null,
          eta: null,
          trackingEvents: [],
        });
      }
    }

    const overallStatus = deriveOverallTrackingStatus(shipmentDtos, fos);

    return {
      orderId: so.id,
      channelOrderId: so.channelOrderId,
      status: overallStatus,
      shipments: shipmentDtos,
    };
  }
}

// ── Module-level helpers ───────────────────────────────────────────────────

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
  'CJ대한통운': 'CJ', 'CJ 대한통운': 'CJ', cj: 'CJ',
  한진택배: 'HANJIN', 한진: 'HANJIN', hanjin: 'HANJIN',
  롯데택배: 'LOTTE', 롯데: 'LOTTE', '롯데글로벌로지스': 'LOTTE', lotte: 'LOTTE',
  로젠택배: 'LOGEN', 로젠: 'LOGEN', logen: 'LOGEN',
  경동택배: 'KDEXP', 경동: 'KDEXP', kdexp: 'KDEXP',
  'CJ-GLS': 'CJGLS', 'CJ GLS': 'CJGLS', cjgls: 'CJGLS',
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

function deriveOverallTrackingStatus(
  shipments: StoreShipmentDto[],
  fos: { status: string; shippedAt: Date | null }[],
): 'not_shipped' | 'preparing' | 'shipping' | 'delivered' {
  // FO completed 상태가 배송완료의 최우선 근거
  if (fos.some((fo) => FO_DELIVERED_STATUSES.has(fo.status))) return 'delivered';
  if (shipments.length === 0) {
    const hasShipped = fos.some((fo) => fo.status === 'shipped' || fo.shippedAt != null);
    return hasShipped ? 'shipping' : 'preparing';
  }
  if (shipments.every((s) => s.status === 'delivered')) return 'delivered';
  if (shipments.some((s) => s.status === 'in_transit' || s.shippedAt != null)) return 'shipping';
  return 'preparing';
}
