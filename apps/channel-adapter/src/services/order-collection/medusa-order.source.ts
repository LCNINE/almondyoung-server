import { Injectable } from '@nestjs/common';
import type { SalesChannel, ShippingAddress } from '@packages/event-contracts/streams';
import { MedusaClient, MedusaOrder } from '../../adapters/medusa/medusa.client';
import { LIFECYCLE_PAYMENT_STATUSES, PAYMENT_ACCEPTED_STATUSES } from '../../adapters/medusa/medusa-order-status';
import {
  ChannelOrderLineSnapshot,
  ChannelOrderSnapshot,
  ChannelPaymentState,
  LifecycleObservation,
  ReplayableChannelOrderSource,
} from './channel-order-source.interface';
import { buildDeliveryNote, readEntrancePassword } from './shipping-memo-label';

type MedusaLineItem = NonNullable<MedusaOrder['items']>[number];

/**
 * Medusa 주문 → 채널 원어 스냅샷 (ADR-0031, 후보 2).
 *
 * 여기 남은 것은 전부 Medusa 고유 사실이다 — 결제 상태 해석, 무통장/환불신청 metadata, 라인의
 * 이행 의도 판별, 환불 행이 두 곳(order transaction / payment refund)에 나타나는 것. Core 계약
 * 조립과 식별 해석 정책은 `ChannelOrderTranslator` 가 갖는다.
 */
@Injectable()
export class MedusaOrderSource implements ReplayableChannelOrderSource {
  readonly channel: SalesChannel = 'medusa';

  constructor(private readonly medusaClient: MedusaClient) {}

  async fetchOrders(since: Date | null): Promise<ChannelOrderSnapshot[]> {
    const rawOrders = await this.medusaClient.listOrders({ since });
    return rawOrders.flatMap((order) => {
      const snapshot = this.buildSnapshot(order);
      return snapshot ? [snapshot] : [];
    });
  }

  async fetchOrder(externalOrderId: string): Promise<ChannelOrderSnapshot | null> {
    const order = await this.medusaClient.retrieveOrder(externalOrderId);
    if (!order) {
      return null;
    }
    return this.buildSnapshot(order);
  }

  /**
   * 보고할 가치가 없는 주문은 여기서 걸러진다 — `pending` 이면서 관측할 사후 사건도 없는 주문은
   * 판매주문 후보도 아니고 라이프사이클 관측도 아니다.
   */
  private buildSnapshot(order: MedusaOrder): ChannelOrderSnapshot | null {
    const paymentState = this.resolvePaymentState(order);
    const lifecycle = this.buildLifecycleObservations(order);

    if (paymentState === 'pending' && lifecycle.length === 0) {
      return null;
    }

    const sourceUpdatedAt = this.getSourceUpdatedAt(order);
    const entrancePassword = readEntrancePassword(
      order.metadata as Record<string, unknown> | null | undefined,
    );

    return {
      externalOrderId: order.id,
      sourceUpdatedAt,
      paymentState,
      ...(order.display_id != null ? { displayOrderNo: String(order.display_id) } : {}),
      customerId: this.resolveCustomerId(order),
      ...(order.email ? { email: order.email } : {}),
      ...(this.resolveWalletIntentId(order) ? { walletIntentId: this.resolveWalletIntentId(order)! } : {}),
      lines: (order.items ?? []).map((item) => this.buildLine(item)),
      amounts: {
        total: order.total ?? 0,
        subtotal: order.subtotal ?? 0,
        shipping: order.shipping_total ?? 0,
        discount: order.discount_total ?? 0,
        points: this.resolvePointsAmount(order),
        currency: order.currency_code ?? 'KRW',
      },
      shippingAddress: this.buildShippingAddress(order),
      ...(entrancePassword ? { entrancePassword } : {}),
      createdAt: order.created_at ?? new Date().toISOString(),
      lifecycle,
      raw: order as unknown as Record<string, unknown>,
    };
  }

  /**
   * 취소된 주문은 결제가 아직 authorized/captured 여도 새 판매주문을 만들지 않는다 — 이미 수집된
   * 주문에 취소를 붙이는 라이프사이클 경로만 탄다.
   *
   * 무통장입금 선생성 주문은 입금 확인 전에도 결제가 authorized 라 그대로 두면 출고 파이프라인에
   * 태워진다. 다만 게이트를 metadata 단독이 아니라 `payment_status` 와 **함께** 본다 — 관리자
   * 입금확인 후 `captured` 가 됐는데 metadata 갱신만 실패한 경우 수집이 영구히 막히면 안 된다.
   *
   * 환불 '신청'(승인 전)은 고객이 환불을 원했는데 출고되는 휴먼 에러를 막기 위해 제외한다.
   */
  private resolvePaymentState(order: MedusaOrder): ChannelPaymentState {
    const metadata = (order.metadata ?? {}) as Record<string, unknown>;
    const isAwaitingBankDeposit =
      metadata.bank_transfer_status === 'awaiting_deposit' && order.payment_status !== 'captured';
    const isRefundRequested = metadata.refund_status === 'requested';

    if (order.status === 'canceled' || LIFECYCLE_PAYMENT_STATUSES.has(order.payment_status)) {
      return 'terminal';
    }
    if (PAYMENT_ACCEPTED_STATUSES.has(order.payment_status) && !isAwaitingBankDeposit && !isRefundRequested) {
      return 'accepted';
    }
    return 'pending';
  }

  private buildLine(item: MedusaLineItem): ChannelOrderLineSnapshot {
    const { fulfillmentKind, requiresShipping } = this.resolveFulfillment(item);
    return {
      channelOrderItemId: item.id,
      ...(item.variant_id ? { channelProductId: item.variant_id } : {}),
      ...(this.stringMetadata(item.variant?.metadata?.pimVariantId)
        ? { embeddedVariantId: this.stringMetadata(item.variant?.metadata?.pimVariantId)! }
        : {}),
      ...(this.stringMetadata(item.variant?.product?.metadata?.pimMasterId)
        ? { embeddedMasterId: this.stringMetadata(item.variant?.product?.metadata?.pimMasterId)! }
        : {}),
      ...(this.stringMetadata(item.variant?.product?.metadata?.pimVersionId)
        ? { embeddedVersionId: this.stringMetadata(item.variant?.product?.metadata?.pimVersionId)! }
        : {}),
      productName: item.title ?? item.variant?.title ?? item.variant_id ?? item.id,
      quantity: item.quantity ?? 1,
      unitPrice: item.unit_price ?? 0,
      fulfillmentKind,
      requiresShipping,
    };
  }

  /**
   * 라인의 이행 의도(물리/디지털)를 해석한다. downstream(WMS/FO)이 물리 출고 대상 여부를
   * 명시적으로 판단할 수 있도록 보존한다.
   * 우선순위: line item.requires_shipping → product.metadata.requiresShipping
   *          → product.metadata.fulfillmentKind('digital'면 배송 불필요). 모두 없으면 물리로 간주.
   */
  private resolveFulfillment(item: MedusaLineItem): {
    fulfillmentKind: 'physical' | 'digital';
    requiresShipping: boolean;
  } {
    const meta = (item.variant?.product?.metadata ?? {}) as Record<string, unknown>;
    const metaFulfillmentKind =
      meta.fulfillmentKind === 'digital' ? 'digital' : meta.fulfillmentKind === 'physical' ? 'physical' : undefined;
    const metaRequiresShipping =
      typeof meta.requiresShipping === 'boolean' ? (meta.requiresShipping as boolean) : undefined;
    const itemRequiresShipping =
      typeof (item as { requires_shipping?: unknown }).requires_shipping === 'boolean'
        ? ((item as { requires_shipping?: boolean }).requires_shipping as boolean)
        : undefined;

    if (itemRequiresShipping !== undefined) {
      return {
        fulfillmentKind: itemRequiresShipping ? 'physical' : 'digital',
        requiresShipping: itemRequiresShipping,
      };
    }

    const requiresShipping = metaRequiresShipping ?? metaFulfillmentKind !== 'digital';
    const fulfillmentKind: 'physical' | 'digital' = metaFulfillmentKind ?? (requiresShipping ? 'physical' : 'digital');
    return { fulfillmentKind, requiresShipping };
  }

  /** Medusa `cus_` id 는 Core 로 내보내지 않는다. 가입 시 stamp 된 user-service UUID 를 해석한다. */
  private resolveCustomerId(order: MedusaOrder): string | null {
    const almondUserId = order.customer?.metadata?.almond_user_id;
    return typeof almondUserId === 'string' && almondUserId.length > 0 ? almondUserId : null;
  }

  private resolveWalletIntentId(order: MedusaOrder): string | undefined {
    return (order.payment_collections ?? [])
      .flatMap((pc) => pc.payments ?? [])
      .map((p) => p.data?.intentId)
      .find((id): id is string => typeof id === 'string' && id.length > 0);
  }

  /**
   * 포인트 결제분은 결제 시점에 payment-events 훅이 `order.metadata` 로 새겨둔다. Medusa 는
   * 포인트를 할인이 아닌 결제수단으로 보기 때문에 `discount_total` 로는 알 수 없다.
   */
  private resolvePointsAmount(order: MedusaOrder): number {
    const rawPoints = (order.metadata as Record<string, unknown> | null | undefined)?.points_amount;
    const parsed = typeof rawPoints === 'number' ? rawPoints : Number(rawPoints);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  private buildShippingAddress(order: MedusaOrder): ShippingAddress {
    const addr = order.shipping_address;
    const deliveryNote = buildDeliveryNote(order.metadata as Record<string, unknown> | null | undefined);
    return {
      recipientName: [addr?.first_name, addr?.last_name].filter(Boolean).join(' ') || 'Unknown',
      phone: addr?.phone ?? '',
      postalCode: addr?.postal_code ?? '',
      roadAddress: addr?.address_1 ?? '',
      detailAddress: addr?.address_2 ?? '',
      ...(deliveryNote ? { deliveryNote } : {}),
      personalCustomsCode:
        (addr?.metadata?.personalCustomsCode as string | undefined) ??
        (order.metadata?.personalCustomsCode as string | undefined) ??
        undefined,
    };
  }

  private stringMetadata(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.trim() === '') {
      return undefined;
    }
    return value;
  }

  private getSourceUpdatedAt(order: MedusaOrder): string {
    return order.updated_at ?? order.created_at ?? new Date().toISOString();
  }

  private buildLifecycleObservations(order: MedusaOrder): LifecycleObservation[] {
    const sourceUpdatedAt = this.getSourceUpdatedAt(order);
    const observations: LifecycleObservation[] = [];

    if (order.status === 'canceled' || order.payment_status === 'canceled') {
      const cancelledAt = order.canceled_at ?? sourceUpdatedAt;
      observations.push({
        eventType: 'OrderCancelled',
        eventKey: 'cancelled',
        payload: {
          reason: 'ADMIN_CANCEL',
          reasonDetail: 'Medusa order cancellation collected',
          cancelledBy: 'medusa',
          cancelledAt,
          refundRequired: false,
        },
        rawEvent: {
          externalOrderId: order.id,
          cancelledAt,
        },
      });
    }

    for (const refund of this.getRefunds(order)) {
      observations.push({
        eventType: 'OrderRefundCreated',
        eventKey: `refund:${refund.refundId}`,
        payload: {
          refundId: refund.refundId,
          paymentId: refund.paymentId,
          amount: refund.amount,
          currency: refund.currency,
          reason: refund.reason,
          note: refund.note,
          createdBy: 'medusa',
          createdAt: refund.createdAt,
        },
        rawEvent: {
          externalOrderId: order.id,
          refundId: refund.refundId,
          paymentId: refund.paymentId,
          amount: refund.amount,
          currency: refund.currency,
          source: refund.source,
        },
      });
    }

    return observations;
  }

  private getRefunds(order: MedusaOrder): Array<{
    refundId: string;
    paymentId: string;
    amount: number;
    currency: string;
    reason: string;
    note?: string;
    createdAt: string;
    source: string;
  }> {
    const currency = order.currency_code ?? 'KRW';
    const sourceUpdatedAt = this.getSourceUpdatedAt(order);
    const refunds: Array<{
      refundId: string;
      paymentId: string;
      amount: number;
      currency: string;
      reason: string;
      note?: string;
      createdAt: string;
      source: string;
    }> = [];

    for (const transaction of order.transactions ?? []) {
      if (transaction.reference !== 'refund' && Number(transaction.amount) >= 0) {
        continue;
      }
      const amount = Math.abs(Number(transaction.amount ?? 0));
      if (amount <= 0) {
        continue;
      }
      const refundId = transaction.reference_id ?? transaction.id;
      if (!refundId) {
        continue;
      }
      refunds.push({
        refundId,
        paymentId: this.getFirstPaymentId(order) ?? transaction.reference ?? 'refund',
        amount,
        currency: transaction.currency_code ?? currency,
        reason: 'MEDUSA_REFUND',
        createdAt: transaction.created_at ?? sourceUpdatedAt,
        source: 'order_transaction',
      });
    }

    for (const collection of order.payment_collections ?? []) {
      for (const payment of collection.payments ?? []) {
        for (const refund of payment.refunds ?? []) {
          const amount = Number(refund.amount ?? 0);
          if (!refund.id || amount <= 0 || refunds.some((existing) => existing.refundId === refund.id)) {
            continue;
          }
          refunds.push({
            refundId: refund.id,
            paymentId: payment.id ?? collection.id ?? 'unknown',
            amount,
            currency,
            reason: 'MEDUSA_REFUND',
            createdAt: refund.created_at ?? sourceUpdatedAt,
            source: 'payment_refund',
          });
        }
      }
    }

    return refunds;
  }

  private getFirstPaymentId(order: MedusaOrder): string | null {
    for (const collection of order.payment_collections ?? []) {
      for (const payment of collection.payments ?? []) {
        if (payment.id) {
          return payment.id;
        }
      }
    }
    return null;
  }
}
