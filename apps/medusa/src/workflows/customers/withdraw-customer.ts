import { createWorkflow, transform, when, WorkflowResponse } from '@medusajs/framework/workflows-sdk';
import {
  deleteCustomerAddressesWorkflow,
  deleteCustomersWorkflow,
  updateCustomersWorkflow,
  useQueryGraphStep,
} from '@medusajs/medusa/core-flows';
import { deleteAuthIdentitiesStep } from './steps/delete-auth-identities-step';
import { buildWithdrawnCustomerUpdate } from './withdrawn-customer-fields';

export type WithdrawCustomerInput = { almondUserId: string };
export type WithdrawCustomerResult = {
  customer: 'anonymized' | 'not_found';
  auth_identities_deleted: number;
};

/**
 * 탈퇴 회원의 Medusa 흔적을 파기한다 (#786, 스펙 §4.3).
 *
 * 키가 customer id 가 아니라 userId 인 이유: ③ 이 `almond_user_id` 를 지우므로 customer id 로는 재시도가
 * 「없음」이 된다. userId 로 두면 두 번째 호출이 고객 없음 → ⑤ 만 다시 돌아 0 건 → 200. 재시도와 백필
 * 재실행이 안전하다.
 *
 * ① 미삭제 고객 조회 ② 주소 하드 삭제(소프트 삭제는 파기가 아니다; 주문은 자체 주소 스냅샷을 갖는다)
 * ③ 익명화(코어 step 의 보상이 이전 값 복원) ④ 소프트 삭제 ⑤ auth identity 삭제(보상 없음, 마지막).
 * ②③④ 는 고객이 있을 때만, ⑤ 는 항상.
 */
export const withdrawCustomerWorkflow = createWorkflow(
  'withdraw-customer',
  (input: WithdrawCustomerInput) => {
    const { data: customers } = useQueryGraphStep({
      entity: 'customer',
      fields: ['id', 'email', 'metadata', 'addresses.id'],
      filters: { metadata: { almond_user_id: input.almondUserId } },
    });

    const customer = transform({ customers }, ({ customers }) => customers[0] ?? null);
    const hasCustomer = transform({ customer }, ({ customer }) => customer !== null);

    when({ hasCustomer }, ({ hasCustomer }) => hasCustomer).then(() => {
      const addressIds = transform({ customer }, ({ customer }) =>
        (customer?.addresses ?? []).map((a: { id: string }) => a.id),
      );
      when({ addressIds }, ({ addressIds }) => addressIds.length > 0).then(() => {
        deleteCustomerAddressesWorkflow.runAsStep({ input: { ids: addressIds } });
      });

      const update = transform({ customer, input }, ({ customer, input }) =>
        buildWithdrawnCustomerUpdate(input.almondUserId, customer?.metadata),
      );
      const customerId = transform({ customer }, ({ customer }) => customer!.id);
      updateCustomersWorkflow.runAsStep({ input: { selector: { id: customerId }, update } });
      deleteCustomersWorkflow.runAsStep({ input: { ids: [customerId] } });
    });

    const deleted = deleteAuthIdentitiesStep({
      almondUserId: input.almondUserId,
      customerId: transform({ customer }, ({ customer }) => customer?.id ?? null),
      emailBeforeAnonymize: transform({ customer }, ({ customer }) => customer?.email ?? null),
    });

    const result = transform({ hasCustomer, deleted }, ({ hasCustomer, deleted }): WithdrawCustomerResult => ({
      customer: hasCustomer ? 'anonymized' : 'not_found',
      auth_identities_deleted: deleted.deleted,
    }));

    return new WorkflowResponse(result);
  },
);
