import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { type SubscriberConfig, type SubscriberArgs } from '@medusajs/medusa';

const MEMBERSHIP_SERVICE_URL =
  process.env.MEMBERSHIP_SERVICE_URL || 'http://localhost:3040';

const WELCOME_MEMBERSHIP_TAG = 'welcome-membership';

type OrderItem = {
  id: string;
  product_id: string;
};

type OrderData = {
  id: string;
  customer_id?: string | null;
  status: string;
  items?: OrderItem[];
};

async function getAlmondUserId(
  customerId: string,
  container: any,
): Promise<string | null> {
  const customerModule = container.resolve(Modules.CUSTOMER);
  const customer = await customerModule.retrieveCustomer(customerId, {
    select: ['metadata'],
  });
  return (
    ((customer?.metadata as Record<string, unknown> | null)
      ?.almond_user_id as string | undefined) ?? null
  );
}

async function checkProductsHaveWMTag(
  productIds: string[],
  container: any,
): Promise<boolean> {
  if (!productIds.length) return false;
  const productModule = container.resolve(Modules.PRODUCT);
  const products = await productModule.listProducts(
    { id: productIds },
    { relations: ['tags'] },
  );
  return products.some((p: any) =>
    (p.tags ?? []).some(
      (tag: any) => tag.value === WELCOME_MEMBERSHIP_TAG,
    ),
  );
}

async function getOrderData(
  orderId: string,
  container: any,
): Promise<OrderData | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'order',
    fields: ['id', 'customer_id', 'status', 'items.id', 'items.product_id'],
    filters: { id: orderId },
  });
  return (data?.[0] as OrderData) ?? null;
}

async function hasOtherActiveMedusaWMOrders(
  customerId: string,
  excludeOrderId: string,
  container: any,
): Promise<boolean> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'order',
    fields: ['id', 'status', 'items.id', 'items.product_id'],
    filters: { customer_id: customerId },
  });

  const otherActiveOrders = (data as OrderData[]).filter(
    (order) => order.id !== excludeOrderId && order.status !== 'canceled',
  );

  for (const order of otherActiveOrders) {
    const productIds = (order.items ?? [])
      .map((item) => item.product_id)
      .filter(Boolean);
    const hasWM = await checkProductsHaveWMTag(productIds, container);
    if (hasWM) return true;
  }

  return false;
}

export default async function handleWelcomeMembershipOrder({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve('logger');
  const orderId = event.data.id;
  const eventName = event.name;

  try {
    const order = await getOrderData(orderId, container);
    if (!order) {
      logger.warn(`[WelcomeMembership] Order ${orderId} not found`);
      return;
    }

    const customerId = order.customer_id;
    if (!customerId) {
      logger.info(
        `[WelcomeMembership] Order ${orderId} has no customer_id, skipping`,
      );
      return;
    }

    const productIds = (order.items ?? [])
      .map((item) => item.product_id)
      .filter(Boolean);
    const hasWMItems = await checkProductsHaveWMTag(productIds, container);

    if (!hasWMItems) {
      return;
    }

    const userId = await getAlmondUserId(customerId, container);
    if (!userId) {
      logger.warn(
        `[WelcomeMembership] Customer ${customerId} has no almond_user_id, skipping`,
      );
      return;
    }

    if (eventName === 'order.placed') {
      await fetch(
        `${MEMBERSHIP_SERVICE_URL}/welcome-membership/eligibility/${userId}/purchased`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId }),
          signal: AbortSignal.timeout(5000),
        },
      );
      logger.info(
        `[WelcomeMembership] Marked purchased: userId=${userId}, orderId=${orderId}`,
      );
    } else if (eventName === 'order.canceled') {
      const hasOther = await hasOtherActiveMedusaWMOrders(
        customerId,
        orderId,
        container,
      );
      if (hasOther) {
        logger.info(
          `[WelcomeMembership] User ${userId} has other active WM orders, not reverting`,
        );
        return;
      }

      await fetch(
        `${MEMBERSHIP_SERVICE_URL}/welcome-membership/eligibility/${userId}/purchased`,
        {
          method: 'DELETE',
          signal: AbortSignal.timeout(5000),
        },
      );
      logger.info(
        `[WelcomeMembership] Reverted purchase: userId=${userId}, orderId=${orderId}`,
      );
    }
  } catch (err) {
    logger.error(
      `[WelcomeMembership] ${eventName} handler error for order ${orderId}:`,
      err,
    );
  }
}

export const config: SubscriberConfig = {
  event: ['order.placed', 'order.canceled'],
  context: {
    subscriberId: 'welcome-membership-order-handler',
  },
};
