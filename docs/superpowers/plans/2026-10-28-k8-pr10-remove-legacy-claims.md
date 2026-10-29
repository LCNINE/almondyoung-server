# K8 PR 10 — 옛 core 반품·교환·inventory 반품 길 걷기 (코드) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** core 의 옛 판매주문 반품·교환(`return_requests`·`exchange_requests` 계열)과 inventory 반품(`returns`·`return_items`)을 읽고 쓰는 코드·라우트·화면을 전부 걷고, 그 표를 읽던 곳(K6 청구 수량·고객 actions·주문 진행 판정·일별 통계·대시보드)을 새 반품 기록(`customer_returns`) 위로 다시 잇는다. 표 자체는 남긴다 — DROP 은 PR 10b.

**Architecture:** 지우는 PR 이라 «새 동작»은 다시 잇는 다섯 곳뿐이다. K6 청구 수량은 반품 예정 기록 한 갈래만 남고 소포 단위 청구 합(`claimTotalsByParcelSql`)과 `exchange_active` 칸이 사라진다 — 소포 자격은 이미 SKU 몫(`least()`)으로 새 반품을 본다. 교환은 PR 11(Medusa `OrderExchange`)이 새로 열 때까지 **닫는다**: core 가 `exchange` 액션을 내지 않고, 화면 진입점은 «고객센터로» 안내가 된다. 옛 판매주문 반품 컨트롤러에 섞여 있던 취소·환불 라우트 넷은 경로 그대로 새 컨트롤러로 옮긴다.

**Tech Stack:** NestJS · Drizzle(postgres.js) · Next.js(admin-web·storefront) · Jest(루트)·vitest(storefront).

**Spec:** `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md` §5(걷어낼 것)·§7(contract 순서)·§8 PR 10, §4.8 의 PR 7·8 결과(N10·N11·N7). 이전 PR 본문(#1146~#1173)이 PR 10 에 넘긴 숙제:
- PR 5(#1156) N5 — «옛 반품 테이블 읽기는 PR 10 까지 남아 두 길이 서로를 뺀다» → K6 가 새 기록만 센다(Task 2).
- PR 5 알려진 잔여 — «PR 3 자격 API 는 옛 반품을 못 본다, 반품 개통이 PR 10 보다 먼저면 옛 라우트를 닫아야 한다» → 옛 라우트가 사라진다(Task 1).
- PR 7(#1159) N10·잔여 — 옛 core 반품 라우트·`/inventory/returns` 를 걷는다, «DailyBoards 의 일별 반품 수와 `?createdAt=` 링크는 옛 표를 본다» → Task 3·5.
- PR 8(#1162) — «옛 core 반품 라우트는 호출자 0 으로 남고 PR 10 이 걷는다. 교환은 그대로 옛 core 길» → 교환도 닫는다(아래 N1).

## 결정 (이 계획에서 정한 것)

| # | 결정 |
| --- | --- |
| N1 | **교환도 걷는다**(사용자 결정 10-28). 옛 교환은 완료해도 새 물건이 안 나가는 길이고 라이브 0행·셀메이트 시기 자격 0 이라 휴면이다. PR 11 전까지 교환 진입점은 «교환은 고객센터로 문의해 주세요» 안내다. 설계 §8 표의 PR 7·8 비고(«교환 탭은 그대로 — PR 11»)를 이 결정으로 교정한다 |
| N2 | **코드와 DROP 을 나눈다.** 이 PR 은 마이그 없음. 표·enum 정의는 `inventory.schema.ts` 에 그대로 두고(지우면 `db:generate` 가 DROP 을 만든다), PR 10 이 라이브가 된 «뒤» PR 10b 가 정의 삭제 + DROP 마이그(`deploy → migrate`)를 한 커밋에 싣는다. 이유: CLAUDE.md «Column drop → 2 PR, 사이에 deploy», 그리고 대기 중인 PR 9 expand 마이그와 한 배치에 contract 가 섞이면 `deploy:preflight` 가 1 로 끝난다. 🔴 PR 10b 뒤에는 PR 10 이전 Core 로 롤백할 수 없다 — 옛 K6 SQL 이 모든 라인 수량 읽기에서 없는 표를 읽는다 |
| N3 | 취소·환불 라우트 넷(`POST admin/sales-orders/:id/cancel·retry-refund·manual-refund-complete·refund-waive`)은 새 `AdminSalesOrderCancellationController`(`controllers/admin-sales-order-cancellation.controller.ts`, `@Controller('admin')`)로 **경로·권한·DTO 그대로** 옮긴다. admin-web 무변경 |
| N4 | K6 청구 커널은 반품 예정 기록 한 갈래다. `exchange_active` 칸·`LineSkuQuantities.exchangeActive` 를 지우고 `claimable = delivered − return_consumed − return_active`. 소포 자격의 `claimed_qty`·`claimedQty` 도 지우고 `claimable = least(delivered_qty, sku_claimable)` — 새 반품은 소포를 모르므로 소포 합은 늘 0 이었다(PR 5 N5). PR 11 이 교환 갈래를 다시 더한다 |
| N5 | 고객 actions(`store-sales-orders.service.ts`): 배송완료 뒤 `return` 은 «청구 가능한 소포(`claimable > 0`)가 있으면» 낸다 — 진행 중 반품이 있어도(Medusa 는 한 주문에 반품 여럿을 받는다, PR 3). `exchange` 는 내지 않는다. `claimStatus` 는 그 주문에 진행 중 반품 예정 기록(`CUSTOMER_RETURN_ACTIVE_STATUSES`)이 있으면 `'return_requested'`, 아니면 `'none'`. core DTO 유니온에서 `'exchange'`·`'exchange_requested'` 를 뺀다(스토어프론트 ⊇ core 대조는 그대로 통과) |
| N6 | 주문 진행 판정의 단계 키 `return_exchange` 는 그대로 두고(이름 바꾸면 `order_progress` 행·admin-web·리컨실러 제외 목록이 같이 흔들린다) 세부 상태를 `return:<customer_return_status>` 다섯(`expected`·`arrived`·`inspected`·`held`·`refund_pending`)으로 바꾼다. 시각은 `requested_at`. 갱신 후보는 `customer_returns.updated_at` |
| N7 | 일별 통계의 반품 수 = 그날(KST) `requested_at` 인 반품 예정 기록 수(취소된 것 포함 — 옛 수도 «접수된 수»였다). 교환 칸은 시리즈·DTO·화면에서 지운다. 대시보드 반품 링크는 날짜 조건 없이 `/cs/return-exchange` — 새 목록은 날짜 필터가 없다(넣지 않는다) |
| N8 | `PiiSubjectType` 의 `'return_request'`·`'exchange_request'` 와 admin-web 접속기록 라벨은 **남긴다** — 접속기록은 보존 기록이라 옛 대상 종류를 읽을 수 있어야 한다. 남는 이유를 그 줄에 주석으로 단다 |
| N9 | 스토어프론트의 교환 버튼(`order-actions.tsx`·`order-details-{mobile,desktop}.tsx` 의 `canExchange`)은 그대로 둔다 — core 가 `exchange` 를 안 내므로 안 보이고, PR 11 이 core 에서 다시 켠다. 직접 URL `/mypage/exchange?type=exchange` 만 안내 화면으로 바꾼다 |
| N10 | 이벤트 계약은 그대로다(`SalesOrderClaimProgressed.kind` 의 `'exchange'` 포함 — 소비자 analytics·notification 을 건드리지 않는다). 발행자만 사라진다 |

## Global Constraints

- 마이그 없음. `inventory.schema.ts` 의 옛 표·enum·`returnExchangeTables`/`returnExchangeSchema`·타입 export 는 **지우지 않는다**(PR 10b). 대신 그 블록 머리에 `// K8 PR 10b 가 DROP 과 함께 지운다 — 코드에서 참조 금지(retired-legacy-claims 가드)` 한 줄.
- 트랜잭션·쿼리 규칙: `this.dbService.run(fn, tx)`, `db.query.*`·`with`·`any`·`as` 금지, raw SQL 은 모든 테이블에 별칭·칼럼 한정(K6 2a 교훈), 합계 `::int`.
- 컨트롤러를 옮기거나 지운 뒤 `npx jest scripts/security libs/authorization` — IDOR 검토 목록은 줄 좌표라 줄만 밀려도 빨갛다. `role-name-checks.baseline.ts` 는 파일 경로 키다.
- 통합 스펙은 `describeIfDb` 가드, scratch DB 로 `--runInBand`(`DATABASE_URL=… npx jest <path> --runInBand`). 스펙 안 `dotenv.config()` 금지.
- 게이트: `npm run type-check` 0 · `cd apps/admin-web && npx tsc --noEmit` 0 · 루트 `npx jest` 실패는 admin-web 근태 4건(ICU 기준선)뿐 · 스토어프론트 `npx tsc --noEmit` 45건(기준선, 건드린 파일 0) · 스토어프론트 `npx vitest run` 실패는 `locale-parity.test.ts` 2건(기준선)뿐.
- 워크트리 루트 type-check 가 `@tauri-apps/plugin-http` 1건이면 `native/warehouse-app/node_modules` 링크가 없는 것이다(코드 문제 아님).
- admin-web 은 컴포넌트 테스트가 없다 — 판정은 순수 함수 스펙으로, 배선은 리뷰로 본다.
- 지운 파일을 import 하던 곳은 전부 지우거나 고친다 — `git grep` 으로 0 을 확인하고 커밋한다.

## Review Focus

1. **진행 중 새 반품이 있는 배송완료 주문의 고객 actions** → 남은 수량이 있으면 `return` 이 여전히 보이고 `claimStatus` 는 `return_requested`. 옛 «진행 중 청구가 있으면 버튼 숨김»을 새 기록에 옮겨 붙이면 두 번째 반품이 막힌다. → Task 1 스펙.
2. **세트 라인에 새 반품이 걸린 소포의 자격** → `claimed_qty` 를 지운 뒤에도 소포 `claimable` 이 SKU 몫으로 줄어야 한다(PR 3 자격 API·고객 actions 가 이 값을 본다). → Task 2(기존 `customer return caps parcel claimable through the sku pool` 를 지키고 세트 판을 더한다).
3. **정산 끝·취소된 반품만 있는 주문의 진행 판정** → `return_exchange` 단계가 아니다(그 주문은 원래 단계로). 진행 중 반품이 있으면 `return:<상태>` 이고 7일 임계값이 `requested_at` 부터 센다. → Task 3.
4. **옛 링크·북마크** — admin-web `/cs/return-exchange?tab=exchanges&createdAt=…`, `/inventory/returns`, 스토어프론트 `/mypage/exchange?type=exchange` → 각각 반품 탭·404(메뉴에 없음)·교환 안내로 열린다. 깨진 화면·옛 API 호출 0. → Task 5·6.
5. **배포 롤링 중 옛 admin-web·스토어프론트 태스크가 지운 라우트를 부른다** → 404 로 그 칸만 빈다(쓰기 사고 없음). 옛 core 가 남아 있는 동안 새 화면은 지운 라우트를 안 부른다. → PR 본문 Merge Danger 에 적는다(테스트 아님).

---

### Task 1: 옛 판매주문 반품·교환 길 걷기 — 서비스·컨트롤러·DTO, 취소 라우트 넷 옮기기, 고객 actions

**Files:**
- Delete: `apps/core/src/modules/sales-order/services/store-return-exchange.service.ts` 와 스펙 여섯(`store-return-exchange.{service,claim-event,returned-event}.spec.ts`, `…{claims,attempt,refund}.integration.spec.ts`), `services/return-refund-cap{,.spec}.ts`, `services/return-refund-classification{,.spec}.ts`, `controllers/store-return-exchange.controller{,.spec}.ts`, `controllers/admin-return-exchange.controller{,.spec}.ts`, `dto/store-return-request.dto.ts`, `dto/store-exchange-request.dto.ts`
- Create: `apps/core/src/modules/sales-order/controllers/admin-sales-order-cancellation.controller.ts`, `…/admin-sales-order-cancellation.controller.spec.ts`
- Modify: `sales-order.module.ts`, `services/store-sales-orders.service.ts:556-592`, `services/store-sales-orders.service.spec.ts`(actions describe), `dto/store-order-actions.dto.ts:4,31-34,103-107`
- Modify: `cancellation-refund/wallet-refund-callers.guard.spec.ts`, `line-quantities/line-quantity-read.guard.spec.ts:86-133`, `scripts/security/pii-routes.ts`, `scripts/security/idor-reviewed.spec.ts`, `scripts/security/role-name-checks.baseline.ts`, `libs/authorization/src/decorators/pii-response.decorator.ts:18-19`(주석만, N8)

**Interfaces:**
- Produces: `AdminSalesOrderCancellationController` — 메서드 이름·데코레이터·본문은 `admin-return-exchange.controller.ts:85-145` 그대로(`adminCancelOrder`·`adminRetryRefund`·`adminManualRefundComplete`·`adminWaiveRefund`), 생성자는 `StoreSalesOrdersService` 하나. `AdminCancelOrderDto`·`AdminDecideRequestDto`(·`AdminCancelLineDto`)는 이 파일로 옮긴다.
- Produces: `StoreOrderAction = 'cancel' | 'track' | 'return' | 'receipt'`, `StoreClaimStatus` 에서 `'exchange_requested'` 제거.

- [ ] **Step 1: 옮긴 컨트롤러 스펙을 쓴다** — `admin-sales-order-cancellation.controller.spec.ts`: `it.each` 로 네 메서드의 `REQUIRED_PERMISSIONS_KEY` 가 `['order.order.cancel']`·`['payment.refund.execute']`×3, `PATH_METADATA` 가 `'sales-orders/:id/cancel'`·`'…/retry-refund'`·`'…/manual-refund-complete'`·`'…/refund-waive'`, 클래스 `PATH_METADATA` `'admin'`. `adminCancelOrder` 가 `Idempotency-Key` 없으면 `BadRequestException`, 있으면 `adminCancelRequest(id, { ...dto, fulfillmentCommandContext: { idempotencyKey: 트림값, actorId, actorRoles } })`.
- [ ] **Step 2: 실행해 실패를 본다** — `npx jest apps/core/src/modules/sales-order/controllers/admin-sales-order-cancellation` → 모듈 없음으로 FAIL.
- [ ] **Step 3: 컨트롤러를 만들고 옛 파일들을 지운다.** 모듈의 `controllers`·`providers` 에서 옛 둘·서비스를 빼고 새 컨트롤러를 넣는다. `git grep -n "StoreReturnExchange\|AdminReturnExchange\|return-refund-cap\|return-refund-classification\|store-return-request.dto\|store-exchange-request.dto" apps libs scripts` 가 0 이 될 때까지.
- [ ] **Step 4: 고객 actions 스펙을 고친다** — `store-sales-orders.service.spec.ts` 의 actions describe:
  - `'SO status=delivered이면 return 가능, exchange 는 없다'` — `availableActions` 에 `'return'` 이 있고 `'exchange'` 가 없다.
  - `'진행 중 반품 예정 기록이 있으면 claimStatus return_requested, 남은 소포가 있으면 return 도 낸다'` — 반품 예정 조회 mock 이 한 행, 소포 자격 `claimable 1` → `claimStatus 'return_requested'`, `availableActions` ⊇ `['track','receipt','return']`.
  - `'정산 끝·취소된 반품만 있으면 claimStatus none'` — 조회가 빈 배열(상태 필터는 `CUSTOMER_RETURN_ACTIVE_STATUSES`).
  - `'claimStatus는 항상 none (Phase 4 이전)'` 은 지운다.
- [ ] **Step 5: 실패를 본다** — `npx jest apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts`.
- [ ] **Step 6: `store-sales-orders.service.ts:556-592` 를 N5 대로 고친다.** 반품 예정 조회는 `wmsTables.customerReturns` 에서 `salesOrderId = so.id ∧ status in CUSTOMER_RETURN_ACTIVE_STATUSES` `.limit(1)`. 소포 자격 조회는 `claimStatus` 와 무관하게 한다. DTO 유니온·`@ApiProperty` enum 을 고친다. `returnExchangeTables`·`ACTIVE_*_STATUSES` import 를 지운다.
- [ ] **Step 7: 가드·목록을 고친다.**
  - `wallet-refund-callers.guard.spec.ts` — 기대 목록은 `cancellation-refund.manager.ts` 하나, 머리 주석의 반품·교환 괄호를 지운다.
  - `line-quantity-read.guard.spec.ts:86-93` 주석에서 `store-return-exchange.service.ts` 언급을 지운다(청구 테스트 블록은 Task 2 가 바꾼다 — 이 Task 에선 기대 목록에서 서비스 파일만 뺀다).
  - `pii-routes.ts` — `core GET/POST /admin/return-requests…`·`/admin/exchange-requests…`·`/admin/sales-orders/:id/return-requests` 줄 삭제(channel-adapter 쿠팡 `exchange-requests` 줄은 남긴다).
  - `idor-reviewed.spec.ts` — `core * /store/orders/…return-requests…|exchange-requests…|return-eligibility|by-channel-order/:channelOrderId/lines` 항목 삭제(`…/actions`·`…/tracking`·`…/cancel-request` 는 남는다).
  - `role-name-checks.baseline.ts` — 옛 두 파일 줄 삭제, `'apps/core/src/modules/sales-order/controllers/admin-sales-order-cancellation.controller.ts': { count: 1, kind: 'data-value' }` 추가(`@Controller('admin')`).
  - `pii-response.decorator.ts` 두 값 위에 `// 옛 반품·교환(K8 PR 10 에서 라우트 삭제) — 보존 중인 접속기록의 대상 종류라 남긴다`.
- [ ] **Step 8: 통과를 본다** — `npm run type-check` 0, `npx jest apps/core/src/modules/sales-order scripts/security libs/authorization` 실패 0(통합 스펙은 skip).
- [ ] **Step 9: Commit** — `git commit -m "K8 PR10 — 옛 판매주문 반품·교환 서비스·라우트를 걷고 취소 라우트 넷을 새 컨트롤러로 옮긴다, 고객 actions 는 반품 예정 기록을 본다"`

### Task 2: K6 청구 커널 — 반품 예정 기록 한 갈래, `exchange_active`·소포 청구 합 제거, «다시 오지 않는다» 가드

**Files:**
- Delete: `apps/core/src/modules/sales-order/line-quantities/claim-quantities.reader.ts`
- Modify: `line-quantities/claim-quantities.sql.ts`(전면), `line-quantities/claim-statuses.ts`, `line-quantities/line-quantities.sql.ts:103-165,231`, `line-quantities/line-quantities.reader.ts:20-30,60-115`, `line-quantities/parcel-claim-eligibility.{sql,reader}.ts`
- Modify(테스트): `line-quantities/__support__/claim-facts.fixtures.ts`, `line-quantities/claim-facts.integration.spec.ts`, `line-quantities/line-quantities.integration.spec.ts`, `line-quantities/line-sales-units.spec.ts`, `internal/return-eligibility.spec.ts`, `line-quantities/line-quantity-read.guard.spec.ts:105-135`, `apps/core/src/modules/inventory/schema/outbound-v2-schema.integration.spec.ts:475-500`(옛 CHECK 테스트 삭제)

**Interfaces:**
- Consumes: `CUSTOMER_RETURN_ACTIVE_STATUSES`·`CUSTOMER_RETURN_CONSUMED_STATUSES`(`claim-statuses.ts`, 그대로).
- Produces: `claimTotalsBySkuSql(scope)` 행 = `(sales_order_line_id, sku_id, return_active, return_consumed)`; `heldCustomerReturnLinesSql()` 그대로. `claimItemsSql`·`resolvedClaimItemsSql`·`claimTotalsByParcelSql`·`returnRequestSkuQuantitiesSql` 는 없다. `LineSkuQuantities` 에서 `exchangeActive` 제거. `ParcelClaimEligibility` 에서 `claimedQty` 제거.
- 소비자 영향: `internal/return-eligibility.ts` 는 `delivered` 를 쓰므로 무변경(스펙의 모양만), `store-sales-orders.service.ts` 는 `parcel.claimable` 만 쓴다.

- [ ] **Step 1: 테스트를 먼저 고친다.**
  - `claim-facts.fixtures.ts` — 옛 반품·교환 시드 함수(`returnRequestStatusEnum` 쓰는 것과 교환 시드)를 지운다. 반품 예정 기록 시드는 그대로.
  - `claim-facts.integration.spec.ts` — 옛 청구 항목에 기대던 테스트를 지운다: `active and completed returns both reduce claimable`, `rejected and cancelled returns do not count`, `active exchange reduces…`, `item without a parcel is not counted`, `claims of another order do not count`(반품 예정 판으로 바꿔 남긴다 — 다른 주문의 `expected` 반품이 이 주문 claimable 을 안 줄인다), `parcel totals count…`, `item with a box line but no dispatch attempt…`, `item naming another line's parcel…`, `old and customer returns on one line both reduce claimable`, `exchange on a parcel reduces that parcel`, `readReturnRequestSalesUnits` describe 전체(`whole set return…`~`item without a parcel makes…`). `claims()` 헬퍼와 행 매핑에서 `exchangeActive`·`claimedQty` 를 뺀다.
  - 새 테스트 `'세트 라인 반품 예정 1벌이 그 소포의 구성 SKU claimable 을 qty_per_unit 만큼 줄인다'` — 세트(A×2·B×1) 1벌 배송완료 + `expected` 반품 1벌 → 소포 행 A `claimable 0`, B `claimable 0`, `deliveredQty` 는 각 2·1(Review Focus 2).
  - `line-quantities.integration.spec.ts`·`line-sales-units.spec.ts`·`return-eligibility.spec.ts` 의 `exchangeActive`/`exchange_active`/`claimedQty` 칸을 뺀다.
  - `line-quantity-read.guard.spec.ts` 의 `describe('청구(반품·교환) 수량 읽는 문')` 을 바꾼다: ① `'retired legacy claims stay gone'` — `inventory/schema/inventory.schema.ts` 를 뺀 모든 운영 파일(`filesMatching` — `apps/core/src`, 스펙·`__support__` 제외)에서 `LEGACY_CLAIM_IDENTIFIERS = /\b(returnRequests|returnRequestItems|exchangeRequests|exchangeRequestItems|returnRefundAttempts|returnExchangeTables|returnExchangeSchema|StoreReturnExchangeService|ACTIVE_RETURN_STATUSES|ACTIVE_EXCHANGE_STATUSES|CONSUMED_RETURN_STATUSES|exchange_active|exchangeActive)\b/` 가 0 파일. raw SQL 표 이름(`return_requests` 등)은 Task 3 이 판정·통계 SQL 을 고친 뒤 이 정규식에 더한다 ② `'only the kernel reads customer return lines for quantities'` — `sales-order/` 아래에서 `customer_return_line.quantity`·`held_return_line.quantity` 를 쓰는 파일은 `line-quantities/claim-quantities.sql.ts` 하나 ③ `'claim statuses have one home'` 은 `CUSTOMER_RETURN_(ACTIVE|CONSUMED)_STATUSES` 정의로 바꾼다.
- [ ] **Step 2: 실패를 본다** — `npx jest apps/core/src/modules/sales-order/line-quantities` (가드 ①이 옛 이름을 찾아 빨강), 통합은 scratch DB 로 `DATABASE_URL=… npx jest apps/core/src/modules/sales-order/line-quantities apps/core/src/modules/sales-order/internal --runInBand`.
- [ ] **Step 3: 커널을 N4 대로 고친다.** `claimTotalsBySkuSql` 은 `customerReturnSkuItemsSql` 을 (라인, SKU) 로 묶기만 한다. `parcelClaimEligibilitySql` 은 `parcel_claim` left join 과 `claimed_qty` 칸을 지우고 `least(parcel.qty, parcel_sku.claimable)::int as claimable`. `claim-statuses.ts` 는 반품 예정 두 목록만, 머리 주석에서 교환 문장을 지운다. 파일 머리 주석의 «옛 반품 표는 PR 10 까지…»를 «반품 예정 기록이 청구의 유일한 원천이다(K8 PR 10). 교환은 PR 11»로. `outbound-v2-schema.integration.spec.ts` 의 `ck_return_request_items_quantity_positive` 블록을 지운다.
- [ ] **Step 4: 통과를 본다** — 위 두 명령 실패 0, `npm run type-check` 0.
- [ ] **Step 5: Commit** — `git commit -m "K8 PR10 — K6 청구 수량이 반품 예정 기록만 센다: 옛 반품·교환 갈래·소포 청구 합·exchange_active 를 지우고 다시 오지 않게 가드한다"`

### Task 3: 주문 진행 판정·일별 통계를 반품 예정 기록으로

**Files:**
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.judge-sql.ts:173-185,381-382`, `order-progress.thresholds.ts:58-72`, `order-progress.thresholds.spec.ts:1-10,105-112`, `__support__/order-progress.fixtures.ts:271`(시드를 `customerReturns` 로) + 그 시드를 쓰는 판정 통합 스펙
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts:1023-1066`, `utils/daily-order-status{,.spec}.ts`, `services/sales-orders-stats.integration.spec.ts`(일별 반품·교환을 세는 테스트가 있으면)
- Modify: 일별 통계 응답 DTO(있으면 — `grep -rn "DailyOrderStatusPoint\|exchange: number" apps/core/src/modules/sales-order` 로 찾는다)

**Interfaces:**
- Produces: `ORDER_PROGRESS_STATES.return_exchange = ['return:expected','return:arrived','return:inspected','return:held','return:refund_pending']`. `DailyOrderStatusPoint` 에서 `exchange` 제거, `buildDailyOrderStatusSeries(orders, returns, from, to)`.
- admin-web 이 이 두 모양을 따라간다(Task 5).

- [ ] **Step 1: 스펙을 고친다.**
  - `order-progress.thresholds.spec.ts` passthrough 의 `return_exchange` = `customerReturnStatusEnum.enumValues.filter((v) => v !== 'settled' && v !== 'cancelled').map((v) => \`return:${v}\`)`, 옛 enum import 삭제.
  - 판정 통합 스펙(픽스처 `seed…Return` 을 쓰는 것): `expected` 반품 → 단계 `return_exchange`·상태 `return:expected`·기준 시각 `requested_at`. `settled` 만·`cancelled` 만 → `return_exchange` 아님(Review Focus 3). 직전 주기 뒤 `customer_returns.updated_at` 만 바뀐 주문이 후보에 든다.
  - `line-quantity-read.guard.spec.ts` 의 `LEGACY_CLAIM_IDENTIFIERS` 에 `return_requests|return_request_items|exchange_requests|exchange_request_items|return_refund_attempts` 를 더한다(Task 2 가 만든 정규식).
  - `daily-order-status.spec.ts` — 교환 인자·칸을 뺀다. 통계 통합 스펙에 `'일별 반품 수는 그날 KST 에 접수된 반품 예정 기록 수다(취소 포함)'` — 10-27 23:30 KST `expected` 1·`cancelled` 1, 10-28 00:10 KST 1 → 10-27 `return 2`, 10-28 `return 1`.
- [ ] **Step 2: 실패를 본다** — `npx jest apps/core/src/modules/fulfillment/order-progress apps/core/src/modules/sales-order/utils`, 통합은 scratch DB `--runInBand`.
- [ ] **Step 3: 고친다.** `rx` CTE 는 `customer_returns cr JOIN so` 에서 `cr.status NOT IN ('settled','cancelled')`, `'return:' || cr.status::text`, `cr.requested_at`, `DISTINCT ON … ORDER BY requested_at ASC`. `candidateIdsSql` 의 두 줄을 `UNION SELECT cr.sales_order_id FROM customer_returns cr WHERE cr.updated_at > ${since}` 한 줄로, 머리 주석의 «반품·교환»을 «반품 예정 기록»으로. 통계는 `customer_returns` 를 `requested_at` 으로 센다(교환 쿼리 삭제).
- [ ] **Step 4: 통과를 본다** — 위 명령 실패 0, `npm run type-check` 0.
- [ ] **Step 5: Commit** — `git commit -m "K8 PR10 — 주문 진행의 반품 단계와 일별 반품 수가 반품 예정 기록을 읽는다, 교환 칸은 걷는다"`

### Task 4: inventory 옛 반품 걷기

**Files:**
- Delete: `apps/core/src/modules/inventory/core/services/return.service.ts`, `core/controllers/return.controller.ts`, `core/dto/return/`(디렉터리), `core/mappers/return.mapper.ts`, 그리고 이것들을 직접 겨냥한 스펙(`git grep -ln "return.service\|return.controller\|ReturnMapper" apps/core` 로 찾는다)
- Modify: `core/inventory.module.ts`, `core/services/stock-event.service.ts:145-…`(`processReturn` 삭제 — 호출자 0), `schema/enum-values.ts:43-44`(`returnStatusValues`·`ReturnStatusEnum` 삭제)
- Modify: `apps/core/src/modules/sales-order/line-quantities/line-quantity-read.guard.spec.ts`(테스트 하나 추가 — Step 1)

**Interfaces:** 없음(지우기만). 라우트 `inventory/returns` 여섯이 사라진다 — `route-classification.spec.ts` 는 남은 라우트만 본다.

- [ ] **Step 1: 가드를 먼저 더한다** — `line-quantity-read.guard.spec.ts` 의 `'retired legacy claims stay gone'` 옆에 `'inventory 옛 반품은 다시 오지 않는다'`: 운영 파일(스키마 제외)에서 `/\breturnStatusValues\b|\bprocessReturn\b|from '\.\.?\/services\/return\.service'|@Controller\('inventory\/returns'\)/` 가 0 파일, 그리고 `wmsTables\.returns\b|wmsTables\.returnItems\b|\breturnItems\b` 도 0 파일(스키마 제외).
- [ ] **Step 2: 실패를 본다** — `npx jest apps/core/src/modules/sales-order/line-quantities/line-quantity-read.guard`.
- [ ] **Step 3: 지운다**, 모듈에서 컨트롤러·프로바이더를 뺀다. `git grep -n "ReturnController\|services/return.service\|dto/return/\|return.mapper\|returnStatusValues\|processReturn" apps/core` 0.
- [ ] **Step 4: 통과를 본다** — `npm run type-check` 0, `npx jest apps/core/src/modules/inventory scripts/security apps/core/src/modules/sales-order/line-quantities` 실패 0.
- [ ] **Step 5: Commit** — `git commit -m "K8 PR10 — inventory 옛 반품(ReturnService·/inventory/returns)을 걷는다"`

### Task 5: admin-web — 교환 탭·`/inventory/returns`·대시보드 교환 칸 걷기, 반품 수·진행 라벨 다시 잇기

**Files:**
- Delete: `apps/admin-web/src/features/cs/return-exchange/components/exchange-requests-table/`, `src/lib/api/domains/return-exchange/`, `src/lib/services/return-exchange/`, `src/app/(admin)/inventory/returns/`, `src/features/inventory/returns/`, `src/lib/api/domains/inventory/returns.client.ts`
- Modify: `features/cs/return-exchange/template/index.tsx`(탭·교환 상태 선택·`createdAt` 칩 삭제 — 반품 목록만), `lib/services/inventory/{queries,mutations}.ts`(반품 훅 삭제), `lib/auth/screen-access.ts:111`, `lib/utils/menu.ts:~400`, `components/common/breadcrumb-items.ts:108`(교환 문구가 있으면 «반품»으로), `features/main/template/MainTemplate.tsx`(+`.spec.ts`), `features/statistics/template/overview.tsx`, `features/main/DailyBoards.tsx`(+`.spec.ts`), `lib/api/domains/orders/order-progress.shape.ts:250-264`(+스펙이 있으면), `features/order/history/components/table/index.tsx:501-520`, `lib/types/dto/orders.ts:417`(일별 `exchange`), `lib/types/dto/fulfillment.ts:1400-1415`(`ReturnEligibility*` — 사용처 0 이면 삭제)

**Interfaces:**
- Consumes: Task 3 의 일별 시리즈(교환 없음)와 진행 상태 `return:<customer_return_status>`, PR 7 의 `RETURN_STATUS_LABELS`(`features/cs/return-exchange/customer-return-labels.ts`).
- Produces: `stateLabel('return:held')` = `'반품 ' + RETURN_STATUS_LABELS.held`. 교환 접두어 분기 삭제.

- [ ] **Step 1: 순수 함수 스펙을 쓴다/고친다.**
  - `order-progress.shape` 스펙: `stateLabel('return:expected')`·`'return:arrived'`·`'return:inspected'`·`'return:held'`·`'return:refund_pending'` 이 `'반품 ' + RETURN_STATUS_LABELS[...]`, 모르는 값 `'return:zzz'` → `'반품 zzz'`, `'exchange:requested'` → 그대로 `'exchange:requested'`(분기 없음).
  - `DailyBoards.spec.ts` — 시리즈 고정물에서 `exchange` 를 빼고, CS 보드에 «교환» 행이 없고 «반품» 링크 href 가 `/cs/return-exchange`(쿼리 없음)임을 본다.
  - `MainTemplate.spec.ts` — `useExchangeRequests` mock·권한 표 행을 지운다.
- [ ] **Step 2: 실패를 본다** — `npx jest apps/admin-web/src/features/main apps/admin-web/src/lib/api/domains/orders`.
- [ ] **Step 3: 고친다.** `REQUEST_STATUS` 맵을 지우고 `RETURN_STATUS_LABELS` 를 쓴다. 이력 표의 `return_lifecycle_event`·`exchange_lifecycle_event`·`return_requested`·`exchange_requested` 라벨을 지운다(배포 전 점검 SQL 이 0 이어야 한다 — PR 본문). 대시보드 «반품» 칩·통계 «반품 접수» 는 PR 7 그대로, «교환» 칩·타일은 삭제. `screen-access.ts` 의 `/inventory/returns` 와 메뉴 항목을 함께 지운다(`screen-access.gate.spec.ts`).
- [ ] **Step 4: 통과를 본다** — `cd apps/admin-web && npx tsc --noEmit` 0, `npx jest apps/admin-web` 실패는 근태 4건뿐, `git grep -n "return-exchange'\|useExchangeRequests\|returnsClient\|exchange-requests\|/inventory/returns" apps/admin-web/src` 0(`'@/lib/api/domains/return-exchange'` 포함).
- [ ] **Step 5: Commit** — `git commit -m "K8 PR10 — admin-web 교환 탭·inventory 반품 화면·대시보드 교환 칸을 걷고, 진행 라벨·일별 반품 수를 새 반품 기록에 맞춘다"`

### Task 6: 스토어프론트 교환 안내 + 설계 문서 결과

**Files:**
- Delete: `web/almondyoung-storefront/src/domains/order/exchange/exchange-client.tsx`(와 같은 폴더의 교환 전용 테스트)
- Create: `web/almondyoung-storefront/src/domains/order/exchange/exchange-unavailable.tsx`
- Modify: `src/app/[countryCode]/(mypage)/mypage/exchange/page.tsx:46-47`, `src/lib/api/orders/store-orders.ts:210-283`(`getOrderLinesByMedusaId`·`StoreOrderLinesResponse`·교환 타입·`createExchangeRequestByMedusaId` 삭제 — 다른 사용처 0 확인), `src/i18n/messages/{ko,en,ja}/mypage.json`(키 `exchangeUnavailable.{title,body,inquiry,orderDetail}`, 교환 폼에만 쓰던 키는 사용처 0 이면 셋에서 같이 삭제)
- Modify: `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md` — §5 끝에 «PR 10 에서 확정한 결과» 블록, §8 표의 PR 7·8 비고 교환 문구 교정, PR 10 행을 «코드(마이그 없음)», PR 10b 행 추가

**Interfaces:**
- Produces: `ExchangeUnavailable({ orderId }: { orderId?: string })` — 제목 «교환 신청은 고객센터에서 받고 있어요», 본문 «주문번호와 바꾸고 싶은 상품을 알려 주시면 도와드릴게요.», 버튼 둘: «1:1 문의하기» → `/mypage/inquiries`(마이페이지 메뉴의 그 경로), «주문 상세» → 주문 상세 경로(`orderId` 가 있을 때만). 화면 로직이 분기 하나라 컴포넌트 테스트는 없다 — 키 대조는 `locale-parity.test.ts` 가 한다.

- [ ] **Step 1: 메시지 키를 세 언어에 같은 집합으로 더한다**(ko 문구는 위, en·ja 는 같은 뜻).
- [ ] **Step 2: 고친다.** `page.tsx` 에서 `type === "exchange"` 면 `<ExchangeUnavailable orderId={orderId} />`, 그 밖은 지금처럼 반품 폼. `exchange-client.tsx` 와 교환 API 를 지운다.
- [ ] **Step 3: 통과를 본다** — `cd web/almondyoung-storefront && npx tsc --noEmit`(45건, 건드린 파일 0), `npx vitest run`(실패는 `locale-parity.test.ts` 의 기존 2건뿐 — 새 키는 그 2건을 늘리지 않는다), `git grep -n "exchange-requests\|by-channel-order/.*/lines\|ExchangeClient" web/almondyoung-storefront/src` 0.
- [ ] **Step 4: 설계 문서를 적는다** — «PR 10 에서 확정한 결과»에 N1~N10 을 한 줄씩, 그리고 아래 «PR 10b 로 넘기는 것» 목록을 그대로 옮긴다.
- [ ] **Step 5: 브랜치 끝 게이트** — `npm run type-check` 0 · 루트 `npx jest` 실패 근태 4건뿐 · admin-web tsc 0 · core 통합(scratch DB, `--runInBand`): `apps/core/src/modules/sales-order` `apps/core/src/modules/fulfillment/order-progress` `apps/core/src/modules/inventory` 실패는 develop 과 같은 기존 건뿐(PR 4·9 본문: `expected-arrivals-parity` #12, `unified-reservation…lifecycle`, `waybill.manager.integration` 1건, `audit-inbound-origin-consistency`).
- [ ] **Step 6: Commit** — `git commit -m "K8 PR10 — 스토어프론트 교환 진입은 고객센터 안내로, 설계에 PR 10 결과와 PR 10b 넘김을 적는다"`

---

## 배포 (PR 본문 Merge Danger 로 옮긴다)

- **Door: two-way.** 마이그·이벤트 계약 변경 없음. 롤백하면 옛 코드가 옛 표(그대로 있다)를 다시 읽는다.
- **배포 전 라이브 점검 — 전부 0 이어야 한다**(0 이 아니면 그 행을 볼 화면이 사라진다 — 멈추고 묻는다):
  ```sql
  select count(*) from return_requests;
  select count(*) from exchange_requests;
  select count(*) from return_refund_attempts;
  select count(*) from returns;
  select count(*) from business_links where relation_name in ('return_lifecycle_event', 'exchange_lifecycle_event');
  select count(*) from order_progress where stage = 'return_exchange';
  ```
- **한 `sst deploy`**(core·admin-web·storefront). 순서 제약 없음 — 롤링 중 옛 화면이 지운 라우트를 부르면 404 로 그 칸만 빈다(Review Focus 5).
- **동작 변경:** 스토어프론트 교환 버튼이 사라진다(지금도 자격 0 이라 안 보인다). 대시보드·통계의 «교환» 칸이 사라진다. 고객 actions 의 `claimStatus` 가 새 반품에서 `return_requested` 가 된다. 주문 진행 «반품·교환» 단계가 새 반품 상태를 보인다.
- **배포 뒤 확인:** ① `POST /admin/sales-orders/:id/cancel` 이 지금처럼 동작(헤더 없으면 400) ② `GET /admin/return-requests` 404 ③ admin-web `/cs/return-exchange` 가 반품 목록으로 열린다 ④ 아무 라이브 주문의 `GET /store/orders/by-channel-order/:id/actions` 에 `exchange` 없음.

## PR 10b 로 넘기는 것 (PR 10 이 라이브가 된 뒤 따로 계획)

- `inventory.schema.ts` 에서 삭제: `returnRequests`·`returnRequestItems`·`returnRefundAttempts`·`exchangeRequests`·`exchangeRequestItems`·`returnExchangeTables`·`returnExchangeSchema`·관련 타입, enum `return_request_status`·`exchange_request_status`·`return_reason_code`·`exchange_reason_code`·`return_refund_attempt_status`, 표 `returns`·`return_items`(`wmsTables` 목록 포함)·enum `return_status`.
- `npm run db:generate:core -- --name drop-legacy-claim-tables` → **scratch DB 에서 먼저 돌린다**(drizzle 이 지운 FK 를 또 지워 실패한 전례 — DROP TABLE CASCADE 순서).
- 배포는 contract, **`deploy → migrate`**. 그 배치에 expand 마이그가 섞이지 않게 한다(`deploy:preflight`).
- 🔴 PR 10b 마이그 뒤엔 PR 10 이전 Core 로 롤백 금지(N2).
- 가드 ①의 «스키마 파일 제외»를 지운다.
