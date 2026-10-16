# 아몬드템플릿 → 와우프레스 자동 발주 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 결제 완료된 아몬드템플릿 라인을 core 가 와우프레스 OPEN API 로 자동 발주하고, 송장·취소·운영자 처리까지 닫는다.

**Architecture:** channel-adapter 가 라인 `metadata.almond_design_id` 를 core 로 실어 오고, core 신규 모듈 `print-order` 가
`print_orders` 행을 만들어 크론으로 와우프레스에 보낸다. 인쇄 파일은 ugc 내부 경로에서 S3 서명 URL 로 받는다. 송장은 core 크론이
가져와 core 고객 배송조회 응답에 붙이고, 취소는 core 취소 경로 앞단에서 와우프레스 취소를 먼저 시도한다.

**Tech Stack:** NestJS, Drizzle(postgres), `@app/cron-once`, zod 이벤트 계약, Next.js(admin-web·storefront), jest.

**Spec:** `docs/superpowers/specs/2026-10-14-almond-template-wowpress-order-design.md`

## Global Constraints

- **와우프레스 실 API 를 부르는 테스트를 만들지 않는다.** 테스트 서버가 없어 호출 = 실주문이다. `WowpressClient` 는 항상 가짜 `fetch` 로 테스트한다.
- 테스트 메모 문구는 정확히 `테스트 시안입니다. 혹시 이 시안대로 출력이 되나요?`
- `ordkey` = `sales_order_lines.id`, `ordtitle` = `아몬드영 <판매주문 channelOrderId>`, `dlvymcd` = `"4"`(선불택배).
- jest 는 항상 `--maxWorkers=2`(상한 4). 전체 스위트는 마지막 태스크에서만.
- 루트 CLAUDE.md 레이어 규칙: Controller → Service(2~3줄) → Manager/Reader → Repository. Service 는 `@app/shared` 도메인 예외만 던진다.
- 크론은 `@CronOnce(expr, { name, timeZone: 'Asia/Seoul' })`. core 루트 모듈은 이미 `CronOnceModule` 을 import 한다(확인만).
- 스키마 변경은 `npm run db:generate:core -- --name <kebab>` 로 만들고, `schema.ts` + `drizzle/*.sql` + `drizzle/meta/` 를 한 커밋에 넣는다. 손으로 SQL 을 쓰지 않는다.
- 새 통합 스펙은 `describeIfDb` 가드. 스펙 안에서 `dotenv.config()` 금지.
- 사용자 지시 전까지 커밋·푸시하지 않는다 — 각 태스크의 Commit 단계는 **사용자 승인 후** 실행한다.
- 강조용 겹화살괄호 금지, 설명성 주석 최소(로직 흐름 한 줄 주석만).
- 고객 문구(스펙 §6.6)는 그대로 쓴다.

## Review Focus

1. **도로명 주소만 있는 배송지**: core `shippingAddress` 는 `roadAddress`·`detailAddress`·`postalCode` 뿐인데 와우프레스는 `sd`·`sgg`·`umd` 를 요구한다. `세종특별자치시 한누리대로 2130`(sgg 없음), `경기도 성남시 분당구 …`(sgg 두 단어)도 깨지지 않아야 한다 → Task 5 `splitKoreanAddress` 테스트.
2. **Kafka 재전달로 같은 `OrderCreated` 가 두 번 처리**: `print_orders` 가 두 행 생기거나 와우프레스에 두 번 나가면 안 된다 → Task 2 재처리 테스트, Task 6 선점 테스트.
3. **와우프레스가 HTTP 200 + `resultCode: "400"` 으로 실패를 돌려줌**: 성공으로 읽으면 `ordnum` 없이 `submitted` 가 된다 → Task 5 클라이언트 테스트.
4. **장바구니에 아몬드 라인과 일반 상품이 섞인 주문의 고객 취소**: 인쇄 라인 취소가 거절되면 주문 전체 취소가 멈춰야 하고, 일반 상품만 남은 주문의 동작은 바뀌지 않아야 한다 → Task 8 테스트.
5. **매핑이 없는 variant 가 결제됨**(품목을 아직 안 연 상태): 재시도로 돌지 않고 `unsupported` 로 멈춰 보드에 보여야 한다 → Task 6 테스트.

---

### Task 1: 이벤트 계약 + channel-adapter 가 `almondDesignId` 를 실어 나른다

**Files:**
- Modify: `packages/event-contracts/streams/orders.stream.ts:14-36` (`OrderItem` 타입과 zod 스키마)
- Modify: `apps/channel-adapter/src/services/order-collection/channel-order-source.interface.ts:31-55` (`ChannelOrderLineSnapshot`)
- Modify: `apps/channel-adapter/src/services/order-collection/medusa-order.source.ts:115-135` (`buildLine`)
- Modify: `apps/channel-adapter/src/services/order-collection/channel-order.translator.ts:146-167` (`buildOrderItem`)
- Modify: `apps/channel-adapter/src/adapters/medusa/medusa.client.ts:195-213` (`ORDER_FIELDS` 에 `'items.metadata'` 명시)
- Test: `apps/channel-adapter/src/services/order-collection/medusa-order-collection.spec.ts`, `channel-order.translator.spec.ts`

**Interfaces:**
- Produces: `OrderItem.almondDesignId?: string` (uuid), `ChannelOrderLineSnapshot.almondDesignId?: string`.

- [ ] **Step 1: 실패 테스트** — `medusa-order-collection.spec.ts` 에 `it('carries line metadata.almond_design_id into the OrderCreated line')`: 라인 `metadata: { almond_design_id: '0b7c1d2e-…uuid' }` → 발행 payload `items[0].almondDesignId === 그 uuid`. 같은 파일에 `it('drops a non-uuid almond_design_id')`: `'abc'` → `almondDesignId` 키 없음.
- [ ] **Step 2: 실패 확인** — `npx jest apps/channel-adapter/src/services/order-collection --maxWorkers=2` → 두 테스트 FAIL.
- [ ] **Step 3: 구현** — 계약 zod 에 `almondDesignId: z.string().uuid().optional()`. `buildLine` 이 `item.metadata?.almond_design_id` 가 uuid 정규식(`/^[0-9a-f-]{36}$/`, storefront `product-actions/index.tsx:315` 과 같은 규칙)일 때만 담는다. translator 는 있으면 전달. `ORDER_FIELDS` 에 `'items.metadata'` 추가.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS. `npm run type-check` 0.
- [ ] **Step 5: Commit** — `feat(channel-adapter): 주문 라인에 아몬드템플릿 시안 id 를 싣는다`

### Task 2: core 스키마 + `OrderCreated` 가 시안 id 를 저장하고 `print_orders` 를 만든다

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts:1356` (`salesOrderLines` 에 `almondDesignId: uuid('almond_design_id')`)
- Create: `apps/core/src/modules/print-order/schema/print-order.schema.ts` (`print_orders` 테이블, `printOrderSchema`, `PrintOrderRow`, `PrintOrderStatus`)
- Modify: `apps/core/drizzle.config.ts` (schema 배열에 새 파일), `apps/core/src/platform/database/merged-schema.ts:37` (spread)
- Modify: `apps/core/src/modules/sales-order/dto/create-sales-order.dto.ts:20` (`almondDesignId?: string`, `@IsOptional() @IsUUID()`)
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts` — `convertOrderItems`(:2969) 전달, `create()` 의 라인 insert(:296-318) 직후 같은 `trx` 에서 `print_orders` insert
- Generate: `apps/core/drizzle/<ts>_add-print-orders.sql` + meta
- Test: `apps/core/src/modules/print-order/print-order.creation.integration.spec.ts` (`describeIfDb`)

**Interfaces:**
- Produces:
  - `PrintOrderStatus = 'pending' | 'submitting' | 'submitted' | 'shipped' | 'delivered' | 'failed' | 'unsupported' | 'cancelled' | 'cancel_refused'`
  - `printOrders` 컬럼(스펙 §6.3 표 그대로): `id uuid pk default uuidv7`, `salesOrderId`, `salesOrderLineId`(unique), `almondDesignId`, `vendor varchar(16) default 'wowpress'`, `status varchar(16) default 'pending'`, `testMemo boolean default false`, `vendorOrderNumber varchar(64)`, `attemptCount int default 0`, `lastError text`, `nextAttemptAt timestamptz default now()`, `submittingAt timestamptz`, `carrier varchar(16)`, `trackingNumber varchar(64)`, `shippedAt`, `deliveredAt`, `testConfirmedAt`, `testConfirmedBy uuid`, `testNote text`, `cancelRefusedAt`, `createdAt`, `updatedAt`. 인덱스 `(status, next_attempt_at)`.
  - 생성 규칙: `almondDesignId` 가 있는 라인마다 `status='pending'` 1행, `onConflictDoNothing({ target: salesOrderLineId })`.

- [ ] **Step 1: 실패 테스트** — `it('creates one pending print_order per almond line in the same tx')`: `createFromEvent` 에 아몬드 라인 1 + 일반 라인 1 → `print_orders` 1행, `sales_order_lines.almond_design_id` 저장. `it('does not duplicate on redelivered OrderCreated')`: 같은 payload 로 컨슈머 핸들러 두 번 → 1행.
- [ ] **Step 2: 실패 확인** — `REQUIRE_CORE_DB=1 dotenv -e apps/core/.env -- npx jest print-order.creation --maxWorkers=2 --runInBand` → FAIL.
- [ ] **Step 3: 스키마·DTO·insert 구현 후 `npm run db:generate:core -- --name add-print-orders`**. 생성된 SQL 이 `ADD COLUMN almond_design_id uuid` + `CREATE TABLE print_orders` 뿐인지 검토.
- [ ] **Step 4: 로컬 적용 후 통과 확인** — `npm run db:migrate -- --stage dev --deployment lcnine-services --yes` 대신 로컬은 `db:setup`(인터랙티브, 사용자에게 실행 요청) → 같은 jest → PASS. `npm run type-check` 0.
- [ ] **Step 5: Commit** — schema + sql + meta 한 커밋. `feat(core): 판매주문 라인 시안 id 와 print_orders 테이블`

### Task 3: 외주 라인을 창고 출고·수요에서 뺀다 (`outsourced` 판정)

**Files:**
- Modify: `apps/core/src/modules/product-matching/line-composition/line-composition.ts` — `LineForComposition.almondDesignId: string | null`, `LineCompositionResolution` 에 `{ kind: 'outsourced' }`, `export function isOutsourcedLine(line: { almondDesignId?: string | null }): boolean`, `resolveLineComposition` 에서 digital 다음에 판정
- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.ts:466` 제외 목록에 `'outsourced'`
- Modify: `apps/core/src/modules/inventory/replenishment/demand/demand-series.writer.ts:100` 에 `AND sol.almond_design_id IS NULL`
- Modify: `isDigitalFulfillmentLine` 을 쓰는 나머지 자리 — `git grep -n "isDigitalFulfillmentLine\|fulfillmentKind === 'digital'" apps/core/src | grep -v spec` 결과 중 출고·피킹·재고예약 판정인 곳에 `|| isOutsourcedLine(line)` (sales-orders.service.ts 1662·1736 포함)
- Test: `line-composition.spec.ts`, `fulfillments.service` 의 FO 생성 스펙(기존 파일에 케이스 추가)

**Interfaces:**
- Produces: `isOutsourcedLine(line)`, resolution kind `'outsourced'`.

- [ ] **Step 1: 실패 테스트** — `it('resolves an almond line as outsourced even without matching')` → `{ kind: 'outsourced' }`. FO 스펙: `it('creates no fulfillment order item for an outsourced line')`. 수요: `it('excludes outsourced lines from demand series')`(기존 demand 스펙 파일에 추가).
- [ ] **Step 2: 실패 확인** — `npx jest line-composition demand-series fulfillments --maxWorkers=2` → FAIL.
- [ ] **Step 3: 구현** — 위 Files 대로. `lineResolvedSql()` 은 digital 을 표현하지 않는 것과 같은 이유로 바꾸지 않는다(호출부가 판정 결과로 거른다). 화면에서 아몬드 라인이 `missing`(미매칭)으로 집계되는 쿼리가 있으면 같은 grep 결과에서 함께 제외.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `type-check` 0.
- [ ] **Step 5: Commit** — `feat(core): 아몬드템플릿 라인을 외주 직배송으로 판정해 창고 출고에서 뺀다`

### Task 4: ugc 내부 경로 — 시안 정보와 인쇄 파일 링크

**Files:**
- Create: `apps/ugc-service/src/almond-template/controllers/internal-almond-designs.controller.ts` (`@Controller('internal/almond-designs')`, `@UgcInternalAuth()`)
- Create: `apps/ugc-service/src/almond-template/clients/service-token.ts` — `mintServiceToken(secret: string): string` (HS256, `scopes: ['master']`, 1분, core `modules/library/clients/file-service.client.ts` 와 같은 규칙)
- Modify: `almond-template.module.ts` (컨트롤러 등록)
- Test: `internal-almond-designs.controller.spec.ts`

**Interfaces:**
- Produces (HTTP, 헤더 `Authorization: Bearer ${UGC_INTERNAL_KEY}`):
  - `GET /internal/almond-designs/:id` → `{ id, productId, widthMm, heightMm, hasBack: boolean }`
  - `GET /internal/almond-designs/:id/print-link?format=jpg|pdf|eps&dpi=<int>` → `AlmondPrintLink { url, expiresAt, fileName }`
- Consumes: `AlmondDesignsService.printLink(id, format, dpi, accessToken)` — accessToken 자리에 `mintServiceToken(AUTH_SECRET)`.

- [ ] **Step 1: 실패 테스트** — 키 없으면 401, 키 있으면 `printLink` 가 `format`/`dpi` 와 서비스 토큰으로 호출됨, 없는 id 는 404.
- [ ] **Step 2: 실패 확인** — `npx jest internal-almond-designs --maxWorkers=2` → FAIL.
- [ ] **Step 3: 구현** — 형식·dpi 검증은 `admin-almond-designs.controller.ts:78-93` 과 같은 범위 상수 재사용. `AUTH_SECRET` 이 ugc env 에 있는지 `deployments/lcnine/services/infra/services.ts` 의 `ugcEnv` 에서 확인하고 없으면 추가.
- [ ] **Step 4: 통과 확인** — PASS, `type-check` 0.
- [ ] **Step 5: Commit** — `feat(ugc): core 용 아몬드 시안 내부 경로(정보·인쇄 파일 링크)`

### Task 5: core `WowpressClient`·주소 분해·품목 매핑표·설정

**Files:**
- Create: `apps/core/src/modules/print-order/wowpress/wowpress.client.ts`
- Create: `apps/core/src/modules/print-order/wowpress/wowpress.types.ts`
- Create: `apps/core/src/modules/print-order/wowpress/korean-address.ts`
- Create: `apps/core/src/modules/print-order/wowpress/wowpress-products.ts` + `wowpress-products.spec.ts`(가드)
- Create: `apps/core/src/modules/print-order/clients/ugc-almond-design.client.ts`
- Modify: `apps/core/src/config/env.validation.ts` — `WOWPRESS_AUTH_UID`, `WOWPRESS_AUTH_PW`, `WOWPRESS_SENDER_NAME`, `WOWPRESS_SENDER_TEL`, `WOWPRESS_SENDER_ZIPCODE`, `WOWPRESS_SENDER_ADDR1`, `WOWPRESS_SENDER_ADDR2`, `UGC_SERVICE_URL`, `UGC_INTERNAL_KEY`, `PRINT_ORDER_SUBMIT_ENABLED` 모두 `.optional()`
- Test: `wowpress.client.spec.ts`, `korean-address.spec.ts`, `ugc-almond-design.client.spec.ts`

**Interfaces:**
- Produces:
  - `class WowpressClient` (생성자에서 `ConfigService`, 주입 가능한 `fetchImpl = fetch`)
    - `quote(spec: WowpressLineSpec, qty: number): Promise<void>` — `POST api.wowpress.co.kr/api/v1/ord/cjson_jobcost`
    - `order(input: WowpressOrderInput): Promise<{ ordnum: string }>` — `POST /api/v1/ord/cjson_order` `{ action:'ord', ordreq:[[line]], dlvymcd:'4', dlvyfr, dlvyto }`
    - `uploadFileUrl(ordnum: string, filename: string, fileurl: string): Promise<void>` — `POST file.wowpress.co.kr/api/v1/file/uploadurl` form-data
    - `cancel(ordnum: string): Promise<void>` — `POST /api/v1/ord/ord_cancel { ordnum }`
    - `findByOrdkey(ordkey: string, since: Date): Promise<{ ordnum: string } | null>` — `POST /api/v1/ord/ord_list { stdt, eddt, ordkey }`
    - `detail(ordnum: string): Promise<WowpressOrderDetail>` — `GET /api/v1/ord/order/{ordnum}`
    - 토큰: 첫 호출 시 `GET /api/login/issue { authUid, authPw }` → 메모리 보관, 응답 401 이면 1회 재발급 후 재시도.
    - 실패 판정: HTTP 비 2xx **또는** `resultCode !== '200'` → `WowpressApiError(errMsg)`.
  - `WowpressOrderDetail { ordstat: number; jobstat: number | null; dlvyno: number | null; dlvyinvc: string | null }`
  - `WOWPRESS_CANCELLABLE = (d) => d.ordstat === 0 || d.ordstat === 1 || d.jobstat === 109` (문서 6.10: 입금대기·접수대기·에러처리)
  - `WOWPRESS_CARRIER: Record<number, 'LOTTE' | 'CJ'> = { 109: 'LOTTE', 156: 'CJ' }`
  - `splitKoreanAddress(roadAddress: string): { sd: string; sgg: string; umd: string }`
  - `WowpressLineSpec { prodno: number; jobpresetno: string; prsjob: Record<string, unknown>[]; awkjob: Record<string, unknown>[]; qtyPerUnit: number; file: { format: 'jpg' | 'pdf' | 'eps'; dpi: number }; confirmed: boolean }`
  - `WOWPRESS_PRODUCTS: Readonly<Record<string /* PIM variantId */, WowpressLineSpec>>` — **처음엔 빈 객체.** 품목은 출시 절차로 한 줄씩 추가.
  - `class UgcAlmondDesignClient { design(id): Promise<{ productId; widthMm; heightMm; hasBack }>; printLink(id, format, dpi): Promise<{ url; fileName }> }`

- [ ] **Step 1: 실패 테스트 (`wowpress.client.spec.ts`, 가짜 fetch)**
  - `it('issues a token once and sends Bearer on order')`
  - `it('builds cjson_order with ordbody, ordkey, dlvymcd "4", dlvyfr from env and dlvyto')` — 본문 스냅샷 대신 키별 `expect`.
  - `it('treats HTTP 200 with resultCode "400" as WowpressApiError carrying errMsg')`
  - `it('reissues the token once on 401 then retries')`
  - `it('posts uploadurl as form-data with ordnum, filename, fileurl')`
- [ ] **Step 2: 실패 테스트 (`korean-address.spec.ts`)**
  - `서울특별시 강남구 테헤란로 152` → `{ sd:'서울', sgg:'강남구', umd:'테헤란로' }`
  - `경기도 성남시 분당구 판교역로 235` → `{ sd:'경기', sgg:'성남시 분당구', umd:'판교역로' }`
  - `세종특별자치시 한누리대로 2130` → `{ sd:'세종', sgg:'세종시', umd:'한누리대로' }`
  - `대구 달서구 월배로5길 76` → `{ sd:'대구', sgg:'달서구', umd:'월배로5길' }` (문서 샘플 형식: sd 는 약칭)
- [ ] **Step 3: 가드 스펙 (`wowpress-products.spec.ts`)** — 모든 엔트리: `prodno > 0`, `qtyPerUnit >= 1`, `file.dpi` 가 ugc 허용 범위, 키가 uuid.
- [ ] **Step 4: 실패 확인** — `npx jest apps/core/src/modules/print-order/wowpress --maxWorkers=2` → FAIL.
- [ ] **Step 5: 구현** — 시·도 약칭 표(`서울특별시→서울`, `경기도→경기` …, 17개)는 `korean-address.ts` 상수. `umd` 는 도로명 주소에 읍·면·동이 없어 도로명을 넣는다(`ponytail:` 주석: 첫 실주문에서 와우프레스가 거절하면 우편번호→법정동 조회로 교체).
- [ ] **Step 6: 통과 확인** — PASS, `type-check` 0.
- [ ] **Step 7: Commit** — `feat(core): 와우프레스 OPEN API 클라이언트·주소 분해·품목 매핑표 골격`

### Task 6: 발주 워커 (`pending` → `submitted`)

**Files:**
- Create: `apps/core/src/modules/print-order/services/print-order.repository.ts`
- Create: `apps/core/src/modules/print-order/services/print-order-submit.manager.ts`
- Create: `apps/core/src/modules/print-order/workers/print-order-submit.worker.ts`
- Create: `apps/core/src/modules/print-order/print-order.module.ts`; Modify: `apps/core/src/app.module.ts:51-63`
- Test: `print-order-submit.manager.spec.ts` (repository·client·ugc 가짜)

**Interfaces:**
- Consumes: Task 2 `printOrders`, Task 5 클라이언트·`WOWPRESS_PRODUCTS`·`splitKoreanAddress`.
- Produces:
  - `PrintOrderRepository.claimDue(limit: number, now: Date): Promise<PrintOrderRow[]>` — `UPDATE … SET status='submitting', submitting_at=now WHERE id IN (SELECT id … WHERE status='pending' AND next_attempt_at<=now ORDER BY created_at LIMIT n FOR UPDATE SKIP LOCKED) RETURNING *`
  - `PrintOrderRepository.staleSubmitting(olderThan: Date): Promise<PrintOrderRow[]>`
  - `PrintOrderRepository.update(id, patch: Partial<PrintOrderRow>, tx?)`
  - `PrintOrderSubmitManager.submit(row: PrintOrderRow): Promise<void>`, `recoverStale(row): Promise<void>`
  - 상수 `PRINT_ORDER_MAX_ATTEMPTS = 3`, `PRINT_ORDER_STALE_MS = 10 * 60_000`, 지연 `2 ** attemptCount` 분.
- Worker: `@CronOnce(CronExpression.EVERY_MINUTE, { name: 'print-order-submit', timeZone: 'Asia/Seoul' })` — `PRINT_ORDER_SUBMIT_ENABLED !== 'true'` 이면 즉시 return. 순서: `staleSubmitting` 복구 → `claimDue(10)` → 행마다 `submit` (한 행 실패가 다음 행을 막지 않음).

`submit` 흐름: 라인·판매주문 로드 → `WOWPRESS_PRODUCTS[line.variantId]` 없으면 `unsupported`(재시도 안 함) → `vendorOrderNumber` 가 이미 있으면 파일 전달만 → 아니면 `ugc.design` · `ugc.printLink(spec.file)` → `quote` → `order({ ordkey: line.id, ordtitle, ordbody: spec.confirmed ? '' : TEST_MEMO, ordqty: spec.qtyPerUnit * line.quantity, … })` → `vendorOrderNumber` 즉시 저장 → `uploadFileUrl` → `submitted`, `testMemo = !spec.confirmed`. 예외 시 `attemptCount+1`, `lastError`, `attemptCount >= 3` 이면 `failed` 아니면 `pending` + `nextAttemptAt`.

`recoverStale`: `vendorOrderNumber` 있으면 `pending` 으로(다음 주기에 파일 전달만). 없으면 `findByOrdkey(line.id, row.createdAt)` → 있으면 번호 채워 `pending`, 없으면 그냥 `pending`.

- [ ] **Step 1: 실패 테스트**
  - `it('submits a confirmed spec without memo and marks submitted')`
  - `it('adds the test memo when spec.confirmed is false and sets testMemo')` — `ordbody === '테스트 시안입니다. 혹시 이 시안대로 출력이 되나요?'`
  - `it('marks unsupported without calling wowpress when no spec for the variant')`
  - `it('keeps ordnum and retries only the file upload when upload fails')` — 두 번째 submit 에서 `order` 미호출
  - `it('fails after 3 attempts')`
  - `it('recovers a stale submitting row via ordkey instead of ordering again')`
  - `it('worker does nothing when PRINT_ORDER_SUBMIT_ENABLED is not "true"')`
- [ ] **Step 2: 실패 확인** — `npx jest print-order-submit --maxWorkers=2` → FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces 대로. `claimDue` 의 선점 SQL 은 통합 스펙 1개(`describeIfDb`)로 두 번 동시 호출 시 같은 행을 못 집는지 확인.
- [ ] **Step 4: 통과 확인** — PASS, `type-check` 0, `npx jest libs/cron-once --maxWorkers=2`(이름 중복·모듈 누락 가드) PASS.
- [ ] **Step 5: Commit** — `feat(core): 와우프레스 자동 발주 워커`

### Task 7: 송장 폴러 + 고객 배송조회 반영

**Files:**
- Create: `apps/core/src/modules/print-order/services/print-order-tracking.manager.ts`
- Create: `apps/core/src/modules/print-order/workers/print-order-tracking.worker.ts`
- Create: `apps/core/src/modules/print-order/services/print-order.reader.ts`
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts` — 배송조회 응답 조립(:1250-1400 부근 `shipments`)과 `hasShippedEvidenceFrom` 입력
- Test: `print-order-tracking.manager.spec.ts`, 기존 store 배송조회 스펙에 케이스 추가

**Interfaces:**
- Produces:
  - `PrintOrderReader.forSalesOrder(salesOrderId: string, tx?): Promise<PrintOrderRow[]>`
  - `PrintOrderTrackingManager.refresh(row): Promise<void>`
  - Worker `@CronOnce('*/30 * * * *', { name: 'print-order-tracking', timeZone: 'Asia/Seoul' })` — `status IN ('submitted','shipped')` 행.
  - 배송조회 항목: `{ fulfillmentOrderId: row.id, carrier: row.carrier ?? '', carrierName, trackingNumber: row.trackingNumber, trackingUrl: buildTrackingUrl(...) | null, status: row.status === 'delivered' ? 'delivered' : 'shipping', shippedAt, deliveredAt, eta: null, trackingEvents: [] }` — `trackingNumber` 있는 행만.

- [ ] **Step 1: 실패 테스트**
  - `it('marks shipped with LOTTE when dlvyinvc appears and dlvyno is 109')`
  - `it('keeps tracking number with null carrier for unknown dlvyno')`
  - `it('marks delivered when ordstat is 85')`
  - `it('overwrites back to shipped when wowpress reverts the state')`
  - store: `it('includes print_order shipments in tracking response and counts them as shipped evidence')`
- [ ] **Step 2: 실패 확인** → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** → PASS, `type-check` 0.
- [ ] **Step 5: Commit** — `feat(core): 와우프레스 송장을 고객 배송조회에 붙인다`

### Task 8: 취소 연동

**Files:**
- Create: `apps/core/src/modules/print-order/services/print-order-cancellation.manager.ts`
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts` — `processCancelRequest`(:765, 게이트 뒤·`cancelRequests.request` 앞), `adminCancelRequest`(:139), 액션 조회의 `cancelUnavailableReason`(:725 분기 옆)
- Modify: `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts` `OrderCancelled` 핸들러(:205)
- Modify: `web/almondyoung-storefront/src/lib/api/orders/store-orders.ts:65` — 이유 값은 기존 `already_processing` 재사용(새 값 없음)
- Test: `print-order-cancellation.manager.spec.ts`, store 취소 스펙에 케이스 추가

**Interfaces:**
- Produces:
  - `PrintOrderCancellationManager.cancelForOrder(salesOrderId: string, mode: 'gate' | 'record'): Promise<void>` — 스펙 §6.3 상태표. `gate` 는 거절 시 `ConflictError('PRINT_IN_PRODUCTION: 주문하신 인쇄물이 이미 제작에 들어가 취소할 수 없습니다. 인쇄 상태에 문제가 있으면 상품을 받으신 뒤 교환·환불을 신청해 주세요.')` 를 던지고, `record` 는 던지지 않고 `cancel_refused` 만 남긴다.
  - 거절 판정: `cancel(ordnum)` 이 `WowpressApiError` 면 `detail(ordnum)` 을 보고 `!WOWPRESS_CANCELLABLE(detail)` 일 때만 거절. 네트워크 오류는 거절이 아니라 예외 그대로(고객에게 "잠시 후 다시").
  - `submitting` 행은 `ConflictError('잠시 후 다시 시도해 주세요.')`.
- 고객 취소·운영자 취소 = `gate`, `OrderCancelled` 소비 = `record`.
- 액션 조회: 주문에 `cancel_refused` 행이 있으면 `cancelUnavailableReason='already_processing'`.

- [ ] **Step 1: 실패 테스트** — 상태표 각 행 1개씩 + 
  - `it('blocks the whole customer cancel when one print line is refused, and leaves non-print orders unchanged')`
  - `it('passes through when wowpress cancel succeeds and marks cancelled')`
  - `it('treats a network error as retryable, not as refused')`
  - `it('records cancel_refused without throwing on OrderCancelled')`
- [ ] **Step 2: 실패 확인** → FAIL.
- [ ] **Step 3: 구현.** storefront `order-actions.tsx:158-181` 은 이미 `result.error` 를 토스트로 보여주므로, 서버 메시지가 그대로 노출되는지만 확인하고 알림창이 필요하면 `toast.error` 를 같은 문구의 확인 다이얼로그로 바꾼다(기존 다이얼로그 컴포넌트 재사용).
- [ ] **Step 4: 통과 확인** → PASS, `type-check` 0.
- [ ] **Step 5: Commit** — `feat(core): 고객·운영자 취소 전에 와우프레스 취소를 먼저 시도한다`

### Task 9: core 어드민 API

**Files:**
- Create: `apps/core/src/modules/print-order/controllers/admin-print-orders.controller.ts`
- Create: `apps/core/src/modules/print-order/services/print-orders.service.ts`
- Create: `apps/core/src/modules/print-order/dto/*.ts` (중첩 DTO 는 별도 클래스)
- Test: `admin-print-orders.controller.spec.ts`, `print-orders.service.spec.ts`

**Interfaces:**
- Produces (전역 `AdminRealmGuard`, `@User()` 로 actor):
  - `GET /admin/print-orders/summary` → `{ cancelRefused: number; testPending: number; failed: number; unsupported: number; total: number }`
  - `GET /admin/print-orders?tab=cancel_refused|test_pending|failed|unsupported|all&q=&page=` → `{ items: PrintOrderListItem[]; total }`. `PrintOrderListItem` = 행 + `channelOrderId`, `customerName`, `customerPhone`, `productName`, `almondDesignId`
  - `GET /admin/print-orders/by-line/:lineId` → 행 또는 404
  - `POST /admin/print-orders/:id/retry` — `failed`·`unsupported` 만, 그 외 `BadRequestError`
  - `POST /admin/print-orders/:id/confirm-test { note: string }`
  - `POST /admin/print-orders/:id/resolve-cancel { outcome: 'cancelled' | 'proceed' }` — `cancel_refused` 만. `cancelled` → 상태 변경 후 `StoreSalesOrdersService.adminCancelRequest(salesOrderId, actor, …)`; `proceed` → `submitted`.
  - `testPending` = `test_memo AND test_confirmed_at IS NULL AND status NOT IN ('cancelled')`.

- [ ] **Step 1: 실패 테스트** — 탭별 필터, summary 가 처리 후 줄어듦, retry 상태 제한, resolve-cancel 두 결과.
- [ ] **Step 2: 실패 확인** → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** → PASS, `type-check` 0.
- [ ] **Step 5: Commit** — `feat(core): 와우프레스 발주 어드민 API`

### Task 10: admin-web `와우프레스 발주` 페이지·배지·시안 카드

**Files:**
- Create: `apps/admin-web/src/lib/api/domains/orders/print-orders.client.ts` (`${ALMONDYOUNG_API_BASE_URL}/admin/print-orders`)
- Create: `apps/admin-web/src/lib/services/orders/print-orders.queries.ts` (`usePrintOrderSummary`, `usePrintOrders(tab, q)`, 뮤테이션 3개)
- Create: `apps/admin-web/src/app/(admin)/order/print-orders/page.tsx`, `apps/admin-web/src/features/order/print-orders/template/index.tsx`
- Create: `apps/admin-web/src/components/layout/print-order-menu-badge.tsx`
- Modify: `apps/admin-web/src/lib/utils/menu.ts:5,154-158` (`MenuItem.hasPrintOrderBadge?`, 정체 보드 아래 `{ id:'print-orders', title:'와우프레스 발주', path:'/order/print-orders', hasPrintOrderBadge:true }`)
- Modify: `components/layout/sidebar-menu-item.tsx:133,156`, `mobile-nav.tsx:83`
- Modify: `features/orders/almond-design/almond-design-print-card.tsx` (상태·와우프레스 번호·송장·페이지 링크, `lineId` prop 추가 — 호출부 `orders-tab.tsx:326`, `cs/order-lookup/index.tsx` 에서 라인 id 전달)
- Test: `npm run test:admin-web` 범위의 컴포넌트 테스트 1개(`print-order-menu-badge` — 0이면 안 보임, `cancelRefused>0` 이면 빨강)

**Interfaces:** Task 9 의 HTTP 계약 그대로.

화면은 스펙 §6.5 표·목업을 따른다. 상단 카드 4개 + 전체, 탭 = 카드 클릭. 행의 와우프레스 번호 옆 복사 버튼. 하단 안내: `와우프레스 파일상담 1670-7645 · 평일 09–18시`. `생산 진행으로 처리`·`취소 완료함` 은 확인 다이얼로그 후 실행.

- [ ] **Step 1: 실패 테스트** — 배지 테스트.
- [ ] **Step 2: 실패 확인** → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** — `npm run test:admin-web -- print-order`, `npm run build:admin-web` 성공.
- [ ] **Step 5: Commit** — `feat(admin-web): 와우프레스 발주 페이지와 사이드바 배지`

### Task 11: storefront 주문제작 안내·동의 체크박스

**Files:**
- Create: `web/almondyoung-storefront/src/domains/almond-template/components/custom-order-notice.tsx` (`CustomOrderNotice({ withAgreement?: boolean; agreed?: boolean; onAgreeChange?(v: boolean) })`)
- Modify: `domains/products/product-details/components/product-actions/index.tsx` — `hasAlmondTemplate` 일 때 주문 버튼 위에 `<CustomOrderNotice />`
- Modify: `domains/checkout/templates/checkout-template.tsx:476-485` — 장바구니에 `metadata.almond_design_id` 라인이 있으면 `<CustomOrderNotice withAgreement …/>` 를 주문 요약 아래에 두고 `MobileCTA`/`PCFixedCTA` 에 `disabled={needsAgreement && !agreed}`
- Modify: `handlePayment`(:197) — 결제 직전 cart metadata `custom_order_notice_agreed_at` 를 기존 cart 갱신 액션으로 저장
- Modify: `i18n/messages/{ko,en,ja}/checkout.json`, `productDetail.json` — 키 `customOrderNotice.title|body1|body2|body3|agree`
- Test: `custom-order-notice.test.tsx`(체크 전 결제 버튼 비활성), `locale-parity.test.ts` 통과

ko 문구(스펙 §6.6 그대로): title `주문제작 상품 안내` / body1 `고객님이 만드신 시안 그대로 인쇄되는 주문제작 상품입니다.` / body2 `결제 후 바로 제작 접수되며, 제작이 시작된 뒤에는 단순 변심에 의한 취소·환불이 어렵습니다.` / body3 `문구 오타, 사진, 크기를 결제 전에 한 번 더 확인해 주세요.` / agree `위 내용을 확인했습니다`.

- [ ] **Step 1: 실패 테스트** — `it('disables payment until the custom order notice is agreed')`.
- [ ] **Step 2: 실패 확인** — `(cd web/almondyoung-storefront && npx vitest run custom-order-notice)` 또는 해당 앱의 테스트 러너 → FAIL.
- [ ] **Step 3: 구현** — 강조는 짙은 회색·굵기(주황 텍스트 금지).
- [ ] **Step 4: 통과 확인** — 테스트 PASS, `locale-parity` PASS, storefront `npm run build` 성공.
- [ ] **Step 5: Commit** — `feat(storefront): 아몬드템플릿 주문제작 안내와 결제 전 동의`

### Task 12: 배포 설정·문서·전체 검증

**Files:**
- Modify: `deployments/lcnine/services/infra/services.ts` — `new sst.Secret('WowpressAuthUid')`, `new sst.Secret('WowpressAuthPw')` 를 36-89 줄 secret 묶음에 추가, Core `environment`(:522-567)에 `WOWPRESS_AUTH_UID/PW`, `WOWPRESS_SENDER_*`, `UGC_SERVICE_URL: url('ugc')`, `UGC_INTERNAL_KEY: ugcInternalKey.value`, `PRINT_ORDER_SUBMIT_ENABLED: 'false'`. `infra/demo-services.ts:26` 의 secret 재선언도 맞춘다.
- Modify: `apps/core/.env.example`(있으면) — 키 이름만
- Modify: `web/almondyoung-storefront/src/domains/almond-template/README.md` 한계 절 → 와우프레스 자동 발주와 품목 여는 절차(스펙 §10) 링크
- Create: `apps/core/src/modules/print-order/README.md` — 품목 여는 절차: 와우프레스 제품상세로 옵션 코드 확인 → `WOWPRESS_PRODUCTS` 한 줄(`confirmed:false`) → 배포 → 선입금 0 상태 실주문 → 전화 확인 → `confirmed:true`

- [ ] **Step 1: 검증** — `npm run type-check` 0, `npx jest --maxWorkers=4` 실패 0, `npm run test:admin-web`, storefront 테스트.
- [ ] **Step 2: Commit** — `chore: 와우프레스 발주 배포 설정과 품목 여는 절차`
- [ ] **Step 3: 사용자에게 넘길 일 정리** — SST secret 값 입력(`sst secret set WowpressAuthUid …` 은 사용자가 직접), 배포 순서(스펙 §10: core migrate → ugc → core → channel-adapter → admin-web·storefront), 첫 품목 매핑 작성.
