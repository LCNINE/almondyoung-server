import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { OrderCreatedPayload, OrderItem, ShippingAddress } from '@packages/event-contracts/streams';
import { MedusaClient } from '../../adapters/medusa/medusa.client';
import { ChannelOrderProvider, FetchOrdersResult, OrderFetchItem } from './channel-order-provider.interface';

@Injectable()
export class MedusaOrderProvider implements ChannelOrderProvider {
  readonly channel = 'medusa';
  private readonly logger = new Logger(MedusaOrderProvider.name);

  constructor(private readonly medusaClient: MedusaClient) {}

  async fetchOrders(since: Date | null): Promise<FetchOrdersResult> {
    const rawOrders = await this.medusaClient.listOrders({ since });

    const orders: OrderFetchItem[] = [];
    let skipped = 0;

    for (const order of rawOrders) {
      const lineItems = order.items ?? [];

      // pimVariantId가 없는 line item이 하나라도 있으면 주문 전체 skip
      const hasMissingMapping = lineItems.some((item) => !item.variant?.metadata?.pimVariantId);

      if (hasMissingMapping) {
        this.logger.warn(`Skipping Medusa order ${order.id}: one or more line items missing pimVariantId`);
        skipped++;
        continue;
      }

      const items: OrderItem[] = lineItems.map((item) => ({
        orderItemId: item.id,
        skuId: item.variant?.metadata?.pimVariantId as string,
        masterId: (item.variant?.product?.metadata?.pimMasterId as string) ?? '',
        versionId: (item.variant?.product?.metadata?.pimVersionId as string) ?? '',
        variantId: item.variant?.metadata?.pimVariantId as string,
        productName: item.title ?? item.variant?.title ?? '',
        channelProductId: item.variant_id ?? item.id,
        quantity: item.quantity ?? 1,
        unitPrice: item.unit_price ?? 0,
        totalPrice: (item.unit_price ?? 0) * (item.quantity ?? 1),
      }));

      const addr = order.shipping_address;
      const shippingAddress: ShippingAddress = {
        recipientName: [addr?.first_name, addr?.last_name].filter(Boolean).join(' ') || 'Unknown',
        phone: addr?.phone ?? '',
        postalCode: addr?.postal_code ?? '',
        roadAddress: addr?.address_1 ?? '',
        detailAddress: addr?.address_2 ?? '',
      };

      const sourceUpdatedAt = order.updated_at ?? order.created_at ?? new Date().toISOString();

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

      orders.push({
        externalOrderId: order.id,
        sourceUpdatedAt,
        createPayload,
        changes: {
          items,
          shippingAddress,
          totalAmount: order.total ?? 0,
        },
        modifiedAt: sourceUpdatedAt,
      });
    }

    return { orders, skipped };
  }
}
