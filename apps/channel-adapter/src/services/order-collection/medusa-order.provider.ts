import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { OrderCreatedPayload, OrderItem, ShippingAddress } from '@packages/event-contracts/streams';
import { MedusaClient, MedusaOrder } from '../../adapters/medusa/medusa.client';
import {
  CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
  FetchOrdersResult,
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

    for (const order of rawOrders) {
      const outcome = this.buildFetchOutcome(order);
      if (outcome.kind === 'failure') {
        failures.push(outcome.failure);
      } else {
        orders.push(outcome.order);
      }
    }

    return { orders, failures };
  }

  async fetchOrder(externalOrderId: string): Promise<OrderFetchOutcome | null> {
    const order = await this.medusaClient.retrieveOrder(externalOrderId);
    if (!order) {
      return null;
    }
    return this.buildFetchOutcome(order);
  }

  private buildFetchOutcome(order: MedusaOrder): OrderFetchOutcome {
    const lineItems = order.items ?? [];
    const missingPimVariantLineIds = lineItems.filter((item) => !this.getPimVariantId(item)).map((item) => item.id);

    const sourceUpdatedAt = this.getSourceUpdatedAt(order);

    if (missingPimVariantLineIds.length > 0) {
      this.logger.warn(`Quarantining Medusa order ${order.id}: one or more line items missing pimVariantId`);
      return {
        kind: 'failure',
        failure: {
          externalOrderId: order.id,
          sourceUpdatedAt,
          reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
          affectedLineIds: missingPimVariantLineIds,
          rawOrder: order as unknown as Record<string, unknown>,
        },
      };
    }

    const items: OrderItem[] = lineItems.map((item) => {
      const pimVariantId = this.getPimVariantId(item)!;
      return {
        orderItemId: item.id,
        skuId: pimVariantId,
        masterId: (item.variant?.product?.metadata?.pimMasterId as string) ?? '',
        versionId: (item.variant?.product?.metadata?.pimVersionId as string) ?? '',
        variantId: pimVariantId,
        productName: item.title ?? item.variant?.title ?? '',
        channelProductId: item.variant_id ?? item.id,
        quantity: item.quantity ?? 1,
        unitPrice: item.unit_price ?? 0,
        totalPrice: (item.unit_price ?? 0) * (item.quantity ?? 1),
      };
    });

    const addr = order.shipping_address;
    const shippingAddress: ShippingAddress = {
      recipientName: [addr?.first_name, addr?.last_name].filter(Boolean).join(' ') || 'Unknown',
      phone: addr?.phone ?? '',
      postalCode: addr?.postal_code ?? '',
      roadAddress: addr?.address_1 ?? '',
      detailAddress: addr?.address_2 ?? '',
    };

    const createPayload: OrderCreatedPayload = {
      orderId: uuidv4(),
      externalOrderId: order.id,
      salesChannel: 'medusa',
      customerId: order.customer_id ?? order.email ?? 'guest',
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

  private getPimVariantId(item: NonNullable<MedusaOrder['items']>[number]): string | null {
    const pimVariantId = item.variant?.metadata?.pimVariantId;
    if (typeof pimVariantId !== 'string' || pimVariantId.trim() === '') {
      return null;
    }
    return pimVariantId;
  }

  private getSourceUpdatedAt(order: MedusaOrder): string {
    return order.updated_at ?? order.created_at ?? new Date().toISOString();
  }
}
