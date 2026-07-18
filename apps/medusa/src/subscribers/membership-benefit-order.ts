import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { type SubscriberConfig, type SubscriberArgs } from '@medusajs/medusa';

const MEMBERSHIP_SERVICE_URL = process.env.MEMBERSHIP_SERVICE_URL || 'http://localhost:3040';

export type OrderItem = {
  id: string;
  unit_price: number;
  compare_at_unit_price: number | null;
  quantity: number;
};

type OrderData = {
  id: string;
  customer_id?: string | null;
  created_at: string;
  items?: OrderItem[];
};

async function getAlmondUserId(customerId: string, container: any): Promise<string | null> {
  const customerModule = container.resolve(Modules.CUSTOMER);
  const customer = await customerModule.retrieveCustomer(customerId, {
    select: ['metadata'],
  });
  return ((customer?.metadata as Record<string, unknown> | null)?.almond_user_id as string | undefined) ?? null;
}

async function getOrderWithPricing(orderId: string, container: any): Promise<OrderData | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'order',
    fields: [
      'id',
      'customer_id',
      'created_at',
      'items.id',
      'items.unit_price',
      'items.compare_at_unit_price',
      'items.quantity',
    ],
    filters: { id: orderId },
  });
  return (data?.[0] as OrderData) ?? null;
}

export function calculateMembershipDiscount(items: OrderItem[]): number {
  return items.reduce((acc, item) => {
    const compareAt = item.compare_at_unit_price;
    if (compareAt != null && compareAt > item.unit_price) {
      return acc + (compareAt - item.unit_price) * item.quantity;
    }
    return acc;
  }, 0);
}

export default async function handleMembershipBenefitOrder({ event, container }: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve('logger');
  const orderId = event.data.id;
  const eventName = event.name;

  try {
    if (eventName === 'order.placed') {
      const order = await getOrderWithPricing(orderId, container);
      if (!order) {
        logger.warn(`[MembershipBenefit] Order ${orderId} not found`);
        return;
      }

      const customerId = order.customer_id;
      if (!customerId) return;

      const discountAmount = calculateMembershipDiscount(order.items ?? []);
      if (discountAmount <= 0) return;

      const userId = await getAlmondUserId(customerId, container);
      if (!userId) {
        logger.warn(`[MembershipBenefit] Customer ${customerId} has no almond_user_id, skipping`);
        return;
      }

      const recordRes = await fetch(`${MEMBERSHIP_SERVICE_URL}/membership/benefits/internal/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          userId,
          membershipDiscountAmount: Math.round(discountAmount),
          // created_at 은 PG 포맷("...306+00", 공백/offset)으로 올 수 있어 membership 의
          // z.string().datetime()(T+Z 요구)에서 400 이 난다. ISO 로 정규화한다.
          orderDate: new Date(order.created_at).toISOString(),
        }),
        signal: AbortSignal.timeout(5000),
      });

      // 응답을 확인하지 않으면 401/500 이 조용히 삼켜져 혜택이 영영 기록되지 않는다.
      if (!recordRes.ok) {
        const body = await recordRes.text().catch(() => '');
        logger.error(
          `[MembershipBenefit] record failed (${recordRes.status}) userId=${userId} orderId=${orderId}: ${body.slice(0, 300)}`,
        );
        return;
      }

      logger.info(
        `[MembershipBenefit] Recorded discount: userId=${userId}, orderId=${orderId}, amount=${discountAmount}`,
      );
    } else if (eventName === 'order.canceled') {
      await fetch(`${MEMBERSHIP_SERVICE_URL}/membership/benefits/internal/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
        signal: AbortSignal.timeout(5000),
      });

      logger.info(`[MembershipBenefit] Cancelled benefit for order ${orderId}`);
    }
  } catch (err) {
    logger.error(`[MembershipBenefit] ${eventName} handler error for order ${orderId}:`, err);
  }
}

export const config: SubscriberConfig = {
  event: ['order.placed', 'order.canceled'],
  context: {
    subscriberId: 'membership-benefit-order-handler',
  },
};
