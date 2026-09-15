# 발주 입고 시연 결함 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 물류팀이 발주 입고에서 다른 상품을 잘못 스캔해도 복구하고, 재진입 시 수량을 유지하며, 직접 입력과 스캔을 섞어도 의도한 수량으로 입고하게 한다.

**Architecture:** 기존 발주 입고 화면·영속 스캔 큐·IndexedDB 작업 실행기를 유지한다. 발주 목록의 준비 상태를 입고 초안과 구별하고, 수량의 기준을 화면 로컬 상태에서 저장되는 발주 초안으로 통합한다. 스캔 오류의 복구 조작은 현재 열린 수량 창 안에 둔다.

**Tech Stack:** React, TanStack Query/Router, TypeScript, Vitest, Testing Library, IndexedDB, Tauri. 서버 회귀 확인은 기존 NestJS/Jest/PostgreSQL을 사용한다.

**Spec:** 이 문서의 「설계」와 「합격 기준」. 기존 요구사항은 `native/warehouse-app/docs/inventory-accuracy-acceptance.md`도 참고한다.

**Status:** 2026-09-16 구현 및 로컬 통합 검증 완료. 기준 `9def17e0e` → 코드 `48b675d04`, 브랜치 `codex/po-inbound-demo-fixes`. 앱 511 tests 및 실제 HTTP/DB 입고→적치→이동→출고 재고 대사 통과. Windows/PDA 실기기 항목은 미검증으로 기록한다. 승인된 수량 정책은 **직접 입력 10 + 낱개 스캔 1 = 11**이다.

## Global Constraints

- 작업 수량은 낱개 기준 정수다. 입고 확정은 1 이상 2,147,483,647 이하이며 발주 잔량 이하여야 한다. 빈 입력은 0으로 바꾸지 않는다.
- 같은 상품의 연속 스캔은 각각 독립 이벤트로 보존한다. 포장 바코드는 기존 `scanIncrement`의 포장 단위를 사용한다.
- 미확인 입고 요청은 원래 경로·본문·키와 사용자/API 범위로만 재확인한다. 조회 결과에서 품목이 사라졌다는 이유로 해당 요청의 성공을 추정하지 않는다.
- 이미 전송된 요청이나 저장 실패를 해결하기 위해 IndexedDB·스캔 큐·초안을 일괄 삭제하지 않는다.
- 서버 API, DB 스키마, 권한 정책 변경은 이번 구현에 필요하지 않다. 기존 v2 계약을 그대로 사용한다.
- 변경 범위는 발주 입고다. 간편입고·적치·이동·출고는 회귀 및 시연 검증 대상으로 둔다.
- 명령은 저장소 루트에서 `corepack yarn --cwd native/warehouse-app ...`로 실행한다.
- 구현 시 `superpowers:using-git-worktrees`로 격리된 checkout을 마련한다. 계획 문서와 기준 코드를 실행 checkout으로 함께 가져간다.
- 실제 DB 검사는 localhost/127.0.0.1의 전용 테스트 DB에서만 실행한다. 기존 DB 초기화나 운영 데이터 변경은 하지 않는다.

---

## 근거

직전 점검에서 앱 83 files / 450 tests, 앱 타입 검사·production build, Core 9 suites / 118 tests가 통과했다. 그러나 다음 추가 시나리오를 실제 화면·OperationContext·WorkBoundary·작업 실행기·IndexedDB로 재현했다.

| ID | 우선순위 | 재현 | 원인 |
|---|---|---|---|
| R1 | P1 | A 수량 창에서 같은 발주의 B를 스캔하면 입고·취소가 잠기고 복구 버튼을 클릭하지 못함 | `scanQueue.blocked()`가 수량 창을 잠그지만 오류 조작은 창 밖에 렌더됨 |
| R2 | P1 | 저장된 active 상품/scanBump=3을 복원하는 동안 목록 응답을 지연하면 저장 수량이 0이 됨 | 목록의 미조회 상태를 빈 목록으로 해석하여 `closeSheet()` 실행 |
| R3 | P2 | A 1회 스캔 → 수량 직접 입력 10 → A 추가 스캔 시 수량 2 | `ReceiveSheet`의 로컬 수량을 누적 `scanBump`로 덮어씀 |

R1은 브라우저에서 실제 키 입력 후 마우스 클릭으로도 재현했다. 기존 '다른 품목' 테스트의 9999 바코드는 조회 결과가 빈 미등록 바코드이므로 같은 발주의 다른 SKU 분기를 검증하지 않는다.

검토용 자료는 `/tmp/warehouse-demo-audit-20260915/`에 있다. 임시 자료의 존재를 실행 전제로 삼지 않으며 아래 시나리오를 정식 회귀 테스트에 옮긴다. 이 계획 작성 중 제품 코드나 테스트는 변경하지 않았다.

## 설계

### 선택한 접근

1. **권장: 기존 흐름을 유지하며 상태 소유권과 복구 위치를 고친다.** 화면 두 곳과 발주 입고 전용 상태 로직에 집중한다. 기본 작업법을 바꾸지 않으면서 세 문제를 해결한다.
2. 직접 입력과 스캔을 별도 모드로 나누는 방법은 전환 조작과 확인이 추가된다. 사용자가 모드 분리를 선호할 때 채택한다.
3. 공통 스캔/작업 실행기 전체 교체는 다른 물류 기능의 위험과 검증 범위를 크게 늘리므로 이번 수정에 포함하지 않는다.

### R1 — 열린 수량 창에서 복구

- 정상 A 스캔 후 B 스캔: A 수량을 유지하고 수량 창 안에 “다른 상품을 찍었어요. 현재 상품 수량은 유지됩니다.”와 **이 스캔 제외**를 표시한다. 제외 후 A를 계속 입력/확정할 수 있다. B는 자동 입고하지 않으며 B 작업은 다음에 다시 시작한다.
- 같은 발주에 없는 바코드, 미등록 바코드도 현재 창 안에서 결과를 보여준다. 오류 종류를 일반적인 “상품 확인 실패” 하나로 숨기지 않는다.
- 바코드 조회 통신 실패: 수량 창 안의 **다시 확인**으로 원래 이벤트를 재처리한다. 성공 시 한 번만 더한다.
- 제외는 “아직 초안에 적용하지 않은 것으로 확인된 잘못된 스캔”에만 허용한다. 저장 실패·초안 반영 여부 미확인·입고 전송 결과 미확인에는 제외하지 않는다.
- 제외/재시도 자체의 저장 실패도 창 안에 표시하고 같은 이벤트를 보존한다. 오류 처리 중 중복 클릭은 막는다.
- 복구 버튼은 수량 입력 fieldset 밖에 둔다. 수량 창에 오류가 있으면 창 밖에 중복 복구 조작을 만들지 않는다. 수량 창이 없을 때는 페이지 안에서 같은 복구 UI를 쓴다.
- 정상 처리 중에는 기존 입력 잠금을 유지한다. 잘못된 스캔을 해결하지 않은 채 입고 확정을 허용하지 않는다. 화면 뒤 요소를 Tab으로 찾아 누르는 것을 정상 복구 방법으로 삼지 않는다.

### R2 — 복원과 목록 조회를 분리

- 초안 복원, 발주 목록 조회, 원래 입고 요청의 결과 확인을 각각 판단한다. 목록 로딩·오류는 “해당 상품 없음”이 아니다.
- 목록 로딩·오류 중 active 상품, 수량, seen 이벤트, 제출 키를 유지한다. “발주 정보를 확인하고 있어요” 또는 재조회 버튼을 수량 창 안에 보여주고 확정은 막는다.
- 저장된 스캔 큐의 소비도 초안 및 발주 목록이 준비된 뒤 시작한다. 목록이 없는 렌더의 `lines=[]`로 복원 스캔을 미등록 처리하고 제거하지 않는다. 대기 중 접수한 입력은 순서를 보존한다.
- 최신 목록을 정상 조회했는데 상품이 없거나 잔량이 줄었다면 기존 수량을 보존하고 “발주 상태가 바뀌었어요. 입고내역을 확인해 주세요.”를 표시한다. 자동 취소·자동 수량 축소를 하지 않는다.
- 해당 작업의 서버 성공이 확인되면 현재처럼 적치 대상으로 전환한다. 다른 작업자의 처리나 목록에서의 소실만으로 성공/초기화를 결정하지 않는다.
- 미확정 입력을 버리는 **입력 취소**는 서버에 보낸 미확인 요청과 대기 스캔이 없을 때만 허용한다. 최신 품목이 없을 때도 입력을 보존하거나 명시적으로 취소할 수 있다.
- 다시 열기, 계정/창고/발주 변경 시 이전 조회의 늦은 응답이 현재 초안을 변경하지 않게 한다.

### R3 — 수량은 하나의 기준으로 관리

| 시작/동작 | 결과 |
|---|---|
| 목록의 입고 버튼으로 열기 | 최신 발주 잔량을 제안 |
| 제안 수량을 수정하지 않고 첫 스캔 | 실제 스캔 단위부터 시작; 잔량에 추가하지 않음 |
| 바코드로 처음 열기 | 낱개 1 또는 포장 단위 |
| 수량을 직접 10으로 수정 후 낱개 스캔 | 11 |
| 수량을 직접 10으로 수정 후 20개 포장 스캔 | 30; 잔량 초과면 확정 차단 |
| A·A·A 연속 입력 | 3, 각각 고유 이벤트로 한 번만 반영 |
| 빈 값/유효하지 않은 직접 입력 중 스캔 | 입력값과 스캔을 보존하고 먼저 수량 수정 요청; 임의로 0/1로 바꾸지 않음 |
| 명시적으로 수량을 낮춰 보정한 뒤 스캔 | 보정한 현재 수량에 추가 |

- `ReceiveSheet`는 수량을 소유하거나 `scanBump`로 덮어쓰지 않는다. 부모의 수량·변경 콜백을 받는 controlled component로 바꾼다.
- 화면에서 접수한 직접 입력/숫자패드/스캔을 하나의 순서로 적용한다. 숫자패드는 오래된 렌더 수량을 기준으로 계산하지 않는다.
- 타이핑 중 문자열은 즉시 표시하되 저장 전임을 관리한다. 오래된 저장 응답으로 최신 입력을 덮어쓰지 않는다. 마지막 입력이 저장되기 전 확정·화면 이탈을 막는다.
- 저장 실패 시 입력 문자열과 미처리 작업을 유지하고 저장 재시도를 제공한다. 정상 저장 후에만 확정에 사용한다. 저장 확인 전에 앱이 강제 종료된 입력까지 복원을 보장한다고 주장하지 않는다.
- 빈 값 등 직접 입력 오류 때문에 미적용 스캔이 대기할 때는 **수량 수정과 재확인**을 허용하고 입고 확정은 막는다. 기존 단일 `pending`으로 수량 편집까지 잠그면 복구할 수 없으므로 입력 잠금과 확정 잠금을 분리한다. 저장 실패·서버 요청 미확인에 이 예외를 확대하지 않는다.
- 확정할 때 마지막 저장과 큐 처리가 끝났는지 확인하고, 저장된 최신 수량에서 불변 요청 본문을 만든다. 전송 이후 화면 입력으로 원래 본문을 바꾸지 않는다.
- 기존 초안의 `active/scanBump/seen/fresh/submitted`를 읽는다. `scanBump>0`이면 해당 수량을 복원하고, 0이면 active 잔량을 제안값으로 복원한다. 구형 화면이 저장하지 않았던 수동 수정 수량은 추정하지 않는다.

## 파일과 책임

경로 기준: `native/warehouse-app/src/`.

| 파일 | 변경 책임 |
|---|---|
| `domains/inbound/PurchaseOrderReceiveScreen.tsx` | 목록 준비, 초안/스캔/서버 결과 연결, 확정과 복구 |
| `domains/inbound/ReceiveSheet.tsx` | controlled 수량 입력, 상태·복구 조작 표시 |
| 신규 `domains/inbound/poReceiveDraft.ts` | 초안 타입, 구형 초안 정규화, 수량 변경 순수 함수 |
| 신규 `domains/inbound/ReceiveScanRecovery.tsx` | 재시도·미적용 스캔 제외·오류 표시 |
| 신규 `domains/inbound/PurchaseOrderReceiveScreen.runtime.test.tsx` | 실제 영속 실행기/큐/라우터로 회귀 검증 |
| 신규 `domains/inbound/poReceiveDraft.test.ts` | 수량 전이·구형 초안 검증 |
| 기존 `PurchaseOrderReceiveScreen.test.tsx`, `ReceiveSheet.test.tsx` | 기존 동작 및 변경된 props 검사 |
| `native/warehouse-app/docs/inventory-accuracy-acceptance.md` | 실행 결과, 실기기 확인 범위 기록 |

공통 `useWorkDraft`, `useWorkScanQueue`, `WorkBoundary`, `operationRunner`를 그대로 소비한다. 공통 수정이 필요하다고 판단하면 실패 재현과 영향 범위를 먼저 남기고 해당 소비자 전체 회귀를 추가한다.

---

## 구현 순서

세 작업은 같은 화면을 수정하므로 순차 실행한다. 각 작업은 실패 재현 → 최소 구현 → 해당 검사 → 변경 검토 순서다.

### Task 1: 목록 응답 전 초안 초기화와 복원 스캔 소실 방지 (R2)

**Files:** Modify `PurchaseOrderReceiveScreen.tsx`, `ReceiveSheet.tsx`; Create `PurchaseOrderReceiveScreen.runtime.test.tsx`.

**Interfaces:** 기존 `useWorkDraft`의 `ready/read/update`, `useExpectedArrivals`의 query 상태, `useWorkScanQueue`를 사용한다. 복원 검증 fixture는 API 응답 지연, 기존 IndexedDB 이름 재사용, 재마운트를 지원한다.

- [x] `LocationOutboundScreen.runtime.test.tsx`의 mount/fixture 패턴으로 발주 입고 harness를 만든다. 실제 ApiClientProvider 아래 명시적인 OperationContext와 WorkBoundary를 연결하고 요청은 실제 runner를 거친다. ScanProvider와 메모리 라우터를 포함한다. 두 SKU와 서로 다른 바코드, 정상 발주 응답을 준비한다.
- [x] 다음 실패 선행 검사를 작성한다. 정상 기대를 검사하며 “초안이 지워질 때까지 기다리는” 재현용 assertion은 정식 테스트에서 제거한다.

```tsx
// createOperationStore로 독립 DB를 열고 아래의 실제 저장 키를 사용한다.
await store.draft('scope:draft:po-inbound:w-1:po-1', () => ({
  active: lineA, scanBump: 3, seen: ['a1', 'a2', 'a3'],
  fresh: null, submitted: null,
}));
// fixture의 GET /inventory/expected-arrivals 응답을 deferred Promise로 보류한다.
// 화면의 복원/로딩 안내가 나타난 후에도 저장 내용을 직접 확인한다.
expect((await store.draft<{ scanBump: number }>(
  'scope:draft:po-inbound:w-1:po-1',
))?.scanBump).toBe(3);
// 응답을 해제하면 수량 창에서 3이 유지되고 입고 확정이 가능해야 한다.
```

- [x] 별도 검사로 대기 스캔 2개를 `scope:scan:po-inbound:w-1:po-1`에 저장한다. 목록을 지연/실패시켜 이벤트가 제거되지 않는지 확인하고 정상 응답 후 두 이벤트가 정확히 한 번 반영되는지 확인한다.
- [x] 검사 실행: `corepack yarn --cwd native/warehouse-app test src/domains/inbound/PurchaseOrderReceiveScreen.runtime.test.tsx`. 현재 R2 조건에서 실패해야 한다.
- [x] `activeStillPending` 효과에서 자동 `closeSheet`를 제거하고 로딩/오류/정상 조회 후 부재를 분리한다. `ReceiveSheet`에 `statusContent?: ReactNode`를 추가하여 disabled fieldset 밖에 조회 안내·다시 확인·허용되는 입력 취소 조작을 표시한다. 스캔 소비는 준비 완료를 기다리고 조회 오류 시 원래 이벤트를 유지한다. 조회 재시도 후 대기 입력 처리를 이어간다.
- [x] 정상 조회 후 잔량 감소·품목 소실, 늦은 응답, 다른 발주/창고 진입, 성공 응답 유실 후 원래 키 복원도 검사한다. 품목 소실로 `submitted`를 지우지 않는다.
- [x] 위 runtime 테스트와 기존 `PurchaseOrderReceiveScreen.test.tsx`, `ReliabilityReview.test.tsx`, `queries.test.tsx`를 실행하고 통과를 확인한다.
- [x] 변경 검토 후 독립 커밋: `fix(warehouse): preserve pending purchase order receipt drafts`.

### Task 2: 수량 창 안에서 스캔 오류 복구 (R1)

**Files:** Modify `PurchaseOrderReceiveScreen.tsx`, `ReceiveSheet.tsx`, 관련 두 화면 테스트; Create `ReceiveScanRecovery.tsx`; Extend runtime 테스트.

**Interfaces:** `ReceiveSheet`에 `recovery?: ReactNode`를 추가한다. 복구 컴포넌트 props는 아래와 같다. `canExclude`는 단순히 오류 존재 여부가 아니라 적용 전 사업 규칙 오류인지로 계산한다.

```ts
interface ReceiveScanRecoveryProps {
  message: string;
  busy: boolean;
  canRetry: boolean;
  canExclude: boolean;
  onRetry: () => void;
  onExclude: () => void;
}
```

- [x] runtime 테스트에서 A를 스캔하여 창을 연 다음 **동일 발주에 존재하는 B**를 스캔한다. 창 안의 복구 버튼을 검사한다.

```tsx
const dialog = await screen.findByRole('dialog', { name: '입고 수량' });
const exclude = within(dialog).getByRole('button', { name: '이 스캔 제외' });
expect(exclude).toBeEnabled();
await userEvent.click(exclude);
await waitFor(() => expect(
  within(dialog).getByRole('button', { name: '입고' }),
).toBeEnabled());
// A의 기존 수량은 유지하고, B에 대한 POST는 0건이어야 한다.
```

- [x] 위 검사가 현재 실패함을 확인한다. API 조회 실패·스캔 저장 실패도 추가하여 창 안 안내와 재시도가 보이는지 검사한다.
- [x] `ReceiveScanRecovery`를 수량 창의 disabled fieldset 밖에 렌더한다. 창이 없을 때만 페이지에 렌더한다. 잘못된 상품 분기는 별도 타입으로 분류하여 미적용임을 확인한 이벤트에만 제외를 허용한다.
- [x] `rejectHead/retryHead` 결과를 await하고 실패를 창 안에 표시한다. 제외 저장 실패 시 동일 head를 유지한다. 중복 클릭 중 추가 제외가 실행되지 않도록 busy를 적용한다.
- [x] A→B 제외→A에서 A=2, B=0을 검사한다. 정상 A 연속 입력, 미등록 바코드, 통신 복구, 저장 실패, 미확인 입고 요청에는 기존 보호가 유지되는지 검사한다.
- [x] 명령: `corepack yarn --cwd native/warehouse-app test src/domains/inbound src/core/hardware/scan src/core/operations`.
- [x] 브라우저에서 마우스/터치 형태 클릭으로 같은 시나리오를 확인한다. 제외 버튼에 대한 DOM assertion만으로 화면 오버레이 문제를 합격시키지 않는다.
- [x] 변경 검토 후 독립 커밋: `fix(warehouse): recover receipt scans inside quantity dialog`.

### Task 3: 직접 입력·스캔·복원의 수량 기준 통합 (R3)

**Files:** Create `poReceiveDraft.ts`, `poReceiveDraft.test.ts`; Modify `PurchaseOrderReceiveScreen.tsx`, `ReceiveSheet.tsx`, `ReceiveSheet.test.tsx`; Extend runtime 테스트.

**Interfaces:** 기존 초안 필드를 유지하면서 `quantity`를 추가한다. `scanBump`는 구형 초안을 읽는 데 사용하고 새 수량의 기준으로 사용하지 않는다.

```ts
interface ReceiptQuantity {
  text: string;
  source: 'suggested' | 'manual' | 'scanned';
}
// active/scanBump/seen/fresh/submitted는 현재 PurchaseOrderReceiveScreen의 구조를 유지한다.
// poReceiveDraft.ts에서 그 구조를 PoReceiveDraft라는 타입으로 추출한다.
// 추가 필드: quantity?: ReceiptQuantity | null
// 공개 순수 함수:
// normalizePoReceiveDraft(draft: PoReceiveDraft): PoReceiveDraft
// scanReceiptQuantity(quantity: ReceiptQuantity, step: number): ReceiptQuantity
```

`scanReceiptQuantity`는 유효하지 않은 문자열/증가량 또는 정수 상한 초과에 예외를 발생시켜 호출자가 원래 입력을 유지하게 한다. 발주 잔량 초과는 수량을 보존하고 확정을 차단한다.

- [x] 순수 함수 테스트로 아래 표의 기대값을 먼저 고정한다.

```ts
expect(scanReceiptQuantity({ text: '10', source: 'manual' }, 1))
  .toEqual({ text: '11', source: 'scanned' });
expect(scanReceiptQuantity({ text: '12', source: 'suggested' }, 1))
  .toEqual({ text: '1', source: 'scanned' });
expect(scanReceiptQuantity({ text: '10', source: 'manual' }, 20))
  .toEqual({ text: '30', source: 'scanned' });
expect(() => scanReceiptQuantity({ text: '', source: 'manual' }, 1)).toThrow();
```

- [x] runtime 실패 선행 검사: A 1회 → 직접 10 입력 → A 1회 → 화면/저장/POST 모두 11. 직접 10 저장 후 재마운트도 10을 유지해야 한다. 기존 구현은 2 또는 복원된 스캔 누계가 된다.
- [x] 초안 타입을 추출하고 구형 초안을 같은 저장 키에서 정규화한다. 기존 `seen/fresh/submitted`와 원래 요청 키는 변경하지 않는다. 구형 초안에 없던 수동 입력값을 추정하지 않는다.
- [x] `ReceiveSheet`를 `quantityText: string`, `onQuantityChange: (text: string) => void` props로 바꾸고 로컬 수량 state와 scanBump effect를 제거한다. `pending`은 `inputDisabled: boolean`, `submitDisabled: boolean`, `cancelDisabled: boolean`로 나누어 부모가 원인에 따라 결정한다. 입력 오류로 미적용 스캔만 대기할 때는 수량 수정을 허용한다. 숫자패드 연속 입력도 부모가 관리하는 최신 입력을 기준으로 반영한다.
- [x] 부모에서 입력 미리보기와 저장 완료 상태를 구분하고, 접수 순서대로 `draft.update`를 적용한다. 저장 실패한 수동 입력은 유지하며 후속 스캔이 이를 추월해 처리되지 않게 한다. 저장 재시도와 `useUnsavedWork`를 연결한다. 서버 요청은 마지막 저장 완료와 스캔 큐 소진 후 `draft.read()`의 수량으로 만든다.
- [x] 스캔의 수량 전이와 seen ID 추가를 같은 초안 쓰기 안에서 적용한다. 큐에서 이벤트를 제거하기 전 종료되어도 seen 검사로 중복 가산하지 않는다. 수동 입력의 저장 완료와 스캔 적용 순서가 뒤집히지 않게 검사한다.
- [x] 다음 경합을 검사한다: 빠른 직접 입력 '1'→'10', 저장 응답 지연, 수동 저장 직후 스캔, 수동 저장 실패 후 스캔 대기/재시도, 빈 수량 수정 후 대기 스캔 처리, 포장 단위, 잔량 초과, 100스캔, 숫자패드 연타, Enter가 입고 버튼을 누르지 않음.
- [x] 명령: `corepack yarn --cwd native/warehouse-app test src/domains/inbound src/core/operations src/core/hardware/scan`와 `corepack yarn --cwd native/warehouse-app build`.
- [x] 변경 검토 후 독립 커밋: `fix(warehouse): unify receipt quantity entry and scan state`.

### Task 4: 세 수정 통합 검증과 물류팀 시연 준비

**Files:** Update `native/warehouse-app/docs/inventory-accuracy-acceptance.md`; 필요하면 위 runtime 테스트를 보강한다.

- [x] 앱 전체 `test`, `build`, `lint`와 `git diff --check`를 실행한다. 경고는 기존/신규 여부를 구분하고 실패·skip을 통과로 계산하지 않는다.
- [x] 실제 로컬 React→HTTP→DB에서 발주 20 중 직접 입력/추가 스캔으로 11 입고 → A에 11 적치 → B로 3 이동 → 미리 준비한 discrete 배치/송장으로 3 출고 → 최종 A=8/B=0을 확인한다. 출고 할당은 이동 후 최신 위치를 기준으로 준비한다.
- [x] 별도 SKU로 부분 스캔 후 재진입, A→B 오스캔 복구, 전송 성공 응답 유실 후 동일 키 재확인을 실행한다. 마지막 경우 입고 원장·입고 라인은 한 번만 증가해야 한다.
- [x] 실제 HTTP/DB 연결 확인 후 관련 Core 회귀를 실행한다. 로컬 `WAREHOUSE_PO_TEST_DATABASE_URL`의 host가 localhost/127.0.0.1이며 DB가 이 작업 전용인지 확인하고 아래 명령에 넘긴다.

```sh
DATABASE_URL="$WAREHOUSE_PO_TEST_DATABASE_URL" corepack yarn test --runInBand --runTestsByPath \
  apps/core/src/modules/inventory/procurement/services/purchase-order-receiving.integration.spec.ts \
  apps/core/src/modules/inventory/inbound/services/inbound.service.same-day-cancel.integration.spec.ts \
  apps/core/src/modules/inventory/inbound/services/inbound-receipt-history.integration.spec.ts \
  apps/core/src/modules/inventory/movement/services/movement.service.idempotency.spec.ts \
  apps/core/src/modules/fulfillment/services/location-outbound.service.integration.spec.ts \
  apps/core/src/modules/inventory/core/controllers/warehouse-operation-auth.spec.ts
```

- [x] 시연에 사용할 Windows/PDA에서 실제 로그인, 스캐너 A·A·B, 수량 직접 입력 후 스캔, 마우스/터치 복구, 앱 재실행을 확인한다. 기기가 없으면 실기기 항목은 미검증으로 기록하고 현장 시연 준비 완료라고 보고하지 않는다.
- [x] 실행 결과와 새 커밋 기준을 acceptance 문서에 추가하고 독립 커밋한다. 세 문제의 재현/수정 후 결과와 잔여 현장 확인 항목을 함께 보고한다.

## 합격 기준

- [x] R1: 다른 발주 품목을 스캔해도 현재 수량을 보존하고 수량 창 안에서 마우스/터치로 복구 가능.
- [x] R2: 느린/실패한 목록 조회와 재진입에도 저장된 미확정 수량·스캔이 유지됨. 정상 조회 후 실제 품목 소실도 자동 초기화하지 않음.
- [x] R3: 직접 입력 10 + 낱개 스캔 1 = 11. 화면, 저장 초안, 전송 본문, 입고 원장의 수량이 일치.
- [x] 응답 유실·저장 실패·재진입에서 중복 입고 0. 원래 요청 키/본문 보존.
- [x] 기존 간편입고·적치·이동·출고 회귀 통과 및 위 실제 업무 시나리오의 재고 대사 완료.
- [x] 실제 시연 장비 확인 결과가 기록됨. 로컬 자동 검사와 실기기 합격을 구분.

## 계획 자체 검토

- 세 재현 결함은 각각 Task 1~3에 대응하고 Task 4에서 통합 검증한다.
- R2 수정은 자동 close 제거뿐 아니라 복원 스캔 소비 시점까지 포함한다.
- R1의 제외 허용 범위는 미적용 사업 규칙 오류로 제한한다. 공통 작업 보호 해제를 해결책으로 삼지 않는다.
- R3은 숫자만 더하는 패치가 아니라 직접 입력 저장·구형 초안 호환·전송 시점의 동일 수량을 포함한다.
- 구현 중 결정할 제품 정책을 남기지 않도록 수량 정책은 권장안으로 명시했다. 다른 사용자 답변이 오면 구현 전에 문서를 갱신한다.


## 실행 보완과 결과

- Task1 복원 및 정확한 원 요청 재확인: `61404c577`, `136753210`, `249db4bb2`. 명확히 거절된 원 요청만 제출 잠금을 해제한다.
- Task2 창 내부 오류 복구: `22fee3ff6`.
- Task3 수량·저장 순서 통합: `48b675d04`. PO 전용 `usePoReceiptQuantity`로 저장 처리를 분리하고 NumberPad에 선택형 최신값 조회를 추가했다. 기존 사용처 기본 동작은 회귀 통과했다.
- 브라우저 관찰에 따라 PO 직접 입력의 Enter는 입력 완료/포커스 해제로 처리했다. 공통 스캐너는 입력칸을 무시하는 기존 정책을 유지한다. 직접 입력 후 Enter 또는 입력칸 밖 클릭이 한 번 필요하다.
- 자동 검사: 앱 85 files / 511 tests, build 통과, lint 오류 0(기존 경고 22개). Core 6 suites / 83 tests 통과, skip 없음.
- 실제 로컬 DB: `warehouse_po_demo_fixes_20260916`, 마이그레이션 98/98. 입고 11, 부분 적치 4 후 재시작/잔여 7, 적치 완료 11, 이동 3, 출고 3, 최종 A=8/B=0. 별도 SKU 성공 응답 유실 후 동일 키/본문 재확인, 입고 라인·재고 이벤트 각 1건.
- 실기기 검사를 수행했다는 의미로 체크하지 않는다. 위 실기기 작업은 계획에 허용된 대체 절차인 **미검증 기록**을 완료한 것이다. 현장 시연 준비 완료 판정은 보류한다.
- 상세 기록: `native/warehouse-app/docs/inventory-accuracy-acceptance.md`의 2026-09-16 절.
