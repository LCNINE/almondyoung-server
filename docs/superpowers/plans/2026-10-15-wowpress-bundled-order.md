# 와우프레스 묶음 발주 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 같은 판매주문의 아몬드템플릿 인쇄 줄을 와우프레스 `cjson_order` 한 번으로 묶어 발주하고, 줄마다 배송박스·청구 택배비를 남기며, 주문상세 송장 파싱을 바로잡는다.

**Architecture:** `print_orders` 는 줄당 1행 그대로. 워커가 판매주문 단위로 대기 줄을 함께 선점하고, 매니저가 새 줄만 모아 `ordreq` 원소 N개로 한 번 주문한 뒤 줄↔`ordnum` 을 `ord_list(ordkey)` 로 확정한다. 이어가기 줄(번호 확인·파일 재전달)은 기존 `submit(row)` 경로를 그대로 탄다.

**Tech Stack:** NestJS, Drizzle(postgres.js), Jest(ts-jest), zod. admin-web(Next.js) 문구 한 줄.

**Spec:** `docs/superpowers/specs/2026-10-15-wowpress-bundled-order-design.md` (와우프레스 API 사실은 `docs/superpowers/specs/2026-10-14-almond-template-wowpress-order-design.md` §3)

## Global Constraints

- **git commit / push / stash / checkout / reset / add 금지.** 변경은 작업 트리에 둔다. 태스크가 끝나면 보고하고 사용자가 검토·커밋한다.
- **jest 는 `--maxWorkers=2`, 4 초과 금지, 동시에 두 개 이상 금지, 경로 지정 실행만.** jest 설정 파일 수정 금지.
- **와우프레스 실 API 호출 금지**(테스트 서버 없음 → 호출 = 실주문). 테스트는 가짜 transport/가짜 클라이언트만.
- 로컬 DB 마이그레이션 적용 금지(`db:setup`/`db:migrate` 실행 금지). `db:generate:core` 생성만.
- 레이어: Controller → Service(2~3줄) → Manager/Reader → Repository. `any`/`as` 금지(불가피하면 근거 주석). Nullable 정규화.
- 주석: 설명성 주석 금지, 로직 흐름용 한 줄 주석만. 겹화살괄호 금지. 기존 주석 삭제·복원 금지(로직이 바뀐 줄의 주석만 맞춰 고친다).
- 새 통합 스펙은 기존 `describeIfDb` 류 가드를 따른다. 스펙 안 `dotenv.config()` 금지.
- 검증: `npm run type-check` 에러 0. 다른 터미널의 낯선 diff 는 무시.
- 사용자 대상 문구는 이 계획에 적힌 그대로.

## Review Focus

1. 묶음 요청은 성공했는데 `ord_list` 가 일부 줄을 못 찾음(와우프레스 반영 지연) → 그 줄만 번호 없음 상태로 남고 다음 차례 `confirmSentOrder` 가 이어받아야 한다. 재주문되면 안 된다 → Task 3 테스트.
2. 같은 판매주문의 줄 하나가 다른 인스턴스에 잠겨 있음 → 나머지 줄만 이번 묶음으로, 잠긴 줄은 나중에 혼자 → Task 2 통합 테스트.
3. 응답 `ordinfo` 원소 수가 요청 원소 수와 다름 → 주문은 나갔을 수 있으므로 예외로 실패시키고 전 줄 "보냈는데 번호 없음" 처리(재주문 금지) → Task 1·3 테스트.
4. 주문상세에 `dlvybox` 가 없거나 `shipnum` 이 null(출고 전) → 송장 없음으로 보고 상태 유지 → Task 1 테스트.
5. 같은 송장을 가진 인쇄 줄 3개 → 고객 배송조회에 1건, 송장 없는 줄은 여전히 줄 단위로 "미발송" 계산 → Task 4 테스트.

---

### Task 1: 와우프레스 클라이언트 — 묶음 주문, 박스 정보, 송장 파싱

**Files:**
- Modify: `apps/core/src/modules/print-order/wowpress/wowpress.types.ts`
- Modify: `apps/core/src/modules/print-order/wowpress/wowpress.client.ts` (`order` :136-181, `findByOrdkey` :194-237, `detail` :239-257)
- Test: `apps/core/src/modules/print-order/wowpress/wowpress.client.spec.ts`

**Interfaces:**
- Produces (types):
  ```ts
  export interface WowpressOrderItem { spec: WowpressLineSpec; qty: number; ordbody: string; ordkey: string }
  export interface WowpressOrderInput { items: WowpressOrderItem[]; ordtitle: string; receiver: WowpressReceiver }
  export interface WowpressPlacedOrder { ordnum: string; dboxno: number | null; prodno: number | null }
  export interface WowpressBox { dboxno: number; dboxnum: string | null; shippingFee: number | null }
  export interface WowpressOrderResult { orders: WowpressPlacedOrder[]; boxes: WowpressBox[] }
  export interface WowpressOrderDetail { ordstat: number; jobstat: number | null; carrierCode: number | null; trackingNumber: string | null; boxNumber: string | null }
  ```
- Produces (client): `order(input: WowpressOrderInput): Promise<WowpressOrderResult>`, `findByOrdkey(ordkey: string, since: Date): Promise<{ ordnum: string; dboxnum: string | null } | null>`, `detail(ordnum: string): Promise<WowpressOrderDetail>`.
- `WOWPRESS_CANCELLABLE`, `WOWPRESS_CARRIER` 는 그대로(ordstat/jobstat 만 읽음).

- [ ] **Step 1: 실패 테스트** (`wowpress.client.spec.ts`, 기존 가짜 transport 헬퍼 재사용, 기존 단일 주문 테스트는 새 입력 모양으로 고친다)
  - `it('sends one ordreq element per item with its own ordkey and ordbody')` — items 2개 → `json.ordreq` 길이 2, `ordreq[0][0].ordkey === 'line-a'`, `ordreq[1][0].ordbody === '<TEST 메모>'`, `ordreq[i][0].ordqty === String(qtyPerUnit*qty)`, `dlvymcd === '4'`, 감사 로그 ordkey 는 `'line-a,line-b'`.
  - `it('parses ordinfo and dlvinfo into orders and boxes')` — `resultMap.cjson_order` 또는 `resultMap` 바로 아래 어느 쪽의 `ordinfo:[{ordnum:'WP1',dboxno:4343784,prodno:40008},{ordnum:'WP2',dboxno:4343784,prodno:40073}]`, `dlvinfo:[{dboxno:4343784,dboxnum:'4-1-4343784',dlvcost_bill:0}]` → `orders` 2개, `boxes[0]` `{dboxno:4343784,dboxnum:'4-1-4343784',shippingFee:0}`.
  - `it('throws when ordinfo count differs from items')` — items 2, ordinfo 1 → `WowpressApiError`.
  - `it('throws when an ordinfo entry has no ordnum')`.
  - `it('returns dboxnum from ord_list row')` — 행 `{ordkey:'line-a',ordnum:'WP1',dboxnum:'4-156-9410333'}` → `{ordnum:'WP1',dboxnum:'4-156-9410333'}`; dboxnum 없는 행 → `dboxnum: null`.
  - `it('reads tracking from ordinfo.dlvybox')` — `resultMap.ordinfo = {ordstat:80, jobstat:null, dlvybox:{dboxnum:'4-156-9410333', dlvyname:'CJ대한통운', shipnum:'123456789012'}}` → `{ordstat:80, carrierCode:156, trackingNumber:'123456789012', boxNumber:'4-156-9410333'}`.
  - `it('falls back to dlvyname when dboxnum has no carrier code')` — `dboxnum:null, dlvyname:'롯데택배'` → `carrierCode:109`; 알 수 없는 이름 → `null`.
  - `it('treats missing dlvybox or null shipnum as no tracking')` → `trackingNumber:null`.
  - `it('accepts ordinfo as an array in detail')` — `ordinfo:[{...}]` 도 첫 원소로 읽는다.
- [ ] **Step 2:** `npx jest apps/core/src/modules/print-order/wowpress/wowpress.client.spec.ts --maxWorkers=2` → 새 테스트 FAIL.
- [ ] **Step 3: 구현**
  - `order`: `ordreq = items.map(i => [line(i)])`. 응답 위치는 `resultMap.cjson_order ?? resultMap` 에서 `ordinfo`/`dlvinfo` 배열을 읽는다(zod 또는 기존 `asRecord`/`recordArray` 헬퍼). 감사 로그 `ordkey` 는 `items.map(i=>i.ordkey).join(',')`.
  - 택배비 숫자는 기존 `toNumber` 헬퍼, `dboxno` 가 숫자로 안 읽히는 박스는 버린다.
  - `detail`: `ordinfo` 가 객체면 그대로, 배열이면 첫 원소. `ordstat` 없으면 기존처럼 예외. `carrierCode` = `dboxnum.split('-')[1]` 이 `WOWPRESS_CARRIER` 키면 그 숫자, 아니면 `dlvyname` 에 `'롯데'` → 109, `'CJ'` → 156, 그 밖 null.
- [ ] **Step 4:** 같은 명령으로 PASS. `npm run type-check` 는 Task 3 전까지 호출부(`submit.manager`, `tracking.manager`)에서 깨지는 것이 정상 — 이 태스크 범위 파일의 에러만 없게 한다.
- [ ] **Step 5:** 보고(변경 파일·테스트 결과). 커밋하지 않는다.

### Task 2: 스키마·마이그레이션·리포지토리 — 박스 컬럼, 판매주문 인덱스, 묶음 선점

**Files:**
- Modify: `apps/core/src/modules/print-order/schema/print-order.schema.ts`
- Create: `apps/core/drizzle/<timestamp>_add-print-order-vendor-box.sql` + `apps/core/drizzle/meta/*` (생성)
- Modify: `apps/core/src/modules/print-order/services/print-order.repository.ts`
- Test: `apps/core/src/modules/print-order/services/print-order.repository.integration.spec.ts`

**Interfaces:**
- Produces (schema): `vendorBoxNumber: varchar('vendor_box_number', { length: 32 })`, `vendorShippingFee: integer('vendor_shipping_fee')` (둘 다 nullable), 인덱스 `index('ix_print_orders_sales_order').on(salesOrderId)`.
- Produces (repository):
  - `claimDueBatch(now: Date, tx?: DbTx): Promise<PrintOrderRow[]>` — 비면 `[]`, 아니면 모두 같은 `salesOrderId`, 같은 `submittingAt = now`, `status = 'submitting'`.
  - `saveVendorBox(id: string, patch: { vendorBoxNumber: string | null; vendorShippingFee: number | null }, tx?: DbTx): Promise<void>` — null 이 아닌 값만 쓴다(기존 값을 null 로 덮지 않음).

- [ ] **Step 1: 실패 테스트** (기존 DB 가드·픽스처 헬퍼 재사용)
  - `it('claimDueBatch claims all due pending rows of the oldest due sales order only')` — 판매주문 A(줄 2, due), B(줄 1, due, 더 늦게 생성) → 반환 2행 모두 A, `submittingAt` 동일, B 는 `pending` 그대로.
  - `it('claimDueBatch skips rows locked by another transaction')` — A 의 줄 1개를 다른 트랜잭션에서 `FOR UPDATE` 로 잡은 채 호출 → 잠기지 않은 A 줄만 반환.
  - `it('claimDueBatch ignores rows whose next_attempt_at is in the future')`.
  - `it('saveVendorBox does not overwrite with null')`.
- [ ] **Step 2:** `REQUIRE_CORE_DB=1` 등 기존 가드 방식대로 `npx jest apps/core/src/modules/print-order/services/print-order.repository.integration.spec.ts --maxWorkers=2 --runInBand`. DB 가 없으면 skip 되는 것을 확인하고, 가드 env 이름은 파일 상단 기존 가드를 따른다.
- [ ] **Step 3: 구현**
  - 스키마 컬럼·인덱스 추가 후 `npm run db:generate:core -- --name add-print-order-vendor-box`. 생성 SQL 이 `ADD COLUMN` 2개 + `CREATE INDEX` 1개뿐인지 확인(그 밖의 DROP 이 섞이면 멈추고 보고).
  - `claimDueBatch`: 한 트랜잭션에서 (1) 기존 `claimDue` 와 같은 조건으로 가장 오래된 행 1개를 `FOR UPDATE SKIP LOCKED` 로 고르고 (2) 그 `sales_order_id` 의 due `pending` 행을 `FOR UPDATE SKIP LOCKED` 로 고른 뒤 (3) 그 id 들을 `status='submitting', submittingAt=now` 로 UPDATE … RETURNING. 기존 `claimDue` 의 "안쪽 SELECT 재실행" 주석 이유대로 SELECT 와 UPDATE 를 분리한다. `claimDue` 는 다른 호출부가 없으면 제거한다(있으면 둔다).
- [ ] **Step 4:** 통합 스펙 PASS(DB 있을 때) 또는 skip 확인 + `npx jest apps/core/src/modules/print-order/services/print-order.repository.spec.ts --maxWorkers=2` PASS.
- [ ] **Step 5:** 보고. 커밋하지 않는다.

### Task 3: 묶음 제출 — 매니저 `submitBatch`, 워커

**Files:**
- Modify: `apps/core/src/modules/print-order/services/print-order-submit.manager.ts`
- Modify: `apps/core/src/modules/print-order/workers/print-order-submit.worker.ts`
- Test: `apps/core/src/modules/print-order/services/print-order-submit.manager.spec.ts` (+ 워커 스펙이 있으면 그 파일)

**Interfaces:**
- Consumes: Task 1 `order/findByOrdkey/WowpressOrderResult`, Task 2 `claimDueBatch/saveVendorBox`.
- Produces: `PrintOrderSubmitManager.submitBatch(rows: PrintOrderRow[]): Promise<void>`. 기존 `submit(row)`·`recoverStale(row)` 는 유지(이어가기·stale 경로).

- [ ] **Step 1: 실패 테스트** (기존 가짜 repository/wowpress/ugc 헬퍼 재사용)
  - `it('orders three new lines in one cjson_order and maps ordnums via ord_list')` — `order` 1회(items 3, ordkey 각 줄 id), `findByOrdkey` 3회, 줄마다 `recordReceivedOrdnum` 결과 저장·`saveVendorBox`(응답 `ordinfo.dboxno`→`dlvinfo` 로 찾은 `dboxnum`/`shippingFee`)·`uploadFileUrl(ordnum, …)`·`status:'submitted'`.
  - `it('uses the response ordnum directly when only one line is ordered')` — `findByOrdkey` 호출 0회.
  - `it('drops unsupported and owner-mismatch lines and orders the rest')` — 줄 3: 매핑 없음 → `unsupported`, 주인 불일치 → `failed`(`DESIGN_OWNER_MISMATCH_ERROR`), 나머지 1개만 `order` items 길이 1.
  - `it('drops a line whose print link fails and retries it later')` — 그 줄은 기존 `fail()` 결과(`pending`, `attemptCount+1`), `order` 에 안 들어감.
  - `it('leaves a line for confirmSentOrder when ord_list cannot find it')` — `findByOrdkey` 가 한 줄만 `null` → 그 줄은 `deferLookup` 결과(번호 없음, `orderAttemptedAt` 유지), 다른 줄은 submitted. `order` 재호출 없음.
  - `it('defers every line when order throws after taking order rights')` — 전 줄 deferLookup, 이미 `orderAttemptedAt` 있는 행이면 `markUnconfirmed`.
  - `it('routes rows already sent to the existing submit path')` — `orderAttemptedAt !== null` 인 줄은 `order` items 에 없고 `confirmSentOrder`/파일 전달만.
  - `it('skips a line whose order right is lost')` — `takeOrderRight` false 인 줄은 items 에서 빠지고 나머지는 진행.
  - `it('throws-to-defer when ordinfo count differs')` — Task 1 의 예외가 나면 전 줄 deferLookup(Review Focus 3).
  - `it('falls back to ord_list dboxnum when the response has no box for the ordnum')`.
- [ ] **Step 2:** `npx jest apps/core/src/modules/print-order/services/print-order-submit.manager.spec.ts --maxWorkers=2` → FAIL.
- [ ] **Step 3: 구현**
  - `submitBatch(rows)`: 스펙 §4.2 순서 1~7. 이어가기 줄은 `for … await this.submit(row)`. 새 줄 준비 단계는 기존 `submit` 안의 컨텍스트·매핑·주인 대조·링크·`quote` 를 줄 단위 private 함수 `prepare(row)` 로 꺼내 `submit` 과 공유한다(동작 동일). 줄 하나의 예외는 그 줄의 기존 처리(`fail`/`LostOwnership`/`AlreadyRecorded`)로 끝내고 다른 줄을 막지 않는다.
  - 주문권: 줄마다 `takeOrderRight(row.id, claimedAt, { testMemo: !spec.confirmed })`. 기존 `placeOrder` 의 `state.orderSent` 의미를 줄마다 유지한다.
  - 주문: `ordtitle` = `아몬드영 ${channelOrderId}`, 배송지·`receiver` 조립은 기존 `placeOrder` 코드 그대로 판매주문 공통 1회. `ordbody` = `spec.confirmed ? '' : TEST_MEMO`.
  - 대응: items 1개면 `result.orders[0].ordnum`, 아니면 줄마다 `findByOrdkey(row.salesOrderLineId, row.createdAt)`. 확정되면 `recordReceivedOrdnum(row, ordnum, items.length === 1 ? 'order' : 'submit lookup')`.
  - 박스: `orders` 에서 그 ordnum 의 `dboxno` → `boxes` 매칭, 없으면 `findByOrdkey` 의 `dboxnum`, 택배비는 응답 박스에서만.
  - 워커: 루프를 `claimDueBatch(new Date())` → `submitBatch(rows)` 로. "한 행씩 집는다" 주석은 판매주문 단위로 고쳐 쓴다(묶음이어도 한 판매주문만 집으므로 stale 이유는 그대로 유효).
- [ ] **Step 4:** 매니저 스펙 PASS, `npx jest apps/core/src/modules/print-order --maxWorkers=2` PASS(통합 스펙은 skip), `npm run type-check` 에러 0 (Task 4 의 tracking 호출부는 이 태스크에서 같이 타입만 맞춰도 됨 — 동작 변경은 Task 4).
- [ ] **Step 5:** 보고. 커밋하지 않는다.

### Task 4: 송장 반영과 배송조회 묶기

**Files:**
- Modify: `apps/core/src/modules/print-order/services/print-order-tracking.manager.ts`
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts` (`buildPrintShipments` :1712-)
- Test: `apps/core/src/modules/print-order/services/print-order-tracking.manager.spec.ts`, `apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 `WowpressOrderDetail { ordstat, jobstat, carrierCode, trackingNumber, boxNumber }`, Task 2 `saveVendorBox`.

- [ ] **Step 1: 실패 테스트**
  - tracking: `it('marks shipped with CJ from dlvybox')` — `trackingNumber:'1234', carrierCode:156` → `updateTracked` `{status:'shipped', carrier:'CJ', trackingNumber:'1234'}`; `it('keeps tracking number with null carrier for unknown carrier code')`; `it('fills vendor box number when missing')` — `row.vendorBoxNumber === null`, `boxNumber:'4-156-1'` → `saveVendorBox(row.id, {vendorBoxNumber:'4-156-1', vendorShippingFee:null})`; 기존 `delivered`(ordstat 85)·송장 없음 touch 테스트는 새 필드로 고친다.
  - store: `it('merges print rows sharing a tracking number into one shipment')` — 행 3개 같은 송장 → 배송 1건, `fulfillmentOrderIds` 에 3개 id, `fulfillmentOrderId` 는 첫 행 id; 다른 송장 1개 더 → 2건. `untrackedPrints` 계산(송장 없는 줄 수)은 바뀌지 않음을 기존 테스트로 확인.
- [ ] **Step 2:** 두 스펙 경로로 jest(`--maxWorkers=2`, 한 번에 하나) → FAIL.
- [ ] **Step 3: 구현** — tracking 은 `detail.trackingNumber`/`WOWPRESS_CARRIER[detail.carrierCode ?? -1]` 로 바꾸고 `boxNumber` 는 `row.vendorBoxNumber` 가 없을 때만 저장. `buildPrintShipments` 는 `trackingNumber` 로 묶는다. 상태는 묶음의 모든 행이 `delivered` 면 `delivered`, 아니면 `shipping`. `shippedAt` 은 가장 이른 값, `deliveredAt` 은 전부 delivered 일 때 가장 늦은 값, 아니면 null.
- [ ] **Step 4:** 두 스펙 PASS, `npm run type-check` 에러 0.
- [ ] **Step 5:** 보고. 커밋하지 않는다.

### Task 5: 운영 문구와 문서

**Files:**
- Modify: `apps/core/src/modules/print-order/README.md`
- Modify: `apps/admin-web/src/features/order/print-orders/template/index.tsx` (:485-486 확인 문구)

- [ ] **Step 1:** README 에 반영: 묶음 발주(판매주문 단위 선점, 새 줄만 한 요청, `ordkey`=줄 id, 원소 2개 이상이면 `ord_list` 로 대응), 나중에 재시도된 줄은 혼자 발주, `vendor_box_number`/`vendor_shipping_fee` 의미와 합산 시 `DISTINCT vendor_box_number`, 묶음 일부 취소 시 와우프레스 택배비 미납금 가능성, 배송비 그룹 4개(`print-card`·`print-mini` flat 3,000, `print-sign` per_quantity 3,000, `print-board` per_quantity 4,700) 운영 절차 한 줄과 사인제품 선불택배 미확인 주의(스펙 §7 링크), 디플로마는 와우프레스 발주 범위 밖. 기존 "`ordkey`(= `sales_order_line_id`)" 문장은 유지.
- [ ] **Step 2:** admin 확인 문구 중 와우프레스 취소 확인(:486) 끝에 한 문장 추가: `같은 주문의 다른 인쇄물과 함께 발주된 경우, 와우프레스가 남은 인쇄물에 택배비를 다시 청구할 수 있습니다.`
- [ ] **Step 3:** `npm run test:admin-web -- print-order --maxWorkers=2` 가 있으면 PASS 확인(문구 스냅샷이 없으면 생략), `npm run type-check` 에러 0.
- [ ] **Step 4:** 보고. 커밋하지 않는다.
