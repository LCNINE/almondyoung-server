import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { type SubscriberConfig, type SubscriberArgs } from '@medusajs/medusa';

type UserDeletedEvent = {
  messageType: string;
  messageKind: string;
  source: {
    service: string;
    aggregateType: string;
    aggregateId: string;
  };
  payload: {
    userId: string;
    deletedAt?: Date | string;
  };
};

/**
 * Kafka users.events.v1 토픽의 UserDeleted 이벤트 처리자
 * user-service에서 발행한 삭제 이벤트를 수신하여 Medusa 고객을 삭제함
 */
export default async function handleUserDeleted({
  event: { data },
  container,
}: SubscriberArgs<UserDeletedEvent>) {
  // UserDeleted 이벤트만 처리
  if (data.messageType !== 'UserDeleted') {
    return;
  }

  const logger = container.resolve('logger');

  logger.info(`🧹 Handling UserDeleted event: ${JSON.stringify(data.payload)}`);

  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: customers } = await query.graph({
    entity: 'customer',
    fields: ['*'],
    filters: {
      'metadata.almond_user_id': data.payload.userId,
    },
  });

  if (customers.length === 0) {
    logger.info(`🧹 No customer found for UserDeleted: userId=${data.payload.userId}`);
    return;
  }

  await container.resolve(Modules.CUSTOMER).deleteCustomers([customers[0].id]);
  logger.info(`🧹 Customer deleted: customerId=${customers[0].id}, userId=${data.payload.userId}`);
}

export const config: SubscriberConfig = {
  event: 'users.events.v1',
  context: {
    subscriberId: 'user-deleted-handler',
  },
};
