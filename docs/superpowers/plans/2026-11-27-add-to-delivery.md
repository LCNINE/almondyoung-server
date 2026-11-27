# 함께 배송(Add to Delivery) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 출고 전 자사몰 주문에 상품을 더 사면 배송비 없이 같은 상자로 보내고, 부모만 취소하면 면제 배송비를 부모 환불에서 뺀다.

**Architecture:** 판정·0원 배송비·결제 재판정·환불 차감은 전부 Medusa 안에 둔다. Core 는 "이 주문들 중 고객이 아직 직접 취소할 수 있는 것"만 답하는 내부 라우트 하나를 더한다(`selfCancelBlock` 재사용). 부모 연결은 Medusa 카트→주문 metadata(`add_to_delivery_parent_order_id`)로만 들고, 면제 배송비는 추가 주문 배송 방식의 `policySnapshot` 으로 다시 계산한다. 결제수단 제한은 wallet intent metadata 표시로 wallet-web 이 거른다.

**Tech Stack:** NestJS(core, class-validator, Drizzle) · Medusa v2(workflows, hooks, query.graph, jest swc) · Next.js storefront(next-intl, shadcn, vitest) · wallet-web(Next.js)

**Spec:** `docs/superpowers/specs/2026-11-27-add-to-delivery-design.md`

## Global Constraints

- 브랜치 `feat/add-to-delivery`. 태스크마다 커밋 후 `git push origin feat/add-to-delivery`. 커밋·PR 에 Claude 공동저자 줄을 달지 않는다.
- 커밋 메시지 형식: `[medusa] …`, `[core] …`, `[storefront] …`, `[wallet-web] …`, `[ops] …` 처럼 앱 접두어 + 한국어 한 문장.
- 코드·주석·문구에 «» 「」 『』 를 쓰지 않는다. 주석에 이슈 번호를 달지 않는다. 설명 주석은 로직 흐름 한 줄만.
- 논리 단위 사이 빈 줄, `return` 앞 빈 줄, 한 줄 for-if 금지.
- Medusa 워크플로 훅은 워크플로당 하나. `complete-cart.ts` 의 기존 validate 핸들러 안에 함수를 더한다. 쿠폰 소진(`consumed`)은 핸들러의 마지막 문장으로 남긴다.
- 메타데이터 키: 카트·주문 `metadata.add_to_delivery_parent_order_id` (부모 Medusa order id), 카트 `metadata.cart_kind = 'add_to_delivery'`. intent metadata `instantOnly: true`.
- 고객 문구(정본):
  - 결제 재판정 거절: "함께 받을 주문이 방금 출고됐어요. 배송비를 포함해 다시 결제해 주세요."
  - 평소: "위 주문과 함께 배송돼요." / "배송비 {amount}원이 면제됐어요."
  - 상단 안내: "주문 {n}건이 상자 하나로 배송돼요."
  - 부모 취소 창 제목: "함께 받기로 한 주문이 있어요" / 본문: "이 주문만 취소하면 남은 주문이 따로 배송돼요." "그 배송비는 환불에서 빠져요." / 버튼: "같이 취소하기 · 전액 환불", "이 주문만 취소하기", "닫기"
  - 부모만 취소 후: "함께 받을 주문이 취소돼서 따로 배송돼요." / "배송비 {amount}원은 취소한 주문의 환불에서 뺐어요."
  - 환불 내역 줄: "함께 받을 주문 배송비" −{amount}원 / "함께 받을 주문도 취소하면 뺀 배송비 {amount}원을 돌려드려요."
  - 취소 이유 추가: "상품을 더 담고 싶어요"(취소하지 않음), "옵션이나 수량을 바꾸고 싶어요"
- 스토어프론트 스타일은 `web/almondyoung-storefront/CLAUDE.md`·`DESIGN.md` 토큰만(hex 금지). 주황 텍스트 금지, 강조는 짙은 회색·굵기.
- 테스트: jest·vitest 는 `--maxWorkers=2`, 바뀐 파일 스펙만. 태스크 끝에 `npm run type-check`(루트) 0.

## Review Focus

1. 부모가 출고 직전(수집 후 shipped 전)일 때 결제 재판정이 Core 판정과 같아야 한다 → Task 3 테스트 "parent became ineligible between page and complete".
2. 같이 취소에서 두 취소 명령이 어떤 순서로 처리돼도 부모는 전액 환불돼야 한다 → Task 5 테스트 "add-on cancelled after parent refunds the withheld remainder".
3. 무통장 웹훅이 in-process 로 complete 를 돌려도 추가 주문은 막혀야 한다(HTTP 미들웨어를 안 탄다) → Task 3 테스트 "awaiting deposit marker on add-on cart is rejected".
4. Core 호출 실패 시 0원 배송비가 적용되면 안 된다(fail-closed: 정상 배송비) → Task 2·3 테스트 "core unavailable returns not eligible".
5. 고객 A 의 카트가 고객 B 의 주문 id 를 부모로 넣으면 거절 → Task 2 테스트 "parent of another customer is not eligible".

---

### Task 1: Core 내부 라우트 — 직접 취소 가능한 주문 고르기

**Files:**
- Modify: `apps/core/src/modules/sales-order/internal/sales-orders-internal.controller.ts`
- Create: `apps/core/src/modules/sales-order/internal/self-cancelable.dto.ts`
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts` (public `selfCancelableChannelOrderIds`)
- Test: `apps/core/src/modules/sales-order/services/__tests__/store-sales-orders.self-cancelable.spec.ts` (기존 store-sales-orders 스펙 옆 위치·모킹 방식을 따른다)

**Interfaces:**
- Produces: `POST /internal/sales-orders/self-cancelable` body `{ customerId: string; channelOrderIds: string[] }` (`customerId` = user-service id = Medusa `customer.metadata.almond_user_id`, `channelOrderIds` ≤ 50) → `{ channelOrderIds: string[] }` (입력 중 Core 에 medusa 채널로 있고, 그 고객 것이고, `cancelUnavailableReason` 이 없는 것).
- `StoreSalesOrdersService.selfCancelableChannelOrderIds(customerId: string, channelOrderIds: string[]): Promise<string[]>` — 기존 `getActionsByChannelOrderBatch(channelOrderIds, customerId)` 결과에서 `availableActions.includes('cancel')` 인 것의 channelOrderId 만.

- [ ] **Step 1: 실패 테스트** — `getActionsByChannelOrderBatch` 를 스텁해 `[{channelOrderId:'o1', availableActions:['cancel']}, {channelOrderId:'o2', availableActions:['track'], cancelUnavailableReason:'already_shipped'}]` 를 돌려주면 `selfCancelableChannelOrderIds('u1',['o1','o2','o3'])` 가 `['o1']`. 빈 배열 입력은 배치 호출 없이 `[]`.
- [ ] **Step 2:** `npx jest apps/core/src/modules/sales-order/services/__tests__/store-sales-orders.self-cancelable.spec.ts --maxWorkers=2` → FAIL
- [ ] **Step 3:** 서비스 메서드 구현. 배치 응답의 키 이름은 실제 `getActionsByChannelOrderBatch` 반환형을 읽고 맞춘다.
- [ ] **Step 4:** DTO(`@IsUUID() customerId`, `@IsArray() @ArrayMaxSize(50) @IsString({each:true}) @MaxLength(255,{each:true}) channelOrderIds`)와 핸들러 `@Post('self-cancelable') @HttpCode(HttpStatus.OK)` 추가. 컨트롤러는 위임만.
- [ ] **Step 5:** 테스트 PASS, `npx jest apps/core/src/modules/sales-order --maxWorkers=2 -t "route|classification"` 와 `npx jest libs/authorization --maxWorkers=2`(라우트 분류 스펙) PASS, `npm run type-check` 0.
- [ ] **Step 6:** 커밋 `[core] Medusa 가 고른 주문 중 고객이 아직 직접 취소할 수 있는 주문을 답하는 내부 라우트를 더한다` → push.

### Task 2: Medusa 판정 함수와 면제 배송비 계산

**Files:**
- Create: `apps/medusa/src/modules/almond-fulfillment/add-to-delivery/core-self-cancelable.ts`
- Create: `apps/medusa/src/modules/almond-fulfillment/add-to-delivery/resolve-parent.ts`
- Create: `apps/medusa/src/modules/almond-fulfillment/add-to-delivery/waived-shipping.ts`
- Test: `apps/medusa/src/modules/almond-fulfillment/add-to-delivery/__tests__/{core-self-cancelable,resolve-parent,waived-shipping}.unit.spec.ts`

**Interfaces:**
- Consumes: Task 1 라우트.
- Produces:
  - `fetchCoreSelfCancelable(customerId: string, channelOrderIds: string[]): Promise<string[]>` — `core-return-eligibility.ts` 와 같은 env·헤더·5초 타임아웃·`servedTenantHeaders()`. 어떤 실패든 `[]`(fail-closed)와 `console.warn` 한 줄.
  - `ADD_TO_DELIVERY_PARENT_KEY = 'add_to_delivery_parent_order_id'`, `ADD_TO_DELIVERY_CART_KIND = 'add_to_delivery'`
  - `type ParentCandidate = { orderId: string; displayId: number; createdAt: string; shippingProfileIds: string[]; shippingAddress: Record<string, unknown> }`
  - `listEligibleParents(query: QueryGraph, input: { customerId: string; shippingProfileId?: string }): Promise<ParentCandidate[]>` — 고객의 Medusa 주문 중 최근 7일, `status !== 'canceled'`, `metadata.bank_transfer_status !== 'awaiting_deposit'`, 추가 주문 자신(`metadata[ADD_TO_DELIVERY_PARENT_KEY]` 있음)은 제외, 배송이 필요한 줄이 있는 것. `shippingProfileId` 가 오면 그 그룹 상품을 가진 주문만. 남은 id 를 `fetchCoreSelfCancelable(almond_user_id, ids)` 로 거른다. `customer.metadata.almond_user_id` 가 없으면 `[]`. 최신순.
  - `resolveParent(query: QueryGraph, input: { customerId: string; parentOrderId: string; shippingProfileId: string }): Promise<ParentCandidate | null>` — `listEligibleParents` 결과에서 그 id.
  - `waivedShippingAmount(query: QueryGraph, orderId: string): Promise<number>` — 주문의 shipping method `data.policySnapshot`(`{policy, shippingProfileId}`)과, 그 프로필 상품 줄의 `{subtotal, quantity}`, 배송지 우편번호로 `calculateShippingFee` 결과. 스냅샷이 없으면 0.

- [ ] **Step 1: 실패 테스트**
  - `core-self-cancelable`: env 없음 → `[]`; 200 `{channelOrderIds:['o1']}` → `['o1']`, 요청 URL `…/internal/sales-orders/self-cancelable`·Bearer·body 확인; 500·모양 불일치·throw → `[]` ("core unavailable returns not eligible").
  - `resolve-parent`: query 스텁으로 ① 정상 부모 하나 → 반환 ② 다른 고객 주문 id → null ("parent of another customer is not eligible") ③ awaiting_deposit 주문 제외 ④ 다른 배송비 그룹만 든 주문 제외 ⑤ Core 가 빼면 제외 ⑥ 추가 주문은 부모 후보가 아님.
  - `waived-shipping`: flat 3000 정책 스냅샷 + 제주 우편번호 → 기본 + 제주 추가비; 스냅샷 없음 → 0.
- [ ] **Step 2:** `cd apps/medusa && npx jest src/modules/almond-fulfillment/add-to-delivery --maxWorkers=2` → FAIL (TEST_TYPE=unit 은 `npm run test:unit -- <path>` 로)
- [ ] **Step 3:** 세 파일 구현. fetch 모킹은 `core-return-eligibility.unit.spec.ts` 방식.
- [ ] **Step 4:** PASS, `npm run type-check` 0.
- [ ] **Step 5:** 커밋 `[medusa] 함께 배송 부모 판정과 면제 배송비 계산을 한곳에 둔다` → push.

### Task 3: 0원 배송비와 결제 재판정

**Files:**
- Modify: `apps/medusa/src/modules/almond-fulfillment/service.ts` (`calculatePrice`)
- Modify: `apps/medusa/src/workflows/hooks/cart/complete-cart.ts`
- Create: `apps/medusa/src/workflows/hooks/cart/validate-add-to-delivery.ts`
- Test: `apps/medusa/src/modules/almond-fulfillment/__tests__/calculate-price-add-to-delivery.unit.spec.ts`, `apps/medusa/src/workflows/hooks/cart/__tests__/validate-add-to-delivery.unit.spec.ts`

**Interfaces:**
- Consumes: Task 2 `resolveParent`, `ADD_TO_DELIVERY_PARENT_KEY`.
- Produces: `validateAddToDelivery(query: QueryGraph, cart: { id: string; customer_id?: string|null; metadata?: Record<string, unknown>|null }): Promise<void>` — 부모 키가 없으면 통과. 있으면 ① `metadata.bank_transfer_status === 'awaiting_deposit'` → `MedusaError(NOT_ALLOWED, '함께 배송 주문은 즉시 결제로만 결제할 수 있어요.')` ② 카트의 배송 방식 `policySnapshot.shippingProfileId` 로 `resolveParent` 가 null → `MedusaError(NOT_ALLOWED, '함께 받을 주문이 방금 출고됐어요. 배송비를 포함해 다시 결제해 주세요.')` ③ 카트 배송지(이름·전화·우편번호·주소1·주소2)가 부모 배송지와 다르면 같은 문구로 거절.

- [ ] **Step 1: 실패 테스트**
  - calculatePrice: `context.id` 카트 metadata 에 부모 키 + `resolveParent` 성공 → `calculated_amount: 0`(제주 우편번호여도 0); `resolveParent` null 또는 Core 실패 → 기존 계산값; 부모 키 없음 → `resolveParent` 를 부르지 않는다.
  - validate: "parent became ineligible between page and complete"(resolveParent null → 거절 문구 정확히), "awaiting deposit marker on add-on cart is rejected", 배송지 다름 → 거절, 부모 키 없음 → 통과.
- [ ] **Step 2:** 실행 → FAIL
- [ ] **Step 3:** `calculatePrice` 에서 `this.query_.graph({ entity: 'cart', fields: ['id','customer_id','metadata'], filters: { id: context.id } })` 로 키를 읽고, 있으면 `resolveParent(this.query_, { customerId, parentOrderId, shippingProfileId })` 성공 시 0. `calculateShippingFee` 는 부르지 않는다(지역 추가비까지 면제).
- [ ] **Step 4:** `complete-cart.ts` validate 핸들러에서 쿠폰 소진 앞에 `await validateAddToDelivery(query, cart)` 한 줄.
- [ ] **Step 5:** PASS, `no-duplicate-validate-hooks.unit.spec.ts` PASS, `npm run type-check` 0.
- [ ] **Step 6:** 커밋 `[medusa] 함께 배송 카트는 배송비를 0원으로 두고 결제 순간 부모를 다시 판정한다` → push.

### Task 4: Medusa store 라우트 세 개

**Files:**
- Create: `apps/medusa/src/api/store/add-to-delivery/parents/route.ts` (GET)
- Create: `apps/medusa/src/api/store/add-to-delivery/carts/route.ts` (POST)
- Create: `apps/medusa/src/api/store/add-to-delivery/links/route.ts` (GET)
- Create: `apps/medusa/src/api/store/add-to-delivery/validators.ts`
- Modify: `apps/medusa/src/api/middlewares.ts`
- Test: `apps/medusa/src/api/store/add-to-delivery/__tests__/*.unit.spec.ts`

**Interfaces:**
- Consumes: Task 2 함수들.
- Produces (전부 `authenticate('customer', ['session','bearer'])`, 고객 id 는 `req.auth_context.actor_id`):
  - `GET /store/add-to-delivery/parents?product_id=` → `{ parents: Array<{ order_id, display_id, created_at, address: { name, phone, postal_code, address_1, address_2 } }> }` — 상품의 `shipping_profile.id` 로 `listEligibleParents`. 배송지가 같은 주문은 가장 최근 하나만(주소 키 = 이름+전화+우편번호+주소1+주소2).
  - `POST /store/add-to-delivery/carts` body `{ parent_order_id, variant_id, quantity }` (zod, quantity 1~99) → `{ cart_id }` — `resolveParent` 실패면 409 같은 거절 문구. 성공이면 부모 region 으로 카트 생성, `metadata: { cart_kind: 'add_to_delivery', add_to_delivery_parent_order_id }`, 고객 연결, 줄 추가, 부모 배송지 그대로 복사. 기존 `createBuyNowCart` 가 쓰는 Medusa 워크플로(`createCartWorkflow`, `addToCartWorkflow` 등)로 한 라우트 안에서 처리.
  - `GET /store/add-to-delivery/links?order_ids=a,b` (≤ 20, 본인 주문만) → `{ links: Record<orderId, { parent_order_id: string|null; children: string[]; waived_amount: number; withheld_amount: number }> }` — 자식이면 `waived_amount = waivedShippingAmount(자식)`, 부모면 살아 있는 자식들의 면제액 합을 `withheld_amount`. 자식 찾기는 Task 5 의 `listLiveAddOns`.
- [ ] **Step 1: 실패 테스트** — 라우트 핸들러를 직접 불러 ① 비로그인 401 ② 다른 고객 주문 id 는 links 에서 빠짐 ③ 같은 주소 두 주문 → parents 하나 ④ carts 부모 부적격 → 409 + 문구.
- [ ] **Step 2:** 실행 → FAIL
- [ ] **Step 3:** 구현 + `middlewares.ts` 등록(`validateAndTransformQuery`/`validateAndTransformBody`).
- [ ] **Step 4:** PASS, type-check 0.
- [ ] **Step 5:** 커밋 `[medusa] 함께 배송 부모 후보·카트 만들기·주문 연결 조회 store 라우트를 더한다` → push.

(Task 4 는 Task 5 의 `listLiveAddOns` 를 쓴다. 구현 순서상 Task 5 의 그 함수를 Task 4 에서 먼저 만들어도 된다. 파일 위치는 Task 5 를 따른다.)

### Task 5: 부모 환불 차감과 되돌려주기

**Files:**
- Create: `apps/medusa/src/modules/almond-fulfillment/add-to-delivery/live-add-ons.ts`
- Modify: `apps/medusa/src/workflows/orders/channel-cancel/channel-cancel-order.ts` (`refundRemaining` 과 그 호출부)
- Test: `apps/medusa/src/workflows/orders/channel-cancel/__tests__/add-to-delivery-refund.unit.spec.ts`

**Interfaces:**
- Produces:
  - `listLiveAddOns(container: MedusaContainer, parentOrderId: string): Promise<string[]>` — `ContainerRegistrationKeys.PG_CONNECTION`(knex)로 `select id from "order" where metadata->>'add_to_delivery_parent_order_id' = ? and status <> 'canceled' and deleted_at is null`.
  - `withheldForParent(container: MedusaContainer, parentOrderId: string): Promise<number>` — 살아 있는 자식들의 `waivedShippingAmount` 합.
- 동작:
  - 전체 취소(`scope` 전체)로 `refundRemaining(container, input)` 을 돌 때 `withheldForParent(orderId)` 만큼을 결제 순서대로 덜 환불한다(합계가 캡처−환불을 넘지 않게 자른다). 부분 취소 경로는 건드리지 않는다.
  - 취소되는 주문이 자식이고 부모가 `canceled` 면, 자식 처리 끝에 부모에 대해 `refundRemaining` 을 한 번 더 돈다(같은 refundMode·actorId, 부모 `refundNote`). 이제 그 자식은 살아 있지 않으므로 뺐던 금액만 돌아간다.
- [ ] **Step 1: 실패 테스트** — payment module·knex 스텁으로 ① 부모 캡처 32000, 살아 있는 자식 면제 3000 → 환불 29000 ② 자식 없음 → 32000 ③ "add-on cancelled after parent refunds the withheld remainder": 부모 취소(29000 환불) 후 자식 취소 → 부모에 3000 추가 환불 ④ 자식 먼저 취소 후 부모 취소 → 부모 32000 ⑤ 면제액이 남은 금액보다 크면 0까지만.
- [ ] **Step 2:** 실행 → FAIL
- [ ] **Step 3:** 구현. 부모 상태 확인은 `query.graph({ entity: 'order', fields: ['id','status','metadata'] })`.
- [ ] **Step 4:** PASS, 기존 channel-cancel 관련 스펙 PASS, type-check 0.
- [ ] **Step 5:** 커밋 `[medusa] 부모만 취소하면 함께 배송 주문의 면제 배송비를 빼고 환불하고, 그 주문까지 취소되면 돌려준다` → push.

### Task 6: 즉시 결제수단만 보이기

**Files:**
- Modify: `apps/medusa/src/modules/almond-payment/service.ts` (`initiatePayment`)
- Modify: `apps/wallet-web/app/pay/[intentId]/pay-form.tsx`
- Test: `apps/medusa/src/modules/almond-payment/__tests__/initiate-payment-instant-only.unit.spec.ts`, wallet-web 기존 테스트 방식에 맞춘 pay-form 필터 테스트(필터를 `filterPayMethods(methods, intent)` 순수 함수로 빼서 테스트)

**Interfaces:**
- Produces: intent metadata `instantOnly: true` — `initiatePayment` 의 `context.data.instantOnly === true` 일 때만.
- wallet-web: `instantOnly` 면 `BANK_TRANSFER`·`VIRTUAL_ACCOUNT` 를 빼고 Toss 위젯(가상계좌를 그리는 것)을 쓰지 않는다.
- [ ] **Step 1: 실패 테스트** — initiatePayment 가 `data.instantOnly` 를 metadata 로 넘김 / 없으면 안 넘김. `filterPayMethods` 가 instantOnly 에서 무통장 계열을 뺌, 아니면 기존 결과 그대로.
- [ ] **Step 2:** 실행 → FAIL
- [ ] **Step 3:** 구현. 기존 필터 세 줄을 `filterPayMethods` 로 옮기고 한 조건을 더한다.
- [ ] **Step 4:** PASS, type-check 0, wallet-web 빌드 타입 검사(`cd apps/wallet-web && npx tsc --noEmit`) 0.
- [ ] **Step 5:** 커밋 `[medusa·wallet-web] 함께 배송 결제에서는 즉시 결제수단만 보인다` → push.

### Task 7: 스토어프론트 — 상세 버튼과 짧은 체크아웃

**Files (root `web/almondyoung-storefront/src`):**
- Create: `lib/api/medusa/add-to-delivery.ts` (`"use server"`: `listAddToDeliveryParents(productId)`, `createAddToDeliveryCart(input)`)
- Create: `domains/products/product-details/components/add-to-delivery/index.tsx` (버튼 + 부모 고르기 시트)
- Modify: `domains/products/product-details/components/product-actions/index.tsx`, `mobile-actions.tsx` (버튼 자리·핸들러 전달)
- Modify: `domains/checkout/templates/checkout-template.tsx`, `domains/checkout/components/sections/shipping/index.tsx` (함께 배송 카트면 배송지 잠금 + "위 주문과 함께 배송돼요." 안내, `processPayment` 의 `initiatePaymentSession` data 에 `instantOnly: true`)
- Modify: `i18n/messages/{ko,en,ja}/*.json` (해당 네임스페이스)
- Test: `domains/products/product-details/components/add-to-delivery/index.test.tsx`

**Interfaces:**
- Consumes: Task 4 라우트, Task 6 `instantOnly`.
- `listAddToDeliveryParents(productId: string): Promise<Array<{ orderId: string; displayId: number; address: {...} }>>` (비로그인·오류 → `[]`)
- `createAddToDeliveryCart(input: { parentOrderId: string; variantId: string; quantity: number }): Promise<{ cartId: string } | { error: string }>`
- 버튼 문구 "함께 받기"(부모 하나) — 누르면 바로 카트 만들고 `/${countryCode}/checkout?cartId=`. 부모가 여럿이면 시트에서 배송지를 고른다(줄마다 "주문번호 · 주소"). 부모 없음 → 버튼 없음. 옵션 미선택이면 기존 담기와 같은 안내.
- 결제 재판정 거절(Task 3 문구)을 받으면 체크아웃에 "일반 주문으로 결제하기" 버튼: `updateCart({ metadata: { cart_kind: 'buy_now', add_to_delivery_parent_order_id: null } })` 후 `ensureCorrectShippingMethod(cart, { refreshAmounts: true })` 로 배송비를 다시 받는다. 배송지 잠금도 풀린다.
- [ ] **Step 1: 실패 테스트** — 부모 0 → 버튼 없음, 1 → 버튼 클릭 시 `createAddToDeliveryCart` 호출, 2 → 시트 열림, 거절 문구를 받은 체크아웃에서 "일반 주문으로 결제하기"가 metadata 를 지우는 호출.
- [ ] **Step 2:** `cd web/almondyoung-storefront && npx vitest run src/domains/products/product-details/components/add-to-delivery --maxWorkers=2` → FAIL
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS, `npx tsc --noEmit` 0, 바뀐 기존 테스트(`mobile-actions.test.tsx`) PASS.
- [ ] **Step 5:** 커밋 `[storefront] 상품 상세에 함께 받기 버튼과 배송지가 잠긴 짧은 체크아웃을 더한다` → push.

### Task 8: 스토어프론트 — 마이페이지 함께 배송·부모 취소 창·취소 이유

**Files (root `web/almondyoung-storefront/src`):**
- Modify: `lib/api/medusa/add-to-delivery.ts` (`getAddToDeliveryLinks(orderIds)`)
- Modify: `domains/order/list/get-order-list-data.ts`, `domains/order/list/order-list.tsx` (자식을 부모 카드 안 "함께 배송" 영역으로)
- Create: `components/orders/order-card/together-delivery-section.tsx`
- Create: `components/orders/parent-cancel-dialog.tsx` (`print-partial-cancel-dialog.tsx` 패턴)
- Modify: `components/orders/order-card/order-actions.tsx`, `components/orders/cancel-reason-form.tsx`
- Modify: 주문 상세 `domains/order/details/components/order-details-{desktop,mobile}.tsx` (환불 내역 줄)
- Modify: `i18n/messages/{ko,en,ja}/mypage.json`
- Modify (Core): `apps/core/src/modules/sales-order/dto/store-order-actions.dto.ts` `reasonCode` 에 `'CHANGE_OPTION'` 추가 + 스토어프론트 타입·parity 스펙
- Test: `components/orders/order-card/together-delivery-section.test.tsx`, `components/orders/parent-cancel-dialog.test.tsx`

**Interfaces:**
- Consumes: Task 4 links.
- 목록: 한 페이지 안에 부모와 자식이 같이 있으면 자식을 부모 카드 안에 넣고 상단에 "주문 {n}건이 상자 하나로 배송돼요.", 배송 조회는 부모 카드 하나. 자식만 있으면 혼자 카드 + "함께 배송" 칩. 부모가 취소됐으면 자식은 혼자 카드 + 부모만 취소 후 문구.
  - ponytail: 페이지 경계에서 부모·자식이 갈리면 묶지 않는다(페이지 크기 5). 필요해지면 links 로 부모를 따로 불러 붙인다.
- 부모 취소: `withheld_amount > 0` 이면 취소 이유 다음에 부모 취소 창. "같이 취소하기"는 자식 취소 → 부모 취소 순서로 `cancelOrderByMedusaId` 두 번(같은 reasonCode). "이 주문만 취소하기"는 부모만.
- 취소 이유: "상품을 더 담고 싶어요"(`ADD_ITEMS`, 서버로 보내지 않음) 고르면 확인 버튼이 "함께 받을 상품 고르기"가 되고 `/${countryCode}/store` 로 보낸다. "옵션이나 수량을 바꾸고 싶어요"(`CHANGE_OPTION`)는 취소 후 완료 토스트에 "같은 상품 다시 담기" 액션(그 주문 상품 상세로).
- [ ] **Step 1: 실패 테스트** — 묶음 렌더(부모 안 자식, 문구 정확), 부모 취소 후 자식 혼자 카드 문구, 부모 취소 창 금액(32000 − 3000 = 29000 표기), 같이 취소 호출 순서, ADD_ITEMS 는 cancel API 를 부르지 않음.
- [ ] **Step 2:** 실행 → FAIL
- [ ] **Step 3:** 구현(시안: 모바일 카드 안 점선 구분 + "함께 배송" 칩, 태블릿·PC 는 상품 2열·버튼 우상단·가운데 창).
- [ ] **Step 4:** 스토어프론트 테스트·`npx tsc --noEmit` PASS, 루트 `npx jest store-order-actions.storefront-parity --maxWorkers=2` PASS, `npm run type-check` 0.
- [ ] **Step 5:** 커밋 `[storefront·core] 마이페이지에 함께 배송 묶음과 부모 취소 확인 창, 취소 이유 두 가지를 더한다` → push.

### Task 9: 런북 — 늦게 들어온 함께 배송 주문 찾기

**Files:**
- Create: `scripts/ops/cellmate-local/check-add-to-delivery.js`
- Modify: `scripts/ops/cellmate-local/README.md`, `docs/runbooks/sellmate-cutover-phase1.md`

**Interfaces:**
- `DISPLAY_IDS=<이번 회차 display_id 목록> node scripts/ops/cellmate-local/check-add-to-delivery.js` → 이번 회차 주문 id 를 부모로 가진 주문 중 `status <> 'canceled'`, 무통장 입금 대기 아님, 환불 요청 아님, `shipped_quantity = 0`, `display_id` 가 `DISPLAY_IDS` 에 없는 것의 `display_id`·부모 display_id 를 출력. 없으면 `함께 배송 추가분 0` 한 줄. 접속·제외 조건은 `collect-cellmate.js` 와 같은 함수·SQL 조각을 쓴다.
- [ ] **Step 1:** 로컬 Medusa DB 에 부모 1·자식 1 을 둔 상태로 실행해 자식이 나오는지 본다(로컬 스택이 없으면 SQL 을 `--dry` 로 출력만 하고 확인 사항을 README 에 적는다).
- [ ] **Step 2:** 런북에 shipped 직전·직후 두 번 실행, 나오면 같은 회차 추가 업로드 후 함께 shipped, 송장 출력 뒤면 회차 보고에 "함께 배송 따로 출고 N건" 한 줄.
- [ ] **Step 3:** 커밋 `[ops] 셀메이트 회차에 늦게 들어온 함께 배송 주문을 찾는 점검을 더한다` → push.
