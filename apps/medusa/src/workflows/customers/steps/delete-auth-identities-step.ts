import { IAuthModuleService } from '@medusajs/framework/types';
import { Modules } from '@medusajs/framework/utils';
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';

export type DeleteAuthIdentitiesStepInput = {
  almondUserId: string;
  /** 고객이 있을 때만. `app_metadata.customer_id` 로 연결된 identity 를 찾는다 */
  customerId: string | null;
  /** 익명화 **전** 이메일. 레거시 `my-auth` provider 는 entity_id 가 이메일이었다 */
  emailBeforeAnonymize: string | null;
};

/**
 * 탈퇴 회원의 auth identity 를 전부 지운다.
 *
 * 여기에 이메일·이름(`provider_identity.user_metadata`)과 IdP access/refresh 토큰(`provider_metadata`)이 있다.
 * `auth_identity` 를 지우면 `provider_identity` 는 cascade 로 따라간다(`@medusajs/auth` 모델).
 *
 * 세 경로로 모은다 — (a) `app_metadata.customer_id` (SSO 콜백이 링크한 것) (b) `user-service-sso` provider 의
 * `entity_id = userId` (c) 레거시 `my-auth` provider 의 `entity_id = 이메일`. 어느 것도 없을 수 있고, 그것은
 * 실패가 아니다 (한 번도 로그인 안 한 회원, 이미 지운 뒤의 재시도).
 *
 * 보상은 없다 — 워크플로의 마지막 step 이고, 삭제를 되돌릴 수 없다. 앞 step 들이 먼저 실패하면 여기까지
 * 오지 않는다.
 */
export const deleteAuthIdentitiesStep = createStep(
  'withdraw-delete-auth-identities',
  async (input: DeleteAuthIdentitiesStepInput, { container }) => {
    const auth = container.resolve<IAuthModuleService>(Modules.AUTH);
    const ids = new Set<string>();

    if (input.customerId) {
      const linked = await auth.listAuthIdentities({ app_metadata: { customer_id: input.customerId } });
      for (const identity of linked) ids.add(identity.id);
    }

    const bySub = await auth.listProviderIdentities({ entity_id: input.almondUserId, provider: 'user-service-sso' });
    for (const pi of bySub) if (pi.auth_identity_id) ids.add(pi.auth_identity_id);

    if (input.emailBeforeAnonymize) {
      const legacy = await auth.listProviderIdentities({ entity_id: input.emailBeforeAnonymize, provider: 'my-auth' });
      for (const pi of legacy) if (pi.auth_identity_id) ids.add(pi.auth_identity_id);
    }

    if (ids.size > 0) {
      await auth.deleteAuthIdentities([...ids]);
    }

    return new StepResponse({ deleted: ids.size });
  },
);
