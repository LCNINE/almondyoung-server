# 중국 선적 입고 — core 모델·API 구현 계획 (작업 순서 ①)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 입고리스트 줄(JSON)을 받아 선적·상자·리스트 줄 초안을 만들고, 사람이 정리·확정하고, 상자 단위로 검수해 입고 커널로 RECEIVE 하는 core 스키마와 API 를 깐다.

**Architecture:** `apps/core/src/modules/inventory/inbound-shipment/` 에 새 «문서» 모듈을 둔다. 발주(`procurement/`)와 같은 틀이다 — 문서 행을 잠그고 `InboundReceiptKernel` 을 부르며, 커널은 문서를 모른다. 판정(파서·상태 규칙·차이)은 DB 를 모르는 순수 함수로 두고 유닛 스펙으로 고정한다. DB 를 쓰는 동작은 `describeIfDb` 통합 스펙으로 고정한다.

**Tech Stack:** NestJS 11, Drizzle ORM(postgres.js), class-validator, Jest(ts-jest).

**Spec:** `docs/superpowers/specs/2026-11-16-inbound-shipment-boxes-design.md` — 계획은 이 문서를 근거로 한다. 실행자는 둘 다 읽는다. 아래 «§n» 은 그 문서의 절이다.

## Global Constraints

- 레이어: Controller → Service(2~3줄) → Reader/Manager → DB. Service 는 `@app/shared` 도메인 예외만 던지고 drizzle·HttpException 을 import 하지 않는다. Controller 는 try/catch 하지 않는다.
- Inventory 쿼리 규칙: `db.query.*`·`with` 관계 금지, `any`/`as` 캐스팅 금지(근거 주석 없이), `trx.select().from().innerJoin().where()` 꼴. DB 주입은 `@InjectTypedDb<typeof wmsSchema>()`.
- 트랜잭션: 공개 메서드는 마지막 인자 `tx?: DbTx`, 안은 `this.dbService.run(async (trx) => …, tx)`. private 헬퍼는 `tx: DbTx` 필수. 커널 메서드의 `tx` 는 필수다.
- 잠금 순서: 선적 행 → 상자 행 → (커널: 회차 라인·원장). 커널은 문서 행을 잠그지 않는다.
- `@ApiProperty({ type: 'object' })` 금지 — 중첩 DTO 는 클래스로.
- 날짜: `expected_arrival` 은 `date('expected_arrival', { mode: 'string' })`. 앱 경계에 Date 객체를 두지 않는다.
- 이름: 테이블 `inbound_shipments`·`inbound_shipment_boxes`·`inbound_shipment_lines`·`inbound_shipment_line_boxes`·`inbound_shipment_box_counts`, 코드 식별자 `InboundShipment…`. `shipments`(출고 상자)·`consignment`(3PL 위탁)를 쓰지 않는다.
- 커널 source 값: `inbound_shipment`. 커널 method: `planned`. 원장 reason: `inbound_shipment`.
- 권한 키: 문서 쪽 `inventory.inbound_shipment.write`(새 키, `requires: ['inventory.stock.read']`, 첫 부여 `admin`), 현장 쪽 `inventory.stock.operate`, 읽기 `inventory.stock.read`.
- 행 상한 2,000(빈 줄 제외). 범위 상자 상한 50.
- 🔒 공개 레포: 입고리스트 원본·실제 업체명·사람 이름을 커밋하지 않는다. 픽스처는 합성(«○○님께 연락바람», «acme 에 발송바람»). `.scratch/` 의 샘플은 읽기만 한다.
- 새 라우트는 창고 작업 계약 v2 만 받는다: `contractVersion` 은 `2` 고정, `idempotencyKey` 필수(`WarehouseOperationDto` 상속 + `@Equals(2)`).
- 검증: `npm run type-check` 에러 0, `npx jest --maxWorkers=2` 실패 0. 🔴 로컬 E2E 스택이 떠 있으면 전체 jest·type-check 를 돌리지 않는다(메모리 부족 재부팅 전력).
- 통합 스펙 실행: `npm run test:core:integration:local -- inbound-shipment`. 로컬 `core` DB 의 마이그가 깨져 있으면(drizzle migrate 가 말없이 exit 1) 새 스크래치 DB 를 만들어 `LOCAL_PG` 로 돌린다.

## Review Focus

1. **같은 SKU 가 한 상자에 줄 둘로 나온 경우** — 커널 입력이 SKU 가 겹친 두 줄이 되어도 원장·회차 라인이 줄마다 하나씩 생기고, 집계 행이 각자 자기 회차 라인을 가리켜야 한다. → Task 6 테스트 `same SKU on two lines in one box gets two receipt lines`.
2. **범위 줄의 마지막 상자만 남았을 때 차이 판정** — 다섯 상자 중 넷만 확정됐으면 «진행 중»이고, 다섯째를 확정 취소하면 다시 «진행 중»으로 돌아가야 한다. → Task 7 테스트 `range line difference is pending until every covered box is received`.
3. **같은 키로 재시도 vs 다른 키로 두 번 확정** — 같은 키는 같은 응답을 다시 주고 원장이 한 번만 쓰여야 하며, 다른 키는 409 여야 한다. → Task 6 테스트 `retry with same key replays; a second key is 409`.
4. **`="…"` 로 저장된 옛 바코드 행** — 리스트의 `11211211211` 이 DB 의 `="11211211211"` 와도 맞아야 하고, 정상 쌍둥이 행이 같은 SKU 면 모호로 보지 않아야 한다. → Task 4 테스트 `formula-escaped barcode row matches the same SKU without ambiguity`.
5. **선적 확정 뒤 줄 고치기** — 확정된 상자를 덮는 줄을 PATCH 하면 409, 아직 아무 상자도 확정 안 된 줄은 된다. → Task 5 테스트 `line edit after confirm is allowed only before any covered box is received`.

---

## 파일 구조

새 모듈 `apps/core/src/modules/inventory/inbound-shipment/`:

| 파일 | 책임 |
|---|---|
| `inbound-shipment.module.ts` | Nest 모듈. `CoreInventoryModule`·`SharedModule`·`InboundModule`·`ProductSellableQuantityModule` import |
| `controllers/inbound-shipment.controller.ts` | `inventory/inbound-shipments` 라우트 |
| `controllers/inbound-shipment-box.controller.ts` | `inventory/inbound-shipment-boxes` 상자 찾기 라우트 |
| `dto/upload.dto.ts` · `dto/draft-edit.dto.ts` · `dto/receive.dto.ts` · `dto/inbound-shipment-view.dto.ts` | 요청·응답 DTO |
| `services/inbound-shipment-list.parser.ts` | 순수: 머리글+행 → 상자·줄·이슈 (§6.3) |
| `services/inbound-shipment.rules.ts` | 순수: 확정 조건(§6.2), 상태 파생, 줄 차이(§8.5) |
| `services/inbound-shipment-sku-matcher.reader.ts` | 정규화 바코드 → SKU (§6.3 매칭) |
| `services/inbound-shipment.reader.ts` | 목록·상세·상자 찾기·상자 열기 |
| `services/inbound-shipment-draft.manager.ts` | 초안 만들기·고치기·AI 후보·확정·취소·이름/예정일·종결·다시 열기 |
| `services/inbound-shipment-receiving.manager.ts` | 상자 확정·확정 취소·리스트에 없던 상자 |
| `services/inbound-shipment.service.ts` | Port |

수정: `schema/inventory.schema.ts`, `inbound/kernel/inbound-receipt.kernel.ts`, `inbound/dto/{inbound-response,putaway-pending,inbound-receipt-state}.dto.ts`, `inbound-kernel-boundary.arch.spec.ts`, `inventory.module.ts`, `libs/authorization/src/permissions/permission-catalog.ts`, `CONTEXT.md`.

---

### Task 1: 스키마와 마이그

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (enum 은 `inboundReceiptSourceEnum` 근처, 테이블은 `inboundReceiptLines` 뒤)
- Create: `apps/core/drizzle/<timestamp>_add-inbound-shipments.sql` + `drizzle/meta/` (생성)
- Test: `apps/core/src/modules/inventory/schema/inbound-shipment-schema.integration.spec.ts`

**Interfaces:**
- Produces: enum `inboundShipmentStatusEnum`(`draft`,`expected`,`receiving`,`closed`,`canceled`), `inboundShipmentBoxDispositionEnum`(`stock`,`forward`), `inboundShipmentBoxStatusEnum`(`open`,`received`), `inboundShipmentBoxOriginEnum`(`list`,`added`), `inboundShipmentLineKindEnum`(`sku`,`free`,`unresolved`), `inboundShipmentLineResolutionEnum`(`barcode`,`manual`); `inboundReceiptSourceEnum` 에 `'inbound_shipment'` 추가. 테이블 export `inboundShipments`·`inboundShipmentBoxes`·`inboundShipmentLines`·`inboundShipmentLineBoxes`·`inboundShipmentBoxCounts` 를 `wmsTables`/`wmsSchema` 에 등록. 타입 `InboundShipment`·`InboundShipmentBox`·`InboundShipmentLine`·`InboundShipmentBoxCount` (`InferSelectModel`).
- 컬럼·CHECK·인덱스는 §5.2 표 그대로. 추가로 `inbound_shipment_lines.issues` 는 `text('issues').array().notNull().default(sql\`'{}'::text[]\`)`, `raw`·`ai_candidates` 는 `jsonb`(`$type<…>()` 로 타입).

- [ ] **Step 1: 실패하는 통합 스펙** — `describeIfDb('inbound shipment schema')` 롤백 tx 안에서:
  - `sku line requires sku_id`: `kind='sku', sku_id=null` insert → 23514(check_violation)
  - `free line requires positive expected_qty`: `kind='free', expected_qty=0` → 23514
  - `unresolved line may omit expected_qty`: `kind='unresolved', expected_qty=null` → 성공
  - `forward box cannot be received`: `disposition='forward', status='received'` → 23514
  - `box label unique per shipment`: 같은 선적에 `L5` 두 번 → 23505; 다른 선적의 `L5` → 성공
  - `one live count per line per box`: 같은 `(box_id,line_id)` 유효 집계 두 행 → 23505; 첫 행에 `canceled_at` 찍은 뒤 → 성공
  - `unplanned count needs sku and positive qty`: `line_id=null, sku_id=null` → 23514; `line_id=null, counted_qty=0` → 23514
- [ ] **Step 2: 실패 확인** — `npm run test:core:integration:local -- inbound-shipment-schema` → 테이블 없음으로 FAIL
- [ ] **Step 3: 스키마 작성** (위 Interfaces)
- [ ] **Step 4: 마이그 생성** — `npm run db:generate:core -- --name add-inbound-shipments`. 생성 SQL 을 읽고 확인: `ALTER TYPE "inbound_receipt_source" ADD VALUE 'inbound_shipment'` 가 있고, 이 마이그의 어떤 문장도 그 새 값을 쓰지 않는다(§11). DROP 이 하나도 없다.
- [ ] **Step 5: 통과 확인** — 같은 명령 → PASS. `npm run type-check` → 에러 0(이 시점에 커널 DTO 유니언이 좁아 에러가 나면 Task 2 의 DTO 수정을 이 커밋으로 당겨 온다)
- [ ] **Step 6: 커밋** — schema.ts + 생성 SQL + `drizzle/meta/` 를 **한 커밋**으로: `git commit -m "선적 입고 스키마 — 선적·상자·리스트 줄·덮기·상자 집계 테이블과 입고 커널 source 값"`

### Task 2: 입고 커널이 선적 출처를 안다

**Files:**
- Modify: `apps/core/src/modules/inventory/inbound/kernel/inbound-receipt.kernel.ts:17-18,196`
- Modify: `apps/core/src/modules/inventory/inbound/dto/inbound-response.dto.ts:70-73`, `putaway-pending.dto.ts:5-6`, `inbound-receipt-state.dto.ts:19`
- Modify: `apps/core/src/modules/inventory/inbound-kernel-boundary.arch.spec.ts:6`
- Test: `apps/core/src/modules/inventory/inbound/kernel/inbound-receipt.kernel.integration.spec.ts` (기존 파일에 추가)

**Interfaces:**
- Produces: `InboundReceiptSource = 'direct' | 'purchase_order' | 'inbound_shipment'`; `ArrivalOrigin` 에 `| { source: 'inbound_shipment' }`(method 는 `planned`). `cancelLine` 이 source 불일치일 때 `line.source === 'inbound_shipment'` 면 `ConflictException('선적 입고는 선적에서 취소하세요')`.

- [ ] **Step 1: 실패하는 테스트** (기존 커널 통합 스펙에 추가)
  - `records an inbound_shipment arrival as planned`: `recordArrival({ source: 'inbound_shipment', reason: 'inbound_shipment', … })` → 회차 `method === 'planned'`, 라인 `source === 'inbound_shipment'`
  - `direct cancel refuses an inbound_shipment line`: 그 라인을 `cancelLine({ expected: { source: 'direct' } })` → 409, 메시지 `선적 입고는 선적에서 취소하세요`
- [ ] **Step 2: 실패 확인** — `npm run test:core:integration:local -- inbound-receipt.kernel` → 타입/값 FAIL
- [ ] **Step 3: 구현** — 위 Interfaces. 세 DTO 의 `enum`·유니언에 `'inbound_shipment'` 추가. arch 스펙 `DOCUMENT_MODULES` 를 `/(^|\/)(procurement|warehouse-transfer|inbound-shipment)(\/|$)/` 로.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `npx jest apps/core/src/modules/inventory/inbound-kernel-boundary.arch.spec.ts` PASS, `npm run type-check` 0
- [ ] **Step 5: 커밋** — `입고 커널이 선적 입고 출처를 받고, 직접 입고 취소 경로가 선적 입고를 거절한다`

### Task 3: 입고리스트 파서 (순수 함수)

**Files:**
- Create: `apps/core/src/modules/inventory/inbound-shipment/services/inbound-shipment-list.parser.ts`
- Test: `apps/core/src/modules/inventory/inbound-shipment/services/inbound-shipment-list.parser.spec.ts`

**Interfaces:**
- Produces:

```ts
export interface ListCell { text: string; value: string | number | boolean | null; formula?: string }
export interface ListRowInput { rowNumber: number; cells: ListCell[] }            // 머리글과 같은 순서
export interface ListInput { header: string[]; rows: ListRowInput[] }

export type LineIssue =
  | 'box_label_guess' | 'box_label_missing' | 'box_range_invalid'
  | 'qty_formula' | 'qty_invalid'
  | 'barcode_missing' | 'barcode_is_text' | 'foreign_code'
  | 'barcode_not_found' | 'barcode_ambiguous' | 'packing_unit_barcode'   // 뒤 셋은 Task 4 매처가 붙인다
  | 'option_date_coerced' | 'forward_hint' | 'contact_hint';

export interface ParsedBox { label: string; sortKey: number; forwardHint: string | null }
export interface ParsedLine {
  rowNumber: number;
  boxLabels: string[];           // 펼친 상자 이름, 비면 box_label_missing
  expectedQty: number | null;
  barcode: string | null;        // 정규화 결과. 매칭 대상이 아니면 null
  issues: LineIssue[];
  raw: Record<'boxLabel'|'no'|'productName'|'quantity'|'option'|'barcode'|'total'|'remark', ListCell | null>;
}
export interface ParsedList { boxes: ParsedBox[]; lines: ParsedLine[] }

export function parseShipmentList(input: ListInput): ParsedList;      // 필수 열 없음·행 상한 초과는 BadRequestError
export function normalizeBarcode(cell: ListCell | null): { barcode: string | null; issue: LineIssue | null };
export function expandBoxLabel(raw: string): { labels: string[]; issue: LineIssue | null };
```

- 머리글 별칭(빌더 몫, 최소): `박스번호`·`박스 번호`·`상자번호`, `NO`·`No`·`번호`, `제품명`·`상품명`, `수량`, `옵션`, `바코드`, `총수량`, `비고`. 필수 = 박스번호·수량·바코드. 비교는 공백 제거 후.
- 규칙은 §6.3 그대로. 바코드 꼴 = 정규화 뒤 `/^\d{8,}$/`; `숫자-숫자` = `/^\d+-\d+$/` → `foreign_code`; 한글 포함 또는 비고 원문과 같음 → `barcode_is_text`.
- 상자 `sortKey` 는 처음 나온 순서(0부터). `forwardHint` 는 그 상자를 덮는 줄 중 처음으로 «발송»이 든 비고 원문.

- [ ] **Step 1: 실패하는 스펙** — 합성 행으로 (기댓값 그대로 단언):
  - `expands a range into one box per label`: `L5-L9` → `['L5','L6','L7','L8','L9']`, `LM66-LM68` → `['LM66','LM67','LM68']`, `L5~L9` → 다섯 개
  - `guesses a dangling range`: `L86-` → `['L86']` + `box_label_guess`
  - `rejects a reversed or huge range`: `L9-L5` → `[]` + `box_range_invalid`; `L1-L60` → `[]` + `box_range_invalid`
  - `same label on non-adjacent rows is one box`: `L23`, `L24`, `L23` 행 → `boxes.length === 2`
  - `normalizes barcodes`: `'10390520010\n'` → `'10390520010'`; 숫자 `12655120005` → `'12655120005'`; `'="11211211211"'` → `'11211211211'`; `'176-23'` → null + `foreign_code`; `'장갑'` → null + `barcode_is_text`; 비고와 같은 문자열 → `barcode_is_text`; 빈 칸 → `barcode_missing`
  - `reads formula quantity`: `{ text: '208', value: 208, formula: '199+9' }` → `208` + `qty_formula`; `'abc'` → null + `qty_invalid`
  - `flags a date-coerced option`: 옵션 `value` 가 ISO 날짜 문자열이면 `option_date_coerced`, `raw.option.text` 는 원문 유지
  - `marks forward and contact hints`: 비고 `도착하면 acme 에 발송바람:` → 줄에 `forward_hint`, 그 줄의 상자 `forwardHint` 가 그 원문; `도착하면 ○○님께 연락바람` → `contact_hint`, 상자 `forwardHint === null`
  - `ignores total and NO`: 총수량 `총수량:15개`·NO 빈 칸이어도 이슈 없음, `raw.total.text === '총수량:15개'`
  - `requires box, quantity and barcode columns`: `바코드` 머리글이 없으면 `BadRequestError`
  - `caps rows at 2000`: 빈 줄 제외 2,001행 → `BadRequestError`, 빈 줄 1,000 + 데이터 2,000 → 통과
- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/inventory/inbound-shipment/services/inbound-shipment-list.parser.spec.ts` → FAIL(모듈 없음)
- [ ] **Step 3: 구현** — 위 시그니처. DB·Nest 를 import 하지 않는다(`BadRequestError` 만 `@app/shared` 에서).
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS
- [ ] **Step 5: 커밋** — `입고리스트 파서 — 범위 상자 펼치기·바코드 정규화·엑셀 함정 이슈`

### Task 4: 바코드 매처와 초안 만들기 · 읽기

**Files:**
- Create: `services/inbound-shipment-sku-matcher.reader.ts`, `services/inbound-shipment.reader.ts`, `services/inbound-shipment-draft.manager.ts`, `services/inbound-shipment.service.ts`, `controllers/inbound-shipment.controller.ts`, `dto/upload.dto.ts`, `dto/inbound-shipment-view.dto.ts`, `inbound-shipment.module.ts`
- Modify: `apps/core/src/modules/inventory/inventory.module.ts` (모듈 등록), `libs/authorization/src/permissions/permission-catalog.ts` (inventory 절, `inventory.master.write` 뒤)
- Test: `services/inbound-shipment-sku-matcher.reader.integration.spec.ts`, `services/inbound-shipment-draft.manager.integration.spec.ts`

**Interfaces:**
- Consumes: Task 3 `parseShipmentList`, `ParsedList`.
- Produces:
  - `InboundShipmentSkuMatcherReader.match(barcodes: string[], tx?: DbTx): Promise<Map<string, SkuMatch>>` — `type SkuMatch = { kind: 'one'; skuId: string } | { kind: 'none' } | { kind: 'many'; skuIds: string[] } | { kind: 'packing_unit'; skuId: string }`. `sku_barcodes.barcode IN (v, '="'||v||'"')` 와 `skus.code = v` 를 모아 **서로 다른 SKU 수**로 판정. 맞은 `sku_barcodes` 행 중 `packing_unit > 1` 이 있으면 `packing_unit`.
  - `InboundShipmentDraftManager.createDraft(input: CreateDraftInput, actorId: string, tx?: DbTx): Promise<{ shipmentId: string }>` — `CreateDraftInput = { warehouseId: string; name: string; expectedArrival: string | null; sourceFileId: string | null; sourceFileName: string; list: ListInput }`. 한 트랜잭션에 선적(`draft`)·상자(`origin='list'`, `forwardHint` 가 있으면 `disposition='forward'`·`forward_note`)·줄·덮기를 쓴다. 매칭 결과로 `kind`(`one`→`sku`+`resolution='barcode'`, 그 밖 → `unresolved` + 이슈)를 정한다. 수량이 null 이거나 상자가 없으면 `unresolved`.
  - `InboundShipmentReader.list(q: { warehouseId?: string; status?: InboundShipmentStatus[] }, tx?)`, `InboundShipmentReader.detail(id: string, tx?): Promise<InboundShipmentDetailView>` — 상자·줄(덮는 상자 이름·이슈·후보·원문)·유효 집계. 차이는 Task 8 이 채운다(그 전엔 `difference: null`).
  - 라우트: `POST /inventory/inbound-shipments`(`inventory.inbound_shipment.write`, 201, `{ shipmentId }`), `GET /inventory/inbound-shipments`·`GET /inventory/inbound-shipments/:id`(`inventory.stock.read`).
  - 권한 키 `inventory.inbound_shipment.write` — `permission('inventory.inbound_shipment.write', '선적 입고리스트 관리', '중국 선적 입고리스트를 올리고 정리·확정·종결한다', { owners: ['core'], grant: ADMIN, requires: ['inventory.stock.read'] })`.
  - `UploadInboundShipmentDto`: `warehouseId`(UUID), `name`(1~255), `expectedArrival`(`IsDateString({ strict: true })` + `YYYY-MM-DD` 정규식, 선택), `sourceFileId`(UUID, 선택), `sourceFileName`, `header: string[]`, `rows: ListRowDto[]`(`ArrayMaxSize(5000)` — 빈 줄 포함 상한, 진짜 상한은 파서), `ListRowDto { rowNumber; cells: ListCellDto[] }`. 본문 크기는 전역 body parser 상한을 확인하고 부족하면 이 라우트만 2MB 로.

- [ ] **Step 1: 실패하는 매처 통합 스펙**
  - `matches a registered barcode`: → `{ kind: 'one' }`
  - `falls back to sku code`: `sku_barcodes` 에 없고 `skus.code` 와 같음 → `one`
  - `formula-escaped barcode row matches the same SKU without ambiguity` (Review Focus 4): 같은 SKU 에 `11211211211` 과 `="11211211211"` 두 행 → `one`
  - `two SKUs are ambiguous`: 바코드는 SKU A, `skus.code` 는 SKU B → `many` `[A,B]`
  - `box barcode is packing_unit`: `packing_unit=12` 행 → `packing_unit`
- [ ] **Step 2: 실패하는 초안 통합 스펙** (`createDraft`, 합성 리스트)
  - `creates boxes, lines and coverage`: `L1` 줄 2개 + `L5-L9` 줄 1개 → 상자 6개, 줄 3개, 범위 줄의 덮기 5행, 선적 `status='draft'`
  - `unmatched barcode stays unresolved with issue`: 없는 바코드 → `kind='unresolved'`, `issues` 에 `barcode_not_found`
  - `forward hint marks the box forward`: 발송 비고 줄의 상자 → `disposition='forward'`, `forward_note` = 원문
  - `keeps raw cells`: 줄 `raw.option.text` 가 원문 그대로
  - `requires the new permission`: 라우트 메타데이터에 `inventory.inbound_shipment.write`(컨트롤러 유닛 스펙이나 `route-classification.spec.ts` 가 빨갛지 않은 것으로 확인)
- [ ] **Step 3: 실패 확인** — `npm run test:core:integration:local -- inbound-shipment` → FAIL
- [ ] **Step 4: 구현** — 위 Interfaces. Service 는 Manager/Reader 에 위임만. 모듈을 `inventory.module.ts` 에 등록.
- [ ] **Step 5: 통과 확인** — 통합 PASS, `npx jest libs/authorization apps/core/src/modules/inventory --maxWorkers=2` PASS(권한 카탈로그 가드·라우트 분류·arch), `npm run type-check` 0
- [ ] **Step 6: 커밋** — `입고리스트 줄을 받아 선적 초안을 만들고 바코드로 SKU 를 찾는다`

### Task 5: 초안 정리 · AI 후보 · 확정 · 취소 · 머리 고치기

**Files:**
- Create: `services/inbound-shipment.rules.ts`, `services/inbound-shipment.rules.spec.ts`, `dto/draft-edit.dto.ts`
- Modify: `services/inbound-shipment-draft.manager.ts`, `services/inbound-shipment.service.ts`, `controllers/inbound-shipment.controller.ts`
- Test: `services/inbound-shipment-draft.manager.integration.spec.ts` (추가)

**Interfaces:**
- Produces (순수, `inbound-shipment.rules.ts`):
  - `confirmBlockers(boxes: { id: string; disposition: 'stock'|'forward'; origin: 'list'|'added' }[], lines: { id: string; kind: LineKind; boxIds: string[] }[]): ConfirmBlocker[]` — `type ConfirmBlocker = { code: 'unresolved_line'; lineId: string } | { code: 'mixed_disposition'; lineId: string } | { code: 'empty_box'; boxId: string }` (§6.2)
  - `lineEditable(shipmentStatus, coveredBoxStatuses: ('open'|'received')[]): boolean` — `draft` 면 true, `expected`·`receiving` 이면 덮는 상자가 전부 `open` 일 때만, 그 밖 false (§6.4)
- Produces (Manager, 전부 선적 행 `FOR UPDATE` 후):
  - `editLine(shipmentId, lineId, patch: { kind: 'sku'; skuId: string } | { kind: 'free' }, extra: { expectedQty?: number; boxLabels?: string[] }, actorId, tx?)` — `resolution='manual'`, `resolved_by/at`. `boxLabels` 는 `draft` 에서만(없는 이름이면 상자를 만든다). 확정 뒤엔 `kind` 를 `unresolved` 로 되돌릴 수 없다.
  - `editBox(shipmentId, boxId, patch: { disposition?: 'stock'|'forward'; forwardNote?: string | null; label?: string }, actorId, tx?)` — 상자가 `open` 일 때만. `label` 은 `draft` 에서만.
  - `setAiCandidates(shipmentId, lineId, candidates: { skuId: string; reason: string }[], tx?)` — `draft` 이고 줄이 `unresolved` 일 때만, 최대 5개, `skuId` 존재 확인. 다른 컬럼은 안 건드린다.
  - `confirm(shipmentId, actorId, tx?)` — `confirmBlockers` 가 비어야 `expected`, 아니면 `ConflictError` 에 막힌 목록. 같은 창고의 다른 열린 선적과 겹치는 상자 이름 목록을 응답 `labelOverlaps` 로 돌려준다(막지 않는다).
  - `cancel(shipmentId, actorId, tx?)` — `draft`, 또는 `expected` 이면서 확정된 상자 0 일 때만 `canceled`.
  - `updateHeader(shipmentId, patch: { name?; expectedArrival?: string | null; memo?: string | null }, tx?)` — `canceled` 만 거절.
  - 라우트(전부 `inventory.inbound_shipment.write`): `PATCH /:id`, `PATCH /:id/lines/:lineId`, `PATCH /:id/boxes/:boxId`, `PUT /:id/lines/:lineId/ai-candidates`, `POST /:id/confirm`, `POST /:id/cancel`.

- [ ] **Step 1: 실패하는 규칙 유닛 스펙**
  - `unresolved line on a stock box blocks confirm` → `[{ code: 'unresolved_line' }]`
  - `unresolved line only on forward boxes does not block` → `[]`
  - `line covering stock and forward boxes blocks` → `mixed_disposition`
  - `list box without lines blocks, added box does not` → `empty_box` 는 `origin='list'` 만
  - `lineEditable`: `('draft', [])` true, `('expected', ['open','open'])` true, `('receiving', ['open','received'])` false, `('closed', ['open'])` false
- [ ] **Step 2: 실패하는 통합 스펙**
  - `resolving the last unresolved line lets confirm pass`: 미확인 1줄 → confirm 409 → `editLine(kind:'free')` → confirm 성공, `status='expected'`
  - `ai candidates do not resolve a line`: `setAiCandidates` 뒤 `kind` 그대로 `unresolved`, confirm 여전히 409
  - `line edit after confirm is allowed only before any covered box is received` (Review Focus 5): 확정 뒤 열린 상자만 덮는 줄 PATCH 성공. 그 상자의 `status` 를 직접 `received` 로 바꾼 뒤 PATCH → 409
  - `confirm reports label overlap with another open shipment`: 같은 창고 `expected` 선적에 `L1` → 새 선적 confirm 응답 `labelOverlaps` 에 `L1`
  - `cancel is refused once a box is received` → 409
- [ ] **Step 3: 실패 확인** — `npx jest apps/core/src/modules/inventory/inbound-shipment/services/inbound-shipment.rules.spec.ts` FAIL, 통합 FAIL
- [ ] **Step 4: 구현**
- [ ] **Step 5: 통과 확인** — 둘 다 PASS, `npm run type-check` 0
- [ ] **Step 6: 커밋** — `선적 초안을 사람이 정리하고 확정한다 — AI 는 후보만 적는다`

### Task 6: 상자 찾기 · 열기 · 확정 · 리스트에 없던 상자

**Files:**
- Create: `services/inbound-shipment-receiving.manager.ts`, `controllers/inbound-shipment-box.controller.ts`, `dto/receive.dto.ts`
- Modify: `services/inbound-shipment.reader.ts`, `services/inbound-shipment.rules.ts`, `services/inbound-shipment.service.ts`, `controllers/inbound-shipment.controller.ts`, `inbound-shipment.module.ts`
- Test: `services/inbound-shipment-receiving.manager.integration.spec.ts`

**Interfaces:**
- Consumes: Task 2 `ArrivalOrigin { source: 'inbound_shipment' }`, `InboundReceiptKernel.recordArrival`, `InventoryIdempotencyService.withIdempotency`, `warehouseEndpoint`·`warehouseRequest`, `ProductSellableQuantityService.recalculateAndPublishForSkus(skuIds, tx)`.
- Produces:
  - 순수 `deriveShipmentStatus(current: InboundShipmentStatus, boxes: { disposition; status }[], manuallyClosed: boolean): InboundShipmentStatus` — 재고 상자가 하나 이상 `received` 면 `receiving`, 재고 상자 전부 `received` 면 `closed`, `manuallyClosed` 면 `closed` 유지 (§8.4). `rules.ts` 에 둔다.
  - `InboundShipmentReader.findBoxes(warehouseId: string, label: string, tx?): Promise<BoxCandidateView[]>` — 그 창고의 `expected`·`receiving` 선적에서 정규화한 이름이 같은 상자 전부. 후보마다 `{ shipmentId, shipmentName, expectedArrival, boxId, label, disposition, status, previewItems: string[] }`(`previewItems` = 그 상자 줄의 제품명 원문 앞 3개, `row_number` 순). 정렬은 도착 예정일 오름차순, 기본 선택 없음(§8.1).
  - `InboundShipmentReader.openBox(shipmentId, boxId, tx?): Promise<BoxView>` — 줄마다 `{ lineId, kind, skuId, productName, option, expectedQty, coversBoxLabels, alreadyCountedInOtherBoxes, remark }`, 전달용이면 `forwardNote`.
  - `InboundShipmentReceivingManager.receiveBox(shipmentId, boxId, dto: ReceiveBoxDto, actorId, tx?): Promise<ReceiveBoxResult>` — `ReceiveBoxDto extends WarehouseOperationDto { counts: { lineId: string; countedQty: number }[]; unplanned: { skuId: string; quantity: number }[] }`, `ReceiveBoxResult = { boxId; receiptId: string | null; shipmentStatus; countIds: string[] }`. 순서: `withIdempotency(warehouseEndpoint('inbound_shipment.box.receive', dto), dto.idempotencyKey, warehouseRequest({ shipmentId, boxId, ...dto }, actorId), …)` 안에서 선적 `FOR UPDATE` → 상자 `FOR UPDATE` → 검증(§8.2) → 재고 입력이 있으면 `recordArrival({ source: 'inbound_shipment', actorId, warehouseId: shipment.warehouseId, locationId: null, reason: 'inbound_shipment', lines })`(이벤트 키 `${endpoint}:${key}:${index}`) → 집계 행(회차 라인 id 연결, 자유 줄·0 은 null) → 상자 `received`·`receipt_id` → `deriveShipmentStatus` → `recalculateAndPublishForSkus`.
  - `InboundShipmentReceivingManager.addBox(shipmentId, label: string, actorId, tx?)` — `expected`·`receiving` 에서만, `origin='added'`, 이미 있는 이름이면 409.
  - 라우트: `GET /inventory/inbound-shipment-boxes?warehouseId=&label=`(`inventory.stock.read`), `GET /inventory/inbound-shipments/:id/boxes/:boxId`(`inventory.stock.read`), `POST /inventory/inbound-shipments/:id/boxes/:boxId/receive`·`POST /inventory/inbound-shipments/:id/boxes`(`inventory.stock.operate`). 컨트롤러는 `warehouseOperationContext(dto, user)` 로 actor 를 얻는다. DTO `contractVersion` 은 `@Equals(2)`.

- [ ] **Step 1: 실패하는 통합 스펙** (확정된 합성 선적, 커널은 `makeInboundReceiptKernel(db)`, 판매가능수량은 jest mock)
  - `receives a box into the inbound default zone`: `L1` 의 SKU 줄 2개를 20·5 로 확정 → RECEIVE 이벤트 2, 회차 라인 `source='inbound_shipment'`, 위치 = 입고기본존, 상자 `received`, 선적 `receiving`, mock 이 두 SKU 로 한 번 불림
  - `counts must cover every line of the box exactly once`: 줄 하나 빠짐 → 400; 남의 상자 줄 포함 → 400; 같은 줄 두 번 → 400
  - `zero is recorded, not skipped`: 한 줄 0 → 집계 행 `counted_qty=0`, `receipt_line_id=null`, 원장 없음
  - `free line is counted without ledger`: 자유 줄 3 → 집계 행만, RECEIVE 없음
  - `unplanned item becomes a count without a line`: `unplanned: [{ skuId, quantity: 2 }]` → `line_id=null` 집계 + RECEIVE 1
  - `same SKU on two lines in one box gets two receipt lines` (Review Focus 1)
  - `forward box cannot be received`: → 409
  - `retry with same key replays; a second key is 409` (Review Focus 3): 같은 키 두 번 → 같은 응답, RECEIVE 이벤트 수 변화 없음; 다른 키 → 409
  - `last stock box closes the shipment`: 재고 상자 2개(나머지 하나는 전달용) 둘 다 확정 → `closed`
  - `findBoxes returns both shipments for a shared label`: 같은 창고 열린 선적 둘에 `L3` → 후보 2개, 각 `previewItems` 길이 ≤ 3; 하나가 `closed` 면 후보 1개
  - `added box receives unplanned only`: `addBox('L99')` → `counts: []`, `unplanned` 1개로 확정 성공
  - `draft shipment boxes cannot be received`: → 409
- [ ] **Step 2: 실패 확인** — `npm run test:core:integration:local -- inbound-shipment-receiving` FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — PASS, `npm run type-check` 0
- [ ] **Step 5: 커밋** — `선적 상자를 열어 센 만큼 확정하면 입고 커널로 RECEIVE 한다`

### Task 7: 확정 취소 · 종결 · 다시 열기 · 차이

**Files:**
- Modify: `services/inbound-shipment-receiving.manager.ts`, `services/inbound-shipment-draft.manager.ts`, `services/inbound-shipment.rules.ts`(+ spec), `services/inbound-shipment.reader.ts`, `services/inbound-shipment.service.ts`, `controllers/inbound-shipment.controller.ts`, `dto/receive.dto.ts`, `dto/inbound-shipment-view.dto.ts`
- Test: `services/inbound-shipment-receiving.manager.integration.spec.ts`(추가), `services/inbound-shipment.rules.spec.ts`(추가)

**Interfaces:**
- Produces:
  - 순수 `lineDifference(expectedQty: number | null, liveCounts: number[], coveredBoxStatuses: ('open'|'received')[]): LineDifference` — `type LineDifference = { state: 'pending'; counted: number; expected: number | null } | { state: 'match' | 'short' | 'over'; counted: number; expected: number }`. 덮는 상자가 전부 `received` 일 때만 판정, 그 전엔 `pending` (§8.5). `expectedQty` null(자유 줄 아님·미확인 잔재)은 늘 `pending`.
  - `InboundShipmentReceivingManager.cancelBoxReceipt(shipmentId, boxId, dto: WarehouseOperationDto, actorId, tx?)` — 선적 → 상자 잠금, 상자의 유효 집계 중 `receipt_line_id` 있는 것마다 `kernel.cancelLine({ receiptLineId, expected: { source: 'inbound_shipment' } }, trx)`. 커널 거절(당일 아님·적치 있음 등)은 그대로 올린다. 집계 `canceled_at/by`, 상자 `open`·`receipt_id=null`·`received_at=null`, 선적 상태 재계산(`closed` 였어도 `receiving`), `recalculateAndPublishForSkus`. 멱등 endpoint `inbound_shipment.box.receive.cancel`.
  - `InboundShipmentDraftManager.close(shipmentId, reason: string, actorId, tx?)` — `expected`·`receiving` → `closed`, `closed_reason`. `receiveBox` 는 `closed` 에서 409(이미 Task 6 검증).
  - `InboundShipmentDraftManager.reopen(shipmentId, actorId, tx?)` — `closed` 이고 `closed_reason` 이 있는(사람이 닫은) 선적만 → `receiving`(받은 상자 0 이면 `expected`), `closed_*` 비움.
  - `InboundShipmentReader.detail` 의 줄에 `difference: LineDifference`, 선적에 `summary: { boxesReceived; boxesTotalStock; forwardBoxes; addedBoxes; shortLines; overLines; unplannedCounts }`.
  - 라우트: `POST /:id/boxes/:boxId/receive/cancel`(`inventory.stock.operate`), `POST /:id/close`·`POST /:id/reopen`(`inventory.inbound_shipment.write`).

- [ ] **Step 1: 실패하는 규칙 스펙**
  - `range line difference is pending until every covered box is received` (Review Focus 2): `(1076, [200,200,200,200], ['received','received','received','received','open'])` → `pending`; 다섯째 `received` 와 `276` 추가 → `match`; 다섯째만 다시 `open` → `pending`
  - `short and over`: `(10, [8], ['received'])` → `short`, `(10, [12], ['received'])` → `over`
- [ ] **Step 2: 실패하는 통합 스펙**
  - `cancel restores the box and reverses the ledger`: 확정 → 취소 → 상자 `open`, 회차 라인 `canceled_qty = quantity`, 집계 `canceled_at` 찍힘, 같은 상자 다시 확정 가능
  - `cancel on a closed shipment returns it to receiving`
  - `cancel after putaway is refused by the kernel`: 적치 1개 뒤 취소 → 400(커널 메시지 그대로)
  - `manual close blocks receive; reopen allows it`: 열린 상자가 남은 채 close → receiveBox 409 → reopen → receiveBox 성공
  - `detail reports short, over and unplanned`: 한 줄 모자람·한 줄 남음·리스트에 없던 물건 1 → `summary.shortLines=1`, `overLines=1`, `unplannedCounts=1`
- [ ] **Step 3: 실패 확인** — 유닛·통합 FAIL
- [ ] **Step 4: 구현**
- [ ] **Step 5: 통과 확인** — PASS, `npm run type-check` 0
- [ ] **Step 6: 커밋** — `선적 상자 확정을 당일 취소하고, 선적을 닫고 다시 열고, 줄마다 예정·실제 차이를 낸다`

### Task 8: 용어집 · 전체 게이트

**Files:**
- Modify: `CONTEXT.md` (§«발주 · 입고예정 · 이동 지시서» 바로 뒤)
- Modify: `docs/superpowers/specs/2026-11-16-inbound-shipment-boxes-design.md` §7 의 SKU 검색 경로를 실제 `GET /inventory/skus/search/advanced` 로

- [ ] **Step 1: `CONTEXT.md`** — 새 절 «선적 (Inbound Shipment) · 상자 · 리스트 줄»: 선적·상자·리스트 줄(`sku`/`free`/`unresolved`)·자유 줄·전달용 상자·리스트에 없던 물건/상자의 정의 한 줄씩(§5.1 문구). «이동 지시서» 항목 끝에 «중국 → 부천 구간은 이동 지시서가 아니라 선적 입고로 받는다(2026-11-08 결정, 중국 창고는 우리 밖)». _Avoid_: 선적을 출고 `shipments` 와 같은 말로 쓰기, 상자 이름만으로 상자를 식별하기.
- [ ] **Step 2: 전체 게이트** (E2E 스택이 내려가 있는지 먼저 확인) — `npm run type-check` → 0 errors; `npx jest --maxWorkers=2` → 실패 0; `npm run test:core:integration:local -- inbound` → 실패 0
- [ ] **Step 3: 생성 마이그 재확인** — `git diff --stat origin/develop -- apps/core/drizzle` 에 새 SQL 이 하나뿐이고, `git log --oneline origin/develop.. -- apps/core/drizzle` 이 Task 1 커밋 하나만 보인다
- [ ] **Step 4: 커밋** — `용어집에 선적·상자·리스트 줄을 더한다`

---

## 배포 메모 (PR 본문에 옮긴다)

- expand 마이그 → **`db:migrate` 먼저, 그다음 `sst deploy`**(core).
- 화면(작업 순서 ②·③)이 없으면 새 라우트는 휴면이다.
- 배포 뒤 사람 손: 중국 쪽 직원 역할에 `inventory.inbound_shipment.write`·`inventory.stock.read` 부여. (file_context 시드는 작업 순서 ② 의 몫)
