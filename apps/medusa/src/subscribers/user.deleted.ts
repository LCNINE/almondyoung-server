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
 * Kafka users.events.v1 토픽의 UserDeleted 이벤트 처리자.
 *
 * 탈퇴한 회원의 Medusa 고객 정보를 익명화한 뒤 소프트 삭제한다.
 *
 * 하드 삭제(`deleteCustomers`)를 쓰지 않는 이유: `order` 는 `customer` 를 FK 로 참조하지 않아
 * 주문 자체는 남지만, 고객 행이 사라지면 주문과 사람의 연결이 끊겨 전자상거래법상 5년 보관해야
 * 하는 계약·결제 기록을 주체 기준으로 찾을 수 없게 된다. 반대로 행을 그대로 두면 이름·이메일이
 * 남아 "탈퇴 시 지체 없이 파기" 약속을 어긴다. 그래서 식별정보만 지우고 행은 남긴다.
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

  const customerModule = container.resolve(Modules.CUSTOMER);
  const customerId = customers[0].id;

  // user-service 와 같은 규칙으로 치환한다. 이메일이 유일 제약을 가지므로, 치환해야 같은
  // 주소로 재가입한 사람이 새 고객을 만들 수 있다.
  const token = data.payload.userId.replace(/-/g, '');
  await customerModule.updateCustomers(customerId, {
    email: `withdrawn_${token}@deleted.invalid`,
    first_name: '탈퇴회원',
    last_name: null,
    phone: null,
    company_name: null,
    metadata: { ...(customers[0].metadata ?? {}), almond_user_id: null, withdrawn_at: new Date().toISOString() },
  });

  await customerModule.softDeleteCustomers([customerId]);
  logger.info(`🧹 Customer anonymized and soft-deleted: customerId=${customerId}, userId=${data.payload.userId}`);
}

export const config: SubscriberConfig = {
  event: 'users.events.v1',
  context: {
    subscriberId: 'user-deleted-handler',
  },
};
