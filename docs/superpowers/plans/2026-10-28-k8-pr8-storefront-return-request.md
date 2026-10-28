# K8 PR 8 — 스토어프론트 반품 신청 화면 + 주문 상세 «반품» 칸 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고객이 스토어프론트에서 PR 3 의 Medusa store 라우트로 반품을 신청하고(상품 이미지·옵션, 반품 가능 수량·기한, 사유별 택배비 안내, 주문 배송지 회수), 주문 상세에서 접수한 반품의 진행 상태를 보고 도착 전이면 취소한다.

**Architecture:** ① Medusa 에 고객용 읽기 라우트 하나(`GET /store/orders/:id/returns`)를 더한다 — 우리 반품만, 단계는 Medusa 반품 상태와 정산·선환불 기록에서 순수 함수로 유도한다. ② 스토어프론트는 판정(줄 만들기·선택·검증·본문·결과 해석·단계 문구)을 순수 `.ts` 로 두고 vitest 로 검증하고, 화면은 서버 컴포넌트가 데이터를 읽어 클라이언트 폼·칸에 넘긴다. 쓰기는 서버 액션이 결과 유니온으로 돌려준다(401 만 던진다). ③ 반품 사유·거절 코드 표는 Medusa 가 정본이고, 루트 jest 대조 스펙이 두 트리를 잇는다(`web/**` 은 CI 가 없다).

**Tech Stack:** Medusa 2.13.4(라우트·`query.graph`, unit `__tests__/*.unit.spec.ts`, HTTP 통합 `integration-tests/http`), Next.js 15 App Router + next-intl + shadcn(스토어프론트, vitest node 환경), Jest(루트 대조 스펙).

**Spec:** `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md` — §4.8(«스토어프론트 신청 화면(#933·#934): 우리 store 라우트를 부른다»), §4.2(반품 요청 — PR 3 결과 N1·N2), §3 D4·D5·D9, §8 PR 8. 이슈 #933(옛 core API 400), #934(화면 개편).

## PR 1~7b 본문이 넘긴 것 (이 PR 이 닫는다 / 넘긴다)

| 출처 | 넘긴 것 | 여기서 |
| --- | --- | --- |
| PR 3 #1149 | `GET …/returnable` 은 «PR 7·8 화면용», 화면은 200 을 «접수됨»으로 읽지 말고 `status` 를 볼 것 | Task 3(결과 해석)·Task 4 |
| PR 3 #1149 | `request_id` 멱등 — 같은 id 다른 본문은 `request_id_conflict` | Task 3(N5 잠금) |
| PR 5 #1156 | 옛 core 반품 길이 살아 있다 — PR 10 전 개통이면 옛 라우트를 닫아야 한다 | 스토어프론트가 옛 길을 더는 부르지 않는다(Task 4). 라우트 자체는 PR 10 |
| PR 7 #1159 | 접수 `request_id_conflict` 안내가 «닫고 다시 열기»면 두 번째 반품을 부른다 | 같은 교훈 — «이미 접수됐어요, 주문 상세에서 확인» (N6) |
| PR 6b Q1 | 선환불 뒤 끝내 미도착이면? | **열린 채로 둔다** — 고객 화면엔 «환불했어요»로 보일 뿐 |
| #934 «정해야 할 것» | 반품 배송비 부담·금액 표시, 예상 환불액 | 사용자 결정 10-28: 금액 없이 사유 규칙만(N3). 교환 옵션 변경은 PR 11 |

## 코드에서 확인한 것 (develop `4cad80c19`)

- **Medusa store 라우트(PR 3).** `POST /store/orders/:id/returns` 본문 `{ request_id, items: [{ item_id, quantity ≥ 1 정수 }], reason, note? }`(snake_case, `fee_bearer`·`window_override_reason` 은 400) → 200 `{ return_id, request_id, status, items, fee_bearer, window_overridden }` / 400 `{ type: 'not_allowed', code: 'return_rejected', reason, message }` / 400 `invalid_data`(본문 모양) / 404 `{ type: 'not_found' }`(남의 주문 포함) / 502 `{ type: 'core_unavailable' }`. `GET …/returnable` → `{ items: [{ item_id, returnable_quantity, window_ends_at: ISO|null }] }`(취소 주문은 전 줄 0). `POST …/returns/:return_id/cancel` 본문 없음 → 200 `{ return_id, status: 'canceled' }` / 400 reason `return_already_received`·`return_arrived`·`return_prepaid`·`not_our_return`. 셋 다 미들웨어 `authenticate('customer', ['session','bearer'])`, 매처에 method 없음(`api/middlewares.ts:152-160`) — 같은 경로의 GET 도 덮는다.
- **거절 코드 정본**은 `plan-return-request.ts` `ReturnRejectReason`(16종). 고객이 만날 수 있는 것: `order_canceled`·`item_not_in_order`·`not_delivered`·`quantity_exceeds_returnable`·`window_closed`·`reason_not_found`·`reason_not_selectable`·`request_id_conflict`·`return_option_missing` + 취소 넷.
- **사유 정본**은 `return-reasons.ts` `RETURN_REASONS` — 고객 선택 다섯(`change_of_mind` customer, `defective`·`not_as_described`·`wrong_item`·`damaged_in_shipping` seller), `other` 는 operator·고객 선택 불가.
- **반품 기록.** `loadReturnOrder` 는 `returns.id/status/metadata` 만 읽는다. 우리 반품은 metadata `almondReturn`(`readReturnRequestRecord` — `requestedBy`·`reasonValue`·`feeBearer`), 정산 `almondReturnSettlement`(`readReturnSettlementRecord`, stage `received`→`charged`→`refunded`), 선환불 `almondReturnPrepay`(`readReturnPrepayRecord`, stage `requested`|`refunded`). Medusa 반품 상태 `open`·`requested`·`received`·`partially_received`·`canceled`. 반품 품목 수량은 이름으로 고르면 빠진다 — `returns.items.*`(PR 5, `return-observation-fields.spec.ts`).
- **고객 반품 취소 규칙**(`cancel-order-return.ts`): 본인 주문의 우리 반품이면 CS 가 접수한 것도 취소된다. 수령분·core 도착·실제로 나간 선환불이면 거절.
- **스토어프론트.** 반품·교환 폼은 한 파일(`domains/order/exchange/exchange-client.tsx`)이고 반품은 옛 core `POST /store/orders/by-channel-order/:id/return-requests`(`store-orders.ts:291`)를 부른다 — 라인 형식이 안 맞아 **항상 400**(#933). 진입은 core actions 의 `availableActions.includes('return')`(`order-actions.tsx:135`, `order-details-{desktop,mobile}.tsx`) — core 가 K6 소포 claimable > 0 일 때만 준다(셀메이트 시기 라이브 0). 주문 상세 page(`mypage/order/details/page.tsx`)는 서버에서 `getOrder`(Medusa sdk)·core actions 를 읽어 desktop/mobile 에 넘긴다. `api("medusa", …)` 는 publishable key 를 붙이고 실패 본문을 `HttpApiError.data` 로 보존한다. 단 Medusa 고객 라우트는 `_medusa_jwt` 쿠키(`getAuthHeaders()`)를 헤더로 넘기고 `withAuth: false` 로 호출해야 한다 — `withAuth` 가 붙이는 bearer 는 user-service 토큰이라 Medusa 가 401 로 거절한다. 결과 유니온 본보기 `cancelOrderByMedusaId`(`store-orders.ts:151-188`). 주소 한 줄은 `buildAddressLine`(`lib/utils/address-line.ts`), 수량은 `components/shared/number-stepper`, 체크박스 `components/shared/checkbox`.
- **스토어프론트 테스트:** vitest `src/**/*.test.ts`, node 환경 — 컴포넌트 테스트 없음. 판정은 순수 함수로 꺼내야 검증된다. tsc 는 선재 에러가 있다(08-30 기준 49건) — 개수와 함께 **건드린 파일의 에러 0** 을 본다.
- **주문제작(인쇄) 줄**은 따로 막지 않는다 — 와우프레스가 직접 보내 창고 배송완료가 없으므로 core 자격이 0 이다(`store-return-exchange.service.ts:1386` 주석). 직배 줄도 core 가 0 을 준다(PR 3).

## 이름 붙은 결정

- **N1. 수거지는 주문 배송지로 고정한다**(사용자 결정 10-28). 폼에 주소 칸이 없다 — 주문 `shipping_address` 한 줄을 보여 주고 «다른 곳에서 회수해야 하면 고객센터로 알려 주세요». Medusa 요청에 주소 칸을 더하지 않는다. 한진 회수(PR 9)가 주문 배송지를 송하인으로 읽는다. 그 전엔 CS 가 손으로 접수한다.
- **N2. 고객이 반품 상태를 주문 상세 «반품» 칸에서 본다**(사용자 결정 10-28). Medusa `GET /store/orders/:id/returns` → `{ returns: [{ return_id, stage, requested_at, reason, fee_bearer, items: [{ item_id, quantity }], can_cancel }] }`, `requested_at` 늦은 순. 우리 기록(`almondReturn`)이 있는 반품만, `open` 은 뺀다(끊긴 시도). 단계 `stage`:
  - `canceled` — Medusa 상태 `canceled`
  - `refunded` — 정산 기록 stage `refunded` 이거나 선환불 기록 stage `refunded`
  - `processing` — Medusa 상태 `received`·`partially_received` 이거나 정산 기록이 있음(환불 처리 중)
  - `requested` — 그 밖(회수 대기·창고 도착·검수 중을 가르지 않는다 — core 를 부르지 않는다)
  - `can_cancel` = `stage === 'requested'` 이고 Medusa 상태 `requested`. core 도착은 모른다 — 취소 POST 의 `return_arrived` 거절을 문구로 보인다. 본인 주문이 아니면 404, 로그인 없으면 401(미들웨어).
- **N3. 금액은 보이지 않고 택배비 규칙만 안내한다**(사용자 결정 10-28). 사유를 고르면 부담 주체로 한 줄 — `customer`: «반품 택배비가 환불금에서 빠져요. 남는 주문이 무료배송 기준 아래로 내려가면 처음 배송비도 빠져요.» / `seller`: «택배비는 저희가 내요.» 금액은 정산 때 Medusa 가 센다(PR 6 N13).
- **N4. 줄과 수량.** 폼 줄은 Medusa 주문 품목(썸네일·상품명·옵션명·주문 수량)에 `returnable` 을 붙인 것이다. `returnable` 에 없는 품목은 0. 막힘 `blocked`: `returnable_quantity === 0` → `'nothing_left'`, `window_ends_at < now` → `'window_closed'`(수량이 있어도). 막힌 줄은 고를 수 없고 이유 한 줄(기한 지남은 «{date}까지였어요»). 고를 수 있는 줄은 «{date}까지 신청할 수 있어요». 수량 스테퍼는 1~`returnable`. 고를 수 있는 줄이 하나도 없으면 폼 대신 빈 상태(«지금 반품할 수 있는 상품이 없어요» + 주문 상세로). URL `itemId` 가 고를 수 있는 줄이면 수량 1 로 미리 고른다.
- **N5. 요청 id 와 결과를 모르는 제출.** `request_id` 는 폼을 열 때 `crypto.randomUUID()` 한 번. 결과 해석(`toReturnRequestOutcome`):
  - 200 `status === 'requested'` → `requested`(완료 화면). 200 `status === 'canceled'`(같은 id 재생인데 그 사이 취소됨) → `canceled_replay` — 완료가 아니다, 새 id 로 다시 받는다.
  - 400 `return_rejected` → `rejected(reason)`, 502 `core_unavailable` → `unavailable`, 404 → `not_found` — 셋 다 Medusa 가 반품을 만들기 «전»의 확정 답이라 **새 id 로 바꾸고 폼을 푼다**.
  - 그 밖(네트워크 오류·5xx·코드 없는 400) → `unknown` — 만들어졌는지 모른다. **본문을 잠근다**(줄·수량·사유·메모 입력 막힘), 버튼은 «다시 보내기», 같은 id·같은 본문을 다시 보낸다.
  - 401 은 던진다(`error.tsx` 토큰 복구).
- **N6. `request_id_conflict` 는 끝 상태다.** 문구 «이미 접수된 신청이에요. 주문 상세에서 확인해 주세요» + 주문 상세 링크. 다시 보내기·새 id 를 주지 않는다(PR 7 교훈 — 새 id 는 두 번째 반품이다).
- **N7. 교환은 그대로다.** `exchange-client.tsx` 는 교환 전용이 되고 옛 core 교환 API 를 계속 부른다(PR 11). URL `/mypage/exchange?orderId=…&type=return` 은 유지 — page 가 `type` 으로 두 클라이언트를 고른다. 진입 버튼의 core actions 판정도 그대로다(D9: 셀메이트 시기 0 → 휴면).
- **N8. 사유·거절 코드 표는 Medusa 가 정본이다.** 스토어프론트 `return-reasons.ts` 의 고객 사유 다섯(값·부담 주체)은 Medusa `RETURN_REASONS` 의 `customerSelectable: true` 행과 **같은 집합**, 사유 이름 키는 Medusa 여섯 전부(`other` 포함 — CS 가 접수한 반품이 칸에 보인다), 거절 문구 키는 Medusa `ReturnRejectReason` 전부를 덮는다. 루트 jest `scripts/storefront/medusa-return-parity.spec.ts` 가 소스 텍스트를 읽어 대조한다(`store-order-actions.storefront-parity.spec.ts` 와 같은 방식). 모르는 거절 코드는 일반 문구로 떨어진다.

## Global Constraints

- 사는 곳: `apps/medusa`(store 읽기 라우트 하나), `web/almondyoung-storefront`, `scripts/storefront`(대조 스펙), 문서. **마이그·이벤트 계약·core 변경 없음.**
- Medusa: 판정은 `workflows/orders/returns/*.ts` 순수 함수 + `__tests__/*.unit.spec.ts`. 라우트 파일은 핸들러 위임 한 줄(PR 3 관례, `return-request-handlers.ts`). 응답 칸은 snake_case.
- 스토어프론트(`web/almondyoung-storefront/CLAUDE.md`·`DESIGN.md`):
  - API 호출은 `api()` 만. 인증 쓰기는 서버 액션 + `startTransition`, `ApiAuthError` 만 던지고 나머지는 결과 유니온.
  - dto 타입(`lib/types/dto/returns.ts`)은 `lib/api/` 에서만 import, 화면·판정은 ui 타입(`lib/types/ui/returns.ts`).
  - 파일·폴더 kebab-case, 내부 링크 `LocalizedClientLink`, 날짜 `formatDate`, 문구는 전부 `t()` + `src/i18n/messages/{ko,en,ja}/mypage.json` 세 파일 같은 키.
  - 시맨틱 유틸만(하드코딩 hex 금지), 오렌지는 제출 CTA 하나, 칩 선택은 `bg-foreground text-white`, 4px 그리드. 빨강은 실제 오류에만. 문구는 필요한 것만([[ui-minimal-text]]), DESIGN §8 금지 문구 금지.
  - 로컬 `npm install` 이 `yarn.lock` 을 건드리면 되돌린다(배포는 package-lock).
- 게이트(워크트리면 루트·`apps/medusa`·`web/almondyoung-storefront` 의 `node_modules` 를 메인 체크아웃으로 심볼링크):
  - 루트 `npm run type-check` 0, `npx jest scripts/storefront` 통과.
  - Medusa `(cd apps/medusa && npm run test:unit)` 전부 통과, `npx tsc --noEmit -p apps/medusa/tsconfig.json` 은 기존 3건뿐(`src/admin/lib/sdk.ts`×2, `confirm-purchase.unit.spec.ts`).
  - Medusa 통합 `scripts/local/run-medusa-integration.sh --testPathPattern 'http/return-routes\.spec'` (postgres + redis 둘 다, 패턴은 escape — 워크트리 경로가 `return-request` 를 포함한다).
  - 스토어프론트 `(cd web/almondyoung-storefront && npm test && npx tsc --noEmit)` — **Task 1 전에 develop 에서 tsc 에러 수를 잰다.** 끝에 개수가 같고 건드린 파일 경로로 grep 해 0.

## Review Focus

1. **결과를 모르는 제출.** 네트워크 오류 뒤 줄·수량·사유를 못 바꾸고, «다시 보내기»가 같은 `request_id`·같은 본문을 보낸다. 확정 거절 뒤에는 새 id 로 풀린다. — Task 3.
2. **재생된 200 이 `canceled`.** 완료 화면을 띄우지 않는다. — Task 3.
3. **기한 지난 줄·0 줄·URL 의 `itemId` 가 막힌 줄.** 미리 고르지 않고, 다 막히면 빈 상태. 기한은 줄마다 다르다(배송완료가 소포마다 다르다). — Task 3.
4. **남의 주문·없는 주문 id 를 URL 에 넣음.** `returnable` 404 → «신청할 수 없는 주문이에요» — 주문이 있는지 흘리지 않는다. 반품 칸 읽기도 404 면 칸이 없다. — Task 3·4.
5. **반품 칸 읽기 실패**(롤아웃 중 라우트 없음·5xx). 주문 상세는 그대로 뜨고 칸만 없다. CS 가 «기타»로 접수한 반품도 사유 이름이 보인다. — Task 1·5.

---

### Task 1: Medusa — 고객 반품 목록 `GET /store/orders/:id/returns`

**Files:**
- Create: `apps/medusa/src/workflows/orders/returns/describe-store-returns.ts`
- Create: `apps/medusa/src/workflows/orders/returns/load-store-returns.ts`
- Modify: `apps/medusa/src/api/orders-returns/return-request-handlers.ts`(`handleStoreReturnList`)
- Modify: `apps/medusa/src/api/store/orders/[id]/returns/route.ts`(`GET` export, 주석에 응답 모양)
- Test: `apps/medusa/src/workflows/orders/returns/__tests__/describe-store-returns.unit.spec.ts`, `apps/medusa/integration-tests/http/return-routes.spec.ts`

**Interfaces:**
- Produces:
  - `type StoreReturnStage = 'requested' | 'processing' | 'refunded' | 'canceled'`
  - `type StoreReturnSource = { id: string; status: string; requestedAt: string | null; createdAt: string; metadata: unknown; items: Array<{ itemId: string; quantity: number }> }`
  - `type StoreReturnView = { returnId: string; stage: StoreReturnStage; requestedAt: string; reason: string; feeBearer: 'customer' | 'seller'; items: Array<{ itemId: string; quantity: number }>; canCancel: boolean }` — `requestedAt` 은 `requestedAt ?? createdAt`
  - `describeStoreReturns(returns: StoreReturnSource[]): StoreReturnView[]` (N2 규칙·정렬)
  - `loadStoreReturns(container: MedusaContainer, orderId: string): Promise<{ customerId: string | null; returns: StoreReturnSource[] } | null>`
  - 응답 N2 의 snake_case 모양.

- [ ] **Step 1: 실패하는 unit 스펙** — `describe('describeStoreReturns')`
  - `it('우리 기록이 없는 반품과 open 반품은 뺀다')`
  - `it('requested 반품 → stage requested, canCancel true, 사유·부담 주체는 almondReturn 에서')`
  - `it('received·partially_received → processing, canCancel false')`
  - `it('정산 기록 stage charged → processing, refunded → refunded')`
  - `it('선환불 기록 stage refunded 이고 Medusa 는 requested → refunded, canCancel false')`
  - `it('canceled → canceled, 정산 기록이 있어도 canceled')`
  - `it('requested_at 늦은 순, requested_at 이 없으면 created_at')`
  - `it('operator 가 접수한 other 사유 반품도 싣는다')`
- [ ] **Step 2: 실행** — `(cd apps/medusa && npm run test:unit -- describe-store-returns)` → FAIL.
- [ ] **Step 3: 구현** — 기록 판독은 `readReturnRequestRecord`·`readReturnSettlementRecord`·`readReturnPrepayRecord` 를 그대로 쓴다. 로더는 `query.graph` 필드 `id, customer_id, returns.id, returns.status, returns.requested_at, returns.created_at, returns.metadata, returns.items.*` — 품목은 `item_id`·`quantity`(`toNumber`)만 옮긴다. 핸들러는 `handleReturnable` 의 소유 판정(없음·`actor_id` 없음·남의 주문 → `ReturnOrderNotFound` → `sendReturnError` 404)을 따른다.
- [ ] **Step 4: 실패하는 통합 스펙** — `return-routes.spec.ts` 의 store 묶음에
  - `it('GET /store/orders/:id/returns — 본인 반품 하나 → stage requested·can_cancel true·품목 수량 1, 반품 취소 뒤 → canceled·can_cancel false')`
  - `it('GET returns — 남의 주문 404, 로그인 없음 401')`
  - `it('GET returns — admin 이 other + fee_bearer seller 로 접수한 반품도 고객 목록에 reason other·fee_bearer seller')`
- [ ] **Step 5: 실행** — 통합 PASS(Global Constraints 의 명령). unit 전부, medusa tsc 기존 3건뿐.
- [ ] **Step 6: Commit** — `feat(medusa): 고객 반품 목록 GET /store/orders/:id/returns — 우리 반품만, 단계·취소 가능 (K8 PR8)`

### Task 2: 스토어프론트 — 반품 타입·서버 액션·결과 해석

**Files:**
- Create: `web/almondyoung-storefront/src/lib/types/dto/returns.ts`, `src/lib/types/ui/returns.ts`
- Create: `web/almondyoung-storefront/src/lib/api/medusa/return-outcome.ts`(순수, "use server" 아님)
- Create: `web/almondyoung-storefront/src/lib/api/medusa/returns.ts`("use server")
- Test: `web/almondyoung-storefront/src/lib/api/medusa/return-outcome.test.ts`

**Interfaces:**
- Consumes: Task 1 응답, PR 3 라우트 셋.
- Produces:
  - dto: `StoreReturnableResponseDto`, `StoreReturnListResponseDto`, `StoreReturnRequestDto { request_id; items: { item_id; quantity }[]; reason; note? }`, `StoreReturnRequestResponseDto`, `StoreReturnErrorDto { type?; code?; reason?; message? }`
  - ui: `ReturnableLine { itemId; returnableQuantity; windowEndsAt: string | null }`, `CustomerReturnStage`(= N2 넷), `CustomerReturn { returnId; stage; requestedAt; reason; feeBearer; items: { itemId; quantity }[]; canCancel }`, `ReturnRequestInput { requestId; items: { itemId; quantity }[]; reason; note?: string }`
  - `type ReturnRequestOutcome = { kind: 'requested'; returnId: string } | { kind: 'canceled_replay' } | { kind: 'rejected'; reason: string } | { kind: 'unavailable' } | { kind: 'not_found' } | { kind: 'unknown' }`
  - `type ReturnCancelOutcome = { kind: 'canceled' } | { kind: 'rejected'; reason: string } | { kind: 'not_found' } | { kind: 'unknown' }`
  - `return-outcome.ts`: `toReturnRequestBody(input: ReturnRequestInput): StoreReturnRequestDto`, `requestOutcomeFromResponse(res: StoreReturnRequestResponseDto): ReturnRequestOutcome`, `requestOutcomeFromError(status: number | null, data: StoreReturnErrorDto | undefined): ReturnRequestOutcome`, `cancelOutcomeFromError(…)`, `toReturnableLines(dto)`, `toCustomerReturns(dto)`
  - `returns.ts`: `getReturnable(orderId): Promise<ReturnableLine[] | null>`(404 → null), `getOrderReturns(orderId): Promise<CustomerReturn[] | null>`(401 외 모든 실패 → null), `requestReturn(orderId, input): Promise<ReturnRequestOutcome>`, `cancelReturn(orderId, returnId): Promise<ReturnCancelOutcome>`. 넷 다 `api("medusa", …)`, `ApiAuthError` 는 던진다. `status` 는 `HttpApiError.status`, `ApiNetworkError` 는 `null` 로 넘긴다.

- [ ] **Step 1: 실패하는 vitest** — `describe('return-outcome')`
  - `it('200 requested → requested, 200 canceled → canceled_replay')`
  - `it('400 return_rejected → rejected(reason), 502 core_unavailable → unavailable, 404 → not_found')`
  - `it('네트워크(null)·500·코드 없는 400 → unknown')`
  - `it('본문은 snake_case, 빈 메모는 싣지 않고 앞뒤 공백을 지운다')`
  - `it('취소: 400 return_arrived → rejected, 404 → not_found, 500 → unknown')`
- [ ] **Step 2: 실행** — `(cd web/almondyoung-storefront && npx vitest run src/lib/api/medusa/return-outcome.test.ts)` → FAIL.
- [ ] **Step 3: 구현** — 서버 액션은 `cancelOrderByMedusaId` 의 꼴(결과 객체, 인증만 던짐). `encodeURIComponent` 로 id 를 경로에 넣는다.
- [ ] **Step 4: 실행** — PASS.
- [ ] **Step 5: Commit** — `feat(storefront): Medusa 반품 서버 액션과 결과 해석 — 모르는 결과는 unknown (K8 PR8)`

### Task 3: 스토어프론트 — 반품 폼 판정과 사유 표 + 대조 스펙

**Files:**
- Create: `web/almondyoung-storefront/src/domains/order/return-request/return-reasons.ts`
- Create: `web/almondyoung-storefront/src/domains/order/return-request/return-request-form.ts`
- Create: `scripts/storefront/medusa-return-parity.spec.ts`
- Test: `web/almondyoung-storefront/src/domains/order/return-request/return-request-form.test.ts`

**Interfaces:**
- Consumes: Task 2 ui 타입.
- Produces:
  - `return-reasons.ts`: `CUSTOMER_RETURN_REASONS: ReadonlyArray<{ value: string; feeBearer: "customer" | "seller" }>`(N8 다섯, 이 순서: change_of_mind, defective, not_as_described, wrong_item, damaged_in_shipping), `RETURN_REASON_LABEL_KEYS: Record<string, string>`(여섯 → `mypage.order.returnRequest.reason.*` 키), `RETURN_REJECT_MESSAGE_KEYS: Record<string, string>`(16종 → `…returnRequest.reject.*`), `reasonLabelKey(value: string): string`(모르면 `reason.unknown`), `rejectMessageKey(reason: string): string`(모르면 `reject.generic`)
  - `return-request-form.ts`:
    - `type ReturnFormLine = { itemId: string; title: string; variantTitle: string | null; thumbnail: string | null; orderedQuantity: number; returnable: number; windowEndsAt: string | null; blocked: "none" | "nothing_left" | "window_closed" }`
    - `buildReturnFormLines(items: Array<{ id: string; title: string; variantTitle: string | null; thumbnail: string | null; quantity: number }>, returnable: ReturnableLine[], now: Date): ReturnFormLine[]` (N4)
    - `type ReturnSelection = Record<string, number>`, `initialSelection(lines, preselectItemId: string | undefined): ReturnSelection`, `toggleLine(sel, line): ReturnSelection`, `setLineQuantity(sel, line, qty: number): ReturnSelection`(1~returnable 로 자름, 막힌 줄은 그대로)
    - `validateReturnForm(sel: ReturnSelection, reason: string): "select_item" | "select_reason" | null`
    - `feeNotice(reason: string): "customer" | "seller" | null`
    - `type SubmitState = { requestId: string; locked: ReturnRequestInput | null; conflict: boolean }`, `nextSubmitState(state: SubmitState, sent: ReturnRequestInput, outcome: ReturnRequestOutcome, newId: () => string): SubmitState` (N5·N6)

- [ ] **Step 1: 실패하는 vitest** — `describe('return-request-form')`
  - `it('returnable 에 없는 품목은 nothing_left, 기한 지난 줄은 수량이 있어도 window_closed')`
  - `it('itemId 가 고를 수 있는 줄이면 수량 1 로 미리 고르고, 막힌 줄이면 고르지 않는다')`
  - `it('수량은 1~returnable 로 자르고 막힌 줄은 토글·수량이 바뀌지 않는다')`
  - `it('검증: 고른 줄 없음 → select_item, 사유 없음 → select_reason')`
  - `it('feeNotice: change_of_mind → customer, defective → seller, 빈 값 → null')`
  - `it('unknown → 보낸 본문을 잠그고 id 그대로, 다시 unknown 이어도 같은 id·같은 본문')`
  - `it('rejected·unavailable·not_found·canceled_replay → 새 id, 잠금 풀림')`
  - `it('rejected request_id_conflict → conflict true, id 그대로')`
- [ ] **Step 2: 실패하는 대조 스펙**(루트 jest, `REPO` 기준 상대 경로로 두 트리 소스를 텍스트로 읽는다 — `store-order-actions.storefront-parity.spec.ts` 의 `readStringUnion` 을 옮겨 쓴다)
  - `it('스토어프론트 고객 사유 = Medusa customerSelectable 사유, 부담 주체까지 같다')` — Medusa 행은 `/\{ value: '([^']+)', label: '[^']*', feeBearer: '(\w+)', customerSelectable: (true|false) \}/g`, 0 행이면 throw.
  - `it('사유 이름 키가 Medusa 사유 여섯을 전부 덮는다')`
  - `it('거절 문구 키가 Medusa ReturnRejectReason 을 전부 덮는다')`
- [ ] **Step 3: 실행** — vitest FAIL, `npx jest scripts/storefront` FAIL.
- [ ] **Step 4: 구현** — 표의 키 문자열은 Task 4 가 `mypage.json` 에 넣을 키와 같은 이름(`reason.changeOfMind` 꼴 camelCase). 떨어지는 키 `reason.unknown`·`reject.generic` 도 Task 4 가 세 언어에 넣는다.
- [ ] **Step 5: 실행** — 둘 다 PASS. 사유 표에서 한 행을 지워 대조 스펙이 빨개지는지 한 번 본다.
- [ ] **Step 6: Commit** — `feat(storefront): 반품 폼 판정·사유 표, Medusa 정본과 대조 스펙 (K8 PR8)`

### Task 4: 스토어프론트 — 반품 신청 화면, 교환 폼 분리, 옛 API 제거

**Files:**
- Create: `web/almondyoung-storefront/src/domains/order/return-request/return-request-client.tsx`
- Modify: `web/almondyoung-storefront/src/app/[countryCode]/(mypage)/mypage/exchange/page.tsx`(`itemId` 파라미터, `type` 으로 두 클라이언트, 반품은 서버에서 읽기)
- Modify: `web/almondyoung-storefront/src/domains/order/exchange/exchange-client.tsx`(교환 전용 — 반품 갈래·수거 주소 칸·`type` prop 제거)
- Modify: `web/almondyoung-storefront/src/lib/api/orders/store-orders.ts`(`CreateReturnRequestLineDto`·`CreateReturnRequestDto`·`ReturnRequestResponse`·`createReturnRequestByMedusaId` 삭제 — `ReturnReasonCode` 는 교환이 쓴다)
- Modify: `web/almondyoung-storefront/src/i18n/messages/{ko,en,ja}/mypage.json`(`order.returnRequest.*` 추가, 반품 갈래에서만 쓰던 `order.exchange.*` 키 제거)

**Interfaces:**
- Consumes: Task 2 `getReturnable`·`requestReturn`, Task 3 판정·표, `getOrder`(Medusa), `buildAddressLine`, `getThumbnailUrl`.
- Produces: `ReturnRequestClient({ orderId: string; lines: ReturnFormLine[]; preselectItemId?: string; pickupAddress: string | null })`.

- [ ] **Step 1: page** — `type=return` 이면 서버에서 `Promise.all([getOrder(orderId), getReturnable(orderId)])`. 주문이나 `returnable` 이 null 이면 «신청할 수 없는 주문이에요» 화면(Review Focus 4 — 404 와 없는 주문을 가르지 않는다). 품목은 `item.title`·`item.variant_title`·`getThumbnailUrl`·`item.quantity` 로 `buildReturnFormLines(…, new Date())`. 수거지는 `buildAddressLine(order.shipping_address)`(없으면 null). 그 밖의 `type` 은 지금처럼 `ExchangeClient`.
- [ ] **Step 2: 화면** — 위에서 아래로: 상품(체크박스 + 썸네일 + 상품명·옵션 + 주문 수량, 고르면 `NumberStepper`, 막힌 줄은 흐리게 + 이유 한 줄, 고를 수 있는 줄은 기한 한 줄) → 사유 칩 다섯 → 택배비 안내 한 줄(N3, 사유 고른 뒤에만) → 메모(선택, 500자) → 회수지(N1) → 제출 CTA. 고를 줄이 없으면 빈 상태(N4). 제출은 `startTransition` 으로 `requestReturn`; 결과는 `nextSubmitState` 로 상태를 옮기고, `requested` 면 완료 화면(«반품을 접수했어요. 물건이 창고에 도착해 검수를 마치면 환불돼요.» + 주문 상세 링크), `rejected` 는 `rejectMessageKey` 문구 토스트, `unavailable` «잠시 뒤 다시 시도해 주세요», `unknown` 은 잠금 + «다시 보내기», conflict 는 N6 문구 + 주문 상세 링크(버튼 없음). `UNAUTHORIZED` 는 다시 던진다.
- [ ] **Step 3: 교환 폼 정리** — 반품 갈래·`ReturnAddress`·주소 칸 삭제, `type` prop 삭제. 지우는 i18n 키는 세 언어 파일과 `src` 전체를 grep 해 다른 사용처가 없을 때만.
- [ ] **Step 4: 옛 API 삭제** — 지우는 넷의 사용처가 `src` 에 0 인지 grep.
- [ ] **Step 5: 실행** — `npm test` PASS, `npx tsc --noEmit` 개수 기준선과 같고 건드린 파일 에러 0, ko/en/ja `mypage.json` 의 `order.returnRequest` 키 집합이 같은지(`node -e` 로 키 경로를 뽑아 비교).
- [ ] **Step 6: Commit** — `feat(storefront): 반품 신청을 Medusa 반품 라우트로 — 상품 이미지·반품 가능 수량·기한·택배비 안내, 주문 배송지 회수 (K8 PR8, #933)`

### Task 5: 스토어프론트 — 주문 상세 «반품» 칸과 상품별 반품 링크

**Files:**
- Create: `web/almondyoung-storefront/src/domains/order/details/order-returns-view.ts`
- Create: `web/almondyoung-storefront/src/domains/order/details/components/order-returns-section.tsx`
- Modify: `web/almondyoung-storefront/src/app/[countryCode]/(mypage)/mypage/order/details/page.tsx`(`getOrderReturns(orderId)` 를 첫 `Promise.all` 에, 실패는 null)
- Modify: `web/almondyoung-storefront/src/domains/order/details/components/order-details-desktop.tsx`, `order-details-mobile.tsx`(`returns` prop, 칸 배치, 상품 줄 반품 링크)
- Modify: `web/almondyoung-storefront/src/i18n/messages/{ko,en,ja}/mypage.json`(`order.returns.*`)
- Test: `web/almondyoung-storefront/src/domains/order/details/order-returns-view.test.ts`

**Interfaces:**
- Consumes: Task 2 `getOrderReturns`·`cancelReturn`·`CustomerReturn`, Task 3 `reasonLabelKey`·`rejectMessageKey`.
- Produces:
  - `returnStageKey(stage: CustomerReturnStage): string`(`returns.stage.requested` «접수됐어요 · 회수를 기다려요», `processing` «검수를 마쳤어요 · 환불 중이에요», `refunded` «환불했어요», `canceled` «취소했어요»)
  - `returnItemRows(ret: CustomerReturn, items: Array<{ id: string; title: string; variantTitle: string | null }>): Array<{ title: string; variantTitle: string | null; quantity: number }>`(주문에 없는 품목 id 는 빼지 않고 title 빈 문자열)
  - `OrderReturnsSection({ orderId: string; returns: CustomerReturn[]; items: … })` — `returns` 가 비면 아무것도 그리지 않는다.

- [ ] **Step 1: 실패하는 vitest** — `it('단계마다 문구 키')`, `it('품목 줄은 주문 품목 이름·옵션과 반품 수량')`, `it('사유 other 도 이름 키가 있다')`.
- [ ] **Step 2: 실행** — FAIL.
- [ ] **Step 3: 구현** — 반품마다 카드(`border-border rounded-lg`): 접수일(`formatDate`, `KO_DOT`) · 단계 문구 · 품목 줄 · 사유 이름. `canCancel` 이면 Outline [반품 취소] — 한 번 누르면 같은 자리 «한 번 더 누르면 취소돼요», 두 번째에 `cancelReturn`(브라우저 confirm 금지). `canceled` 면 `router.refresh()`, `rejected` 는 `rejectMessageKey` 토스트(`return_arrived` «이미 창고에 도착해 취소할 수 없어요» 등), 그 밖 «잠시 뒤 다시 시도해 주세요». 칸 자리는 결제·배송 정보 아래, 버튼 줄 위(desktop·mobile 같은 순서). `canReturn` 일 때 상품 줄마다 작은 링크 «반품 신청» → `/mypage/exchange?orderId=…&type=return&itemId=<item.id>`.
- [ ] **Step 4: 실행** — `npm test` PASS, tsc 기준선 그대로·건드린 파일 0, 세 언어 키 집합 같음.
- [ ] **Step 5: Commit** — `feat(storefront): 주문 상세 «반품» 칸 — 진행 단계·도착 전 취소, 상품별 반품 신청 링크 (K8 PR8, #934)`

### Task 6: 설계 문서·이슈

**Files:** Modify `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md`

- [ ] **Step 1:** §4.8 «PR 7b 에서 확정한 결과» 뒤에 «PR 8 에서 확정한 결과» — N1(수거지 = 주문 배송지, PR 9 가 그걸 송하인으로), N2(store 읽기 라우트·단계 넷·can_cancel 은 core 를 안 묻는다), N3(금액 없이 사유 규칙), N4(줄·막힘·미리 고르기), N5·N6(요청 id·모르는 결과 잠금·conflict 는 끝), N7(교환 그대로), N8(대조 스펙) 한 줄씩.
- [ ] **Step 2:** §8 PR 8 행의 사는 곳을 `storefront · medusa(store 읽기 라우트 하나)` 로, 비고에 «마이그 없음, 결과는 4.8 의 «PR 8 에서 확정한 결과»».
- [ ] **Step 3: Commit** — `docs(k8): PR 8 에서 확정한 결과 — 스토어프론트 반품 신청·주문 상세 반품 칸`
- [ ] **Step 4 (PR 열 때):** PR 본문에 `Closes #933`. #934 는 반품 쪽만 닫히므로 본문 «정해야 할 것»에 10-28 결정 셋(수거지·금액·상태)을 고쳐 적고, 남은 교환 옵션 변경은 PR 11 로 적는다(이슈는 열어 둔다).

---

## 배포 (PR 본문용)

- **Medusa·스토어프론트 한 `sst deploy`, 마이그 없음.** 스토어프론트가 먼저 떠도 반품 칸은 읽기 실패로 숨고(Review Focus 5), 신청은 PR 3 라우트를 부른다.
- 🔴 **K8 PR 2~7b 가 아직 라이브가 아니다** — 이 PR 은 그 배치에 실리고 그 순서(PR 5·6·6b 의 `migrate → deploy`, 보류·선환불 문은 세 앱 롤아웃 뒤)를 따른다. PR 3 라우트 없이 이 화면만 나가면 신청이 404 로 «신청할 수 없는 주문»이 된다(쓰기 사고 없음).
- 개통 전에는 휴면이다 — 진입 버튼은 core actions 가 배송완료 소포 claimable > 0 일 때만 주고, 셀메이트 시기엔 0 이다(D9). 폼에 직접 들어와도 `returnable` 이 전 줄 0 이라 빈 상태다.
- **동작 변경:** 스토어프론트가 옛 core 반품 API 를 더는 부르지 않는다(늘 400 이던 길, #933). 옛 core 반품 라우트는 호출자 0 으로 남고 PR 10 이 걷는다. 교환은 그대로 옛 core 길.
- ⛔ 스모크: 로컬 E2E 에서 배송완료 주문 하나로 신청 → 주문 상세 칸 «접수됐어요» → 취소 → «취소했어요». 브라우저 로그인은 사람이 한다([[local-e2e-environment]]).
