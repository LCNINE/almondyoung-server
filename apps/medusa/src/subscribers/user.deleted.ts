import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { type SubscriberConfig, type SubscriberArgs } from '@medusajs/medusa';

/**
 * 메두사 내부 이벤트 버스의 user.deleted 이벤트 처리자
 * 유저서비스에서 영구 삭제 신호를 수신해 내부 정리 작업을 수행할 수 있습니다.
 */
export default async function handleUserDeleted({
  event,
  container,
}: SubscriberArgs<{
  userId: string;
  deletedAt?: Date | string;
  rawData?: any;
}>) {
  const logger = container.resolve('logger');

  logger.info(`🧹 Handling user.deleted event: ${JSON.stringify(event.data)}`);

  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: customers } = await query.graph({
    entity: 'customer',
    fields: ['*'],
    filters: {
      'metadata.almond_user_id': event.data.userId,
    },
  });

  if (customers.length === 0) {
    logger.info(
      `🧹 No customer found for user.deleted event: ${JSON.stringify(event.data)}`,
    );
    return;
  }

  await container.resolve(Modules.CUSTOMER).deleteCustomers([customers[0].id]);
}

export const config: SubscriberConfig = {
  event: 'user.deleted',
  context: {
    subscriberId: 'user-deleted-handler',
  },
};
