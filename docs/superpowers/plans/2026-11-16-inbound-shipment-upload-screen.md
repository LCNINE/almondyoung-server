# 선적 입고 ② — 올리기·정리·선적 상세 화면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 중국 직원이 admin-web 에서 입고리스트를 올려 초안 선적을 만들고, 미확인 줄·전달용 상자를 정리해 확정하고, 한국 쪽이 같은 화면에서 입고 진행·차이를 보고 선적을 끝내게 한다.

**Architecture:** 브라우저가 SheetJS 로 엑셀을 «칸 원문 JSON» 으로 읽어 core 에 보내고 판정은 core 가 한다. 원본은 file-service presign 으로 따로 보관한다. core 변경은 둘(SKU 이름 검색 단어 AND, 확정 본문의 전달용 상자 확인 목록), file-service 는 컨텍스트 하나와 접근 표 한 줄. 화면 판정 로직은 전부 순수 함수(admin-web 은 컴포넌트 테스트를 못 한다)에 두고 스펙으로 고정한다.

**Tech Stack:** NestJS + Drizzle(core), Next.js App Router + TanStack Query + SheetJS `xlsx`(admin-web), Jest(ts-jest).

**Spec:** `docs/superpowers/specs/2026-11-16-inbound-shipment-upload-screen-design.md` (상위: `docs/superpowers/specs/2026-11-16-inbound-shipment-boxes-design.md`). 실행자는 둘 다 읽는다. core API 정본은 `apps/core/src/modules/inventory/inbound-shipment/` 의 컨트롤러·DTO.

## Global Constraints

- 브랜치 `feat/inbound-shipment-upload-screen`(develop 기준). 설계 문서 커밋이 이미 있다.
- **AI 는 만들지 않는다.** `apps/ai` 를 건드리지 않는다. core 의 `ai-candidates` 라우트·열은 지우지 않는다.
- 화면 용어: 한 번에 온 물량 «선적», 엑셀 «입고리스트», `forward` 상자 «전달용», `free` 줄 «자유 줄», `unplanned` «리스트에 없던 물건», `origin='added'` «리스트에 없던 상자». 현장 문구 규칙: 작은 글씨 최소화, 정상 상태는 숨김.
- 🔒 공개 레포 — `.scratch/cutover-inputs/` 의 샘플을 커밋하지 않는다. 스펙 픽스처는 합성(«○○님께 연락바람», «acme 에 발송바람»). 실제 업체·사람 이름 금지.
- 테넌트 셸(`TENANT_SHELL_SCREENS`)에 새 화면을 넣지 않는다.
- 새 HTTP 라우트 없음(core·file-service). 권한 키 추가 없음.
- 검증 게이트: `npm run type-check` 0, `npx jest --maxWorkers=2` 실패 0, `npm run test:admin-web` 실패 0. **로컬 E2E 스택이 떠 있으면 전체 jest·type-check 를 돌리지 않는다**(RAM 부족 재부팅 전력) — 스택을 내리고 돌린다.
- 스펙 안에서 `process.env.TZ` 를 바꾸지 않는다(jest 는 UTC). 스펙에서 `dotenv.config()` 금지.
- 커밋 메시지 끝: `Claude-Session: https://claude.ai/code/session_01LKjrK51xEAX1NWhyEqYPJT`

## Review Focus

1. **화면이 낡은 채 확정** — 다른 사람이 그 사이 상자를 전달용으로 돌렸거나 되돌렸다 → 409 «전달용 상자 확인이 화면과 다릅니다 — 새로 고쳐 다시 확인하세요», 확정 안 됨. (Task 2 통합 스펙)
2. **전달용을 재고로 되돌린 상자는 확인 대상에서 빠진다** — 화면의 확인 요구 목록·확정 본문 모두. (Task 5 스펙 `confirmReadiness`)
3. **엑셀이 아닌 파일·암호 걸린 파일·빈 통합문서** → 대화상자 안에 «엑셀을 읽지 못했습니다» 류 문구, core 호출 없음. (Task 4 스펙)
4. **검색어에 `%`·`_`** («100%», «A_1») → 와일드카드가 아니라 글자로 찾는다. (Task 1 스펙)
5. **날짜로 바뀐 옵션** — 브라우저가 KST 라 `toISOString()` 이 하루 앞당겨질 수 있어도 사람이 보는 건 `text`(엑셀 표시 문자열)이고 core 는 모양만 본다 → `text` 는 엑셀 표시 그대로. (Task 4 스펙)

---

## File Structure

**core**
- Create `apps/core/src/modules/inventory/sku-catalog/services/sku-name-search.ts` — 이름 검색어 → 단어별 ILIKE 패턴(순수).
- Modify `apps/core/src/modules/inventory/sku-catalog/services/sku-catalog.reader.ts:178` — `search` 의 이름 조건만.
- Modify `apps/core/src/modules/inventory/inbound-shipment/services/inbound-shipment.rules.ts` — `forwardAcknowledgementMatches`.
- Modify `apps/core/src/modules/inventory/inbound-shipment/dto/draft-edit.dto.ts` — `ConfirmInboundShipmentDto`.
- Modify `apps/core/src/modules/inventory/inbound-shipment/controllers/inbound-shipment.controller.ts` (`confirm`), `services/inbound-shipment.service.ts:54`, `services/inbound-shipment-draft.manager.ts:326` (`confirm`).

**file-service**
- Modify `apps/file-service/src/database/default-file-contexts.ts`, `apps/file-service/src/access/file-access.ts` (`STAFF_CONTEXT_PERMISSIONS`).

**admin-web** (`apps/admin-web/src/…`)
- Create `features/inventory/inbound-shipments/lib/read-workbook.ts` — 엑셀 → `{ header, rows }`.
- Create `features/inventory/inbound-shipments/lib/line-rules.ts` — 줄 단위 화면 규칙.
- Create `features/inventory/inbound-shipments/lib/shipment-rules.ts` — 선적 단위 화면 규칙.
- Create `lib/types/dto/inbound-shipment.ts`, `lib/api/domains/inventory/inbound-shipments.client.ts`, `lib/services/inventory/inbound-shipment-queries.ts`, `lib/services/inventory/inbound-shipment-mutations.ts`.
- Modify `lib/services/inventory/query-keys.ts`, `lib/api/domains/files/upload.client.ts`(컨텍스트 상수), `lib/auth/screen-access.ts`, `lib/pii/pii-screens.ts`, `lib/utils/menu.ts`.
- Create `app/(admin)/inventory/inbound-shipments/page.tsx`, `app/(admin)/inventory/inbound-shipments/[id]/page.tsx`, 컴포넌트는 `features/inventory/inbound-shipments/components/…`(배치는 실행자 몫).

---

### Task 1: core — SKU 이름 검색을 단어 AND 로 (spec §7.5)

**Files:**
- Create: `apps/core/src/modules/inventory/sku-catalog/services/sku-name-search.ts`
- Test: `apps/core/src/modules/inventory/sku-catalog/services/sku-name-search.spec.ts`
- Modify: `apps/core/src/modules/inventory/sku-catalog/services/sku-catalog.reader.ts:178`

**Interfaces:**
- Produces: `skuNameLikePatterns(name: string): string[]`, `MAX_SKU_NAME_TOKENS = 8`.

- [ ] **Step 1: 실패하는 스펙**

```ts
import { skuNameLikePatterns, MAX_SKU_NAME_TOKENS } from './sku-name-search';

describe('skuNameLikePatterns', () => {
  it('splits on whitespace into one contains-pattern per word', () => {
    expect(skuNameLikePatterns('니트릴 장갑  S')).toEqual(['%니트릴%', '%장갑%', '%S%']);
  });
  it('a single word is the old single pattern — what matched before still matches', () => {
    expect(skuNameLikePatterns('젤브러쉬')).toEqual(['%젤브러쉬%']);
  });
  it('escapes % _ \\ so they match literally', () => {
    expect(skuNameLikePatterns('100% A_1')).toEqual(['%100\\%%', '%A\\_1%']);
  });
  it('blank input gives no patterns', () => {
    expect(skuNameLikePatterns('   ')).toEqual([]);
  });
  it(`keeps at most ${MAX_SKU_NAME_TOKENS} words`, () => {
    expect(skuNameLikePatterns('a b c d e f g h i j')).toHaveLength(MAX_SKU_NAME_TOKENS);
  });
});
```

- [ ] **Step 2:** `npx jest apps/core/src/modules/inventory/sku-catalog/services/sku-name-search.spec.ts` → FAIL(모듈 없음).
- [ ] **Step 3: 구현** — `trim().split(/\s+/).filter(Boolean).slice(0, MAX_SKU_NAME_TOKENS).map(likeContains)`. `likeContains` 는 `apps/core/src/modules/inventory/sku-field-capture/sku-field-capture.rules.ts` 에서 import 한다(같은 규칙을 다시 쓰지 않는다).
- [ ] **Step 4: reader** — `sku-catalog.reader.ts:178` 을 `const patterns = query.name ? skuNameLikePatterns(query.name) : []; for (const p of patterns) conditions.push(sql\`${wmsTables.skus.name} ILIKE ${p}\`);` 꼴로. `searchAdvanced`(286행)·공급사 이름(161행)은 건드리지 않는다. 주석 한 줄: 단어마다 AND 라 예전 한 덩어리 검색이 찾던 것은 그대로 찾는다(`%`·`_` 는 이제 글자로 찾는다).
- [ ] **Step 5:** 같은 스펙 PASS, `npx jest apps/core/src/modules/inventory/sku-catalog --maxWorkers=2` PASS.
- [ ] **Step 6: 커밋** `SKU 이름 검색을 단어마다 AND 로 — 입고리스트 제품명으로 바로 찾게`

### Task 2: core — 확정은 사람이 확인한 전달용 상자 목록을 싣는다 (spec §7.6)

**Files:**
- Modify: `apps/core/src/modules/inventory/inbound-shipment/services/inbound-shipment.rules.ts`, `inbound-shipment.rules.spec.ts`
- Modify: `apps/core/src/modules/inventory/inbound-shipment/dto/draft-edit.dto.ts`, `dto/draft-edit.dto.spec.ts`
- Modify: `controllers/inbound-shipment.controller.ts` (`confirm`), `services/inbound-shipment.service.ts:54`, `services/inbound-shipment-draft.manager.ts` (`confirm`)
- Modify (호출부): `services/inbound-shipment-draft.manager.integration.spec.ts`(`manager.confirm` 전부), `services/inbound-shipment-receiving.manager.integration.spec.ts:134`

**Interfaces:**
- Produces: `forwardAcknowledgementMatches(forwardBoxIds: readonly string[], acknowledged: readonly string[]): boolean`; `ConfirmInboundShipmentDto { acknowledgedForwardBoxIds: string[] }`; `InboundShipmentDraftManager.confirm(shipmentId: string, acknowledgedForwardBoxIds: readonly string[], actorId: string, tx?: DbTx)` (반환형 그대로 `{ shipmentId; status: 'expected'; labelOverlaps: string[] }`); HTTP `POST /inventory/inbound-shipments/:id/confirm` 본문 `{ acknowledgedForwardBoxIds: string[] }`.

- [ ] **Step 1: 규칙 스펙** (`inbound-shipment.rules.spec.ts` 에 `describe('forwardAcknowledgementMatches')`)
  - `(['b1','b2'], ['b2','b1'])` → `true`(순서 무관)
  - `([], [])` → `true`
  - `(['b1'], [])` → `false`(빠짐)
  - `([], ['b1'])` → `false`(남음 — 화면이 낡았다)
  - `(['b1'], ['b1','b1'])` → `true`(중복은 집합으로 본다)
- [ ] **Step 2: DTO 스펙** (`draft-edit.dto.spec.ts`, 기존 꼴로 `validate`): 빈 배열 통과 / 필드 없음 실패 / uuid 아닌 원소 실패 / 2,001개 실패.
- [ ] **Step 3:** `npx jest apps/core/src/modules/inventory/inbound-shipment --maxWorkers=2` → 새 케이스 FAIL.
- [ ] **Step 4: 구현**
  - `ConfirmInboundShipmentDto`: `@IsArray() @ArrayMaxSize(2000) @IsUUID('all', { each: true }) acknowledgedForwardBoxIds: string[]` + `@ApiProperty({ type: [String], description: '사람이 «전달용 맞음»을 확인한 상자 id — 지금 전달용 상자 전부와 같아야 확정된다' })`.
  - 컨트롤러 `confirm(@Param id, @Body() dto: ConfirmInboundShipmentDto, @User() user)` → `service.confirm(id, dto.acknowledgedForwardBoxIds, actor)`.
  - 매니저 `confirm`: 기존 `confirmBlockers` 판정 **다음에**, 이미 읽은 `boxes` 에서 `disposition === 'forward'` id 를 모아 `forwardAcknowledgementMatches` 가 거짓이면 `throw new ConflictError('전달용 상자 확인이 화면과 다릅니다 — 새로 고쳐 다시 확인하세요.')`. 같은 트랜잭션·같은 선적 잠금 안.
- [ ] **Step 5: 통합 스펙 갱신·추가** (`describeIfDb` 안, 기존 `draft editing and confirm` 블록)
  - 기존 `manager.confirm(shipmentId, ACTOR, trx)` 호출을 전부 새 시그니처로. 전달용 상자가 없는 픽스처는 `[]`. 받기 스펙 헬퍼(`receiving…integration.spec.ts:134`)는 그 선적의 `forward` 상자 id 를 읽어 넘긴다.
  - 새 `it('confirm requires the exact set of forward boxes to be acknowledged')`: 비고에 «acme 에 발송바람» 이 든 줄로 전달용 상자 하나를 만든 초안 → `confirm(id, [], …)` 은 `ConflictError` + 메시지에 `전달용 상자 확인` → `confirm(id, [forwardBoxId], …)` 는 `status: 'expected'`.
  - 새 `it('a stale acknowledgement is rejected after a box is flipped back to stock')`: 위 상자를 `editBox(… { disposition: 'stock' })` 한 뒤 `confirm(id, [forwardBoxId])` → `ConflictError`, `confirm(id, [])` → 통과.
- [ ] **Step 6:** 유닛 `npx jest apps/core/src/modules/inventory/inbound-shipment --maxWorkers=2` PASS. 통합 `npm run test:core:integration:local -- inbound-shipment` PASS(로컬 postgres 필요. 실행 불가면 그 사실과 이유를 보고에 적는다).
- [ ] **Step 7:** 모델 설계 §10 표의 confirm 줄 옆에 «본문 `{ acknowledgedForwardBoxIds }` (실행 중 결정)» 를 더한다.
- [ ] **Step 8: 커밋** `선적 확정에 전달용 상자 확인 목록을 싣는다 — «발송» 글자로 상자가 조용히 빠지지 않게`

### Task 3: file-service — 입고리스트 원본 컨텍스트와 직원 열람 (spec §6)

**Files:**
- Modify: `apps/file-service/src/database/default-file-contexts.ts`, `apps/file-service/src/access/file-access.ts`
- Test: `apps/file-service/src/database/__tests__/inbound-shipment-list-file-context.spec.ts`(새, `sku-3d-model-file-context.spec.ts` 꼴), `apps/file-service/src/access/file-access.checkpoint.spec.ts`(기존 `archive-page-attachment` 케이스를 본뜬 케이스 추가)

**Interfaces:**
- Produces: `INBOUND_SHIPMENT_LIST_CONTEXT_ID = 'inbound-shipment-list'`, `INBOUND_SHIPMENT_LIST_MAX_SIZE_BYTES = 50 * 1024 * 1024`.

- [ ] **Step 1: 스펙**
  - 컨텍스트: `toMatchObject({ allowPublic: false, allowPrivate: true, allowedMimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], maxFileSize: 52428800, pathPrefix: 'inventory/inbound-shipment-lists', isActive: true })`.
  - 접근: 남이 올린 `inbound-shipment-list` 파일을 `inventory.stock.read` 만 가진 직원이 같은 테넌트에서 읽음 → 통과, 다른 테넌트 → `NotFoundError`/`ForbiddenError`(기존 케이스와 같은 기대), 권한 없는 직원 → 거절.
- [ ] **Step 2:** `npx jest apps/file-service --maxWorkers=2` → FAIL.
- [ ] **Step 3: 구현** — 상수 둘과 `FILE_CONTEXTS` 한 항목(`name: 'Inbound Shipment List'`, `description: '선적 입고리스트 원본(xlsx)'`), `STAFF_CONTEXT_PERMISSIONS` 에 `[INBOUND_SHIPMENT_LIST_CONTEXT_ID, 'inventory.stock.read']` + 주석 한 줄(중국 직원이 올리고 한국 쪽이 연다).
- [ ] **Step 4:** 같은 명령 PASS. `npx jest scripts/seeding --maxWorkers=2` PASS(시드가 `FILE_CONTEXTS` 를 그대로 쓴다).
- [ ] **Step 5: 커밋** `file-service 에 입고리스트 원본 컨텍스트 — 한국 쪽도 열람`

### Task 4: admin-web — 엑셀 읽기 순수 함수 (spec §5)

**Files:**
- Create: `apps/admin-web/src/features/inventory/inbound-shipments/lib/read-workbook.ts`
- Test: `apps/admin-web/src/features/inventory/inbound-shipments/lib/read-workbook.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ShipmentListCell = { text: string; value: string | number | boolean | null; formula?: string };
  export type ShipmentListRow = { rowNumber: number; cells: ShipmentListCell[] };
  export type ReadWorkbookResult = { sheetName: string; header: string[]; rows: ShipmentListRow[]; dataRowCount: number };
  export class WorkbookReadError extends Error {}
  export function readInboundShipmentWorkbook(data: ArrayBuffer): ReadWorkbookResult;
  ```
  `header`·`rows` 는 core `UploadInboundShipmentDto` 의 `header`·`rows` 에 그대로 실린다.

- [ ] **Step 1: 스펙** — 픽스처는 스펙 안에서 `XLSX.utils.aoa_to_sheet` 로 만들고 `XLSX.write(wb, { type: 'array', bookType: 'xlsx' })` 로 바이트를 만든 뒤 읽는다(실제 파일 왕복). 케이스:
  - 병합 `A2:A4` 의 `'L5-L9'` → 2·3·4행 `cells[0].text === 'L5-L9'`.
  - 머리글 = 첫 비어 있지 않은 행: 1행이 비고 2행이 머리글이면 `header` 는 2행, 첫 데이터 `rowNumber === 3`.
  - 중간 빈 행은 남고 번호를 건너뛰지 않는다(`rowNumber` 가 엑셀 행 번호). `dataRowCount` 는 빈 행을 세지 않는다.
  - 끝의 빈 행·빈 열은 잘린다: `!ref` 를 `A1:Z1000` 으로 넓힌 시트(데이터 `A1:I3`) → `header.length === 9`, `rows.length === 2`, 각 행 `cells.length === 9`.
  - 수식 칸(`{ t: 'n', v: 208, f: '199+9' }`) → `{ text: '208', value: 208, formula: '199+9' }`.
  - 숫자 바코드 `10390520010` → `value === 10390520010`(숫자 그대로).
  - 날짜 칸(`cellDates` 로 쓴 `Date`) → `value` 가 `/^\d{4}-\d{2}-\d{2}T/` 에 맞는 문자열, `text` 는 엑셀 표시 문자열 그대로(Review Focus 5).
  - 첫 시트가 비고 둘째 시트에 데이터 → `sheetName` 이 둘째.
  - 모든 시트가 비었다 → `WorkbookReadError`. 엑셀이 아닌 바이트(`new TextEncoder().encode('hello').buffer`) → `WorkbookReadError`(Review Focus 3).
- [ ] **Step 2:** `npm run test:admin-web -- read-workbook` → FAIL.
- [ ] **Step 3: 구현** — `XLSX.read(data, { type: 'array', cellFormula: true, cellDates: true })`. 칸: `text = cell.w ?? (cell.v == null ? '' : String(cell.v))`, `value = cell.v instanceof Date ? cell.v.toISOString() : (cell.v ?? null)`, `formula = cell.f`(있을 때만). 병합은 `!merges` 를 돌며 왼쪽 위 칸 객체를 범위 전체에 복사한 뒤 읽는다. 사용 범위는 «값이 있는 마지막 행·열»로 다시 잰다. 라이브러리 예외는 `WorkbookReadError('엑셀 파일을 읽지 못했습니다. .xlsx 파일인지 확인해 주세요.')` 로 감싼다.
- [ ] **Step 4:** PASS. 그리고 샘플로 손 실측(커밋하지 않음): 스크래치 스크립트에서 `.scratch/cutover-inputs/20261019.xlsx` 를 읽어 `dataRowCount === 251`, `header` 가 `['박스번호','NO','제품명','이미지','수량','옵션','바코드','총수량','비고']` 인지 본다.
- [ ] **Step 5: 커밋** `admin-web 입고리스트 읽기 — 병합 채우기·날짜·수식·끝 빈칸 자르기`

### Task 5: admin-web — 화면 규칙 순수 함수 (spec §7)

**Files:**
- Create: `apps/admin-web/src/lib/types/dto/inbound-shipment.ts` — core `inbound-shipment-view.dto.ts`·`receive.dto.ts` 의 응답 모양을 옮긴 타입(`InboundShipmentSummary`, `InboundShipmentDetail`, `InboundShipmentLine`, `InboundShipmentBox`, `LineIssueCode` = core `LineIssue` 15개 문자열 유니언 그대로).
- Create: `apps/admin-web/src/features/inventory/inbound-shipments/lib/line-rules.ts`, `shipment-rules.ts`
- Test: 같은 폴더 `line-rules.spec.ts`, `shipment-rules.spec.ts`

**Interfaces:**
- Produces (`line-rules.ts`):
  - `WARNING_ISSUES: ReadonlySet<LineIssueCode>` = `box_label_guess`, `box_range_invalid`, `qty_formula`, `option_date_coerced`, `packing_unit_barcode`. (표시만: `forward_hint`, `contact_hint`. 나머지는 미확인을 만드는 코드라 `kind==='unresolved'` 로 이미 잡힌다.)
  - `needsAttention(line: InboundShipmentLine): boolean` — 미확인이거나 `WARNING_ISSUES` 하나라도.
  - `issueLabel(code: LineIssueCode): string` — 15개 전부 한국어(문구는 실행자 몫, 빈 문자열 금지).
  - `prefillSearchText(line): string` — `raw.productName?.text` 를 trim, 없으면 `''`(옵션은 넣지 않는다). `raw` 키는 core 파서 `RAW_KEYS` = `boxLabel`·`no`·`productName`·`quantity`·`option`·`barcode`·`total`·`remark`, 값은 `{ text, value, formula? } | null` — 타입 `InboundShipmentLine['raw']` 도 이 모양으로 둔다.
  - `skuSearchQueries(input: string): Array<{ barcode: string } | { code: string } | { name: string }>` — trim 뒤 `/^\d{8,}$/` 면 `[{barcode},{code}]`, 빈 문자열이면 `[]`, 아니면 `[{name}]`.
  - `lineEditability(shipment: InboundShipmentDetail, line): { editable: true } | { editable: false; reason: string }` — 초안 → 가능, `expected`·`receiving` 이고 덮는 상자가 전부 `open` → 가능, `closed` → «끝난 선적입니다. 다시 열어야 고칠 수 있습니다», 받은 상자 있음 → «받은 상자가 있어 고칠 수 없습니다», `canceled` → «취소된 선적입니다».
  - `differenceText(line, coveredBoxes: InboundShipmentBox[]): string` — `pending` 이면 «진행 중 (받은 상자 n/m)», `match` «맞음», `short` «모자람 {expected-counted}», `over` «남음 {counted-expected}», `not_arrived` «안 옴».
- Produces (`shipment-rules.ts`):
  - `forwardBoxes(shipment): InboundShipmentBox[]` — `disposition==='forward'`, `sortKey` 순.
  - `skuLineCountInBox(shipment, boxLabel: string): number` — `kind==='sku'` 이고 `coversBoxLabels` 에 그 이름이 있는 줄 수(띠의 «SKU 줄 N개는 재고로 안 들어옵니다»).
  - `confirmReadiness(shipment, acknowledged: ReadonlySet<string>): { enabled: boolean; unresolvedStockLines: number; unacknowledgedForwardBoxIds: string[]; acknowledgedForwardBoxIds: string[] }` — `acknowledgedForwardBoxIds` 는 **지금 전달용인 상자 중** 체크된 것만(재고로 되돌린 상자의 남은 체크는 버린다). `enabled` = 초안 && 재고 상자를 덮는 미확인 줄 0 && 미확인 전달용 0. 서버 판정을 대신하지 않는다(안내용).
  - `shipmentActions(shipment): { confirm: boolean; cancel: boolean; close: boolean; reopen: boolean }` — confirm: `draft`. cancel: `draft` 또는 (`expected` && `summary.boxesReceived===0`). close: `expected`·`receiving`. reopen: `closed` && `closedReason !== null`.
  - `boxDispositionEditable(shipment, box): boolean` — 선적이 `closed`·`canceled` 가 아니고 `box.status==='open'`.
  - `defaultShipmentName(fileName: string): string` — 마지막 확장자 제거, 255자 자름.
  - `defaultWarehouseId(warehouses: Array<{ id: string; type: string }>): string | null` — `type !== 'overseas'` 가 정확히 하나면 그 id.

- [ ] **Step 1: 스펙** — 위 함수마다 경계 케이스. 반드시 포함:
  - `needsAttention`: `kind:'sku'` + `issues:['box_label_guess']` → `true`; `kind:'sku'` + `['contact_hint']` → `false`.
  - `confirmReadiness`: 전달용 b1·b2 중 b1 만 체크 → `enabled:false`, `unacknowledgedForwardBoxIds:['b2']`; b2 를 `stock` 으로 바꾼 상세 + 체크 `{b1,b2}` → `acknowledgedForwardBoxIds:['b1']`, `enabled:true`(Review Focus 2); 전달용 상자에만 얹힌 미확인 줄은 `unresolvedStockLines` 에 안 센다.
  - `shipmentActions`: 저절로 닫힌 선적(`closedReason:null`) → `reopen:false`; `expected` + 받은 상자 1 → `cancel:false`.
  - `lineEditability`: `closed` + 덮는 상자 전부 `open` → `editable:false`(다시 열어야 함).
  - `skuSearchQueries('10390520010')` → `[{barcode:'10390520010'},{code:'10390520010'}]`; `'  '` → `[]`.
  - `defaultWarehouseId`: domestic 1 + overseas 1 → domestic id; domestic 2 → `null`.
- [ ] **Step 2:** `npm run test:admin-web -- inbound-shipments` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: 커밋** `admin-web 선적 화면 규칙 — 확인 필요·전달용 확인·버튼 활성`

### Task 6: admin-web — API 클라이언트·쿼리·뮤테이션 훅

**Files:**
- Create: `apps/admin-web/src/lib/api/domains/inventory/inbound-shipments.client.ts`, `apps/admin-web/src/lib/services/inventory/inbound-shipment-queries.ts`, `apps/admin-web/src/lib/services/inventory/inbound-shipment-mutations.ts`
- Modify: `apps/admin-web/src/lib/services/inventory/query-keys.ts`, `apps/admin-web/src/lib/api/domains/files/upload.client.ts`

**Interfaces:**
- Consumes: Task 4 `ReadWorkbookResult`, Task 5 타입, Task 2 확정 본문.
- Produces:
  - `inboundShipmentsClient`: `list({ status?: string[]; warehouseId? })`, `detail(id)`, `upload(body: UploadInboundShipmentBody): Promise<{ shipmentId: string }>`, `updateHeader(id, { name?, expectedArrival?, memo? })`, `editLine(id, lineId, { kind?, skuId?, expectedQty?, boxLabels? })`, `editBox(id, boxId, { disposition?, forwardNote?, label? })`, `confirm(id, { acknowledgedForwardBoxIds })`, `cancel(id)`, `close(id, { reason })`, `reopen(id)`. 경로는 `${ALMONDYOUNG_API_BASE_URL}/inventory/inbound-shipments…`, `inbound.client.ts` 꼴(axios `client`).
  - `INBOUND_SHIPMENT_LIST_CONTEXT_ID = 'inbound-shipment-list'` (`upload.client.ts`, 다른 컨텍스트 상수 옆).
  - 쿼리 키 `inventoryQueryKeys.inboundShipments(filter)`, `inventoryQueryKeys.inboundShipment(id)`; 훅 `useInboundShipments(filter)`, `useInboundShipment(id)`.
  - 뮤테이션 훅(전부 `.permission = ['inventory.inbound_shipment.write'] as const satisfies PermissionRequirement`, 성공 시 목록·그 상세 무효화): `useUploadInboundShipment`, `useUpdateInboundShipmentHeader`, `useEditInboundShipmentLine`, `useEditInboundShipmentBox`, `useConfirmInboundShipment`, `useCancelInboundShipment`, `useCloseInboundShipment`, `useReopenInboundShipment`.
  - `useUploadInboundShipment` 의 `mutationFn({ file, read, warehouseId, name, expectedArrival, allowWithoutOriginal })`: ① `allowWithoutOriginal` 이 아니면 `uploadFileToFileService(file, { contextId: INBOUND_SHIPMENT_LIST_CONTEXT_ID, isPublic: false, compress: false })`; 실패하면 `OriginalUploadFailedError(cause)` 를 던지고 core 를 부르지 않는다 ② core `upload({ warehouseId, name, expectedArrival, sourceFileId, sourceFileName: file.name, header: read.header, rows: read.rows })`. 대화상자가 `OriginalUploadFailedError` 를 받으면 «원본을 보관하지 못했습니다(사유). 원본 없이 올릴까요?» 를 묻고 예면 `allowWithoutOriginal: true` 로 다시 부른다(spec §6).
- [ ] **Step 1:** 구현(얇은 배선이라 스펙은 Task 4·5 와 게이트가 맡는다).
- [ ] **Step 2:** `npx jest apps/admin-web/src/lib/auth/mutation-guard --maxWorkers=2` PASS(훅 선언 확인), `npm run type-check` 0.
- [ ] **Step 3: 커밋** `admin-web 선적 API 클라이언트·훅`

### Task 7: admin-web — 목록·올리기 대화상자·화면 배선 (spec §7.1·§7.2·§8)

**Files:**
- Create: `apps/admin-web/src/app/(admin)/inventory/inbound-shipments/page.tsx`, `apps/admin-web/src/app/(admin)/inventory/inbound-shipments/[id]/page.tsx`(Task 8 이 내용을 채운다 — 여기선 `RouteGuard` + 자리 표시)
- Create: `features/inventory/inbound-shipments/components/shipment-list/…`, `components/upload-dialog/…`
- Modify: `lib/auth/screen-access.ts`(두 줄 `any('inventory.stock.read')`), `lib/pii/pii-screens.ts`(`PII_SCREEN_NOT_SHOWN` 두 줄 — 사유 «고객 개인정보를 부르지 않는다. 리스트 비고의 이름은 직원·거래처다»), `lib/utils/menu.ts`(`inventory-inbound` 다음 `{ id: 'inventory-inbound-shipments', title: '선적 입고', path: '/inventory/inbound-shipments' }`)

**Interfaces:**
- Consumes: Task 4 `readInboundShipmentWorkbook`, Task 5 `defaultShipmentName`·`defaultWarehouseId`, Task 6 훅·`useWarehouses`.

- [ ] **Step 1: 목록** — 탭 진행 중(`draft,expected,receiving`)/끝남(`closed`)/취소(`canceled`), 열 이름·상태·상자 수·줄 수·도착 예정일, 줄 클릭 → 상세. 창고 필터는 창고가 둘 이상일 때만. «입고리스트 올리기» 는 `<Can run={useUploadInboundShipment}>`.
- [ ] **Step 2: 대화상자** — `accept=".xlsx"`. 파일을 고르면 `file.arrayBuffer()` → `readInboundShipmentWorkbook` → «{dataRowCount}줄 읽음»(실패면 `WorkbookReadError.message`). 창고(기본 `defaultWarehouseId`), 이름(기본 `defaultShipmentName`), 도착 예정일(선택, `YYYY-MM-DD`). 올리기 → 성공 시 `/inventory/inbound-shipments/{shipmentId}` 로. core 400(열 없음·행 상한)은 서버 문구 그대로. 원본 실패 확인은 Task 6 흐름.
- [ ] **Step 3: 게이트** — `npm run test:admin-web -- screen-access pii-screens mutation-guard tenant-shell` PASS.
- [ ] **Step 4: 커밋** `admin-web 선적 목록·입고리스트 올리기`

### Task 8: admin-web — 초안 상세 (spec §7.3)

**Files:**
- Modify: `apps/admin-web/src/app/(admin)/inventory/inbound-shipments/[id]/page.tsx`
- Create: `features/inventory/inbound-shipments/components/shipment-detail/…`(머리, 전달용 띠, 줄 표, 줄 서랍, 상자 탭)

**Interfaces:**
- Consumes: Task 5 전부, Task 6 훅, `skusClient.getSkus`(`lib/api/domains/inventory/skus.client.ts`).

- [ ] **Step 1: 머리** — 이름·도착 예정일·메모 고치기(`useUpdateInboundShipmentHeader`), 원본 ⬇(`sourceFileId` 있으면 `getFileSignedUrlFromFileService`, 없으면 «원본 없음»), «미확인 N», «취소», «확정».
- [ ] **Step 2: 전달용 띠** — `forwardBoxes` 마다 상자 이름·`forwardNote` 원문·«이 상자 안의 SKU 줄 {skuLineCountInBox}개는 재고로 안 들어옵니다»(0이면 숨김)·«전달용 맞음» 체크(화면 상태, 저장 안 함)·«재고로 받기»(`useEditInboundShipmentBox` `{disposition:'stock'}`).
- [ ] **Step 3: 줄 표** — 열: 행·상자(범위는 `L5~L9`)·제품명·옵션·바코드 원문·수량·종류·사유(`issueLabel`). 기본 필터 «확인 필요»(`needsAttention`), 끄면 전체.
- [ ] **Step 4: 줄 서랍** — 원문 칸, 이슈 설명, 검색(입력 기본값 `prefillSearchText`, 열자마자 검색, `skuSearchQueries` 결과를 각각 `getSkus` 로 부르고 id 로 중복 제거, `barcodeCandidates`·`aiCandidates` 가 있으면 맨 위), «이 SKU 로»(`{kind:'sku', skuId}`), «자유 줄로»(`{kind:'free'}`), 수량(`expectedQty`), 덮는 상자(`boxLabels`, 초안만). 버튼 활성은 `lineEditability`.
- [ ] **Step 5: 상자 탭** — 이름·처분·덮는 줄 수. 처분 양방향, 초안이면 이름 고치기(`useEditInboundShipmentBox`).
- [ ] **Step 6: 확정** — 버튼은 `confirmReadiness(...).enabled` 로 켜고 옆에 남은 미확인·미확인 전달용 수. 누르면 `useConfirmInboundShipment({ acknowledgedForwardBoxIds })`. 409 는 서버 문구 그대로 + 상세 다시 읽기. 성공 응답의 `labelOverlaps` 가 있으면 «같은 창고의 열린 선적과 상자 이름이 겹칩니다: …» 경고(막지 않음).
- [ ] **Step 7:** `npm run type-check` 0, `npm run test:admin-web -- inbound-shipments mutation-guard` PASS.
- [ ] **Step 8: 커밋** `admin-web 선적 초안 — 확인 필요 줄 정리·전달용 확인·확정`

### Task 9: admin-web — 확정 뒤 상세 (spec §7.4)

**Files:**
- Modify/Create: `features/inventory/inbound-shipments/components/shipment-detail/…`(요약 카드, 줄·상자·리스트에 없던 물건 탭, 끝내기 대화상자)

**Interfaces:**
- Consumes: Task 5 `shipmentActions`·`lineEditability`·`boxDispositionEditable`·`differenceText`, Task 6 훅.

- [ ] **Step 1: 머리** — 상태 배지, 창고, 도착 예정일 ✎, 원본 ⬇, 사람이 끝냈으면 «끝낸 사유: …·시각». 버튼은 `shipmentActions`: «끝내기…»(사유 필수 대화상자, 앞뒤 공백 뺀 1~500자) / «다시 열기» / «취소».
- [ ] **Step 2: 요약 카드** — `summary` 의 상자 확정 `boxesReceived`/`boxesTotalStock`, 모자람 `shortLines`, 남음 `overLines`, 안 옴 `notArrivedLines`, 리스트에 없던 물건 `unplannedCounts`, 전달용 `forwardBoxes`, 리스트에 없던 상자 `addedBoxes`. 0 인 카드는 흐리게(숨기지 않는다 — 진행 상황판이다).
- [ ] **Step 3: 탭** — 줄(기본 «차이 있는 줄만» = `difference.state` 가 `short`·`over`·`not_arrived`, 열에 `differenceText`), 상자(이름·처분·상태·센 수량·확정 시각, `origin==='added'` 표시, 처분 바꾸기는 `boxDispositionEditable`), 리스트에 없던 물건(`unplannedItems`, 상자 순).
- [ ] **Step 4: 줄 서랍(확정 뒤)** — 원문, 센 수량 합계, 덮는 상자마다 받음/열림. 고치기는 `lineEditability` 가 거짓이면 비활성 + `reason`.
- [ ] **Step 5:** `npm run type-check` 0, `npm run test:admin-web -- inbound-shipments` PASS.
- [ ] **Step 6: 커밋** `admin-web 선적 상세 — 진행·차이·끝내기·다시 열기`

### Task 10: 전체 검증과 로컬 실측

- [ ] **Step 1:** 로컬 E2E 스택을 내린 상태에서 `npm run type-check` → 0, `npx jest --maxWorkers=2` → 실패 0, `npm run test:admin-web` → 실패 0. 출력 끝줄을 보고에 붙인다.
- [ ] **Step 2: 로컬 실측** — `npm run bootstrap:e2e:local` → `npm run start:all:local` → `npm run preflight:e2e:local` 초록. 로컬 file-service 에 새 컨텍스트가 들어갔는지(`db:seed:ref` 또는 bootstrap 이 시드를 돈다) 확인. **브라우저 로그인은 사용자가 직접 한다** — 로그인을 요청하고 기다린다.
- [ ] **Step 3:** 샘플 `.scratch/cutover-inputs/20261019.xlsx` 로: 올리기(«251줄 읽음») → 초안에서 «확인 필요» 줄 수 확인 → 다른 체계 코드 줄을 자유 줄로, 이름 검색으로 SKU 하나 정하기 → 전달용 상자 체크 없이 확정 버튼 꺼짐 → 체크 후 확정 → 확정 뒤 화면 요약 카드 → 끝내기(사유) → 다시 열기 → 원본 ⬇. 보고에는 어느 단계까지 눈으로 봤는지와 못 본 단계를 그대로 적는다. 샘플 내용(업체·사람 이름)은 보고·커밋에 옮기지 않는다.
- [ ] **Step 4:** 다 되면 `superpowers:finishing-a-development-branch`.

## 배포 메모 (이 계획의 작업이 아니라 배포 때 사람이 할 일)

- ① 과 같은 `sst deploy` 에 실린다. ① 의 마이그 → 배포 → `db:seed:ref`(file_context). 시드 전까지 원본 업로드 404 는 «원본 없이 올릴까요?» 가 막는다.
- 배포 뒤 중국 직원 역할에 `inventory.inbound_shipment.write`·`inventory.stock.read` 부여.
- 첫 라이브 초안에서 «바코드 꼴인데 못 찾은 줄» 수를 본다 — AI 를 붙일지 정하는 숫자.
