# K8 PR 2 — 기본 반품·교환·클레임 쓰기 라우트를 막고, 반품 배송 옵션·사유를 보장한다 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Medusa 기본 반품·교환·클레임·반품 사유 **쓰기** 라우트를 전부 거절하고, 그 뒤에 우리 워크플로(PR 3·6)가 쓸 반품 배송 옵션 1개와 반품 사유 6종을 부팅 시드로 보장하며, `almond` provider 가 반품 fulfillment 를 만들 수 있게 한다.

**Architecture:** 세 갈래, 전부 `apps/medusa`. ① method 없이 등록한 앞부분 일치 미들웨어 하나가 `/store/returns`·`/admin/returns`·`/admin/exchanges`·`/admin/claims`·`/admin/return-reasons` 아래의 GET·HEAD·OPTIONS 아닌 요청을 400 으로 끊는다. ② 반품 배송 옵션은 배송비 그룹과 섞이지 않게 **전용 shipping profile** 에 하나 두고(`flat` 0원, `almond` provider, `is_return=true`), provider 에 `createReturnFulfillment` 를 넣는다. ③ 반품 사유 표는 코드가 정본이고, 부팅마다 도는 `seed-shipping.ts` 가 옵션과 사유를 함께 보장한다.

**Tech Stack:** Medusa 2.13.4(express 4.21.2), Jest(unit + `@medusajs/test-utils` HTTP 통합).

**Spec:** `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md` — §4.2(«기본 라우트는 막고», «반품용 배송 옵션과 provider», «반품 사유 시드»), §7(미들웨어가 시드보다 먼저), §8 PR 2. 결정 D1·D6.

## 코드에서 확인한 것 (develop `442f598fc`)

- **기본 `POST /store/returns` 는 «아무 배송 옵션 id» 나 받는다.** 검증기는 `return_shipping.option_id: z.string()` 뿐이고(`@medusajs/medusa/dist/api/store/returns/validators.js:16,28`), 인증 미들웨어도 없다. 지금 라이브에서 막혀 있는 건 **우연**이다 — 라이브 옵션이 전부 `almond` provider 라 `confirmReturnRequest`/`createAndCompleteReturnOrder` 가 부르는 `createReturnFulfillment` 가 기본 클래스에서 던진다(`utils/dist/fulfillment/provider.js:338-340`). **Task 2 가 provider 에 구현을 넣는 순간 이 구멍이 열린다** — 그래서 Task 1(미들웨어)과 같은 배포여야 한다.
- 반품 fulfillment 는 반품 배송 방법이 있을 때만 만들어지고, 그 옵션의 `provider_id` 와 `service_zone.fulfillment_set.location` 을 쓴다(`core-flows/dist/order/workflows/return/confirm-return-request.js:67-75,185-202`).
- `createReturnShippingMethodWorkflow` 는 옵션의 shipping profile 도 `is_return` 규칙도 검사하지 않는다(`create-return-shipping-method.js` — 취소 여부·열린 주문 변경만). 그래서 반품 옵션을 **그룹 profile 밖**에 둬도 된다.
- 미들웨어 등록(`framework/dist/http/router.js:188-222`): `method` 를 주면 `app.post(matcher)` — express 4 경로 일치라 `'/admin/returns/*'` 는 `/admin/returns` 자체를 놓친다. `method` 를 안 주면 `app.use(matcher)` — 세그먼트 경계 앞부분 일치(`/admin/returns`, `/admin/returns/x/y`, 그러나 `/admin/returnsx` 는 아님). `matcher` 는 `String()` 으로 바뀌므로 정규식은 못 쓴다(`middleware-file-loader.js:129`). 정렬은 가지마다 `global → wildcard → …`(`routes-sorter.js`) — method 없는 미들웨어가 코어 본문 검증보다 먼저 돈다.
- 막을 코어 쓰기 라우트(2.13.4 실측): 반품 15 파일·교환 12·클레임 14·반품 사유 2(`@medusajs/medusa/dist/api/admin/{returns,exchanges,claims,return-reasons}`), store 는 `POST /store/returns` 하나. 주문 쪽에 반품을 여는 다른 쓰기 라우트는 없다(`/admin/order-changes/:id` POST 는 `carry_over_promotions` 만 바꾼다). **우리 코드(admin-web·channel-adapter·storefront·medusa)에서 이 라우트를 부르는 곳 0.**
- `provisionShippingGroup` 은 그 그룹 profile 의 다른 옵션을 지운다(`provision-shipping-group.ts:187-196`). `listShippingGroups` 는 `data.shippingGroupCode`·`policy`·`shippingProfileId` 가 없는 옵션을 건너뛴다(`:281`). `findOrCreateShippingProfile` 은 `type: 'default'` 와 `type: 'shipping'`+`metadata.shippingGroupCode` 만 본다. channel-adapter 는 `type: 'default'` profile 만 읽는다(`medusa.client.ts:1077`).
- `seed-shipping.ts` 는 기본 그룹이 있으면 **곧장 return** 한다(:31-35). 컨테이너는 부팅마다 `start` = `seed.ts && seed-shipping.ts && medusa start` 를 돈다(`package.json:34`, Dockerfile CMD).
- order 모듈 서비스에 `listReturnReasons`·`createReturnReasons`·`updateReturnReasons` 가 있다. `return_reason.value` 인덱스는 unique 가 아니다.
- core 의 옛 사유 6종: `defective`·`not_as_described`·`change_of_mind`·`wrong_item`·`damaged_in_shipping`·`other`(`inventory.schema.ts:5157`).
- PR 1 픽스처에 `createReturnShippingOption`(manual provider, flat 0원)·`requestReturnWithShipping` 이 있다(`integration-tests/http/fixtures/partial-cancel-fixture.ts:221-258`).

## 이름 붙은 결정

- **N1. 반품 옵션은 전용 shipping profile 하나에 하나만 둔다** — profile `{ name: '반품', type: 'return' }`, 옵션 데이터 `{ purpose: 'return' }`. 설계 §4.2 는 «`provisionShippingGroup` 안에서 그룹 옵션과 함께 보장»이라 했지만, 그건 «그룹을 고칠 때 지워지지 않게»가 목적이었다. 그룹 profile 밖에 두면 지워질 길 자체가 없고, `listShippingGroups`·카트 profile 검증·channel-adapter 매핑 어디에도 안 섞인다. 반품 택배비는 옵션이 아니라 주문 시점 `policySnapshot` 으로 계산하므로(§4.4) 그룹마다 옵션이 있을 이유가 없다. Task 2 가 설계 §4.2 의 그 줄을 고친다.
- **N2. 라우트를 하나씩 적지 않고 앞부분 일치로 막는다.** Medusa 업그레이드가 반품 아래에 쓰기 라우트를 더해도 같이 막힌다. 읽기(GET·HEAD·OPTIONS)는 지난다 — 대시보드·우리 화면이 반품 목록을 읽을 수 있게.
- **N3. ⛔ `/admin/return-reasons` 쓰기도 막는다(사용자 확인).** 설계는 반품·교환·클레임만 적었다. 사유의 `metadata.feeBearer` 가 택배비를 누가 내는지 정하는 돈 규칙이라(D4), 대시보드에서 고치면 다음 부팅 전까지 정산이 바뀐다. 사유를 더하거나 고치는 길은 코드(N4)뿐이 된다.
- **N4. 사유 표는 코드가 정본이다.** 부팅마다 6종의 `label`·`metadata` 를 코드 값으로 덮어쓴다(없으면 만든다). 코드 밖에서 생긴 다른 사유 행은 건드리지 않는다.
- **N5. 응답은 기존 기본 취소 차단과 같은 모양** — 400 `{ type: 'not_allowed', code: 'default_return_route_blocked', message }`(`reject-default-cancel-with-refundable.ts` 와 같은 형식).

## Global Constraints

- 사는 곳은 `apps/medusa` 하나. 마이그레이션 없음, 이벤트 계약 변경 없음, core·channel-adapter 변경 없음.
- **Task 1·2·3 은 한 배포로 나간다** — provider 구현(Task 2)만 미들웨어(Task 1) 없이 나가면 `POST /store/returns` 가 그룹 옵션 id 로 반품을 만든다. 롤링 배포 중 옛 태스크는 provider 구현이 없어 여전히 던지므로, 한 배포 안에서는 열리는 틈이 없다.
- Medusa 확장 규칙(CLAUDE.md «Medusa»): 코어 라우트 override 금지(미들웨어로만 막는다), 워크플로 훅 등록 없음.
- 반품 옵션 이름 `'반품 회수'`, type `{ label: '반품 회수', description: '고객 반품 회수', code: 'return' }`, 가격 `[{ currency_code: 'krw', amount: 0 }]`, 규칙 `enabled_in_store = 'false'`·`is_return = 'true'`.
- 사유 6종(value · label · `metadata.feeBearer` · `metadata.customerSelectable`):
  `change_of_mind` 단순 변심 · `customer` · true / `defective` 상품 하자 · `seller` · true / `not_as_described` 상품 설명과 다름 · `seller` · true /
  `wrong_item` 오배송 · `seller` · true / `damaged_in_shipping` 배송 중 파손 · `seller` · true / `other` 기타 · `operator` · false.
- 통합 테스트는 `scripts/local/run-medusa-integration.sh --testPathPattern '<패턴>'` 로만 돈다(postgres·redis 둘 다 떠 있어야 한다).
- 게이트: `(cd apps/medusa && npm run test:unit)`, 통합 래퍼, `(cd apps/medusa && npx tsc --noEmit -p tsconfig.json)` 에서 이 PR 이 만진 파일의 에러 0.

## Review Focus

- **인증 없는 `POST /store/returns`** — 고객 토큰 없이 와도, 남의 주문이어도 반품 행이 생기지 않는다. Task 1 테스트(인증 헤더 없이 publishable key 만).
- **`/admin/returns` 루트와 깊은 하위 경로를 둘 다** — `POST /admin/returns`, `POST /admin/returns/:id/receive/confirm`, `DELETE /admin/returns/:id/request-items/:action_id` 가 모두 막힌다(express `*` 함정). Task 1 테스트.
- **우리 in-process 워크플로는 막히지 않는다** — 미들웨어는 HTTP 만 끊는다. 시드된 옵션으로 `requestReturnWithShipping` 이 성공하고 반품 fulfillment 가 `almond_almond` 로 생긴다. Task 2 테스트.
- **그룹을 새로 만들거나 고쳐도 반품 옵션이 남는다** — 기본 그룹 갱신·새 그룹 생성 뒤에도 옵션이 그대로이고, `listShippingGroups` 에 안 나온다. Task 2 테스트.
- **부팅이 겹친다(ECS 두 태스크)** — 시드가 동시에 돌아 옵션이 두 개 생겨도 `findReturnShippingOptionId` 가 늘 같은(가장 오래된) 하나를 고른다. Task 2 테스트(옵션 두 개를 직접 만들어 확인).

---

### Task 1: 기본 반품·교환·클레임·사유 쓰기 라우트를 거절한다

**Files:**
- Create: `apps/medusa/src/api/reject-default-return-writes.ts`
- Modify: `apps/medusa/src/api/middlewares.ts` (routes 배열, `...adminRouteMiddlewares` 바로 뒤)
- Test: `apps/medusa/integration-tests/http/default-return-routes-blocked.spec.ts`

**Interfaces:**
- Produces:
  - `export const DEFAULT_RETURN_ROUTE_BLOCKED_CODE = 'default_return_route_blocked'`
  - `export const DEFAULT_RETURN_WRITE_PREFIXES = ['/store/returns', '/admin/returns', '/admin/exchanges', '/admin/claims', '/admin/return-reasons'] as const`
  - `export function rejectDefaultReturnWrites(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): void` — `req.method` 가 `GET`·`HEAD`·`OPTIONS` 면 `next()`, 아니면 N5 응답.
  - `export const defaultReturnWriteMiddlewares: MiddlewareRoute[]` — prefix 마다 `{ matcher: prefix, middlewares: [rejectDefaultReturnWrites] }`. **`method`/`methods` 를 주지 않는다**(주면 정확 일치로 등록된다). 왜 그런지 한 줄 주석으로 남긴다.
- Consumes: 픽스처 `setupCommerce`·`placeOrder`·`createReturnShippingOption`·`FakeWallet`(`partial-cancel-fixture.ts`).

- [ ] **Step 1: 실패하는 통합 테스트를 쓴다** — `medusaIntegrationTestRunner({ inApp: true, env: { WALLET_BASE_URL, WALLET_API_KEY }, ... })`, `beforeAll` 에서 `setupCommerce`, 주문 하나(`placeOrder`, 변형 A 1개)와 `createReturnShippingOption(container, c.groups.cond.shippingProfileId)`(manual provider — 미들웨어가 없으면 이 요청이 **실제로 반품을 만든다**는 점이 이 테스트의 근거다).

```ts
it('POST /store/returns — 인증 없이 실제 주문·실제 반품 옵션으로 와도 막고, 반품 행이 생기지 않는다', async () => {
  const res = await api.post('/store/returns', {
    order_id: orderId, items: [{ id: itemId, quantity: 1 }], return_shipping: { option_id: returnOptionId },
  }, c.storeHeaders).catch((e: any) => e.response);
  expect(res.status).toBe(400);
  expect(res.data.code).toBe('default_return_route_blocked');
  const returns = await getContainer().resolve(Modules.ORDER).listReturns({ order_id: orderId });
  expect(returns).toHaveLength(0);
});

it.each([
  ['post', '/admin/returns'],
  ['post', '/admin/returns/ret_x/request-items'],
  ['post', '/admin/returns/ret_x/receive/confirm'],
  ['delete', '/admin/returns/ret_x/request-items/act_x'],
  ['post', '/admin/exchanges'],
  ['post', '/admin/exchanges/exc_x/outbound/items'],
  ['post', '/admin/claims'],
  ['delete', '/admin/claims/clm_x/request'],
  ['post', '/admin/return-reasons'],
  ['delete', '/admin/return-reasons/rr_x'],
])('%s %s — 관리자 토큰이 있어도 막는다', async (method, path) => {
  const res = await (method === 'post' ? api.post(path, {}, c.adminHeaders) : api.delete(path, c.adminHeaders)).catch((e: any) => e.response);
  expect(res.status).toBe(400);
  expect(res.data.code).toBe('default_return_route_blocked');
});

it.each(['/admin/returns', '/admin/exchanges', '/admin/claims', '/admin/return-reasons'])('GET %s — 읽기는 지난다', async (path) => {
  const res = await api.get(path, c.adminHeaders);
  expect(res.status).toBe(200);
});

it('이름이 비슷한 다른 경로는 막지 않는다 — /admin/orders/:id 읽기', async () => {
  expect((await api.get(`/admin/orders/${orderId}`, c.adminHeaders)).status).toBe(200);
});
```

- [ ] **Step 2: 돌려서 실패를 본다**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'default-return-routes-blocked'`
Expected: 쓰기 케이스 FAIL(코어 라우트가 200 또는 400 `invalid_data`·404 를 돌려준다, `code` 불일치). 첫 케이스는 반품 행 1개로 FAIL. GET 케이스 PASS.

- [ ] **Step 3: `reject-default-return-writes.ts` 를 만들고 `middlewares.ts` 에 `...defaultReturnWriteMiddlewares` 를 펼친다** — 파일 머리 주석에 «왜»를 남긴다: 인증·소유 확인 없음, 반품비를 클라이언트가 정함, 대시보드로 받으면 우리 정산을 우회(설계 §2 반목표·§4.2), 사유 metadata 는 돈 규칙(N3). 우리 워크플로는 HTTP 를 지나지 않아 영향 없음.

- [ ] **Step 4: 다시 돌려 전부 통과를 본다**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'default-return-routes-blocked|partial-cancel'`
Expected: 전부 PASS(부분취소 스펙은 in-process 반품 픽스처를 쓰므로 회귀 확인용).

- [ ] **Step 5: Commit**

```bash
git add apps/medusa/src/api/reject-default-return-writes.ts apps/medusa/src/api/middlewares.ts apps/medusa/integration-tests/http/default-return-routes-blocked.spec.ts
git commit -m "K8 PR2 — Medusa 기본 반품·교환·클레임·사유 쓰기 라우트를 막는다(인증 없는 /store/returns, 대시보드 우회)"
```

### Task 2: 반품 배송 옵션을 전용 profile 에 보장하고, almond 가 반품 fulfillment 를 만든다

**Files:**
- Modify: `apps/medusa/src/modules/almond-fulfillment/service.ts` (`createFulfillment` 곁)
- Create: `apps/medusa/src/modules/almond-fulfillment/return-shipping-option.ts`
- Test: `apps/medusa/src/modules/almond-fulfillment/__tests__/create-return-fulfillment.unit.spec.ts`
- Test: `apps/medusa/integration-tests/http/return-setup.spec.ts`
- Modify: `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md` §4.2 «반품용 배송 옵션과 provider» 둘째 줄 — N1 로 고친다(«전용 profile 에 하나, 그룹 profile 밖이라 `provisionShippingGroup` 이 지울 길이 없다»).

**Interfaces:**
- Consumes: `ensureKoreanShippingInfrastructure(container): Promise<{ serviceZoneId, ... }>`, `ALMOND_FULFILLMENT_PROVIDER_ID`(`provision-shipping-group.ts`).
- Produces:
  - `AlmondFulfillmentProviderService.createReturnFulfillment(): Promise<CreateFulfillmentResult>` → `{ data: {}, labels: [] }`. 주석: 회수 접수는 core 가 한진에 한다(설계 §4.2).
  - `export const RETURN_SHIPPING_PROFILE_TYPE = 'return'`, `export const RETURN_SHIPPING_OPTION_PURPOSE = 'return'`
  - `export async function ensureReturnShippingOption(container: MedusaContainer): Promise<string>` — profile(type `'return'`) 찾거나 만들고, 그 profile 에서 `findReturnShippingOptionId` 가 없으면 Global Constraints 의 값으로 `createShippingOptionsWorkflow` 를 돌린다. 있으면 손대지 않는다. 옵션 id 를 돌려준다.
  - `export async function findReturnShippingOptionId(container: MedusaContainer): Promise<string | null>` — type `'return'` profile 의 옵션 중 `data.purpose === 'return'` 인 것을 `created_at`·`id` 오름차순으로 첫째. PR 3 의 요청 워크플로가 이걸로 옵션을 고르고, `null` 이면 거절한다.

- [ ] **Step 1: 실패하는 단위 테스트** — `new AlmondFulfillmentProviderService({} as any).createReturnFulfillment({} as any)` 가 `{ data: {}, labels: [] }` 로 resolve.

- [ ] **Step 2: 실패하는 통합 테스트** — `return-setup.spec.ts`(`setupCommerce` 로 세 그룹이 있는 상태):
  - `ensureReturnShippingOption 은 두 번 불러도 옵션 하나, 같은 id` — 두 호출 id 같음, type `'return'` profile 의 옵션 1개, 그 옵션 `provider_id === 'almond_almond'`, `price_type === 'flat'`, 규칙에 `is_return eq 'true'`·`enabled_in_store eq 'false'`.
  - `listShippingGroups 에 반품 옵션이 안 나온다` — 결과 `shippingOptionId` 집합에 반품 옵션 id 없음, 길이는 시드 전과 같음.
  - `그룹을 새로 만들고 기본 그룹을 고쳐도 반품 옵션이 남는다` — `provisionShippingGroup` 으로 새 그룹 생성 + 기본 그룹 정책 변경 뒤 `findReturnShippingOptionId` 가 같은 id.
  - `시드된 옵션으로 반품 요청을 확정하면 almond 반품 fulfillment 가 생긴다` — `placeOrder` → `requestReturnWithShipping({ returnOptionId: 시드 id, shippingAmount: 0 })` 성공, `query.graph({ entity: 'return', fields: ['id','status','fulfillments.provider_id'] })` 의 status `'requested'`, fulfillment `provider_id === 'almond_almond'`. 그 주문의 결제 컬렉션 중 `status === 'not_paid'` 0개.
  - `옵션이 둘이어도 가장 오래된 하나를 고른다` — 같은 profile 에 같은 data 로 옵션을 하나 더 만든 뒤 `findReturnShippingOptionId` 가 처음 id.
  - `카트 배송 옵션에 반품 옵션이 안 나온다` — `listShippingOptionsForCartWorkflow` 로 카트 하나의 옵션을 뽑아 반품 옵션 id 없음.

- [ ] **Step 3: 돌려서 실패를 본다**

Run: `(cd apps/medusa && npx jest --testPathPattern create-return-fulfillment) ; scripts/local/run-medusa-integration.sh --testPathPattern 'return-setup'`
Expected: 단위는 기본 클래스의 «not implemented» 예외로 FAIL, 통합은 `ensureReturnShippingOption` import 실패로 FAIL.

- [ ] **Step 4: `createReturnFulfillment` 와 `return-shipping-option.ts` 를 구현한다** — profile 은 `fulfillmentModuleService.listShippingProfiles({ type: 'return' })` / `createShippingProfiles({ name: '반품', type: 'return' })`. 옵션은 `flat` 이라 `calculatePrice` 경로를 타지 않는다(정책 없는 옵션에서 던지는 `readOptionData` 를 피하는 방법). 파일 머리 주석에 N1 근거.

- [ ] **Step 5: 다시 돌려 통과를 본다**

Run: `(cd apps/medusa && npm run test:unit) && scripts/local/run-medusa-integration.sh --testPathPattern 'return-setup|default-return-routes-blocked|partial-cancel'`
Expected: 전부 PASS.

- [ ] **Step 6: 설계 §4.2 를 N1 로 고치고 Commit**

```bash
git add apps/medusa/src/modules/almond-fulfillment apps/medusa/integration-tests/http/return-setup.spec.ts docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md
git commit -m "K8 PR2 — 반품 배송 옵션을 전용 profile 에 보장하고 almond provider 가 반품 fulfillment 를 만든다"
```

### Task 3: 반품 사유 6종을 코드 정본으로 보장하고, 부팅 시드가 옵션·사유를 같이 보장한다

**Files:**
- Create: `apps/medusa/src/workflows/orders/returns/return-reasons.ts`
- Modify: `apps/medusa/src/scripts/seed-shipping.ts` (:31-35 의 early return 을 걷는다)
- Test: `apps/medusa/src/workflows/orders/returns/__tests__/return-reasons.unit.spec.ts`
- Test: `apps/medusa/integration-tests/http/return-setup.spec.ts` (케이스 추가)

**Interfaces:**
- Produces:
  - `export type ReturnFeeBearer = 'customer' | 'seller' | 'operator'` — `operator` 는 CS 가 접수할 때 고른다(설계 §4.2). 부분취소의 `ShippingFeeBearer`(`'customer' | 'seller'`)와 일부러 따로 둔다 — 취소에는 «CS 가 고른다»가 없다.
  - `export const RETURN_REASON_FEE_BEARER_KEY = 'feeBearer'`, `export const RETURN_REASON_CUSTOMER_SELECTABLE_KEY = 'customerSelectable'`
  - `export const RETURN_REASONS: ReadonlyArray<{ value: string; label: string; feeBearer: ReturnFeeBearer; customerSelectable: boolean }>` — Global Constraints 의 6행 그대로.
  - `export function readReturnFeeBearer(reason: { metadata?: Record<string, unknown> | null } | null | undefined): ReturnFeeBearer | null` — 값이 셋 중 하나가 아니면 `null`(PR 6 정산이 `null` 이면 멈춘다).
  - `export async function ensureReturnReasons(container: MedusaContainer): Promise<void>` — `listReturnReasons({ value: RETURN_REASONS.map(r => r.value) })`, 없는 것은 `createReturnReasons`, `label`·두 metadata 키가 다른 것은 `updateReturnReasons`(N4). metadata 의 다른 키는 보존한다.
- Consumes: `ensureReturnShippingOption`(Task 2), `listShippingGroups`·`provisionShippingGroup`(기존).

- [ ] **Step 1: 실패하는 단위 테스트**

```ts
it('사유 6종, value 는 core 옛 return_reason_code 와 같은 집합', () => {
  expect(RETURN_REASONS.map((r) => r.value).sort()).toEqual(
    ['change_of_mind', 'damaged_in_shipping', 'defective', 'not_as_described', 'other', 'wrong_item']);
});
it('단순 변심만 customer, 기타는 operator·고객 선택 불가, 나머지는 seller', () => {
  const by = Object.fromEntries(RETURN_REASONS.map((r) => [r.value, r]));
  expect(by.change_of_mind.feeBearer).toBe('customer');
  expect(by.other).toMatchObject({ feeBearer: 'operator', customerSelectable: false });
  for (const v of ['defective', 'not_as_described', 'wrong_item', 'damaged_in_shipping']) expect(by[v]).toMatchObject({ feeBearer: 'seller', customerSelectable: true });
});
it('readReturnFeeBearer — 모르는 값·없는 metadata 는 null', () => {
  expect(readReturnFeeBearer({ metadata: { feeBearer: 'seller' } })).toBe('seller');
  expect(readReturnFeeBearer({ metadata: { feeBearer: 'nobody' } })).toBeNull();
  expect(readReturnFeeBearer({ metadata: null })).toBeNull();
  expect(readReturnFeeBearer(undefined)).toBeNull();
});
```

- [ ] **Step 2: 실패하는 통합 케이스를 `return-setup.spec.ts` 에 더한다**
  - `ensureReturnReasons 두 번 — 6행, 중복 없음, metadata 가 표와 같다`.
  - `누가 label·feeBearer 를 바꿔도 다음 보장이 되돌리고, metadata 의 다른 키는 남긴다` — `updateReturnReasons` 로 `change_of_mind` 를 `{ label: 'x', metadata: { feeBearer: 'seller', note: 'keep' } }` 로 바꾼 뒤 `ensureReturnReasons` → label `단순 변심`, `feeBearer 'customer'`, `note 'keep'`.
  - `seed-shipping 은 기본 그룹이 이미 있어도 반품 옵션과 사유를 보장한다` — `setupCommerce` 뒤(기본 그룹 존재) `seedShipping({ container } as any)` 두 번 → 반품 옵션 1개, 사유 6행, 기본 그룹 정책은 바뀌지 않음.

- [ ] **Step 3: 돌려서 실패를 본다**

Run: `(cd apps/medusa && npx jest --testPathPattern return-reasons) ; scripts/local/run-medusa-integration.sh --testPathPattern 'return-setup'`
Expected: import 실패로 FAIL.

- [ ] **Step 4: `return-reasons.ts` 를 구현하고 `seed-shipping.ts` 를 고친다** — 기본 그룹은 «없을 때만 만든다» 그대로 두고(정책 덮어쓰기 금지 주석 유지), 그 뒤에 늘 `ensureReturnShippingOption` → `ensureReturnReasons` 를 부른다. 파일 머리 주석의 «기본 배송비 그룹만 보장한다»를 고친다. 새 `medusa exec` 를 `start` 에 더하지 않는다 — 부팅마다 앱을 한 번 더 띄우는 비용이라 이미 도는 시드에 싣는다.

- [ ] **Step 5: 다시 돌려 통과를 본다**

Run: `(cd apps/medusa && npm run test:unit) && scripts/local/run-medusa-integration.sh --testPathPattern 'return-setup|default-return-routes-blocked|partial-cancel'`
Expected: 전부 PASS.

- [ ] **Step 6: 타입 검사** — Run: `(cd apps/medusa && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'reject-default-return|return-shipping-option|return-reasons|seed-shipping|almond-fulfillment/service|return-setup|default-return-routes')`
Expected: 출력 없음.

- [ ] **Step 7: Commit**

```bash
git add apps/medusa/src/workflows/orders/returns apps/medusa/src/scripts/seed-shipping.ts apps/medusa/integration-tests/http/return-setup.spec.ts
git commit -m "K8 PR2 — 반품 사유 6종을 코드 정본으로 보장하고, 부팅 시드가 반품 옵션·사유를 함께 보장한다"
```

---

## 배포 노트 (PR 본문에 옮긴다)

- Medusa 만, 마이그 없음. **한 배포로.** 이 PR 만으로는 고객·CS 에게 보이는 변화가 없다 — 반품을 여는 우리 라우트는 PR 3, 개통은 core 출고 개통 뒤(D9).
- 배포 뒤 라이브 확인 셋: ① `POST /store/returns` 가 400 `default_return_route_blocked`(빈 본문으로 충분), ② `GET /admin/shipping-options` 에 `반품 회수` 1개(profile type `return`), ③ `GET /admin/return-reasons` 에 6행.
- 롤백: 이전 task definition 으로 돌려도 안전하다 — 옛 코드는 반품 profile·옵션·사유 행을 무시하고, almond 의 `createReturnFulfillment` 가 다시 던져 `/store/returns` 는 우연히 닫힌 상태로 돌아간다.
