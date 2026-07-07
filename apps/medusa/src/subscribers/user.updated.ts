import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { type SubscriberConfig, type SubscriberArgs } from '@medusajs/medusa';

type UserUpdatedEvent = {
  messageType: string;
  messageKind: string;
  source: {
    service: string;
    aggregateType: string;
    aggregateId: string;
  };
  payload: {
    userId: string;
    email?: string;
  };
};

/**
 * Kafka users.events.v1 토픽의 UserUpdated 이벤트 처리자.
 * user-service 에서 이메일이 변경되면 (예: cafe24 이메일 이관) Medusa customer email 을 따라 갱신한다.
 * 미갱신 시 membership 그룹 sync 의 유령고객 가드(이메일 불일치 → 고객 못 찾음)가 오작동한다.
 */
export default async function handleUserUpdated({
  event: { data },
  container,
}: SubscriberArgs<UserUpdatedEvent>) {
  if (data.messageType !== 'UserUpdated') {
    return;
  }

  // 이메일 변경이 아닌 프로필 수정(닉네임/전화번호 등)은 Medusa 반영 대상 아님
  if (!data.payload.email) {
    return;
  }

  const logger = container.resolve('logger');
  const { userId, email } = data.payload;

  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: customers } = await query.graph({
    entity: 'customer',
    fields: ['id', 'email'],
    filters: {
      'metadata.almond_user_id': userId,
    },
  });

  if (customers.length === 0) {
    logger.info(`✉️ No customer found for UserUpdated(email): userId=${userId}`);
    return;
  }

  const customer = customers[0];
  if (customer.email === email) {
    return;
  }

  await container.resolve(Modules.CUSTOMER).updateCustomers(customer.id, { email });
  logger.info(`✉️ Customer email synced: customerId=${customer.id}, userId=${userId}, email=${email}`);
}

export const config: SubscriberConfig = {
  event: 'users.events.v1',
  context: {
    subscriberId: 'user-updated-email-sync-handler',
  },
};
