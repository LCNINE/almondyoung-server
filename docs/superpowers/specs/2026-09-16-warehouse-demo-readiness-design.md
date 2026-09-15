# 물류 앱 시연 흐름의 복구·위치·출고 준비 설계

## 1. 목적과 상태

입고 → 적치 → 같은 창고 내 이동 → 위치별 출고 시연에서 확인한 세 결함을 고친다. 사용자가 승인한 방향은 정상 로그인 후 자동 작업 준비, 작업별 위치 정책, 미시작 출고 계획의 제한적 자동 재계획이다.

- 기준: 원격 develop `25ef604a6` (#884 포함). 작성 작업공간 HEAD `191a2fb71`은 해당 develop과 추적 파일 내용이 같다.
- 상태: **설계·구현 계획 작성 완료, 제품 구현 전**. 아래 합격 조건은 요구사항이며 통과 기록이 아니다.
- 사전 조사: 기존 native 89파일/611검사, Core·HTTP 29파일/429검사 및 native build 통과. 별도 재현에서 로그인 후 작업 잠금, stale draft 반복 거절, 비활성 위치 이동 후 출고 거절을 확인했다.
- `/tmp` 재현 파일은 참고 자료일 뿐이다. 구현자는 아래 계획에 따라 저장소 안에 지속 가능한 회귀 검사를 만든다.

독립 변경 단위별 계획:

1. [로그인 후 작업 준비](../plans/2026-09-16-warehouse-work-readiness.md)
2. [작업별 위치 정책](../plans/2026-09-16-warehouse-location-policy.md)
3. [출고 준비 복구와 통합 인수](../plans/2026-09-16-warehouse-outbound-preparation.md)

## 2. 공통 제약

- Node 22와 저장소의 `corepack yarn` 명령을 사용한다. 신규 외부 의존성·DB 테이블·DB enum·영구 재고 사본을 추가하지 않는다.
- v2 작업 키·원래 요청 본문·사용자/API 범위·확정 결과 재생 계약을 유지한다. 미확인 작업을 새 키로 바꾸지 않는다.
- 입고 대기·배치 관리 재고·예약 보호, 서버 권한과 창고 범위 검증을 유지한다.
- 원장·피킹·검수·출고 변경은 호출자가 소유한 같은 트랜잭션에서 원자적으로 처리한다. GET은 조회만 한다.
- 작업자에게는 한국어 행동 안내를 제공하고, 내부 코드·잠금·DB 상태는 진단 정보로 분리한다.
- 검증은 명시적으로 지정한 전용 로컬 DB에서 수행한다. 운영 데이터 보정·운영 배포·실제 기기 인수는 자동 검사와 구분한다.

범위 밖: 창고 간 이송 UI/API 보강, 총량·다중주문 피킹 지원 확대, 위치 비활성화 자체의 새 업무 승인 정책, 진행 중 피킹 재배정, 인증 프로토콜 교체, 일반 명령 프레임워크 재작성. 기존 데이터의 위치를 자동으로 옮기지 않는다.

## 3. 설계 선택

| 대안                                              | 평가                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| 화면에서 오류를 지우거나 재시도 횟수를 늘린다     | 준비 실패의 원인과 서버 상태가 남으므로 채택하지 않는다.                       |
| 기존 경계의 상태·결과·위치 정책을 명시한다        | **채택.** 기존 잠금·멱등성·입고 보호를 유지하며 세 변경을 독립 검증할 수 있다. |
| 전체 물류 workflow/상태관리 프레임워크를 도입한다 | 이번 세 결함의 해결 범위를 넘으므로 제외한다.                                  |

## 4. A — 로그인 후 작업 준비

### 4.1 책임과 상태

`ApiClientProvider`는 인증 주체에 결합된 runner/store/runtime을 소유한다. `WorkBoundary`는 현재 runtime이 작업 가능한지 표시하고 업무별 미확인 작업 잠금을 합성한다. `Bootstrap`은 세션 복원과 라우터 시작 책임을 유지한다.

신규 `native/warehouse-app/src/core/operations/useWorkReadiness.ts`에 초기화/재확인을 모은다.

```ts
type WorkReadiness =
  | { status: 'signed_out' }
  | { status: 'checking_scope' }
  | { status: 'restoring'; scope: string }
  | { status: 'ready'; scope: string }
  | { status: 'failed'; step: 'scope' | 'restore' | 'retry'; message: string };

function useWorkReadiness(
  runtime: WorkRuntime,
  authenticated: boolean,
): {
  state: WorkReadiness;
  recheck(): Promise<void>;
};
```

- 로그인 전에는 `getScope`, `restore`, `retryPending`을 호출하지 않는다.
- 최초 인증/새 runtime: `getScope → restore → getScope 재확인 → ready`.
- 수동 재확인/online: 같은 절차에서 `restore` 다음 `retryPending`을 실행하고 snapshot을 갱신한다. 실패한 단계가 끝까지 성공해야 failed가 해제된다.
- 실패 표시는 훅이 관리한다. `getScope` 성공만으로 저장소 실패를 지우지 않는다. `retryPending`이 미확인 항목을 남긴 채 반환해도 readiness와 업무 잠금은 별도로 계산한다.
- 동일 runtime의 동시 재확인은 하나의 Promise로 합친다. 버튼은 실행 중 비활성이다.

### 4.2 계정 전환과 비동기 경계

현재 `(runtime, authenticated)`마다 owner token을 두고, 실행마다 generation을 둔다. 오래된 owner/generation의 완료·실패는 새 상태를 갱신하지 않는다. 상태 저장소에 붙은 owner와 현재 owner가 다르면 **effect 실행 전 첫 render부터** 작업을 차단한다. 로그아웃 시 scope를 해제하며 새 로그인에 이전 ready를 재사용하지 않는다.

runner가 이미 보관한 미확인 요청·사용자 결합 검사·lease는 변경하지 않는다. 이전 작업을 삭제하거나 다른 계정으로 전송하지 않는다. 로그아웃으로 현재 HTTP 요청의 서버 반영 여부를 추정하지 않는다.

작업 가능 여부는 `현재 owner의 ready && 기존 업무별 잠금 정책 통과`로 계산한다. 정상 송장 연속 스캔의 기존 ScanAllowance 예외도 유지한다. 앱 오류를 숨기기 위해 children 전체를 key로 강제 재마운트하지 않는다.

### 4.3 UX

정상 로그인은 사용자 조작 없이 작업 가능 상태가 된다. 확인/복구 중에는 입력을 받지 않고 기존 준비 안내를 표시한다. 실패 시 해당 확인을 다시 수행하는 ‘처리 내역 확인’과 기존 ‘다시 로그인’을 제공한다. 미확인 요청이 남으면 기존 확인 안내가 계속 보인다.

## 5. B — 작업별 위치 정책

### 5.1 허용 규칙

| 목적                     | 존재/창고                     | 활성 상태           | 시스템 위치                                      |
| ------------------------ | ----------------------------- | ------------------- | ------------------------------------------------ |
| 일반 이동 출발           | 필수/동일 창고                | 비활성도 허용       | 기존 자유 재고 정책 유지                         |
| 일반 이동 도착           | 필수/동일 창고, 출발과 다름   | 활성 필수           | 기존 허용 유지; 이번 변경으로 일괄 금지하지 않음 |
| 적치 도착                | 필수/동일 창고, 원위치와 다름 | 활성 필수           | 금지                                             |
| 재고 조회·실사·조정 검색 | 기존 규칙                     | 전역 필터 추가 없음 | 기존 규칙                                        |

비활성 위치의 잔여 재고를 활성 위치로 꺼내는 경로를 보존한다. 비활성 목적지는 `MOVEMENT_DESTINATION_INACTIVE`(409)로 확정 거절한다. 원장·이벤트·이동 작업·로그는 전부 불변이어야 한다. 적치의 기존 오류 코드와 메시지 계약은 유지한다.

서버의 작은 순수 정책을 `inventory/shared/policies/location-work-policy.ts`, 트랜잭션용 위치 조회/잠금을 `inventory/shared/locks/location-work-lock.ts`에 둔다. 정책은 DB·서비스 DI를 import하지 않는다. 이동 서비스와 입고 커널이 각각 자신의 업무 오류로 매핑한다. 공통 원장에 모든 업무의 목적지 정책을 밀어 넣지 않는다.

### 5.2 동시성

신규 경로의 순서: 기존 문서/회차 잠금 → SKU·창고 stock availability advisory lock(기존 정렬) → 관련 위치를 ID 정렬해 `FOR SHARE` → 목적지 정책 확인 → 기존 원장 변경.

- 이동은 모든 라인의 출발/도착 위치를 중복 제거하고 정렬해 잠근다. 기존 잠금 전 SELECT는 참고 조회일 뿐 최종 판정에 재사용하지 않는다.
- 적치는 기존 회차 잠금 후 stock 잠금을 취득하고 목적지/원위치를 잠근 뒤 목적지 검증과 누계 변경을 수행한다.
- `FOR SHARE`는 위치의 비키 속성 UPDATE와 경합한다. `FOR KEY SHARE`는 isActive 변경을 막지 못하므로 사용하지 않는다.
- 위치 비활성화가 먼저 커밋하면 이동은 최신 비활성 상태를 읽고 거절한다. 이동이 먼저 잠그면 비활성화 UPDATE는 이동 완료 후 진행한다. 나중에 위치를 비활성화하는 업무 자체를 금지하는 설계는 아니다.
- 위치 잠금을 보유한 채 새 stock 잠금을 취득하지 않는다. 기존 `ensureSystemLocations`와 관련 경로의 잠금 순서를 검사하고 두 연결로 교착 여부를 검증한다.

### 5.3 검색 계약

기존 `GET /locations/warehouses/:warehouseId`의 기본 동작을 유지하고 `isSystem?: boolean` 필터를 추가한다. boolean 파싱과 items/total 모두 같은 조건을 사용한다. 기존 `isActive` 필터를 재사용한다.

```ts
type LocationSearchPurpose = 'lookup' | 'movement-source' | 'movement-destination' | 'putaway-destination';
function useLocationSearch(
  warehouseId: string | null,
  search: string,
  purpose?: LocationSearchPurpose, // 기본 lookup
): UseQueryResult<LocationSearchResult>;
```

- movement-destination: `isActive=true`.
- putaway-destination: `isActive=true&isSystem=false`.
- lookup/movement-source: 활성/시스템 필터 없음.
- queryKey에 purpose를 넣는다. 창고·purpose가 바뀌면 이전 query의 placeholder 결과를 선택 후보로 쓰지 않는다.
- `LocationItem`에 서버가 이미 제공하는 `isActive`, `isSystem`을 포함하고 자동 선택과 클릭 모두 검사한다. 목적지 선택에서 속성이 누락되면 허용하지 않는다.
- 출발/원위치 제외 조건은 각 화면이 유지한다. 선택 후 비활성화된 위치는 서버 거절을 보여주고 목적지를 재선택하게 한다. 성공 확정 요청의 재생은 현재 위치 상태 때문에 실패시키지 않는다.

## 6. C — 출고 준비의 상태 전이와 재계획

### 6.1 분류 가능한 무효화 사유

현재 문자열인 `planStalenessReason` 반환을 `PlanInvalidation | null`로 바꾼다. 기존 `reason` 문자열은 로그·응답 호환을 위해 유지하고 결과 snapshot에 선택적 `reasonCode`를 추가한다. 새 schema column은 만들지 않는다.

```ts
type PlanInvalidationCode =
  | 'SOURCE_STOCK_CHANGED'
  | 'PLAN_IDENTITY_CHANGED'
  | 'PLAN_NOT_DRAFT'
  | 'SHIPMENT_SNAPSHOT_CHANGED'
  | 'ALLOCATION_INVALID'
  | 'ELIGIBILITY_CHANGED';
type PlanInvalidation = { code: PlanInvalidationCode; message: string };
```

stock version 불일치/기존 source 가용 수량 감소만 SOURCE_STOCK_CHANGED다. shipment 멤버·manifest/reservation version·배치 방식·송장 유효성 변경은 이에 포함하지 않는다. source snapshot끼리 모순되거나 수량 배정 합계가 틀리면 ALLOCATION_INVALID다. 문자열 포함 여부로 자동 재계획을 결정하지 않는다. 과거 snapshot에 reasonCode가 없으면 자동 교체를 허용하지 않는다.

### 6.2 준비 알고리즘

`SimpleOutboundService.prepare`를 공통 조정 지점으로 유지하고 결과를 `ready | blocked`로 바꾼다. location start/scan/force와 legacy simple scan/force가 모두 이 결과를 처리한다.

```ts
type PreparationBlockReason =
  | PlanInvalidationCode
  | 'SOURCE_INSUFFICIENT'
  | 'ACTIVE_WORK_REQUIRES_REVIEW'
  | 'REPLAN_LIMIT_REACHED';
type OutboundPreparationBlocked = {
  outcome: 'preparation_blocked';
  code: 'SIMPLE_OUTBOUND_PLAN_INVALIDATED';
  reasonCode: PreparationBlockReason;
  batchId: string;
  invalidatedPlanId: string | null;
  recovery: 'retry_preparation' | 'review_batch';
};
type OutboundPreparationResult = { outcome: 'ready'; context: SimpleOutboundContext } | OutboundPreparationBlocked;
type PreparedOutboundResult<T> = T | OutboundPreparationBlocked;
```

1. 인증・창고・지원 방식・현재 work item을 검증한다. 기존 aggregate/invariant 잠금 순서를 유지한다.
2. 정상 active plan/session이면 기존 작업을 재개한다. 이미 확보한 custody/피킹/검수량은 재배정하지 않는다.
3. draft 계획을 검사/시작한다. SOURCE_STOCK_CHANGED이고 아래 조건이 모두 참일 때만 같은 준비 명령 안에서 한 번 교체한다.
   - 동일한 shipment 멤버와 manifest/reservation version, strategy, 현재 유효한 송장.
   - 배치의 작업이 아직 시작되지 않음: active/recovery_required session, custody, 피킹/검수 이력, 유효한 타인 claim이 없음. 불일치 상태를 자동 초기화하지 않음.
4. 이전 계획을 invalidated로 보존하고 현재 가용 수량으로 새 version을 생성한다. #884의 pending/custody 제외 규칙을 재사용한다. 새 계획으로 session 시작과 claim을 수행한다.
5. 신규 계획이 부족으로 실패하면 replacement savepoint를 롤백하고 이전 계획 무효화와 blocked 결과를 남긴다. 재계획 불가 사유는 자동 반복하지 않는다.

이미 draft가 없는 첫 준비에서도 실제 부족은 SOURCE_INSUFFICIENT로 명확히 종결한다. review_batch는 배치/송장 검토를 안내하고 UI가 자동 재제출하지 않는다. retry_preparation은 재고 보충/상태 확인 후 사용자의 새 준비 의도를 허용한다.

### 6.3 트랜잭션·명령 결과

핵심은 **업무상 준비 차단을 예외로 던져 무효화를 되돌리지 않는 것**이다.

- 성공은 기존 `SimpleOutboundState`/`LocationOutboundState` snapshot 그대로 저장한다.
- 예상된 준비 차단은 위 blocked marker를 `fulfillment_command_requests.responseSnapshot`에 저장하고 completed로 종결한다. completed는 명령 결과가 확정됐다는 뜻이며 출고 성공과 구별한다.
- blocked 분기에서 허용하는 변경은 계획 무효화와 명령 결과 기록뿐이다. 대체 계획/세션 생성의 부분 결과, claim, custody, 원장·피킹·검수·송장 상태 변경은 남기지 않는다.
- 재계획의 실패를 격리하는 savepoint는 이전 계획 무효화 **이후**에 만든다. 예상된 부족/검증 실패만 분류해서 처리한다. 알 수 없는 예외/DB 오류/권한 오류는 상위로 전파하고 전체 롤백한다.
- draft가 없는 최초 plan 생성도 생성 전 savepoint로 감싼다. 부족을 blocked로 변환할 때 실패한 내부 plan 명령의 pending 기록과 부분 생성물을 함께 롤백한다. 어느 분기에서도 nested pending을 남긴 채 최상위 명령을 completed로 커밋하지 않는다.
- 준비가 성공한 뒤 스캔 검증·출고가 실패하면 기존처럼 전체 원자적 명령을 롤백한다. 이 분기에서 계획 무효화만 별도 커밋하지 않는다.
- service는 ambient `tx`가 있든 없든 typed result를 반환한다. ambient tx 호출자가 결과 확정 전에 HTTP 예외로 바꾸는 것을 금지한다.
- HTTP controller는 최상위 service 트랜잭션 반환 후 marker를 409로 변환한다. generic `FulfillmentCommandService`에 모든 예외를 저장하는 기능은 추가하지 않는다.

HTTP 409는 기존 code `SIMPLE_OUTBOUND_PLAN_INVALIDATED`와 `details: { reasonCode, recovery }`, 행동 안내 message를 제공한다. 기존 클라이언트는 기존 code로 확정 거절을 인식하고 새 클라이언트는 검증된 details로 구체적 안내를 한다. 정상 2xx 형식과 endpoint/인증 계약은 유지한다.

### 6.4 멱등성과 강제출고

- 최상위 commandType/key/hash 구성은 변경하지 않는다. 본문/사용자 불일치 거절을 유지한다.
- 기존 최초 plan/start 단계 key를 유지한다. 재계획 단계만 `replan:<oldPlanId>:plan`, `replan:<oldPlanId>:start`처럼 기존 structured key namespace 안에서 구분한다. UUID를 매 재시도마다 새로 생성하지 않는다.
- 같은 키의 blocked는 재고 보충 뒤에도 동일한 blocked를 재생한다. 새 시도는 기존 요청의 **확정 거절을 확인한 후** 사용자 조작으로 새 키를 영속 저장하고 전송한다. network/401/403/손상 응답은 미확인을 유지한다.
- 기존 성공 snapshot과 `LOCATION_OUTBOUND_FORCE_NOT_APPLIED` marker를 읽을 수 있어야 한다.
- force resolver가 preparation_blocked를 만나면 실제 출고가 없으므로 기존 `{ outcome: 'rejected', code: 'LOCATION_OUTBOUND_FORCE_NOT_APPLIED' }`로 응답한다. 저장된 원래 blocked 결과를 덮어쓰지 않는다. force 응답 유실 후 권한 철회 복구를 보존한다.
- force의 사용자가 확인한 위치·라인·수량은 재계획 후에도 정확히 일치해야 한다. 새 배정을 묵시적으로 승인하거나 미확인 force의 본문을 바꾸지 않는다.

### 6.5 구현 책임

- picking plan 계층: 원인 코드·무효화·현재 가용량·기존 잠금.
- simple outbound 준비 조정: 교체 자격과 한 번의 재계획·claim·typed result.
- location/simple 명령 경계: snapshot 저장, savepoint, 준비 결과에 따른 실행 분기.
- controller 전용 mapper: 커밋된 blocked를 HTTP 409로 변환.
- native: 알려진 거절 details 해석, 거절 뒤의 명시적 재준비, 현재 서버 상태 재조회. 성공 재생 snapshot을 영구 현재 상태로 취급하지 않음.

## 7. 인수 조건

| ID  | 시나리오                                   | 합격 기준                                      | 계획    |
| --- | ------------------------------------------ | ---------------------------------------------- | ------- |
| A1  | 로그인 전 → 정상 로그인/자동 로그인        | 불필요한 scope 호출 없음, 추가 클릭 없이 ready | A-1/A-2 |
| A2  | scope/IndexedDB 실패 후 재확인             | 실패 단계 성공 전 잠금 유지, 복구 후 해제      | A-1/A-2 |
| A3  | 계정 교체 중 이전 성공·실패 도착           | 이전 결과 무시, 다른 계정 작업 전송 없음       | A-1/A-2 |
| A4  | 준비 성공 + 미확인 출고/정상 연속 스캔     | 기존 업무 잠금/ScanAllowance 유지              | A-2     |
| B1  | 비활성 도착지로 이동                       | 409, 원장·이벤트·작업·로그 불변                | B-1     |
| B2  | 비활성 출발지 → 활성 도착지                | 자유 수량만 정상 회수                          | B-1     |
| B3  | 이동/적치와 비활성화 경합 양방향           | 최신 상태 판정, 부분 반영·교착 없음            | B-1     |
| B4  | 목적별 검색·자동선택·창고 전환             | 도착지 후보만 필터, 이전 결과 선택 없음        | B-2     |
| B5  | 성공 이동 재생 후 목적지 비활성화          | 동일 성공 재생, 원장 변화 없음                 | B-1     |
| C1  | draft → 보충 입고 → 출고 준비              | 옛 계획 invalidated, 새 계획/세션 한 번, 성공  | C-1/C-2 |
| C2  | draft → 선반 이동 → 출고 준비              | 현재 출고 가능 위치로 계획; 충분하면 성공      | C-2     |
| C3  | 재고 부족/송장·멤버 변경/진행 중 작업      | 정확한 차단, 금지된 자동 교체 없음             | C-1/C-2 |
| C4  | 차단 결과 커밋 후 같은 키/새 키            | 같은 키 동일 거절, 확정 후 새 의도만 재평가    | C-2/C-3 |
| C5  | start 동시 호출·재고 변경 경합             | 중복 계획/session/custody 없음                 | C-2     |
| C6  | 준비 후 scan/force 실패 주입               | 부분 피킹·출고 없음, 전체 롤백                 | C-2     |
| C7  | 성공/차단 응답 유실·재실행·force 권한 철회 | 원래 키/본문 복구, 중복 출고 없음              | C-3/C-4 |
| E1  | 로그인 → 입고 → 적치 → 이동 → 출고         | 실제 HTTP/DB에서 수량 보존, 최종 대사          | C-4     |
| E2  | 실제 Windows/PDA·HID·재시작                | 별도 기기 기록; 미실행이면 미검증 표시         | C-4     |

## 8. 적용과 완료 기준

권장 순서는 A → B → C다. 각 계획은 독립 리뷰·커밋 단위이고, C의 내부 타입·서비스·controller·복구 호환 변경은 함께 배포한다. B의 새 오류는 native에 확정 거절 분류를 먼저 제공한다. 새 위치 검색 필터를 모르는 서버에서도 안전하도록 앱은 결과의 활성/시스템 속성을 재검사한다.

새 migration과 환경변수는 필요하지 않다. 기존 #884 서버/앱 계약은 전제다. 운영에 적용할 때는 대상 버전·계정·창고·기기를 명시하고 활성 일반 위치와 개별 출고 배치/송장을 준비한다. 기존 미확인 작업은 보존하고, 기존 입고 원위치 감사·실물 대사 절차를 유지한다.

완료 보고에는 실제 실행 명령, 통과/실패/skip 수, DB 대사와 기기 검증 범위를 기록한다. 기준선의 611/429 통과를 새 구현의 결과로 재사용하지 않는다.
