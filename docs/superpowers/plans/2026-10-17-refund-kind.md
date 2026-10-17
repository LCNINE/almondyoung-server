# 환불 종류 (#1016 40번) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** wallet 환불 행마다 «무엇을 되돌린 돈인가»(종류)를 기록하고, 모든 환불 경로가 그 종류를 싣고, admin-web 이 보여 주고 고칠 수 있게 하며, 옛 행 643건을 세 단계로 채운다.

**Architecture:** wallet `refunds` 에 nullable `kind` 칸(pgEnum)을 더하고 API 는 선택 입력으로 받는다. 호출자(Medusa 표식·core·membership·admin-web)는 자기가 아는 종류를 싣는다. `reason_code` 는 손대지 않는다. 옛 행은 순수 판정 모듈 + 일회성 스크립트(dry-run 기본)로 채운다.

**Tech Stack:** NestJS · Drizzle(postgres.js) · class-validator · Medusa 2.13 provider/workflow · Next.js(admin-web, TanStack) · Jest

**Spec:** `docs/superpowers/specs/2026-10-17-refund-kind-design.md`

## Global Constraints

- 종류 값(이 철자 그대로, 모든 앱 공통): `ITEM_CANCEL` · `RETURN` · `PRICE_ADJUSTMENT` · `SUBSCRIPTION_FEE` · `PAYMENT_ERROR`. null = 모름.
- 화면 이름(이 문구 그대로): 품목 취소 · 반품 · 금액 조정 · 구독료 환불 · 결제 오류 · (null) 모름.
- `reason_code` 의 기존 값·쓰는 자리를 바꾸지 않는다. 특히 Medusa provider 의 `reasonCode: 'MEDUSA_REFUND'` 는 그대로.
- API 에서 `kind` 는 언제나 **선택**이다. 종류 때문에 환불이 거절되면 안 된다(모르는 값만 400).
- `gateway.refund.succeeded` 이벤트 payload 는 바꾸지 않는다.
- 마이그 1건(wallet), additive → `migrate → deploy`. 이름: `npm run db:generate:wallet -- --name add-refund-kind`.
- **PR 1(wallet, Task 1~4) 이 라이브에 뜬 뒤에 PR 2(Task 5~8)를 머지·배포한다**(스펙 §5 멱등 키). PR 3(Task 9)은 PR 1 배포 뒤 아무 때나.
- 게이트: `npm run type-check` 0 · `npx jest` 실패 0. admin-web 은 `npm run test:admin-web` + admin-web tsc. Medusa 는 `cd apps/medusa && npm run test:unit`.
- admin-web 은 컴포넌트 테스트를 쓰지 않는다 — 판정은 순수 함수로 빼서 그 함수를 테스트한다.
- 커밋 메시지는 한국어, 이 저장소 관례(`feat(wallet): …`)를 따른다.

## Review Focus

1. **같은 멱등 키 재시도에 `kind` 가 붙거나 빠져도** 409 가 아니라 첫 응답 replay 여야 한다 → Task 2 테스트.
2. **응답 끊긴 환불을 같은 행으로 되살릴 때**(`resumeAmbiguousInTx`) 그 행의 원래 종류와 PG 사유가 유지돼야 한다 — 이번 요청의 `kind` 로 바뀌면 안 된다 → Task 3 테스트.
3. **관리자가 종류를 비우기(null)로 고치는 것**도 허용되고 이력이 남아야 한다 → Task 4 테스트.
4. **목록 필터 «모름»** 은 `kind is null` 행을 돌려줘야 한다(빈 결과가 아니라) → Task 4 테스트.
5. **Medusa 에 앞 시도가 남긴 종류 표식**이 금액이 다른 다음 환불에 붙으면 안 된다 → Task 5 테스트.

---

## PR 1 — wallet

### Task 1: `refunds.kind` 칸과 생성 경로

**Files:**
- Create: `apps/wallet/src/refunds/refund-kind.ts`, `apps/wallet/src/refunds/refund-kind.spec.ts`
- Modify: `apps/wallet/src/schema.ts`(enum + `refunds.kind`), `apps/wallet/drizzle/`(생성), `apps/wallet/src/refunds/dto/index.ts`(`CreateRefundDto`·`RefundResponseDto`·`RefundListItemDto`), `apps/wallet/src/payment-intents/dto/index.ts`(`RefundByIntentDto` — 컨트롤러가 dto 를 통째로 `createByIntent` 에 넘기므로 컨트롤러는 안 고친다), `apps/wallet/src/admin/payment-intent-admin.controller.ts`(`AdminRefundDto`), `apps/wallet/src/refunds/refunds.service.ts`(`create` insert, `createByIntent` 시그니처·전달), `apps/wallet/src/refunds/refund-requests.service.ts`(`approve`), `apps/wallet/src/refunds/refund-response.ts`, `apps/wallet/src/admin/payment-intent-admin.service.ts`(`refundRowsQuery`·`toAdminRefund`), `docs/adr/0043-refund-is-classified-by-what-it-reverses.md`, `apps/wallet/CLAUDE.md`
- Test: `apps/wallet/src/refunds/refund-kind.spec.ts`, `apps/wallet/src/refunds/refunds.service.spec.ts`, `apps/wallet/src/refunds/refund-response.spec.ts`

**Interfaces:**
- Produces:
  - `schema.ts`: `export const refundKindEnum = pgEnum('refund_kind', ['ITEM_CANCEL','RETURN','PRICE_ADJUSTMENT','SUBSCRIPTION_FEE','PAYMENT_ERROR'])`, `export type RefundKind = (typeof refundKindEnum.enumValues)[number]`, `refunds.kind: refundKindEnum('kind')` (nullable, 기본값 없음)
  - `refund-kind.ts`: `export const REFUND_KIND_LABELS: Record<RefundKind, string>`(Global Constraints 문구), `export function isRefundKind(v: unknown): v is RefundKind`
  - `CreateRefundDto.kind?: RefundKind`(`@IsOptional() @IsIn(refundKindEnum.enumValues)`), 같은 필드를 `RefundByIntentDto`·`AdminRefundDto` 에도. 관리자 컨트롤러 `refund()` 는 `kind: dto.kind` 를 `create` 에 넘긴다
  - `createByIntent(intentId, dto: { …기존, kind?: RefundKind })` — 결제분마다 같은 `kind` 로 `create`
  - 응답 `RefundResponseDto.kind: RefundKind | null`, `RefundListItemDto.kind: RefundKind | null`

- [ ] **Step 1: 실패하는 테스트**
  - `refund-kind.spec.ts`: `REFUND_KIND_LABELS` 의 키가 `refundKindEnum.enumValues` 와 정확히 같고 값이 Global Constraints 문구와 같다. `isRefundKind('ITEM_CANCEL') === true`, `isRefundKind('item_cancel') === false`, `isRefundKind(null) === false`.
  - `refunds.service.spec.ts`: `create({ …, kind: 'RETURN' })` 의 insert values 에 `kind: 'RETURN'`; `kind` 없으면 `kind: null`. `createByIntent(id, { amount, kind: 'ITEM_CANCEL' })` 가 두 결제분(포인트+토스) 각각의 `create` 에 `kind: 'ITEM_CANCEL'` 을 넘긴다.
  - `refund-response.spec.ts`: `toRefundResponse`·`toRefundListItem` 이 `kind` 를 그대로 싣는다(null 포함).
  - `refund-requests` 승인: `create` 가 `kind: 'ITEM_CANCEL'` 로 불린다(기존 spec 이 있으면 거기, 없으면 `refunds.service.spec.ts` 옆에 승인 단위 테스트).
- [ ] **Step 2: 돌려서 실패 확인** — `npx jest apps/wallet/src/refunds` → 새 테스트 FAIL
- [ ] **Step 3: 구현** — 위 Interfaces 대로. 관리자 목록·상세 select(`refundRowsQuery`)와 `toAdminRefund` 에도 `kind`. 그 뒤 `npm run db:generate:wallet -- --name add-refund-kind` 로 마이그 생성, SQL 이 `CREATE TYPE "public"."refund_kind"` + `ALTER TABLE "refunds" ADD COLUMN "kind" "refund_kind"` 두 문장뿐인지 확인.
- [ ] **Step 4: ADR·문서** — ADR-0043 «축 1» 표 아래에 한 단락: «구독료 환불(주문 없는 결제)·결제 오류(받으면 안 됐던 돈)를 더한다 — #1016 40번 스펙». `apps/wallet/CLAUDE.md` 환불 절에 한 줄: «`refunds.kind` = 무엇을 되돌렸나(선택, null=모름). `reason_code` 는 출처 표지·고객 사유로 남는다».
- [ ] **Step 5: 통과 확인** — `npx jest apps/wallet/src/refunds` PASS, `npm run type-check` 0
- [ ] **Step 6: 커밋** — `feat(wallet): 환불 종류 칸 — 생성 경로가 kind 를 받아 남긴다 (#1016 40번)`

### Task 2: 환불 생성 요청의 멱등 해시에서 `kind` 제외

**Files:**
- Modify: `apps/wallet/src/domain/idempotency/http-idempotency.interceptor.ts`, `apps/wallet/src/domain/idempotency/idempotency.service.ts`(`beginHttpRequest` 가 해시용 바디를 따로 받거나, 인터셉터가 걸러서 넘김 — 둘 중 하나)
- Create/Test: `apps/wallet/src/domain/idempotency/http-idempotency.interceptor.spec.ts`

**Interfaces:**
- Produces: `export function bodyForRequestHash(method: string, path: string, body: unknown): unknown` (인터셉터 파일) — 아래 세 경로에서만 최상위 `kind` 를 뺀 얕은 사본, 그 밖은 원본 그대로:
  - `POST /v1/payment-intents/:id/refund` · `POST /v1/admin/payment-intents/:id/refund` · `POST /v1/refunds`
- 저장되는 `requestBody`(보관용)는 바꾸지 않는다 — 해시 입력만 바뀐다.

- [ ] **Step 1: 실패하는 테스트** — `bodyForRequestHash('POST','/v1/payment-intents/abc/refund',{amount:1000,kind:'RETURN'})` 가 `{amount:1000}` 과 같은 해시 입력; 같은 경로 `{amount:1000}` 은 그대로; `'/v1/payment-intents/abc/capture'` 의 `{kind:'X'}` 는 그대로(다른 경로는 건드리지 않는다); 배열·null 바디는 그대로. 그리고 `IdempotencyService` 단위 테스트(기존 repository mock 패턴)로: 같은 키에 `{amount}` 로 SUCCESS 기록 → `{amount, kind}` 재요청이 `REPLAY`(409 아님).
- [ ] **Step 2: 실패 확인** — `npx jest apps/wallet/src/domain/idempotency` FAIL
- [ ] **Step 3: 구현** — 경로 판정은 `normalizeRequestPath` 결과에 정규식. 해시 함수(`hashRequestBody`)는 그대로 두고 입력만 바꾼다.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS
- [ ] **Step 5: 커밋** — `fix(wallet): 환불 요청 멱등 해시에서 종류를 뺀다 — 같은 키 재시도가 409 가 되지 않게 (#1016 40번)`

### Task 3: PG 취소 사유 = 종류 이름

**Files:**
- Modify: `apps/wallet/src/providers/payment-provider.interface.ts`(`RefundParams.reasonCode` → `cancelReason`), `toss/toss.provider.ts`·`toss/toss-billing.provider.ts`·`nicepay/nicepay.provider.ts`·`bank-transfer/bank-transfer.provider.ts`(필드 이름만), `apps/wallet/src/refunds/refund-kind.ts`, `apps/wallet/src/refunds/refunds.service.ts`(`dispatch`)
- Test: `apps/wallet/src/refunds/refund-kind.spec.ts`, `apps/wallet/src/refunds/refunds.service.spec.ts`, 각 provider spec 의 기존 `reasonCode` 기대값을 `cancelReason` 으로

**Interfaces:**
- Consumes: `REFUND_KIND_LABELS`(Task 1)
- Produces: `export function pgCancelReason(refund: { kind: RefundKind | null; reasonCode: string | null }): string | undefined` — `kind` 가 있으면 `REFUND_KIND_LABELS[kind]`, 없으면 `reasonCode ?? undefined`. provider 의 기본값(`'고객 요청'`·`'환불'`)은 그대로 provider 에 남는다.

- [ ] **Step 1: 실패하는 테스트** — `pgCancelReason({kind:'ITEM_CANCEL',reasonCode:'MEDUSA_REFUND'}) === '품목 취소'`; `({kind:null,reasonCode:'엘라 품절'}) === '엘라 품절'`; `({kind:null,reasonCode:null}) === undefined`. `refunds.service.spec.ts`: `kind: 'RETURN'` 행 dispatch 시 provider.refund 가 `cancelReason: '반품'` 으로 불린다. **Review Focus 2:** `kind: 'RETURN'` 인 응답 끊긴 행이 있을 때 `create({…, kind: 'PRICE_ADJUSTMENT'})` 가 그 행을 되살리면 provider 는 `cancelReason: '반품'` 으로 불리고 행의 `kind` 는 `'RETURN'` 그대로다.
- [ ] **Step 2: 실패 확인** — `npx jest apps/wallet/src/refunds apps/wallet/src/providers` FAIL
- [ ] **Step 3: 구현** — `dispatch` 가 `cancelReason: pgCancelReason(refund)`. 이름 바꾼 필드를 provider 넷이 읽는다.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `npm run type-check` 0
- [ ] **Step 5: 커밋** — `feat(wallet): PG 취소 사유를 환불 종류 이름으로 보낸다 (#1016 40번)`

### Task 4: 관리자 목록 종류 필터와 종류 고치기 API

**Files:**
- Modify: `apps/wallet/src/admin/dto/admin-refund.dto.ts`, `apps/wallet/src/admin/payment-intent-admin.service.ts`(`buildRefundConditions`), `apps/wallet/src/admin/refund-admin.controller.ts`, `apps/wallet/src/refunds/refunds.service.ts`
- Test: `apps/wallet/src/admin/payment-intent-admin.list-refunds.integration.spec.ts`(필터), `apps/wallet/src/admin/refund-admin.controller.spec.ts`, `apps/wallet/src/refunds/refunds.service.spec.ts`(changeKind)

**Interfaces:**
- Consumes: `RefundKind`, `refundKindEnum`(Task 1)
- Produces:
  - `AdminRefundListQueryDto.kind?: RefundKind | 'UNKNOWN'` — `'UNKNOWN'` 은 `isNull(refunds.kind)`
  - `PATCH /v1/admin/refunds/:id/kind` 바디 `{ kind: RefundKind | null }`(`@WalletAdminAuth()` 컨트롤러 그대로, 액터는 `req.jwtUserId ?? 'admin'` — `refund-requests-admin.controller.ts` 와 같다) → `RefundResponseDto`
  - `RefundsService.changeKind(refundId: string, kind: RefundKind | null, actorId: string): Promise<Refund>` — 한 트랜잭션에서 행 잠금 → 같으면 아무것도 안 쓰고 그대로 반환 → 다르면 `kind` 갱신 + `payment_state_transitions` 한 행: `entityType 'REFUND'`, `previousStatus = newStatus = 현재 status`, `reasonCode 'KIND_CHANGED'`, `triggeredByType 'ADMIN'`, `triggeredById actorId`, `payload { fromKind, toKind }`, `correlationId` 는 `kind-change:<refundId>:<ms>`. 없는 id 는 `NotFoundException`. 상태 제한 없음(스펙 §6.1).

- [ ] **Step 1: 실패하는 테스트**
  - 통합(`describeIfDb` 가드 그대로): 종류 `RETURN`·null 두 행 → `kind=RETURN` 은 첫 행만, **`kind=UNKNOWN` 은 null 행만**(Review Focus 4).
  - 컨트롤러: 바디 `{kind:'nope'}` → 400, `{kind:null}` 허용.
  - 서비스: `ITEM_CANCEL → PRICE_ADJUSTMENT` 가 행을 바꾸고 transitions 에 `{fromKind:'ITEM_CANCEL',toKind:'PRICE_ADJUSTMENT'}`; **`RETURN → null` 도 허용·기록**(Review Focus 3); 같은 값이면 insert 0회.
- [ ] **Step 2: 실패 확인** — `npx jest apps/wallet/src/admin apps/wallet/src/refunds` FAIL (통합은 `dotenv -e apps/wallet/.env -- npx jest <파일> --runInBand` 로 따로)
- [ ] **Step 3: 구현** — 위 Interfaces 대로
- [ ] **Step 4: 통과 확인** — 단위 PASS, 통합 PASS, `npm run type-check` 0, `npx jest` 실패 0
- [ ] **Step 5: 커밋** — `feat(wallet): 관리자 환불 목록 종류 필터와 종류 고치기 (#1016 40번)`
- [ ] **Step 6: PR 1** — 본문에 배포 절차: `db:migrate`(wallet) → `sst deploy` → wallet ECS 실제 taskDefinition 이 새 리비전인지 확인. **PR 2 는 이게 끝난 뒤.** #1016 «남은 운영 작업»에 체크박스 셋(PR 1 배포·옛 행 dry-run 건수·`--apply` 건수)을 단다.

---

## PR 2 — 호출자 (PR 1 라이브 뒤)

### Task 5: Medusa — 종류 표식과 provider

**Files:**
- Modify: `apps/medusa/src/modules/almond-payment/refund-data.ts`, `apps/medusa/src/modules/almond-payment/service.ts`(`refundPayment`), `apps/medusa/src/workflows/orders/settlement/issue-payment-refund.ts`, `apps/medusa/src/workflows/orders/partial-cancel/partial-cancel-order.ts`·`channel-cancel/channel-cancel-order.ts`(호출부에 `kind: 'ITEM_CANCEL'`), `apps/medusa/src/workflows/orders/steps/capture-order-payments-step.ts`(compensate), `apps/medusa/src/scripts/orphan-payment-reconcile.ts`
- Test: `apps/medusa/src/modules/almond-payment/__tests__/refund-data.unit.spec.ts`, `…/refund-payment.unit.spec.ts`

**Interfaces:**
- Produces (`refund-data.ts`, wallet 값과 같은 철자 — 주석으로 `apps/wallet/src/schema.ts refundKindEnum` 을 정본으로 가리킨다):
  - `export type WalletRefundKind = 'ITEM_CANCEL' | 'RETURN' | 'PRICE_ADJUSTMENT' | 'SUBSCRIPTION_FEE' | 'PAYMENT_ERROR'`
  - `export type RefundKindMarker = { kind: WalletRefundKind; amount: number }`
  - `readRefundKind(data): RefundKindMarker | null`, `withRefundKind(data, marker): Record<string, unknown>` — 결제 `data.refundKind`. 지울 때는 `null` 로 쓴다(`payment-data.ts` 규칙)
  - `issuePaymentRefund(container, input: { …기존, kind: WalletRefundKind })` — 첫 쓰기에 `withRefundKind(…, { kind: input.kind, amount: input.amount })`, 성공 뒤 `refundAttempt: null` 과 함께 `refundKind: null`
- `refundPayment`: 표식이 있고 `marker.amount === refundAmount` 일 때만 바디에 `kind` 를 더한다. `reasonCode: 'MEDUSA_REFUND'` 는 그대로.
- compensate: 결제마다 `retrievePayment(id, { select: ['id','data','amount'] })` → `withRefundKind({ kind: 'PAYMENT_ERROR', amount })` 를 쓰고 `refundPaymentWorkflow`.
- orphan 스크립트: 바디에 `kind: 'PAYMENT_ERROR'`.

- [ ] **Step 1: 실패하는 테스트** — `refund-data`: read/with 왕복, 모양이 틀린 값은 null. `refundPayment`: 표식 `{ITEM_CANCEL, 3000}` + 환불 3000 → wallet 바디에 `kind:'ITEM_CANCEL'` 과 `reasonCode:'MEDUSA_REFUND'`; **표식 금액 5000 + 환불 3000 → 바디에 `kind` 없음**(Review Focus 5); 표식 없음 → `kind` 없음.
- [ ] **Step 2: 실패 확인** — `cd apps/medusa && npm run test:unit -- refund-data refund-payment` FAIL
- [ ] **Step 3: 구현** — 위 Interfaces 대로. 호출부 두 곳은 `kind: 'ITEM_CANCEL'`.
- [ ] **Step 4: 통과 확인** — `cd apps/medusa && npm run test:unit` PASS, `npx tsc --noEmit -p apps/medusa`(medusa 게이트 위치는 메모리 `medusa-storefront-gate-topology` 참고) 0
- [ ] **Step 5: 커밋** — `feat(medusa): 환불에 종류 표식을 실어 wallet 에 보낸다 (#1016 40번)`

### Task 6: core — 반품·취소 환불에 종류

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/wallet-refund.client.ts`, `…/store-return-exchange.service.ts`, `…/store-sales-orders.service.ts`(`refundByIntent` 호출 두 곳)
- Test: `apps/core/src/modules/sales-order/services/wallet-refund.client.spec.ts`, `…/store-return-exchange.service.spec.ts`, `…/store-sales-orders.service.spec.ts`

**Interfaces:**
- Produces: `wallet-refund.client.ts` 에 `export type WalletRefundKind = 'ITEM_CANCEL' | 'RETURN' | 'PRICE_ADJUSTMENT' | 'SUBSCRIPTION_FEE' | 'PAYMENT_ERROR'`(정본 주석은 Task 5 와 같다), `refundByIntent(intentId, amount, options: { kind?: WalletRefundKind; reasonCode?; reasonMessage?; correlationId })` — `kind` 를 바디에 싣는다
- 반품(`RETURN_COMPLETED` 호출) → `kind: 'RETURN'`; 취소(`dto.reasonCode ?? 'CUSTOMER_CANCEL'` 호출) → `kind: 'ITEM_CANCEL'`

- [ ] **Step 1: 실패하는 테스트** — 클라이언트: fetch 바디에 `kind:'RETURN'`; `kind` 없으면 바디에 키가 없다(JSON 에서 undefined 는 빠진다 — 그걸 단언). 반품 서비스 spec: `refundByIntent` 가 `expect.objectContaining({ kind: 'RETURN', reasonCode: 'RETURN_COMPLETED' })`. 취소 spec: `kind: 'ITEM_CANCEL'`.
- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/sales-order/services` FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS
- [ ] **Step 5: 커밋** — `feat(core): 반품·취소 환불에 종류를 싣는다 (#1016 40번)`

### Task 7: membership — 구독료 환불

**Files:**
- Modify: `apps/membership/src/services/billing/payment-client.service.ts`(`refundByIntent` 바디)
- Test: `apps/membership/src/services/billing/payment-client.service.spec.ts`(없으면 만든다 — `HttpService.post` mock)

**Interfaces:** 바디에 언제나 `kind: 'SUBSCRIPTION_FEE'`. 시그니처는 그대로(이 클라이언트의 환불은 전부 구독료다).

- [ ] **Step 1: 실패하는 테스트** — `refundByIntent('i1', 9900, 'NOT_USING')` 의 post 바디가 `objectContaining({ kind: 'SUBSCRIPTION_FEE', reasonCode: 'NOT_USING', allowMembershipRefund: true })`
- [ ] **Step 2: 실패 확인** — `npx jest apps/membership/src/services/billing/payment-client` FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: 커밋** — `feat(membership): 해지 환불에 구독료 환불 종류를 싣는다 (#1016 40번)`

### Task 8: admin-web — 종류 선택·표시·필터·고치기

**Files:**
- Create: `apps/admin-web/src/lib/api/domains/wallet/refund-kind.ts`, `…/refund-kind.spec.ts`
- Modify: `apps/admin-web/src/lib/types/dto/wallet.ts`(`RefundDto.kind`), `apps/admin-web/src/lib/api/domains/wallet/index.ts`(`refundIntent` 바디 `kind`, `listRefunds` 쿼리 `kind`, 새 `changeRefundKind`), `apps/admin-web/src/lib/services/wallet/mutations.ts`(`useRefundIntent` dto, 새 `useChangeRefundKind`), `apps/admin-web/src/app/(admin)/payments/[id]/payment-detail-sidebar.tsx`(폼), `…/payment-detail-main.tsx`(환불 이력 칸), `apps/admin-web/src/hooks/table/columns/use-refund-table-columns.tsx`, `apps/admin-web/src/hooks/table/filters/use-refund-table-filters.ts`

**Interfaces:**
- Produces (`refund-kind.ts`):
  - `export const REFUND_KINDS = ['ITEM_CANCEL','RETURN','PRICE_ADJUSTMENT','SUBSCRIPTION_FEE','PAYMENT_ERROR'] as const`, `export type RefundKind = (typeof REFUND_KINDS)[number]`
  - `export function refundKindLabel(kind: unknown): string` — 다섯 값은 Global Constraints 문구, 그 밖(null·모르는 문자열)은 `'모름'`
  - `export const REFUND_KIND_FILTER_OPTIONS: { label: string; value: RefundKind | 'UNKNOWN' }[]` — 다섯 + `{ label: '모름', value: 'UNKNOWN' }`
  - `export function refundFormError(input: { kind: RefundKind | ''; amount: number | '' }): string | null` — 종류 미선택이면 `'환불 종류를 골라 주세요'`, 금액이 없거나 1 미만이면 기존 문구, 아니면 null
- `walletApi.changeRefundKind(id: string, kind: RefundKind | null): Promise<RefundDto>` → `PATCH ${BASE}/v1/admin/refunds/:id/kind`
- 폼: «사유 코드»·«사유 메시지» 두 입력 → «종류»(필수 select) + «메모»(선택, `reasonMessage` 로 보낸다). 폼은 `reasonCode` 를 보내지 않는다. 실패 토스트는 `result.reasonMessage ?? result.failureCode ?? 'PG 오류'`.
- 목록: «종류» 칸을 «사유 코드» 앞에(`refundKindLabel`), 필터에 `kind`. 결제 상세 환불 이력에 같은 칸. 종류 칸을 누르면 select 로 바꾸는 상호작용(목록·상세 공용 셀 하나), 성공 시 `walletQueryKeys.refunds()`·`intentDetail(intentId)` 무효화.

- [ ] **Step 1: 실패하는 테스트** — `refund-kind.spec.ts`: 라벨 다섯 + `refundKindLabel(null)==='모름'`, `refundKindLabel('MEDUSA_REFUND')==='모름'`; 필터 옵션 여섯, 마지막이 `UNKNOWN`; `refundFormError({kind:'',amount:1000})==='환불 종류를 골라 주세요'`, `({kind:'RETURN',amount:1000})===null`.
- [ ] **Step 2: 실패 확인** — `npm run test:admin-web -- refund-kind` FAIL
- [ ] **Step 3: 구현** — 위대로. 폼 제출 버튼은 `refundFormError` 가 null 일 때만.
- [ ] **Step 4: 통과 확인** — `npm run test:admin-web` PASS, admin-web tsc 0
- [ ] **Step 5: 브라우저 확인** — 로컬 E2E(`docs/local-e2e-environment.md`)에서 결제 상세 → 환불 폼에 종류 없이 제출 불가 / 고르면 환불 → 목록에 종류 표시 / 종류 칸에서 «금액 조정»으로 바꾸기 → 새로고침 뒤 유지 / 필터 «모름». 로그인은 사용자가 직접 한다.
- [ ] **Step 6: 커밋** — `feat(admin-web): 환불 종류 선택·표시·필터·고치기 (#1016 40번)`
- [ ] **Step 7: PR 2** — Task 5~8 을 한 PR(또는 앱별로). 본문 첫 줄에 «PR 1 라이브 뒤 머지». 마이그 없음.

---

## PR 3 — 옛 행

### Task 9: 옛 행 세 단계 채우기 스크립트

**Files:**
- Create: `scripts/ops/1016-40-refund-kind-rules.ts`(순수 판정), `scripts/ops/1016-40-refund-kind-rules.spec.ts`, `scripts/ops/1016-40-backfill-refund-kind.ts`(DB·CSV·적용)

**Interfaces:**
- Produces (`rules.ts`):
  - `type Kind = 'ITEM_CANCEL' | 'RETURN' | 'PRICE_ADJUSTMENT' | 'SUBSCRIPTION_FEE' | 'PAYMENT_ERROR'`
  - `type OldRefund = { id: string; reasonCode: string | null; reasonMessage: string | null; intentPurpose: string; medusaNotes: string[] | null }`
  - `type Verdict = { step: 1; kind: Kind; why: string } | { step: 2; candidate: Kind; why: string } | { step: 3; why: string }`
  - `export function classifyOldRefund(r: OldRefund): Verdict` — 스펙 §7 순서 그대로:
    - 1단계: `intentPurpose === 'SUBSCRIPTION'` → `SUBSCRIPTION_FEE` · `RETURN_COMPLETED` → `RETURN` · `CUSTOMER_REFUND_REQUEST`·`CUSTOMER_CANCEL`·`CHANGE_OF_MIND`·`WRONG_ORDER`·`FOUND_CHEAPER`·`DELAY`·`OTHER` → `ITEM_CANCEL` · `ORPHAN_PAYMENT_RECONCILE` → `PAYMENT_ERROR` · `MEDUSA_REFUND` 이고 `medusaNotes` 가 비어 있지 않고 전부 `partial-cancel:`/`channel-cancel:` 로 시작 → `ITEM_CANCEL`
    - 2단계(`reasonCode` + `reasonMessage` 를 이어 본다): 품절|부족|단종|누락 그리고 취소 → `ITEM_CANCEL` · 차액|보상|배송비 → `PRICE_ADJUSTMENT` · 반품 → `RETURN` · 중복 결제|중복 주문 → `PAYMENT_ERROR`. **둘 이상 걸리면 3단계**
    - 나머지 3단계
- 스크립트: `deployments/lcnine/services` 에서 `npx sst shell --stage live -- npx tsx ../../../scripts/ops/1016-40-backfill-refund-kind.ts [--apply] [--from <csv>]`. DB 연결은 `1016-close-obsolete-modification-quarantines.ts` 와 같은 `Resource.Db` 방식, DB `wallet` 과 `medusa`. 대상은 `kind is null` 행만.
  - Medusa 노트: `medusa` DB 의 `payment.data->'walletRefundIds'` 에 그 wallet 환불 id 가 든 결제의 `refund.note` 목록
  - 조회만(기본): 단계별 건수 출력 + 2단계 후보를 CSV(`id,amount,created_at,reason_code,reason_message,candidate`)로 스크래치에 저장
  - `--apply`: 1단계만 적용. `--apply --from <csv>`: CSV 에 남은 행의 `candidate` 를 적용(사람이 고치거나 지운 결과). 두 경우 모두 `where id = … and kind is null`
- [ ] **Step 1: 실패하는 테스트** — 라이브 사유 원문으로(스펙 §1·라이브 표):
  - `'엘라 맵핑실 본체1개+리필1개 품절 단종 부분 취소'` → step 2 `ITEM_CANCEL`
  - `'인텐즈 디본더 크림 리무버 1개 부족 -> 투명 해면볼 2개 변경 후 차액 부분 환불'` → step 3(둘 걸림)
  - `'화이트 캐릭터 땅콩 브러쉬 1개 누락'` → step 3(누락만, 취소 없음)
  - `'반품건'` → step 2 `RETURN`, `'중복 결제'` → step 2 `PAYMENT_ERROR`
  - `reasonCode 'WRONG_ORDER'`, purpose `PURCHASE` → step 1 `ITEM_CANCEL`; `reasonCode 'NOT_USING'`, purpose `SUBSCRIPTION` → step 1 `SUBSCRIPTION_FEE`
  - `MEDUSA_REFUND` + notes `['partial-cancel:r1']` → step 1 `ITEM_CANCEL`; notes `['wallet:x']` 또는 null → step 3
  - `reasonCode null, reasonMessage null` → step 3
- [ ] **Step 2: 실패 확인** — `npx jest scripts/ops/1016-40-refund-kind-rules` FAIL
- [ ] **Step 3: 구현** — 판정은 `rules.ts`, DB·CSV 는 스크립트에만
- [ ] **Step 4: 통과 확인** — PASS, `npm run type-check` 0
- [ ] **Step 5: 커밋** — `chore(ops): 옛 환불 행 종류 채우기 스크립트 (#1016 40번)`
- [ ] **Step 6: 실행(사람, PR 1 배포 뒤)** — 조회만 → 단계별 건수·CSV 검토 → `--apply` → `--apply --from <검토한 csv>` → 건수를 #1016 체크박스에. 해결 칸에 PR 1~3 머지 해시.
