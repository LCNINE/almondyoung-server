# 선적 입고 ③ — 스테이션 상자 입고 + 선적 상세 상자 열기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스테이션에서 선적 상자를 열어 줄마다 센 수량(«센 것»/«리스트대로» 구별)을 넣고 확정·당일 취소·리스트에 없던 물건·리스트에 없던 상자를 처리하고, 기존 입고 화면과 admin-web 이 새 source 를 알며, admin-web 상자 탭에서 상자를 열어 본다.

**Architecture:** core 는 전부 추가형 변경(집계 `count_method` 열·상자 열기 응답 필드·찾기 범위·저절로 끝난 선적에 상자 더하기·입고내역의 상자 연결·work-context 권한) — PR 하나. warehouse-app 은 반품 F7 처럼 **스테이션 전용 화면**(`src/station/inbound/`)이 상태 기계로 돌고, 판정은 순수 함수(`src/domains/inbound-shipment/boxDraft.ts`)에 둔다. 쓰기는 기존 `operationRunner`(IndexedDB) 를 타고, 넣던 수량과 멱등 키는 `useWorkDraft` 에 상자 id 로 남는다. admin-web 은 상자 탭에 서랍 하나와 순수 함수 하나.

**Tech Stack:** NestJS + Drizzle(core), React + TanStack Router/Query + vitest(warehouse-app, Tauri), Next.js + jest(admin-web).

**Spec:** `docs/superpowers/specs/2026-11-16-inbound-shipment-station-box-receiving-design.md` (이하 «스펙»). 상위: `docs/superpowers/specs/2026-11-16-inbound-shipment-boxes-design.md`(«모델 설계»). 실행자는 스펙을 함께 읽는다.

## Global Constraints

- 상자 확정·확정 취소·리스트에 없는 상자는 **창고 작업 계약 v2 만**: 본문 `{ contractVersion: 2, idempotencyKey, … }`. 앱에서는 `operationRunner` 가 붙인다 — 화면 코드가 `contractVersion` 을 직접 쓰지 않는다.
- `counts` 는 그 상자를 덮는 줄 **전부를 정확히 한 번씩**(0 포함). 빈칸이 남으면 확정하지 않는다.
- 수량 상한 `MAX_LINE_QTY = 1_000_000`(`inbound-shipment-list.parser.ts`), 리스트에 없던 물건은 `>= 1`.
- **«리스트대로»(`method: 'list'`)는 이 상자 하나만 덮고(`coversBoxLabels.length === 1`) `countedQty === expectedQty` 인 줄에만.** 범위 줄·리스트에 없던 물건은 늘 `counted`. 상자 전체를 한 번에 채우는 기능은 만들지 않는다.
- 스테이션 기능키는 **F8~F12 와 Esc 만**. F1~F7 은 셸의 탭 전환(`src/station/keys.ts` `TAB_KEYS`). 이 계획의 키: F8 리스트대로 · F9 리스트에 없던 물건(SKU 검색) · F10 확정(두 번) · F11 확정 취소(두 번) · F12 리스트에 없는 상자로 받기.
- «오늘»은 Asia/Seoul 날짜. 저절로 끝난 선적은 «끝난 지 30일 안»만 F12 후보.
- 사람이 닫은 선적(`closed_reason IS NOT NULL`)은 현장이 상자를 더하지 못한다(409 유지).
- core 레이어 규칙(CLAUDE.md): Controller → Service → Reader/Manager. Service 는 도메인 예외만. `any`·근거 없는 `as` 금지.
- 공개 레포: 테스트·픽스처에 실제 업체명·사람 이름·테넌트 값을 쓰지 않는다(합성 값: `11월 2차 배편`, `acme`).
- 화면 문구는 한국어, «필요한 것만»(U2). 작업자 문구는 «송장»(라벨 아님) — 이 화면에는 해당 없음.
- jest 는 `--maxWorkers=2`. 로컬 E2E 스택이 떠 있으면 전체 jest·type-check 를 돌리지 않는다(메모리 부족).

## Review Focus

1. **상자가 열린 동안 관리자가 리스트를 고침** — 기기 초안의 «리스트대로»가 옛 예정 수량을 들고 있음 → 열 때·확정 직전 맞춰 빈칸으로 되돌리고 «N줄 다시 확인». 테스트: Task 9 `reconcileDraft`, Task 11 «확정 직전 다시 읽기».
2. **확정 응답이 끊김 / 앱 재시작** — 같은 키·같은 본문으로만 다시 나가고 수량이 잠긴다. 테스트: Task 11 «uncertain 뒤 재전송은 같은 키».
3. **한 상자에 같은 SKU 줄이 둘** — 스캔이 지금 줄 우선, 아니면 행 순서 첫 줄. 테스트: Task 9 `applyScan`.
4. **마지막 상자 확정으로 선적이 저절로 끝난 뒤 당일 취소** — 이름으로 다시 찾힌다. 테스트: Task 3, Task 12.
5. **0·자유 줄뿐인 상자(회차 없음)를 확정→취소→재확정→취소** — 두 번째 취소가 다른 키로 나간다. 테스트: Task 12 «취소 키는 집계 id».

---

## 준비 (실행 전 한 번)

- [ ] 워크트리 `/home/pauseb/workspace/almondyoung-server/.claude/worktrees/inbound-box-receiving` (브랜치 `feat/inbound-shipment-box-receiving`) 에서 작업한다. `node_modules` 를 메인 체크아웃에서 심볼링크한다:

```bash
ln -s /home/pauseb/workspace/almondyoung-server/node_modules node_modules
ln -s /home/pauseb/workspace/almondyoung-server/native/warehouse-app/node_modules native/warehouse-app/node_modules
```

- [ ] core 통합 스펙은 워크트리에서 `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- <파일 경로>` 로 돈다. 로컬 `core` DB 마이그가 깨져 있으면 스크래치 DB 를 만들어 `DATABASE_URL` 로 넘긴다.

---

## Core

### Task 1: 집계에 «센 것 / 리스트대로» (`count_method`)

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (enum 은 `:187` 근처 선적 enum 옆, 열·CHECK 는 `inboundShipmentBoxCounts` `:3125`)
- Create: `apps/core/drizzle/<timestamp>_add-inbound-shipment-count-method.sql` (+ `drizzle/meta/`)
- Modify: `apps/core/src/modules/inventory/inbound-shipment/dto/receive.dto.ts` (`ReceiveBoxCountDto`, `BoxCountViewDto`)
- Modify: `apps/core/src/modules/inventory/inbound-shipment/services/inbound-shipment-receiving.manager.ts` (`linesOfBox`, `planLineCounts`, 집계 insert)
- Modify: `apps/core/src/modules/inventory/inbound-shipment/services/inbound-shipment.reader.ts` (`openBox` 의 `counts` select)
- Test: `dto/receive.dto.spec.ts`, `services/inbound-shipment-receiving.manager.integration.spec.ts`

**Interfaces:**
- Produces: `inboundShipmentCountMethodEnum = pgEnum('inbound_shipment_count_method', ['counted', 'list'])`; 열 `countMethod: inboundShipmentCountMethodEnum('count_method').notNull().default('counted')`; CHECK `ck_inbound_shipment_box_counts_method`: `${t.lineId} IS NOT NULL OR ${t.countMethod} = 'counted'`.
- Produces: `ReceiveBoxCountDto.method: 'counted' | 'list'` (필수, `@IsIn(['counted', 'list'])`). `BoxCountViewDto.method: 'counted' | 'list'`.

- [ ] **Step 1: DTO 스펙** — `receive.dto.spec.ts` 에:
  - `it('requires counts[].method')` — `method` 없는 count 는 검증 오류.
  - `it('rejects an unknown method')` — `method: 'guess'` 는 오류.
  - 기존 «accepts a valid v2 body» 의 counts 에 `method: 'counted'` 를 더한다.
- [ ] **Step 2: 통합 스펙** — manager 통합 스펙에 (기존 헬퍼로 선적·상자 만들기):
  - `it('stores list method for a single-box line whose qty equals expected')` — 단일 상자 줄 예정 40, `{countedQty: 40, method: 'list'}` → 집계 행 `countMethod === 'list'`, `openBox().counts[0].method === 'list'`.
  - `it('refuses list method on a range line')` — 상자 둘을 덮는 줄에 `method: 'list'` → `BadRequestError`, 메시지에 `행` 포함.
  - `it('refuses list method when qty differs from expected')` — 예정 40, `{countedQty: 38, method: 'list'}` → `BadRequestError`.
  - `it('unplanned counts are stored as counted')` — `unplanned` 행의 `countMethod === 'counted'`.
  - 기존 스펙의 모든 `counts` 항목에 `method: 'counted'` 를 더한다.
- [ ] **Step 3: 실패 확인** — `npx jest --runTestsByPath apps/core/src/modules/inventory/inbound-shipment/dto/receive.dto.spec.ts` → FAIL. 통합 스펙 → FAIL(열 없음).
- [ ] **Step 4: 스키마 + 마이그** — 스키마를 고치고 `npm run db:generate:core -- --name add-inbound-shipment-count-method`. 생성 SQL 이 `CREATE TYPE` + `ADD COLUMN … DEFAULT 'counted' NOT NULL` + `ADD CONSTRAINT` 뿐인지 본다. ①의 `20261115172410_add-inbound-shipments.sql` 은 건드리지 않는다.
- [ ] **Step 5: 구현** — `linesOfBox` 가 `expectedQty` 와 줄이 덮는 상자 수 `coverCount`(그 줄의 `inbound_shipment_line_boxes` 행 수)를 함께 읽는다. `planLineCounts` 가 `method === 'list'` 이고 `coverCount !== 1 || countedQty !== expectedQty` 면 `BadRequestError(\`리스트대로는 이 상자 하나만 덮고 예정 수량과 같은 줄에만 쓸 수 있습니다: ${rowNumber}행\`)`. `PlannedCount` 에 `countMethod` 를 싣고(리스트에 없던 물건은 `'counted'`) insert 한다. `openBox` 의 counts select 에 `method: countMethod`.
- [ ] **Step 6: 통과 확인** — 위 두 명령 PASS.
- [ ] **Step 7: Commit** — `git commit -m "[core] 선적 상자 집계에 «센 것/리스트대로» 를 남긴다 (#1239)"` (schema + SQL + meta + dto + manager + reader + 스펙을 한 커밋에).

### Task 2: 상자 열기 응답 넓히기

**Files:**
- Modify: `apps/core/src/modules/inventory/inbound-shipment/dto/receive.dto.ts` (`BoxLineViewDto`, `BoxCountViewDto`, `BoxViewDto`)
- Modify: `apps/core/src/modules/inventory/inbound-shipment/services/inbound-shipment.reader.ts` (`openBox`)
- Test: `services/inbound-shipment-receiving.manager.integration.spec.ts` (기존 `openBox` 스펙 옆)

**Interfaces:**
- Produces: `BoxLineViewDto.sku: { code: string; name: string } | null` (`InboundShipmentLineSkuDto` 재사용, `kind === 'sku'` 일 때만). `BoxCountViewDto.skuCode: string | null`, `skuName: string | null` (SKU 가 있는 집계면 채운다). `BoxViewDto.receivedAt: Date | null`.

- [ ] **Step 1: 통합 스펙** — `it('openBox carries sku code/name, receivedAt and unplanned sku names')`: sku 줄 하나·자유 줄 하나·리스트에 없던 물건 하나로 확정 → `lines[sku].sku` 가 `{code, name}`, `lines[free].sku === null`, `counts` 의 리스트에 없던 물건이 `skuCode`·`skuName` 을 가짐, `receivedAt` 이 Date. 열린 상자는 `receivedAt === null`.
- [ ] **Step 2: 실패 확인** — 통합 스펙 FAIL.
- [ ] **Step 3: 구현** — `openBox` 의 줄 select 에 `skus` LEFT JOIN, counts select 에 `skus` LEFT JOIN, `box.receivedAt` 을 싣는다.
- [ ] **Step 4: 통과 확인 + Commit** — `[core] 상자 열기 응답에 SKU 이름·확정 시각을 싣는다 (#1239 #1341)`.

### Task 3: 찾기가 오늘 확정된 상자도 돌려준다

**Files:**
- Modify: `services/inbound-shipment.reader.ts` (`findBoxes` `:257`), `dto/receive.dto.ts` (`BoxCandidateViewDto`)
- Test: manager 통합 스펙(기존 `findBoxes` 스펙 옆)

**Interfaces:**
- Produces: `BoxCandidateViewDto.shipmentStatus: 'expected' | 'receiving' | 'closed'`.

- [ ] **Step 1: 통합 스펙** — `it('findBoxes returns a box received today in an auto-closed shipment')`: 상자 하나짜리 선적의 그 상자를 확정(선적 `closed`) → `findBoxes(warehouseId, 'l1')` 결과 1개, `shipmentStatus === 'closed'`, `status === 'received'`. `it('findBoxes skips closed shipments boxes received before today')`: 같은 상황에서 그 상자의 `received_at` 을 `now() - interval '1 day'` 로 직접 고친 뒤 → 0개. `it('findBoxes skips open boxes of a manually closed shipment')`.
- [ ] **Step 2: 실패 확인**.
- [ ] **Step 3: 구현** — where 를 `or(inArray(s.status, ['expected','receiving']), and(eq(s.status,'closed'), eq(b.status,'received'), sql\`(${b.receivedAt} AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date\`))` 로. 정렬은 그대로.
- [ ] **Step 4: 통과 확인 + Commit** — `[core] 상자 찾기가 저절로 끝난 선적의 오늘 확정 상자도 돌려준다 (#1239)`.

### Task 4: 저절로 끝난 선적에 리스트에 없는 상자 더하기 + 목록 요약

**Files:**
- Modify: `services/inbound-shipment-receiving.manager.ts` (`addBox` `:251`)
- Modify: `dto/receive.dto.ts` (`AddInboundShipmentBoxResultDto`), `dto/inbound-shipment-view.dto.ts` (`InboundShipmentSummaryDto`)
- Modify: `services/inbound-shipment.reader.ts` (`list`)
- Modify: `docs/superpowers/specs/2026-11-16-inbound-shipment-boxes-design.md` §8.7 — «저절로 끝난 선적에도 더할 수 있다(③ 설계 §7.6)» 한 줄
- Test: manager 통합 스펙 (기존 `a closed shipment refuses receive and addBox` 고침)

**Interfaces:**
- Produces: `AddInboundShipmentBoxResultDto.shipmentStatus: 'expected' | 'receiving' | 'closed'`. `InboundShipmentSummaryDto.closedAt: Date | null`, `closedManually: boolean`.

- [ ] **Step 1: 통합 스펙**
  - `it('addBox on an auto-closed shipment reopens it to receiving')` — 상자 확정으로 저절로 끝난 선적에 `addBox({label: 'L99'})` → `shipmentStatus === 'receiving'`, 선적 행 `closedAt === null`. 그 상자를 `unplanned` 로 확정 → 다시 `closed`.
  - 기존 `a closed shipment refuses receive and addBox` 를 **사람이 닫은 선적**(`close { reason }`)으로 한정하고 409 를 유지한다.
  - `it('list summary exposes closedAt and closedManually')` — 저절로 끝난 선적 `closedManually === false`, 사람이 닫은 선적 `true`, 열린 선적 `closedAt === null`.
- [ ] **Step 2: 실패 확인**.
- [ ] **Step 3: 구현** — `addBox` 조건: `isOpen(shipment.status) || (shipment.status === 'closed' && shipment.closedReason === null)`. 아니면 지금 409 문구에 «사람이 끝낸 선적은 다시 연 뒤에 더하세요» 를 붙인다. insert 뒤 `refreshInboundShipmentStatus(trx, shipmentId, shipment.status, actorId, new Date())` 로 상태를 다시 정하고(열린 상자가 생겼으니 `receiving`) 결과에 싣는다. `list` select 에 `closedAt`, `closedManually: sql<boolean>\`${s.closedReason} IS NOT NULL\``.
- [ ] **Step 4: 통과 확인 + Commit** — `[core] 저절로 끝난 선적에도 리스트에 없는 상자를 더해 다시 연다 (#1239)`.

### Task 5: 입고내역 줄에 선적 상자

**Files:**
- Modify: `apps/core/src/modules/inventory/inbound/services/inbound-receipt-state.reader.ts` (`ReceiptFactsRow` `:13`, `receiptFactsCtes` 의 `facts` `:68`)
- Modify: `apps/core/src/modules/inventory/inbound/dto/inbound-response.dto.ts` (`InboundReceiptHistoryLineDto` `:178`)
- Modify: `apps/core/src/modules/inventory/inbound/services/inbound.service.ts` (`listInboundReceipts` 매핑 `:229`)
- Test: inbound 이력의 기존 통합 스펙(`grep -rln "listInboundReceipts" apps/core --include=*.integration.spec.ts`), `inbound-kernel-boundary.arch.spec.ts` 는 그대로 초록이어야 한다

**Interfaces:**
- Produces: `InboundShipmentBoxRefDto { shipmentId: string; shipmentName: string; boxId: string; boxLabel: string }` (같은 dto 파일). `InboundReceiptHistoryLineDto.inboundShipmentBox: InboundShipmentBoxRefDto | null`.

- [ ] **Step 1: 통합 스펙** — `it('history line of a shipment box receipt links the box')`: 선적 상자를 확정 → `listInboundReceipts({ warehouseId })` 의 그 줄 `source === 'inbound_shipment'`, `inboundShipmentBox` 가 `{shipmentId, shipmentName, boxId, boxLabel}`. 직접 입고 줄은 `null`.
- [ ] **Step 2: 실패 확인**.
- [ ] **Step 3: 구현** — `facts` 에 `LEFT JOIN inbound_shipment_box_counts isbc ON isbc.receipt_line_id = irl.id LEFT JOIN inbound_shipment_boxes isb ON isb.id = isbc.box_id LEFT JOIN inbound_shipments ish ON ish.id = isb.shipment_id` 와 열 `"inboundShipmentId"`·`"inboundShipmentName"`·`"inboundShipmentBoxId"`·`"inboundShipmentBoxLabel"`. (`receipt_line_id` 는 unique 라 행이 늘지 않는다. SQL 테이블 이름만 쓰므로 `inbound-shipment/` 모듈을 import 하지 않는다 — arch 스펙 경계 그대로.) `ReceiptFactsRow` 에 네 필드(`string | null`). 매핑에서 넷이 다 있으면 객체, 아니면 `null`.
- [ ] **Step 4: 통과 확인** — 통합 스펙 + `npx jest --runTestsByPath apps/core/src/modules/inventory/inbound-kernel-boundary.arch.spec.ts` PASS.
- [ ] **Step 5: Commit** — `[core] 입고내역 줄이 선적 입고면 그 상자를 가리킨다 (#1239)`.

### Task 6: work-context 에 상자 입고 권한

**Files:**
- Modify: `apps/core/src/modules/inventory/core/controllers/warehouse-work-context.controller.ts` (`permissions` `:30`)
- Test: `apps/core/src/modules/inventory/core/controllers/warehouse-work-context.checkpoint.spec.ts`

**Interfaces:**
- Produces: work-context `permissions.inboundShipmentOperate: boolean` = `checkpoints.check('inventory.work_context', subject, ['inventory.stock.operate'])`.

- [ ] **Step 1: 스펙** — 체크포인트 스펙에 `it('inboundShipmentOperate follows inventory.stock.operate')`: operate 있는 역할 `true`, read 만 있는 역할 `false`.
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — `npx jest --runTestsByPath <그 스펙>`.
- [ ] **Step 3: core 게이트** — `npm run type-check` 0, `npx jest --maxWorkers=2 apps/core/src/modules/inventory` 실패 0, `npx jest --maxWorkers=2 libs/authorization scripts/security` 실패 0.
- [ ] **Step 4: Commit** — `[core] work-context 가 상자 입고 권한을 알린다 (#1239)`.

---

## warehouse-app

명령: `(cd native/warehouse-app && npx vitest run <파일>)`, 끝에 `(cd native/warehouse-app && npx tsc -b && npx vitest run && npm run lint)`.

### Task 7: 기존 입고 화면이 `inbound_shipment` 를 안다

**Files:**
- Modify: `native/warehouse-app/src/domains/inbound/types.ts` (`PutawayPendingItem.source` `:104`, `PutawayTarget.source` `:130`, `isActionablePutaway`)
- Modify: `native/warehouse-app/src/domains/inbound/receiptHistory.ts` (`:15`, 검사 `:128`), `receiptState.ts` (`:26`), `useReceiptReconciliation.ts` (`:21`)
- Modify: `native/warehouse-app/src/domains/inbound/InboundHistoryScreen.tsx` (취소 분기 `:113`, 줄 표시 `:265`)
- Test: `InboundHistoryScreen.test.tsx`, `receiptHistory.test.tsx`, `PutawayQueueScreen.test.tsx`, `receiptState.test.tsx`

**Interfaces:**
- Produces: `type ReceiptSource = 'direct' | 'purchase_order' | 'inbound_shipment'` (`types.ts` 에서 export, 세 파일이 쓴다). `ReceiptHistoryLine.inboundShipmentBox: { shipmentId: string; shipmentName: string; boxId: string; boxLabel: string } | null` (응답에 필드가 없으면 `null` — 옛 core).

- [ ] **Step 1: 테스트**
  - `receiptHistory.test.tsx`: `it('accepts inbound_shipment lines')` — 선적 입고 줄이 섞인 응답을 거부하지 않고, `inboundShipmentBox` 를 싣는다. `it('a line without inboundShipmentBox parses to null')`.
  - `InboundHistoryScreen.test.tsx`: `it('shipment receipt line shows box and no line cancel')` — «11월 2차 배편 · 상자 L7» 이 보이고 취소 버튼이 없다. 핸드헬드는 «스테이션에서 취소해요». (스테이션의 상자 화면 링크는 경로가 생기는 Task 10 이 단다 — 라우터 타입이 없는 경로의 `<Link>` 를 막는다.)
  - `PutawayQueueScreen.test.tsx`: `it('opens the putaway sheet for an inbound_shipment line')`.
- [ ] **Step 2: 실패 확인**.
- [ ] **Step 3: 구현** — 유니언을 `ReceiptSource` 로, 검사에 `'inbound_shipment'`, `isActionablePutaway` 에 갈래 추가. 내역 화면은 `source === 'inbound_shipment'` 면 줄 취소를 그리지 않는다(직접 입고 취소로 보내지 않는다).
- [ ] **Step 4: 통과 확인 + Commit** — `[warehouse-app] 입고내역·적치 대기가 선적 입고 줄을 안다 (#1239)`.

### Task 8: 선적 상자 API·재시도 배선·권한

**Files:**
- Create: `native/warehouse-app/src/domains/inbound-shipment/types.ts`, `api.ts`, `api.test.ts`
- Modify: `native/warehouse-app/src/core/operations/operationRunner.ts` (`ledgerPath` `:6`, `resource()` `:8`), `operationRunner.test.ts`
- Modify: `native/warehouse-app/src/core/operations/OperationContext.tsx` (`WorkPermissions`), work-context 응답을 읽는 곳(`usePermissionReader` 가 부르는 파서 — `grep -rn "shortPick" src/core`)

**Interfaces:**
- Produces (`types.ts`): `BoxCandidate`, `BoxView`, `BoxLine`, `BoxCount`, `ShipmentSummary` — core DTO(Task 1~4 로 넓힌 것)를 그대로 옮긴 타입. `ReceiveBoxBody = { counts: { lineId: string; countedQty: number; method: 'counted' | 'list' }[]; unplanned: { skuId: string; quantity: number }[] }`. 결과 `ReceiveBoxResult { boxId; receiptId: string | null; shipmentStatus; countIds: string[] }`, `CancelBoxReceiptResult { boxId; shipmentStatus; canceledCountIds: string[] }`, `AddBoxResult { boxId; label; shipmentStatus }`.
- Produces (`api.ts`, 전부 `api: ApiClient` 첫 인자):
  - `findBoxes(api, warehouseId, label): Promise<BoxCandidate[]>` — `GET /inventory/inbound-shipment-boxes?warehouseId=&label=` (label 은 친 그대로 `encodeURIComponent`).
  - `openBox(api, shipmentId, boxId): Promise<BoxView>`.
  - `listShipments(api, warehouseId, statuses: ('expected'|'receiving'|'closed')[]): Promise<ShipmentSummary[]>`.
  - `receiveBox(api, shipmentId, boxId, body: ReceiveBoxBody, idempotencyKey): Promise<ReceiveBoxResult>`.
  - `cancelBoxReceipt(api, shipmentId, boxId, idempotencyKey): Promise<CancelBoxReceiptResult>`.
  - `addBox(api, shipmentId, label, idempotencyKey): Promise<AddBoxResult>`.
  - `isUncertainWrite` 는 `domains/customer-returns/api.ts` 의 것을 재사용(옮기지 않는다).
- Produces: `WorkPermissions.inboundShipmentOperate?: boolean`.

- [ ] **Step 1: 테스트**
  - `operationRunner.test.ts`: `it('wraps inbound shipment box writes with contract v2')` — `/inventory/inbound-shipments/s1/boxes/b1/receive`, `…/receive/cancel`, `/inventory/inbound-shipments/s1/boxes` 세 POST 가 저장소에 들어가고 본문에 `contractVersion: 2`·`idempotencyKey` 가 붙는다. `resource()` 가 앞의 둘은 `inbound-shipment-box:b1`, 셋째는 `inbound-shipment:s1`.
  - `api.test.ts`: 각 함수의 경로·메서드·`idempotencyKey` 전달(가짜 `ApiClient`).
  - work-context 파서 스펙: `inboundShipmentOperate` 를 읽는다.
- [ ] **Step 2: 실패 확인 → 구현 → 통과**.
- [ ] **Step 3: Commit** — `[warehouse-app] 선적 상자 API 와 재시도 배선 (#1239)`.

### Task 9: 상자 초안 순수 함수 (`boxDraft.ts`)

화면이 판정하지 않게 모든 규칙을 여기에 둔다.

**Files:**
- Create: `native/warehouse-app/src/domains/inbound-shipment/boxDraft.ts`, `boxDraft.test.ts`

**Interfaces:**
- Consumes: Task 8 의 `BoxView`, `BoxLine`, `ReceiveBoxBody`.
- Produces:
  - `type CountMethod = 'counted' | 'list'`
  - `interface BoxDraft { boxId: string; key: string; cells: Record<string, { qty: number; method: CountMethod }>; unplanned: { skuId: string; skuCode: string; skuName: string; qty: number }[]; snapshot: Record<string, { kind: BoxLine['kind']; skuId: string | null; expectedQty: number | null }> }` — `snapshot` 은 초안을 만든 때의 줄.
  - `createBoxDraft(box: BoxView, key: string): BoxDraft`
  - `isRangeLine(line: BoxLine): boolean` — `coversBoxLabels.length > 1`
  - `canApplyList(line: BoxLine): boolean` — `kind !== 'unresolved' && !isRangeLine(line) && expectedQty !== null`
  - `setLineQty(draft, lineId, qty): BoxDraft` — `method: 'counted'`; `0 <= qty <= MAX_LINE_QTY` 밖이면 그대로 돌려준다(호출자가 오류음)
  - `applyList(draft, line): BoxDraft` — `canApplyList` 가 아니면 그대로
  - `applyScan(draft, box, sku: { id: string; code: string; name: string }, increment: number, currentLineId: string | null): { draft: BoxDraft; target: { kind: 'line'; lineId: string } | { kind: 'unplanned'; skuId: string } }` — 이 상자의 `sku` 줄 중 `skuId === sku.id` 가 있으면: 지금 줄이 그 SKU 면 지금 줄, 아니면 행 순서 첫 줄에 `+increment`(빈칸이면 `increment`), `method: 'counted'`. 없으면 리스트에 없던 물건에 `+increment`.
  - `setUnplannedQty(draft, skuId, qty): BoxDraft` — `0` 이면 그 줄을 지운다
  - `blankLineIds(draft, box): string[]` — 행 순서
  - `reconcileDraft(draft, box): { draft: BoxDraft; changedLineIds: string[] }` — 없어진 줄의 칸·snapshot 은 버린다; `kind`·`skuId` 가 바뀐 줄은 칸을 지운다(빈칸); `expectedQty` 만 바뀐 줄은 `method === 'list'` 일 때만 칸을 지운다(센 숫자는 남긴다); 새 줄은 빈칸. snapshot 을 지금 줄로 갱신. 바뀐 줄 id 를 행 순서로.
  - `confirmBlock(draft, box): null | { reason: 'blank'; lineIds: string[] } | { reason: 'empty_added_box' } | { reason: 'unresolved' } | { reason: 'not_stock_open' }` — `disposition !== 'stock' || status !== 'open'` → `not_stock_open`; `unresolved` 줄이 있으면 `unresolved`; 빈칸 → `blank`; `origin === 'added'` 이고 리스트에 없던 물건이 0개 → `empty_added_box`.
  - `toReceiveBody(draft, box): ReceiveBoxBody` — `counts` 는 `box.lines` 순서 전부, `unplanned` 는 초안 순서. `confirmBlock` 이 `null` 이 아니면 throw.
  - `reviewRows(draft, box): { kind: 'diff' | 'range' | 'unplanned'; label: string; expected: number | null; counted: number; rangeTotal?: number; elsewhere?: number }[]` — 단일 상자 줄 중 다른 것, 범위 줄 전부, 리스트에 없던 물건 전부.

- [ ] **Step 1: 테스트** (`boxDraft.test.ts`, 픽스처는 합성 `BoxView` 하나: 단일 sku 줄 2개(같은 SKU 하나 포함) · 범위 sku 줄 1개 · 자유 줄 1개)
  - `createBoxDraft` 는 칸이 전부 비어 있다; `blankLineIds` 가 네 줄 전부.
  - `setLineQty(…, 0)` 뒤 그 줄은 빈칸이 아니다(0 과 빈칸 구별).
  - `applyList` 는 단일 줄에 `{qty: expectedQty, method: 'list'}`, 범위 줄·리스트에 없던 물건엔 아무것도 안 한다.
  - `applyScan`: 같은 SKU 줄이 둘일 때 지금 줄이 둘째면 둘째에, 지금 줄이 다른 줄이면 첫째에; `list` 칸에 스캔하면 `counted` 로 바뀌고 `+increment`; 상자에 없는 SKU 는 `unplanned` 로, 두 번이면 `qty` 가 2배.
  - `setUnplannedQty(…, 0)` 은 줄을 지운다.
  - `reconcileDraft`: (a) 예정 40→50 으로 바뀐 `list` 칸은 빈칸, `changedLineIds` 에 그 줄; (b) 같은 변화에 `counted` 38 칸은 38 유지·`changedLineIds` 에 없음; (c) SKU 가 바뀐 줄은 빈칸; (d) 사라진 줄의 칸은 없어짐; (e) 아무 변화 없으면 `changedLineIds` 빈 배열.
  - `confirmBlock`: 빈칸 → `blank`; 리스트에 없던 물건 없는 `added` 상자 → `empty_added_box`; 전달용 → `not_stock_open`.
  - `toReceiveBody`: 줄 순서·`method`·`unplanned` 를 그대로; 빈칸이 있으면 throw.
  - `reviewRows`: 리스트와 같은 단일 줄은 안 나오고, 범위 줄은 늘 나온다.
- [ ] **Step 2: 실패 확인 → 구현 → 통과**.
- [ ] **Step 3: Commit** — `[warehouse-app] 상자 초안 규칙 — 빈칸·리스트대로·스캔·리스트 고침 맞추기 (#1239)`.

### Task 10: 스테이션 상자 화면 골격 — 경로·입구·대기·고르기

**Files:**
- Create: `native/warehouse-app/src/app/routes/InboundBoxesRoute.tsx` — `isStationDevice()` 면 `<InboundBoxesScreen />`, 아니면 `<PlaceholderScreen title="선적 상자" note="스테이션에서 하는 작업이에요" />` (선례 `CustomerReturnsRoute.tsx`)
- Modify: `native/warehouse-app/src/app/routeTree.tsx` — `/inbound/boxes` (`validateSearch`: 선택 `shipmentId`·`boxId` 문자열 — 입고내역 링크가 바로 연다)
- Modify: `native/warehouse-app/src/domains/inbound/ExpectedArrivalListScreen.tsx` — 스테이션에서만 «선적 상자 입고» 링크(`/inbound/boxes`)
- Create: `native/warehouse-app/src/station/inbound/InboundBoxesScreen.tsx` (상태 기계·창고 고르기 — `ReturnsScreen.tsx` 결), `BoxFinder.tsx` (대기·고르기), `inboundBoxActions.ts` (액션 id·키·라벨 표), `inboundBoxTypes.ts`
- Test: `src/station/inbound/InboundBoxesScreen.test.tsx`, `src/app/router.test.tsx`(경로), `ExpectedArrivalListScreen.test.tsx`

**Interfaces:**
- Produces: `type InboundBoxesView = { kind: 'waiting' } | { kind: 'choose'; label: string; candidates: BoxCandidate[] } | { kind: 'chooseShipmentForAdd'; label: string; shipments: ShipmentSummary[] } | { kind: 'work'; box: BoxView } | { kind: 'received'; box: BoxView } | { kind: 'forward'; box: BoxView } | { kind: 'done'; box: BoxView; result: ReceiveBoxResult }`. `InboundBoxesScreen` 이 `open(shipmentId, boxId)` 로 `openBox` 를 읽어 `disposition`·`status` 에 따라 `work`·`received`·`forward` 로 간다. 맨 위 줄 컴포넌트 `BoxHeader({ box })` — «{shipmentName} · 상자 {label} · {expectedArrival} 도착»(`closed` 면 «끝남» 표시).
- Produces: `addableShipments(shipments: ShipmentSummary[], now: Date): ShipmentSummary[]` (`inboundBoxTypes.ts` 또는 `boxDraft.ts` 옆 순수 함수) — `expected`·`receiving` 전부 + `closed && !closedManually && closedAt` 이 30일 안.

- [ ] **Step 1: 테스트** (`InboundBoxesScreen.test.tsx`, 가짜 `ApiClient`·`isStationDevice` 목, 기존 스테이션 테스트의 Provider 묶음을 쓴다)
  - 대기에서 `l7` 을 치고 Enter → `findBoxes` 가 `label=l7` 로 불린다(화면이 정규화하지 않는다).
  - 후보 1개 → 바로 열림(헤더에 선적 이름).
  - 후보 2개 → 고르기: 두 후보의 선적 이름·도착일·`previewItems` 가 보이고, **Enter 만 눌러서는 열리지 않는다**; `2` 를 누르면 둘째가 열린다.
  - 후보 0개 → «이 이름의 상자가 열린 선적에 없어요», 기능키 바에 F12 가 보인다(권한 있을 때). `inboundShipmentOperate: false` 면 F12 가 없다.
  - 전달용 후보 → `BigPanel` 에 비고, 기능키 없음.
  - 서버 400(범위 표기) 문구를 그대로 띄운다.
  - `addableShipments`: 31일 전에 끝난 선적·사람이 닫은 선적은 빠진다.
  - 라우터: 핸드헬드에서 `/inbound/boxes` 는 «스테이션에서 하는 작업이에요».
  - 입고 화면: 스테이션에서만 «선적 상자 입고» 링크.
  - 입고내역의 선적 입고 줄(Task 7)이 스테이션에서 `/inbound/boxes?shipmentId=&boxId=` 링크가 되고, 그 경로로 들어오면 대기를 건너뛰고 그 상자가 바로 열린다(`InboundHistoryScreen.tsx` 도 이 Task 에서 고친다).
- [ ] **Step 2: 실패 확인 → 구현 → 통과**. «열린 선적» 안내 목록은 `listShipments(api, warehouseId, ['expected','receiving'])` 의 이름·도착 예정일·상자 수.
- [ ] **Step 3: Commit** — `[warehouse-app] 스테이션 선적 상자 화면 — 찾기·고르기 (#1239)`.

### Task 11: 상자 작업 — 그리드·스캔·리스트대로·확정

**Files:**
- Create: `native/warehouse-app/src/station/inbound/BoxWork.tsx`, `BoxReview.tsx`
- Test: `native/warehouse-app/src/station/inbound/BoxWork.test.tsx`

**Interfaces:**
- Consumes: Task 9 전부, Task 8 `receiveBox`·`openBox`·`isUncertainWrite`, `useWorkDraft<BoxDraft | null>(\`inbound-box:${boxId}\`, null)`, `useSkuByBarcode`·`scanIncrement`(`domains/inbound/packingUnit.ts`), `SkuPicker`(`domains/inventory/SkuPicker.tsx`), `useStationActions`·`useDigitCommands`·`useFeedback`·`WorkGrid`(`station/outbound/panels.tsx`), `useHumanKeys`·`useScanner`.
- Produces: `BoxWork({ box, onDone(result: ReceiveBoxResult), onReopen(notice?: string), onBack() })`.

- [ ] **Step 1: 테스트** (`BoxWork.test.tsx`)
  - 처음엔 모든 칸이 빈칸이고 F10 → 오류음 + «빈칸 4줄», 커서가 첫 빈칸으로.
  - 숫자 `3`,`8` → 지금 줄 38(덮어쓰기 후 이어 치기), Enter 다음 줄, ↑↓ 이동, Esc 그 칸 되돌림.
  - `0` 을 넣은 칸과 빈칸은 다른 모양(접근성 이름이나 `data-state="blank|counted|list"`).
  - F8: 단일 줄에 예정 수량 + 리스트대로 표시; 범위 줄로 커서를 옮기면 기능키 바에 F8 이 없다.
  - 상품 바코드 스캔 → `GET /inventory/skus?barcode=` 뒤 그 줄 +입수(입수 6 인 바코드면 +6); 상자에 없는 SKU → «리스트에 없던 물건» 줄 + 주의음; 모르는 바코드 → 오류음 + «등록되지 않은 바코드예요».
  - F9 → SKU 검색에서 고르면 리스트에 없던 물건 줄이 생긴다.
  - 빈칸이 없으면 F10 → 확인 화면(다른 줄·범위 줄·리스트에 없던 물건), 다시 F10 → `receiveBox` 가 `counts` 를 `lines` 순서 전부 + `method` 로, 초안의 `key` 로 부른다. 성공 → `onDone`, 초안 지움.
  - **확정 직전 다시 읽기**: 두 번째 F10 에서 `openBox` 를 다시 읽고, 예정 수량이 바뀐 `list` 칸이 있으면 보내지 않고 작업 화면으로 돌아와 «관리자가 리스트를 고쳤어요 — 1줄 다시 확인».
  - **uncertain 뒤 재전송은 같은 키**: 첫 `receiveBox` 가 네트워크 오류 → 칸이 잠기고(숫자 → 오류음) «결과를 확인하지 못했어요 — F10 다시 보내기»; F10 → 같은 키·같은 본문으로 다시. 화면을 다시 마운트(앱 재시작 흉내)해도 초안의 키·수량이 남아 있다.
  - 4xx 거절 → 수량은 남고 새 키로 바뀐다(다음 전송의 키가 다르다).
  - 409(다른 곳에서 확정) → «다른 곳에서 이미 확정했어요» 후 `onReopen`(확정된 상자 화면으로).
  - 다시 열 때 `reconcileDraft` 가 바꾼 줄이 있으면 같은 안내.
- [ ] **Step 2: 실패 확인 → 구현 → 통과**. 초안은 열 때 `draft.value ?? createBoxDraft(box, crypto.randomUUID())` 를 저장하고 `reconcileDraft` 결과를 저장한다. 보내는 중·uncertain 동안 입력은 잠근다(반품 `InspectReturn.tsx` 의 `locked`/`inFlight` 결).
- [ ] **Step 3: Commit** — `[warehouse-app] 상자 작업 — 센 수량·리스트대로·스캔·확정 (#1239)`.

### Task 12: 끝·확정된 상자·확정 취소·리스트에 없는 상자

**Files:**
- Create: `native/warehouse-app/src/station/inbound/ReceivedBox.tsx`, `AddBoxFlow.tsx`(또는 `BoxFinder.tsx` 안 상태)
- Modify: `InboundBoxesScreen.tsx` (`done`·`received`·`chooseShipmentForAdd`)
- Test: `native/warehouse-app/src/station/inbound/ReceivedBox.test.tsx`, `InboundBoxesScreen.test.tsx`

**Interfaces:**
- Consumes: Task 8 `cancelBoxReceipt`·`addBox`, `addableShipments`, `useWorkDraft<string | null>(\`inbound-box-cancel:${boxId}:${firstCountId}\`, null)`(취소 키), `useWorkDraft<string | null>(\`inbound-box-add:${shipmentId}:${typedLabel}\`, null)`(상자 더하기 키).
- Produces: `ReceivedBox({ box, onCanceled(next: BoxView), onBack() })`.

- [ ] **Step 1: 테스트**
  - 끝: 완료음 + «L7 확정 — 적치 대기로 갔어요», `shipmentStatus === 'closed'` 면 «이 선적의 상자를 다 받았어요»; 다음 이름을 치기 전까지 F11 이 보이고, 치기 시작하면 사라진다.
  - 확정된 상자: 줄별 센 수량과 «리스트대로» 표시, 리스트에 없던 물건 이름(`skuName`); F11 한 번 → «한 번 더 누르면 취소», 두 번 → `cancelBoxReceipt`. 성공하면 상자가 작업 화면으로 다시 열리고 **칸이 전부 빈칸**.
  - 서버 거절(당일 아님·적치 시작) 문구를 그대로.
  - **취소 키는 집계 id**: `receiptId: null` 인 상자(0·자유 줄만)를 확정(countIds `[c1]`)→취소→재확정(countIds `[c2]`)→취소 하면 두 취소의 `idempotencyKey` 가 다르다.
  - 저절로 끝난 선적의 오늘 확정 상자도 찾기로 열려 F11 이 된다(후보 `shipmentStatus: 'closed'`).
  - `inboundShipmentOperate: false` → F11·F10·F8·F9·F12 없음.
  - 리스트에 없는 상자: 0개 결과에서 F12 → 선적 고르기(선적이 하나여도 고르기 단계가 있다, «끝남» 표시) → `addBox` → 받은 `boxId` 로 작업 화면(줄 0개); 리스트에 없던 물건 없이 F10 → «리스트에 없던 물건을 하나 이상 넣어 주세요». 같은 선적·같은 이름으로 다시 F12 하면 같은 키.
- [ ] **Step 2: 실패 확인 → 구현 → 통과**.
- [ ] **Step 3: 앱 게이트** — `(cd native/warehouse-app && npx tsc -b && npx vitest run && npm run lint)` → tsc 0, vitest 실패 0, oxlint 오류 0(경고 수는 develop 기준선 이하).
- [ ] **Step 4: Commit** — `[warehouse-app] 확정된 상자·당일 취소·리스트에 없는 상자 (#1239)`.

---

## admin-web

### Task 13: source 유니언 + 상자 서랍 (#1341)

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/inventory.ts:480` — `source` 에 `'inbound_shipment'`; 그 source 로 라벨·분기를 그리는 곳(`grep -rn "purchase_order'" apps/admin-web/src --include=*.tsx`)에 «선적 입고»
- Modify: `apps/admin-web/src/lib/types/dto/inbound-shipment.ts` — `InboundShipmentBoxView`(core `BoxViewDto` 그대로, Task 1·2 필드 포함), `InboundShipmentSummary` 에 `closedAt`·`closedManually`
- Modify: `apps/admin-web/src/lib/api/domains/inventory/inbound-shipments.client.ts` — `getBox(id, boxId): Promise<InboundShipmentBoxView>`
- Modify: `apps/admin-web/src/lib/services/inventory/query-keys.ts` — `inboundShipmentBox: (id, boxId) => ['inbound-shipments', 'detail', id, 'box', boxId] as const` (상세 키 아래라 상세 무효화가 함께 무효화한다); `inbound-shipment-queries.ts` 에 `useInboundShipmentBox(id, boxId | undefined)`
- Create: `apps/admin-web/src/features/inventory/inbound-shipments/lib/box-drawer.ts`, `box-drawer.spec.ts`
- Create: `apps/admin-web/src/features/inventory/inbound-shipments/components/shipment-detail/box-drawer.tsx` (`line-drawer.tsx` 와 같은 `Sheet`)
- Modify: `.../shipment-detail/boxes-tab.tsx` — 확정 뒤 상세에서 행마다 «열기» 버튼(이름·처분 칸의 인라인 편집과 겹치지 않게 버튼으로)

**Interfaces:**
- Produces: `boxDrawerRows(box: InboundShipmentBoxView): { header: { title: string; state: 'open' | 'received' | 'forward'; receivedAt: string | null }; lines: { lineId: string; product: string; sku: string | null; expected: string; counted: number | null; method: 'counted' | 'list' | null }[]; unplanned: { skuCode: string; skuName: string; counted: number }[]; forwardNote: string | null }` — `expected` 는 단일 줄이면 예정 수량 문자열, 범위 줄이면 `L5~L9 합계 1,076`; 열린 상자는 `counted`·`method` 가 `null`; 전달용은 `lines`·`unplanned` 빈 배열.

- [ ] **Step 1: 스펙** (`box-drawer.spec.ts`, `fixtures.spec-helper.ts` 결의 합성 값)
  - 확정된 상자: 줄별 `counted`·`method`, 범위 줄 `expected === 'L5~L9 합계 1,076'`, 리스트에 없던 물건 이름.
  - 열린 상자: `counted`·`method` 가 `null`, `state === 'open'`.
  - 전달용: `forwardNote` 만, `state === 'forward'`.
- [ ] **Step 2: 실패 확인** — `npm run test:admin-web -- box-drawer` FAIL.
- [ ] **Step 3: 구현** — 서랍은 `boxDrawerRows` 결과를 그리기만 한다. 쓰기 동작 없음. «리스트대로»는 칸 옆 작은 표시.
- [ ] **Step 4: 통과 + 게이트** — `npm run test:admin-web` 실패 0, `(cd apps/admin-web && npx tsc --noEmit)` 0(루트 CI 는 admin-web tsc 를 안 돈다), `npx jest --maxWorkers=2 apps/admin-web/src/lib/auth` 초록(screen-access·mutation-guard 게이트 — 새 뮤테이션 없음).
- [ ] **Step 5: Commit** — `[admin-web] 선적 상세 상자 탭에서 상자를 연다·선적 입고 source (#1341 #1239)`.

---

## 마무리

### Task 14: 전체 게이트·스테이션 실기 체크리스트·PR

**Files:**
- Modify: `docs/superpowers/specs/2026-11-16-inbound-shipment-station-box-receiving-design.md` — 실행 중 바뀐 것은 «(실행 중 결정)» 으로
- Create: `docs/superpowers/plans/2026-11-16-inbound-shipment-station-box-receiving-checklist.md` — 스펙 §12 «사람 검증»을 항목으로(Windows 스테이션: 숫자·스캔·F8·F9·F10 두 번·F11·F12·앱 재시작 중 uncertain·폰 안내)

- [ ] **Step 1** — `npm run type-check` 0, `npx jest --maxWorkers=2` 실패 0(로컬 E2E 스택을 내린 상태에서).
- [ ] **Step 2** — 앱 게이트(Task 12 Step 3)와 admin-web 게이트(Task 13 Step 4) 다시.
- [ ] **Step 3** — core 통합: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- apps/core/src/modules/inventory/inbound` 와 `…/inbound-shipment` 실패 0.
- [ ] **Step 4** — 체크리스트 커밋, PR 본문(mattpocock-skills:pr)에 배포 순서: 같은 배치 ①·②·③, 마이그 둘 다 expand(migrate → deploy), core → admin-web → warehouse-app, **첫 상자 확정 전에 스테이션이 새 앱인지 확인**(옛 앱의 입고내역은 선적 입고 한 건부터 안 뜬다), 배포 전 `npm run deploy:preflight -- --stage live`.
