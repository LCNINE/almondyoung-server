# K6 PR 3b — 세트 일부 반품의 관리자 입력 금액(D7)과 반품 이벤트의 남은 수량(F9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 세트 일부 반품을 관리자가 금액을 넣어 완료하게 하고(시스템은 상한만 지킨다), `SalesOrderReturned` 에 라인의 남은 수량을 실어 ugc 가 부분취소 뒤 전량 반품을 회수하게 한다.

**Architecture:** 반품 요청에 관리자 입력 금액 칸 하나를 더한다(additive). 상한은 순수 함수 `returnRefundCap` 한 벌이고, 서비스가 주문 라인·라인 수량 문(`remaining`)·앞선 완료 반품을 읽어 넘긴다. 금액을 넣는 완료는 별도 라우트(`payment.refund.execute`)이고, 그 뒤 갈래(즉시 완료·Wallet 환불·수동 대기)는 자동 금액 경로와 같다. 재시도는 저장된 금액을 쓴다. 이벤트 칸은 optional additive 라 배포 순서가 자유롭다.

**Tech Stack:** NestJS, Drizzle ORM(postgres.js), drizzle-kit 마이그레이션, class-validator, zod(이벤트 계약), Next.js + TanStack Query(admin-web), Jest(유닛 + `describeIfDb` 통합).

**Spec:** `docs/superpowers/specs/2026-10-20-k6-line-quantity-facts-design.md` (§8 D7, §6.5 `calculateReturnRefund`·`SalesOrderReturned`, §5 F9). ADR: `docs/adr/0047-line-quantity-facts-one-record-one-reader.md` («PR 3a 가 정한 것»·«3b 로 넘긴 것»). 앞선 계획: `docs/superpowers/plans/2026-10-21-k6-claims-pr3a.md` («사용자 결정» 절 = D7 상한 원안).

## 사용자 결정 (2026-10-21)

- **상한 원안(3a 계획):** 요청 하나에 금액 하나. 요청에 세트 일부 줄이 하나라도 있으면 그 요청 전체 금액을 관리자가 입력한다. 상한 = 이 요청이 건드린 라인들의 배분액 합 − 그 라인들을 건드린 앞선 완료 반품의 환불액 전부. 금액을 모르는 앞선 완료 반품이 건드린 라인의 배분액은 0. 과환불은 막고, 상한이 실제보다 낮게 나올 수 있다.
- **U1. 배분액을 «취소 안 된 비율»로 줄인다.** 라인 배분액 = 라인 무게 × (결제총액 − 배송비) ÷ 라인 무게 합 × `remaining` ÷ 주문 수량. `totalAmount` 는 취소해도 줄지 않으므로, 줄이지 않으면 취소로 환불한 몫을 또 환불할 수 있다. 취소 환불 기록은 읽지 않는다(부분취소 환불은 수동 확정이라 금액 없는 행이 있다).
- **U2. 금액을 넣는 완료는 별도 라우트 `POST /admin/return-requests/:id/complete-with-amount`, 권한 `payment.refund.execute`.** 기존 `complete` 는 `order.claim.write` 그대로. 오늘은 두 권한 모두 ADMIN 이라 바뀌는 사람이 없다.
- **U3. F9 칸은 스펙의 `demand` 가 아니라 `remainingQuantity` = `LineQuantities.remaining`(주문 − 취소 전부).** 출고 뒤 취소가 있으면 `claimable` 이 그만큼 줄어 `demand` 와는 영영 같아지지 않는다(회수가 안 된다). 스펙 이탈이라 Task 5 가 스펙·ADR 에 적는다.

## 이 계획이 정하는 것 (구현 기본값)

- **A1. 금액은 0 이상 상한 이하 정수.** 그 뒤 갈래는 자동 경로와 같다: 0 → 즉시 `completed` + 반품 완료 이벤트, 양수 + `walletIntentId` → `refund_pending` 후 Wallet 환불, 양수 + `walletIntentId` 없음 → `refund_pending`(수동 완료 대기). (사용자에게는 «0원이면 수동 완료»로 말했지만, 자동 경로의 «금액 0 → 즉시 완료»와 같은 갈래로 맞췄다. 수동 완료는 `refund_pending` 에서만 되므로 0원을 거기로 보내면 할 일 없는 단계가 하나 더 생긴다.)
- **A2. 메모 필수**(`adminNote`, 1~500자). `manualCompleteReturn` 처럼 `return_requests.admin_note` 를 덮어쓰고 수명주기 링크에도 남긴다.
- **A3. 세트 일부가 아닌 요청에 금액을 보내면 400.** 세트 일부 요청에 기존 `complete` 를 부르면 400(3a 의 N5 임시 갈래 `refund_pending` 대체).
- **A4. 앞선 완료 반품의 «아는 금액» = 그 요청의 `return_refund_attempts` 중 `succeeded` 금액 합.** `succeeded` 시도가 없는 완료 반품(수동 완료·자동 0원 즉시 완료·관리자 0원)은 금액 모름으로 본다. 보수적이고 단순하다.
- **A5. 상한은 내림(`Math.floor`).** 반올림하면 1원 넘게 나갈 수 있다.
- **A6. 재시도는 저장된 금액을 쓴다**(스펙 D7 «완료와 재시도가 다시 계산하지 않는다»). 상한을 다시 검사하지 않는다.
- **A7. 견적 라우트 `GET /admin/return-requests/:id/refund-quote`(권한 `order.claim.read`, `inspected` 에서만).** admin-web 이 «완료 처리» 클릭 때 불러 자동/입력 갈래를 고른다. 응답에 개인정보가 없어 `@PiiResponse` 를 달지 않는다.

## Global Constraints

- 마이그레이션 하나(expand, additive): `return_requests.admin_refund_amount integer null` + 체크 `ck_return_requests_admin_refund_amount_nonnegative`(`admin_refund_amount >= 0`). 생성 `npm run db:generate:core -- --name add-return-admin-refund-amount`. `schema.ts`·SQL·`drizzle/meta/` 한 커밋. **배포 순서 `migrate → deploy`.**
- 배포 단위 Core + ugc + admin-web. 순서: migrate → Core → (ugc·admin-web 아무 순서). 이벤트 칸이 optional 이고 계약이 `z.object`(모르는 칸은 버린다)라 ugc 와 Core 의 순서는 자유다. admin-web 은 새 라우트를 부르므로 Core 뒤.
- 3a(#1118)·2b(#1116)가 아직 미배포다. 같은 배포에 실리면 #1118 본문 «배포 절차»(D5 게이트 둘·`shipment_lines` 행 수·마이그 2개)를 먼저 따른다.
- 수량 뺄셈은 SQL 조각 안에만 있다(3a 규칙). 상한 함수는 `quantity − canceled` 를 TS 에서 계산하지 않고 문이 낸 `remaining` 을 받는다.
- 커널(`line-quantities/`)에 돈 판단을 넣지 않는다(ADR-0047). 상한 함수는 `sales-order/services/` 에 둔다.
- 청구 항목 테이블은 `store-return-exchange.service.ts` 안에서만 읽고, `returnRequestItems.quantity` 는 읽지 않는다(가드 `line-quantity-read.guard.spec.ts`).
- 이 서비스는 Nest HTTP 예외(`BadRequestException`·`ConflictException`)를 쓴다 — 주변 코드에 맞춘다.
- 새 라우트는 `@RequirePermission` 필수(`route-classification.spec.ts`). 반품 요청을 응답하는 새 라우트는 기존 `complete` 와 같은 `@PiiResponse` + `scripts/security/pii-routes.ts` 한 줄.
- admin-web 은 컴포넌트 테스트가 없다 — 판단은 순수 함수로 빼고 그 함수를 테스트한다. 새 뮤테이션 훅은 `useX.permission` 선언, 화면은 `canRun(useX)` 로 판정.
- 통합 테스트는 스크래치 DB `k6_it`: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k6_it npx jest --runInBand --runTestsByPath <파일…>`. 컨테이너가 꺼져 있으면 `docker start almondyoung-server-postgres-1`. Task 1 마이그 뒤 `DATABASE_URL=…/k6_it npx drizzle-kit migrate --config apps/core/drizzle.config.ts`.
- 기준선: 브랜치 시작 때 `k6_it` 에서 `apps/core/src/modules/sales-order/**/*.integration.spec.ts` 를 한 번 돌려 실패 목록을 scratchpad 에 둔다. «새 실패 0» 은 그 목록 대비. 🔴 `channel-cancel-request.integration.spec.ts` 단발 실패는 공유 DB 동시 실행 의심(3a R12) — 재실행으로 판정.
- 워크트리 `node_modules` 는 심링크(걸려 있음). jest OOM 이면 `--maxWorkers=2`. type-check 환경 에러 3(web-push·tauri)은 기준선.
- 금지: `any`, 근거 없는 `as`, 스펙 안 `dotenv.config()`, 가드 없는 DB 통합 스펙.
- 커밋 메시지는 한국어 `feat(sales-order): … (K6 PR3b)` 꼴. 시스템이 주는 attribution 줄이 있으면 끝에 붙인다.

## Review Focus

1. **Wallet 이 실패한 뒤 재시도.** 관리자 금액 1200 으로 완료 → Wallet 확정 실패 → 재시도가 다시 계산하지 않고 1200 을 보낸다. Task 2 `retry after admin amount reuses the stored amount` 가 고정한다.
2. **같은 반품을 두 관리자가 동시에 완료.** 하나가 금액 완료, 다른 하나가 금액 완료(또는 일반 완료) — 반품 행 `FOR UPDATE` 뒤 상태 검사라 두 번째는 409. Task 2 `second completion of the same return is refused` 가 고정한다.
3. **앞선 반품을 수동 완료한 라인.** 금액을 몰라 그 라인 배분액이 0 — 상한 0, 0원만 받고 즉시 완료. Task 2 `prior manual return zeroes the cap` 이 고정한다.
4. **부분취소 뒤 세트 일부 반품.** 상한이 취소 안 된 비율로 준다(U1). Task 1 유닛 `cancellation scales the line allocation`, Task 2 `cancelled unit is not refundable again` 이 고정한다.
5. **환불 실행 권한 없는 관리자가 세트 일부 반품의 «완료 처리»를 누른다.** 금액 창을 열지 않고 «환불 실행 권한이 필요» 안내. 서버는 라우트 권한이 403. Task 4 `decideCompletion` 테스트 `admin amount without refund permission is blocked` 가 고정한다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `apps/core/src/modules/inventory/schema/inventory.schema.ts` (수정, `returnRequests` 5062~) + `apps/core/drizzle/<ts>_add-return-admin-refund-amount.sql` (생성) | 관리자 입력 금액 칸 |
| `apps/core/src/modules/sales-order/services/return-refund-cap.ts`·`.spec.ts` (생성) | 상한 순수 함수 |
| `apps/core/src/modules/sales-order/services/store-return-exchange.service.ts` (수정) | 견적·금액 완료·일반 완료 거절·재시도 저장값·이벤트 칸 |
| `apps/core/src/modules/sales-order/controllers/admin-return-exchange.controller.ts` (수정) | 라우트 둘 + DTO |
| `scripts/security/pii-routes.ts` (수정) | 금액 완료 라우트 한 줄 |
| `apps/core/src/modules/sales-order/services/store-return-exchange.claims.integration.spec.ts` (수정) | D7·F9 통합 시나리오 |
| `packages/event-contracts/streams/orders.stream.ts` (수정, 509~546) | `remainingQuantity` optional |
| `apps/ugc-service/src/reviews/rewards/order-return.policy.ts`·`__tests__/order-return.policy.spec.ts` (수정) | 남은 수량과 비교 |
| `apps/admin-web/src/lib/api/domains/return-exchange/index.ts`, `lib/services/return-exchange/{query-keys,queries,mutations}.ts` (수정) | API·키·훅 |
| `apps/admin-web/src/features/cs/return-exchange/admin-refund-amount.ts`·`.spec.ts` (생성) | 완료 갈래 판정·금액 검증 |
| `apps/admin-web/src/features/cs/return-exchange/components/return-requests-table/index.tsx` (수정) | 금액 입력 창 |
| `docs/adr/0047-…md`, 스펙 §6.5·§8 D7 (수정) | 3b 결과·스펙 이탈 |

---

### Task 1: 금액 칸 + 상한 순수 함수

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (`returnRequests` 에 `adminRefundAmount: integer('admin_refund_amount')`, 테이블 콜백에 `check('ck_return_requests_admin_refund_amount_nonnegative', sql\`${t.adminRefundAmount} >= 0\`)`)
- Create: `apps/core/drizzle/<ts>_add-return-admin-refund-amount.sql` + `drizzle/meta/` (생성기가 만든다)
- Create: `apps/core/src/modules/sales-order/services/return-refund-cap.ts`, `return-refund-cap.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type RefundCapLine = {
    id: string;
    quantity: number;          // 주문 수량(판매 단위)
    remaining: number;         // LineQuantities.remaining (주문 − 취소 전부)
    unitPrice: number | null;
    totalPrice: number | null;
  };
  /** 앞선 완료 반품 — refundedAmount null = 금액 모름(A4). */
  export type PriorCompletedReturn = { lineIds: readonly string[]; refundedAmount: number | null };
  export function returnRefundCap(input: {
    orderLines: readonly RefundCapLine[];
    touchedLineIds: ReadonlySet<string>;
    priorReturns: readonly PriorCompletedReturn[];
    totalAmount: number | null;
    shippingFee: number;
  }): number;
  ```
  규칙: 무게 = `totalPrice ?? (unitPrice ?? 0) × quantity`(분모는 모든 라인). 배분액 = 무게 × max(0, totalAmount − shippingFee) ÷ 무게 합 × remaining ÷ quantity(quantity ≤ 0 이면 0). `totalAmount` 가 null·0 이하이거나 무게 합 0 이하면 배분액 = `(unitPrice ?? 0) × remaining`(`calculateReturnRefund` 폴백과 같은 꼴). 금액 모르는 앞선 반품이 건드린 touched 라인은 배분액 0. 상한 = max(0, floor(touched 배분액 합) − touched 를 하나라도 건드린 아는 앞선 반품 금액 합).

- [ ] **Step 1: 실패하는 유닛 테스트 `return-refund-cap.spec.ts`**

  픽스처: 라인 A(quantity 3, remaining 3, unitPrice 1000, totalPrice 3000), B(quantity 1, remaining 1, unitPrice 1000, totalPrice 1000), totalAmount 4500, shippingFee 500 (상품 소계 4000, 무게 합 4000).

  | 테스트 이름 | 입력 변경 | 기대 |
  |---|---|---|
  | `touched line gets its weighted share` | touched {A} | 3000 |
  | `cancellation scales the line allocation` | A.remaining 1 | 1000 |
  | `known prior refund on a touched line is subtracted` | prior `{lineIds:[A], refundedAmount:400}` | 2600 |
  | `prior refund on an untouched line is ignored` | prior `{lineIds:[B], refundedAmount:400}` | 3000 |
  | `prior refund touching A and B is subtracted whole` | prior `{lineIds:[A,B], refundedAmount:1500}` | 1500 |
  | `unknown prior zeroes only the lines it touched` | touched {A,B}, prior `{lineIds:[A], refundedAmount:null}` | 1000 |
  | `never negative` | prior `{lineIds:[A], refundedAmount:5000}` | 0 |
  | `floors fractional share` | totalPrice A 1, B 2, totalAmount 1500, shippingFee 500, A remaining 3 | 333 |
  | `falls back to unit price without order total` | totalAmount null, A.remaining 2 | 2000 |

- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/sales-order/services/return-refund-cap.spec.ts` → FAIL(모듈 없음).

- [ ] **Step 3: `returnRefundCap` 구현** (위 규칙 그대로. 파일 머리 주석에 U1·A4·A5 근거 한 줄씩).

- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS 9.

- [ ] **Step 5: 스키마 칸 + 마이그 생성** — `npm run db:generate:core -- --name add-return-admin-refund-amount`. 생성 SQL 이 `ALTER TABLE "return_requests" ADD COLUMN "admin_refund_amount" integer;` 와 `ADD CONSTRAINT "ck_return_requests_admin_refund_amount_nonnegative" CHECK …` 두 줄뿐인지 본다(다른 테이블 변경이 섞이면 멈추고 보고). `k6_it` 에 적용: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k6_it npx drizzle-kit migrate --config apps/core/drizzle.config.ts`.

- [ ] **Step 6: 커밋** — 스키마·SQL·`drizzle/meta/`·상한 파일 둘. `feat(sales-order): 세트 일부 반품의 환불 상한과 관리자 금액 칸 (K6 PR3b)`

---

### Task 2: 견적·금액 완료·재시도 저장값 (Core 서비스 + 라우트)

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/store-return-exchange.service.ts` (`completeReturnRequest` 708~, `attemptReturnRefund` 780~, `computeReturnRefundAmount` 1628~)
- Modify: `apps/core/src/modules/sales-order/controllers/admin-return-exchange.controller.ts` (`complete` 라우트 339 옆)
- Modify: `scripts/security/pii-routes.ts` (48 `complete` 줄 아래 `'core POST /admin/return-requests/:id/complete-with-amount',`)
- Test: `apps/core/src/modules/sales-order/services/store-return-exchange.claims.integration.spec.ts` (Task 5 블록 «반품 환불 수량과 반품 완료 이벤트» 안, `seedSetLine`·`payOrder`·`seedClaim`·`makeRefundHarness`·`rejection` 재사용)

**Interfaces:**
- Consumes: Task 1 `returnRefundCap`, `RefundCapLine`, `PriorCompletedReturn`; 3a `readReturnRequestSalesUnits(tx, returnRequestId)`(키 = 이 요청이 건드린 라인), `readLineQuantities(tx, salesOrderId)`(`.remaining`).
- Produces:
  ```ts
  // service
  export type ReturnRefundQuote = { kind: 'automatic'; amount: number } | { kind: 'admin_amount'; cap: number };
  async getReturnRefundQuote(returnRequestId: string): Promise<ReturnRefundQuote>;
  async completeReturnRequestWithAmount(
    returnRequestId: string, adminId: string, input: { refundAmount: number; adminNote: string },
  ): Promise<ReturnRequest>;
  private async computeAdminRefundCap(tx: DbTx, returnRequestId: string,
    salesOrder: { id: string; totalAmount: number | null; shippingFee: number }): Promise<number>;
  // controller
  export class AdminCompleteReturnWithAmountDto {
    @IsInt() @Min(0) refundAmount: number;
    @IsString() @IsNotEmpty() @MaxLength(500) adminNote: string;
  }
  // GET  return-requests/:id/refund-quote          @RequirePermission('order.claim.read')
  // POST return-requests/:id/complete-with-amount  @RequirePermission('payment.refund.execute') @HttpCode(200) + complete 와 같은 @PiiResponse
  ```
- 문구(정확히):
  - 일반 완료가 세트 일부를 만남: `세트 구성품 일부 반품입니다. 환불 금액을 입력해 완료하세요.` (400)
  - 금액 완료가 자동 금액 요청을 만남: `자동 환불 금액이 정해지는 반품입니다. 완료 처리를 사용하세요.` (400)
  - 상한 초과: `` `환불 금액이 상한(${cap}원)을 넘습니다.` `` (400)
  - 견적 상태 오류: `` `환불 금액 견적은 'inspected' 상태에서만 볼 수 있습니다. 현재 상태: ${status}` `` (409)
  - 금액 완료 상태 오류: 기존 `completeReturnRequest` 의 409 문구 그대로.

- [ ] **Step 1: 실패하는 통합 테스트** (기존 `set-partial return goes to manual refund` 는 지우고 아래로 대체). 모두 `seedSetLine` + `payOrder(…, { totalAmount: 5000, shippingFee: 3000 })`(상품 소계 2000) + `seedClaim(status 'inspected', items [parcelLine(line, 0, skuB, 1)])` 출발.
  - `plain completion of a set-partial return asks for an amount` — `completeReturnRequest` → BadRequest 위 문구, 상태 `inspected` 그대로, Wallet 미호출.
  - `quote of a set-partial return is the admin cap` — `getReturnRefundQuote` → `{ kind: 'admin_amount', cap: 2000 }`.
  - `quote of a whole-set return is automatic` — items `[parcelLine(line,0,skuA,1), parcelLine(line,0,skuB,2)]` → `{ kind: 'automatic', amount: 5000 }`.
  - `admin amount within the cap is refunded` — `completeReturnRequestWithAmount(id, 'admin-1', { refundAmount: 1200, adminNote: '구성품 B 1개' })` → Wallet `(INTENT_ID, 1200, …)`, 상태 `completed`, 행 `adminRefundAmount 1200`·`adminNote '구성품 B 1개'`, 수명주기 링크 metadata `objectContaining({ refundAmountSource: 'admin', refundAmount: 1200, refundCap: 2000 })`.
  - `admin amount over the cap is refused` — 2001 → BadRequest `환불 금액이 상한(2000원)을 넘습니다.`, 상태 `inspected`.
  - `admin amount on an automatic return is refused` — 통째 세트 요청 + 1000 → BadRequest 위 문구.
  - `zero admin amount completes without refund` — 0 → 상태 `completed`, Wallet 미호출, `SalesOrderClaimProgressed` 적재.
  - `retry after admin amount reuses the stored amount` — Wallet 목 첫 호출 `{ kind: 'failed', determinate: true, errorCode: 'X' }`(`return-refund-classification.ts:17` — `determinate` 가 있어야 확정 실패, 나머지 칸은 `WalletRefundOutcome` 타입에 맞춘다), 1200 완료 → `refund_pending`; 목을 성공으로 바꾸고 `retryReturnRefund` → 두 번째 호출도 1200, 상태 `completed`.
  - `prior known refund reduces the cap` — 같은 주문에 `seedClaim(status 'completed', items [parcelLine(line,0,skuA,1)])` + 그 요청의 `return_refund_attempts`(attemptNumber 1, idempotencyKey 임의, amount 700, status `succeeded`) → 견적 cap 1300.
  - `prior manual return zeroes the cap` — 앞선 완료 반품에 시도 행 없음 → cap 0; `refundAmount: 1` → 상한(0원) 400; `refundAmount: 0` → `completed`.
  - `cancelled unit is not refundable again` — `seedSetLine` 대신 수량 2 세트 라인(`seedDeliveredLine` quantity 2, 같은 구성, 소포 `{A:2, B:4}`), `recordSalesOrderCancellation(tx, { salesOrderId, cancellationScope: 'partial', reasonCode: 'customer', metadata: { cancelledLines: [{ salesOrderLineId, quantity: 1 }] }, effects: [] })`(출고 전 갈래) → 견적 cap 1000.
  - `second completion of the same return is refused` — 1200 완료 뒤 같은 요청에 `completeReturnRequestWithAmount` → ConflictException.

- [ ] **Step 2: 실패 확인** — `DATABASE_URL=…/k6_it npx jest --runInBand --runTestsByPath apps/core/src/modules/sales-order/services/store-return-exchange.claims.integration.spec.ts` → 새 테스트 FAIL(메서드 없음).

- [ ] **Step 3: 서비스 구현**
  - `completeReturnRequest` Phase 1 에서 금액·갈래 이후를 private `finishInspectedReturn(tx, rr, salesOrder, amount: number, linkExtra: Record<string, unknown>)` 로 뽑는다: 상태 갱신(0 → `completed`+`completedAt`, 그 밖 `refund_pending`), 수명주기 링크(`{ event, adminId, timestamp, ...linkExtra }`), 0 이면 완료 이벤트, 무지갑 경고. `{ updatedRequest, immediateComplete, needsRefund }` 를 돌려준다. 두 완료가 이걸 쓴다.
  - `completeReturnRequest`: `set_partial` 이면 위 400(상태 변경 전). N5 갈래와 그 경고 로그를 지운다.
  - `completeReturnRequestWithAmount`: 반품 행 `FOR UPDATE` → `inspected` 검사 → 주문 → `computeReturnRefundAmount` 가 `set_partial` 이 아니면 400 → `computeAdminRefundCap` → 초과면 400 → `admin_refund_amount`·`admin_note` 갱신 → `finishInspectedReturn(…, refundAmount, { refundAmountSource: 'admin', refundAmount, refundCap: cap, adminNote })` → 트랜잭션 밖에서 `needsRefund` 면 `attemptReturnRefund`.
  - `computeAdminRefundCap`: 주문 라인(`id, quantity, unitPrice, totalPrice`) + `readLineQuantities` 의 `remaining` → `RefundCapLine[]`; touched = `readReturnRequestSalesUnits` 키; 앞선 완료 반품 = 같은 주문·`status 'completed'`·id ≠ 이 요청의 (요청 id, 항목 `salesOrderLineId`) 행 + 그 요청들의 `succeeded` 시도 금액 합(쿼리 빌더 두 번, 없으면 null).
  - `getReturnRefundQuote`: 트랜잭션 안에서 행·상태(409)·주문 → `computeReturnRefundAmount` 가 `amount` 면 `automatic`, 아니면 `admin_amount` + cap.
  - `attemptReturnRefund` 새 시도: `rr.adminRefundAmount !== null` 이면 그 값, 아니면 지금처럼 계산(세트 일부 400 문구는 그대로 둔다 — 3a 때 생긴 금액 없는 `refund_pending` 행용).

- [ ] **Step 4: 라우트·DTO·PII 줄** — 위 Interfaces 그대로. `getReturnRefundQuote` 는 `@Param('id')` 만, 금액 완료는 `@User() admin` + `@Body() dto`.

- [ ] **Step 5: 통과 확인** — Step 2 명령 → 새 테스트 PASS, 기준선 대비 새 실패 0. 이어서 `npx jest scripts/security apps/core/src/modules/sales-order/line-quantities/line-quantity-read.guard.spec.ts libs/authorization` → PASS.

- [ ] **Step 6: 커밋** — `feat(sales-order): 세트 일부 반품은 관리자가 상한 안에서 금액을 넣어 완료한다 (K6 PR3b)`

---

### Task 3: 반품 이벤트의 남은 수량 (F9, U3)

**Files:**
- Modify: `packages/event-contracts/streams/orders.stream.ts:512-546`
- Modify: `apps/core/src/modules/sales-order/services/store-return-exchange.service.ts` (`enqueueReturnCompletedEvent` 의 `returnedLines` map)
- Modify: `apps/ugc-service/src/reviews/rewards/order-return.policy.ts`, `__tests__/order-return.policy.spec.ts`
- Test: `store-return-exchange.claims.integration.spec.ts`

**Interfaces:**
- Produces: `returnedLines[i].remainingQuantity?: number` — 계약 인터페이스에 문서 주석(«그 라인의 주문 − 취소 전부(판매 단위). 없으면 옛 생산자다 — 소비자는 `orderedQuantity` 로 대신한다.»), zod `z.number().int().nonnegative().optional()`. ugc `ReturnedLineInput.remainingQuantity?: number`; `planReturn` 의 부분 판정은 `line.returnedQuantity < (line.remainingQuantity ?? line.orderedQuantity)`.

- [ ] **Step 1: 실패하는 테스트**
  - ugc `order-return.policy.spec.ts`: `revokes when returned equals remaining after a cancellation` — `line({ orderedQuantity: 3, remainingQuantity: 2, returnedQuantity: 2 })` → `REVOKE_LINES`; `keeps partial when below remaining` — `{3, remaining 2, returned 1}` → `PARTIAL_QUANTITY`; `falls back to ordered quantity without remaining` — `{3, returned 2}` → `PARTIAL_QUANTITY`.
  - core 통합: 기존 `whole set return publishes returned sets` 기대에 `remainingQuantity: 1` 추가. 새 `returned event carries remaining after an after-shipment cancellation` — 단품 라인 수량 2(소포 하나 qty 2, `seedSingle` 꼴), `over-limit message clamps…` 테스트와 같은 출고 뒤 취소 1 기록, `seedClaim(status 'refund_pending', items [parcelLine(line,0,skuId,1)])` → `manualCompleteReturn` → 페이로드 `returnedLines: [{ orderedQuantity: 2, returnedQuantity: 1, remainingQuantity: 1 }]`.

- [ ] **Step 2: 실패 확인** — `npx jest apps/ugc-service/src/reviews/rewards/__tests__/order-return.policy.spec.ts` FAIL; core 통합 명령 FAIL.

- [ ] **Step 3: 구현** — 계약 칸, core 는 이미 읽은 `lineQuantities.get(id)?.remaining` 을 싣는다(라인이 없으면 그 줄은 `returnedSets` 0 으로 이미 빠진다), ugc 판정 한 줄 + `ReturnedLineInput` 주석 갱신. ugc 컨슈머는 페이로드 줄을 그대로 넘기므로 바꾸지 않는다.

- [ ] **Step 4: 통과 확인** — Step 2 두 명령 PASS, `npm run type-check` 새 에러 0.

- [ ] **Step 5: 커밋** — `feat(events): 반품 이벤트에 라인의 남은 수량 — ugc 가 취소 뒤 전량 반품을 회수 (K6 PR3b)`

---

### Task 4: admin-web 금액 입력

**Files:**
- Modify: `apps/admin-web/src/lib/api/domains/return-exchange/index.ts` (`completeReturn` 옆)
- Modify: `apps/admin-web/src/lib/services/return-exchange/query-keys.ts`, `queries.ts`, `mutations.ts`
- Create: `apps/admin-web/src/features/cs/return-exchange/admin-refund-amount.ts`, `admin-refund-amount.spec.ts`
- Modify: `apps/admin-web/src/features/cs/return-exchange/components/return-requests-table/index.tsx` (401~ «완료 처리» 버튼, 664~ 수동 완료 Dialog 옆에 새 Dialog)

**Interfaces:**
- Consumes: Task 2 라우트 둘, `ReturnRefundQuote` 모양.
- Produces:
  ```ts
  // api
  export type ReturnRefundQuote = { kind: 'automatic'; amount: number } | { kind: 'admin_amount'; cap: number };
  getReturnRefundQuote(id: string): Promise<ReturnRefundQuote>;                    // GET …/refund-quote
  completeReturnWithAmount(id: string, body: { refundAmount: number; adminNote: string }): Promise<ReturnRequest>;
  // query-keys
  returnRefundQuote: (id: string) => [...allReturns, 'refund-quote', id] as const;
  // queries — 클릭 때 한 번 부른다(행마다 훅을 두지 않는다)
  export function fetchReturnRefundQuote(qc: QueryClient, id: string): Promise<ReturnRefundQuote>; // fetchQuery, staleTime 0
  // mutations
  useCompleteReturnWithAmount = () => useMutation({ mutationFn: ({ id, refundAmount, adminNote }) => …, onSuccess: allReturns 무효화 });
  useCompleteReturnWithAmount.permission = ['payment.refund.execute'] as const satisfies PermissionRequirement;
  // admin-refund-amount.ts
  export type CompletionDecision =
    | { kind: 'complete_now' }
    | { kind: 'ask_amount'; cap: number }
    | { kind: 'blocked'; message: string };
  export function decideCompletion(quote: ReturnRefundQuote, canEnterAmount: boolean): CompletionDecision;
  export function parseAdminRefundAmount(input: string, cap: number):
    { ok: true; amount: number } | { ok: false; message: string };
  ```
- 문구(정확히): blocked `세트 구성품 일부 반품은 환불 실행 권한이 있어야 완료할 수 있습니다.` · 숫자 아님 `환불 금액을 0 이상의 정수로 입력하세요.` · 초과 `` `상한 ${cap}원을 넘을 수 없습니다.` `` · 창 제목 `환불 금액 입력` · 창 안내 `` `세트 구성품 일부 반품입니다. 상한 ${cap}원 안에서 환불할 금액과 메모를 입력하세요.` `` · 버튼 `환불하고 완료`.

- [ ] **Step 1: 실패하는 테스트 `admin-refund-amount.spec.ts`**
  - `automatic quote completes now` — `decideCompletion({kind:'automatic', amount: 5000}, false)` → `{kind:'complete_now'}`.
  - `admin amount asks for the amount` — `({kind:'admin_amount', cap: 2000}, true)` → `{kind:'ask_amount', cap: 2000}`.
  - `admin amount without refund permission is blocked` — `(…, false)` → `{kind:'blocked', message: <위 문구>}`.
  - `parses an integer within the cap` — `('1200', 2000)` → `{ok:true, amount:1200}`; `(' 0 ', 2000)` → `{ok:true, amount:0}`.
  - `rejects non-integers` — `''`, `'12.5'`, `'-1'`, `'1,200'` → `{ok:false, message:'환불 금액을 0 이상의 정수로 입력하세요.'}`.
  - `rejects over the cap` — `('2001', 2000)` → `{ok:false, message:'상한 2000원을 넘을 수 없습니다.'}`.

- [ ] **Step 2: 실패 확인** — `npm run test:admin-web -- admin-refund-amount` → FAIL.

- [ ] **Step 3: 순수 함수 + API·키·훅 구현.** `parseAdminRefundAmount` 는 trim 뒤 `/^\d+$/` 만 받는다.

- [ ] **Step 4: 표 연결.** «완료 처리» 클릭 → `fetchReturnRefundQuote` → `decideCompletion(quote, canRun(useCompleteReturnWithAmount))`: `complete_now` 면 지금처럼 `complete.mutateAsync`; `ask_amount` 면 새 Dialog(금액 입력 + 상한 안내 + 메모 Textarea, 제출 시 `parseAdminRefundAmount` 실패 메시지를 입력 아래에 보이고, 메모가 비면 버튼 비활성 — 수동 완료 Dialog 와 같은 꼴); `blocked` 면 기존 `act` 의 오류 토스트 경로로 문구. 견적 호출 실패는 기존 `act` 오류 처리에 맡긴다.

- [ ] **Step 5: 통과 확인** — `npm run test:admin-web` PASS(로컬 ICU «오전/AM» 실패는 기준선), `npx tsc --noEmit -p apps/admin-web` 새 에러 0(CI 가 admin-web tsc 를 안 돌린다), `mutation-guard.gate.spec`·`screen-access.gate.spec` 포함.

- [ ] **Step 6: 커밋** — `feat(admin-web): 세트 일부 반품의 환불 금액 입력 (K6 PR3b)`

---

### Task 5: ADR·스펙 정정과 게이트

**Files:**
- Modify: `docs/adr/0047-line-quantity-facts-one-record-one-reader.md` («3b 로 넘긴 것» 을 «PR 3b 가 정한 것» 으로 바꾸고 U1~U3·A1~A7 을 한 줄씩, «이후 PR» 의 PR 3b 줄에 결과)
- Modify: `docs/superpowers/specs/2026-10-20-k6-line-quantity-facts-design.md` §6.5 `SalesOrderReturned` 줄(`demand` → `remainingQuantity`, 이유 한 줄)·§8 D7(상한 = 취소 안 된 비율로 줄인 배분액, 앞선 반품 금액 규칙 A4)

- [ ] **Step 1: 문서 갱신** (위 두 파일만. 수치는 적지 않고 함수·파일 이름을 적는다).

- [ ] **Step 2: 전체 게이트** — `npm run type-check`(환경 3 외 0), `npx jest --maxWorkers=2`(로컬 환경 실패 외 0), `k6_it` 에서 `apps/core/src/modules/sales-order/**/*.integration.spec.ts`(기준선 대비 새 실패 0).

- [ ] **Step 3: 커밋** — `docs(adr): K6 PR3b 결과와 스펙 이탈(남은 수량·상한 비율) (K6 PR3b)`

PR 본문 «배포 절차»(초안은 scratchpad): 3a·2b 가 같은 배포에 실리면 #1118·#1116 절차 먼저 → `npm run deploy:preflight -- --stage live` → `npm run db:migrate -- --stage live --deployment lcnine-services --yes`(새 마이그 `add-return-admin-refund-amount`, additive) → `sst deploy`(Core·ugc·admin-web). 라이브 `return_request_items` 0행이라 동작 변화는 컷오버 전까지 관찰되지 않는다.
