# PR-A: 스테이션 업무와 PC 입력 Implementation Plan

## 실행 결과 — 2026-09-15

- [x] A1–A6: 구현, 실패 재현/회귀 검사, 독립 검토, 로컬 커밋 완료.
- [x] 실제 React→HTTP→전용 DB에서 해당 업무와 원장을 대사했다.
- [x] 최종 앱404테스트/서버172테스트, 타입 검사·빌드 통과. lint 경고와 기존 서버 lint 오류는 별도 기록했다.
- [ ] 실제 Windows·로그인·HID·네이티브 장애 복구·실물 대사.
- [ ] Push·PR·병합·배포는 별도 진행.

실제 결과와 한계는 [재고 정확성 합격 검사 기록](../../../native/warehouse-app/docs/inventory-accuracy-acceptance.md)의 “스테이션 단독 물류 운영” 절을 따른다. 아래 상세 체크리스트는 실행 전 계획 원문이다. 커밋은 작업별 기능과 검토 보완으로 묶었으며 예시 커밋 메시지와 개수는 다를 수 있다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 이 계획은 같은 작업에서 순차 실행할 수 있다. 별도 작업 생성이나 서브에이전트가 필수는 아니다.

**Goal:** Windows에서 스캔 없이 입고·적치·이동·실사를 완료할 수 있게 한다.

**Architecture:** 기존 화면과 영속 실행기를 재사용한다. 공통 SKU 선택기와 키보드 수량 입력을 추가하고, 실사 신규 SKU 입력에만 서버 API를 추가한다.

**Tech Stack:** React 19, TypeScript, TanStack Query/Router, Tauri 2, Vitest, NestJS, Drizzle, PostgreSQL, Jest.

**Spec:** [스테이션 단독 물류 운영 설계](../specs/2026-09-15-station-operations-design.md)

**Repository:** `/home/pauseb/workspace/almondyoung-server`; 조사 기준 `df44cf4fb`. 실행 시작 시 최신 develop과 차이를 확인한다. 아래 파일 경로는 저장소 루트 기준이다.

## Global Constraints

- 초기 운영 대상은 Windows 스테이션이며 핸드헬드 사용을 전제하지 않는다.
- 모든 수량은 낱개 정수다. 입고·적치·이동은 1 이상, 실사 총수량은 0 이상이다.
- 발주입고와 간편입고의 출처 및 발주 잔량 처리를 유지한다.
- 입고는 기존 입고기본존 등록 후 적치 모델을 유지한다.
- 재고 변경은 기존 영속 작업 실행기, 원래 요청 본문과 키, 계정/API 범위, 서버 권한 검증을 사용한다.
- 저장 실패·결과 미확인 중 새 확정·편집·의미가 바뀌는 화면 이동을 차단한다.
- 검색은 재고를 변경하지 않는다. 이전 검색의 결과를 새 선택에 사용하지 않는다.
- 일반 화면에는 필요한 행동 안내만 표시한다. 요청·응답·키 등 기술 정보는 권한이 있는 개발자 모드에만 표시한다.
- 기존 출고·입고·실사 미확인 작업의 경로·본문·키를 새 계약으로 바꾸어 재전송하지 않는다.
- 서버의 기존 API 기본 동작을 호환 유지하고 새 계약은 서버부터 배포한다.
- 테스트 데이터 변경은 별도의 로컬 DB에서만 수행한다. 운영 데이터와 기존 테스트 DB를 초기화하지 않는다.
- 실제 Windows 설치·로그인·HID 스캔·장애 복구 검증을 모의 테스트 통과로 대체하지 않는다.


## 실행 준비

- [ ] 현재 작업 변경을 확인한 뒤 `superpowers:using-git-worktrees`에 따라 실행용 checkout을 분리한다. 이 문서만을 이유로 develop에 제품 코드를 직접 수정하지 않는다.
- [ ] 이 설계와 해당 계획을 실행 checkout의 `docs/superpowers/specs/2026-09-15-station-operations-design.md`, `docs/superpowers/plans/2026-09-15-01-station-workflows.md`에 복사해 구현과 함께 관리한다.
- [ ] 로컬 DB가 필요한 검사에는 실행 checkout의 무시되는 `work/station-local.env`에 `STATION_TEST_DATABASE_URL`을 설정한다. localhost/127.0.0.1의 신규 `warehouse_station_20260915` DB만 허용하고 스키마를 적용한다. 실행 전 URL의 호스트·DB 이름만 출력해 확인한다. 기존 DB를 reset하지 않는다.
- [ ] 각 기능 작업은 실패 재현 → 최소 구현 → 해당 검사 통과 → 검토 → 로컬 커밋 순서로 실행한다. 버튼 문구 등 낮은 위험의 단순 편집을 위한 독립 테스트는 만들지 않는다.
- [ ] Push·PR 생성·병합·운영 배포는 사용자의 해당 지시에 따라 별도로 진행한다. 계획상 PR 명칭은 변경 묶음의 이름이다.

---

## 파일 구성과 작업 경계

| 단위 | 파일 | 역할 |
|---|---|---|
| 스테이션 메뉴 | `native/warehouse-app/src/profiles/station/StationHome.tsx` | 기존 업무 진입 링크 |
| 상품 선택 | `native/warehouse-app/src/domains/inventory/SkuPicker.tsx` (신규) | 이름·코드 검색, 페이지, 명시적 선택 |
| 수량 입력 | `native/warehouse-app/src/core/design/QuantityInput.tsx` (신규) | PC 숫자 문자열 입력과 정수 검증 |
| 입력 구분 | `native/warehouse-app/src/core/hardware/scan/ScanProvider.tsx` | 텍스트 편집과 HID 입력의 중복 소비 방지 |
| 간편입고 | `native/warehouse-app/src/domains/inbound/QuickInboundScreen.tsx` | 수동 상품 선택을 기존 초안에 저장 |
| 기존 작업 폼 | `ReceiveSheet.tsx`, `PutawaySheet.tsx`, `MovementScreen.tsx`, `SessionCountScreen.tsx` | 키보드 입력과 PC 안내 |
| 실사 신규 품목 | `apps/core/src/modules/inventory/stocktaking/dto/add-count-item.dto.ts` (신규) | SKU ID 기반 최초 카운트 계약 |
| 실사 카운트 | `stocktaking.service.ts`, `stocktaking.controller.ts` | 잠금·멱등·revision을 지키는 신규 행 추가 |
| 실사 UI | `native/warehouse-app/src/domains/stocktaking/AddCountItemDialog.tsx` (신규) | 바코드 없는 상품과 실제 총수량 입력 |
| 복구 계약 | `operationRunner.ts`, `operationResult.ts` | 새 실사 요청의 영속/재확인/결과 검사 |

### Task A1: 스테이션에서 기존 업무에 진입

**Files:** Modify `native/warehouse-app/src/profiles/station/StationHome.tsx`; Test `native/warehouse-app/src/app/router.test.tsx`; Modify `native/warehouse-app/src/app/routes/SettingsRoute.tsx`.

**Interfaces:** 기존 `/inbound`, `/putaway`, `/movement`, `/stocktaking` 경로를 사용한다. 프로필 resolver와 경로 자체는 바꾸지 않는다.

- [ ] 기존 router 테스트의 `makeStub`, `renderApp` 안에서 Windows 메뉴를 검증한다. 기존 helper를 그대로 사용한다.

```tsx
const { session, setAuthed } = makeStub();
setAuthed(true);
renderApp(session);
for (const name of ['입고', '적치', '이동', '실사']) {
  expect(await screen.findByRole('link', { name })).toBeInTheDocument();
}
expect(screen.queryByRole('link', { name: '출고조회' })).toBeNull();
```

- [ ] Run `corepack yarn --cwd native/warehouse-app test src/app/router.test.tsx`. 누락된 메뉴 때문에 실패하는지 확인한다.
- [ ] StationHome에 아래와 같이 실제 경로 링크를 추가한다. 설정의 창고 설명은 입고·적치·이동·실사 작업을 포함하도록 수정한다.

```tsx
<Link to="/inbound"><HubTile icon={PackagePlus} label="입고" /></Link>
<Link to="/putaway"><HubTile icon={ClipboardList} label="적치" /></Link>
<Link to="/movement"><HubTile icon={ArrowLeftRight} label="이동" /></Link>
<Link to="/stocktaking"><HubTile icon={ClipboardCheck} label="실사" /></Link>
```

- [ ] 같은 명령과 `src/app/router.handheld.test.tsx`를 실행한다. 기존 핸드헬드 링크를 제거하지 않았음을 확인한다. 로컬 커밋: `feat(warehouse-app): expose station inventory workflows`.

### Task A2: SKU 선택기·키보드 수량·입력 구분

**Files:** Create `native/warehouse-app/src/domains/inventory/SkuPicker.tsx`, `SkuPicker.test.tsx`; Create `native/warehouse-app/src/core/design/QuantityInput.tsx`, `QuantityInput.test.tsx`, `native/warehouse-app/src/core/hardware/scan/BarcodeInput.tsx`, `BarcodeInput.test.tsx`; Modify/Test `native/warehouse-app/src/core/hardware/scan/ScanProvider.tsx`, `ScanProvider.test.tsx`.

**Interfaces (new):**

```ts
export type SelectedSku = Pick<SkuSearchItem, 'id' | 'code' | 'name' | 'optionKey'>;
export interface SkuPickerProps {
  disabled?: boolean;
  onSelect: (sku: SelectedSku) => void;
}
export interface BarcodeInputProps {
  label: string;
  disabled?: boolean;
  onSubmit: (code: string) => void;
}
export interface QuantityInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: 0 | 1;
  max?: number;
  disabled?: boolean;
}
export function parseQuantity(text: string, min: number, max = 2147483647): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}
```

- [ ] 수량 경계와 실제 폼 동작을 검증한다. 검색은 `useSkuSearch({search, limit:20, offset, sortBy:'code', sortOrder:'asc'})`를 사용하며 이전 조회 후보 선택을 거절하는 검사를 추가한다. 수량 경계 예시는 다음과 같다.

```ts
expect(parseQuantity('', 1)).toBeNull();
expect(parseQuantity('1.5', 1)).toBeNull();
expect(parseQuantity('1e3', 1)).toBeNull();
expect(parseQuantity('0', 0)).toBe(0);
expect(parseQuantity('0', 1)).toBeNull();
expect(parseQuantity('2147483648', 0)).toBeNull();
```

- [ ] Run `corepack yarn --cwd native/warehouse-app test src/core/design/QuantityInput.test.tsx src/domains/inventory/SkuPicker.test.tsx src/core/hardware/scan/ScanProvider.test.tsx src/core/hardware/scan/BarcodeInput.test.tsx`. 미구현에 따른 실패인지 확인한다.
- [ ] QuantityInput은 `type="text" inputMode="numeric"`의 문자열 편집으로 구현한다. 빈 값을 0으로 바꾸지 않고 유효하지 않으면 확정을 막는다. SkuPicker에는 검색 폼, 상품명·코드·옵션, 20건 페이지, 선택 버튼을 제공한다. `isFetching || isPlaceholderData || isError` 동안 후보 선택을 막는다.
- [ ] ScanProvider에서 편집 대상을 판별한다. 입력 필드에 들어갈 때와 나올 때 스캔 버퍼를 초기화해 검색어 일부가 다음 스캔에 섞이지 않게 한다. 수량·검색·메모 편집 중에는 전역 스캔을 발행하지 않는다. 전용 스캔 필드의 명시적 제출과 일반 화면의 HID 수신은 각각 한 번만 처리한다.

```ts
const target = ev.target;
const editing = target instanceof HTMLElement &&
  (target.isContentEditable || !!target.closest('input, textarea, select'));
if (editing) { buffer.reset(); return; }
```

- [ ] BarcodeInput은 전용 폼의 submit에서 preventDefault 후 trim한 code를 onSubmit으로 한 번만 전달한다. 일반 검색창과 구별되는 “바코드 입력” 레이블을 사용한다. 간편입고·실사 상품 입력·단순출고에는 이 컴포넌트를 붙여, 입력 포커스를 유지한 HID 스캔도 계속 받을 수 있게 한다. 간편입고 onSubmit은 기존 scanQueue.enqueue, 실사는 acceptScan, 출고는 기존 useScanner와 동일한 접수 함수로 연결한다.
- [ ] HID 방식 연속 키+Enter가 일반 화면에서 스캔 1회, 검색 필드에서는 전역 스캔 0회를 발생시키는지 검사한다. 상품 검색 Enter가 입고 등록 버튼을 누르지 않는지 검사한다. 기존 NumberPad는 유지하고 호출 화면에서 숫자 입력란을 함께 사용할 수 있게 한다.
- [ ] 검사를 다시 실행하고 로컬 커밋: `feat(warehouse-app): add station product and quantity inputs`.

### Task A3: 간편입고와 발주 수령의 PC 경로

**Files:** Modify `native/warehouse-app/src/domains/inbound/QuickInboundScreen.tsx`, `PurchaseOrderReceiveScreen.tsx`, `ReceiveSheet.tsx`, `ExpectedArrivalListScreen.tsx`; Tests `QuickInboundScreen.test.tsx`, `PurchaseOrderReceiveScreen.test.tsx`, `ReliabilityReview.test.tsx`.

**Consumes:** A2의 SelectedSku, SkuPicker, QuantityInput, parseQuantity. 기존 `useWorkDraft`, `useWorkScanQueue`, `useSimpleInbound`, `useReceivePurchaseOrder`.

- [ ] 상품 검색으로 두 SKU를 추가하고 10·3개 입력한 요청이 정확히 `{warehouseId, items:[{skuId,quantity}], idempotencyKey}`를 보내는 화면 검사를 추가한다. 같은 SKU 재선택은 중복 행/수량 증가가 아니라 기존 행 편집이어야 한다. 발주입고는 `/purchase-orders/:poId/receipts`만 호출하는지 검사한다.
- [ ] Run `corepack yarn --cwd native/warehouse-app test src/domains/inbound/QuickInboundScreen.test.tsx src/domains/inbound/PurchaseOrderReceiveScreen.test.tsx src/domains/inbound/ReliabilityReview.test.tsx`.
- [ ] 수동 선택을 기존 cart draft에 넣는 단일 함수를 만든다. 서버로 별도 우회 요청을 하지 않는다. draft 저장에 실패한 수동 수량은 편집창에 보존하고 확정을 막는다. 저장이 성공하기 전에 모달을 닫거나 성공 표시를 하지 않는다.

```ts
async function addSelectedSku(sku: SelectedSku) {
  if (!draft.ready || scanQueue.blocked() || submit.isPending || stagedMode) return;
  const current = await draft.read();
  if (!current.cart.some(row => row.skuId === sku.id)) {
    await setCart(rows => rows.some(row => row.skuId === sku.id) ? rows : [...rows, {
      skuId: sku.id, skuCode: sku.code, skuName: sku.name, quantity: 1,
    }]);
  }
  setEditing(sku.id);
}
```

- [ ] 수동 수량 편집부터 저장 완료까지 스캔 접수를 막고 편집 중임을 안내한다. 이미 스캔이 대기 중이면 수동 편집을 시작하지 않는다. 상품 검색 선택과 스캔이 같은 수량을 중복 집계하지 않게 한다.
- [ ] 간편입고는 1개 초기값, 발주 수령은 기존 잔량 제안을 유지한다. 입력한 값의 검증에 성공할 때만 기존 draft/mutation으로 전달한다. “입고는 완료되었으며 적치는 나중에 가능” 문구와 적치 대기 링크를 제공한다. 전량 스캔 또는 검수 완료 플래그를 새로 요구하지 않는다.
- [ ] 저장 실패 후 복구, 응답 유실 후 같은 입고 1건 복원, 포장 단위 스캔을 회귀 확인한다. 테스트 통과 후 로컬 커밋: `feat(warehouse-app): support station inbound entry`.

### Task A4: 적치·이동·기존 실사 품목의 PC 입력

**Files:** Modify `native/warehouse-app/src/domains/inbound/PutawaySheet.tsx`, `PutawayQueueScreen.tsx`, `domains/movement/MovementScreen.tsx`, `domains/stocktaking/SessionCountScreen.tsx`; Modify corresponding `*.test.tsx`.

**Consumes:** QuantityInput/parseQuantity. 기존 위치 검색과 수량 변경 mutation. **Produces:** 추가 서버 계약 없이 마우스·키보드로 끝나는 작업 경로.

- [ ] 실제 업무 흐름 검사: 적치 10개 중 3개 입력 → 7개 대기, 이동 A→B 3개, 실사 위치 코드 직접 입력 → 기존 품목 0개 저장. NumberPad를 클릭하지 않고 userEvent.clear/type으로 수행한다.
- [ ] Run `corepack yarn --cwd native/warehouse-app test src/domains/inbound/PutawaySheet.test.tsx src/domains/movement/MovementScreen.test.tsx src/domains/stocktaking/SessionCountScreen.test.tsx`.
- [ ] 수량 문자열은 저장할 때만 정수로 변환한다. 빈 값·소수·초과 수량이면 확정을 막고 기존 상한과 scanQueue.blocked/WorkArea 보호를 유지한다. 위치 검색과 직접 코드 입력은 기존 API를 사용한다. 실사에는 useLocationSearch 후보를 추가하고 선택한 code를 기존 enterLocation에 전달한다.

```ts
const quantity = parseQuantity(quantityText, 1, target.pendingQty);
const canConfirm = quantity !== null && !!dest && !putaway.isPending;
// 확정할 때 기존 usePutaway({ lineId, toLocationId, quantity, idempotencyKey })를 사용.
```

- [ ] 실사 `0`과 미입력의 구분, revision과 최신 previewToken에 따른 완료 제어를 유지한다. 위치·수량 변경 후 이전 확인 모달로 제출할 수 없는지 검사한다.
- [ ] 관련 검사를 다시 실행하고 로컬 커밋: `feat(warehouse-app): enable keyboard stock workflows`.

### Task A5: 바코드 없는 실사 신규 SKU의 서버 계약

**Files:** Create `apps/core/src/modules/inventory/stocktaking/dto/add-count-item.dto.ts`; Modify `services/stocktaking.service.ts`, `controllers/stocktaking.controller.ts`; Create `services/stocktaking-add-count-item.integration.spec.ts`; Modify `apps/core/src/modules/inventory/core/controllers/warehouse-work-context.controller.ts` and `controllers/warehouse-operation-auth.spec.ts`.

**New contract:** `POST /stocktaking/count-items`, HTTP 200. 기존 바코드 scan-product는 그대로 유지한다.

```ts
interface AddCountItemInput {
  sessionId: string;
  locationId: string;
  skuId: string;
  countedQuantity: number; // 총수량, 0 이상. 증가 연산 아님.
  contractVersion: 2;
  idempotencyKey: string;
}
// 응답은 기존 countResponse(line, sessionRevision)와 동일한 필드.
// work-context에 capabilities: { stocktakingAddCountItem: true }를 부가한다.
```

- [ ] 로컬 전용 DB에서 상품 바코드가 없는 SKU·장부에 없는 위치별 재고를 fixture로 만든다. 신규 카운트 2 → 행 1개/실물수량 2, 요청 재생 2 → 여전히 행 1개/2, 본문 변경 같은 키 409를 검증한다. 기존 행이 있으면 409 `STOCKTAKING_REVISION_CONFLICT`, 다른 창고/비활성 위치/종결 세션은 거절, 0은 허용, 음수·소수·정수 범위 초과는 거절한다.
기존 `stocktakingHarness`로 만든 h와 fixture를 사용하는 핵심 테스트 예시:

```ts
const f = await h.seed(0);
await h.db.delete(wmsTables.skuBarcodes).where(eq(wmsTables.skuBarcodes.skuId, f.sku.id));
const input = { sessionId: f.session.id, locationId: f.otherLocation.id,
  skuId: f.sku.id, countedQuantity: 2, contractVersion: 2 as const,
  idempotencyKey: randomUUID() };
const first = await h.controller.addCountItem(input, h.actor);
const replay = await h.controller.addCountItem(input, h.actor);
expect(replay).toEqual(first);
expect(first.countedQuantity).toBe(2);
await expect(h.controller.addCountItem({ ...input, idempotencyKey: randomUUID() }, h.actor))
  .rejects.toMatchObject({ response: expect.objectContaining({ code: 'STOCKTAKING_REVISION_CONFLICT' }) });
```

StocktakingConflict는 Nest ConflictException의 response.code를 검사한다. fixture는 `services/__fixtures__/stocktaking-harness.ts`에서 가져오며 afterAll에서 h.sql을 닫는다.

- [ ] Run `DATABASE_URL="$STATION_TEST_DATABASE_URL" corepack yarn test --runInBand --runTestsByPath apps/core/src/modules/inventory/stocktaking/services/stocktaking-add-count-item.integration.spec.ts`. 새 계약 부재 실패를 확인한다. skip은 통과로 세지 않는다.
- [ ] DTO는 WarehouseOperationDto를 상속한다. UUID·정수·최댓값을 검증한다. 컨트롤러는 OPERATE 권한과 인증 actor를 요구하고 endpoint `stocktaking.add-count-item.v2`로 기존 withIdempotency를 사용한다. service에 `addCountItem(dto, tx?)`를 추가한다.

```ts
// 서비스 트랜잭션의 필수 순서
const session = await this.assertInProgress(trx, dto.sessionId);
await this.assertLocation(trx, dto.locationId, session.warehouseId);
await acquireStockAvailabilityLocks(trx, [{ skuId: dto.skuId, warehouseId: session.warehouseId }]);
// SKU 존재 확인 → 동일 session/sku/location 행을 FOR UPDATE로 조회.
// 존재하면 revision conflict. 없으면 readLedger와 같은 baseline 규칙으로 행을 INSERT.
// countedQuantity=dto.countedQuantity, expectedQuantity=ledger.qty,
// variance=dto.countedQuantity-ledger.qty, countBaselineVersion=ledger.version,
// status='counted', countedAt/updatedAt=현재시각. countResponse + bumpSession 반환.
```

- [ ] 동일 SKU/위치 동시 추가 두 건에서 1건만 성공하도록 기존 세션/재고 잠금과 유니크 제약을 사용한다. 기존 행을 upsert로 덮어쓰지 않는다. API는 재고 원장을 수정하지 않으며 실사 완료에서만 조정한다.
- [ ] 기존 `stocktaking-count-version`, `stocktaking-preview-token`, `stocktaking-complete` DB 회귀도 실행한다. 로컬 커밋: `feat(inventory): add SKU-based stocktake entry`.

### Task A6: 실사 신규 품목 UI와 영속 복구

**Files:** Create `native/warehouse-app/src/domains/stocktaking/AddCountItemDialog.tsx`, `AddCountItemDialog.test.tsx`; Modify `SessionCountScreen.tsx`, `mutations.ts`, `types.ts`, `core/operations/operationRunner.ts`, `operationResult.ts`; Modify `native/warehouse-app/src/core/data/ApiClientProvider.tsx`, `core/operations/OperationContext.tsx` and associated tests.

**Interfaces:** `useAddCountItem()` accepts A5 body without server-injected contractVersion/key and returns `ScanProductResult` including current revision. `AddCountItemDialog` consumes `{sessionId, locationId, onDone, onCancel}` and fixes location at open time.

- [ ] A5 응답을 모의한 화면 검사: 상품 검색→바코드 없는 SKU 선택→2 입력→추가→새 행 표시. 저장/서버 응답 미확인 중 위치 전환과 재확정 금지. 새 행 중복 409이면 최신 위치 내용을 다시 읽고 기존 수량 편집으로 안내한다.
- [ ] Run `corepack yarn --cwd native/warehouse-app test src/domains/stocktaking src/core/operations`.
- [ ] dialog의 수동 입력 draft와 실행 결과를 기존 영속 저장소에 보존한다. 새 endpoint를 ledgerPath에 추가하고 기존 stocktaking resource(sessionId)로 묶는다. operationResult에 카운트 응답 검증을 추가한다. 기존 경로는 변경하지 않는다.

```ts
// operationRunner ledgerPath에 /stocktaking/count-items를 추가.
// operationResult 카운트 응답 분기에 다음 조건을 추가.
path === '/stocktaking/count-items'
// mutation 성공/실패 후 query invalidation:
// ['stocktaking-session', sessionId], ['stocktaking-variances', sessionId]
```

- [ ] WorkRuntime에 아래 getter를 추가하고 ApiClientProvider가 현재 토큰의 work-context를 새로 조회해 반환하도록 구현한다. actor가 현재 boundScope와 다르면 거절한다. capabilities는 token 변경을 넘어 재사용하지 않는다.

```ts
interface WorkCapabilities { stocktakingAddCountItem?: boolean; }
// WorkRuntime의 신규 optional 메서드. 미제공은 미지원으로 처리한다.
getCapabilities?: () => Promise<WorkCapabilities>;
```

- [ ] runtime/store/서버 capabilities를 검사해 미지원 서버에서는 추가 확정을 막고 업데이트 안내한다. 기술 필드명은 작업자 화면에 표시하지 않는다. 기존 행 수정과 scan-product에는 영향을 주지 않는다.
- [ ] 창을 다시 열어 결과를 복원했을 때 새로운 키로 2개를 또 추가하지 않는 검사를 실행한다. 카운트 완료와 원장 대사 후 로컬 커밋: `feat(warehouse-app): support manual stocktake items`.

## PR-A 최종 검증과 완료 조건

- [ ] `corepack yarn --cwd native/warehouse-app test` — 모든 기존/신규 앱 테스트, 오류와 skip 확인.
- [ ] `corepack yarn --cwd native/warehouse-app build` 및 `corepack yarn --cwd native/warehouse-app lint` — 경고는 별도 기록.
- [ ] `corepack yarn tsc --noEmit -p apps/core/tsconfig.app.json` — Core 타입 검사.
- [ ] 별도 로컬 서버/DB와 실제 React 화면에서 스캐너 없이 직접입고 10·3, 발주 부분입고, 부분적치, 이동, 기존0/신규2 실사 시나리오를 끝낸다. 각 작업별 원장·회차·실사 행을 대사한다.
- [ ] 일반 입력→HID 스캔 전환, 입력 실패, 응답 유실→재개, 계정 변경 회귀를 기록한다.
- [ ] `git diff --check`; 변경 파일과 설계의 모든 A 요구사항을 직접 대조한다. 모의 Windows UI와 실제 Windows 장비 결과를 구분한다.
- [ ] `native/warehouse-app/docs/inventory-accuracy-acceptance.md`에 이번 변경·실행 명령·결과·미검증 항목을 추가한다.

서버 계약이 추가되므로 배포는 Core → 새 Windows 앱 순서다. 이 단계 완료만으로 입고 기록/취소(B) 또는 출고 위치(C)가 완성됐다고 보고하지 않는다.
