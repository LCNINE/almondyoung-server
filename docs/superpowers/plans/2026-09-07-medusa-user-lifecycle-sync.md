# Medusa 회원 생애주기 동기화 (#786) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** user-service 의 `UserUpdated(email)`·`UserDeleted` 가 channel-adapter inbox 를 거쳐 Medusa 고객에 반영되게 하고, Kafka 를 기다리던 죽은 Medusa subscriber 두 개를 지우며, 이미 탈퇴한 회원을 재발행으로 백필한다.

**Architecture:** Kafka → channel-adapter `UserEventConsumer`(멱등·inbox) → `InboxWorker` → `CustomerLifecycleMedusaSyncService` → `MedusaClient` → Medusa admin API. 이메일은 코어 `POST /admin/customers/:id`, 탈퇴는 새 커스텀 라우트 `POST /admin/customers/by-almond-user/:almondUserId/withdraw` 가 `withdrawCustomerWorkflow`(주소 하드삭제 → 익명화 → 소프트삭제 → auth identity 삭제)를 돈다. 백필은 user-service 의 내부 엔드포인트가 치환 이메일 마커를 가진 회원의 `UserDeleted` 를 다시 낸다.

**Tech Stack:** NestJS 11 + drizzle-orm (channel-adapter, user-service) · Medusa 2.13.4 workflows-sdk + core-flows (Medusa) · Jest (루트 jest, user-service 전용 config, Medusa unit/http-integration)

**Spec:** `docs/superpowers/specs/2026-09-07-medusa-user-lifecycle-sync-design.md` — 결정 8건과 실측 ①~⑭ 는 거기서 읽는다. 이 플랜은 그 결정을 코드로 옮기는 순서다.

## Global Constraints

- 브랜치 `feat/786-medusa-user-lifecycle-sync` (develop 에서 분기, 스펙 커밋 `be7a85d0f` 이 첫 커밋). 모든 태스크는 이 브랜치에 커밋한다.
- 커밋 메시지는 한국어, 본문 마지막 줄에 `Claude-Session: https://claude.ai/code/session_01CcpjodNjV21HHWVxUTVomr`.
- Medusa 는 Kafka 를 듣지 않는다. `apps/medusa` 에 kafkajs·`users.events.v1` 문자열을 새로 넣지 않는다.
- 어떤 경로도 `SlowRetryInboxError` 를 던지지 않는다 (스펙 결정 5).
- 익명화 규칙은 09-02 `user.deleted.ts` 의 값 그대로: 이메일 `withdrawn_<userId에서 '-' 제거>@deleted.invalid`, `first_name='탈퇴회원'`, `last_name/phone/company_name = null`, `metadata.almond_user_id = null`, `metadata.withdrawn_at = ISO`.
- 백필 선택 조건은 반드시 `deleted_at IS NOT NULL AND email LIKE 'withdrawn\_%@deleted.invalid'`. `deleted_at` 만으로 고르면 휴면 회원이 익명화된다 (스펙 ⑩).
- 검증 게이트: `npm run type-check` 에러 0, `npx jest --maxWorkers=2` 실패 0 (전량은 OOM 이 날 수 있어 워커 2). user-service 는 `npm run test:user-service`. Medusa 유닛은 `cd apps/medusa && npm run test:unit`, 통합은 `scripts/local/run-medusa-integration.sh --testPathPattern '<파일명>'` (postgres + redis 둘 다 떠 있어야 한다: `npm run bootstrap:e2e:local`).
- 새 마이그레이션·시크릿·env 없음. `MEDUSA_API_KEY`·`USER_SERVICE_INTERNAL_KEY` 는 이미 있다.
- `any`/`as` 캐스트는 스펙 파일(`*.spec.ts`)의 mock 주입에만 쓴다 (이 저장소의 기존 스펙 관례). 프로덕션 코드엔 넣지 않는다.

---

## File Structure

| 경로 | 책임 | 태스크 |
|---|---|---|
| `apps/medusa/src/workflows/customers/withdrawn-customer-fields.ts` (신설) | 익명화 update 페이로드를 만드는 순수 함수. 워크플로와 유닛 스펙이 공유 | 1 |
| `apps/medusa/src/workflows/customers/__tests__/withdrawn-customer-fields.unit.spec.ts` (신설) | 위 순수 함수 스펙 | 1 |
| `apps/medusa/src/workflows/customers/steps/delete-auth-identities-step.ts` (신설) | userId·customerId·이메일로 auth identity 를 모아 지우는 커스텀 step | 1 |
| `apps/medusa/src/workflows/customers/withdraw-customer.ts` (신설) | `withdrawCustomerWorkflow` — 조회 → 주소 삭제 → 익명화 → 소프트삭제 → identity 삭제 | 1 |
| `apps/medusa/src/api/admin/customers/by-almond-user/[almondUserId]/withdraw/route.ts` (신설) | 입력 검증 + 워크플로 호출 + 응답 모양 | 2 |
| `apps/medusa/integration-tests/http/customer-withdraw.spec.ts` (신설) | 라우트 통합 스펙 (실 DB) | 2 |
| `apps/medusa/src/subscribers/user.updated.ts` · `user.deleted.ts` (삭제) | — | 3 |
| `apps/medusa/src/subscribers/__tests__/subscriber-events-have-emitters.unit.spec.ts` (수정) | `KNOWN_DEAD` 비움 | 3 |
| `apps/channel-adapter/src/adapters/medusa/medusa.client.ts` (수정) | `updateCustomerEmail`, `withdrawCustomer` | 4 |
| `apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts` (수정) | 위 둘의 스펙 | 4 |
| `apps/channel-adapter/src/adapters/medusa/customer-lifecycle-medusa-sync.service.ts` (신설) | inbox 이벤트 → MedusaClient 호출 + effect 기록 | 5 |
| `apps/channel-adapter/src/adapters/medusa/customer-lifecycle-medusa-sync.service.spec.ts` (신설) | 위 스펙 | 5 |
| `apps/channel-adapter/src/consumers/user-event.consumer.ts` (수정) | `UserUpdated`·`UserDeleted` 핸들러 + 헬퍼 추출 | 6 |
| `apps/channel-adapter/src/consumers/user-event.consumer.spec.ts` (신설) | 소비자 스펙 | 6 |
| `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts` (수정) | 이벤트 타입 2개 + case 2개 + 생성자 주입 | 7 |
| `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts` (수정) | 생성자 인자 추가 + 라우팅 테스트 2개 | 7 |
| `apps/channel-adapter/src/adapter.module.ts` (수정) | provider 등록 | 7 |
| `apps/user-service/src/api/users/dto/replay-withdrawn.request.dto.ts` (신설) | replay 요청 DTO | 8 |
| `apps/user-service/src/api/users/withdrawn-replay.service.ts` (신설) | 마커 조건으로 고르고 `UserDeleted` 재발행 | 8 |
| `apps/user-service/src/api/users/withdrawn-replay.service.spec.ts` (신설) | 위 스펙 | 8 |
| `apps/user-service/src/api/users/users.controller.ts` (수정) | `POST users/internal/replay-withdrawn` | 8 |
| `apps/user-service/src/api/users/users.module.ts` (수정) | provider 등록 | 8 |
| `CONTEXT.md` (수정) | 판매 채널 절에 한 줄 | 9 |

---

### Task 1: Medusa — `withdrawCustomerWorkflow`

**Files:**
- Create: `apps/medusa/src/workflows/customers/withdrawn-customer-fields.ts`
- Create: `apps/medusa/src/workflows/customers/__tests__/withdrawn-customer-fields.unit.spec.ts`
- Create: `apps/medusa/src/workflows/customers/steps/delete-auth-identities-step.ts`
- Create: `apps/medusa/src/workflows/customers/withdraw-customer.ts`

**Interfaces:**
- Consumes: 코어 `updateCustomersWorkflow({ selector, update })`, `deleteCustomersWorkflow({ ids })`, `deleteCustomerAddressesWorkflow({ ids })`, `useQueryGraphStep({ entity, fields, filters })` — 전부 `@medusajs/medusa/core-flows`. `IAuthModuleService.listProviderIdentities({ entity_id, provider })`, `listAuthIdentities({ app_metadata: { customer_id } })`, `deleteAuthIdentities(ids)`.
- Produces:
  - `buildWithdrawnCustomerUpdate(almondUserId: string, existingMetadata: Record<string, unknown> | null): WithdrawnCustomerUpdate` — `{ email, first_name, last_name, phone, company_name, metadata }`
  - `withdrawCustomerWorkflow` — 입력 `{ almondUserId: string }`, 결과 `WithdrawCustomerResult = { customer: 'anonymized' | 'not_found'; auth_identities_deleted: number }`
  - `withdrawnEmailFor(almondUserId: string): string`

- [ ] **Step 1: 순수 함수 스펙을 쓴다 (실패해야 한다)**

`apps/medusa/src/workflows/customers/__tests__/withdrawn-customer-fields.unit.spec.ts`:

```ts
import { buildWithdrawnCustomerUpdate, withdrawnEmailFor } from '../withdrawn-customer-fields';

const USER_ID = '3f9a1c2e-1111-4222-8333-444455556666';

describe('withdrawnEmailFor — user-service anonymizeIdentity 와 같은 규칙', () => {
  it("userId 의 '-' 를 지운 토큰으로 @deleted.invalid 주소를 만든다", () => {
    expect(withdrawnEmailFor(USER_ID)).toBe('withdrawn_3f9a1c2e111142228333444455556666@deleted.invalid');
  });
});

describe('buildWithdrawnCustomerUpdate — 식별정보만 지우고 행은 남긴다', () => {
  it('이름·전화·회사·이메일을 치환하고 almond_user_id 를 null 로, withdrawn_at 을 ISO 로 박는다', () => {
    const before = new Date('2026-09-07T00:00:00.000Z');
    const update = buildWithdrawnCustomerUpdate(USER_ID, { almond_user_id: USER_ID, almond_login_id: 'pauseb' }, before);

    expect(update).toEqual({
      email: 'withdrawn_3f9a1c2e111142228333444455556666@deleted.invalid',
      first_name: '탈퇴회원',
      last_name: null,
      phone: null,
      company_name: null,
      metadata: { almond_user_id: null, almond_login_id: 'pauseb', withdrawn_at: '2026-09-07T00:00:00.000Z' },
    });
  });

  it('metadata 가 null 이어도 almond_user_id: null 과 withdrawn_at 은 들어간다', () => {
    const update = buildWithdrawnCustomerUpdate(USER_ID, null, new Date('2026-09-07T00:00:00.000Z'));
    expect(update.metadata).toEqual({ almond_user_id: null, withdrawn_at: '2026-09-07T00:00:00.000Z' });
  });

  it('두 번 만들어도 같은 이메일이다 (재시도가 새 주소를 만들지 않는다)', () => {
    const a = buildWithdrawnCustomerUpdate(USER_ID, null, new Date());
    const b = buildWithdrawnCustomerUpdate(USER_ID, null, new Date());
    expect(a.email).toBe(b.email);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/medusa && npm run test:unit -- --testPathPattern withdrawn-customer-fields`
Expected: FAIL — `Cannot find module '../withdrawn-customer-fields'`

- [ ] **Step 3: 순수 함수 구현**

`apps/medusa/src/workflows/customers/withdrawn-customer-fields.ts`:

```ts
/**
 * 탈퇴 회원의 Medusa 고객 행에 쓸 익명화 값.
 *
 * user-service `anonymizeIdentity` 와 같은 규칙으로 치환한다. 이메일이 유일 제약을 가지므로, 치환해야
 * 같은 주소로 재가입한 사람이 새 고객을 만들 수 있다. 토큰이 userId 에서 결정적으로 나오므로 재시도가
 * 새 주소를 만들지 않는다.
 *
 * 하드 삭제(`deleteCustomers`)를 쓰지 않는 이유: `order` 는 `customer` 를 FK 로 참조하지 않아 주문 자체는
 * 남지만, 고객 행이 사라지면 주문과 사람의 연결이 끊겨 전자상거래법상 5년 보관해야 하는 계약·결제 기록을
 * 주체 기준으로 찾을 수 없게 된다. 반대로 행을 그대로 두면 이름·이메일이 남아 "탈퇴 시 지체 없이 파기"
 * 약속을 어긴다. 그래서 식별정보만 지우고 행은 남긴다 (2026-09-02 `b2ccb0c58`).
 */
export type WithdrawnCustomerUpdate = {
  email: string;
  first_name: string;
  last_name: null;
  phone: null;
  company_name: null;
  metadata: Record<string, unknown>;
};

export function withdrawnEmailFor(almondUserId: string): string {
  const token = almondUserId.replace(/-/g, '');
  return `withdrawn_${token}@deleted.invalid`;
}

export function buildWithdrawnCustomerUpdate(
  almondUserId: string,
  existingMetadata: Record<string, unknown> | null,
  now: Date = new Date(),
): WithdrawnCustomerUpdate {
  return {
    email: withdrawnEmailFor(almondUserId),
    first_name: '탈퇴회원',
    last_name: null,
    phone: null,
    company_name: null,
    metadata: { ...(existingMetadata ?? {}), almond_user_id: null, withdrawn_at: now.toISOString() },
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd apps/medusa && npm run test:unit -- --testPathPattern withdrawn-customer-fields`
Expected: PASS (3 tests)

- [ ] **Step 5: auth identity 삭제 step 을 쓴다**

`apps/medusa/src/workflows/customers/steps/delete-auth-identities-step.ts`:

```ts
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
    for (const pi of bySub) ids.add(pi.auth_identity_id);

    if (input.emailBeforeAnonymize) {
      const legacy = await auth.listProviderIdentities({ entity_id: input.emailBeforeAnonymize, provider: 'my-auth' });
      for (const pi of legacy) ids.add(pi.auth_identity_id);
    }

    if (ids.size > 0) {
      await auth.deleteAuthIdentities([...ids]);
    }

    return new StepResponse({ deleted: ids.size });
  },
);
```

- [ ] **Step 6: 워크플로를 쓴다**

`apps/medusa/src/workflows/customers/withdraw-customer.ts`:

```ts
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
        buildWithdrawnCustomerUpdate(input.almondUserId, (customer?.metadata as Record<string, unknown>) ?? null),
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
```

- [ ] **Step 7: 컴파일 확인**

Run: `cd apps/medusa && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "workflows/customers" ; echo "exit=$?"`
Expected: 출력 없음, `exit=1` (grep 이 못 찾음 = 이 디렉터리에 에러 없음). Medusa `tsc` 는 선재 에러 3건이 있어 전체 0 은 기준이 아니다(스펙 ⑦ 의 근거 문서). 우리 파일에 에러가 있으면 여기 나온다.

만약 `useQueryGraphStep` 의 `filters` 타입이 `metadata` 중첩 객체를 거부하면(`filters` 는 `RemoteQueryInput` 의 것이라 넓다 — 거부하지 않을 것이다), `useRemoteQueryStep({ entry_point: 'customer', fields, variables: { filters: { metadata: { almond_user_id } } } })` 로 바꾼다. 코어 `removeCustomerAccountWorkflow` 가 `auth_identity` 에 같은 모양을 쓴다.

- [ ] **Step 8: 커밋**

```bash
git add apps/medusa/src/workflows/customers
git commit -F - <<'EOF'
feat(medusa): withdrawCustomerWorkflow — 탈퇴 회원의 고객 행 익명화·주소·auth identity 파기 (#786)

키는 customer id 가 아니라 userId 다. 익명화가 almond_user_id 를 지우므로 customer id 로는
재시도가 「없음」이 된다. 주소는 하드 삭제한다 — 소프트 삭제는 파기가 아니고 주문은 자체
스냅샷을 갖는다. auth identity 에는 이메일·이름·IdP 토큰이 있어 함께 지운다.

Claude-Session: https://claude.ai/code/session_01CcpjodNjV21HHWVxUTVomr
EOF
```

---

### Task 2: Medusa — withdraw 라우트 + 통합 스펙

**Files:**
- Create: `apps/medusa/src/api/admin/customers/by-almond-user/[almondUserId]/withdraw/route.ts`
- Create: `apps/medusa/integration-tests/http/customer-withdraw.spec.ts`

**Interfaces:**
- Consumes: `withdrawCustomerWorkflow` (Task 1), `withdrawnEmailFor` (Task 1)
- Produces: `POST /admin/customers/by-almond-user/:almondUserId/withdraw` → `200 { customer: 'anonymized' | 'not_found', auth_identities_deleted: number }`. channel-adapter(Task 4)가 이 모양을 그대로 받는다.

- [ ] **Step 1: 통합 스펙을 쓴다 (실패해야 한다)**

`apps/medusa/integration-tests/http/customer-withdraw.spec.ts`:

```ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import jwt from 'jsonwebtoken';
import { withdrawnEmailFor } from '../../src/workflows/customers/withdrawn-customer-fields';

jest.setTimeout(180 * 1000);

/**
 * `POST /admin/customers/by-almond-user/:almondUserId/withdraw` (#786, 스펙 §6).
 *
 * 주소·`user-service-sso` provider identity·`app_metadata.customer_id` 링크를 가진 고객을 만들고 라우트를 두 번
 * 부른다. 첫 호출 뒤 필드 치환·소프트 삭제·주소 0행·identity 0행, 둘째 호출은 `not_found`/0 — 재시도와 백필
 * 재실행이 안전하다는 증명이다. 마지막 케이스는 같은 이메일로 새 고객이 생기는지 본다(유일 제약이 풀렸는가).
 */
medusaIntegrationTestRunner({
  inApp: true,
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let adminHeaders: { headers: Record<string, string> };
    let seq = 0;

    beforeEach(async () => {
      seq++;
      const container = getContainer();
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
      const secret = config.projectConfig.http.jwtSecret;
      const userModule = container.resolve(Modules.USER);
      const [user] = await userModule.createUsers([{ email: `admin${seq}@withdraw.test` }]);
      adminHeaders = {
        headers: {
          authorization: `Bearer ${jwt.sign(
            { actor_id: user.id, actor_type: 'user', auth_identity_id: 'a', app_metadata: { user_id: user.id } },
            secret,
          )}`,
        },
      };
    });

    /** SSO 첫 로그인 뒤의 모양을 재현한다: has_account 고객 + almond_user_id + 주소 + sso identity(customer_id 링크) */
    const seedWithdrawableCustomer = async () => {
      const container = getContainer();
      const userId = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
      const email = `member${seq}@withdraw.test`;
      const customerModule = container.resolve(Modules.CUSTOMER);
      const authModule = container.resolve(Modules.AUTH);

      const [customer] = await customerModule.createCustomers([
        {
          email,
          first_name: '홍',
          last_name: '길동',
          phone: '01012345678',
          has_account: true,
          metadata: { almond_user_id: userId, almond_login_id: `login${seq}` },
        },
      ]);
      await customerModule.createCustomerAddresses([
        { customer_id: customer.id, address_1: '서울시 어딘가 1', city: '서울', country_code: 'kr', postal_code: '04524' },
        { customer_id: customer.id, address_1: '서울시 어딘가 2', city: '서울', country_code: 'kr', postal_code: '04525' },
      ]);
      const [identity] = await authModule.createAuthIdentities([
        {
          app_metadata: { actor_type: 'customer', customer_id: customer.id },
          provider_identities: [
            {
              provider: 'user-service-sso',
              entity_id: userId,
              user_metadata: { email, name: '홍길동' },
              provider_metadata: { access_token: 'secret-at', refresh_token: 'secret-rt' },
            },
          ],
        },
      ]);
      return { userId, email, customer, identity };
    };

    const withdraw = (userId: string) =>
      api.post(`/admin/customers/by-almond-user/${userId}/withdraw`, {}, adminHeaders);

    it('식별정보를 치환하고 소프트 삭제하며 주소와 auth identity 를 지운다', async () => {
      const { userId, email, customer, identity } = await seedWithdrawableCustomer();
      const container = getContainer();
      const customerModule = container.resolve(Modules.CUSTOMER);
      const authModule = container.resolve(Modules.AUTH);

      const res = await withdraw(userId);

      expect(res.status).toBe(200);
      expect(res.data).toEqual({ customer: 'anonymized', auth_identities_deleted: 1 });

      const [after] = await customerModule.listCustomers({ id: customer.id }, { withDeleted: true } as any);
      expect(after.email).toBe(withdrawnEmailFor(userId));
      expect(after.first_name).toBe('탈퇴회원');
      expect(after.last_name).toBeNull();
      expect(after.phone).toBeNull();
      expect(after.deleted_at).not.toBeNull();
      expect(after.metadata).toEqual(
        expect.objectContaining({ almond_user_id: null, almond_login_id: `login${seq}`, withdrawn_at: expect.any(String) }),
      );
      expect(after.email).not.toBe(email);

      const addresses = await customerModule.listCustomerAddresses({ customer_id: customer.id });
      expect(addresses).toHaveLength(0);

      const identities = await authModule.listAuthIdentities({ id: [identity.id] });
      expect(identities).toHaveLength(0);
      const providerIdentities = await authModule.listProviderIdentities({ entity_id: userId, provider: 'user-service-sso' });
      expect(providerIdentities).toHaveLength(0);
    });

    it('두 번째 호출은 not_found / 0 으로 200 — 재시도·백필 재실행이 안전하다', async () => {
      const { userId } = await seedWithdrawableCustomer();
      await withdraw(userId);

      const res = await withdraw(userId);

      expect(res.status).toBe(200);
      expect(res.data).toEqual({ customer: 'not_found', auth_identities_deleted: 0 });
    });

    it('한 번도 로그인 안 한 회원(고객 없음)은 not_found / 0 으로 200 — 실패가 아니다', async () => {
      const res = await withdraw('00000000-0000-4000-8000-ffffffffffff');
      expect(res.status).toBe(200);
      expect(res.data).toEqual({ customer: 'not_found', auth_identities_deleted: 0 });
    });

    it('고객은 없지만 sso identity 만 남은 상태(부분 실패 뒤 재시도)도 identity 를 지운다', async () => {
      const container = getContainer();
      const authModule = container.resolve(Modules.AUTH);
      const userId = `00000000-0000-4000-8000-a${String(seq).padStart(11, '0')}`;
      await authModule.createAuthIdentities([
        { provider_identities: [{ provider: 'user-service-sso', entity_id: userId, user_metadata: { email: 'x@y.z' } }] },
      ]);

      const res = await withdraw(userId);

      expect(res.data).toEqual({ customer: 'not_found', auth_identities_deleted: 1 });
      expect(await authModule.listProviderIdentities({ entity_id: userId, provider: 'user-service-sso' })).toHaveLength(0);
    });

    it('익명화 뒤 같은 이메일로 새 has_account 고객을 만들 수 있다 (유일 제약이 풀린다)', async () => {
      const { userId, email } = await seedWithdrawableCustomer();
      await withdraw(userId);
      const customerModule = getContainer().resolve(Modules.CUSTOMER);

      const [again] = await customerModule.createCustomers([{ email, has_account: true }]);

      expect(again.email).toBe(email);
    });

    it('almondUserId 가 UUID 꼴이 아니면 400', async () => {
      const res = await withdraw('not-a-uuid').catch((e) => e.response);
      expect(res.status).toBe(400);
    });
  },
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run bootstrap:e2e:local` (postgres·redis 가 이미 건강하면 재기동하지 않는다) 후
`scripts/local/run-medusa-integration.sh --testPathPattern 'customer-withdraw'`
Expected: FAIL — 라우트 없음(404) 으로 첫 케이스부터 실패.

- [ ] **Step 3: 라우트 구현**

`apps/medusa/src/api/admin/customers/by-almond-user/[almondUserId]/withdraw/route.ts`:

```ts
import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { MedusaError } from '@medusajs/framework/utils';
import { withdrawCustomerWorkflow } from '../../../../../../workflows/customers/withdraw-customer';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST /admin/customers/by-almond-user/:almondUserId/withdraw
 *
 * 탈퇴 회원의 Medusa 흔적 파기. channel-adapter 가 `UserDeleted` inbox 에서 부른다 (#786).
 * 코어 `/admin/customers/:id` 와 충돌하지 않도록 이미 공존 중인 `by-almond-user` 아래에 둔다.
 * 키가 userId 인 이유와 파기 범위는 `workflows/customers/withdraw-customer.ts` 머리 참고.
 *
 * 멱등: 같은 userId 로 몇 번을 불러도 두 번째부터는 `not_found`/0 이다. 고객 없음은 4xx 가 아니라 200 이다 —
 * 한 번도 로그인 안 한 회원이 정상 케이스이고, 4xx 를 내면 channel-adapter inbox 가 영구 실패로 남긴다.
 *
 * 여기엔 입력 검증·응답 모양만 남고 판정·쓰기는 워크플로가 한다 (ADR-0034 결정 3).
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { almondUserId } = req.params;
  if (!UUID_V4.test(almondUserId)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `almondUserId must be a UUID: ${almondUserId}`);
  }

  const { result } = await withdrawCustomerWorkflow(req.scope).run({ input: { almondUserId } });

  res.status(200).json(result);
};
```

- [ ] **Step 4: 통과 확인**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'customer-withdraw'`
Expected: PASS (6 tests)

첫 케이스의 `auth_identities_deleted: 1` 이 `2` 로 나오면 (a) `app_metadata.customer_id` 와 (b) `entity_id` 가 **같은** identity 를 가리키는데 `Set` 이 dedupe 를 못 한 것이다 — step 에서 `identity.id` 와 `pi.auth_identity_id` 가 같은 문자열인지 확인한다. `listCustomers(..., { withDeleted: true })` 가 타입 에러면 `retrieveCustomer(id, { withDeleted: true })` 로 바꾼다.

- [ ] **Step 5: 커밋**

```bash
git add "apps/medusa/src/api/admin/customers/by-almond-user/[almondUserId]/withdraw" apps/medusa/integration-tests/http/customer-withdraw.spec.ts
git commit -F - <<'EOF'
feat(medusa): POST /admin/customers/by-almond-user/:id/withdraw — channel-adapter 가 부르는 탈퇴 입구 (#786)

고객 없음은 200 not_found 다. 한 번도 로그인 안 한 회원이 정상 케이스이고, 4xx 면 inbox 가
영구 실패로 남긴다. 통합 스펙이 두 번 호출·부분 실패 재시도·재가입 유일 제약을 본다.

Claude-Session: https://claude.ai/code/session_01CcpjodNjV21HHWVxUTVomr
EOF
```

---

### Task 3: Medusa — 죽은 subscriber 삭제 + 가드 B 예외 비우기

**Files:**
- Delete: `apps/medusa/src/subscribers/user.updated.ts`
- Delete: `apps/medusa/src/subscribers/user.deleted.ts`
- Modify: `apps/medusa/src/subscribers/__tests__/subscriber-events-have-emitters.unit.spec.ts:16-19`

**Interfaces:**
- Consumes: 없음
- Produces: `KNOWN_DEAD = {}`. 이후 새 예외는 이슈 번호와 함께만 추가된다.

- [ ] **Step 1: 지금은 가드가 예외로 초록임을 확인한다**

Run: `cd apps/medusa && npm run test:unit -- --testPathPattern subscriber-events-have-emitters`
Expected: PASS (`users.events.v1` 이 `KNOWN_DEAD` 에 있어서)

- [ ] **Step 2: 예외를 먼저 비운다 (실패해야 한다)**

`subscriber-events-have-emitters.unit.spec.ts` 의 아래 블록을

```ts
const KNOWN_DEAD: Record<string, string> = {
  // Medusa 는 Kafka 를 소비하지 않는다 — user.updated.ts · user.deleted.ts 가 기다리는 이 이름을 내는 곳이 없다.
  'users.events.v1': '#786',
};
```

이렇게 바꾼다:

```ts
// 2026-09-07 #786 으로 마지막 항목(`users.events.v1`)이 빠졌다. 회원 이벤트는 이제 channel-adapter inbox 를
// 거쳐 Medusa admin 라우트로 들어온다 — Medusa 안에 Kafka 를 기다리는 subscriber 는 없다.
const KNOWN_DEAD: Record<string, string> = {};
```

Run: `cd apps/medusa && npm run test:unit -- --testPathPattern subscriber-events-have-emitters`
Expected: FAIL — `user.deleted.ts`·`user.updated.ts` 두 케이스가 `expect(dead).toEqual([])` 에서 `['users.events.v1']` 로 빨갛다.

- [ ] **Step 3: subscriber 두 파일 삭제**

```bash
git rm apps/medusa/src/subscribers/user.updated.ts apps/medusa/src/subscribers/user.deleted.ts
```

- [ ] **Step 4: 통과 확인 + 남은 참조 0 확인**

Run: `cd apps/medusa && npm run test:unit -- --testPathPattern subscriber-events-have-emitters`
Expected: PASS. 남은 subscriber 6개 전부 코어 이벤트.

Run: `grep -rn "users.events.v1\|user-updated-email-sync-handler\|user-deleted-handler" apps/medusa/src ; echo "exit=$?"`
Expected: 출력 없음, `exit=1`.

- [ ] **Step 5: 커밋**

```bash
git add apps/medusa/src/subscribers
git commit -F - <<'EOF'
chore(medusa): Kafka 를 기다리던 user.updated·user.deleted subscriber 삭제, 가드 B 예외 0 (#786)

두 파일은 두 번 걷어낸 Kafka 재도입의 고아였다 (53af9459b, 1970e519e). 대체 경로는
withdrawCustomerWorkflow + channel-adapter inbox 다.

Claude-Session: https://claude.ai/code/session_01CcpjodNjV21HHWVxUTVomr
EOF
```

---

### Task 4: channel-adapter — `MedusaClient.updateCustomerEmail` · `withdrawCustomer`

**Files:**
- Modify: `apps/channel-adapter/src/adapters/medusa/medusa.client.ts` (`clearCustomerMetadataKey` 바로 뒤, 2387행 근처)
- Modify: `apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts` (파일 끝에 describe 추가)

**Interfaces:**
- Consumes: Task 2 의 라우트 응답 모양
- Produces:
  - `export type WithdrawCustomerOutcome = { customer: 'anonymized' | 'not_found'; auth_identities_deleted: number }`
  - `updateCustomerEmail(customerId: string, email: string): Promise<void>` — 실패 throw
  - `withdrawCustomer(almondUserId: string): Promise<WithdrawCustomerOutcome>` — 4xx(429 제외) 영구 실패 error 로그 + throw, 그 외 warn + throw

- [ ] **Step 1: 스펙을 쓴다 (실패해야 한다)**

`medusa.client.spec.ts` 파일 끝에 추가:

```ts
describe('MedusaClient 회원 생애주기 (#786)', () => {
  function makeCustomerClient() {
    const fetch = jest.fn();
    const update = jest.fn().mockResolvedValue({ customer: {} });
    const client = Object.create(MedusaClient.prototype) as MedusaClient;
    Object.defineProperties(client, {
      sdk: { value: { client: { fetch }, admin: { customer: { update } } } },
      logger: { value: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } },
    });
    return { client, fetch, update, logger: (client as any).logger as Record<string, jest.Mock> };
  }

  describe('updateCustomerEmail', () => {
    it('코어 admin update 로 email 만 보낸다', async () => {
      const { client, update } = makeCustomerClient();
      await client.updateCustomerEmail('cus_1', 'new@example.com');
      expect(update).toHaveBeenCalledWith('cus_1', { email: 'new@example.com' });
    });

    it('실패는 삼키지 않고 던진다 — inbox 가 재시도/failed 를 판단한다', async () => {
      const { client, update } = makeCustomerClient();
      update.mockRejectedValueOnce(Object.assign(new Error('dup'), { status: 422 }));
      await expect(client.updateCustomerEmail('cus_1', 'taken@example.com')).rejects.toThrow('dup');
    });
  });

  describe('withdrawCustomer', () => {
    it('커스텀 라우트를 POST 하고 outcome 을 그대로 돌려준다', async () => {
      const { client, fetch } = makeCustomerClient();
      fetch.mockResolvedValueOnce({ customer: 'anonymized', auth_identities_deleted: 1 });

      const outcome = await client.withdrawCustomer('3f9a1c2e-1111-4222-8333-444455556666');

      expect(fetch).toHaveBeenCalledWith(
        '/admin/customers/by-almond-user/3f9a1c2e-1111-4222-8333-444455556666/withdraw',
        { method: 'POST' },
      );
      expect(outcome).toEqual({ customer: 'anonymized', auth_identities_deleted: 1 });
    });

    it('4xx 는 영구 실패 — error 로그 후 던진다 (조용히 성공 처리하지 않는다)', async () => {
      const { client, fetch, logger } = makeCustomerClient();
      fetch.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 }));

      await expect(client.withdrawCustomer('3f9a1c2e-1111-4222-8333-444455556666')).rejects.toThrow(
        'Medusa withdrawCustomer failed (status=404)',
      );
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('5xx 는 일시 실패 — warn 로그 후 던진다', async () => {
      const { client, fetch, logger } = makeCustomerClient();
      fetch.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 503 }));

      await expect(client.withdrawCustomer('3f9a1c2e-1111-4222-8333-444455556666')).rejects.toThrow(
        'Medusa withdrawCustomer failed (status=503)',
      );
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.error).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts -t "회원 생애주기"`
Expected: FAIL — `client.updateCustomerEmail is not a function`

- [ ] **Step 3: 구현**

`medusa.client.ts` 의 `clearCustomerMetadataKey` 메서드 바로 뒤에 추가. 파일 상단 `type CoreShippingProjectionStatus` 줄 옆에 타입 export 도 추가:

```ts
/** `POST /admin/customers/by-almond-user/:id/withdraw` 의 응답. 값이 늘면 양쪽(Medusa 라우트·sync 서비스) 계약 변경이다. */
export type WithdrawCustomerOutcome = {
  customer: 'anonymized' | 'not_found';
  auth_identities_deleted: number;
};
```

메서드:

```ts
  /**
   * user-service 이메일 변경(cafe24 이관 등)을 Medusa customer email 에 따라 붙인다 (#786).
   *
   * 실패는 던진다. 다른 has_account 고객이 같은 이메일을 쓰면 Medusa 가 4xx 를 내고 inbox 가 `failed` 로
   * 남긴다 — membership sync 의 email fallback 이 조용히 다른 고객에 almond_user_id 를 써 넣는 것보다
   * 사람 앞에 드러나는 편이 낫다.
   */
  async updateCustomerEmail(customerId: string, email: string): Promise<void> {
    try {
      await this.sdk.admin.customer.update(customerId, { email });
      this.logger.log(`Updated email for customer ${customerId}`);
    } catch (error) {
      const fetchError = error as FetchError;
      this.logger.warn(`Failed to update email for customer ${customerId}: ${fetchError.message} (status=${fetchError.status})`);
      throw error;
    }
  }

  /**
   * 탈퇴 회원의 Medusa 흔적 파기 (#786). 고객 없음도 200 `not_found` 로 돌아온다 — 실패가 아니다.
   *
   * 실패는 절대 조용히 성공 처리하지 않는다 — throw 해서 inbox 가 failed 로 남기고 사람이 본다.
   * 4xx(429 제외)는 코드/설정 문제 신호라 ERROR, 나머지(5xx·429·네트워크)는 일시적이라 WARN.
   * `issuePromotionsByTrigger` 와 같은 규칙.
   */
  async withdrawCustomer(almondUserId: string): Promise<WithdrawCustomerOutcome> {
    try {
      const outcome = await this.sdk.client.fetch<WithdrawCustomerOutcome>(
        `/admin/customers/by-almond-user/${encodeURIComponent(almondUserId)}/withdraw`,
        { method: 'POST' },
      );
      this.logger.log(
        `withdrawCustomer: userId=${almondUserId} customer=${outcome.customer} auth_identities_deleted=${outcome.auth_identities_deleted}`,
      );
      return outcome;
    } catch (error) {
      const fetchError = error as FetchError;
      const status = fetchError.status;
      const isPermanent = typeof status === 'number' && status >= 400 && status < 500 && status !== 429;
      if (isPermanent) {
        this.logger.error(`withdrawCustomer permanent failure (userId=${almondUserId}, status=${status}): ${fetchError.message}`);
      } else {
        this.logger.warn(`withdrawCustomer transient failure (userId=${almondUserId}, status=${status ?? 'n/a'}): ${fetchError.message}`);
      }
      throw new Error(`Medusa withdrawCustomer failed (status=${status ?? 'n/a'}): ${fetchError.message}`);
    }
  }
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts`
Expected: PASS (기존 + 새 5개)

- [ ] **Step 5: 커밋**

```bash
git add apps/channel-adapter/src/adapters/medusa/medusa.client.ts apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts
git commit -F - <<'EOF'
feat(channel-adapter): MedusaClient.updateCustomerEmail · withdrawCustomer (#786)

withdrawCustomer 의 4xx 는 영구 실패로 던진다. 조용히 {0} 으로 삼키면 inbox 가 published 로
마킹돼 파기 누락이 영구 유실된다 — issuePromotionsByTrigger 와 같은 규칙.

Claude-Session: https://claude.ai/code/session_01CcpjodNjV21HHWVxUTVomr
EOF
```

---

### Task 5: channel-adapter — `CustomerLifecycleMedusaSyncService`

**Files:**
- Create: `apps/channel-adapter/src/adapters/medusa/customer-lifecycle-medusa-sync.service.ts`
- Create: `apps/channel-adapter/src/adapters/medusa/customer-lifecycle-medusa-sync.service.spec.ts`

**Interfaces:**
- Consumes: `MedusaClient.findCustomerByAlmondUserId(userId): Promise<{ id, email, ... } | null>`, `MedusaClient.updateCustomerEmail`, `MedusaClient.withdrawCustomer` (Task 4), `EventTrackingService.trackEffect({ resourceType, resourceId, action, description, eventType })`, `SyncResult` from `../../types`
- Produces:
  - `handleUserUpdated(payload: { userId: string; email: string }): Promise<SyncResult>` — `data.action: 'synced' | 'skipped'`
  - `handleUserDeleted(payload: { userId: string }): Promise<SyncResult>` — `data.action: 'synced' | 'skipped'`

- [ ] **Step 1: 스펙을 쓴다 (실패해야 한다)**

`customer-lifecycle-medusa-sync.service.spec.ts`:

```ts
import { CustomerLifecycleMedusaSyncService } from './customer-lifecycle-medusa-sync.service';
import { SlowRetryInboxError } from './slow-retry.error';

describe('CustomerLifecycleMedusaSyncService (#786)', () => {
  const USER_ID = '3f9a1c2e-1111-4222-8333-444455556666';

  function createService(params?: {
    customer?: { id: string; email: string } | null;
    withdrawOutcome?: { customer: 'anonymized' | 'not_found'; auth_identities_deleted: number };
    withdrawError?: Error;
    updateError?: Error;
  }) {
    const medusaClient = {
      findCustomerByAlmondUserId: jest.fn().mockResolvedValue(params?.customer ?? null),
      updateCustomerEmail: params?.updateError
        ? jest.fn().mockRejectedValue(params.updateError)
        : jest.fn().mockResolvedValue(undefined),
      withdrawCustomer: params?.withdrawError
        ? jest.fn().mockRejectedValue(params.withdrawError)
        : jest.fn().mockResolvedValue(params?.withdrawOutcome ?? { customer: 'anonymized', auth_identities_deleted: 1 }),
    };
    const eventTracking = { trackEffect: jest.fn().mockResolvedValue(undefined) };
    const service = new CustomerLifecycleMedusaSyncService(medusaClient as any, eventTracking as any);
    return { service, medusaClient, eventTracking };
  }

  describe('handleUserUpdated', () => {
    it('고객이 있고 이메일이 다르면 갱신하고 SYNCED effect 를 남긴다', async () => {
      const { service, medusaClient, eventTracking } = createService({ customer: { id: 'cus_1', email: 'old@example.com' } });

      const result = await service.handleUserUpdated({ userId: USER_ID, email: 'new@example.com' });

      expect(medusaClient.updateCustomerEmail).toHaveBeenCalledWith('cus_1', 'new@example.com');
      expect(result).toEqual({ success: true, data: { userId: USER_ID, action: 'synced' } });
      expect(eventTracking.trackEffect).toHaveBeenCalledWith(
        expect.objectContaining({ resourceType: 'MedusaCustomer', resourceId: 'cus_1', action: 'SYNCED', eventType: 'UserUpdated' }),
      );
    });

    it('이메일이 이미 같으면 아무것도 부르지 않고 skipped', async () => {
      const { service, medusaClient } = createService({ customer: { id: 'cus_1', email: 'same@example.com' } });

      const result = await service.handleUserUpdated({ userId: USER_ID, email: 'same@example.com' });

      expect(medusaClient.updateCustomerEmail).not.toHaveBeenCalled();
      expect(result.data.action).toBe('skipped');
    });

    it('고객이 없으면 SKIPPED effect 후 skipped — 첫 로그인 때 현재 이메일로 생성되므로 기다리지 않는다', async () => {
      const { service, eventTracking } = createService({ customer: null });

      const result = await service.handleUserUpdated({ userId: USER_ID, email: 'new@example.com' });

      expect(result.data.action).toBe('skipped');
      expect(eventTracking.trackEffect).toHaveBeenCalledWith(
        expect.objectContaining({ resourceType: 'UserAccount', resourceId: USER_ID, action: 'SKIPPED' }),
      );
    });

    it('갱신 실패는 그대로 전파한다 — inbox 가 재시도/failed 를 판단한다', async () => {
      const { service } = createService({ customer: { id: 'cus_1', email: 'old@example.com' }, updateError: new Error('dup') });

      await expect(service.handleUserUpdated({ userId: USER_ID, email: 'taken@example.com' })).rejects.toThrow('dup');
    });
  });

  describe('handleUserDeleted', () => {
    it('anonymized 면 SYNCED effect 와 synced', async () => {
      const { service, medusaClient, eventTracking } = createService({
        withdrawOutcome: { customer: 'anonymized', auth_identities_deleted: 2 },
      });

      const result = await service.handleUserDeleted({ userId: USER_ID });

      expect(medusaClient.withdrawCustomer).toHaveBeenCalledWith(USER_ID);
      expect(result).toEqual({ success: true, data: { userId: USER_ID, action: 'synced' } });
      expect(eventTracking.trackEffect).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: 'UserAccount',
          resourceId: USER_ID,
          action: 'SYNCED',
          eventType: 'UserDeleted',
          description: expect.stringContaining('auth_identities_deleted=2'),
        }),
      );
    });

    it('not_found 면 SKIPPED effect 와 skipped — 한 번도 로그인 안 한 회원, 재시도 없음', async () => {
      const { service, eventTracking } = createService({
        withdrawOutcome: { customer: 'not_found', auth_identities_deleted: 0 },
      });

      const result = await service.handleUserDeleted({ userId: USER_ID });

      expect(result.data.action).toBe('skipped');
      expect(eventTracking.trackEffect).toHaveBeenCalledWith(expect.objectContaining({ action: 'SKIPPED' }));
    });

    it('Medusa 실패는 그대로 전파하되 절대 SlowRetryInboxError 로 바꾸지 않는다', async () => {
      const { service } = createService({ withdrawError: new Error('Medusa withdrawCustomer failed (status=503)') });

      const promise = service.handleUserDeleted({ userId: USER_ID });

      await expect(promise).rejects.toThrow('status=503');
      await expect(promise).rejects.not.toBeInstanceOf(SlowRetryInboxError);
    });
  });

  it('effect 기록 실패는 결과를 바꾸지 않는다', async () => {
    const { service, eventTracking } = createService({ customer: { id: 'cus_1', email: 'old@example.com' } });
    eventTracking.trackEffect.mockRejectedValueOnce(new Error('tracking down'));

    const result = await service.handleUserUpdated({ userId: USER_ID, email: 'new@example.com' });

    expect(result.data.action).toBe('synced');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/channel-adapter/src/adapters/medusa/customer-lifecycle-medusa-sync.service.spec.ts`
Expected: FAIL — `Cannot find module './customer-lifecycle-medusa-sync.service'`

- [ ] **Step 3: 구현**

`customer-lifecycle-medusa-sync.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { EventTrackingService } from '@app/events';
import type { UserDeletedPayload, UserUpdatedPayload } from '@packages/event-contracts/streams/user.stream';
import { MedusaClient } from './medusa.client';
import type { SyncResult } from '../../types';

/** `UserUpdated` 는 email 이 optional 이다. 소비자가 email 있는 것만 inbox 에 넣으므로 여기선 필수다. */
export type UserEmailChangedPayload = Pick<UserUpdatedPayload, 'userId'> & { email: string };

/**
 * user-service 회원 생애주기(이메일 변경·탈퇴)를 Medusa 고객에 반영한다 (#786, 스펙 §4.2).
 *
 * `MembershipMedusaSyncService` 와 같은 자리다 — inbox 워커가 부르고, Medusa 호출 실패는 던져서 inbox 가
 * 재시도·failed 를 판단하게 한다. **어느 경로도 `SlowRetryInboxError` 를 던지지 않는다.** 그 에러는 「선행
 * 조건이 나중에 충족된다」는 뜻인데, 탈퇴자는 앞으로 로그인하지 않고 이메일 변경자는 첫 로그인 때 현재
 * 이메일로 생성된다. 기다릴 것이 없다.
 */
@Injectable()
export class CustomerLifecycleMedusaSyncService {
  private readonly logger = new Logger(CustomerLifecycleMedusaSyncService.name);

  constructor(
    private readonly medusaClient: MedusaClient,
    private readonly eventTrackingService: EventTrackingService,
  ) {}

  async handleUserUpdated(payload: UserEmailChangedPayload): Promise<SyncResult> {
    const { userId, email } = payload;
    const customer = await this.medusaClient.findCustomerByAlmondUserId(userId);

    if (!customer) {
      this.logger.log(`UserUpdated(email): Medusa 고객 없음 — 첫 로그인 때 현재 이메일로 생성된다 (userId=${userId})`);
      await this.track({
        resourceType: 'UserAccount',
        resourceId: userId,
        action: 'SKIPPED',
        description: 'Medusa 고객 없음 — 첫 로그인 때 현재 이메일로 생성',
        eventType: 'UserUpdated',
      });
      return { success: true, data: { userId, action: 'skipped' } };
    }

    if (customer.email === email) {
      return { success: true, data: { userId, action: 'skipped' } };
    }

    await this.medusaClient.updateCustomerEmail(customer.id, email);
    this.logger.log(`Customer email synced: customerId=${customer.id}, userId=${userId}`);
    await this.track({
      resourceType: 'MedusaCustomer',
      resourceId: customer.id,
      action: 'SYNCED',
      description: `이메일 동기화 (userId=${userId})`,
      eventType: 'UserUpdated',
    });
    return { success: true, data: { userId, action: 'synced' } };
  }

  async handleUserDeleted(payload: UserDeletedPayload): Promise<SyncResult> {
    const { userId } = payload;
    const outcome = await this.medusaClient.withdrawCustomer(userId);
    const anonymized = outcome.customer === 'anonymized';

    await this.track({
      resourceType: 'UserAccount',
      resourceId: userId,
      action: anonymized ? 'SYNCED' : 'SKIPPED',
      description: `탈퇴 파기 customer=${outcome.customer} auth_identities_deleted=${outcome.auth_identities_deleted}`,
      eventType: 'UserDeleted',
    });
    return { success: true, data: { userId, action: anonymized ? 'synced' : 'skipped' } };
  }

  /** effect 기록은 관측이지 결과가 아니다 — 실패해도 동기화 결과를 바꾸지 않는다 (형제 서비스와 같은 규칙). */
  private async track(params: Parameters<EventTrackingService['trackEffect']>[0]): Promise<void> {
    await this.eventTrackingService.trackEffect(params).catch((e) => this.logger.warn(`trackEffect 실패: ${e?.message}`));
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/channel-adapter/src/adapters/medusa/customer-lifecycle-medusa-sync.service.spec.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/channel-adapter/src/adapters/medusa/customer-lifecycle-medusa-sync.service.ts apps/channel-adapter/src/adapters/medusa/customer-lifecycle-medusa-sync.service.spec.ts
git commit -F - <<'EOF'
feat(channel-adapter): CustomerLifecycleMedusaSyncService — 이메일 변경·탈퇴를 Medusa 에 반영 (#786)

고객 없음은 종결 no-op 이다. 탈퇴자는 로그인하지 않고 이메일 변경자는 첫 로그인 때 현재
이메일로 생성되므로 SlowRetryInboxError 로 하루 기다릴 이유가 없다.

Claude-Session: https://claude.ai/code/session_01CcpjodNjV21HHWVxUTVomr
EOF
```

---

### Task 6: channel-adapter — `UserEventConsumer` 핸들러 2개 + 헬퍼 추출

**Files:**
- Modify: `apps/channel-adapter/src/consumers/user-event.consumer.ts` (전체 재작성 — 아래 코드가 파일 전문)
- Create: `apps/channel-adapter/src/consumers/user-event.consumer.spec.ts`

**Interfaces:**
- Consumes: `USER_STREAM` 의 `UserUpdated`·`UserDeleted` 이벤트(계약 변경 없음), `processedEvents`·`inboxEvents`·`cafe24MemberMappings` 스키마
- Produces: inbox 행 — `eventType='UserUpdated'`/`'UserDeleted'`, `aggregateType='MedusaCustomer'`, `aggregateId=partitionKey=userId`, payload `{ userId, email }` / `{ userId }`. Task 7 의 워커가 이 `eventType` 으로 dispatch 한다.

- [ ] **Step 1: 스펙을 쓴다 (실패해야 한다)**

`user-event.consumer.spec.ts`:

```ts
import { UserEventConsumer } from './user-event.consumer';
import { cafe24MemberMappings, inboxEvents, processedEvents } from '../schema';

function createDbMock(existingProcessedEvents: unknown[] = []) {
  const inserts: Array<{ table: unknown; values: any }> = [];
  const deletes: unknown[] = [];
  const limit = jest.fn().mockResolvedValue(existingProcessedEvents);
  const where = jest.fn(() => ({ limit }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));
  const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
  const insert = jest.fn((table: unknown) => ({
    values: jest.fn((values: any) => {
      inserts.push({ table, values });
      // cafe24MemberMappings upsert 는 체이닝, 나머지는 await
      return Object.assign(Promise.resolve(), { onConflictDoUpdate });
    }),
  }));
  const del = jest.fn((table: unknown) => ({ where: jest.fn(async () => { deletes.push(table); }) }));
  return { db: { select, insert, delete: del }, inserts, deletes };
}

const USER_ID = '3f9a1c2e-1111-4222-8333-444455556666';
const envelope = { messageId: 'msg-1', correlationId: 'corr-1', chainId: 'chain-1' } as any;

describe('UserEventConsumer (#786)', () => {
  describe('UserDeleted', () => {
    it('processed_events 기록 후 inbox 에 MedusaCustomer 행을 넣는다', async () => {
      const dbMock = createDbMock();
      const consumer = new UserEventConsumer({ db: dbMock.db } as any);

      await consumer.onUserDeleted(envelope, { userId: USER_ID });

      expect(dbMock.inserts).toHaveLength(2);
      expect(dbMock.inserts[0].table).toBe(processedEvents);
      expect(dbMock.inserts[0].values).toMatchObject({
        idempotencyKey: 'msg-1',
        source: 'users.events.v1',
        eventType: 'UserDeleted',
        resourceId: USER_ID,
        status: 'PROCESSED',
      });
      expect(dbMock.inserts[1].table).toBe(inboxEvents);
      expect(dbMock.inserts[1].values).toMatchObject({
        eventType: 'UserDeleted',
        aggregateType: 'MedusaCustomer',
        aggregateId: USER_ID,
        partitionKey: USER_ID,
        payload: { userId: USER_ID },
        metadata: { correlationId: 'corr-1', messageId: 'msg-1', chainId: 'chain-1' },
        status: 'pending',
      });
    });

    it('같은 messageId 가 다시 오면 아무것도 넣지 않는다', async () => {
      const dbMock = createDbMock([{ idempotencyKey: 'msg-1' }]);
      const consumer = new UserEventConsumer({ db: dbMock.db } as any);

      await consumer.onUserDeleted(envelope, { userId: USER_ID });

      expect(dbMock.inserts).toHaveLength(0);
    });

    it('messageId 가 없으면 UserDeleted:<userId> 를 멱등키로 쓴다', async () => {
      const dbMock = createDbMock();
      const consumer = new UserEventConsumer({ db: dbMock.db } as any);

      await consumer.onUserDeleted({ ...envelope, messageId: undefined }, { userId: USER_ID });

      expect(dbMock.inserts[0].values.idempotencyKey).toBe(`UserDeleted:${USER_ID}`);
    });
  });

  describe('UserUpdated', () => {
    it('email 이 있으면 inbox 에 { userId, email } 만 싣는다', async () => {
      const dbMock = createDbMock();
      const consumer = new UserEventConsumer({ db: dbMock.db } as any);

      await consumer.onUserUpdated(envelope, { userId: USER_ID, email: 'new@example.com', nickname: '닉' });

      expect(dbMock.inserts).toHaveLength(2);
      expect(dbMock.inserts[1].values).toMatchObject({
        eventType: 'UserUpdated',
        aggregateType: 'MedusaCustomer',
        aggregateId: USER_ID,
        payload: { userId: USER_ID, email: 'new@example.com' },
      });
      expect(dbMock.inserts[1].values.payload).not.toHaveProperty('nickname');
    });

    it('email 이 없는 프로필 수정은 processed 만 기록하고 inbox 에 넣지 않는다', async () => {
      const dbMock = createDbMock();
      const consumer = new UserEventConsumer({ db: dbMock.db } as any);

      await consumer.onUserUpdated(envelope, { userId: USER_ID, nickname: '닉' });

      expect(dbMock.inserts).toHaveLength(1);
      expect(dbMock.inserts[0].table).toBe(processedEvents);
    });
  });

  describe('기존 Cafe24 핸들러는 헬퍼를 지나도 같은 행을 만든다', () => {
    it('Cafe24Linked: processed + inbox(FirebaseMembership) + 매핑 upsert', async () => {
      const dbMock = createDbMock();
      const consumer = new UserEventConsumer({ db: dbMock.db } as any);

      await consumer.onCafe24Linked(envelope, {
        userId: USER_ID,
        cafe24MemberId: 'c24-1',
        mallId: 'lcnine',
        email: 'a@example.com',
        linkedAt: '2026-09-07T00:00:00.000Z',
      });

      expect(dbMock.inserts.map((i) => i.table)).toEqual([processedEvents, inboxEvents, cafe24MemberMappings]);
      expect(dbMock.inserts[1].values).toMatchObject({
        eventType: 'Cafe24Linked',
        aggregateType: 'FirebaseMembership',
        aggregateId: 'c24-1',
        partitionKey: 'c24-1',
      });
    });

    it('Cafe24Unlinked: processed + inbox + 매핑 delete', async () => {
      const dbMock = createDbMock();
      const consumer = new UserEventConsumer({ db: dbMock.db } as any);

      await consumer.onCafe24Unlinked(envelope, {
        userId: USER_ID,
        cafe24MemberId: 'c24-1',
        mallId: 'lcnine',
        email: 'a@example.com',
        unlinkedAt: '2026-09-07T00:00:00.000Z',
      });

      expect(dbMock.inserts.map((i) => i.table)).toEqual([processedEvents, inboxEvents]);
      expect(dbMock.deletes).toEqual([cafe24MemberMappings]);
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/channel-adapter/src/consumers/user-event.consumer.spec.ts`
Expected: FAIL — `consumer.onUserDeleted is not a function` (Cafe24 두 케이스는 통과할 수 있다 — 기존 동작)

- [ ] **Step 3: 소비자를 재작성한다 (파일 전문)**

`user-event.consumer.ts`:

```ts
import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventPayload, EventEnvelope, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { DbService } from '@app/db';
import { processedEvents, inboxEvents, cafe24MemberMappings } from '../schema';
import { eq } from 'drizzle-orm';
import type { ChannelAdapterSchema } from '../types';
import { USER_STREAM } from '@packages/event-contracts/streams/user.stream';
import { EventPayloadOf, EnvelopeOf } from '@packages/event-contracts/types';

type UserEventType = 'Cafe24Linked' | 'Cafe24Unlinked' | 'UserUpdated' | 'UserDeleted';
type AnyUserEnvelope = EnvelopeOf<typeof USER_STREAM, UserEventType>;

/**
 * User Event Consumer
 *
 * user-service 가 발행한 회원 이벤트를 수신해 Inbox 에 저장한다. InboxWorker 가 비동기로 처리한다:
 * - `Cafe24Linked`/`Cafe24Unlinked` → Firebase 멤버십 상태 확인 후 Medusa 고객 그룹 동기화
 * - `UserUpdated`(email 있는 것만) → Medusa customer email 동기화 (#786)
 * - `UserDeleted` → Medusa 고객 익명화·파기 (#786)
 *
 * Medusa 는 Kafka 를 듣지 않는다. 회원 이벤트가 Medusa 에 닿는 유일한 길이 이 inbox 다 (ADR-0033 §3).
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class UserEventConsumer {
  private readonly logger = new Logger(UserEventConsumer.name);

  constructor(private readonly dbService: DbService<ChannelAdapterSchema>) {}

  /**
   * processed_events 로 멱등을 보장한 뒤 inbox 에 적재한다.
   * @returns 새로 적재했으면 true, 이미 처리된 메시지라 건너뛰었으면 false
   * @param inbox null 이면 processed 만 기록하고 inbox 에는 넣지 않는다 (예: email 없는 UserUpdated)
   */
  private async recordAndEnqueue(
    envelope: AnyUserEnvelope,
    eventType: UserEventType,
    resourceId: string,
    inbox: { aggregateType: string; aggregateId: string; payload: Record<string, unknown> } | null,
  ): Promise<boolean> {
    const db = this.dbService.db;
    const idempotencyKey = envelope.messageId || `${eventType}:${resourceId}`;

    const [existing] = await db
      .select()
      .from(processedEvents)
      .where(eq(processedEvents.idempotencyKey, idempotencyKey))
      .limit(1);

    if (existing) {
      this.logger.debug(`[User] 이미 처리된 이벤트 스킵: ${idempotencyKey}`);
      return false;
    }

    await db.insert(processedEvents).values({
      idempotencyKey,
      source: 'users.events.v1',
      eventType,
      resourceId,
      eventVersion: envelope.messageId || new Date().toISOString(),
      status: 'PROCESSED',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    if (!inbox) return true;

    await db.insert(inboxEvents).values({
      eventType,
      aggregateType: inbox.aggregateType,
      aggregateId: inbox.aggregateId,
      partitionKey: inbox.aggregateId,
      payload: inbox.payload,
      metadata: {
        correlationId: envelope.correlationId,
        messageId: envelope.messageId,
        chainId: envelope.chainId,
      },
      status: 'pending',
      createdAt: new Date(),
    });
    return true;
  }

  @On(USER_STREAM, 'Cafe24Linked')
  async onCafe24Linked(
    @EventEnvelope() envelope: EnvelopeOf<typeof USER_STREAM, 'Cafe24Linked'>,
    @EventPayload() payload: EventPayloadOf<typeof USER_STREAM, 'Cafe24Linked'>,
  ): Promise<void> {
    const { userId, cafe24MemberId, email } = payload;
    this.logger.log(`[User] Cafe24Linked 수신: userId=${userId}, cafe24MemberId=${cafe24MemberId}`);

    try {
      const enqueued = await this.recordAndEnqueue(envelope, 'Cafe24Linked', userId, {
        aggregateType: 'FirebaseMembership',
        aggregateId: cafe24MemberId,
        payload,
      });
      if (!enqueued) return;

      await this.dbService.db
        .insert(cafe24MemberMappings)
        .values({ cafe24MemberId, userId, email, createdAt: new Date(), updatedAt: new Date() })
        .onConflictDoUpdate({
          target: cafe24MemberMappings.cafe24MemberId,
          set: { userId, email, updatedAt: new Date() },
        });

      this.logger.log(`[User] Cafe24Linked Inbox 저장 완료: userId=${userId}`);
    } catch (error) {
      this.logger.error(`[User] Cafe24Linked Inbox 저장 실패: userId=${userId}`, error?.message);
      throw error;
    }
  }

  @On(USER_STREAM, 'Cafe24Unlinked')
  async onCafe24Unlinked(
    @EventEnvelope() envelope: EnvelopeOf<typeof USER_STREAM, 'Cafe24Unlinked'>,
    @EventPayload() payload: EventPayloadOf<typeof USER_STREAM, 'Cafe24Unlinked'>,
  ): Promise<void> {
    const { userId, cafe24MemberId } = payload;
    this.logger.log(`[User] Cafe24Unlinked 수신: userId=${userId}, cafe24MemberId=${cafe24MemberId}`);

    try {
      const enqueued = await this.recordAndEnqueue(envelope, 'Cafe24Unlinked', userId, {
        aggregateType: 'FirebaseMembership',
        aggregateId: cafe24MemberId,
        payload,
      });
      if (!enqueued) return;

      await this.dbService.db.delete(cafe24MemberMappings).where(eq(cafe24MemberMappings.cafe24MemberId, cafe24MemberId));

      this.logger.log(`[User] Cafe24Unlinked Inbox 저장 완료: userId=${userId}`);
    } catch (error) {
      this.logger.error(`[User] Cafe24Unlinked Inbox 저장 실패: userId=${userId}`, error?.message);
      throw error;
    }
  }

  /**
   * 이메일이 바뀐 것만 Medusa 의 관심사다. `UserUpdated` 는 닉네임·전화 등 프로필 수정에도 뜨고 그때는
   * email 이 없다 — 오늘 email 을 싣는 발행자는 cafe24 이메일 이관 하나뿐이다. inbox 에는 `{ userId, email }`
   * 만 싣는다: 워커가 나머지 필드를 읽을 일이 없고, 프로필 값이 inbox 에 남을 이유도 없다.
   */
  @On(USER_STREAM, 'UserUpdated')
  async onUserUpdated(
    @EventEnvelope() envelope: EnvelopeOf<typeof USER_STREAM, 'UserUpdated'>,
    @EventPayload() payload: EventPayloadOf<typeof USER_STREAM, 'UserUpdated'>,
  ): Promise<void> {
    const { userId, email } = payload;

    try {
      const enqueued = await this.recordAndEnqueue(
        envelope,
        'UserUpdated',
        userId,
        email ? { aggregateType: 'MedusaCustomer', aggregateId: userId, payload: { userId, email } } : null,
      );
      if (enqueued && email) {
        this.logger.log(`[User] UserUpdated(email) Inbox 저장 완료: userId=${userId}`);
      }
    } catch (error) {
      this.logger.error(`[User] UserUpdated Inbox 저장 실패: userId=${userId}`, error?.message);
      throw error;
    }
  }

  @On(USER_STREAM, 'UserDeleted')
  async onUserDeleted(
    @EventEnvelope() envelope: EnvelopeOf<typeof USER_STREAM, 'UserDeleted'>,
    @EventPayload() payload: EventPayloadOf<typeof USER_STREAM, 'UserDeleted'>,
  ): Promise<void> {
    const { userId } = payload;
    this.logger.log(`[User] UserDeleted 수신: userId=${userId}`);

    try {
      const enqueued = await this.recordAndEnqueue(envelope, 'UserDeleted', userId, {
        aggregateType: 'MedusaCustomer',
        aggregateId: userId,
        payload: { userId },
      });
      if (enqueued) this.logger.log(`[User] UserDeleted Inbox 저장 완료: userId=${userId}`);
    } catch (error) {
      this.logger.error(`[User] UserDeleted Inbox 저장 실패: userId=${userId}`, error?.message);
      throw error;
    }
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/channel-adapter/src/consumers/user-event.consumer.spec.ts`
Expected: PASS (7 tests)

`EnvelopeOf<typeof USER_STREAM, UserEventType>` 가 유니온을 거부하면 `AnyUserEnvelope` 를 `Pick<EnvelopeOf<typeof USER_STREAM, 'UserDeleted'>, 'messageId' | 'correlationId' | 'chainId'>` 로 좁힌다 — 헬퍼가 쓰는 필드는 그 셋뿐이다.

- [ ] **Step 5: 커밋**

```bash
git add apps/channel-adapter/src/consumers/user-event.consumer.ts apps/channel-adapter/src/consumers/user-event.consumer.spec.ts
git commit -F - <<'EOF'
feat(channel-adapter): UserUpdated(email)·UserDeleted 를 inbox 에 적재 (#786)

Cafe24 핸들러 둘이 복붙하던 「processed 기록 → inbox 적재」를 헬퍼로 뽑아 네 핸들러가
공유한다. email 없는 UserUpdated 는 processed 만 기록한다 — 프로필 수정은 Medusa 의
관심사가 아니다.

Claude-Session: https://claude.ai/code/session_01CcpjodNjV21HHWVxUTVomr
EOF
```

---

### Task 7: channel-adapter — InboxWorker dispatch + 모듈 등록

**Files:**
- Modify: `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts` (imports 7-24행, `INBOX_WORKER_EVENT_TYPES` 33-45행, 생성자 106-116행, switch 434-437행 근처)
- Modify: `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts` (생성자 호출 103행·808행, 라우팅 테스트 추가)
- Modify: `apps/channel-adapter/src/adapter.module.ts` (import 76행 옆, providers 265행 옆)

**Interfaces:**
- Consumes: `CustomerLifecycleMedusaSyncService.handleUserUpdated`/`handleUserDeleted` (Task 5), inbox `eventType` 값 (Task 6)
- Produces: 워커가 `UserUpdated`·`UserDeleted` inbox 행을 처리한다. 생성자 4번째 자리에 `CustomerLifecycleMedusaSyncService` 가 들어간다 (`firebaseMembershipSyncService` 바로 뒤).

- [ ] **Step 1: 라우팅 스펙을 쓴다 (실패해야 한다)**

`inbox-worker.service.spec.ts` 의 첫 `describe('InboxWorkerService ProductSellableQuantityChanged handling'` 블록 **앞**에 새 describe 를 추가한다. `createDbMock` 은 파일 상단의 것을 그대로 쓴다:

```ts
describe('InboxWorkerService 회원 생애주기 라우팅 (#786)', () => {
  const USER_ID = '3f9a1c2e-1111-4222-8333-444455556666';

  function createService() {
    const dbMock = createDbMock();
    const lifecycle = {
      handleUserUpdated: jest.fn().mockResolvedValue({ success: true, data: { userId: USER_ID, action: 'synced' } }),
      handleUserDeleted: jest.fn().mockResolvedValue({ success: true, data: { userId: USER_ID, action: 'synced' } }),
    };
    const configService = { get: jest.fn(() => undefined) };
    const service = new InboxWorkerService(
      { db: dbMock.db } as any,
      {} as any,
      {} as any,
      {} as any,
      lifecycle as any,
      {} as any,
      {} as any,
      {} as any,
      configService as any,
      { runWithChain: jest.fn((_c: string, _e: string, fn: () => Promise<void>) => fn()) } as any,
    );
    return { service, dbMock, lifecycle };
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-07T00:00:00.000Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('UserDeleted 는 handleUserDeleted 로 가고 published 로 마킹된다', async () => {
    const { service, dbMock, lifecycle } = createService();

    await (service as any).doProcessInboxEvent({
      id: 'inbox_del',
      eventType: 'UserDeleted',
      aggregateId: USER_ID,
      payload: { userId: USER_ID },
      attempts: 0,
      createdAt: new Date('2026-09-07T00:00:00.000Z'),
      metadata: { messageId: 'msg-1', chainId: 'chain-1' },
    });

    expect(lifecycle.handleUserDeleted).toHaveBeenCalledWith({ userId: USER_ID });
    expect(dbMock.updates).toEqual([{ status: 'published', publishedAt: new Date('2026-09-07T00:00:00.000Z') }]);
  });

  it('UserUpdated 는 handleUserUpdated 로 간다', async () => {
    const { service, lifecycle } = createService();

    await (service as any).doProcessInboxEvent({
      id: 'inbox_upd',
      eventType: 'UserUpdated',
      aggregateId: USER_ID,
      payload: { userId: USER_ID, email: 'new@example.com' },
      attempts: 0,
      createdAt: new Date('2026-09-07T00:00:00.000Z'),
      metadata: { messageId: 'msg-2', chainId: 'chain-2' },
    });

    expect(lifecycle.handleUserUpdated).toHaveBeenCalledWith({ userId: USER_ID, email: 'new@example.com' });
  });
});
```

기존 두 생성자 호출(103행, 808행)도 4번째 인자 뒤에 `{} as any,` 하나를 끼워 인자 10개로 맞춘다. 103행 쪽:

```ts
    const service = new InboxWorkerService(
      { db: dbMock.db } as any,
      syncService as any,
      {} as any,
      {} as any,
      {} as any, // CustomerLifecycleMedusaSyncService
      {} as any,
      {} as any,
      {} as any,
      configService as any,
      { runWithChain: jest.fn((_chainId: string, _eventId: string, fn: () => Promise<void>) => fn()) } as any,
    );
```

808행 쪽:

```ts
      const service = new InboxWorkerService(
        { db: dbMock.db } as any,
        {} as any,
        realSyncService,
        {} as any,
        {} as any, // CustomerLifecycleMedusaSyncService
        medusaClient as any,
        {} as any,
        {} as any,
        configService as any,
        { runWithChain: jest.fn((_c: string, _e: string, fn: () => Promise<void>) => fn()) } as any,
      );
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts -t "회원 생애주기"`
Expected: FAIL — `Unsupported inbox event type: UserDeleted` (워커가 타입을 모른다). 새 인자 때문에 기존 테스트가 깨지진 않는다 — 여분 인자는 무시된다.

- [ ] **Step 3: 워커 수정**

imports 에 한 줄:

```ts
import { CustomerLifecycleMedusaSyncService } from './customer-lifecycle-medusa-sync.service';
import type { UserDeletedPayload } from '@packages/event-contracts/streams/user.stream';
```

(`Cafe24LinkedPayload, Cafe24UnlinkedPayload` import 줄에 `UserDeletedPayload` 를 더해도 된다.)

`INBOX_WORKER_EVENT_TYPES` 에 두 값:

```ts
const INBOX_WORKER_EVENT_TYPES = [
  'ProductMasterActiveVersionChanged',
  'ProductMasterDeleted',
  'CategoryChanged',
  'ProductSellableQuantityChanged',
  'MembershipStatusChanged',
  'Cafe24Linked',
  'Cafe24Unlinked',
  'FirebaseMembershipSynced',
  'UserUpdated',
  'UserDeleted',
  'CoreFulfillmentShipped',
  'CoreFulfillmentDelivered',
  'CoreOrderCancelled',
] as const;
```

생성자 — `firebaseMembershipSyncService` 바로 뒤에:

```ts
  constructor(
    private readonly dbService: DbService<ChannelAdapterSchema>,
    private readonly syncService: PimMedusaSyncService,
    private readonly membershipSyncService: MembershipMedusaSyncService,
    private readonly firebaseMembershipSyncService: FirebaseMembershipSyncService,
    private readonly customerLifecycleSyncService: CustomerLifecycleMedusaSyncService,
    private readonly medusaClient: MedusaClient,
    private readonly almondAuthClient: AlmondAuthClient,
    private readonly membershipServiceClient: MembershipServiceClient,
    private readonly configService: ConfigService,
    private readonly eventChainService: EventChainService,
  ) {
```

switch — `case 'FirebaseMembershipSynced'` 블록 바로 뒤에:

```ts
        case 'UserUpdated': {
          // 소비자가 email 있는 것만 inbox 에 넣는다 — payload 는 { userId, email } 이다.
          const emailPayload: { userId: string; email: string } = event.payload;
          await this.customerLifecycleSyncService.handleUserUpdated(emailPayload);
          break;
        }

        case 'UserDeleted': {
          const deletedPayload: UserDeletedPayload = event.payload;
          await this.customerLifecycleSyncService.handleUserDeleted(deletedPayload);
          break;
        }
```

- [ ] **Step 4: 모듈 등록**

`adapter.module.ts` — import 76행(`MembershipMedusaSyncService`) 다음 줄:

```ts
import { CustomerLifecycleMedusaSyncService } from './adapters/medusa/customer-lifecycle-medusa-sync.service';
```

providers 265행(`MembershipMedusaSyncService,`) 다음 줄:

```ts
    CustomerLifecycleMedusaSyncService,
```

- [ ] **Step 5: 통과 확인**

Run: `npx jest apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts`
Expected: PASS (기존 전부 + 새 2개)

Run: `npm run type-check 2>&1 | tail -5`
Expected: 에러 0 (`tail` 로 자른 출력에 개수를 매기지 말 것 — 마지막 줄이 `Found N errors` 인지 본다)

- [ ] **Step 6: 커밋**

```bash
git add apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts apps/channel-adapter/src/adapter.module.ts
git commit -F - <<'EOF'
feat(channel-adapter): InboxWorker 가 UserUpdated·UserDeleted 를 CustomerLifecycleMedusaSyncService 로 보낸다 (#786)

Claude-Session: https://claude.ai/code/session_01CcpjodNjV21HHWVxUTVomr
EOF
```

---

### Task 8: user-service — 백필 재발행 엔드포인트

**Files:**
- Create: `apps/user-service/src/api/users/dto/replay-withdrawn.request.dto.ts`
- Create: `apps/user-service/src/api/users/withdrawn-replay.service.ts`
- Create: `apps/user-service/src/api/users/withdrawn-replay.service.spec.ts`
- Modify: `apps/user-service/src/api/users/users.controller.ts` (`getInternalContacts` 바로 뒤, 186행 근처)
- Modify: `apps/user-service/src/api/users/users.module.ts`

**Interfaces:**
- Consumes: `users` 테이블(`apps/user-service/database/drizzle/schema.ts` — `id`, `email`, `deletedAt`), `PublisherFor<typeof USER_STREAM>.publishEvent`, `InternalApiKeyGuard`, `@Public()`
- Produces: `POST /users/internal/replay-withdrawn` — body `{ dryRun: boolean; limit?: number; afterUserId?: string }` → `{ matched: number; published: number; lastUserId: string | null; userIds: string[] }`

- [ ] **Step 1: 서비스 스펙을 쓴다 (실패해야 한다)**

`withdrawn-replay.service.spec.ts`:

```ts
import { PgDialect } from 'drizzle-orm/pg-core';
import { WithdrawnReplayService, withdrawnUsersSelection } from './withdrawn-replay.service';

function createDbMock(rows: Array<{ id: string }>) {
  const captured: { where?: unknown; limit?: number } = {};
  const limit = jest.fn((n: number) => {
    captured.limit = n;
    return Promise.resolve(rows);
  });
  const orderBy = jest.fn(() => ({ limit }));
  const where = jest.fn((condition: unknown) => {
    captured.where = condition;
    return { orderBy };
  });
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));
  return { db: { select }, captured };
}

describe('WithdrawnReplayService (#786 백필)', () => {
  const A = '00000000-0000-4000-8000-00000000000a';
  const B = '00000000-0000-4000-8000-00000000000b';

  function createService(rows: Array<{ id: string }>) {
    const dbMock = createDbMock(rows);
    const publisher = { publishEvent: jest.fn().mockResolvedValue(undefined) };
    const service = new WithdrawnReplayService({ db: dbMock.db } as any, publisher as any);
    return { service, publisher, dbMock };
  }

  it('dryRun 이면 건수와 id 만 돌려주고 아무것도 발행하지 않는다', async () => {
    const { service, publisher } = createService([{ id: A }, { id: B }]);

    const result = await service.replay({ dryRun: true });

    expect(result).toEqual({ matched: 2, published: 0, lastUserId: B, userIds: [A, B] });
    expect(publisher.publishEvent).not.toHaveBeenCalled();
  });

  it('dryRun 이 아니면 행마다 UserDeleted 를 발행한다 — softDeleteUser 와 같은 모양', async () => {
    const { service, publisher } = createService([{ id: A }, { id: B }]);

    const result = await service.replay({ dryRun: false });

    expect(publisher.publishEvent).toHaveBeenCalledTimes(2);
    expect(publisher.publishEvent).toHaveBeenNthCalledWith(1, {
      eventType: 'UserDeleted',
      aggregateId: A,
      payload: { userId: A },
    });
    expect(result).toEqual({ matched: 2, published: 2, lastUserId: B, userIds: [A, B] });
  });

  it('행이 없으면 lastUserId 는 null', async () => {
    const { service } = createService([]);
    expect(await service.replay({ dryRun: true })).toEqual({ matched: 0, published: 0, lastUserId: null, userIds: [] });
  });

  it('limit 은 기본 200, 상한 1000', async () => {
    const { service, dbMock } = createService([]);
    await service.replay({ dryRun: true });
    expect(dbMock.captured.limit).toBe(200);
    await service.replay({ dryRun: true, limit: 5000 });
    expect(dbMock.captured.limit).toBe(1000);
  });

  /** drizzle 조건식을 SQL 문자열로 렌더한다. 조건이 둘 다인지는 렌더된 SQL 로만 단정할 수 있다 (inbox-worker.service.spec 의 renderSql 과 같은 기법). */
  const render = (afterUserId?: string) => new PgDialect().sqlToQuery(withdrawnUsersSelection(afterUserId)).sql;

  it('선택 조건은 deleted_at 과 치환 이메일 마커 둘 다다 — deleted_at 만으로 고르면 휴면 회원이 익명화된다', () => {
    const sql = render();
    expect(sql).toMatch(/"deleted_at" is not null/);
    expect(sql).toMatch(/"email" like/);
  });

  it('afterUserId 커서가 있으면 id > 커서 조건이 붙는다', () => {
    expect(render(A)).toMatch(/"id" > /);
    expect(render()).not.toMatch(/"id" > /);
  });
});
```


- [ ] **Step 2: 실패 확인**

Run: `npm run test:user-service -- --testPathPattern withdrawn-replay`
Expected: FAIL — `Cannot find module './withdrawn-replay.service'`

- [ ] **Step 3: DTO + 서비스 구현**

`dto/replay-withdrawn.request.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ReplayWithdrawnRequestDto {
  @ApiProperty({ description: 'true 면 대상 건수와 id 만 돌려주고 발행하지 않는다. 실행 전에 반드시 한 번 본다.' })
  @IsBoolean()
  dryRun: boolean;

  @ApiProperty({ required: false, description: '한 번에 처리할 최대 건수 (기본 200, 최대 1000)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @ApiProperty({ required: false, description: '이전 응답의 lastUserId. 그 다음부터 이어서 처리한다.' })
  @IsOptional()
  @IsUUID('4')
  afterUserId?: string;
}
```

`withdrawn-replay.service.ts`:

```ts
import { DbService, InjectDb } from '@app/db';
import { InjectPublisher, PublisherFor } from '@app/events';
import { Injectable, Logger } from '@nestjs/common';
import { USER_STREAM } from '@packages/event-contracts/streams';
import { type UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { and, asc, gt, isNotNull, like, type SQL } from 'drizzle-orm';
import * as schema from '../../../database/drizzle/schema';

export type ReplayWithdrawnParams = { dryRun: boolean; limit?: number; afterUserId?: string };
export type ReplayWithdrawnResult = { matched: number; published: number; lastUserId: string | null; userIds: string[] };

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

/**
 * 재발행 대상 선택 조건. 순수 함수로 두는 이유는 스펙이 렌더된 SQL 로 「조건이 둘 다인가」를 단정하기 위해서다.
 * `_` 는 LIKE 의 와일드카드라 이스케이프한다 (Postgres 기본 escape 문자 `\`).
 */
export function withdrawnUsersSelection(afterUserId?: string): SQL {
  const conditions: SQL[] = [
    isNotNull(schema.users.deletedAt),
    like(schema.users.email, 'withdrawn\\_%@deleted.invalid'),
  ];
  if (afterUserId) conditions.push(gt(schema.users.id, afterUserId));
  // conditions 가 항상 2개 이상이라 and() 가 undefined 를 돌려주지 않는다
  return and(...conditions)!;
}

/**
 * 이미 탈퇴한 회원의 `UserDeleted` 를 다시 낸다 (#786 백필, 스펙 §4.4).
 *
 * 왜 「사실 재발행」인가: 정상 경로(Kafka → channel-adapter inbox → Medusa withdraw 라우트)를 그대로 타므로
 * 코드가 하나고, 라우트가 userId 키로 멱등하므로 겹쳐 불러도 안전하다. membership 도 같은 이벤트를 받아
 * 남은 구독을 해지한다 — 09-02 정책과 같다. 그래서 반드시 dryRun 으로 건수를 본 뒤 실행한다.
 *
 * 왜 `deleted_at` 만으로 고르지 않는가: 2026-09-02 마이그레이션(`20260902050051_add-dormant-at.sql`)은
 * `dormant_at` 컬럼만 추가했고 옛 `deleted_at` 행을 재분류하지 않았다. 그 이전 `deleted_at` 은 휴면과 탈퇴가
 * 공유했다. 치환 이메일(`withdrawn_<token>@deleted.invalid`, `AuthService.anonymizeIdentity`)은 탈퇴 익명화를
 * 거쳤다는 유일한 증거다. `deleted_at` 전체로 재발행하면 휴면 회원의 구독이 해지되고 Medusa 고객이
 * 익명화된다. 이 조건에 안 걸리는 2026-03-02 ~ 09-02 탈퇴자는 사람이 판정한 목록으로 따로 다룬다.
 */
@Injectable()
export class WithdrawnReplayService {
  private readonly logger = new Logger(WithdrawnReplayService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    @InjectPublisher(USER_STREAM) private readonly eventPublisher: PublisherFor<typeof USER_STREAM>,
  ) {}

  async replay(params: ReplayWithdrawnParams): Promise<ReplayWithdrawnResult> {
    const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const rows = await this.dbService.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(withdrawnUsersSelection(params.afterUserId))
      .orderBy(asc(schema.users.id))
      .limit(limit);

    const userIds = rows.map((r) => r.id);
    const lastUserId = userIds.length > 0 ? userIds[userIds.length - 1] : null;

    if (params.dryRun) {
      this.logger.log(`[WithdrawnReplay] dryRun: matched=${userIds.length} lastUserId=${lastUserId ?? '-'}`);
      return { matched: userIds.length, published: 0, lastUserId, userIds };
    }

    let published = 0;
    for (const userId of userIds) {
      // softDeleteUser 와 같은 발행 방식 — 즉시 Kafka. 하나가 실패하면 여기서 멈추고 published 까지만 보고한다.
      // 호출자는 마지막 성공 id 뒤부터 다시 부른다 (하류가 멱등이라 겹쳐도 안전).
      await this.eventPublisher.publishEvent({ eventType: 'UserDeleted', aggregateId: userId, payload: { userId } });
      published++;
    }

    this.logger.log(`[WithdrawnReplay] published=${published}/${userIds.length} lastUserId=${lastUserId ?? '-'}`);
    return { matched: userIds.length, published, lastUserId, userIds };
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:user-service -- --testPathPattern withdrawn-replay`
Expected: PASS (6 tests)

`like(...)` 가 렌더한 SQL 에서 `"users"."email" like $1` 처럼 바인딩되므로 `toMatch(/"email" like/)` 는 통과한다. Medusa 쪽 참고: `mergeMetadata`(`@medusajs/utils`)는 빈 문자열만 키를 지우고 `null` 은 그대로 저장한다 — 그래서 Task 2 가 `almond_user_id: null` 을 단언하고, `findCustomerByAlmondUserId` 의 `metadata.almond_user_id = <userId>` 필터에는 안 걸린다.

- [ ] **Step 5: 컨트롤러 + 모듈**

`users.controller.ts` — import 에 두 줄:

```ts
import { ReplayWithdrawnRequestDto } from './dto/replay-withdrawn.request.dto';
import { WithdrawnReplayService } from './withdrawn-replay.service';
```

생성자:

```ts
  constructor(
    private readonly usersService: UsersService,
    private readonly withdrawnReplayService: WithdrawnReplayService,
  ) {}
```

`getInternalContacts` 메서드 바로 뒤:

```ts
  @ApiOperation({
    summary: '[Internal] 이미 탈퇴한 회원의 UserDeleted 재발행 (#786 백필)',
    description:
      '치환 이메일 마커(withdrawn_…@deleted.invalid)를 가진 회원만 고른다. 호출자는 운영자(curl)다. ' +
      'dryRun: true 로 건수를 먼저 본다 — membership 도 이 이벤트를 받아 남은 구독을 해지한다. ' +
      'Authorization: Bearer ${USER_SERVICE_INTERNAL_KEY} 필요.',
  })
  @Post('internal/replay-withdrawn')
  @Public()
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  async replayWithdrawn(@Body() body: ReplayWithdrawnRequestDto) {
    return this.withdrawnReplayService.replay(body);
  }
```

`users.module.ts`:

```ts
import { EventsModule } from '@app/events';
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { WithdrawnReplayService } from './withdrawn-replay.service';

@Module({
  imports: [EventsModule],
  controllers: [UsersController],
  providers: [UsersService, WithdrawnReplayService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 6: 타입·기존 스펙 확인**

Run: `npm run test:user-service 2>&1 | tail -8`
Expected: 실패 0. `users.controller` 를 `new` 로 만드는 스펙이 있으면 두 번째 인자가 필요하다 — `grep -rn "new UsersController(" apps/user-service/src` 로 확인해 `{} as any` 를 더한다 (오늘은 0곳).

Run: `npm run type-check 2>&1 | tail -3`
Expected: `Found 0 errors` 또는 에러 없음.

- [ ] **Step 7: 커밋**

```bash
git add apps/user-service/src/api/users
git commit -F - <<'EOF'
feat(user-service): POST /users/internal/replay-withdrawn — 탈퇴자 UserDeleted 재발행 (#786 백필)

deleted_at 만으로 고르지 않는다. 09-02 마이그레이션이 옛 deleted_at 을 재분류하지 않아 휴면과
탈퇴가 섞여 있고, 치환 이메일이 탈퇴 익명화를 거쳤다는 유일한 증거다. dryRun 이 기본 관문이다 —
membership 도 같은 이벤트로 남은 구독을 해지한다.

Claude-Session: https://claude.ai/code/session_01CcpjodNjV21HHWVxUTVomr
EOF
```

---

### Task 9: 문서 + 전체 게이트 + PR

**Files:**
- Modify: `CONTEXT.md:98` (판매 채널 절, `_Avoid_` 줄 바로 앞)
- Modify: `docs/superpowers/specs/2026-09-07-medusa-user-lifecycle-sync-design.md` (상태 없음 — 손대지 않는다)

**Interfaces:**
- Consumes: Task 1~8 전부
- Produces: PR. 배포·replay 는 사람이 한다 (스펙 §7).

- [ ] **Step 1: CONTEXT.md 한 줄**

`CONTEXT.md` 98행 `- Medusa 는 WMS/재고 판단을 위해 Core API 를 직접 호출하지 않는다. …` 바로 다음 줄에:

```markdown
- **회원 생애주기(이메일 변경·탈퇴)의 Medusa 반영도 channel-adapter inbox 를 지난다.** Medusa 는 Kafka 를 듣지 않는다 — user-service 의 `UserUpdated`/`UserDeleted` 는 inbox 를 거쳐 Medusa admin 라우트(`POST /admin/customers/:id`, `…/by-almond-user/:userId/withdraw`)로 들어간다. 탈퇴 파기 규칙(익명화·주소 하드삭제·auth identity 삭제)은 Medusa 워크플로가 갖는다 (#786, 스펙 `docs/superpowers/specs/2026-09-07-medusa-user-lifecycle-sync-design.md`).
```

- [ ] **Step 2: 전체 게이트**

```bash
npm run type-check 2>&1 | tail -3
npx jest --maxWorkers=2 2>&1 | tail -8
npm run test:user-service 2>&1 | tail -6
(cd apps/medusa && npm run test:unit 2>&1 | tail -6)
scripts/local/run-medusa-integration.sh --testPathPattern 'customer-withdraw|coupon-auto-issue-subscriber' 2>&1 | tail -8
```

Expected: 넷 다 실패 0. 마지막은 우리 스펙 + 인접 스펙(같은 `customer` 모듈을 쓰는 것) 초록.

- [ ] **Step 3: 로컬 E2E 스모크 (사람이 클릭)**

```bash
npm run bootstrap:e2e:local
npm run start:all:local
npm run preflight:e2e:local
```

1. storefront 에서 가입·로그인 → 마이페이지에서 배송지 1개 등록.
2. Medusa admin 고객 화면에서 그 고객이 이름·이메일·주소를 가진 것을 본다.
3. storefront 에서 탈퇴.
4. channel-adapter DB: `select event_type, status, error_message from inbox_events where event_type='UserDeleted' order by created_at desc limit 1;` → `published`.
5. Medusa admin: 같은 고객이 `탈퇴회원`, `withdrawn_…@deleted.invalid`, 주소 0, 삭제됨 표시. Medusa DB: `select count(*) from provider_identity where entity_id='<userId>';` → 0.
6. 같은 이메일로 다시 가입 → 성공(유일 제약이 풀렸다).

결과를 PR 본문에 「스모크 6/6」으로 적는다. 하나라도 어긋나면 PR 을 열지 않고 원인을 고친다.

- [ ] **Step 4: 커밋 + PR**

```bash
git add CONTEXT.md
git commit -F - <<'EOF'
docs(context): 회원 생애주기의 Medusa 반영은 channel-adapter inbox 를 지난다 (#786)

Claude-Session: https://claude.ai/code/session_01CcpjodNjV21HHWVxUTVomr
EOF
git push -u origin feat/786-medusa-user-lifecycle-sync
gh pr create --base develop --title "feat: Medusa 회원 생애주기 동기화 — 죽은 subscriber 를 channel-adapter 경로로 대체 (#786)" --body-file - <<'EOF'
Closes #786

## 무엇
- Medusa `user.updated`·`user.deleted` subscriber 삭제 (Kafka 를 두 번 걷어낸 설계의 고아, 가드 B 예외 0)
- channel-adapter: `UserUpdated(email)`·`UserDeleted` → inbox → `CustomerLifecycleMedusaSyncService` → Medusa admin API
- Medusa: `POST /admin/customers/by-almond-user/:userId/withdraw` + `withdrawCustomerWorkflow` (익명화·주소 하드삭제·소프트삭제·auth identity 삭제, userId 키로 멱등)
- user-service: `POST /users/internal/replay-withdrawn` (치환 이메일 마커 회원의 `UserDeleted` 재발행, dryRun)

설계: `docs/superpowers/specs/2026-09-07-medusa-user-lifecycle-sync-design.md` · 플랜: `docs/superpowers/plans/2026-09-07-medusa-user-lifecycle-sync.md`

## 배포 (스펙 §7)
1. `sst deploy` lcnine-services (channel-adapter + Medusa)
2. `sst deploy` lcnine-auth (user-service)
3. `POST /users/internal/replay-withdrawn { dryRun: true }` 로 건수·id 확인 — **membership 도 이 이벤트로 남은 구독을 해지한다**
4. `dryRun: false` 를 `afterUserId` 커서로 끝까지
5. channel-adapter `inbox_events` 에서 `UserDeleted` 전부 `published`, `failed` 0 확인

마이그레이션 0 · 시크릿 0 · env 0.

## 남는 것
2026-03-02 ~ 09-02 탈퇴자는 옛 `deleted_at` 이 휴면과 섞여 있어 이 PR 로는 남는다. 사람이 판정한 목록으로 처리한다 (#786 에 코멘트).

## 검증
- `npm run type-check` 0 · `npx jest --maxWorkers=2` 0 · `npm run test:user-service` 0 · Medusa unit 0 · Medusa http 통합 `customer-withdraw` 6/6
- 로컬 E2E 스모크 6/6 (Task 9 Step 3)

https://claude.ai/code/session_01CcpjodNjV21HHWVxUTVomr
EOF
```

- [ ] **Step 5: 이슈 코멘트**

```bash
gh issue comment 786 --body-file - <<'EOF'
설계 확정 + 구현 PR 열림. 결정 8건은 스펙 §3 (`docs/superpowers/specs/2026-09-07-medusa-user-lifecycle-sync-design.md`).

- 선택지 1 채택 (channel-adapter inbox → Medusa admin 라우트). 선택지 2 는 ADR-0033 §3 위반으로 기각.
- 익명화 규칙은 Medusa `withdrawCustomerWorkflow` 가 갖는다. 파기 범위에 주소 하드삭제·auth identity 삭제를 더했다 — 기존 handler 는 고객 행만 지웠다.
- 백필은 `POST /users/internal/replay-withdrawn` (치환 이메일 마커). **2026-03-02 ~ 09-02 탈퇴자는 남는다** — 09-02 마이그레이션이 옛 `deleted_at` 을 재분류하지 않아 휴면과 구분 불가. 사람이 판정한 목록이 필요하다.
EOF
```

---

## Self-Review (작성자가 돌린 것)

**스펙 커버리지** — §4.2 channel-adapter 3파일 → Task 4·5·6·7. §4.3 라우트·워크플로·삭제 → Task 1·2·3. §4.4 replay → Task 8. §5 실패 처리 표의 각 행: 멱등키(Task 6 스펙), email 없음(Task 6), 고객 없음 no-op(Task 5 스펙 + Task 2 통합), 이메일 충돌 4xx→failed(Task 4 `updateCustomerEmail` throw + inbox 기존 규칙), 404→failed(Task 4 permanent), 5xx→재시도(Task 4 transient), ⑤ 실패 뒤 재시도(Task 2 「sso identity 만 남은 상태」 케이스). §6 테스트 넷 → Task 4·5·6·7(루트 jest), Task 2(Medusa 통합), Task 8(user-service), Task 9 Step 3(E2E). §7 문서·배포 → Task 9. 결정 7(이메일만)·8(메트릭 없음)은 「안 하는 것」이라 태스크가 없는 게 맞다.

**플레이스홀더** — 없음. 모든 코드 스텝에 코드가 있고 「비슷하게」 참조 없음.

**타입 일관성** — `WithdrawCustomerOutcome`(Task 4) = `WithdrawCustomerResult`(Task 1) 모양 동일 `{ customer: 'anonymized'|'not_found'; auth_identities_deleted: number }`. `handleUserUpdated` 인자 `{ userId, email }` 은 Task 6 inbox payload·Task 7 case·Task 5 스펙에서 같다. 워커 생성자 5번째 자리(`customerLifecycleSyncService`) 는 Task 7 의 두 기존 호출 수정과 새 describe 에서 같은 자리다. `deleteAuthIdentitiesStep` 반환 `{ deleted }` 를 워크플로가 `deleted.deleted` 로 읽는다.
