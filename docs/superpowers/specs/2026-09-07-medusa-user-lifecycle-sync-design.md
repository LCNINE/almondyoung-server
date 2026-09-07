# Medusa 회원 생애주기 동기화 — 죽은 subscriber 를 channel-adapter 경로로 대체 (설계)

> 2026-09-07. 이슈 #786. [[0033-coupons-are-owned-by-the-sales-channel]] §3 의 경로(사실 → Kafka →
> channel-adapter inbox → Medusa admin 라우트)를 회원 이벤트에 적용한다. **새 ADR 은 없다** — 원칙은
> 이미 적혀 있고 이 문서는 그 적용이다. 이 문서는 **왜** 를 적는다. **무엇을 어떤 순서로** 는 같은
> 날짜의 plans 문서에 있다.

## 1. 문제

`apps/medusa/src/subscribers/user.updated.ts` · `user.deleted.ts` 는 Medusa 이벤트 버스에서
`users.events.v1` 이라는 이름을 기다린다. 그것은 Kafka 토픽 이름이고, Medusa 는 Kafka 를 소비하지
않는다. 두 subscriber 는 한 번도 실행되지 않는다.

원인은 git 이력에 있다. Medusa 의 Kafka 의존은 **설계 결정으로 두 번 제거**됐고, 그 사이에 한 번
재도입됐다. 두 subscriber 는 되돌려진 재도입의 고아다.

| 날짜 | 커밋 | 내용 |
|---|---|---|
| 2025-09-04 | `7239e3bef` | `user.deleted.ts` 탄생 (당시 `src/modules/events` Kafka 모듈 존재) |
| 2026-03-02 | `53af9459b` | 「[Medusa] 설계상 kafka 의존성 제거」— 모듈·subscriber 5개 삭제. 1차 사망 |
| 2026-04-08 | `144435fb9` | `src/modules/events` 로 Kafka 재도입, `user.updated.ts` 를 여기에 연결 |
| 2026-04-15 | `1970e519e` | `src/modules/events` 다시 삭제. 최종 사망 |
| 2026-07-07 | `abbb81594` | cafe24 이메일 이관 버그픽스 — user-service 가 `UserUpdated(email)` 을 내고 **죽은 subscriber 가 받는다고 가정** |
| 2026-09-02 | `b2ccb0c58` | 탈퇴 익명화 버그픽스 — 커밋 메시지가 「UserDeleted 를 받는 곳이 Medusa 하나뿐이라」고 적는다 |

두 버그픽스 모두 각 층의 테스트가 초록인 채로 배포됐다. #775 와 같은 실패 모드(구독자는 있는데
발행자가 없다)이고, 그때 만든 가드 B 가 이 둘을 잡아 `KNOWN_DEAD` 에 `#786` 으로 올려 두었다.

### 1.1 영향

- **탈퇴 (급함).** 09-02 이후 user-service 는 탈퇴 시 식별정보를 파기하고 membership 은 구독을
  해지한다. Medusa 고객 행의 이름·이메일·전화, 주소, auth identity 의 이메일·이름·IdP 토큰은 그대로
  남는다. 개인정보처리방침의 「탈퇴 시 지체 없이 파기」가 Medusa 에서 깨져 있다. 03-02 이후 탈퇴자
  전원이 해당한다.
- **이메일 변경.** SSO 는 `sub`(=userId) 로 identity 를 찾으므로 드리프트로 로그인은 안 깨진다(§2 ②).
  문제는 `membership-medusa-sync` 의 email fallback 이다. `almond_user_id` 로 찾은 고객의 이메일이
  멤버십 이메일과 다르면 유령으로 판정하고 새 이메일로 다른 고객을 찾는다. 그 이메일로 다른 행
  (게스트 결제 등)이 있으면 그 행에 `almond_user_id` 를 써 넣고 옳은 고객에서 지운다(§2 ④).
  드리프트가 오귀속으로 번지는 경로다.

## 2. 실측 근거 (2026-09-07, 소스 확인)

| # | 사실 | 좌표 | 설계에 미치는 영향 |
|---|---|---|---|
| ① | Medusa 의 Kafka 는 두 번 제거됐고(`53af9459b`, `1970e519e`) 사이에 한 번 재도입됐다(`144435fb9`). 오늘 `medusa-config.js` 모듈 목록에 Kafka 없음, loader 없음 | `git log --diff-filter=D -- apps/medusa/src/modules/events` | 「Medusa 는 Kafka 를 듣지 않는다」는 우연이 아니라 결정. subscriber 를 살리는 방향은 없다 |
| ② | SSO 프로바이더는 `entity_id = claims.sub` 로 identity 를 찾는다. 이메일이 아니다 | `apps/medusa/src/modules/user-service-sso/service.ts:171` | 이메일 드리프트는 로그인을 안 깨뜨린다. `user.updated` 의 영향은 ④ 로 한정 |
| ③ | storefront 가 첫 로그인 때 `POST /store/customers` 로 고객을 만들고 `metadata.almond_user_id = user_metadata.user_id`(=sub) 를 박는다 | `web/almondyoung-storefront/src/lib/api/medusa/sso.ts:154-162` | 고객이 없으면 첫 로그인 때 **현재** 이메일로 생성된다 → `UserUpdated` 에서 고객 없음은 재시도 대상이 아니다 |
| ④ | `MembershipMedusaSyncService` 는 이메일 불일치 시 email fallback 으로 찾은 고객에 `almond_user_id` 를 쓰고, userId 로 찾았던 고객에서 그 키를 지운다 | `apps/channel-adapter/src/adapters/medusa/membership-medusa-sync.service.ts:64-84` | 이메일 동기화가 필요한 실제 이유. 동기화 실패는 조용히 넘기지 말고 `failed` 로 보이게 한다 |
| ⑤ | channel-adapter 는 이미 `users.events.v1` 을 구독한다(`Cafe24Linked`/`Unlinked`). `processed_events` 로 멱등, `inbox_events` 로 적재, `InboxWorker` 가 `eventType` 별 switch 로 dispatch. `SlowRetryInboxError` 는 「선행 조건 미충족」 전용으로 1시간 캡 백오프 | `consumers/user-event.consumer.ts` · `adapters/medusa/inbox-worker.service.ts:413,650` | 배관 신설 0. 핸들러 2 + case 2 |
| ⑥ | `MedusaClient` 에 `findCustomerByAlmondUserId`(`GET /admin/customers/by-almond-user/:id`), `updateCustomerMetadata`(`sdk.admin.customer.update`), 그리고 커스텀 라우트 호출의 영구/일시 실패 규칙(4xx 는 429 제외 영구, throw 해서 inbox `failed`) 이 있다 | `medusa.client.ts:2321,2367,2401-2430` | 새 메서드 둘은 이 셋을 그대로 따른다 |
| ⑦ | 코어 워크플로: `updateCustomersWorkflow`(step 보상이 이전 값 복원), `deleteCustomersWorkflow`(`softDeleteCustomers`, `customer.deleted` emit), `deleteCustomerAddressesWorkflow`(하드 삭제), `removeCustomerAccountWorkflow`(익명화 없음, `has_account` 인데 identity 없으면 throw; `auth_identity` 를 `app_metadata.customer_id` 로 remote query 하는 선례) | `@medusajs/core-flows/dist/customer/workflows/*.js` | 우리 워크플로는 앞 셋을 `runAsStep` 으로 조합한다. 넷째는 쓰지 않는다 |
| ⑧ | auth 모듈: `listProviderIdentities({ entity_id, provider })`, `deleteAuthIdentities(ids)`. `provider_identity.user_metadata` 에 email·name, `provider_metadata` 에 IdP access/refresh 토큰이 저장된다 | `@medusajs/types/dist/auth/service.d.ts:281,327` · `user-service-sso/service.ts:205-215` | 파기 범위에 auth identity 가 들어가야 한다. 코어 admin API 로는 못 지우므로 Medusa 안에서 해야 한다 → 결정 2 |
| ⑨ | customer 모델은 `addresses` 에 cascade delete. 소프트 삭제가 따라가지만 **행과 값은 남는다** | `@medusajs/customer/dist/models/customer.js:25-30` | 주소는 별도로 하드 삭제한다. 주문은 자체 주소 스냅샷(`order_address`)을 가져 영향 없다 |
| ⑩ | user-service `softDeleteUser` 는 `inTx` 안 마지막 문장에서 `publishEvent`(즉시 Kafka) 로 `UserDeleted {userId}` 를 낸다. `anonymizeIdentity` 는 이메일을 `withdrawn_<token>@deleted.invalid` 로 치환. 09-02 마이그레이션은 `dormant_at` 컬럼만 추가했고 **옛 `deleted_at` 행을 재분류하지 않았다** | `auth.service.ts:1038-1057,1075-1110` · `database/drizzle/20260902050051_add-dormant-at.sql` | 백필 선택 조건은 `deleted_at` 이 아니라 치환 이메일 마커다. 03-02~09-02 탈퇴자는 휴면과 구분 불가 |
| ⑪ | user-service 내부 엔드포인트 선례: `POST /users/internal/contacts` = `@Public()` + `InternalApiKeyGuard`(`USER_SERVICE_INTERNAL_KEY`, 미설정 시 fail-closed) | `users.controller.ts:178-186` · `commons/guards/internal-api-key.guard.ts` | replay 엔드포인트는 같은 자리·같은 가드 |
| ⑫ | membership 도 `UserDeleted` 를 소비한다(`UserWithdrawalConsumer` — 남은 구독 강제 해지, 계좌 삭제, 환불 없음) | `apps/membership/src/consumers/user-withdrawal.consumer.ts` | 백필 재발행은 membership 에도 도달한다. dryRun 필수 |
| ⑬ | `UserUpdatedPayload.email` 은 optional 이고 오늘 그것을 채우는 곳은 cafe24 이메일 이관뿐. `users.service.ts:331` 의 `UserUpdated` 는 `UpdateUserDto` 스프레드라 email 이 없다 | `packages/event-contracts/streams/user.stream.ts:58-67` · `cafe24-link.service.ts:237-243` | email 없는 `UserUpdated` 는 inbox 에 넣지 않는다 |
| ⑭ | 가드 B 는 `KNOWN_DEAD` 의 키가 더 이상 구독되지 않으면 stale 로 실패한다 | `apps/medusa/src/subscribers/__tests__/subscriber-events-have-emitters.unit.spec.ts` | subscriber 삭제와 `KNOWN_DEAD` 비우기는 한 커밋 |

## 3. 결정

| # | 결정 | 근거 |
|---|---|---|
| **1** | **경로는 Kafka → channel-adapter inbox → Medusa admin 라우트.** 이슈의 선택지 2(user-service → Medusa 내부 라우트 직접 호출)는 기각 | ADR-0033 §3 「밖은 사건만 알린다, 명령을 보내지 않는다」. user-service 는 오늘 Medusa 를 한 번도 부르지 않고 SSO 프로바이더가 `update()` 에서 「프로필 변경은 user-service 에서 흘러온다」며 거부한다 — 역방향 의존을 새로 여는 것. inbox 의 멱등·재시도·DLQ·effect 추적을 잃는다. §9 |
| **2** | **탈퇴 익명화 규칙은 Medusa 워크플로가 갖는다.** channel-adapter 는 라우트 하나만 부른다 | ADR-0033 §2 「판정은 Medusa 안에서」, ADR-0034 「쓰기는 워크플로를 지난다」. auth identity(⑧)는 코어 API 로 못 지운다. `issue-coupons`·`refresh-cart-prices` 와 같은 모양 |
| **3** | **라우트 키는 customer id 가 아니라 userId.** `POST /admin/customers/by-almond-user/:almondUserId/withdraw` | 익명화가 `almond_user_id` 를 지우므로 customer id 로는 재시도가 「없음」이 된다. userId 면 두 번째 호출이 고객 없음 → auth identity 만 재확인 → 200. 재시도·백필 재실행이 안전하다 |
| **4** | **파기 범위 = 고객 행 익명화 + 주소 하드 삭제 + auth identity 삭제.** 09-02 규칙(⑩)을 그대로 쓰되 주소·identity 를 더한다 | ⑧⑨. 소프트 삭제는 파기가 아니다. 주문의 법정 보관은 주문 스냅샷이 담당한다(09-02 커밋 근거) |
| **5** | **`UserDeleted`·`UserUpdated` 에서 Medusa 고객 없음은 종결 no-op.** `SlowRetryInboxError` 를 쓰지 않는다 | 탈퇴자는 앞으로 로그인하지 않는다. 이메일 변경자는 첫 로그인 때 현재 이메일로 생성된다(③). 기다릴 선행 조건이 없다 |
| **6** | **백필은 사실 재발행.** user-service 내부 엔드포인트가 치환 이메일 마커를 가진 회원의 `UserDeleted` 를 다시 낸다. 03-02~09-02 탈퇴자는 **이 설계로는 남는다** | 정상 경로를 그대로 타므로 코드가 하나고 멱등하다(결정 3). ⑩ 때문에 옛 행은 휴면과 구분 불가 — 잘못 재발행하면 휴면 회원의 구독이 해지되고 고객이 익명화된다. 사람이 판정한 목록이 필요하며 범위 밖 |
| **7** | **이메일만 동기화한다.** 이름·전화는 하지 않는다 | 주문은 자체 스냅샷을 갖고 Medusa 의 이름·전화는 admin 표시용이다. 오늘 `UserUpdated` 에 email 을 싣는 곳도 하나뿐(⑬) |
| **8** | **새 Prometheus 메트릭 없음.** inbox `failed` 행 + `EventTrackingService.trackEffect` 로 본다 | 쿠폰이 메트릭을 놓은 이유는 「관측으로도 정상과 구별이 안 됐다」였다. 여기선 실패가 inbox 행으로 남고 사람이 조치한다. 값이 갈리는 첫 순간에 더한다 |

## 4. 설계

### 4.1 전체 그림

```
[전]  user-service ─Kafka users.events.v1─▶ (수신자 없음) … Medusa subscriber 가 기다림

[후]  user-service ─Kafka users.events.v1─▶ channel-adapter UserEventConsumer
                                              │ processed_events(멱등) → inbox_events(pending)
                                              ▼ InboxWorker → CustomerLifecycleMedusaSyncService
        UserUpdated(email 有) ──▶ MedusaClient.updateCustomerEmail ──▶ POST /admin/customers/:id  (코어)
        UserDeleted           ──▶ MedusaClient.withdrawCustomer   ──▶ POST /admin/customers/by-almond-user/:userId/withdraw
                                                                         └▶ withdrawCustomerWorkflow
                                                                              ① 고객 조회 ② 주소 하드삭제 ③ 익명화
                                                                              ④ 소프트삭제 ⑤ auth identity 삭제
      백필: POST /users/internal/replay-withdrawn ─▶ UserDeleted 재발행 ─▶ 위와 같은 길 (+ membership)
```

Medusa 는 Kafka 로부터 아무것도 듣지 않는다. subscriber 두 파일은 삭제한다.

### 4.2 channel-adapter

**`consumers/user-event.consumer.ts`** — `@On(USER_STREAM, 'UserUpdated')` · `@On(USER_STREAM, 'UserDeleted')` 를
더한다. 기존 Cafe24 핸들러 둘이 「processed_events 조회·기록 → inbox 적재」 40줄을 복붙하고 있으므로, 그
부분을 private `recordAndEnqueue(envelope, { eventType, aggregateType, aggregateId, payload })` 로 뽑아
네 핸들러가 공유한다. Cafe24 핸들러의 `cafe24MemberMappings` upsert/delete 는 헬퍼 밖에 그대로 남는다.

| 핸들러 | 게이트 | inbox 행 |
|---|---|---|
| `UserUpdated` | `payload.email` 없으면 processed 만 기록하고 반환(inbox 미적재) | `eventType='UserUpdated'`, `aggregateType='MedusaCustomer'`, `aggregateId=partitionKey=userId`, payload `{ userId, email }` |
| `UserDeleted` | 없음 | `eventType='UserDeleted'`, 나머지 동일, payload `{ userId }` |

멱등키는 `envelope.messageId`(폴백 `UserDeleted:${userId}`). `metadata` 에 correlationId·messageId·chainId —
기존과 같다.

**`adapters/medusa/customer-lifecycle-medusa-sync.service.ts`** (신설, `MembershipMedusaSyncService` 와 같은 모양)

```ts
handleUserUpdated({ userId, email }): Promise<SyncResult>
  customer = medusaClient.findCustomerByAlmondUserId(userId)
  없음            → trackEffect SKIPPED('첫 로그인 때 현재 이메일로 생성됨') → { action: 'skipped' }
  email 같음      → { action: 'skipped' }
  다름            → medusaClient.updateCustomerEmail(customer.id, email) → trackEffect SYNCED → { action: 'synced' }

handleUserDeleted({ userId }): Promise<SyncResult>
  outcome = medusaClient.withdrawCustomer(userId)          // 고객 없음도 200 으로 돌아온다
  trackEffect(outcome.customer === 'anonymized' ? SYNCED : SKIPPED, auth_identities_deleted 포함)
  → { action: outcome.customer === 'anonymized' ? 'synced' : 'skipped' }
```

어느 쪽도 `SlowRetryInboxError` 를 던지지 않는다(결정 5). `MedusaClient` 가 던진 에러는 그대로 전파해 inbox
가 재시도·`failed` 를 판단한다.

**`adapters/medusa/medusa.client.ts`** — 메서드 둘.

- `updateCustomerEmail(customerId, email)`: `sdk.admin.customer.update(customerId, { email })`. 실패는 throw.
  다른 `has_account` 고객이 같은 이메일을 쓰면 Medusa 가 4xx 를 내고 inbox 가 `failed` 로 남긴다 — 이것이
  ④ 의 오귀속을 조용히 만드는 대신 사람 앞에 드러내는 지점이다.
- `withdrawCustomer(almondUserId): Promise<WithdrawOutcome>`: `sdk.client.fetch('/admin/customers/by-almond-user/{id}/withdraw', { method: 'POST' })`.
  4xx(429 제외)는 영구 실패로 로그 남기고 throw — `issuePromotionsByTrigger` 와 같은 규칙(⑥).

**`adapters/medusa/inbox-worker.service.ts`** — switch 에 `case 'UserUpdated'` · `case 'UserDeleted'` 둘.
`InboxWorker` 생성자에 새 서비스 주입, `adapter.module.ts` providers 에 등록.

### 4.3 Medusa

**라우트 `src/api/admin/customers/by-almond-user/[almondUserId]/withdraw/route.ts`**

```
POST /admin/customers/by-almond-user/:almondUserId/withdraw
→ 200 { customer: 'anonymized' | 'not_found', auth_identities_deleted: number }
→ 4xx: almondUserId 형식 불량(INVALID_DATA)
→ 500: 워크플로 실패 (inbox 가 재시도)
```

`/admin` 아래라 코어 미들웨어가 `MEDUSA_API_KEY` Basic 인증을 처리한다(`issue-coupons` 와 같음). 코어
`/admin/customers/:id` 와의 충돌은 이미 공존 중인 `by-almond-user` 세그먼트 아래에 두어 피한다. 라우트에는
입력 검증·응답 모양만 남고 판정·쓰기는 워크플로가 한다(ADR-0034 결정 3).

**워크플로 `src/workflows/customers/withdraw-customer.ts`** — 입력 `{ almondUserId }`.

| 단계 | 무엇 | 도구 | 보상 |
|---|---|---|---|
| ① | `metadata.almond_user_id = almondUserId` 인 **미삭제** 고객 조회(`fields: id, email, has_account, metadata, addresses.id`) | `useQueryGraphStep` | — |
| ② | 고객 있으면 주소 전부 하드 삭제 | `deleteCustomerAddressesWorkflow.runAsStep` | 코어 step |
| ③ | 익명화: `email = withdrawn_<token>@deleted.invalid`(token = userId 의 `-` 제거), `first_name='탈퇴회원'`, `last_name/phone/company_name = null`, `metadata = { ...기존, almond_user_id: null, withdrawn_at: ISO }` | `updateCustomersWorkflow.runAsStep` | 코어 step 이 이전 값 복원 |
| ④ | 소프트 삭제 | `deleteCustomersWorkflow.runAsStep` | 코어 step |
| ⑤ | auth identity id 수집 → `deleteAuthIdentities(ids)` | 커스텀 step | 없음 — 마지막 단계 |

⑤ 의 수집은 세 경로의 합집합이다: (a) `auth_identity` where `app_metadata.customer_id = customer.id`
(⑦ 의 코어 선례와 같은 remote query, 고객이 있을 때만), (b) `listProviderIdentities({ entity_id: almondUserId, provider: 'user-service-sso' })`
→ `auth_identity_id`, (c) `listProviderIdentities({ entity_id: 치환 전 이메일, provider: 'my-auth' })` → `auth_identity_id`
(레거시, 고객이 있을 때만). 비어 있어도 실패가 아니다.

`when(고객 있음)` 으로 ②③④ 를 감싸고 ⑤ 는 항상 돈다. 두 번째 호출은 ① 이 비고(③ 이 키를 지웠다) ⑤ 가
0 건 → `{ customer: 'not_found', auth_identities_deleted: 0 }`. ⑤ 가 실패하면 엔진이 ②③④ 의 보상을
역순으로 돌려 전부 되돌리므로 라우트는 500 을 내고 inbox 재시도는 처음부터 다시 한다. `failed` 로 남은
`UserDeleted` 행은 「아무것도 파기되지 않았다」를 뜻한다. 보상까지 실패한 이중 장애에서만 ③④ 만 남은
상태가 되고, 그때도 재시도가 ① 비고 → ⑤ 만 돌아 수렴한다.

④ 가 내는 `customer.deleted` 는 우리 subscriber 중 아무도 듣지 않는다(오늘 8개 중 customer 이벤트는
`customer.created` 하나). 플랜에서 grep 으로 재확인한다.

**삭제** — `src/subscribers/user.updated.ts` · `user.deleted.ts`. 같은 커밋에서 가드 B 의 `KNOWN_DEAD` 를
`{}` 로 비운다(⑭). 09-02 의 법적 근거 주석(하드 삭제 대신 익명화+소프트 삭제인 이유)은 워크플로 파일
머리로 옮긴다.

### 4.4 user-service — 백필 재발행

**`POST /users/internal/replay-withdrawn`** — `@Public()` + `@UseGuards(InternalApiKeyGuard)`, `internal/contacts`
바로 옆(⑪).

```
body     { dryRun: boolean, limit?: number (기본 200, 최대 1000), afterUserId?: string }
select   users WHERE deleted_at IS NOT NULL
               AND email LIKE 'withdrawn\_%@deleted.invalid'
               AND (afterUserId 없거나 id > afterUserId)
         ORDER BY id LIMIT limit
response { matched: number, published: number, lastUserId: string | null, failedUserId: string | null, userIds: string[] }
```

호출자는 사람(운영자)이다 — 배포 뒤 `Authorization: Bearer $USER_SERVICE_INTERNAL_KEY` 로 curl 한다. 크론도
서비스도 부르지 않는다. `dryRun=false` 면 행마다 `eventPublisher.publishEvent({ eventType: 'UserDeleted', aggregateId: id, payload: { userId: id } })`.
`softDeleteUser` 와 같은 발행 방식(⑩)이라 새 배선이 없다. 커서 페이징이라 여러 번 불러도 겹치지 않고,
겹쳐도 하류가 멱등하다(결정 3, membership 은 이미 해지된 계약을 건너뛴다).
발행이 하나 실패하면 거기서 멈추고 `published` 는 성공 건수, `lastUserId` 는 마지막 **성공** id, `failedUserId` 는 실패한 id 다 — 운영자는 `afterUserId = lastUserId` 로 이어서 부른다.

**선택 조건이 `deleted_at` 만이 아닌 이유**(⑩): 09-02 이전 `deleted_at` 은 휴면과 탈퇴가 공유했고
마이그레이션이 재분류하지 않았다. 치환 이메일은 탈퇴 익명화를 거쳤다는 유일한 증거다. 이 조건에 안
걸리는 03-02~09-02 탈퇴자는 남는다(결정 6).

### 4.5 계약

- `USER_STREAM` 계약 변경 없음. `UserUpdatedPayload.email` optional 그대로.
- inbox `eventType` 값은 Kafka 이벤트 타입과 같은 이름(`UserUpdated`/`UserDeleted`) — `Cafe24Linked` 와 같은
  관례.
- Medusa 라우트 응답 `customer: 'anonymized' | 'not_found'` 는 channel-adapter 가 effect 의 action 으로
  번역한다. 값이 늘면 양쪽 계약 변경이다.

## 5. 실패 처리

| 상황 | 처리 |
|---|---|
| 같은 Kafka 메시지 재수신 | `processed_events.idempotency_key = messageId` 로 스킵 |
| `UserUpdated` 에 email 없음 | processed 기록 후 반환. inbox 미적재 |
| `UserDeleted` 인데 Medusa 고객 없음 | 200 `not_found` → effect `SKIPPED`, 재시도 없음. 한 번도 로그인 안 한 회원 |
| `UserUpdated` 인데 고객 없음 | effect `SKIPPED`. 첫 로그인 때 현재 이메일로 생성됨(③) |
| 새 이메일을 다른 `has_account` 고객이 이미 씀 | Medusa 4xx → inbox `failed` + effect. 사람이 판정. 조용한 오귀속(④)보다 낫다 |
| 롤링 배포 중 옛 Medusa 태스크가 라우트 404 | 4xx 영구 규칙으로 `failed`. 배포 뒤 replay 한 번이 회수한다(멱등) |
| Medusa 5xx / 네트워크 | 지수 백오프 재시도 → 소진 시 `failed` (기존 규칙) |
| 워크플로 ③④ 뒤 ⑤ 실패 | 라우트 500 → 엔진이 ②③④ 보상(복원) → inbox 재시도가 처음부터. failed 행 = 아무것도 파기되지 않은 상태. 보상까지 실패한 이중 장애만 ③④ 만 남고, 재시도가 ⑤ 만 돌아 수렴 |
| `softDeleteUser` 의 `publishEvent` 가 트랜잭션 안에서 실패 | user-service 탈퇴 자체가 실패로 돌아간다(fail-closed, 기존 동작). 바꾸지 않는다 |

## 6. 테스트

- **channel-adapter (루트 jest)**: `user-event.consumer.spec.ts` — email 없는 `UserUpdated` 는 inbox 0행,
  같은 messageId 두 번은 1행, 네 핸들러가 헬퍼를 지나 같은 행 모양. `customer-lifecycle-medusa-sync.service.spec.ts`
  — outcome 별 effect·action, 어떤 경로도 `SlowRetryInboxError` 를 던지지 않음(`expect(...).rejects.not.toBeInstanceOf`).
  `medusa.client.spec.ts` — `withdrawCustomer` 의 404/409 는 throw, 200 은 outcome 반환.
- **Medusa 통합 (`scripts/local/run-medusa-integration.sh`, postgres+redis)**: 주소 2행·`user-service-sso`
  provider identity·`app_metadata.customer_id` 링크를 가진 고객 → 라우트 호출 → 필드 치환·`deleted_at` 설정·
  주소 0행·auth identity 0행 → 두 번째 호출 200 `not_found`/0 → 같은 이메일로 새 고객 생성이 유일 제약에
  안 걸림. 가드 B 는 `KNOWN_DEAD` 비운 채 초록.
- **user-service (`npm run test:user-service`)**: replay 선택 조건 — `dormant_at` 만 있는 행·치환 이메일
  없는 `deleted_at` 행은 제외, `dryRun` 은 publish 0회, 커서로 두 페이지가 겹치지 않음.
- **로컬 E2E**: `npm run start:all:local` → storefront 로그인·주소 등록 → 탈퇴 → Medusa admin 고객 화면에서
  익명화·주소 없음 확인 → inbox 행 `published`.

## 7. 문서·이슈·배포

- `CONTEXT.md` 「판매 채널」 절에 한 줄: 회원 생애주기(이메일 변경·탈퇴)의 Medusa 반영은 channel-adapter
  inbox 를 지나며 Medusa 는 Kafka 를 듣지 않는다. ADR 은 새로 쓰지 않는다.
- #786 에 결정 8건과 §2 사실을 남기고 PR 로 닫는다. ADR-0035 의 「후속 이슈」 문구는 그대로 둔다(이슈
  번호가 가리키는 대상이 닫힐 뿐이다).
- **배포**: ① `sst deploy` lcnine-services(channel-adapter + Medusa) ② `sst deploy` lcnine-auth(user-service)
  ③ `replay-withdrawn { dryRun: true }` 로 건수·id 확인 ④ `dryRun: false` 를 커서로 끝까지 ⑤ channel-adapter
  inbox 에서 `UserDeleted` 행이 전부 `published` 인지, `failed` 가 0인지 확인.
  `SELECT count(*) FROM inbox_events WHERE event_type IN ('UserUpdated','UserDeleted') AND status='failed';`
  가 0 이 아니면 ③④ replay 를 한 번 더 — 롤링 창의 404 는 백오프 5회(약 1분) 뒤 failed 로 굳는다.
  마이그레이션 0 · 시크릿 0 ·
  env 0(`USER_SERVICE_INTERNAL_KEY`·`MEDUSA_API_KEY` 는 이미 있다). 소비자 그룹이 이미 이 토픽을 구독
  중이라 과거 오프셋은 다시 읽지 않는다 — 과거는 replay 가 맡는다.
- 배포 후 **남는 것 한 줄을 #786 에 적는다**: 03-02~09-02 탈퇴자는 사람이 판정한 목록으로 같은
  엔드포인트(`userIds` 를 받는 변형이 필요하면 그때 더한다)를 통해 처리한다.

## 8. 하지 않는 것

- 이름·전화 동기화(결정 7).
- `UserPermanentDeleted` 처리 — 그 시점엔 이미 익명화돼 있다.
- 03-02~09-02 탈퇴자 판정 목록 작성(결정 6).
- `softDeleteUser` 의 `publishEvent` 를 outbox `enqueue` 로 바꾸기 — 트랜잭션 마지막 문장이라 위험이
  작고 user-service 의 결정이다.
- 새 Prometheus 메트릭(결정 8).
- `membership-medusa-sync` 의 email fallback 수정 — 이메일이 동기화되면 그 분기에 들어가지 않는다.
  fallback 자체의 오귀속 위험은 별개 논의.

## 9. 기각한 대안

| 대안 | 왜 기각 |
|---|---|
| 이슈 선택지 2 — user-service 가 Medusa 내부 라우트를 직접 호출 | 결정 1. 명령 전송·역방향 의존·inbox 보장 상실·새 시크릿 |
| Medusa 에 Kafka 소비자 복원 | ①. 두 번 걷어낸 설계를 세 번째로 되돌리는 것 |
| channel-adapter 가 코어 admin API 를 조합해 익명화(B) | 규칙이 어댑터로 새고, auth identity(⑧)를 못 지우며, 두 호출 사이 부분 실패에 보상이 없다 |
| 고객 행은 B, identity 만 Medusa 라우트(C) | 규칙이 두 곳에 갈라진다 |
| 코어 `removeCustomerAccountWorkflow` 재사용 | 익명화가 없고 identity 없으면 throw(⑦). 조합 대상은 그 안의 step 들이다 |
| `UserDeleted` 고객 없음에 `SlowRetryInboxError` | 탈퇴자는 로그인하지 않는다. 하루 헛돈다 |
| 익명화 때 `almond_user_id` 를 `withdrawn_almond_user_id` 로 옮겨 재조회 키로 쓰기 | 라우트 키를 userId 로 두면(결정 3) 필요 없다. metadata 키를 늘리지 않는다 |
| 백필을 Medusa 쪽에서 훑기(고객 전체 → user-service 생존 조회) | 새 조회 API 와 「미확인=탈퇴」 판정 규칙이 필요하고 오판이 곧 익명화다 |
| 백필을 `deleted_at IS NOT NULL` 전체로 | ⑩. 휴면 회원을 탈퇴로 재발행해 구독 해지·익명화가 일어난다 |
