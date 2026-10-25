# K3 PR 7 — admin-web: 직배 화면 개편·SKU 폼 입점사 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영자가 admin-web 「직배 운영」 화면에서 입점사별로 대기 상자를 보고, 시트를 XLSX 로 내려받아(= 넘김) 보내고, 돌아온 시트를 올려 미리보기 → 적용하고, «못 보냄» 줄과 «알릴 취소»를 입점사 단위로 처리한다. 상자 상세는 입점사 상자를 입점사 상자로 그리고 되돌리기만 연다. SKU 폼은 재고 유형이 «직배»면 직배 입점사 하나를 요구한다. 옛 업체 이름 기반 화면·버튼은 지운다. **동작은 휴면이다** — 직배 SKU 가 라이브 0 이다.

**Architecture:** 화면은 PR 4~6 이 만든 core 라우트(`/direct-ship/supplier-queue…`, `/suppliers/:id/handoffs`, `/handoffs/:id/sheet`, `/suppliers/:id/uploads/{preview,apply}`, `/cancel-notices` 입점사 id 판)만 부른다. 판정·변환 로직(XLSX 만들기, 판정 문구, 올리기 상태, SKU 공급사 페이로드, 상자 동작 목록)은 **컴포넌트 밖 순수 함수 파일**에 두고 spec 으로 판정한다 — admin-web 은 컴포넌트 테스트를 못 돌린다. core 는 작은 셋만 더한다: 넘김 묶음 목록 읽기, 공급사 목록의 `isDirectDelivery` 필터, 넘김 전 내보내기 사유 선검사.

**Tech Stack:** Next.js(admin-web) + TanStack Query + axios `client`, SheetJS(`xlsx` 0.18.5, 이미 의존성), NestJS(core), Drizzle, Jest(`npm run test:admin-web`, core unit + `DATABASE_URL` 통합).

**Spec:** `docs/superpowers/specs/2026-10-25-k3-drop-ship-supplier-shipments-design.md` (§4.2 admin-web SKU 폼, §4.9, §7 PR 7, «PR 7 구현자에게» 두 묶음). ADR `docs/adr/0050-drop-ship-is-a-supplier-shipment.md`. 앞 계획: `2026-10-25-k3-supplier-dispatch-pr5.md`(N2·N4·N5·N6·N10), `2026-10-26-k3-supplier-cancel-notices-pr6.md`(N6·N7).

## 코드에서 확인한 것 (develop `13fef166d`)

- **넘김 POST 는 사유가 없으면 «쓴 뒤에» 400 이다.** `PiiMaskingInterceptor` 가 `next.handle()` 뒤(`pii-masking.interceptor.ts:117`)에 사유를 본다(`exportReason`, 5~200자). 그때는 `SupplierHandoffService.handOff` 트랜잭션이 이미 커밋됐다 — 상자에 넘김이 찍히고 시트는 못 받는다. → N4.
- **권한이 모자라면 시트가 가려진 채 200 으로 온다**(`SUPPLIER_SHEET_PII` 의 `rawWithByField` = `customer.pii.read`·`fulfillment.recipient.read`). 응답 헤더 `x-pii-masked` 가 `none` 이 아니다. admin-web 에는 이미 `parsePiiHeaders`(`lib/pii/pii-notices.ts`)가 있다. → N3.
- **admin-web 에 내보내기 사유를 보내는 화면이 하나도 없다.** 프록시는 `x-pii-export-reason` 을 이미 넘긴다(`app/api/proxy/_lib/forward.ts:16`). 서버는 `decodeURIComponent` 로 읽는다 → 클라이언트는 `encodeURIComponent` 로 싣는다.
- **넘김 묶음 목록 읽기가 core 에 없다**(스펙 «PR 7 구현자에게» 4번째 줄). `supplier_handoffs`(id·supplier_id·created_by·created_at)와 `shipments.supplier_handoff_id` 는 있다.
- **SKU 수정의 `supplierIds` 는 «통째로 갈기»다**(`sku-catalog.manager.ts:122-128`: delete 후 insert). 비직배 공급사 연결을 빼고 보내면 지워진다. 같은 이유로 `sku_suppliers.supplier_sku` 도 지워지지만 **운영 코드에 그 칸을 쓰는 곳이 0** 이라 지금 잃을 값은 없다(`grep -rn "supplierSku" apps/core/src --include=*.ts | grep -v spec`). → N8·N9.
- **SKU 응답의 `suppliers` 는 `{id, name}` 뿐**이라 어느 것이 직배 공급사인지 모른다. 공급사 목록(`GET /suppliers`)은 `isDirectDelivery` 를 주지만 그 값으로 거르는 필터가 없고 `limit` 상한이 100 이다. → Task 1.
- **상자 상세(`ShipmentDetailResponseDto`)·요약은 이미 `supplierId` 를 준다**(PR 4). admin-web 타입(`ShipmentAdminSummary`·`ShipmentAdminDetail`)은 `warehouseId: string` 이고 `supplierId` 가 없다.
- **정체 보드 상태 `drop_ship_unfulfillable`(PR 4)의 admin-web 문구가 없다**(`order-progress.shape.ts:237-240` 에 `drop_ship_pending`·`drop_ship_forwarded` 만).
- **올리기 응답은 판정만 담고 개인정보가 없다.** 적용은 오류 줄을 빼고 나머지를 한 트랜잭션으로 쓴다. 미리보기 뒤 판정이 바뀌면 409 `SUPPLIER_UPLOAD_PREVIEW_STALE`.

## 이름 붙은 결정 (⛔ 사용자 확인)

- **N1. 한 PR, admin-web + Core 작은 셋, 마이그 없음.** Core 몫은 Task 1·2 뿐이다(읽기 하나·필터 하나·사유 선검사). 같은 배치에 싣는다(SST 한 스택). 둘 다 휴면이다.
- **N2. XLSX 는 admin-web 이 SheetJS 로 쓴다.** 머리글 = 응답 `columns[].header`, 순서 = `columns` 순서, 칸 값은 `rows[i][columns[j].key]` 를 **모두 문자열 셀**로(수량 포함) — 전화·송장·상품코드 앞자리 0 이 숫자로 바뀌지 않게. 파일 이름 = 응답 `fileName`. 시트 이름 `직배`. 열 너비는 `!cols` 로 머리글 길이 기준(정보용). `salesOrderId` 는 열이 아니다(`columns` 에 없다).
- **N3. 가려진 시트는 파일로 만들지 않는다.** 응답에서 `parsePiiHeaders` 가 null 이 아니면 내려받지 않고 «수령인 정보를 볼 권한이 없어 시트를 만들지 않았습니다. 권한을 받은 뒤 ‘넘긴 것’에서 다시 받으세요.»를 띄운다. 넘김은 이미 찍혔으므로 그 상자는 «넘긴 것»으로 옮겨 간다 — 다시 받기가 복구 길이다(PR 5 N2 의 대가 그대로).
- **N4. core 넘김 라우트가 사유를 «쓰기 전에» 검사한다.** `@Headers('x-pii-export-reason')` 를 받아 핸들러 첫 줄에서 인터셉터와 **같은 함수**로 검사한다 — 인터셉터의 `exportReason` 본문을 `libs/authorization` 에서 `readPiiExportReason(encoded: string | null): string`(5~200자, 아니면 `BadRequestException`)으로 꺼내 둘이 같이 부른다. 다시 받기(GET)는 쓰지 않으므로 바꾸지 않는다. 대가: 수령인 권한이 없어 가린 시트를 받을 사람도 사유를 적어야 한다 — 어차피 그 시트는 못 쓴다(N3).
- **N5. 넘김 묶음 목록 = `GET /direct-ship/suppliers/:supplierId/handoffs`**, `fulfillment.order.read`, 개인정보 없음, 최근 50개(`created_at DESC`). 행: `{ handoffId, createdAt, createdBy, openShipments, shippedShipments, unfulfillableLines }`. `open` = 그 묶음을 가리키는 `draft`·`recovery_required` 상자, `shipped` = `shipped` 상자, `unfulfillableLines` = 열린 상자의 `unfulfillable_reason IS NOT NULL` 라인. 합포장 상자는 가장 이른 묶음에 센다(PR 5 N7) — 묶음별 수는 근사다.
- **N6. 옛 화면·훅·클라이언트를 지운다:** `direct-ship/components/{dashboard,orders-table,forward-dialog,complete-dialog,export-button}`, FO 상세 `detail/direct-ship-tab.tsx` 와 그 탭, 훅 `useForwardDirectShipOrders`·`useCompleteDirectShipOrders`·`useExportDirectShipFile`·`useDirectShipDashboard`·`useDirectShipCompanies`·`useDirectShipOrders`·`useDirectShipCompanySummary`·`useDirectShips`·`useDirectShip`, `directShipClient` 의 옛 메서드, 그 타입과 쿼리 키. core 의 옛 라우트는 PR 8 이 지운다(이 PR 뒤로 부르는 곳 0). FO 목록·상태 칸의 `drop_ship` 배지·라벨은 옛 FO 표시용으로 둔다 — FO 모드는 PR 8 이 걷는다.
- **N7. 상자 상세에서 입점사 상자는 «되돌리기»만 연다.** 나누기·계획 확정·수령인 변경 버튼은 숨긴다 — 나누기 부분 이동은 서버가 409(`SUPPLIER_SHIPMENT_PARTIAL_SPLIT`), 계획은 창고 흐름 가드가 던지고, 수령인을 넘긴 뒤 바꾸면 입점사 시트와 갈린다. 되돌리기 확인 문구는 «입점사와 확인했습니다 — 이 송장은 잘못 반영되었거나 아직 보내지 않았습니다.»(본문은 그대로 `physicalRecoveryConfirmed: true`). 머리 줄은 «창고 ab12…» 대신 «입점사 <이름>», 라인 표의 예약 칸은 `—`(«미예약»으로 그리지 않는다).
- **N8. SKU 폼: 재고 유형 «직배»면 «직배 입점사» 선택이 필수**(목록 = `useSuppliers({ isDirectDelivery: true, limit: 100 })`). `supplierIds` 는 **직배 입점사 선택이 실제로 바뀔 때만** 보내고, 보낼 때는 «기존 연결 − 기존 직배 연결 + 고른 입점사»(비직배 연결 보존). 직배에서 다른 유형으로 바꿀 때는 연결을 건드리지 않는다. 판정은 core `directSupplierViolation` 과 같은 «값이 바뀔 때만» 규칙을 따른다(연결 없는 옛 직배 SKU 의 이름만 고치면 통과).
- **N9. 공급사 상품코드 입력은 이 PR 에 없다(⛔ 질문).** 위 «확인한 것»대로 `supplier_sku` 를 쓰는 길이 없어 시트의 «공급사 상품코드» 칸은 늘 빈칸이고, 행 대조(`ROW_MISMATCH`)는 사실상 주문번호로만 한다. 입점사가 자기 코드로 상품을 찾아야 하면 별 PR(core DTO + 갈기 시 보존 + 폼 칸)로 한다.
- **N10. 적용 버튼은 오류 줄이 있어도 눌린다**(오류 줄은 서버가 빼고 쓴다). 쓸 줄(`ship + merge + correct + unfulfillable`)이 0 이면 막는다. 오류가 있으면 버튼 옆에 «오류 N줄은 적용되지 않습니다». 409 STALE 이면 미리보기를 지우고 «미리보기 뒤에 바뀐 것이 있습니다. 다시 미리보기 하세요.» 다른 파일을 고르면 미리보기·토큰을 지운다.
- **N11. 「못 보냄」 탭** = 고른 입점사의 `stage=forwarded` 상자에서 `unfulfillableReason` 이 있는 라인. 열: 주문번호(→ `/order/history?orderNo=<orderNo>`)·상품·공급사 상품코드·수량·사유·알린 시각. 머리 문구: «취소는 주문 화면에서 합니다. 이 줄을 취소해도 알릴 취소는 생기지 않습니다(입점사가 먼저 알려 왔습니다).»
- **N12. 화면 이름 «직배 운영», 탭 다섯: 대기 · 넘긴 것 · 올리기 · 못 보냄 · 알릴 취소.** 입점사 고르기는 탭 위 한 줄(요약 `GET /direct-ship/supplier-queue` 의 칩, 대기·넘김·못 보냄 수)이고 다섯 탭이 같이 쓴다. 고른 입점사는 URL `?supplier=<uuid>`. 알릴 취소 탭은 PR 6 대로 행의 `supplierId` 로 묶고 `{ supplierId, noticeIds }` 를 보낸다 — 이 탭만 요약 칩이 아니라 자기 행으로 입점사를 고른다(요약은 열린 상자가 있는 입점사만 낸다).

## Global Constraints

- **마이그 없음.** core 에 새 칸·인덱스가 필요해 보이면 멈추고 묻는다.
- 화면 문구에 «업체»를 쓰지 않는다 — «입점사». 작은 회색 안내 글씨는 필요한 것만(정상 상태는 숨긴다).
- 새 뮤테이션 훅은 `useX.permission = [...] as const satisfies PermissionRequirement`, 화면은 `canRun(useX)`/`<Can run={useX}>` 로 판정(`mutation-guard.gate.spec.ts`). 권한: 넘김·다시 받기 `['order.order.export']`, 미리보기·적용·알림 완료 `['fulfillment.order.write']`, 알릴 취소 CSV `['order.order.export']`. 화면 경로 `/order/direct-ship` 은 `screen-access.ts` 그대로(`fulfillment.order.read`).
- 쿼리 키는 `['direct-ship', …]` 아래, `undefined` 가 키에 들어가지 않게(입점사 미선택이면 `enabled: false`). 넘김·적용·알림 완료 성공 시 `['direct-ship']` 를 통째로 무효화한다.
- 판정 로직은 `.ts` 순수 함수 + `.spec.ts`. 컴포넌트(`.tsx`)에는 그리기와 훅 연결만.
- core 새 라우트: `@RequirePermission`(`route-classification.spec.ts`), 응답 DTO 는 중첩 클래스, 쿼리 규칙(ADR-0025·CLAUDE.md Inventory: `db.query.*`·`with`·`any`/`as` 금지).
- 검증 게이트: `npm run type-check` 에러 0, `npx jest` 실패 0(이 PC 의 admin-web attendance spec 4개는 ICU 환경 실패 — 비교만), **`(cd apps/admin-web && npx tsc --noEmit)` 에러 0 — CI 는 admin-web tsc 를 안 돌린다**, `npm run test:admin-web` 실패 0.
- 통합 테스트: 스크래치 DB `k3_pr2_it`. `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k3_pr2_it npx jest --runInBand --runTestsByPath <파일…>`. 꺼져 있으면 `docker start almondyoung-server-postgres-1`.

## Review Focus

- **수령인 권한 없는 운영자가 «시트 내려받기»** — 파일이 만들어지지 않고 N3 문구, 상자는 «넘긴 것»으로 간다. Task 3 `sheetDownloadDecision` 케이스.
- **사유 4자로 넘김** — 클라이언트가 막고, 막지 못해도 서버가 쓰기 전에 400, 상자에 넘김이 안 찍힌다. Task 2 통합 케이스·Task 3 `exportReasonError` 케이스.
- **미리보기 뒤 다른 파일을 고르고 적용** — 옛 토큰으로 새 파일을 보내지 않는다(파일을 바꾸면 미리보기가 지워진다). Task 3 `uploadReducer` 케이스.
- **전화 `010…`·송장 `0012…`·수량** — XLSX 의 모든 칸이 문자열 셀이고 다시 읽으면 같은 글자다. Task 3 `buildSupplierSheetWorkbook` 케이스.
- **비직배 공급사가 붙은 SKU 를 직배로 바꿈** — 보낸 `supplierIds` 에 비직배 연결이 남는다. 이름만 고친 옛 직배 SKU 는 `supplierIds` 를 보내지 않는다. Task 6 케이스.

---

## 배포

- **Core + admin-web 한 배치, 마이그 없음, 휴면.** admin-web 이 core 보다 먼저 뜨면 새 묶음 목록(Task 2)이 잠깐 404 다 — 직배 0 이라 볼 사람이 없다.
- 롤백: admin-web 만 되돌리면 옛 화면이 돌아오지만 옛 알릴 취소 버튼은 PR 6 뒤로 400 이다(행 0). core 만 되돌리면 넘김 묶음 탭이 404, 넘김 사유 선검사가 사라진다(인터셉터는 그대로).

---

### Task 1: Core — 공급사 목록 `isDirectDelivery` 필터

**Files:**
- Modify: `apps/core/src/modules/inventory/suppliers/dto/supplier-filters.dto.ts` — `isDirectDelivery?: boolean`
- Modify: `apps/core/src/modules/inventory/suppliers/services/suppliers.service.ts:~281` — 조건 추가
- Test: 기존 공급사 목록 spec(없으면 `suppliers/services/suppliers.service.integration.spec.ts` 를 `describeIfDb` 로)

**Interfaces:**
- Produces: `GET /suppliers?isDirectDelivery=true` → `is_direct_delivery = true` 행만. `false` 는 `IS NOT TRUE`(NULL 포함). 안 주면 지금 그대로.

- [ ] **Step 1: 실패 테스트** — `isDirectDelivery=true 는 직배 공급사만`, `false 는 직배 아님과 NULL`, `생략하면 전부`. DTO 변환도 한 줄: 문자열 `'true'`/`'false'` 가 boolean 이 된다(`@Transform(({ value }) => value === 'true' || value === true ? true : value === 'false' || value === false ? false : value)` + `@IsBoolean()`).
- [ ] **Step 2: 실패 확인 → Step 3: 구현 → Step 4: 통과**
- [ ] **Step 5: Commit** — `K3 PR7 — 공급사 목록에 isDirectDelivery 필터`

### Task 2: Core — 넘김 묶음 목록, 넘김 전 사유 선검사

**Files:**
- Modify: `libs/authorization/src/interceptors/pii-masking.interceptor.ts` — `exportReason` 본문을 꺼낸다
- Create: `libs/authorization/src/pii/pii-export-reason.ts` — `export function readPiiExportReason(encoded: string | null): string` (+ `index.ts` export)
- Create: `apps/core/src/modules/fulfillment/supplier-shipment/supplier-handoff-list.reader.ts`
- Modify: `apps/core/src/modules/fulfillment/dto/supplier-sheet.dto.ts` — `SupplierHandoffSummaryDto`
- Modify: `apps/core/src/modules/fulfillment/controllers/direct-ship.controller.ts` — 새 GET, `handOffToSupplier` 에 `@Headers('x-pii-export-reason') reason: string | undefined` 와 첫 줄 `readPiiExportReason(reason ?? null)`
- Modify: 모듈 providers(리더 등록)
- Test: `libs/authorization/src/pii/pii-export-reason.spec.ts`, `supplier-shipment/supplier-handoff-list.reader.integration.spec.ts`, `supplier-shipment/supplier-handoff.integration.spec.ts`(컨트롤러 갈래는 기존 컨트롤러 spec 이 있으면 거기)

**Interfaces:**
- Produces: `SupplierHandoffListReader.recent(supplierId: string, tx?: DbTx): Promise<SupplierHandoffSummary[]>` — `{ handoffId: string; createdAt: Date; createdBy: string; openShipments: number; shippedShipments: number; unfulfillableLines: number }`, 최근 50, `created_at DESC`. 라우트 `GET /direct-ship/suppliers/:supplierId/handoffs`(`ParseUUIDPipe`, `fulfillment.order.read`).
- Produces: `readPiiExportReason` — 인터셉터와 컨트롤러가 같이 부른다. 메시지는 지금 그대로 `개인정보 내보내기 사유를 5~200자로 입력하세요`.

- [ ] **Step 1: 실패 테스트**
  - `readPiiExportReason`: `null`·`''`·`'%E0%A4'`(잘못된 인코딩)·4자 → `BadRequestException`; `encodeURIComponent('입점사 발송 요청')` → `'입점사 발송 요청'`; 앞뒤 공백은 지운다; 201자 거절.
  - 리더 통합: 묶음 둘(서로 다른 시각) — 최근 것이 먼저; 한 묶음에 draft 1·shipped 1·못 보냄 라인 1 → `{open:1, shipped:1, unfulfillable:1}`; 다른 입점사의 묶음은 안 나온다; canceled·superseded 상자는 세지 않는다. 상자는 실제 생성 경로로(`wireLogistics` + `fulfillments.create`, PR 5 본보기).
  - 넘김 선검사: 사유 없이 `handOffToSupplier` 를 부르면 400 이고 **그 입점사의 `supplier_handoffs` 행 0·상자 `supplier_handoff_id` 그대로 NULL**.
- [ ] **Step 2: 실패 확인 → Step 3: 구현 → Step 4: 통과** — 인터셉터 spec 이 그대로 초록인지 함께(`npx jest libs/authorization`).
- [ ] **Step 5: Commit** — `K3 PR7 — 넘김 묶음 목록 읽기, 넘김은 쓰기 전에 내보내기 사유를 본다`

### Task 3: admin-web — 직배 클라이언트·훅·순수 함수

**Files:**
- Modify: `apps/admin-web/src/lib/api/domains/orders/direct-ship.client.ts` — 옛 메서드 지우고(N6) 새 메서드
- Modify: `apps/admin-web/src/lib/types/dto/fulfillment.ts` — 옛 `DirectShip*` 타입(알릴 취소 제외) 지우고 새 타입; `DirectShipCancelNotice` 에 `supplierId: string`
- Modify: `apps/admin-web/src/lib/services/orders/{queries,mutations,query-keys}.ts`
- Create: `apps/admin-web/src/features/order/direct-ship/lib/supplier-sheet-xlsx.ts` (+ `.spec.ts`)
- Create: `apps/admin-web/src/features/order/direct-ship/lib/upload-verdict-text.ts` (+ `.spec.ts`)
- Create: `apps/admin-web/src/features/order/direct-ship/lib/upload-state.ts` (+ `.spec.ts`)
- Create: `apps/admin-web/src/features/order/direct-ship/lib/export-reason.ts` (+ `.spec.ts`)

**Interfaces:**
- Produces (클라이언트, 모두 `${ALMONDYOUNG_API_BASE_URL}/direct-ship` 아래):
  - `getSupplierQueue(): Promise<SupplierQueueSummary[]>` · `getSupplierShipments(supplierId, stage: 'pending' | 'forwarded'): Promise<SupplierQueueShipment[]>` · `getSupplierHandoffs(supplierId): Promise<SupplierHandoffSummary[]>`
  - `handOff(supplierId, reason: string): Promise<SheetResponse>` · `getHandoffSheet(handoffId, reason: string): Promise<SheetResponse>` — 둘 다 헤더 `x-pii-export-reason: encodeURIComponent(reason)`, `SheetResponse = { sheet: SupplierSheet; pii: PiiMeta | null }`(`parsePiiHeaders(name => res.headers[name])`)
  - `previewUpload(supplierId, file: File): Promise<SupplierSheetPreview>` · `applyUpload(supplierId, file: File, previewToken: string): Promise<SupplierSheetApplyResult>` — `FormData`(`file`, `previewToken`), `bulk-session.client.ts:33-37` 와 같은 Content-Type 처리
  - `getCancelNotices(supplierId?: string)` · `exportCancelNoticesFile({ supplierId, noticeIds })` · `markCancelNoticesNotified({ supplierId, noticeIds })`
  - 타입은 core DTO(`supplier-shipment-queue.dto.ts`·`supplier-sheet.dto.ts`·Task 2)를 그대로 옮긴다. 날짜는 `string`.
- Produces (훅): 쿼리 `useSupplierQueue()`·`useSupplierShipments(supplierId | null, stage)`·`useSupplierHandoffs(supplierId | null)`·`useDirectShipCancelNotices()`; 뮤테이션 `useHandOffToSupplier`·`useRedownloadHandoffSheet`(`['order.order.export']`), `usePreviewSupplierUpload`·`useApplySupplierUpload`(`['fulfillment.order.write']`), 알릴 취소 둘은 이름 그대로 본문만 `supplierId`.
- Produces (순수 함수):
  - `buildSupplierSheetWorkbook(sheet: SupplierSheet): XLSX.WorkBook` · `downloadSupplierSheet(sheet: SupplierSheet): void`(`XLSX.writeFile(wb, sheet.fileName)`)
  - `sheetDownloadDecision(pii: PiiMeta | null): { ok: true } | { ok: false; message: string }` — N3 문구
  - `verdictLabel(kind: SupplierRowVerdictKind): string` · `rowErrorText(code: SupplierRowErrorCode): string` · `applicableCount(counts): number`(`ship + merge + correct + unfulfillable`)
  - `uploadReducer(state: UploadState, action: UploadAction): UploadState` — 상태 `{ file: File | null; preview: SupplierSheetPreview | null; result: SupplierSheetApplyResult | null; stale: boolean }`, 행동 `fileChosen`·`previewed`·`applied`·`staleRejected`·`reset`
  - `exportReasonError(reason: string): string | null` — trim 뒤 5~200자가 아니면 `'사유를 5~200자로 적어 주세요.'`

판정 문구(입점사가 아니라 운영자가 본다): `ship` 발송 · `merge` 합포장 발송 · `unfulfillable` 못 보냄 · `waiting` 아직 · `correct` 송장 정정 · `unchanged` 변경 없음 · `error` 오류. 오류 코드:

| 코드 | 문구 |
|---|---|
| `UNKNOWN_ROW_KEY` | 행 키를 찾을 수 없습니다(지웠거나 다른 파일의 줄) |
| `OTHER_SUPPLIER` | 다른 입점사의 줄입니다 |
| `CANCELED` | 취소된 줄입니다 |
| `NOT_HANDED_OFF` | 아직 넘기지 않은 줄입니다 |
| `IN_RECOVERY` | 되돌리기·복구 중인 상자입니다 |
| `ROW_MISMATCH` | 주문번호나 공급사 상품코드가 행 키와 맞지 않습니다 |
| `QTY_MISMATCH` | 수량을 고쳤습니다(일부 발송은 받지 않습니다) |
| `DUPLICATE_ROW` | 같은 행 키가 두 번 있습니다 |
| `UNKNOWN_CARRIER` | 택배사 이름을 알 수 없습니다 |
| `CARRIER_WITHOUT_TRACKING` | 택배사만 있고 송장번호가 없습니다 |
| `TRACKING_WITHOUT_CARRIER` | 송장번호만 있고 택배사가 없습니다 |
| `TRACKING_AND_REASON` | 송장번호와 못 보냄 사유가 둘 다 있습니다 |
| `TRACKING_IN_USE` | 이 송장번호를 다른 상자가 쓰고 있습니다 |
| `MERGE_RECIPIENT_MISMATCH` | 합포장한 줄들의 받는 분이 다릅니다 |
| `CORRECTION_PARTIAL` | 발송된 상자의 일부 줄만 송장이 바뀌었습니다 |
| `REASON_ON_SHIPPED` | 이미 발송된 줄에 못 보냄 사유가 있습니다 |
| `GROUP_HAS_ERROR` | 같은 송장의 다른 줄에 오류가 있습니다 |

- [ ] **Step 1: 실패 테스트**
  - `buildSupplierSheetWorkbook`: 머리글 행 = `columns.map(c => c.header)`; `recipientPhone: '01012345678'`·`trackingNo: '0012345'`·`qty: 3` 인 행을 쓰고 `XLSX.write(wb, {type:'buffer'})` → `XLSX.read` 로 다시 읽으면 모든 칸 `t === 's'` 이고 값이 `'01012345678'`·`'0012345'`·`'3'`; `salesOrderId` 값은 어느 칸에도 없다; 시트 이름 `직배`.
  - `sheetDownloadDecision(null)` → `{ok:true}`; `{maskedKinds:['name'], reason:'no-permission', …}` → `ok:false` + N3 문구.
  - `rowErrorText`: 모든 코드가 빈 문자열이 아니다 — `Record<SupplierRowErrorCode, string>` 로 적어 빠진 코드는 tsc 가 잡는다; `applicableCount({ship:1,merge:2,unfulfillable:1,waiting:5,correct:1,unchanged:3,error:4})` → 5.
  - `uploadReducer`: `previewed` 뒤 `fileChosen(새 파일)` → `preview: null`·`result: null`; `staleRejected` → `preview: null`·`stale: true`; `previewed` 는 `stale: false` 로.
  - `exportReasonError('  넷글자 ')` → 문구, `'입점사 발송 요청'` → null.
- [ ] **Step 2: 실패 확인** — `npm run test:admin-web -- --testPathPattern=direct-ship/lib`
- [ ] **Step 3: 구현** — 옛 훅을 지우면 그 훅을 import 하는 화면이 깨지므로 이 과제에서 옛 컴포넌트 파일(N6 목록, FO 상세 `direct-ship-tab.tsx` 와 `components/detail/index.tsx` 의 그 탭 포함)도 **같이 지운다**. 템플릿은 Task 4 전까지 «알릴 취소» 탭 하나만 남긴다(새 화면은 Task 4). `mutation-guard.exceptions.ts` 에 지운 훅이 있으면 그 줄도.
- [ ] **Step 4: 통과** — 위 spec + `npm run test:admin-web -- --testPathPattern=lib/auth`(게이트) + `(cd apps/admin-web && npx tsc --noEmit)`
- [ ] **Step 5: Commit** — `K3 PR7 — admin-web 직배 클라이언트·훅을 입점사 라우트로, 옛 업체 이름 화면 삭제`

### Task 4: admin-web — 「직배 운영」 화면 다섯 탭

**Files:**
- Modify: `apps/admin-web/src/features/order/direct-ship/template/index.tsx`
- Create: `apps/admin-web/src/features/order/direct-ship/components/supplier-picker/index.tsx`
- Create: `…/components/pending-panel/index.tsx` · `…/components/handoffs-panel/index.tsx` · `…/components/upload-panel/index.tsx` · `…/components/unfulfillable-panel/index.tsx`
- Create: `…/components/export-reason-dialog/index.tsx`
- Modify: `…/components/cancel-notices/{index.tsx,cancel-notice-view.ts,cancel-notice-view.spec.ts}` — `groupByCompany` → `groupBySupplier`(키 `supplierId`, 표시 `companyName`)
- Create: `…/lib/unfulfillable-rows.ts` (+ `.spec.ts`)
- Modify: `apps/admin-web/src/lib/utils/menu.ts` — 메뉴 이름 «직배 운영»

**Interfaces:**
- Consumes: Task 3 의 훅·순수 함수 전부.
- Produces: `unfulfillableRows(shipments: SupplierQueueShipment[]): UnfulfillableRow[]` — `{ shipmentLineId, salesOrderId, orderNo, skuName, supplierSku, qty, reason, reportedAt }`, 사유 있는 라인만, `reportedAt` 오래된 순. `groupBySupplier(rows, now): { supplierId; companyName; rows; overdueCount }[]` — 이름순.

화면 동작(N2·N3·N10·N11·N12):
- **입점사 고르기:** 요약 칩 `이름 · 대기 n · 넘김 n · 못 보냄 n`(0 인 수는 숨김). 고르지 않았고 요약이 하나 이상이면 첫 번째. 요약이 비면 «열린 직배 상자가 없습니다.»
- **대기:** 상자 표(주문번호·상품·수량·열린 시각). 버튼 «시트 내려받기(넘김)» → 사유 다이얼로그 → `useHandOffToSupplier` → `sheetDownloadDecision` → 통과면 `downloadSupplierSheet`. `skippedShipments` 가 있으면 토스트가 아니라 **패널 안 경고 상자**로 «받는 분 정보가 빠진 상자 n개는 넘기지 않았습니다» + 상자 id 목록(대기로 남는다). 409 `SUPPLIER_HANDOFF_EMPTY`·`SUPPLIER_HANDOFF_RECIPIENT_INCOMPLETE` 는 `getServerDenyMessage` 로.
- **넘긴 것:** 묶음 표(넘긴 시각·넘긴 사람·열림·발송·못 보냄) + 줄마다 «다시 받기»(같은 사유 다이얼로그 → `useRedownloadHandoffSheet`).
- **올리기:** 파일 고르기(.xlsx) → «미리보기» → 판정 수 줄 + 표(행 번호·주문번호·판정·오류 문구·택배사·송장번호), 오류 줄 먼저 → «적용». 결과는 «발송 n상자» + 판정 수. STALE 은 N10 문구.
- **못 보냄:** `useSupplierShipments(id, 'forwarded')` → `unfulfillableRows` → 표 + N11 머리 문구.
- **알릴 취소:** 지금 패널, 묶음 키만 `supplierId`.

- [ ] **Step 1: 실패 테스트** — `unfulfillableRows`: 사유 없는 라인 제외, 두 상자에 걸친 라인을 `reportedAt` 순으로; `groupBySupplier`: 이름이 같은 입점사 둘(서로 다른 id)이 **두 묶음**으로 남는다.
- [ ] **Step 2: 실패 확인 → Step 3: 구현** — 판정은 Task 3·이 과제의 순수 함수만 부른다.
- [ ] **Step 4: 통과** — `npm run test:admin-web -- --testPathPattern=direct-ship` + 게이트(`lib/auth`) + admin-web tsc.
- [ ] **Step 5: 화면 확인(사람)** — 로컬 E2E(`npm run start:all:local`, 브라우저 로그인은 사용자가)에서 직배 공급사·직배 SKU·주문 하나로: 대기 → 내려받기 → 파일 열어 머리글·앞자리 0 확인 → 송장 채워 올리기 → 미리보기 → 적용 → 넘긴 것의 수. 못 하면 PR 본문에 «화면 미검증»으로 적는다.
- [ ] **Step 6: Commit** — `K3 PR7 — 직배 운영 화면: 입점사별 대기·넘긴 것·올리기·못 보냄·알릴 취소`

### Task 5: admin-web — 상자 상세의 입점사 상자, 정체 보드 문구

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/fulfillment.ts` — `ShipmentAdminSummary`·`ShipmentAdminDetail` 의 `warehouseId: string | null`, `supplierId: string | null`
- Create: `apps/admin-web/src/features/order/fulfillments/detail/shipment-owner.ts` (+ `.spec.ts`)
- Modify: `…/detail/shipment-tab.tsx`, `…/detail/shipment-actions.tsx`
- Modify: `apps/admin-web/src/lib/api/domains/orders/order-progress.shape.ts` — `drop_ship_unfulfillable: '직배 못 보냄'`

**Interfaces:**
- Produces: `shipmentActionsFor(shipment: { supplierId: string | null }): readonly ('split' | 'recipient' | 'plan' | 'recall')[]` — 입점사 상자면 `['recall']`, 아니면 넷 다. `recallConfirmText(isSupplier: boolean): string` — 창고면 지금 문구 그대로, 입점사면 N7 문구. `ownerLabel(shipment, supplierName: string | undefined): string` — 창고 `창고 ab12…`, 입점사 `입점사 <이름>`(이름 모르면 `입점사 ab12…`).

- [ ] **Step 1: 실패 테스트** — 위 세 함수, 입점사·창고 각 한 케이스. `warehouseId` 가 null 인 창고 상자는 없다고 가정하지 말고 `supplierId` 만으로 가른다.
- [ ] **Step 2: 실패 확인 → Step 3: 구현** — 입점사 이름은 `useSuppliers({ isDirectDelivery: true, limit: 100 })` 에서 찾는다. 라인 표의 예약 칸은 입점사 상자면 `—`.
- [ ] **Step 4: 통과** — 이 spec + 게이트 + admin-web tsc. `warehouseId` 를 `string` 으로 쓰던 곳이 tsc 로 드러나면 그 자리에서 null 을 처리한다(`shortId` 는 이미 null 을 받는다).
- [ ] **Step 5: Commit** — `K3 PR7 — 상자 상세가 입점사 상자를 입점사로 그리고 되돌리기만 연다, 정체 보드 «직배 못 보냄»`

### Task 6: admin-web — SKU 폼 직배 입점사

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/inventory.ts` — `SupplierFiltersDto.isDirectDelivery?: boolean`
- Create: `apps/admin-web/src/features/inventory/skus/lib/direct-supplier-requirement.ts` (+ `.spec.ts`)
- Modify: `apps/admin-web/src/features/inventory/skus/components/sku-form-dialog/index.tsx`

**Interfaces:**
- Consumes: Task 1 의 `isDirectDelivery` 필터.
- Produces:
  - `directSupplierMissing(input: { original: DirectState | null; stockType: string; directSupplierId: string }): boolean` — `DirectState = { stockType: string; directSupplierId: string }`(`''` = 없음). `original` 이 있고 둘 다 같으면 false; 아니면 `stockType === 'drop_shipped' && !directSupplierId`. 주석은 core `sku-direct-supplier.rule.ts` 를 가리킨다.
  - `supplierIdsPayload(input: { linkedSupplierIds: string[]; directSupplierIds: ReadonlySet<string>; originalDirectSupplierId: string; directSupplierId: string; stockType: string }): { supplierIds: string[] } | {}` — `stockType !== 'drop_shipped'` 이거나 고른 값이 원래와 같으면 `{}`; 아니면 `linkedSupplierIds` 에서 직배 공급사를 빼고 고른 입점사를 더한 목록.

폼: 재고 유형이 «직배»일 때만 «직배 입점사» 선택이 뜬다(필수 표시). 원래 값 = SKU `suppliers` 중 직배 목록에 있는 첫 id. 직배 공급사가 하나도 없으면 «직배 공급사가 없습니다 — 공급사 화면에서 ‘직배’로 등록하세요»와 `/inventory/suppliers` 링크(배송 프로필 칸과 같은 모양). 서버 400 `SKU_DIRECT_SUPPLIER_REQUIRED` 는 칸 오류로.

- [ ] **Step 1: 실패 테스트**
  - `directSupplierMissing`: 생성 직배+빈 값 → true; 생성 사입 → false; 수정 옛 직배(원래도 빈 값, 유형 그대로) → false; 수정 사입→직배+빈 값 → true.
  - `supplierIdsPayload`: 연결 `['n1','d1']`(d1 직배), 고른 `d2` → `{ supplierIds: ['n1','d2'] }`; 고른 값이 원래 `d1` 그대로 → `{}`; 유형이 `physical` → `{}`; 생성(연결 `[]`) 고른 `d1` → `{ supplierIds: ['d1'] }`.
- [ ] **Step 2: 실패 확인 → Step 3: 구현 → Step 4: 통과** — 이 spec + 기존 `delivery-profile-requirement.spec.ts` + admin-web tsc.
- [ ] **Step 5: Commit** — `K3 PR7 — SKU 폼: 직배면 직배 입점사 하나, 비직배 공급사 연결은 보존`

### Task 7: 문서·최종 검증

**Files:**
- Modify: `docs/superpowers/specs/2026-10-25-k3-drop-ship-supplier-shipments-design.md` — 끝에 «PR 8 구현자에게(PR 7 이 정한 것)»: admin-web 이 옛 `/direct-ship/{dashboard,companies,orders…,export…}` 를 더는 부르지 않는다(지워도 된다), FO 목록의 `drop_ship` 배지·`fo-status-cell` 라벨·`FulfillmentMode` 의 `drop_ship` 은 FO 모드를 걷을 때 같이, N9 공급사 상품코드는 미결. 이 PR 이 손대지 않은 둘: ① 섞인 FO 에서 라인 구성 편집 버튼(`canEditLineComposition`, FO 모드로만 가른다)이 입점사 라인에도 떠서 서버가 `DROP_SHIP_NOT_SUPPORTED` 로 거절한다 ② 직배 목록은 상자 단위 주문 칸만 내 되돌린 합포장 상자가 대기에 다시 오면 주문 하나로만 보인다.
- Modify: `apps/admin-web/src/lib/api/domains/orders/direct-ship.client.ts` 머리 주석(⚠️ 옛 줄들) — 지금 사실로

- [ ] **Step 1: 전체 게이트** — `npm run type-check`·`npx jest`·`(cd apps/admin-web && npx tsc --noEmit)`·`npm run test:admin-web`. 실패는 기준선(attendance 4개)만.
- [ ] **Step 2: 남은 옛 호출 0 확인** — `grep -rnE "orders/forward|orders/complete|export/file'|/dashboard|companies" apps/admin-web/src/lib/api/domains/orders/direct-ship.client.ts` → 출력 없음.
- [ ] **Step 3: Commit** — `K3 PR7 — 문서: PR 8 에 넘기는 것`
