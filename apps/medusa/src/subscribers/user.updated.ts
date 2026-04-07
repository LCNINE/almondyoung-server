import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { type SubscriberConfig, type SubscriberArgs } from '@medusajs/medusa';
import { updateCustomersWorkflow } from '@medusajs/core-flows';

/**
 * user-service에서 UserUpdated 이벤트 수신 시 Medusa customer 동기화
 *
 * 동기화 항목:
 * - username → customer.first_name
 */
export default async function handleUserUpdated({
  event,
  container,
}: SubscriberArgs<{
  userId: string;
  username?: string;
}>) {
  const logger = container.resolve('logger');

  logger.info(`[UserUpdated] Received event: ${JSON.stringify(event.data)}`);

  const { userId, username } = event.data;

  if (!username) {
    logger.info(`[UserUpdated] No username to update for userId: ${userId}`);
    return;
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: customers } = await query.graph({
    entity: 'customer',
    fields: ['id', 'first_name'],
    filters: {
      'metadata.almond_user_id': userId,
    },
  });

  if (customers.length === 0) {
    logger.info(`[UserUpdated] No customer found for userId: ${userId}`);
    return;
  }

  const customer = customers[0];

  if (username === customer.first_name) {
    logger.info(`[UserUpdated] No changes for customer: ${customer.id}`);
    return;
  }

  logger.info(`[UserUpdated] Updating customer name: ${customer.first_name} → ${username}`);

  await updateCustomersWorkflow(container).run({
    input: {
      selector: { id: customer.id },
      update: {
        first_name: username,
        last_name: '',
      },
    },
  });

  logger.info(`[UserUpdated] Successfully updated customer ${customer.id}`);
}

export const config: SubscriberConfig = {
  event: 'user.updated',
  context: {
    subscriberId: 'user-updated-handler',
  },
};
