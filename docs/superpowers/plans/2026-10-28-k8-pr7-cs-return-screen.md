# K8 PR 7 — CS 반품 화면: 목록 · 상세 · 접수 · 도착 전 취소 · PR 6b 의 문 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** admin-web `/cs/return-exchange` 의 반품 탭을 새 반품 기록(`customer_returns`) 위에 다시 짓는다. CS 가 반품을 목록에서 기한 순으로 보고, 주문 목록에서 대리 접수하고, 도착 전에 취소하고, PR 6b 가 연 문(미도착 닫기·보류 정산·선환불·다시 시도·계좌 송금)을 버튼으로 부른다.

**Architecture:** ① 목록·상세는 core 가 준다 — 목록 라우트 하나를 새로 두고(고객명만 `@PiiResponse`), 상세 뷰(`CustomerReturnView`)에 주문번호·품목명·SKU 이름·환불 기한을 더한다. ② 반품을 «만들고 없애는» 두 문(접수·도착 전 취소)과 정산 미리보기는 PR 3·6b 의 Medusa 관리자 라우트를 admin-web Medusa 프록시로 부른다. 그 밖의 CS 문은 전부 PR 6b 의 core 라우트다. ③ 버튼 판정·폼 검증·라벨은 `.ts` 순수 함수로 뽑아 jest 로 검증하고, `.tsx` 는 배선만 둔다(admin-web 에는 렌더러가 없다). ④ PR 6b 가 «PR 7 화면이 출구를 정한다»로 넘긴 `no_charge_shipping_option` 거절에 core 문 하나(보류 차감 빼고 다시 시도)를 더한다.

**Tech Stack:** NestJS + Drizzle(core), `@app/authorization`(`@RequirePermission`·`@PiiResponse`), Next.js admin-web(TanStack Query, shadcn `Sheet`·`Dialog`·`Tabs`, `Can run={…}`), Jest(core unit·`describeIfDb` 통합, admin-web `.ts` 스펙).

**Spec:** `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md` — §4.8(화면 — 문만), §4.3(사다리·도착=환불 기한 시작·«PR 6 / 6b 에서 확정한 결과»), §4.4(«PR 6b 에서 확정한 결과» N2·N9·N16), §8 PR 7. 창고 반품 입고·검수 화면은 **PR 7b**(사용자 결정 2026-10-28: warehouse-app 스테이션, 소포는 «도착 대기 목록 + 검색»으로 찾는다).

## PR 1~6b 본문이 넘긴 것 (이 PR 이 닫는다 / 넘긴다)

| 출처 | 넘긴 것 | 여기서 |
| --- | --- | --- |
| PR 3 #1149 | `GET …/returnable` «PR 7·8 화면용» | 접수 대화상자가 읽는다 — Task 8 |
| PR 5 #1156 | 옛 core 반품 길이 살아 있다 — 개통이 PR 10 보다 먼저면 옛 라우트를 닫아야 한다 | admin-web 의 옛 반품 호출을 0 으로 만든다(라우트 자체는 PR 10) — Task 7·9 |
| PR 6 #1157 (f) | 검수자 id 미저장 «창고 화면(PR 7)과 함께» | **PR 7b** 로 넘긴다(검수를 부르는 화면이 거기다) |
| PR 6b #1158 N9 | 정산 미리보기 «화면 PR 7 용» | 선환불 기본값·보류 정산 참고값 — Task 5·7 |
| PR 6b #1158 | `no_charge_shipping_option` 거절 뒤 core 에 보류 차감을 바꿀 길이 없다 — «PR 7 화면이 출구를 정한다» | 보류 차감 빼고 다시 시도(N7) — Task 4 |
| PR 6b #1158 Q1 | 선환불 뒤 끝내 미도착이면? | **열린 채로 둔다** — 화면은 문이 없는 상태를 보여 줄 뿐(아래 «열린 질문») |

## 코드에서 확인한 것 (develop `9f0480b64`)

- **core 에 목록이 없다.** `customer-returns.controller.ts` 는 `GET :id` 하나와 쓰기 아홉이다. `CustomerReturnView`(`customer-return.reader.ts`)는 주문번호·품목명·SKU 이름이 없다 — `salesOrderId`·`channelOrderItemId`·`skuId` 만.
- **주문 쪽 칼럼.** `sales_orders.display_order_no`(Medusa display_id, 외부 채널은 NULL → `channel_order_id` 로 폴백), `channel_order_id`(Medusa `order_01…`), `sales_channel`, `customer_name`(개인정보). `sales_order_lines.product_name`, `skus.name`·`code`.
- **개인정보 목록의 본보기.** `order-progress.controller.ts` `GET orders`: `@PiiResponse({ fields: { 'items[].customerName': 'name' }, subjects: [{ path: 'items[].salesOrderId', type: 'sales_order' }] })` + `scripts/security/pii-routes.ts` 한 줄.
- **Medusa 라우트(admin, 응답 snake_case, 감싸기 없음).**
  - `GET /admin/orders/:id/returnable` → `{ items: [{ item_id, returnable_quantity, window_ends_at }] }`.
  - `POST /admin/orders/:id/returns` 본문 `{ request_id, items: [{ item_id, quantity }], reason, note?, fee_bearer?, window_override_reason? }` → `{ return_id, request_id, status, items, fee_bearer, window_overridden }`. 400 `{ code: 'return_rejected', reason }`(`ReturnRejectReason` 15종, `plan-return-request.ts:7-22`), 404, 502 `{ type: 'core_unavailable' }`. 기한 넘김은 «고른 줄 중 하나라도 `window_ends_at` 이 지났으면» 사유 필수(`plan-return-request.ts:129-140`). `fee_bearer` 는 사유 `other` 에만 쓰인다.
  - `POST /admin/orders/:id/returns/:return_id/cancel` 본문 없음 → `{ return_id, status }`, 400 reason `return_already_received`·`return_arrived`·`not_our_return`·`return_prepaid`.
  - `GET /admin/orders/:id/returns/:return_id/settlement-preview` → `{ itemValue, feeEstimate, defaultPrepayAmount, prepaidAmount }`, 400 `return_prepay_rejected`, 404.
- **사유 표**(`return-reasons.ts`): `change_of_mind` 단순 변심(customer) · `defective` 상품 하자 · `not_as_described` 상품 설명과 다름 · `wrong_item` 오배송 · `damaged_in_shipping` 배송 중 파손(셋 다 seller) · `other` 기타(operator, CS 가 접수 때 고른다). core enum `customerReturnReasonEnum` 이 같은 집합이다.
- **`no_charge_shipping_option` 은 기록 «전» 거절이다.** `settle-order-return.ts` `receive()` 가 청구 배송 옵션을 수령·기록보다 먼저 정하고 없으면 던진다(`:228-237`). 요청 해시는 기존 기록이 있을 때만 대조하므로(`:172`) 같은 requestId 로 보류 차감을 뺀 요청이 통한다. core 실패 코드는 `return_settle_rejected:no_charge_shipping_option`(`channel-return-settle.manager.ts:84`).
- **다시 시도의 본보기.** `restartSettlement`(`customer-return-settlement.manager.ts:395-440`) 가 `alreadyRefundedAmount` 를 마지막 실패 코드로 거른 뒤 저장된 `command` 를 고쳐 재발행한다.
- **admin-web.** 옛 반품 화면(`features/cs/return-exchange/components/return-requests-table`, 828줄)·훅(`lib/services/return-exchange/mutations.ts`)·클라이언트(`lib/api/domains/return-exchange`)는 옛 core `/admin/return-requests` 를 부른다. 옛 읽기 훅 `useReturnRequests`·`useExchangeRequests` 는 `features/main/template/MainTemplate.tsx`(오늘의 할 일 칩)·`features/statistics/template/overview.tsx` 도 쓴다. `useCreateReturnRequest` 는 호출자 0 이다. 주문 목록(`features/order/history/components/table/index.tsx`)은 행마다 취소 버튼을 `setSelectedOrder(r)`+모달로 연다(`:988-992`), 행 타입 `OrderLineRow` 에 `channel`·`channelOrderId`·`isFirstOfOrder`·`orderNo` 가 있다.
- **admin-web 게이트.** Medusa 호출은 `${MEDUSA_BASE_URL}/…` 문자열을 `medusa-coverage.spec.ts` 가 소스에서 모아 `medusa-permissions.ts` 표와 양방향 대조한다. 뮤테이션 훅은 `useX.permission` 을 선언하고 화면은 `<Can run={useX}>` 로 판정한다(`mutation-guard.gate.spec.ts`, 훅 수 하한 350). 서버 오류는 `parseServerError`(`lib/api/server-error.ts`) — Medusa 의 `reason` 칸은 읽지 않는다.

## 이름 붙은 결정

- **N1. 출처 둘.** 목록·상세·CS 문은 core, 반품을 만들고 없애는 두 문(접수·도착 전 취소)과 정산 미리보기는 Medusa. 반품의 정본이 Medusa 라서 그렇다(PR 3). 접수 뒤 core 목록에는 channel-adapter 폴링(≤ 5분) 뒤에 나타난다 — 접수 성공 안내에 적는다. 도착 전 취소도 같은 지연 뒤에 core 가 `cancelled` 가 된다.
- **N2. 목록 라우트 `GET /admin/customer-returns`.** 쿼리 `bucket: 'open' | 'attention' | 'closed'`(기본 `open`), `q?`(64자까지), `limit` 1~100(기본 50), `offset` ≥ 0. 응답 `{ items: CustomerReturnListItem[], total, attentionCount }`.
  - `open` = `settled`·`cancelled` 가 아닌 것, `attention` = 그중 확인 필요가 하나라도 있는 것. 둘은 진행 중 반품을 전부 읽어 TS 로 판정·정렬한 뒤 자른다 — 진행 중 반품 수는 공정이 묶는다(라이브 0행). 정렬: 환불 기한 이른 순(도착 없음은 뒤) → 요청 이른 순.
  - `closed` 는 SQL 페이지: `coalesce(settled_at, cancelled_at, updated_at) desc`.
  - `attentionCount` 는 bucket 과 무관하게 진행 중 전체에서 센다(대시보드 칩용).
  - `q`: `display_order_no = q` 또는 `channel_order_id = q` 또는 `customer_name ilike '%q%'`.
- **N3. 고객명은 목록에만.** 목록 행 `customerName` 을 `@PiiResponse`(`'items[].customerName': 'name'`, subject `items[].salesOrderId` / `sales_order`)로 가린다. 상세(`GET :id`)는 PR 6 처럼 개인정보 없이 둔다 — 화면은 목록 행의 이름을 쓴다. 그래서 상세 뷰를 돌려주는 쓰기 라우트 아홉도 `@PiiResponse` 가 필요 없다.
- **N4. 환불 기한 = 도착한 KST 날짜의 «다음 날»부터 센 3번째 평일 23:59:59.999 KST.** 초일 불산입(전자상거래법 제18조 ② «반환받은 날부터 3영업일»), 공휴일은 무시(설계 §4.3 «보수적으로 짧게»). 한국은 서머타임이 없어 +9시간 고정 산술로 계산한다(런타임 TZ 에 기대지 않는다 — jest 는 UTC). `refundDueAt` 은 도착한 반품이면 늘 싣고, «기한 지남» 판정만 환불이 나간 반품(`settled`, 선환불 `done`)에서 끈다.
- **N5. 확인 필요 다섯**(고정 순서): `held`(보류 판단) · `settlement_failed`(정산 칸 `refused`·`stalled`) · `prepayment_failed`(선환불 칸 `refused`·`stalled`) · `partial_arrival`(`arrived` 인데 도착 합 < 기대 합이고 줄 `missingQty` 합이 0 — 닫기 전에는 검수가 거절된다) · `refund_overdue`. 선환불 뒤 미도착(Q1)은 넣지 않는다 — 누를 문이 없다([[ui-minimal-text]]: 정상은 숨기고 할 일만 드러낸다).
- **N6. 상세 뷰를 넓힌다(추가만).** `CustomerReturnView` 에 `order: { orderNo, channelOrderId, salesChannel }`, `windowOverrideReason`, `cancelledAt`, `refundDueAt`, 줄 `productName`, SKU 항목 `skuName`·`skuCode`. 매니저들이 돌려주는 뷰가 전부 이것이라 PR 7b 창고 화면도 같은 이름을 쓴다.
- **N7. 보류 차감 빼고 다시 시도.** `POST …/settlement/retry` 본문에 `dropHoldDeduction?: true`. 마지막 실패 코드가 정확히 `return_settle_rejected:no_charge_shipping_option` 일 때만 받고(아니면 400), `alreadyRefundedAmount` 와 함께 오면 400(두 출구는 실패 코드가 달라 함께 성립하지 않는다). 저장된 `command.holdDeduction` 을 지우고 `cs_resolution.hold.dropped = { by, at }` 를 남긴다(jsonb 칸, 마이그 없음). Medusa 메시지 «차감 없이 정산하거나 수동으로 처리하세요» 중 시스템 안의 출구는 이것 하나다 — wallet 직접 환불은 운영 규칙상 금지(설계 §4.4).
- **N8. 접수는 주문 목록 행에서 연다.** 자사몰(`channel === 'medusa'`) 주문의 첫 줄에 [반품 접수] 버튼. 대화상자는 Medusa 주문 품목(`getOrderById`)과 `returnable` 을 읽고, `request_id` 는 대화상자를 열 때 `crypto.randomUUID()` 로 한 번 만든다 — 같은 제출을 다시 눌러도 같은 반품이다. 반품 화면에는 접수 버튼을 따로 두지 않는다(주문을 찾는 길은 이미 주문 목록이다).
- **N9. 버튼 판정은 순수 함수 하나 `availableCustomerReturnActions(view)`.** 서버의 거절 조건 중 뷰로 알 수 있는 것만 미리 거르고(아래 표), 나머지 거절은 서버 문구를 그대로 토스트한다.

  | 동작 | 보이는 조건 | 권한 |
  | --- | --- | --- |
  | 도착 전 취소 (Medusa) | `expected` · 선환불 `done` 아님 | `order.claim.write` |
  | 미도착으로 닫기 | `arrived` · 도착 합 < 기대 합 · `missingQty` 합 0 · 선환불이 `in_progress`·`stalled`·`done` 아님 | `order.claim.write` |
  | 보류 정산 | `held` | `payment.refund.execute` |
  | 선환불 | `expected`·`arrived` · `missingQty` 합 0 · (선환불 없음 또는 `refused` 이고 실패 코드가 `return_prepay_rejected:` 로 시작) | `payment.refund.execute` |
  | 정산 다시 시도 | `inspected`·`refund_pending` · 정산 `refused`·`stalled`. 실패 코드가 `return_settle_rejected:external_refund_` 로 시작하면 «이미 환불한 금액» 칸, `…:no_charge_shipping_option` 이면 «보류 차감 빼기» | `payment.refund.execute` |
  | 정산 계좌 송금 | 위와 같고 정산 `refundMode` 가 `manual` 아님 | `payment.refund.execute` |
  | 선환불 다시 시도 · 계좌 송금 | `expected`·`arrived` · 선환불 `refused`·`stalled` · 실패 코드가 `return_prepay_rejected:` 로 시작하지 않음(그건 새 금액으로 «선환불»). 계좌 송금은 `refundMode` 가 `manual` 아님 | `payment.refund.execute` |

- **N10. 교환 탭은 그대로.** 옛 core 교환(라이브 0행)은 PR 11 이 다시 짓는다 — 대시보드의 교환 칩이 `?tab=exchanges` 로 온다. 옛 반품 표·뮤테이션 훅·돈 계산(`admin-refund-amount`·`return-attempt-view-model`)·옛 반품 클라이언트 함수는 지운다. 옛 core 반품 라우트와 admin-web `/inventory/returns`(옛 inventory 반품 화면, 설계 §4.8 «지운다»)는 PR 10 이 옛 코드와 함께 걷는다.
- **N11. 대시보드·통계의 «반품» 칸은 새 목록으로.** 오늘의 할 일 칩: 숫자 = `open` 의 `total`, 둘째 = `attentionCount`(«확인 필요», `?bucket=attention`). 통계 개요 «반품 접수» 타일도 `open` total. **DailyBoards 의 일별 반품 수는 그대로**(core 일별 통계가 옛 표를 센다 — 설계 §5 «다시 잇는 곳», PR 10).
- **N12. 새 권한 키 없음.** 화면 진입 `order.claim.read`(그대로). Medusa 프록시 표: `GET admin/orders/:id/returnable`·`GET admin/orders/:id/returns/:id/settlement-preview` → `order.claim.read`, `POST admin/orders/:id/returns`·`POST admin/orders/:id/returns/:id/cancel` → `order.claim.write`.

## 열린 질문 (계획 검토 때 답한다)

- **Q1(PR 6b 에서 이어짐). 선환불했는데 물건이 끝내 안 오면?** 이 계획은 답을 기다린다 — 화면은 그 반품을 `expected`/`arrived` 로 진행 중 목록에 두고 버튼은 없다(N5·N9). 답이 «손실로 닫기»면 core 문 하나와 이 화면 버튼 하나가 뒤 PR 에 는다.

## Global Constraints

- 사는 곳: `apps/core`(읽기 넓히기·목록 라우트·다시 시도 칸 하나, **마이그 없음**), `apps/admin-web`, `scripts/security/pii-routes.ts`, 문서(설계 §4.3·§4.8·§8).
- core 레이어: 컨트롤러 → `CustomerReturnService`(위임만) → reader/manager. `dbService.run(fn, tx)`, 공개 메서드 마지막 인자 `tx?: DbTx`, `db.query.*`·`any`·`as` 금지(drizzle `select().from().innerJoin()`), 오류는 `@app/shared`. 조인 없는 select 의 상관 서브쿼리 금지 — group by 를 따로 읽는다(`customer-return.reader.ts` `itemsOf` 주석의 함정).
- admin-web: 판정·검증·라벨은 `.ts`, `.tsx` 는 배선만. `.ts` 판정 모듈과 그 스펙은 앱 전용 패키지(`@tanstack/*`·`next/*`·`sonner` 등)를 **값으로** import 하지 않는다(`import type` 만) — CI 의 루트 jest 에서만 죽는다. `@/` 별칭은 루트 jest 가 푼다. core 응답 타입은 `lib/types/dto/customer-returns.ts` 에 손으로 미러한다(컴파일러가 드리프트를 못 잡는다 — Task 5 가 core 뷰 이름과 한 줄씩 맞춘다). TanStack 쿼리 키에 `undefined` 를 넣지 않는다(무효화가 조용히 안 걸린다).
- 화면 문구: 필요한 것만, 정상 상태는 숨긴다([[ui-minimal-text]]). 금액은 `toLocaleString('ko-KR')` + «원». 시각은 KST.
- 게이트:
  - `npm run type-check` 0 — **admin-web 을 안 본다.** admin-web 은 `cd apps/admin-web && npx tsc --noEmit`(기준선은 `sanitize-html` 미설치 1건이 나올 수 있다 — develop 에서 먼저 재고 같은 수인지 본다).
  - `npx jest apps/core/src/modules/sales-order scripts/security apps/admin-web/src/features/cs apps/admin-web/src/lib/auth "apps/admin-web/src/app/api/proxy" apps/admin-web/src/features/main` 실패 0(core 통합은 skip). 루트 `npx jest` 의 admin-web 근태 4건(ICU)은 범위 밖.
  - core 통합: scratch DB 에 `DATABASE_URL` 주입, `npx jest apps/core/src/modules/sales-order/customer-return --runInBand`.
  - `.tsx` 는 `npm run lint` 글롭 밖이다 — 바꾼 `.tsx` 는 `cd apps/admin-web && npx eslint <파일>`.

## Review Focus

1. **환불 기한이 KST 자정과 주말을 넘는다.** 일요일 23:30 KST 도착 → 수요일 끝, 월요일 00:30 KST 도착 → 목요일 끝, 금·토·일 도착 → 다음 수요일 끝(공휴일 무시). — Task 1 단위.
2. **목록이 상태 경계를 지킨다.** `refund_pending`·`held`·`inspected` 는 진행 중에 남고 `settled`·`cancelled` 만 닫힘으로 간다. 미도착으로 닫은 뒤 검수 전 반품은 `partial_arrival` 이 아니다. — Task 1 단위 + Task 3 통합.
3. **고객명이 가려진다.** 목록 라우트가 `@PiiResponse` 없이 나가면 `pii-routes.spec.ts` 가 빨갛다 — 줄만 더하고 데코레이터를 잊는 경우까지. — Task 3.
4. **보류 차감 빼기는 그 실패에만.** 외부 환불 거절·모르는 실패·`stalled` 에 `dropHoldDeduction` → 400, 저장된 명령 그대로. 받은 뒤 크론 재발행도 차감 없는 명령을 싣는다. — Task 4 통합.
5. **기한 넘김 접수.** 고른 줄 중 하나라도 기한이 지났는데 사유 칸이 비면 제출 전에 막고, 기한 안의 줄만 고르면 사유 칸을 묻지 않는다. 사유 `other` 는 부담 주체 없이는 막는다. 반품 가능 수량을 넘는 입력은 막는다. — Task 8 단위.

---

### Task 1: core — 환불 기한과 «확인 필요» 판정

**Files:**
- Create: `apps/core/src/modules/sales-order/customer-return/customer-return-attention.ts`
- Test: `apps/core/src/modules/sales-order/customer-return/customer-return-attention.spec.ts`

**Interfaces:**
- Produces:
  - `refundDueAt(arrivedAt: Date): Date` (N4)
  - `type CustomerReturnAttention = 'held' | 'settlement_failed' | 'prepayment_failed' | 'partial_arrival' | 'refund_overdue'`
  - `type CustomerReturnAttentionInput = { status: CustomerReturnStatus; arrivedAt: Date | null; settlementState: CustomerReturnSettlement['state'] | null; prepaymentState: CustomerReturnPrepayment['state'] | null; expectedQty: number; arrivedQty: number; missingQty: number }`
  - `customerReturnAttention(input: CustomerReturnAttentionInput, now: Date): CustomerReturnAttention[]` — N5 의 고정 순서

- [ ] **Step 1: 실패하는 스펙**
  - `refundDueAt`: `'2026-10-26T03:00:00Z'`(월) → `'2026-10-29T14:59:59.999Z'`(목). `'2026-10-30T03:00:00Z'`(금)·`'2026-10-31T03:00:00Z'`(토)·`'2026-11-01T03:00:00Z'`(일) → 셋 다 `'2026-11-04T14:59:59.999Z'`(수). `'2026-10-25T14:30:00Z'`(일 23:30 KST) → `'2026-10-28T14:59:59.999Z'`. `'2026-10-25T15:30:00Z'`(월 00:30 KST) → `'2026-10-29T14:59:59.999Z'`.
  - `customerReturnAttention`: `held` → `['held']`. 정산 `stalled` + 기한 지남 → `['settlement_failed', 'refund_overdue']`. `arrived`·기대 2·도착 1·missing 0 → `['partial_arrival']`, 같은데 missing 1 → `[]`. 기한 지난 `settled` → `[]`. 기한 지났지만 선환불 `done` → `[]`. 기한 전(now = 기한 그 밀리초) → `[]`, 1ms 뒤 → `['refund_overdue']`. 선환불 `refused` → `['prepayment_failed']`. 도착 없음(`expected`) → `refund_overdue` 없음.
- [ ] **Step 2: 실행** — `npx jest apps/core/src/modules/sales-order/customer-return/customer-return-attention` → FAIL(모듈 없음).
- [ ] **Step 3: 구현** — KST 날짜는 `arrivedAt + 9h` 의 UTC 날짜, 평일 셋째 날의 KST 23:59:59.999 = 그 날짜 UTC `14:59:59.999`.
- [ ] **Step 4: 실행** — PASS. `TZ=Asia/Seoul npx jest …customer-return-attention` 도 PASS(런타임 TZ 무관).
- [ ] **Step 5: Commit** — `feat(core): 반품 환불 기한(도착 다음 날부터 3평일, KST)과 확인 필요 판정 (K8 PR7)`

### Task 2: core — 상세 뷰에 주문번호·품목명·SKU 이름·기한

**Files:**
- Modify: `apps/core/src/modules/sales-order/customer-return/customer-return.reader.ts`
- Test: `apps/core/src/modules/sales-order/customer-return/customer-return.reader.integration.spec.ts` (Create)

**Interfaces:**
- Consumes: Task 1 `refundDueAt`.
- Produces: `CustomerReturnView` 에 추가(N6) — `order: { orderNo: string; channelOrderId: string; salesChannel: string }`(`orderNo = display_order_no ?? channel_order_id`), `windowOverrideReason: string | null`, `cancelledAt: string | null`, `refundDueAt: string | null`, `lines[].productName: string`, `lines[].items[].skuName: string`, `lines[].items[].skuCode: string`. 기존 칸·순서는 그대로.

- [ ] **Step 1: 실패하는 통합 스펙** — 픽스처는 `customer-return-cs.manager.integration.spec.ts` 의 `seed` 꼴(`seedWorld`·`seedDeliveredLine`·`intake.recordRequested`·도착)을 이 파일에 옮겨 쓴다(공용화는 하지 않는다), `inRollbackTx`.
  - `it('상세가 주문번호·채널 주문 id·판매 채널·줄 품목명·SKU 이름·코드를 싣는다')` — `display_order_no` 를 `'3900'` 으로 둔 주문 → `order.orderNo === '3900'`, NULL 로 두면 `channelOrderId`.
  - `it('도착 전엔 refundDueAt 이 null, 도착하면 첫 도착 시각으로 계산한 값')` — `arrivedAt` 을 `'2026-10-26T03:00:00Z'` 로 고정해 `'2026-10-29T14:59:59.999Z'`.
  - `it('기한 넘김 사유와 취소 시각을 싣는다')`.
- [ ] **Step 2: 실행** — `DATABASE_URL=<scratch> npx jest apps/core/src/modules/sales-order/customer-return/customer-return.reader --runInBand` → FAIL.
- [ ] **Step 3: 구현** — 기록 행과 `sales_orders` 를 innerJoin, 줄은 `sales_order_lines` 를, SKU 항목은 `skus` 를 innerJoin.
- [ ] **Step 4: 실행** — PASS. 같은 폴더 통합 전부(`… customer-return --runInBand`) PASS — 매니저 스펙이 뷰를 통째로 `toEqual` 하면 새 칸 때문에 깨질 수 있다, 그 스펙은 새 칸을 더해 고친다(판정은 바꾸지 않는다).
- [ ] **Step 5: Commit** — `feat(core): 반품 상세 뷰가 주문번호·품목명·SKU 이름·환불 기한을 싣는다 (K8 PR7)`

### Task 3: core — 반품 목록 라우트

**Files:**
- Modify: `customer-return.reader.ts`(+`list`), `customer-return.service.ts`(+`list`), `customer-returns.controller.ts`(+`GET`)
- Create: `apps/core/src/modules/sales-order/customer-return/dto/list-customer-returns.dto.ts`
- Modify: `scripts/security/pii-routes.ts` (`'core GET /admin/customer-returns'`)
- Test: `customer-return.reader.integration.spec.ts`(Task 2 파일에 `describe` 추가)

**Interfaces:**
- Consumes: Task 1 `customerReturnAttention`·`refundDueAt`.
- Produces:
  - `ListCustomerReturnsQueryDto { bucket: 'open' | 'attention' | 'closed' = 'open'; q?: string; limit: number = 50; offset: number = 0 }` — `@IsIn`·`@IsOptional @IsString @MaxLength(64)`·`@Type(() => Number) @IsInt @Min(1) @Max(100)`·`@Min(0)`.
  - `type CustomerReturnListItem = { id; salesOrderId; orderNo; channelOrderId; customerName: string | null; status; reason; feeBearer; requestedBy; requestedAt: string; arrivedAt: string | null; refundDueAt: string | null; settledAt: string | null; cancelledAt: string | null; quantity: number /* 줄 수량 합 */; productSummary: string /* 첫 줄 품목명, 줄이 더 있으면 « 외 N건» */; refundAmount: number | null /* settlementOutcome.refundAmount */; attention: CustomerReturnAttention[] }`
  - `type CustomerReturnListPage = { items: CustomerReturnListItem[]; total: number; attentionCount: number }`
  - `CustomerReturnReader.list(query: ListCustomerReturnsQueryDto, now: Date, tx?: DbTx): Promise<CustomerReturnListPage>`, `CustomerReturnService.list(query, now?)`(기본 `new Date()`).
  - 라우트: `@PiiResponse({ fields: { 'items[].customerName': 'name' }, subjects: [{ path: 'items[].salesOrderId', type: 'sales_order' }] })` `@RequirePermission('order.claim.read')` `@Get()` — `@Get(':id')` 위에 둔다.

- [ ] **Step 1: 실패하는 스펙**
  - 통합: `it('open 은 settled·cancelled 를 빼고 기한 이른 순, 도착 없는 반품은 뒤')`, `it('attention 은 확인 필요가 있는 것만, attentionCount 는 세 bucket 에서 같다')`, `it('held·refund_pending·inspected 는 open 에 남는다')`, `it('closed 는 끝난 순 최신부터, limit·offset 이 자른다')`, `it('q 는 주문번호 정확 일치·채널 주문 id 정확 일치·고객명 부분 일치')`, `it('행이 orderNo·customerName·quantity·productSummary·refundAmount 를 싣는다')` — 줄 둘이면 `'<첫 품목> 외 1건'`.
  - 가드: `npx jest scripts/security` 가 라우트를 찾는다(데코레이터·`pii-routes.ts` 줄 둘 중 하나라도 빠지면 빨강).
- [ ] **Step 2: 실행** — 통합 → FAIL.
- [ ] **Step 3: 구현** — 진행 중 반품 합계(기대·도착·missing)는 반품 id 로 group by 한 쿼리 둘로 읽는다(N2·Global Constraints 의 함정). 진행 중이 500 행을 넘으면 `logger.warn` 한 번(잘라 내지 않는다).
- [ ] **Step 4: 실행** — 통합 PASS, `npx jest apps/core/src/modules/sales-order scripts/security` 0, `npm run type-check` 0.
- [ ] **Step 5: Commit** — `feat(core): 반품 목록 GET /admin/customer-returns — 진행 중·확인 필요·끝남, 고객명은 가린다 (K8 PR7)`

### Task 4: core — 보류 차감 빼고 다시 시도

**Files:**
- Modify: `customer-return-settlement.manager.ts`(`RestartCustomerReturnInput`·`restart`·`restartSettlement`), `customer-return.types.ts`(`CustomerReturnCsResolution.hold.dropped?`), `dto/customer-return-cs.dto.ts`(`RetryCustomerReturnSettlementDto`), `customer-returns.controller.ts`(`retrySettlement` 이 칸을 넘긴다)
- Test: `customer-return-settlement.manager.integration.spec.ts`

**Interfaces:**
- Produces: `RestartCustomerReturnInput.dropHoldDeduction?: true`, `RetryCustomerReturnSettlementDto.dropHoldDeduction?: boolean`(`@IsOptional @IsBoolean`, `false` 는 없는 것과 같다), `CustomerReturnCsResolution['hold']` 에 `dropped?: { by: string; at: string }`. 상수 `NO_CHARGE_SHIPPING_OPTION_FAILURE = 'return_settle_rejected:no_charge_shipping_option'`.

- [ ] **Step 1: 실패하는 통합 스펙** — 보류 정산(차감 5,000)을 연 뒤 실패 사실 `return_settle_rejected:no_charge_shipping_option`(retryable false, received false)로 `refused` 를 만든다.
  - `it('보류 차감을 빼고 다시 내면 명령에 holdDeduction 이 없고 cs_resolution.hold.dropped 가 남는다')` — `SettleChannelReturn` 1건 더, payload 에 `holdDeduction` 없음, `settlement.command.holdDeduction` 없음, `hold.deduction` 은 5,000 그대로.
  - `it('그 뒤 크론 재발행도 차감 없는 명령')`.
  - `it('다른 실패(external_refund_unresolved·모르는 코드)나 stalled 에선 400, 저장된 명령 그대로')`.
  - `it('alreadyRefundedAmount 와 함께면 400')`, `it('선환불 target·계좌 송금 kind 에선 400')`.
- [ ] **Step 2: 실행** — scratch DB → FAIL.
- [ ] **Step 3: 구현** — `restart()` 의 입력 검사에 `alreadyRefundedAmount` 와 나란히 넣고, `restartSettlement` 에서 `command` 를 복사해 `holdDeduction` 을 지운 뒤 같은 트랜잭션에서 `cs_resolution` 을 고친다.
- [ ] **Step 4: 실행** — PASS, 같은 폴더 통합·`npx jest apps/core/src/modules/sales-order scripts/security` 0.
- [ ] **Step 5: Commit** — `feat(core): 보류 차감을 붙일 배송 방법이 없는 정산을 차감 없이 다시 낸다 (K8 PR7, PR6b 잔여)`

### Task 5: admin-web — 타입 미러 · 클라이언트 · 쿼리·뮤테이션 훅 · Medusa 프록시 표

**Files:**
- Create: `apps/admin-web/src/lib/types/dto/customer-returns.ts`, `apps/admin-web/src/lib/api/domains/customer-returns/index.ts`, `apps/admin-web/src/lib/services/customer-returns/{index,query-keys,queries,mutations}.ts`
- Modify: `apps/admin-web/src/app/api/proxy/medusa/[...path]/medusa-permissions.ts`(N12 의 넷)
- Test: `apps/admin-web/src/lib/services/customer-returns/query-keys.spec.ts`

**Interfaces:**
- Consumes: Task 2·3·4 의 core 모양, Medusa 라우트 넷(«코드에서 확인한 것»).
- Produces:
  - 타입: `CustomerReturnView`·`CustomerReturnListItem`·`CustomerReturnListPage`·`CustomerReturnStatus`·`CustomerReturnReason`·`CustomerReturnAttention`·`CustomerReturnSettlement`·`CustomerReturnPrepayment`·`CustomerReturnCsResolution`·`CustomerReturnListQuery { bucket; q?; limit?; offset? }` — core 이름·칸 그대로. Medusa: `OrderReturnable { items: Array<{ item_id: string; returnable_quantity: number; window_ends_at: string | null }> }`, `RequestOrderReturnBody`, `RequestOrderReturnResult`, `ReturnRejectReason`(Medusa `plan-return-request.ts:7-22` 의 15종 그대로), `ReturnSettlementPreview { itemValue; feeEstimate; defaultPrepayAmount; prepaidAmount }`.
  - `customerReturnApi`: core `list(q)`·`get(id)`·`closeMissing(id, { memo })`·`settleHeld(id, { deduction, memo })`·`requestPrepay(id, { amount?, refundMode?, memo })`·`restart(id, target: 'settlement' | 'prepayment', kind: 'retry' | 'manual', body?: { alreadyRefundedAmount?: number | null; dropHoldDeduction?: true })`. Medusa(`${MEDUSA_BASE_URL}/admin/orders/${orderId}/…`) `returnable(orderId)`·`request(orderId, body)`·`cancel(orderId, returnId)`·`settlementPreview(orderId, returnId)`.
  - `customerReturnQueryKeys`: `all = ['customer-returns']`, `list(q)`(정규화된 q — 빈 값 칸은 빼고), `detail(id)`, `preview(orderId, returnId)`, `returnable(orderId)`.
  - 쿼리: `useCustomerReturns(q, { enabled? })`(`placeholderData: keepPreviousData`, `staleTime` 30초), `useCustomerReturn(id | null)`, `useReturnSettlementPreview(orderId, returnId, { enabled })`, `useOrderReturnable(orderId | null)`.
  - 뮤테이션(성공하면 `all` 무효화): `useRequestCustomerReturn` · `useCancelCustomerReturn` · `useCloseCustomerReturnMissing` → `.permission = ['order.claim.write']`. `useSettleHeldCustomerReturn` · `useRequestCustomerReturnPrepay` · `useRestartCustomerReturn` → `['payment.refund.execute']`.
- [ ] **Step 1: 실패하는 스펙** — `query-keys.spec.ts`: `list({ bucket: 'open', q: '' })` 와 `list({ bucket: 'open' })` 가 같은 키, 어떤 키에도 `undefined` 원소가 없다, 전부 `all` 로 시작한다.
- [ ] **Step 2: 실행** — `npx jest apps/admin-web/src/lib/services/customer-returns` → FAIL.
- [ ] **Step 3: 구현** — 타입 미러는 core `CustomerReturnView`·`CustomerReturnListItem` 정의를 옆에 두고 칸마다 맞춘다.
- [ ] **Step 4: 실행** — PASS. `npx jest "apps/admin-web/src/app/api/proxy" apps/admin-web/src/lib/auth` 0(커버리지·뮤테이션 게이트), `cd apps/admin-web && npx tsc --noEmit` 기준선.
- [ ] **Step 5: Commit** — `feat(admin-web): 새 반품 기록 클라이언트·훅과 Medusa 반품 라우트 프록시 권한 (K8 PR7)`

### Task 6: admin-web — 라벨과 버튼 판정

**Files:**
- Create: `apps/admin-web/src/features/cs/return-exchange/customer-return-labels.ts`, `…/customer-return-actions.ts`
- Test: `…/customer-return-labels.spec.ts`, `…/customer-return-actions.spec.ts`

**Interfaces:**
- Consumes: Task 5 타입(`import type`).
- Produces:
  - 라벨 `Record<Union, string>` 넷: 상태(`expected` 도착 대기 · `arrived` 도착 · `inspected` 정산 중 · `held` 환불 보류 · `refund_pending` 환불 실패 · `settled` 환불 완료 · `cancelled` 취소), 사유(Medusa 사유 표의 이름), 부담 주체(`customer` 고객 · `seller` 판매자), 확인 필요(`held` 보류 판단 · `settlement_failed` 정산 실패 · `prepayment_failed` 선환불 실패 · `partial_arrival` 덜 도착 · `refund_overdue` 환불 기한 지남). `RETURN_REASON_OPTIONS`(표 순서, `customerSelectable` 없음 — CS 는 여섯 다).
  - `type CustomerReturnAction = { kind: 'cancel' | 'closeMissing' | 'settleHeld' | 'prepay' | 'retrySettlement' | 'manualSettlement' | 'retryPrepayment' | 'manualPrepayment'; needs?: 'alreadyRefundedAmount' | 'dropHoldDeduction' }`
  - `availableCustomerReturnActions(view: CustomerReturnView): CustomerReturnAction[]` — N9 표, 표의 행 순서.
- [ ] **Step 1: 실패하는 스펙**
  - 라벨: 네 맵의 키 집합이 각 유니온 전체와 같다(CI 는 admin-web tsc 를 안 돌린다 — 이 단언이 유일한 방어선).
  - 판정: N9 표의 행마다 «보인다» 하나·«안 보인다» 하나. 추가로 `expected` + 선환불 `done` → 취소·선환불 둘 다 없음. `arrived` 덜 도착 + 선환불 `in_progress` → 닫기 없음. 정산 `refused` + `…:external_refund_unresolved` → `retrySettlement` 의 `needs: 'alreadyRefundedAmount'`, `…:no_charge_shipping_option` → `needs: 'dropHoldDeduction'`. 선환불 `refused` + `return_prepay_rejected:prepay_exceeds_item_value` → `prepay` 있음·`retryPrepayment` 없음, `wallet_refund_refused:x` → 반대. `settled`·`cancelled` → `[]`.
- [ ] **Step 2: 실행** — `npx jest apps/admin-web/src/features/cs/return-exchange` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 실행** — PASS.
- [ ] **Step 5: Commit** — `feat(admin-web): 반품 상태·사유·확인 필요 라벨과 CS 버튼 판정 (K8 PR7)`

### Task 7: admin-web — 반품 탭 다시 짓기

**Files:**
- Create: `apps/admin-web/src/features/cs/return-exchange/components/customer-returns-table/index.tsx`, `…/components/customer-return-sheet/index.tsx`, `…/components/customer-return-action-dialog/index.tsx`
- Modify: `apps/admin-web/src/features/cs/return-exchange/template/index.tsx`
- Delete: `…/components/return-requests-table/`, `…/admin-refund-amount.ts`(+spec), `…/return-attempt-view-model.ts`(+spec), `apps/admin-web/src/lib/services/return-exchange/mutations.ts` 의 반품 훅 전부(교환 훅은 남긴다)

**Interfaces:**
- Consumes: Task 5 훅, Task 6 라벨·`availableCustomerReturnActions`.

- [ ] **Step 1: 템플릿** — 탭 둘: «반품»(새 표) · «교환»(옛 `ExchangeRequestsTable` 그대로, `?tab=exchanges`). 반품 탭은 `?bucket=` 로 «진행 중 / 확인 필요(N) / 끝남» 셋과 검색칸 하나(`q`, 주문번호·고객명). 옛 상태 셀렉트·접수일 칩은 교환 탭에만 남긴다.
- [ ] **Step 2: 표** — 칸: 주문번호 · 고객 · 품목(`productSummary` · 수량) · 사유 · 상태(라벨 + 확인 필요 배지, 없으면 배지 없음) · 요청일 · 환불 기한(도착한 반품만, `refund_overdue` 면 빨강). 행을 누르면 시트. 끝남 bucket 만 페이지 넘김.
- [ ] **Step 3: 시트** — `useCustomerReturn(id)`. 머리: 주문번호(주문 목록 링크 `/order/history?q=<orderNo>` — 그 화면의 검색 파라미터 이름을 확인해 맞춘다)·상태·사유·부담 주체·요청자(고객/CS)·기한 넘김 사유. 줄 표: 품목명 · 수량 · 미도착 수 · SKU 항목(이름 · 기대 · 도착 · 양품 · 불량 · 보류). 돈: 정산 결과(환불액·차감 명세·`feeNotAdjusted` 면 «택배비 미조정»)·선환불(금액·상태)·마지막 실패 문구(정산·선환불 칸이 `refused`·`stalled` 일 때만). 아래에 `availableCustomerReturnActions(view)` 의 버튼을 `<Can run={…}>` 로 감싸 그린다.
- [ ] **Step 4: 동작 대화상자 하나** — `kind` 별 입력: 취소(확인만), 미도착 닫기(메모), 보류 정산(차감액 0 이상 정수 + 메모, 미리보기의 품목 값·택배비 예상을 참고로), 선환불(금액 — 미리보기 `defaultPrepayAmount` 로 채움, 1~`itemValue` · 환불 방식 auto/manual · 메모), 정산 다시 시도(`needs` 에 따라 «이미 환불한 금액» 칸 또는 «보류 차감 빼기» 확인), 계좌 송금 둘·선환불 다시 시도(확인만). 미리보기는 선환불·보류 정산 대화상자가 열릴 때만 부른다. 실패는 `parseServerError(e).message` 토스트, 성공은 시트를 새 뷰로.
- [ ] **Step 5: 옛 반품 코드 지우기** — 지운 뒤 `grep -rn "return-requests-table\|useApproveReturn\|useCompleteReturnWithAmount\|admin-refund-amount\|return-attempt-view-model" apps/admin-web/src` 0.
- [ ] **Step 6: 검증** — `cd apps/admin-web && npx tsc --noEmit` 기준선, 바꾼 `.tsx` 는 `npx eslint <파일>`, `npx jest apps/admin-web/src/lib/auth apps/admin-web/src/features/cs` 0(뮤테이션 게이트가 시트·대화상자의 `run=` 판정을 본다. 훅 수 하한 350 이 깨지면 하한을 실제 수 아래로 고치지 말고 보고한다).
- [ ] **Step 7: Commit** — `feat(admin-web): CS 반품 탭을 새 반품 기록으로 — 목록·상세·도착 전 취소·미도착 닫기·보류 정산·선환불·다시 시도 (K8 PR7)`

### Task 8: admin-web — 주문 목록에서 반품 접수

**Files:**
- Create: `apps/admin-web/src/features/cs/return-exchange/return-request-form.ts`(+spec), `…/components/request-return-dialog/index.tsx`
- Modify: `apps/admin-web/src/features/order/history/components/table/index.tsx`(버튼 + 대화상자 마운트)

**Interfaces:**
- Consumes: Task 5 `useOrderReturnable`·`useRequestCustomerReturn`·`medusaOrderApi.getOrderById`(품목 이름, `lib/api/domains/medusa`), Task 6 `RETURN_REASON_OPTIONS`.
- Produces:
  - `type ReturnRequestForm = { quantities: Record<string, number>; reason: string; note: string; feeBearer: 'customer' | 'seller' | null; windowOverrideReason: string }`
  - `buildReturnRequestBody(form: ReturnRequestForm, returnable: OrderReturnable, requestId: string, now: Date): { ok: true; body: RequestOrderReturnBody } | { ok: false; error: string }`
  - `windowOverrideNeeded(form, returnable, now): boolean` — 대화상자가 사유 칸을 보일지 정한다.
  - `returnRejectMessage(error: unknown): string` — Medusa 400 `reason` 15종 → 한국어(`Record<ReturnRejectReason, string>`), 502 `core_unavailable` → «주문 확인이 잠시 안 됩니다. 잠시 뒤 다시 시도하세요», 그 밖은 `parseServerError` 문구.
- [ ] **Step 1: 실패하는 스펙** — 수량 0 뿐 → 오류. 반품 가능 수량 초과 → 오류. 사유 없음 → 오류. `other` + 부담 주체 없음 → 오류, `other` 아니면 `fee_bearer` 를 싣지 않는다. 고른 줄 하나라도 `window_ends_at < now` 인데 사유 칸 공백 → 오류, 기한 안의 줄만 고르면 `window_override_reason` 을 싣지 않는다(`windowOverrideNeeded` false). 수량 0 인 줄은 `items` 에서 뺀다. `note` 공백이면 싣지 않는다. `returnRejectMessage` 맵의 키 집합 = 15종 전체.
- [ ] **Step 2: 실행** — FAIL.
- [ ] **Step 3: 구현 — 순수 함수.**
- [ ] **Step 4: 대화상자** — 열 때 `requestId = crypto.randomUUID()` 를 `useState` 초기값으로(N8). 줄마다 품목명 · 반품 가능 수량 · 수량 입력(0~가능), 사유 셀렉트, `other` 면 부담 주체 라디오, `windowOverrideNeeded` 면 기한 넘김 사유, 메모. 반품 가능 수량이 전부 0 이면 «반품할 수 있는 수량이 없습니다» 한 줄과 닫기만. 성공 토스트 «반품을 접수했습니다 — 반품 목록에는 5분 안에 나타납니다».
- [ ] **Step 5: 주문 목록 배선** — `r.channel === 'medusa' && r.isFirstOfOrder` 행에 `<Can run={useRequestCustomerReturn}>[반품 접수]</Can>`, 취소 모달과 같은 `selectedOrder` 꼴로 대화상자를 연다(`channelOrderId` 를 넘긴다).
- [ ] **Step 6: 검증** — PASS, admin-web tsc 기준선, `npx eslint` 두 `.tsx`, `npx jest "apps/admin-web/src/app/api/proxy" apps/admin-web/src/lib/auth` 0.
- [ ] **Step 7: Commit** — `feat(admin-web): 주문 목록에서 CS 반품 접수 — 반품 가능 수량·기한 넘김 사유·기타 사유의 부담 주체 (K8 PR7)`

### Task 9: admin-web — 대시보드·통계의 반품 칸

**Files:**
- Modify: `apps/admin-web/src/features/main/template/MainTemplate.tsx`, `…/MainTemplate.spec.ts`, `apps/admin-web/src/features/statistics/template/overview.tsx`, `apps/admin-web/src/lib/services/return-exchange/queries.ts`·`query-keys.ts`, `apps/admin-web/src/lib/api/domains/return-exchange/index.ts`

**Interfaces:**
- Consumes: Task 5 `useCustomerReturns`.

- [ ] **Step 1: 스펙 먼저** — `MainTemplate.spec.ts` 의 `QUEUE_HOOKS`·mock 에서 `useReturnRequests` 를 `['@/lib/services/customer-returns', 'useCustomerReturns']` 로 바꾸고, 그 훅이 `{ enabled: false }` 로 불리는지(권한 없음) 보는 기존 단언이 새 훅에도 걸리게 한다 → 구현 전 FAIL.
- [ ] **Step 2: 칩·타일** — 오늘의 할 일 «반품»: `useCustomerReturns({ bucket: 'open', limit: 1 }, { enabled: claimGate.enabled })` 하나로 숫자 = `total`(`/cs/return-exchange`), 둘째 «확인 필요» = `attentionCount`(`/cs/return-exchange?bucket=attention`). 통계 개요 «반품 접수» 타일 → 같은 훅의 `total`. 교환 칩·타일은 그대로(N10).
- [ ] **Step 3: 옛 반품 읽기 지우기** — `useReturnRequests`·`useReturnEligibility`·`useChannelOrderReturnEligibility`·`returnList`·`returnDetail`·`returnEligibility`·`channelOrderReturnEligibility`·`returnRefundQuote` 키, 클라이언트의 반품 함수·타입. 교환 읽기와 `CLAIM_IN_PROGRESS` 는 남긴다. `grep -rn "useReturnRequests\|listReturnRequests\|/admin/return-requests" apps/admin-web/src` 0.
- [ ] **Step 4: 검증** — `npx jest apps/admin-web/src/features/main apps/admin-web/src/lib/auth` 0, admin-web tsc 기준선, `npx eslint` 바꾼 `.tsx`.
- [ ] **Step 5: Commit** — `feat(admin-web): 대시보드·통계의 반품 칸을 새 반품 목록(진행 중·확인 필요)으로 (K8 PR7)`

### Task 10: 문서 — 설계에 «PR 7 에서 확정한 결과»

**Files:**
- Modify: `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md`

- [ ] **Step 1:** §4.8 끝에 «PR 7 에서 확정한 결과» — N1·N2·N3·N4(초일 불산입)·N5·N8·N10·N11 한 줄씩, 창고 화면 위치·소포 찾기 결정(warehouse-app 스테이션, 도착 대기 목록 + 검색, PR 7b)과 검수자 id 를 PR 7b 로 옮김. §4.4 «PR 6b 에서 확정한 결과» 의 `no_charge_shipping_option` 잔여 문장 뒤에 «PR 7: 보류 차감 빼고 다시 시도(N7)» 를 잇는다.
- [ ] **Step 2:** §8 표: PR 7 행을 «core 읽기·목록 + admin-web CS 화면», 새 행 7b «창고 반품 도착·검수 화면 + 검수자 id | warehouse-app · core | 스테이션(F7), 도착 대기 목록 + 검색»으로.
- [ ] **Step 3: 최종 게이트** — `npm run type-check` 0, `npx jest apps/core/src/modules/sales-order scripts/security apps/admin-web/src/features apps/admin-web/src/lib "apps/admin-web/src/app/api/proxy"` 0, core 통합(scratch DB, `--runInBand`) 0, `cd apps/admin-web && npx tsc --noEmit` 기준선.
- [ ] **Step 4: Commit** — `docs(k8): PR 7 에서 확정한 결과 — CS 반품 화면, 창고 화면은 PR 7b`

## 배포 메모 (PR 본문용)

- **마이그 없음 · core + admin-web.** 순서: **core 먼저**(새 목록 라우트·뷰 칸·`dropHoldDeduction`). admin-web 이 먼저 나가면 반품 탭과 대시보드 칩이 404 로 빈다(쓰기 사고는 없다). SST 한 스택은 순서를 보장하지 않는다 — 배치 배포라 한 번에 실리면 롤링 몇 분 동안만 그렇다.
- 옛 core 반품 라우트를 부르는 admin-web 코드는 0 이 된다. 라우트 자체는 PR 10.
- ⛔ 화면 스모크는 사람이 한다(admin-web 은 컴포넌트 테스트가 없다): 로컬 E2E 에서 반품 하나를 끝까지(접수 → 목록 등장 → 시트 버튼) — 브라우저 로그인은 사용자가 직접.
