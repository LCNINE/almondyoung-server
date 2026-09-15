# Warehouse Demo Defects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Status:** 2026-09-15 사용자 “바로 실행하자” 승인 후 로컬 구현·검증 완료. 최종 독립 검토 완료(차단 결함 없음). 운영 배포는 별도다.

**Goal:** 물류팀이 출고를 연속 스캔하고, 권한이 없는 작업에서 정상 업무로 돌아오며, 완료 송장을 정확히 확인할 수 있게 한다.

**Architecture:** 기존 스캔 큐·IndexedDB 작업 저장소·서버 명령 중복 방지 기록을 유지한다. 스캔 접수와 서버 갱신의 잠금을 분리하고, 권한 거절 후에는 원래 명령 키에 대한 서버의 확정 결과로만 미확인을 해제한다. 완료 송장은 배치 유무보다 먼저 판정한다.

**Tech Stack:** React, TanStack Query/Router, Vitest, IndexedDB, Tauri, NestJS, Drizzle/PostgreSQL, Jest.

**Spec:** 사용자가 실행을 승인한 이 문서의 「설계안」과 「합격 기준」.

## Global Constraints

- 일반 작업자는 일반 출고를 계속 수행한다. `fulfillment.dispatch.force` 권한은 확대하지 않는다.
- 같은 상품을 다시 찍은 입력도 각각 하나의 이벤트로 보존한다.
- 접수 시 창고·송장·출발 위치·수량을 고정하고, 전송 전 영속 저장한다.
- 응답 유실·손상·인증 만료는 작업 미반영의 증거가 아니다. 일반 401/403 전체를 `rejected`로 바꾸지 않는다.
- 다른 계정으로 이전 계정의 미확인 요청을 전송하지 않는다.
- 이미 남은 작업의 원래 경로·본문·키를 유지한다. IndexedDB 삭제로 문제를 해소하지 않는다.
- 제품 검증은 실제 `OperationContext`와 `WorkBoundary`를 포함한다. API mock을 주입해 영속 실행기를 우회한 화면 테스트만으로 합격시키지 않는다.
- Yarn은 저장소 루트에서 `corepack yarn --cwd native/warehouse-app ...` 또는 `corepack yarn ...`으로 실행한다.
- 서버/DB 검증은 전용 로컬 테스트 DB에서만 수행하며 DB 테스트 skip을 성공으로 계산하지 않는다.

## 근거와 범위

기준 커밋: `cfe7d5e7a`. 직전 점검에서 앱 82개 파일/404개 테스트와 웹 production build가 통과했지만, 아래 조건을 별도 테스트로 재현했다.

| ID | 결함 | 재현 조건 |
|---|---|---|
| D1 / P1 | 출고 연속 스캔 누락 | 실제 영속 실행기를 연결하고 상태 조회 응답을 지연한 뒤 상품을 두 번 입력하면 한 번만 접수됨 |
| D2 / P1 | 권한 거절 후 출고 차단 | force 요청에 403 → uncertain 유지 → 재시도/저장소 복원 후에도 출고 차단 |
| D3 / P2 | 완료 송장 오안내 | `shipmentStatus=shipped`, `workItemId=null` 응답에 ‘오늘 배치에 없음’ 표시 |

재현 자료는 `/tmp/warehouse-demo-review-reproductions/`에 보관했지만 영구 의존성으로 삼지 않는다. 아래 정식 회귀 테스트가 지속적인 근거다.

이번 수정 대상은 위치별 출고와 그 공통 실행기 연결이다. 입고·이동은 회귀 및 최종 시나리오 검증에 포함한다. 배치 생성, 송장 발급/인쇄, 창고 간 이동의 신규 화면은 추가하지 않는다.

## 설계안

### 선택한 접근

1. **권장: 기존 영속 큐와 명령 기록을 보완한다.** 세 결함을 해결하면서 응답 유실 후 중복 출고 방지도 유지할 수 있다.
2. 스캔 간격을 늘리고 관리자 계정으로만 시연하는 방법은 임시 진행 요령으로만 사용한다. 물류팀 직접 사용의 합격 조건이 아니다.
3. 공통 작업 엔진 전체 교체는 이번 결함 해결에 필요하지 않다.

### D1 — 접수와 처리 상태를 구분한다

- 초기 복구, 출발 위치 변경, 실물 확인 창, 저장소 오류, 미확인 결과에는 접수 차단과 이유를 표시한다.
- 정상 스캔 요청의 전송 및 상태 갱신 중에는 동일 송장·동일 출발 위치의 후속 스캔을 큐에 저장한다. HTTP 처리는 순차적으로 유지한다.
- 현재 `runner.subscribe()`는 모든 알림마다 `recover()`를 호출하며 `busyRef=true`를 만든다. 초기 복구/관리 작업 잠금과 일반 상태 갱신을 분리한다.
- `WorkBoundary`의 상위 `inert`도 함께 다룬다. 출고 전체에 예외를 주지 않고, 스캔 입력 영역만 해당 송장의 정상 스캔 전송 중 접수를 허용한다. 위치 변경·강제 완료·새 송장 전환은 큐가 빌 때까지 계속 차단한다.
- 다른 송장/작업의 미확인 요청, 계정 전환, 저장소 실패에는 예외를 허용하지 않는다.
- 갱신 응답의 역전 방지와 확정 작업 재생 후 최신 상태 조회를 유지한다.
- 완료 후 남은 입력을 조용히 성공 처리하지 않는다. 과잉 입력은 미반영 사실과 재확인 안내를 표시한다.

### D2 — 권한 확인과 미확인 작업 복구

**사전 차단:** `GET /inventory/work-context`에 `permissions.forceDispatch: boolean`을 추가한다. 기능 지원 여부인 `capabilities`와 계정 권한을 구분하며 서버의 실제 ScopeGuard 판정과 같은 권한 규칙을 사용한다. master 예외, DB 역할 매핑, 조회 실패도 일치시킨다.

- 일반 작업자에게 스캔 생략 실행 버튼을 제공하지 않고 관리자 권한이 필요한 기능임을 표시한다.
- 권한을 읽지 못했거나 구형 서버에서 필드가 없으면 강제출고만 비활성화한다. 일반 출고는 지원 여부에 따라 계속 가능하다.
- 실행 직전 다시 권한을 확인한다. 사전 조회 실패는 재고 변경 요청으로 저장하지 않는다.
- 서버의 기존 force 권한 검사는 유지한다. 사전 확인 이후 권한이 바뀌는 경우도 서버에서 거절한다.

**확정 복구:** 사전 확인만으로는 기존 미확인 기록이나 권한 변경 경합을 해결할 수 없다. 위치별 force에 한정해 다음 결과 확인 계약을 추가한다.

```ts
// 제안하는 신규 계약. 호출은 강제출고를 실행하지 않는다.
// POST /shipments/:shipmentId/location-outbound-force-resolutions
// Idempotency-Key: 원래 force 요청의 키
// Body: 원래 LocationOutboundConfirmDto (창고, 사유, 위치별 수량)
type ForceResolution =
  | { outcome: 'confirmed'; result: LocationOutboundState }
  | { outcome: 'rejected'; code: 'LOCATION_OUTBOUND_FORCE_NOT_APPLIED' };
```

- 허용 범위는 현재 사용자의 출고 업무 권한과 본인 원래 명령이다. 다른 사용자의 키/본문은 처리하거나 결과를 공개하지 않는다.
- `shipment.location_outbound.force`라는 **기존 명령 종류와 원래 키**, 정규화한 원래 본문·송장·현재 인증 사용자 ID로 동일 requestHash를 사용한다. 별도 키 공간에서 조회 후 해제하지 않는다.
- 기존 완료 기록이면 저장된 출고 결과를 반환한다. 서버 상태 조회에서 `shipped`라는 이유만으로 해당 명령의 성공을 추정하지 않는다.
- 기존 기록이 없으면 같은 고유 키에 **미반영 종결 기록**을 남긴다. 명령 실행과 동일한 DB 고유 키/트랜잭션 경합 규칙으로 처리하여 늦게 도착한 원래 요청이 이후 출고되지 않게 한다.
- 기존 명령이 실행 중이면 DB 경합이 결론 날 때까지 기다리거나 재확인 상태를 유지한다. 단순 SELECT 결과 없음으로 미반영을 확정하지 않는다.
- 현 스키마의 `completed` 명령과 JSON 응답에 명시적인 미반영 표식을 저장하는 방식을 사용한다. 완료 상태는 ‘명령의 결론이 저장됨’을 뜻하며 출고 성공과 구분한다. 정상 force 재생 경로도 이 표식을 해석해 재고 변경 없이 `LOCATION_OUTBOUND_FORCE_NOT_APPLIED`를 반환한다.
- 결과 확인 endpoint는 원장·피킹·송장 상태를 변경하지 않는다. 명령 종결 기록만 쓴다. UI 문구는 ‘처리 내역 확인’으로 유지한다.
- 클라이언트는 확인된 결과만 저장소의 `confirmed/rejected`로 반영하고 대기 중 Promise를 종료한다. rejected에서는 확인창을 닫고 일반 스캔으로 돌아간다.
- 결과 확인 실패, 다른 계정, 현재 업무 권한 상실, 구형 서버에는 미확인을 보존하고 필요한 조치를 안내한다.
- 이 자동 복구는 `location-outbound-forces`에 한정한다. 구형 `simple-outbound-forces` 미확인 기록은 경로·본문을 바꾸지 않고 기존 복구/관리자 확인 절차를 유지한다.

### D3 — 완료 여부를 먼저 확인한다

창고 일치 검증 → 출고 완료 판정 → 활성 배치 작업 검증 순으로 바꾼다. 완료 건은 조회 안내로 끝나며 출고 준비/수정 요청을 보내지 않는다. 취소·폐기된 송장을 활성 조회로 되살리지 않는다.

## 구현 순서

### Task 1: 연속 스캔과 잠금 경계 수정 (D1)

**Files — Modify:**

- `native/warehouse-app/src/domains/outbound/LocationOutboundScreen.tsx`
- `native/warehouse-app/src/core/operations/WorkBoundary.tsx`
- `native/warehouse-app/src/core/hardware/scan/useWorkScanQueue.ts` (복구 준비 상태를 별도로 노출)
- `native/warehouse-app/src/domains/outbound/LocationOutboundScreen.test.tsx`

**Files — Create:** `native/warehouse-app/src/domains/outbound/LocationOutboundScreen.runtime.test.tsx`.

**Interfaces:** 기존 `queue.enqueue(data)`의 입력과 저장 키 유지. 초기 복구 준비 상태와 큐에 처리 대기가 있다는 상태를 구분하여 화면이 접수 허용을 판단한다. WorkBoundary는 일반 잠금 정책을 기본으로 유지한다.

- [x] 실제 ApiClientProvider/OperationContext/WorkBoundary/ScanProvider를 연결하는 테스트 fixture를 만들고, 지연 가능한 서버 응답과 독립 IndexedDB를 제공한다.
- [x] D1 재현을 정상 기대값으로 바꿔 먼저 실패를 확인한다: 동일 상품 2회 입력 → 2개의 고유 작업 키, 각 1개 처리. 정상 처리 도중 100회 입력도 100개 접수한다.
- [x] 요청 전송 알림과 초기 복구 잠금을 분리하고 스캔 입력 영역의 접수 정책을 적용한다. 예시 결정표:

```text
초기 복구/저장 실패/확인창/위치 전환/미확인 결과 → 접수 차단 + 안내
동일 송장·동일 위치 정상 스캔 전송/갱신 → 큐에 저장
다른 작업의 미확인/계정 불일치 → 접수 차단
```

- [x] 첫 응답 유실, 새로 열기, 조회 응답 역전, A·A·B, 100회, 초과 스캔, 입력 포커스와 Enter를 검증한다. 원장 수량·큐 입력 수·작업 키를 함께 확인한다.
- [x] 관련 화면/큐/영속 실행기 회귀를 통과시킨 후 D1을 독립 커밋한다.

### Task 2: 서버 권한 정보 및 force 결과 확정 계약 (D2 서버)

**Files — Modify:**

- `apps/core/src/modules/inventory/core/controllers/warehouse-work-context.controller.ts`
- `apps/core/src/modules/inventory/core/controllers/warehouse-operation-auth.spec.ts`
- `apps/core/src/modules/fulfillment/controllers/location-outbound.controller.ts`
- `apps/core/src/modules/fulfillment/controllers/location-outbound.controller.spec.ts`
- `apps/core/src/modules/fulfillment/dto/location-outbound.dto.ts`
- `apps/core/src/modules/fulfillment/services/location-outbound.service.ts`
- `apps/core/src/modules/fulfillment/services/location-outbound.service.integration.spec.ts`
- `apps/core/src/modules/fulfillment/services/fulfillment-command.service.spec.ts`
- `apps/core/src/platform/auth/inventory-scope-coverage.spec.ts`
- `apps/core/src/modules/fulfillment/services/outbound-v2-authorization.spec.ts` (신규 route의 허용/거절 검사)

**Interfaces:** `permissions.forceDispatch`와 위에서 정의한 `ForceResolution`. 기존 force의 정상 응답은 변경하지 않는다.

- [x] 일반 작업자/관리자/master의 권한 정보와 실제 endpoint 권한 판정이 일치하는 실패 선행 테스트를 추가한다.
- [x] 신규 resolver의 DTO/인증/원래 본문 해시를 구현한다. 정상 force와 정규화 함수를 공유하여 reason trim, 배열 순서, actorId가 달라지지 않게 한다.
- [x] 기존 FulfillmentCommandService.execute의 같은 고유 키를 사용해 이미 처리됨 또는 미반영 종결을 확정한다. JSON에 저장할 미반영 표식과 정상 force에서의 해석을 함께 구현한다.
- [x] 실제 DB의 독립 연결 두 개로 force와 resolver를 양쪽 순서로 경합시킨다. 둘 중 하나의 결론만 남고 출고는 최대 한 번이어야 한다.
- [x] 성공 응답 유실 후 force 권한 철회, 타인/다른 창고/본문 변경, 기존 거절, resolver 응답 유실 후 재확인을 검사한다. 거절 분기에서 원장/할당/커스터디/송장 변화가 0인지 확인한다.
- [x] 기존 권한 검사를 유지한 채 정상 출고/강제출고 회귀를 통과시키고 서버 변경을 독립 커밋한다.

### Task 3: 권한별 화면과 기존 미확인 복구 연결 (D2 앱)

**Files — Modify:**

- `native/warehouse-app/src/core/operations/OperationContext.tsx`
- `native/warehouse-app/src/core/operations/useWorkCapabilities.ts`
- `native/warehouse-app/src/core/data/ApiClientProvider.tsx`
- `native/warehouse-app/src/core/data/httpClient.ts`
- `native/warehouse-app/src/core/data/errorMessage.ts`
- `native/warehouse-app/src/core/operations/operationRunner.ts`
- `native/warehouse-app/src/core/operations/operationStore.ts`
- `native/warehouse-app/src/core/operations/WorkBoundary.tsx`
- `native/warehouse-app/src/domains/outbound/locationOutbound.ts`
- `native/warehouse-app/src/domains/outbound/LocationOutboundScreen.tsx`
- `native/warehouse-app/src/core/operations/operationRunner.test.ts`
- `native/warehouse-app/src/core/data/httpClient.test.ts`
- Task 1의 실제 runtime 화면 테스트.

**Interfaces:** Task 2의 권한 정보와 resolver를 소비한다. StoredOperation의 기존 키/본문/상태는 호환 유지한다. 서버에서 확정된 미반영은 `LOCATION_OUTBOUND_FORCE_NOT_APPLIED` 코드로 구분하고 일반 403 분류는 유지한다.

```ts
// OperationContext.tsx에 추가할 계약. 기존 getCapabilities는 유지한다.
export interface WorkPermissions {
  forceDispatch?: boolean;
}
// WorkRuntime에 getPermissions?: () => Promise<WorkPermissions> 추가.
// useWorkCapabilities.ts에 usePermissionReader / useWorkPermissions 추가.
// ApiClientProvider는 동일 actorId/API 범위 검사를 거쳐 permissions만 반환한다.
// missing은 권한 허용으로 해석하지 않는다.
```

- [x] 작업자에게 force 버튼이 실행되지 않고, 관리자에게만 보이며, 권한 조회 실패 시 일반 출고는 가능한 테스트부터 작성한다.
- [x] 권한 정보 표시와 실행 직전 확인을 연결한다. 역할 이름을 클라이언트에 하드코딩하지 않는다.
- [x] force 요청의 403 또는 저장된 force 미확인의 ‘처리 내역 확인’에 resolver를 연결한다. 원래 요청을 새 키로 다시 만들지 않는다. 결과 확인 자체는 기존 force에 종속되며 별도의 재고 변경 작업 큐를 만들지 않는다.
- [x] 저장·lease·사용자 범위 확인 후 terminal 상태를 기록하고 기존 대기 Promise와 WorkBoundary를 갱신한다. 저장 실패에서는 확정 응답이 있어도 정상 UI로 넘어가지 않는다.
- [x] 핵심 상태 전이를 검사한다:

```text
force → 403 → resolver rejected → 저장 rejected → 확인창 종료 → 일반 스캔 가능
force 커밋 → 응답 유실 → 권한 철회 → resolver confirmed → 완료 표시
resolver 응답 유실 → 원래 키로 재확인 → 동일 결론
resolver 실패/알 수 없는 응답/계정 변경 → 원래 미확인 유지
```

- [x] 이전 버전에서 저장한 작업 fixture도 재시작 후 복구되는지 검사한다. 다른 송장과 입고/이동이 잘못 해제되거나 차단되지 않는지 확인한다.
- [x] D2 앱 회귀를 통과시키고 독립 커밋한다.

### Task 4: 완료 송장 재스캔 안내 (D3)

**Files — Modify:**

- `native/warehouse-app/src/domains/outbound/OutboundQueueScreen.tsx`
- `native/warehouse-app/src/domains/outbound/OutboundQueueScreen.test.tsx`
- `apps/core/src/modules/fulfillment/reader/shipment-waybill.reader.integration.spec.ts`

**Interfaces:** 기존 조회 응답 계약 유지. 서버 reader의 완료 작업 제외 정책도 유지한다.

- [x] 완료 fixture를 실제 reader와 맞춘다: `shipmentStatus: 'shipped'`, `workItemId: null`. 이 입력에서 완료 안내를 기대하는 테스트가 먼저 실패해야 한다.
- [x] 아래 순서로 분기를 정리한다.

```ts
if (found.warehouseId && found.warehouseId !== warehouseId) {
  setNotice('송장의 창고와 선택 창고가 달라요. 창고를 확인해 주세요.');
  return;
}
if (found.shipmentStatus === 'shipped') {
  setNotice('이미 출고된 송장이에요');
  return;
}
if (found.workItemId === null) {
  setNotice('이 송장은 오늘 배치에 없어요 — 관리자에게 문의해 주세요');
  return;
}
```

- [x] 완료/미배정/다른 창고/없는 번호/취소 송장을 구분하고 완료 조회에서 POST 요청이 0회인지 검사한다.
- [x] 화면과 실제 DB reader 회귀를 통과시키고 D3를 독립 커밋한다.

### Task 5: 전체 검증과 시연 인수

**Files — Modify:** `native/warehouse-app/docs/inventory-accuracy-acceptance.md`.

- [x] 앱 전체 검사:

```bash
corepack yarn --cwd native/warehouse-app test --run
corepack yarn --cwd native/warehouse-app build
corepack yarn --cwd native/warehouse-app lint
corepack yarn tsc --noEmit --incremental false -p apps/core/tsconfig.app.json
```

- [x] 전용 로컬 DB 연결을 설정하고 변경한 서버 controller/auth/reader/command/location-outbound 테스트를 `corepack yarn test --runInBand --runTestsByPath`로 실행한다. 테스트 파일별 실행 수와 skip 0을 기록한다. 입고·이동·출고·영속 실행기의 기존 회귀도 포함한다.
- [x] 실제 React→로컬 HTTP→DB 흐름에서 아래 합격 기준을 대사한다. 화면 mock만으로 대체하지 않는다.
- [x] Core를 먼저 배포하고 새 권한/결과 확인 계약을 검사한 후 Windows 앱을 배포하는 순서를 릴리스 절차에 적는다. 기존 앱을 지원하는 정상 force 응답은 유지한다.
- [ ] 실제 Windows 설치본에서 일반 작업자/관리자 로그인, HID 100회, 통신 단절과 재개를 검사한다. 실기기를 사용할 수 없으면 그 항목을 미검증으로 남기고 현장 인수 완료로 표시하지 않는다.
- [x] 검증 일자/커밋/명령/결과/제한을 인수 기록에 추가하고 코드와 권한·재고 경합 경계를 검토한다.

## 합격 기준

| 시나리오 | 합격 조건 |
|---|---|
| 입고 10 → 적치 10 → A에서 B로 이동 4 → B에서 출고 3 | 총재고 10→10→10→7, 최종 A6/B1 |
| 동일 상품 100회 연속 스캔, 서버 응답 1초 지연 | 100개 이벤트 영속 저장, 순서 유지, 허용 재고 범위에서 각 1회만 처리 |
| 첫 스캔 커밋 후 응답 유실·앱 재개 | 같은 키로 결과 복구, 원장 중복 없음, 접수한 후속 이벤트 유지 |
| 일반 작업자 계정 | 강제출고 실행 불가, 정상 출고 가능 |
| 사전 권한 확인 후 force 권한 철회 | 미반영 확정 후 일반 업무 복귀, 이미 처리된 요청은 성공으로 복구 |
| force와 결과 확인의 동시 도착 | 동일 키에 단 하나의 결론, 미반영 종결 뒤 지연 요청이 재고를 변경하지 않음 |
| 기존 미확인 기록 복원 | 본인 원래 키·본문으로만 복구, 서버 확인 없이 삭제/재작성 없음 |
| 완료 송장 재스캔 | ‘이미 출고된 송장이에요’, 추가 출고 요청 0 |
| 다른 계정·다른 창고·손상된 응답 | 잘못된 복구 및 재고 변경 없음, 작업자에게 필요한 안내 표시 |

## 셀프 리뷰

- D1은 Task 1과 5, D2는 Task 2·3·5, D3는 Task 4·5에 대응한다.
- 신규 계약은 additive이며 정상 출고 응답/기존 저장 키를 바꾸지 않는다.
- 결과 확인을 단순 조회로 구현하면 생기는 ‘조회 직후 지연 요청 커밋’ 경합을 같은 명령 키의 종결 기록으로 방지한다.
- 실기기 검증과 자동 검사 합격을 구분한다.
- 실제 구현은 독립 파일인 Task 1·2·4를 병행하고, 화면 소유권을 넘긴 뒤 Task 3을 연결했다. Task 5의 실제 HTTP/DB 검증은 통합과 함께 수행했다.
- Task 2의 기존 DTO·FulfillmentCommandService는 계약과 원자적 저장 요건을 이미 충족해 변경하지 않았다. Task 3의 WorkBoundary는 Task 1에서 추가한 인터페이스와 기존 알림/재확인 경로를 그대로 사용했다.
- 테스트 보강은 실제 runtime 파일에 집중했다. 실제 Windows 장비 검사는 이 환경에서 수행하지 못했다.
