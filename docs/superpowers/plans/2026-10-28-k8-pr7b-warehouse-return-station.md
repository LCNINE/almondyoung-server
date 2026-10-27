# K8 PR 7b — 창고 반품 도착·검수 화면(스테이션 F7) + 검수자 id Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 창고 작업자가 warehouse-app 스테이션의 F7 «반품» 탭에서 돌아온 소포를 «도착 대기 목록 + 검색»으로 찾고, 상품을 찍어 도착을 확정하고, 양품·불량·보류를 나눠 검수를 확정한다. 검수한 사람을 기록에 남긴다.

**Architecture:** ① core 에 창고용 읽기 라우트 둘(도착 대기 목록·상세)을 새 컨트롤러로 둔다 — 작업자는 `order.claim.read` 가 없고, 목록은 창고별·고객명 가림이 필요하다. 쓰기는 PR 6 의 `POST admin/customer-returns/:id/arrivals|inspection` 을 그대로 부른다. ② 상세 뷰에 SKU 바코드와 검수자를 더한다(검수자는 마이그 하나). ③ warehouse-app 은 판정(소포 세기·검수 칸·화면 단계)을 `src/domains/customer-returns/*.ts` 순수 함수로 두고 vitest 로 검증하고, 스테이션 화면(`src/station/returns/`)은 F1 출고 검수의 부품(레지스트리·사람 키·피드백)으로 배선한다.

**Tech Stack:** NestJS + Drizzle(core, `@app/authorization`), Tauri + React + TanStack Query/Router(warehouse-app), Jest(core unit·`describeIfDb` 통합), Vitest + Testing Library(warehouse-app).

**Spec:** `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md` — §4.8(화면 — «PR 7 에서 확정한 결과»의 창고 화면 줄), §4.3(도착·검수 규칙, «PR 6 / 6b 에서 확정한 결과» N4·N5·N7·N8·(f)), §8 PR 7b. 스테이션 규칙은 `docs/superpowers/specs/2026-10-02-warehouse-station-ui-design.md`(§4 탭, §5 셸·레지스트리·명령 바코드·피드백, §8 입력 그리드).

## PR 1~7 본문이 넘긴 것 (이 PR 이 닫는다 / 넘긴다)

| 출처 | 넘긴 것 | 여기서 |
| --- | --- | --- |
| PR 6 #1157 (f) · PR 7 #1159 | 검수자 id 미저장 — «창고 화면과 함께» | `customer_returns.inspected_by` — Task 1 |
| PR 6 #1157 | 도착·검수 라우트 «창고(PR 7 화면)» | 스테이션이 부른다 — Task 5·6 |
| PR 7 #1159 | 창고 화면은 스테이션 F7, 소포는 한진 회수(PR 9) 전까지 «도착 대기 목록 + 검색» | Task 2·4 |
| PR 4 #1155 | `return_default` 가 RETURNED·DEFECTIVE 섞인 칸 | 그대로(PR 6 이 실사·역분개를 막았다). 이 화면은 위치를 묻지 않는다 — 원장 메서드가 `return_default` 고정 |
| PR 6b #1158 | 닫은 뒤 늦게 온 소포는 거절, 일부 구성품만 온 세트는 닫지도 취소하지도 못함 | 화면은 서버 거절을 그대로 보인다(N10). 시스템 밖(CS) |
| PR 6b Q1 | 선환불 뒤 끝내 미도착이면? | **열린 채로 둔다** — 창고 화면과 무관(목록에 «도착 대기»로 남을 뿐) |

## 코드에서 확인한 것 (develop `59247bbbc`)

- **쓰기 라우트(PR 6).** `customer-returns.controller.ts`: `POST admin/customer-returns/:id/arrivals` 본문 `{ warehouseId, items: [{ customerReturnItemId, quantity ≥ 1 }], idempotencyKey ≤ 128자 }`, `POST …/:id/inspection` 본문 `{ items: [{ customerReturnItemId, accepted, rejected, held }] }`(모든 항목 한 번씩, 합 = 도착). 둘 다 `@RequirePermission('inventory.stock.operate')` + `ScopeGuard`/`INVENTORY_SCOPE.OPERATE`, 응답은 `CustomerReturnView`. 읽기 `GET …` 과 `GET …/:id` 는 `order.claim.read` — 권한 카탈로그상 `ADMIN_INTERN` 만 받는다(`permission-catalog.ts:143`). `inventory.stock.operate` 는 `admin` + `LOGISTICS`(`:243`).
- **도착 규칙**(`customer-return-receiving.manager.ts`): `expected`·`arrived` 만, 키마다 `<key>:<itemId>` 행이 멱등(같은 키·다른 수량 409), 합 > 기대면 400, 받는 창고는 첫 도착이 정하고 그 주문을 배송완료한 창고여야 한다(`deliveredParcelsSql` × `shipments.warehouse_id`), 미도착으로 닫힌 반품은 새 키 409(«미도착으로 닫은 반품입니다»). 첫 도착이 `expected → arrived` + `collected` 이벤트.
- **검수 규칙:** 닫히지 않았으면 모든 항목이 기대만큼 와야 한다(«아직 도착하지 않은 수량이 있습니다» 400), 합 = 도착, 이미 검수한 반품은 같은 결과면 그대로·다르면 409. 보류가 있으면 `held`, 없으면 `inspected` + `SettleChannelReturn`. `actorId` 를 받지만 **저장하지 않는다**. 전이는 `transitionCustomerReturn`(`set` 허용 칸 목록이 타입으로 박혀 있다).
- **뷰**(`customer-return.reader.ts` `findById`): 줄 `productName`·`quantity`·`missingQty`, 항목 `skuName`·`skuCode`·`qtyPerUnit`·`expectedQty`·`arrivedQty`·검수 세 칸, `csResolution.missing`. 바코드 없음. 항목은 `(line, sku)` 유일이라 **같은 SKU 가 두 줄에 나올 수 있다**.
- **바코드:** `sku_barcodes(sku_id, barcode unique, is_primary, packing_unit)`. 라이브 `packing_unit` 은 전부 NULL. 라이브 바코드 일부가 `="…"` 로 감싸져 스캔이 안 맞는다(SKU 498개) — 손 입력 길이 필요하다.
- **가린 이름의 본보기:** `maskName`(`fulfillment/reader/recipient-snapshot.ts:11`) → `waybill-label-states` 의 `recipientMasked`. 그 라우트는 `scripts/security/pii-routes.ts` 에 없다(원문이 아니라서).
- **스테이션 셸:** 탭은 `src/station/tabs.ts` `STATION_TABS`(F1~F6)·`keys.ts` `TAB_KEYS`. 레지스트리는 «안쪽(화면)이 이긴다»(`actions.ts` `resolveActions`). **F7 은 F1 검수 중 «수량»**(`outbound/inspectionActions.ts:8`). 기능키 바는 `StationShell.tsx:169` `<FunctionKeyBar omit={TAB_KEY_SET} />` 로 **탭 키 전부를 뺀다** — F7 을 탭 키에 그냥 넣으면 검수 중 «F7 수량»이 바에서 사라진다. 명령 시트 절은 `commandSheet.ts` `COMMAND_SHEET_SECTIONS`.
- **입력:** `ScanProvider` 는 입력칸 포커스·IME 조합 중 스캔을 버린다. 사람 키는 `useHumanKeys`(`HUMAN_CONTROL_KEYS` = Enter·Backspace·ArrowUp·ArrowDown·Escape — ←→ 없음), 숫자 명령은 `useDigitCommands`. 직접 입력칸 본보기 `ManualWaybillInput`(`outbound/panels.tsx:313`). 소리 `useFeedback().signal(kind)`.
- **앱 경로:** core 라우트를 접두어 없이 부른다(`/inventory/…`, `/shipments/…`) → 이 PR 은 `/admin/customer-return-receiving…`·`/admin/customer-returns/:id/…`. 프로필별 화면은 라우트 래퍼가 고른다(`OutboundBatchesRoute.tsx` — `isStationDevice()`). 스테이션 테스트 하네스는 `src/station/outbound/__fixtures__/{renderStation.tsx,outboundServer.ts}`.
- **dev 시드:** `scripts/local/seed-dev-core/index.ts` 가 한 트랜잭션에서 시나리오를 쌓는다. 배송완료 소포가 있는 주문은 `line-quantities/__support__/claim-facts.fixtures.ts` `seedDeliveredLine` 이 만들고, 반품 기록은 `CustomerReturnManager.recordRequested` 가 만든다(`customer-return-receiving.manager.integration.spec.ts:60-130` 이 그 꼴). 시드 상품 바코드 `8809990000001…8`(`docs/local-dev.md` §출고 시나리오).

## 이름 붙은 결정

- **N1. 자리는 스테이션 7번째 탭 F7 «반품».** 경로 `/customer-returns`(`/returns/putaway` 는 피킹 되돌림 — 이름을 겹치지 않는다). F7 은 F1 검수 중 «수량»과 같은 키다 — 레지스트리가 안쪽을 이기게 두므로 **검수 중 F7 = 수량, 그 밖에선 반품 탭**이다. 기능키 바는 «셸의 탭 액션(id 가 `tab-` 로 시작)»만 빼도록 바꾼다(키로 빼지 않는다). 대안(F3 입고의 하위 탭)은 고르지 않았다 — 반품은 발주와 흐름·문이 달라 입고 화면 안에 둘 이유가 없다. 핸드헬드엔 탭이 없고, 경로로 들어오면 `PlaceholderScreen`(«스테이션에서 하는 작업이에요»).
- **N2. 창고 읽기 라우트 둘, 새 컨트롤러 `CustomerReturnReceivingController`(`@Controller('admin/customer-return-receiving')`).** 둘 다 `@RequirePermission('inventory.stock.operate')` + `@UseGuards(ScopeGuard)` + `@RequireScopes(INVENTORY_SCOPE.OPERATE)` — 도착·검수 쓰기와 같은 문이다(읽기만 되는 사람에게 이 화면은 쓸모가 없다). 새 권한 키 없음.
  - `GET /` 쿼리 `warehouseId`(uuid, 필수), `q?`(≤64), `barcode?`(≤64), `limit` 1~100(기본 100) → `{ items: CustomerReturnReceivingItem[], total }`.
  - `GET /:id` → `CustomerReturnView`(`service.findById` 그대로). 새 컨트롤러라 기존 `GET admin/customer-returns/:id`(ParseUUIDPipe)와 경로 순서를 다툴 일이 없다.
- **N3. 도착 대기 목록의 범위·단계·정렬.** 상태 `expected`·`arrived` 만. `arrived` 는 `warehouse_id = W` 인 것, `expected` 는 그 판매주문을 W 가 배송완료한 것(`deliveredParcelsSql` 의 shipment × `shipments.warehouse_id = W` — 도착 검증 `assertReceivingWarehouse` 와 같은 술어). 단계 `stage`: `expected` → `'awaiting'`, `arrived` 이고 (도착 합 = 기대 합 또는 `cs_resolution.missing` 있음) → `'ready'`(검수 대기), 그 밖의 `arrived` → `'partial'`(덜 옴). 정렬 `ready → partial → awaiting`, 그다음 `requested_at` 이른 순, `id`. `q` 는 PR 7 목록과 같은 술어(주문번호·채널 주문 id 정확 일치, 고객명 부분 일치, LIKE 메타문자 문자 그대로). `barcode` 는 «그 바코드를 가진 SKU 의 항목이 있는 반품»(`sku_barcodes.barcode = barcode` 정확 일치).
- **N4. 고객명은 가려서 싣는다.** 행 `customerMasked = maskName(customer_name ?? '')`. 원문이 아니므로 `@PiiResponse`·`pii-routes.ts` 대상이 아니다(`recipientMasked` 와 같은 꼴). 검색은 원문 부분 일치로 된다(PR 7 목록과 같다 — 소포의 보낸 사람 이름으로 찾는 것이 이 화면의 쓰임이다).
- **N5. 상품 스캔.** 뷰 항목에 `barcodes: string[]`(주 바코드 먼저, 그다음 바코드 오름차순). 소포 세기 화면에서 스캔 = **그 바코드를 가진 항목 중 «남은 수량(기대 − 이미 도착 − 이번 소포)» 이 있는 첫 항목**(줄 순서 → 항목 순서)에 +1, 그 줄을 선택. 남은 항목이 없으면 오류음 «더 받을 수 없어요», 바코드가 없으면 «이 반품에 없는 상품이에요». 포장단위는 무시한다(반품은 낱개로 온다 — 1 로 센다). 목록 화면에서 스캔 = `barcode` 필터, 결과가 정확히 하나면 바로 연다.
- **N6. 소포 키와 결과를 모르는 도착.** 소포 세기 화면을 열 때 `crypto.randomUUID()` 를 한 번 만든다. 응답이 없거나 5xx 면 수량을 잠그고(바꾸면 같은 키·다른 수량 409) F10 이 같은 키·같은 본문으로 다시 보낸다 — F1 결품 재전송과 같은 메모리 보관. 이미 도착이 있는 반품(어느 항목이든 `arrivedQty > 0`)은 F10 을 두 번 눌러야 보낸다(«이미 받은 소포가 있어요 — 새 소포면 F10»). 결과를 모른 채 앱을 다시 켠 작업자가 같은 소포를 두 번 세는 일을 막는 유일한 장치다.
- **N7. 검수 칸은 불량·보류 둘만 입력한다.** 양품 = 도착 − 불량 − 보류(파생, 입력 아님). 불량 + 보류 > 도착이면 그 입력을 거절(오류음). 기본은 전부 양품. 검수 확정 F10 은 **두 번**(되돌릴 수 없다: 원장 이동 + 환불 요청). 두 번째 누르기 전 문구 — 보류 0: «한 번 더 누르면 환불을 요청해요», 보류 > 0: «한 번 더 누르면 CS 확인으로 넘겨요».
- **N8. 흐름.** 목록 → (열기) → 단계 판정(`receivingStageOf`): `expected`·덜 온 `arrived` 는 소포 세기, 다 왔거나 닫힌 `arrived` 는 검수, 그 밖은 «끝난 반품» 안내 뒤 목록. 도착 확정 뒤 응답 뷰가 다 왔으면 곧장 검수, 덜 왔으면 «남은 물건은 CS 가 정해요» 뒤 목록. 검수 확정 뒤 완료 소리 + 목록.
- **N9. 검수자 id.** `customer_returns.inspected_by varchar(255)` nullable(도착 `arrived_by` 와 같은 꼴). 처음 검수(`arrived → inspected|held`) 때만 `actorId` 를 쓴다 — 같은 결과 재요청은 건드리지 않는다. 뷰 `inspectedBy: string | null`. 화면엔 보이지 않는다(작업자 이름의 출처가 없다 — 스테이션 PR B 의 «작업자 이름 미표시»와 같다). expand, `migrate → deploy`.
- **N10. 서버 거절(4xx)은 상세를 다시 읽어 그 단계의 화면으로 간다.** 문구는 `errorMessage(e)` 를 한 줄로. 취소된 반품(`cancelled`)이면 «취소된 반품이에요» 뒤 목록. 화면이 미리 거르는 것(수량 상한·합)은 서버까지 가지 않는다.
- **N11. dev 시드 반품 시나리오 셋**(Task 7) — 스모크가 Medusa 없이 이 화면의 모든 길을 밟게.

## Global Constraints

- 사는 곳: `apps/core`(읽기 라우트·뷰 칸·검수자 칸 — **마이그 하나**), `native/warehouse-app`, `scripts/local/seed-dev-core`, 문서(설계 §4.3·§4.8·§8, `docs/local-dev.md`).
- core 레이어: 컨트롤러 → `CustomerReturnService`(위임만) → reader/manager. `dbService.run(fn, tx)`, 공개 메서드 마지막 인자 `tx?: DbTx`, `db.query.*`·`any`·`as` 금지, 오류는 `@app/shared`. 조인 없는 select 의 상관 서브쿼리 금지 — 합은 group by 로 따로 읽는다(`customer-return.reader.ts` `itemsOf` 주석).
- 마이그: `schema.ts` 를 고친 뒤 `npm run db:generate:core -- --name add-customer-return-inspected-by`, 생성 SQL 은 `ADD COLUMN` 하나여야 한다. `schema.ts` + SQL + `drizzle/meta` 는 한 커밋.
- warehouse-app: 판정은 `src/domains/customer-returns/*.ts`(React 없음), 화면은 `src/station/returns/`. core 응답 타입은 `src/domains/customer-returns/types.ts` 에 손으로 미러한다(쓰는 칸만). TanStack 쿼리 키에 `undefined` 를 넣지 않는다(빈 문자열로). 키 선언은 상태별로, 한 층 안에서 같은 키 두 번 금지(`assertUniqueKeys`).
- 화면 문구: 필요한 것만, 정상은 숨긴다([[ui-minimal-text]]). 현장 문구에 «라벨» 대신 «송장». 위치·상품 칸은 스캔과 키보드 입력을 모두 받는다(스테이션 §8).
- 게이트:
  - `npm run type-check` 0. `npx jest apps/core/src/modules/sales-order scripts/security libs/authorization` 실패 0(통합은 skip).
  - core 통합: scratch DB 에 `DATABASE_URL` 주입, `npx jest apps/core/src/modules/sales-order/customer-return --runInBand`.
  - warehouse-app: `(cd native/warehouse-app && npx tsc -b && npx vitest run && npm run lint)` — 워크트리면 `native/warehouse-app/node_modules`·루트 `node_modules` 심볼링크가 필요하다. oxlint 경고 수는 develop 기준선과 같아야 한다(먼저 develop 에서 잰다).

## Review Focus

1. **F7 이 두 뜻이다.** F1 검수 중 F7 = 수량이고 기능키 바에 «F7 수량»이 그대로 보인다. 송장 대기·다른 탭에서 F7 = 반품 탭이고 바에는 안 그린다(탭 바에 있다). — Task 4.
2. **같은 SKU 가 두 줄(또는 세트 구성품)에 있다.** 스캔은 남은 수량이 있는 첫 항목으로 가고, 첫 항목이 차면 다음 항목으로, 둘 다 차면 오류음·수량 그대로. 손 입력도 항목별 상한(기대 − 이미 도착)을 넘지 못한다. — Task 3.
3. **결과를 모르는 도착.** 네트워크 실패 뒤 수량이 잠기고 F10 이 같은 키·같은 본문을 다시 보낸다. 이미 도착이 있는 반품은 F10 두 번. — Task 5.
4. **열어 둔 사이 반품이 바뀐다.** CS 가 도착 전 취소했거나 다른 스테이션이 먼저 검수했다 → 409 → 상세를 다시 읽고 «취소된 반품이에요»/«끝난 반품이에요» 뒤 목록. 화면이 옛 뷰로 다시 보내지 않는다. — Task 5·6.
5. **목록이 창고를 지킨다.** W 가 배송완료하지 않은 주문의 `expected` 반품은 안 보인다. 다른 창고에서 첫 도착한 반품은 W 에 안 보인다. `cancelled`·`inspected`·`held` 는 사라진다. 바코드 필터는 정확 일치. — Task 2.

---

### Task 1: core — 검수자 id 칸과 뷰의 바코드·검수자

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts`(`customerReturns` 에 `inspectedBy`)
- Create: `apps/core/drizzle/<timestamp>_add-customer-return-inspected-by.sql` + `drizzle/meta`(생성)
- Modify: `apps/core/src/modules/sales-order/customer-return/customer-return-transition.ts`(`set` 허용 칸에 `inspectedBy`)
- Modify: `apps/core/src/modules/sales-order/customer-return/customer-return-receiving.manager.ts`(`transition()` 이 `inspectedBy: input.actorId`)
- Modify: `apps/core/src/modules/sales-order/customer-return/customer-return.reader.ts`(뷰 `inspectedBy`, 항목 `barcodes`)
- Test: `customer-return-receiving.manager.integration.spec.ts`, `customer-return.reader.integration.spec.ts`

**Interfaces:**
- Produces: `CustomerReturnView.inspectedBy: string | null`, `CustomerReturnView.lines[].items[].barcodes: string[]`(N5 순서). 기존 칸·순서 그대로.

- [ ] **Step 1: 실패하는 통합 스펙**
  - receiving: `it('처음 검수한 사람을 inspectedBy 로 남기고, 같은 결과 재요청은 바꾸지 않는다')` — actor `'u-1'` 로 검수 → `inspectedBy === 'u-1'`, 같은 결과로 `'u-2'` 재요청 → 여전히 `'u-1'`. 보류 있는 검수(`held`)도 `inspectedBy` 를 쓴다.
  - reader: `it('항목이 SKU 바코드를 주 바코드 먼저 싣는다')` — 바코드 `'B2'`(주)·`'A1'` → `['B2', 'A1']`, 바코드 없는 SKU → `[]`.
- [ ] **Step 2: 실행** — `DATABASE_URL=… npx jest apps/core/src/modules/sales-order/customer-return --runInBand` → FAIL.
- [ ] **Step 3: 구현** — 스키마 칸 `inspectedBy: varchar('inspected_by', { length: 255 })` → `db:generate:core` → SQL 이 `ALTER TABLE "customer_returns" ADD COLUMN "inspected_by" varchar(255);` 하나인지 본다. 바코드는 `itemsOf` 에서 `sku_barcodes` 를 `inArray(skuId, …)` 로 따로 읽어 붙인다(`orderBy(desc(isPrimary), asc(barcode))`).
- [ ] **Step 4: 실행** — PASS. `npm run type-check` 0.
- [ ] **Step 5: Commit** — `feat(core): 반품 검수자 id(inspected_by)와 상세 뷰의 SKU 바코드 (K8 PR7b)`

### Task 2: core — 창고 도착 대기 목록·상세 라우트

**Files:**
- Create: `apps/core/src/modules/sales-order/customer-return/dto/list-receiving-customer-returns.dto.ts`
- Create: `apps/core/src/modules/sales-order/customer-return/customer-return-receiving.controller.ts`
- Modify: `customer-return.reader.ts`(`listForReceiving`), `customer-return.service.ts`(위임), 이 모듈의 컨트롤러 등록(`sales-order.module.ts`)
- Test: `customer-return.reader.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 뷰.
- Produces:
  - `ListReceivingCustomerReturnsQueryDto { warehouseId: string; q?: string; barcode?: string; limit: number /* 1~100, 기본 100 */ }`
  - `type CustomerReturnReceivingStage = 'awaiting' | 'partial' | 'ready'`
  - `type CustomerReturnReceivingItem = { id: string; orderNo: string; customerMasked: string; productSummary: string; expectedQty: number; arrivedQty: number; stage: CustomerReturnReceivingStage; requestedAt: string }` — `orderNo`·`productSummary` 는 PR 7 목록과 같은 규칙(`display_order_no ?? channel_order_id`, `'<첫 품목> 외 N건'`), 수량은 SKU 항목 합.
  - `CustomerReturnReader.listForReceiving(query: ListReceivingCustomerReturnsQueryDto, tx?: DbTx): Promise<{ items: CustomerReturnReceivingItem[]; total: number }>`, `CustomerReturnService.listForReceiving(query, tx?)`
  - 라우트 N2: `GET admin/customer-return-receiving`, `GET admin/customer-return-receiving/:id`(`ParseUUIDPipe`).

- [ ] **Step 1: 실패하는 통합 스펙**(`describe('listForReceiving')`, 픽스처는 같은 파일의 `seed`)
  - `it('W 가 배송완료한 expected 반품만 awaiting 으로 싣고, 다른 창고가 배송한 주문은 뺀다')`
  - `it('W 에서 첫 도착한 반품은 W 에만 보인다')` — W2 로 조회하면 빈 목록.
  - `it('단계: 덜 온 arrived 는 partial, 다 온 arrived·미도착으로 닫힌 arrived 는 ready')`
  - `it('inspected·held·cancelled 는 싣지 않는다')`
  - `it('정렬은 ready → partial → awaiting, 그다음 요청 이른 순')`
  - `it('q 는 주문번호 정확 일치·고객명 부분 일치, barcode 는 정확 일치로 그 SKU 를 가진 반품만')` — 고객명 `'홍길동'` → `customerMasked === '홍길*'`.
  - `it('limit 을 넘으면 items 는 자르고 total 은 전체')`
- [ ] **Step 2: 실행** — FAIL.
- [ ] **Step 3: 구현** — `expected` 후보의 «W 가 배송완료» 판정은 후보 판매주문 id 들로 `deliveredParcelsSql` 을 한 번 부르고 `shipments.warehouse_id = W` 로 거른 판매주문 집합으로(반품마다 쿼리하지 않는다). 컨트롤러 둘은 N2 의 데코레이터 셋, 본문은 서비스 위임 한 줄. `maskName` 은 `fulfillment/reader/recipient-snapshot.ts` 것을 쓴다.
- [ ] **Step 4: 실행** — 통합 PASS. `npx jest scripts/security libs/authorization` — `route-classification`·`permission-wiring`·IDOR 가드가 새 라우트를 요구하면 그 파일의 규칙대로 근거와 함께 더한다(근거 없는 키 추가 금지). `pii-routes.spec` 은 바뀌지 않아야 한다(N4).
- [ ] **Step 5: Commit** — `feat(core): 창고 반품 도착 대기 목록·상세 라우트 — 창고별, 고객명은 가려서 (K8 PR7b)`

### Task 3: warehouse-app — 반품 판정 순수 함수와 API

**Files:**
- Create: `native/warehouse-app/src/domains/customer-returns/{types.ts,api.ts,stage.ts,parcel.ts,inspection.ts}`
- Test: `native/warehouse-app/src/domains/customer-returns/{stage,parcel,inspection,api}.test.ts`

**Interfaces:**
- Consumes: Task 1·2 응답 모양.
- Produces:
  - `types.ts` — `ReturnView`(뷰 미러: `id`, `status`, `order.orderNo`, `warehouseId`, `csResolution: { missing?: unknown } | null`, `lines[{ id, productName, quantity, missingQty, items[{ id, skuId, skuName, skuCode, qtyPerUnit, expectedQty, arrivedQty, acceptedQty, rejectedQty, heldQty, barcodes }] }]`), `ReceivingItem`·`ReceivingPage`(Task 2 미러).
  - `api.ts` — `useReceivingReturns(warehouseId: string, filter: { q: string; barcode: string })`(키 `['customer-return-receiving', warehouseId, q, barcode]`, 빈 문자열은 쿼리스트링에서 뺀다), `fetchReturn(api, id): Promise<ReturnView>`, `recordArrival(api, id, body: { warehouseId: string; items: Array<{ customerReturnItemId: string; quantity: number }>; idempotencyKey: string }): Promise<ReturnView>`, `recordInspection(api, id, body: { items: Array<{ customerReturnItemId: string; accepted: number; rejected: number; held: number }> }): Promise<ReturnView>`.
  - `stage.ts` — `receivingStageOf(view: ReturnView): { kind: 'receive' } | { kind: 'inspect' } | { kind: 'closed'; reason: 'cancelled' | 'inspected' }`(N8).
  - `parcel.ts` — `type ParcelCounts = ReadonlyMap<string, number>`; `remainingOf(item, counts): number`; `scanIntoParcel(view, counts, barcode): { kind: 'counted'; counts: ParcelCounts; itemId: string } | { kind: 'full'; itemId: string } | { kind: 'unknown' }`(N5); `setParcelCount(view, counts, itemId, qty): { kind: 'ok'; counts } | { kind: 'over'; max: number }`; `arrivalItems(counts)`(0 인 항목은 뺀다); `hasPriorArrival(view): boolean`.
  - `inspection.ts` — `type InspectionDraft = ReadonlyMap<string, { rejected: number; held: number }>`; `type InspectionColumn = 'rejected' | 'held'`; `setInspectionCell(view, draft, itemId, column, qty): { kind: 'ok'; draft } | { kind: 'over'; max: number }`; `acceptedOf(item, draft): number`; `inspectionItems(view, draft)`(모든 항목, `accepted = arrivedQty − rejected − held`); `heldTotal(draft): number`.

- [ ] **Step 1: 실패하는 스펙**
  - `stage`: `expected` → receive. `arrived`·기대 2·도착 1·닫힘 없음 → receive, 닫힘 있음 → inspect, 도착 2 → inspect. `inspected`·`held`·`refund_pending`·`settled` → closed `inspected`. `cancelled` → closed `cancelled`.
  - `parcel`: 같은 SKU 바코드 `'880'` 이 줄 A(기대 1)·줄 B(기대 1) 항목에 → 첫 스캔 A, 둘째 B, 셋째 `full`. 이미 도착 1·기대 2 → 스캔 한 번만 counted. 없는 바코드 → `unknown`. `setParcelCount` 기대 2·도착 1 에 2 → `over`, max 1. `arrivalItems` 는 0 을 뺀다. 세트 항목(qtyPerUnit 2, 기대 2) → 스캔 두 번 counted.
  - `inspection`: 기본 양품 = 도착. 도착 3 에 불량 2 → 양품 1, 이어 보류 2 → `over` max 1. `inspectionItems` 는 도착 0 인 항목(닫힌 반품)도 `0/0/0` 으로 싣는다(서버가 «모든 항목 한 번씩»을 요구한다).
  - `api`: `useReceivingReturns('w-1', { q: '', barcode: '880' })` 가 `/admin/customer-return-receiving?warehouseId=w-1&barcode=880` 를 부른다. `recordArrival` 은 `POST /admin/customer-returns/<id>/arrivals` 에 본문 그대로.
- [ ] **Step 2: 실행** — `cd native/warehouse-app && npx vitest run src/domains/customer-returns` → FAIL.
- [ ] **Step 3: 구현** — 항목 순서는 뷰의 줄 순서 → 항목 순서 그대로.
- [ ] **Step 4: 실행** — PASS, `npx tsc -b` 0.
- [ ] **Step 5: Commit** — `feat(warehouse-app): 반품 도착·검수 판정과 API (K8 PR7b)`

### Task 4: warehouse-app — F7 «반품» 탭과 도착 대기 목록 화면

**Files:**
- Modify: `src/station/keys.ts`(`TAB_KEYS` 에 F7), `src/station/tabs.ts`(`StationPath` 에 `'/customer-returns'`, 탭 `{ key: 'F7', label: '반품', to: '/customer-returns', owns: ['/customer-returns'], sections: [] }`), `src/station/actions.ts`(`functionBarItems` 가 키 대신 «id 가 `tab-` 로 시작하는 액션»을 뺀다), `src/station/StationShell.tsx`·`FunctionKeyBar.tsx`(omit 인자 정리)
- Create: `src/app/routes/CustomerReturnsRoute.tsx`, `src/station/returns/{ReturnsScreen.tsx,ReturnList.tsx,returnsActions.ts}`, `src/station/returns/__fixtures__/returnsServer.ts`
- Modify: `src/app/routeTree.tsx`(경로 `/customer-returns`)
- Test: `src/station/actions.test.ts`, `src/station/tabs.test.ts`, `src/app/router.test.tsx`, `src/station/outbound/InspectKeys.test.tsx`, `src/station/returns/ReturnList.test.tsx`

**Interfaces:**
- Consumes: Task 3 `useReceivingReturns`, `fetchReturn`, `receivingStageOf`.
- Produces:
  - `RETURNS_ACTIONS = { search: { id: 'returns-search', key: 'F9', label: '검색' }, clear: { id: 'returns-clear', key: 'Escape', label: '검색 지우기' }, confirmArrival: { id: 'returns-arrival', key: 'F10', label: '도착 확정' }, confirmInspection: { id: 'returns-inspection', key: 'F10', label: '검수 확정' }, back: { id: 'returns-back', key: 'Escape', label: '목록' } }` — 상태마다 일부만 선언한다(같은 층에 F10·Escape 가 둘씩 오지 않게).
  - `ReturnsScreen` 의 상태 `type ReturnsView = { kind: 'list' } | { kind: 'receive'; view: ReturnView } | { kind: 'inspect'; view: ReturnView }` 와 «열기» 함수 `open(id)`(상세 읽기 → `receivingStageOf` → 화면, closed 면 안내 한 줄 + list). Task 5·6 은 `receive`·`inspect` 화면을 채운다 — 이 Task 에선 자리만(제목 + Esc 목록).
  - `returnsServer.ts` — `createReturnsServer(init: { returns: FakeReturn[] })` 가 `ApiClient` 를 흉내 낸다(목록 필터·상세·도착·검수, 서버 규칙: 상한·합·상태·같은 키 재요청). Task 5·6 이 같은 서버를 쓴다.

- [ ] **Step 1: 실패하는 스펙**
  - `actions.test`: 해석된 표에 셸 `tab-F7` 이 있으면 바에서 빠지고, 화면이 F7 을 선언하면(`inspect-quantity`) 바에 남는다.
  - `InspectKeys.test`: 검수 중 기능키 바에 «F7 수량»이 보이고 F7 이 수량 입력을 연다(지금 테스트 유지), 송장 대기에서 F7 → `/customer-returns`.
  - `tabs.test`·`router.test`: `/customer-returns` → F7, 탭 순회 표에 `['F7', null, '/customer-returns']`.
  - `ReturnList.test`(스테이션 하네스 + `returnsServer`): 목록이 «검수 대기·덜 옴»을 위로, 고객명은 가린 값, «도착 대기»에는 단계 글자가 없다. F9 → 검색칸(포커스), 입력 후 Enter → `q` 조회, Esc → 지움. 숫자를 치기 시작해도 검색칸이 열린다. 목록 화면 상품 스캔 → `barcode` 조회, 결과 하나면 그 반품이 열린다(`receive`). ↑↓ + Enter 로 연다. 창고 미설정이면 `WarehousePicker`. `cancelled` 상세를 열면 «취소된 반품이에요» 뒤 목록. 목록이 비면 «도착 대기 반품이 없어요» 한 줄.
- [ ] **Step 2: 실행** — `npx vitest run src/station src/app` → FAIL.
- [ ] **Step 3: 구현** — 선택 이동·Enter 는 `useHumanKeys`, 숫자 첫 입력이 검색칸을 여는 것은 F1 `ManualWaybillInput` 꼴. 목록은 `total > items.length` 일 때만 «외 N건 — 검색하세요». 라우트 래퍼는 `isStationDevice()` 면 `ReturnsScreen`, 아니면 `PlaceholderScreen title="반품" note="스테이션에서 하는 작업이에요"`.
- [ ] **Step 4: 실행** — `npx tsc -b && npx vitest run && npm run lint` 초록(oxlint 경고 수 기준선 그대로).
- [ ] **Step 5: Commit** — `feat(warehouse-app): 스테이션 F7 반품 탭 — 도착 대기 목록·검색·상품 스캔으로 찾기 (K8 PR7b)`

### Task 5: warehouse-app — 소포 세기와 도착 확정

**Files:**
- Create: `src/station/returns/ParcelWork.tsx`
- Modify: `src/station/returns/ReturnsScreen.tsx`
- Test: `src/station/returns/ParcelWork.test.tsx`

**Interfaces:**
- Consumes: Task 3 `scanIntoParcel`·`setParcelCount`·`arrivalItems`·`hasPriorArrival`·`recordArrival`, Task 4 `RETURNS_ACTIONS.confirmArrival`·`back`, `returnsServer`.
- Produces: 도착 성공 뒤 `ReturnsScreen` 이 응답 뷰로 `receivingStageOf` 를 다시 판정해 `inspect` 또는 list(N8).

- [ ] **Step 1: 실패하는 스펙**
  - 화면: 표 `상품 | 남은 수량 | 이번 소포`(남은 수량 = 기대 − 이미 도착), 큰 숫자 «이번 소포 N». 이미 도착이 있으면 «이미 받은 소포가 있어요» 한 줄.
  - 스캔 → 그 줄 +1·선택·성공음. 같은 SKU 두 줄은 Review Focus 2 순서. 다 찬 줄 스캔 → 오류음 «더 받을 수 없어요», 없는 바코드 → «이 반품에 없는 상품이에요», 수량 그대로.
  - ↑↓ 줄 선택, 숫자 → 선택 줄 «이번 소포» 덮어쓰기(Backspace 지움), 상한 넘김 → 오류음·그대로.
  - F10: 이번 소포가 0 이면 꺼짐(바에 없음). 보낸 본문 = `{ warehouseId, items(0 제외), idempotencyKey }`. 다 오면 검수 화면으로, 덜 오면 «남은 물건은 CS 가 정해요» 뒤 목록.
  - 이미 도착이 있는 반품: 첫 F10 은 «새 소포면 F10 한 번 더», 두 번째에 보낸다. 사이에 스캔·입력하면 첫 누름이 풀린다.
  - 네트워크 실패: 수량 잠김(스캔·입력 오류음), «결과를 확인하지 못했어요 — F10 다시 보내기». 다시 보낸 요청의 키·본문이 첫 요청과 같다. 서버가 그 키를 이미 받았으면 같은 뷰가 돌아와 정상 진행.
  - 409(취소됨): 상세를 다시 읽고 «취소된 반품이에요» 뒤 목록.
  - Esc: 이번 소포가 0 이면 바로 목록, 아니면 «한 번 더 누르면 센 수량을 버려요» 두 번.
- [ ] **Step 2: 실행** — FAIL.
- [ ] **Step 3: 구현** — 키는 소포 화면 마운트 때 `crypto.randomUUID()` 한 번(`useState` 초기값). «결과 모름»은 `ApiError` 가 아닌 실패 또는 status ≥ 500 이다.
- [ ] **Step 4: 실행** — `npx vitest run src/station/returns` PASS, `npx tsc -b` 0.
- [ ] **Step 5: Commit** — `feat(warehouse-app): 반품 소포 세기와 도착 확정 — 같은 키로 다시 보내기, 이미 받은 소포는 두 번 눌러 (K8 PR7b)`

### Task 6: warehouse-app — 검수 칸과 검수 확정

**Files:**
- Create: `src/station/returns/InspectReturn.tsx`
- Modify: `src/core/hardware/scan/humanKeys.ts`(`HUMAN_CONTROL_KEYS` 에 `ArrowLeft`·`ArrowRight`), `src/station/returns/ReturnsScreen.tsx`
- Test: `src/station/returns/InspectReturn.test.tsx`, `src/core/hardware/scan/humanKeys.test.ts`

**Interfaces:**
- Consumes: Task 3 `setInspectionCell`·`acceptedOf`·`inspectionItems`·`heldTotal`·`recordInspection`, Task 4 `RETURNS_ACTIONS.confirmInspection`·`back`.

- [ ] **Step 1: 실패하는 스펙**
  - `humanKeys.test`: ←→ 가 사람 키로 바로 나간다(스캔 묶음 판정에 끼지 않는다).
  - 화면: 표 `상품 | 도착 | 양품 | 불량 | 보류`, 양품은 입력칸이 아니다. 기본 불량·보류 0. ↑↓ 줄, ←→ 불량↔보류 칸, 숫자 덮어쓰기. 불량 + 보류 > 도착 → 오류음·그대로, 양품이 따라 바뀐다.
  - F10 첫 누름: 보류 0 이면 «한 번 더 누르면 환불을 요청해요», 보류 > 0 이면 «한 번 더 누르면 CS 확인으로 넘겨요». 두 번째에 `inspectionItems` 본문을 보낸다. 사이에 칸을 바꾸면 첫 누름이 풀린다.
  - 성공 → 완료음 + 목록. 네트워크 실패 → 칸 잠김, F10 이 같은 본문으로 다시 보낸다(서버가 같은 결과는 그대로 돌려준다).
  - 409(다른 결과로 이미 검수됨·취소됨) → 상세를 다시 읽고 «끝난 반품이에요»/«취소된 반품이에요» 뒤 목록.
  - 미도착으로 닫힌 반품: 도착 0 인 항목 줄은 그리지 않되 본문엔 `0/0/0` 으로 싣는다.
- [ ] **Step 2: 실행** — FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 실행** — `npx tsc -b && npx vitest run && npm run lint` 초록. 기존 화면의 사람 키 처리기가 ←→ 를 받아도 무시하는지 F1·결품 창 스펙으로 확인한다(전부 초록).
- [ ] **Step 5: Commit** — `feat(warehouse-app): 반품 검수 — 불량·보류만 입력, 양품은 나머지, 두 번 눌러 확정 (K8 PR7b)`

### Task 7: 명령 시트 «반품» 절과 dev 시드 반품 시나리오

**Files:**
- Modify: `native/warehouse-app/src/station/commandSheet.ts`(+ 테스트)
- Create: `scripts/local/seed-dev-core/return-scenarios.ts`
- Modify: `scripts/local/seed-dev-core/index.ts`, `scripts/local/seed-dev-core/seed.integration.spec.ts`, `docs/local-dev.md`

**Interfaces:**
- Produces: `seedReturnScenarios(tx: DbTx): Promise<void>` — 부천(판매 창고)에서 배송완료한 주문 셋과 반품 기록 셋. 주문번호 `DEV-RETURN-0001…3`, 고객명은 시나리오 이름. `seedDeliveredLine` 이 주문마다 줄 하나를 만들므로 시나리오도 줄 하나씩이다 — «같은 SKU 두 줄»은 Task 3·5 스펙이 덮는다.

  | 주문 | 반품 | 쓰임 |
  | --- | --- | --- |
  | DEV-RETURN-0001 | 컬러크림 ×2 (변심) | 소포 세기 → 검수(양품 1·불량 1) → 환불 요청 |
  | DEV-RETURN-0002 | 집게핀 ×3 (하자) | 하나만 세면 «덜 옴» |
  | DEV-RETURN-0003 | 세트 1벌 = 헤어롤 ×2 + 앰플 ×1 구성 (오배송) | 구성품이 다른 SKU 항목 둘 · 보류 검수 → `held` |

- [ ] **Step 1: 실패하는 스펙** — `commandSheet.test`: 시트에 «반품» 절(`RETURNS_ACTIONS` 의 검색·도착 확정·검수 확정·목록)이 있고 탭 절에 F7 이 있다. 시드 통합 스펙: 시드 뒤 `customer_returns` 3행 `expected`, 각 반품 항목의 SKU 에 시드 바코드가 있다, `listForReceiving({ warehouseId: 부천 })` 이 셋 다 `awaiting` 으로 준다.
- [ ] **Step 2: 실행** — FAIL.
- [ ] **Step 3: 구현** — 배송완료 사슬은 `seedDeliveredLine`, 반품은 `CustomerReturnManager.recordRequested`(발행자는 적재만 하는 가짜 — 시드가 Kafka 를 부르지 않는다). 픽스처가 jest 를 import 하면 쓰는 insert 만 옮긴다. 시나리오 SKU 의 `return_default` 위치는 `ensureSystemLocations` 로 보장.
- [ ] **Step 4: 실행** — 시드 통합 PASS, `npm run type-check` 0, 앱 vitest PASS. `docs/local-dev.md` 에 위 표와 «F7 → 상품 바코드 스캔으로 찾기»를 출고 시나리오 표 아래에 더한다.
- [ ] **Step 5: Commit** — `chore(seed): dev 반품 시나리오 셋과 명령 시트 «반품» 절 (K8 PR7b)`

### Task 8: 설계 문서

**Files:** Modify `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md`

- [ ] **Step 1:** §4.8 «PR 7 에서 확정한 결과» 뒤에 «PR 7b 에서 확정한 결과» — N1(F7, 검수 중 F7 = 수량), N2(창고 읽기 라우트·권한), N3(범위·단계·정렬), N4(가린 이름), N5(바코드·같은 SKU 두 줄), N6(소포 키·이미 받은 소포), N7(불량·보류만 입력, 두 번 확정), N9(검수자 id) 한 줄씩.
- [ ] **Step 2:** §4.3 «PR 6 에서 확정한 결과» (f) 끝에 «→ PR 7b 에서 `inspected_by`» 를 잇는다. §8 PR 7b 행 비고에 «마이그 하나(`migrate → deploy`), core 먼저 → 앱 릴리스».
- [ ] **Step 3: Commit** — `docs(k8): PR 7b 에서 확정한 결과 — 창고 반품 화면`

---

## 배포 (PR 본문용)

- **core 먼저(`migrate → deploy`) → warehouse-app 릴리스.** 옛 앱은 새 라우트를 안 부르고, 새 앱이 옛 core 를 만나면 목록이 404 로 빈다(쓰기 사고 없음).
- K8 PR 2~7 이 아직 라이브가 아니면 이 PR 도 그 배치에 실린다(PR 5·6·6b 의 `migrate → deploy` 승계).
- 개통 전에는 휴면이다 — 셀메이트 시기엔 배송완료가 0 이라 반품 자체가 안 생긴다(D9). 화면은 «도착 대기 반품이 없어요».
- ⛔ 스모크: 로컬 E2E + dev 시드(Task 7)로 스테이션에서 셋을 끝까지 — 리눅스 스테이션 프로필(`npm run tauri:dev`)로 된다. Windows 실기(소리·IME)는 PR C 의 미검증 목록과 같이 남는다.
