import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { OrderCreatedPayload, OrderItem, ShippingAddress } from '@packages/event-contracts/streams';
import { MedusaClient, MedusaOrder } from '../../adapters/medusa/medusa.client';
import { LIFECYCLE_PAYMENT_STATUSES, PAYMENT_ACCEPTED_STATUSES } from '../../adapters/medusa/medusa-order-status';
import {
  CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
  FetchOrdersResult,
  OrderLifecycleEventItem,
  OrderCollectionFailureItem,
  OrderFetchItem,
  OrderFetchOutcome,
  ReplayableChannelOrderProvider,
} from './channel-order-provider.interface';

@Injectable()
export class MedusaOrderProvider implements ReplayableChannelOrderProvider {
  readonly channel = 'medusa';
  private readonly logger = new Logger(MedusaOrderProvider.name);

  constructor(private readonly medusaClient: MedusaClient) {}

  async fetchOrders(since: Date | null): Promise<FetchOrdersResult> {
    const rawOrders = await this.medusaClient.listOrders({ since });

    const orders: OrderFetchItem[] = [];
    const failures: OrderCollectionFailureItem[] = [];
    const lifecycleEvents: OrderLifecycleEventItem[] = [];

    for (const order of rawOrders) {
      lifecycleEvents.push(...this.buildLifecycleEvents(order));

      const outcome = this.buildFetchOutcome(order);
      if (!outcome) {
        continue;
      }
      if (outcome.kind === 'failure') {
        failures.push(outcome.failure);
      } else {
        orders.push(outcome.order);
      }
    }

    return { orders, failures, lifecycleEvents };
  }

  async fetchOrder(externalOrderId: string): Promise<OrderFetchOutcome | null> {
    const order = await this.medusaClient.retrieveOrder(externalOrderId);
    if (!order) {
      return null;
    }
    return this.buildFetchOutcome(order);
  }

  private buildFetchOutcome(order: MedusaOrder): OrderFetchOutcome | null {
    // A canceled order must never seed a brand-new Core SalesOrder: the lifecycle path
    // attaches cancellation/refund only to already-collected orders, so an uncollected
    // canceled snapshot (even one whose payment is still authorized/captured) is observed
    // for lifecycle but is not eligible for OrderCreated.
    const eligibleForOrderCreation = PAYMENT_ACCEPTED_STATUSES.has(order.payment_status) && order.status !== 'canceled';
    const lifecycleStatusSnapshot = this.isLifecycleStatusSnapshot(order);
    const hasLifecycleObservation = lifecycleStatusSnapshot || this.hasLifecycleObservation(order);
    if (!eligibleForOrderCreation && !hasLifecycleObservation) {
      return null;
    }

    const sourceUpdatedAt = this.getSourceUpdatedAt(order);
    const lineItems = order.items ?? [];
    const missingPimIdentityLineIds = lineItems
      .filter((item) => !this.hasRequiredPimIdentity(item))
      .map((item) => item.id);

    if (eligibleForOrderCreation && missingPimIdentityLineIds.length > 0) {
      this.logger.warn(`Quarantining Medusa order ${order.id}: one or more line items missing PIM identity metadata`);
      return {
        kind: 'failure',
        failure: {
          externalOrderId: order.id,
          sourceUpdatedAt,
          reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
          affectedLineIds: missingPimIdentityLineIds,
          rawOrder: order as unknown as Record<string, unknown>,
        },
      };
    }

    const items: OrderItem[] = lineItems.map((item) => {
      const pimVariantId = this.getPimVariantId(item) ?? '';
      const pimMasterId = this.getPimMasterId(item) ?? '';
      const pimVersionId = this.getPimVersionId(item) ?? '';
      return {
        orderItemId: item.id,
        skuId: pimVariantId,
        masterId: pimMasterId,
        versionId: pimVersionId,
        variantId: pimVariantId,
        productName: item.title ?? item.variant?.title ?? item.variant_id ?? item.id,
        channelProductId: item.variant_id ?? item.id,
        quantity: item.quantity ?? 1,
        unitPrice: item.unit_price ?? 0,
        totalPrice: (item.unit_price ?? 0) * (item.quantity ?? 1),
      };
    });

    // Medusa cus_ id 는 core(uuid)로 내보내지 않는다. 가입 시 stamp 된 user-service UUID 를 customer.metadata 에서 해석.
    // 미링크 고객(레거시) 이나 값 부재 시 null — core sales_orders.customer_id 는 nullable uuid 다.
    const almondUserId = order.customer?.metadata?.almond_user_id;
    const customerId = typeof almondUserId === 'string' && almondUserId.length > 0 ? almondUserId : null;

    const addr = order.shipping_address;
    const shippingAddress: ShippingAddress = {
      recipientName: [addr?.first_name, addr?.last_name].filter(Boolean).join(' ') || 'Unknown',
      phone: addr?.phone ?? '',
      postalCode: addr?.postal_code ?? '',
      roadAddress: addr?.address_1 ?? '',
      detailAddress: addr?.address_2 ?? '',
    };

    const walletIntentId = (order.payment_collections ?? [])
      .flatMap((pc) => pc.payments ?? [])
      .map((p) => p.data?.intentId)
      .find((id): id is string => typeof id === 'string' && id.length > 0);

    const createPayload: OrderCreatedPayload = {
      orderId: uuidv4(),
      externalOrderId: order.id,
      salesChannel: 'medusa',
      customerId,
      ...(walletIntentId ? { walletIntentId } : {}),
      items,
      totalAmount: order.total ?? 0,
      subtotalAmount: order.subtotal ?? 0,
      shippingAmount: order.shipping_total ?? 0,
      discountAmount: order.discount_total ?? 0,
      currency: order.currency_code ?? 'KRW',
      shippingAddress,
      status: 'confirmed',
      createdAt: order.created_at ?? new Date().toISOString(),
    };

    return {
      kind: 'order',
      order: {
        externalOrderId: order.id,
        sourceUpdatedAt,
        eligibleForOrderCreation,
        createPayload,
        changes: {
          items,
          shippingAddress,
          totalAmount: order.total ?? 0,
        },
        modifiedAt: sourceUpdatedAt,
      },
    };
  }

  private hasRequiredPimIdentity(item: NonNullable<MedusaOrder['items']>[number]): boolean {
    return Boolean(this.getPimVariantId(item) && this.getPimMasterId(item) && this.getPimVersionId(item));
  }

  private getPimVariantId(item: NonNullable<MedusaOrder['items']>[number]): string | null {
    const pimVariantId = item.variant?.metadata?.pimVariantId;
    return this.getStringMetadataValue(pimVariantId);
  }

  private getPimMasterId(item: NonNullable<MedusaOrder['items']>[number]): string | null {
    const pimMasterId = item.variant?.product?.metadata?.pimMasterId;
    return this.getStringMetadataValue(pimMasterId);
  }

  private getPimVersionId(item: NonNullable<MedusaOrder['items']>[number]): string | null {
    const pimVersionId = item.variant?.product?.metadata?.pimVersionId;
    return this.getStringMetadataValue(pimVersionId);
  }

  private getStringMetadataValue(value: unknown): string | null {
    if (typeof value !== 'string' || value.trim() === '') {
      return null;
    }
    return value;
  }

  private getSourceUpdatedAt(order: MedusaOrder): string {
    return order.updated_at ?? order.created_at ?? new Date().toISOString();
  }

  private hasLifecycleObservation(order: MedusaOrder): boolean {
    return this.buildLifecycleEvents(order).length > 0;
  }

  private isLifecycleStatusSnapshot(order: MedusaOrder): boolean {
    return order.status === 'canceled' || LIFECYCLE_PAYMENT_STATUSES.has(order.payment_status);
  }

  private buildLifecycleEvents(order: MedusaOrder): OrderLifecycleEventItem[] {
    const sourceUpdatedAt = this.getSourceUpdatedAt(order);
    const events: OrderLifecycleEventItem[] = [];

    if (order.status === 'canceled' || order.payment_status === 'canceled') {
      const cancelledAt = order.canceled_at ?? sourceUpdatedAt;
      events.push({
        externalOrderId: order.id,
        sourceUpdatedAt,
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

    const refundEvents = this.getRefundEvents(order);
    for (const refund of refundEvents) {
      events.push({
        externalOrderId: order.id,
        sourceUpdatedAt,
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

    return events;
  }

  private getRefundEvents(order: MedusaOrder): Array<{
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
    const events: Array<{
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
      events.push({
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
          if (!refund.id || amount <= 0 || events.some((event) => event.refundId === refund.id)) {
            continue;
          }
          events.push({
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

    return events;
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
