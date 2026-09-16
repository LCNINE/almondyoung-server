# 물류 시연 복구·위치·출고 준비 — 로컬 인수 기록

## 검증 대상과 범위

- 일시: 2026-09-16 KST (첫 HTTP 실행 10:00, 최종 gate 10:07–10:09). Node `v22.23.1`, Corepack Yarn `1.22.22`.
- 최초 제품 구현 검증 commit: `13ef6bb7c` (A/B/C-1–C-3의 리뷰 수정 포함). C-4 `ec564cd4c`는 인수 검사·test support·gate·문서와 기존 native 테스트의 비동기 종료 대기만 변경했다. 최종 리뷰의 native GET 순서 수정과 제품 blob 증거는 아래 추가 gate에 기록한다.
- C-4 인수 commit은 이 문서를 최초 추가한 `test(warehouse): verify demo workflow recovery over HTTP` commit이다. 정확한 SHA: `git log --diff-filter=A --format=%H -- native/warehouse-app/docs/warehouse-demo-readiness-acceptance.md`.
- 전용 로컬 migrated DB: `postgresql://postgres:postgres@127.0.0.1:5432/warehouse_demo_readiness_test`. DB suite는 직렬 실행했다. DB drop/reset, 운영 데이터 보정, schema/enum/의존성 변경은 없다.
- 시연 범위: **개별 배치, 기발급 송장, 활성 일반 위치, 같은 창고**. 배포와 실제 기기 인수는 아래 별도 미검증 항목이다. 최종 제품 수정 commit `0c21f0260`의 독립 scoped 재리뷰까지 승인되었다.

## 실제 HTTP/DB 인수

`warehouse-demo-workflow-http.integration.spec.ts`의 **8개 검사**는 native `createApiClient`/runner/store → Node fetch → 실제 listening Nest → ScopeGuard/DTO/GlobalExceptionFilter → 실제 서비스/트랜잭션 → PostgreSQL을 연결한다. 인증 identity·역할 매핑과 Tauri transport를 대체하며 IndexedDB는 fake-indexeddb 플랫폼에서 실제 operation store 구현을 사용한다. 사용하지 않는 carrier 발급·consolidation collaborator는 기존 test wiring의 범위 밖이다. 외부 OIDC·Tauri 프로세스·장비 재시작 검증으로 해석하지 않는다.

### 수량 대사

| 순서 | 입고대기 | A | B | 출고 누계 | ON_HAND |
| --- | ---: | ---: | ---: | ---: | ---: |
| 입고 10 | 10 | 0 | 0 | 0 | 10 |
| A에 6 적치 | 4 | 6 | 0 | 0 | 10 |
| A → B로 2 이동 | 4 | 4 | 2 | 0 | 10 |
| 잔여 4를 B에 적치 | 0 | 4 | 6 | 0 | 10 |
| B에서 3 출고 | **0** | **4** | **3** | **3** | **7** |

두 UUID를 정렬해 작은 값을 B에 배정한다. planner가 B에서 3을 선택함을 먼저 검사한다. 송장 fixture는 기존 SKU/창고에 조합하며 기초 원장을 만들지 않는다. 입고 전 원장 0행, 최종 RECEIVE 정확히 1개/10, SHIP 정확히 1개/3을 검사한다. 이동 전에 draft를 만드는 변형도 A 배정 → invalidated + 현재 B 배정 → 동일 최종 수량을 확인한다.

추가 HTTP 검증:

- 비활성 도착지 이동은 409 `MOVEMENT_DESTINATION_INACTIVE`; 원장·이벤트·movement job·로그가 동일하다.
- draft 이후 출발지 재고 감소를 SQL로 주입한 별도 부족 fixture에서 실제 start HTTP409를 확인한다. 응답 후 새 PostgreSQL 연결의 SELECT가 invalidated plan, completed preparation_blocked snapshot, session 없음, queued/unclaimed work를 확인한다. 이 fixture는 외부 재고 변화 주입이며 정상 수량 대사 시나리오와 구분한다.
- 잔여 입고 재고 적치 후에도 같은 키는 과거 409를 재생한다. 확정 rejected record 이후 명시적 새 키만 현재 재고로 준비한다. UI에서 새 키를 만드는 조건은 C-3 native runtime 검사가 담당한다.
- scan 성공 및 start 차단 응답을 서버 처리 후 유실시킨다. 새 store/runner가 원래 키·본문으로 복구하고, confirmed/rejected와 preparation metadata를 보존한다. 성공 재생은 출고를 추가하지 않는다.
- force 성공/차단 응답 유실 후 force 권한을 철회한다. 새 runner는 resolver만 호출하여 confirmed 또는 FORCE_NOT_APPLIED를 얻는다. 신규 force는 실제 ScopeGuard에서 403이다. 차단 snapshot은 덮어쓰지 않고 출고 이벤트가 없다.

## 최종 실행 gate

아래 명령은 작업공간 루트에서 실행했다. DB가 필요한 기본 단위 검사 skip을 필수 DB 인수 통과 수에 섞지 않는다.

| Gate | 결과 | 시간 | 로그 |
| --- | --- | --- | --- |
| 필수 DB 인수 | 5파일 / 63검사 통과, 실패 0 / skip 0 | 16.514초 | `/tmp/c4-db-gate.log` |
| DB 주소 누락 | **예상 exit 1**, 5 suite 로딩 거절 / 실행 검사 0 | 3.885초 | `/tmp/c4-db-missing.log` |
| Core 영향 범위 | 21파일 / 349검사 통과, 실패 0 / skip 0 | 43.549초 | `/tmp/c4-targeted-green.log` |
| Native 전체 | 91파일 / 684검사 통과, 실패 0 / skip 0 / unhandled 0 | 64.79초 | `/tmp/c4-native-final.log` |
| 기본 CI 단위 검사 | 614파일 / 5,514검사 통과, 실패 0; 기본 DB guard 등 의도적 150파일 / 1,267검사 skip | 83.787초 | `/tmp/c4-unit-final.log` |
| Root type-check | exit 0 | 8.45초 | `/tmp/c4-types-final.log` |
| Native build | exit 0; 기존 Vite chunk-size 경고 | 10.04초 | `/tmp/c4-native-build-final.log` |
| Native lint | exit 0; 오류 0 / 기존 경고 22 / 신규 경고 0 | 0.17초 | `/tmp/c4-native-lint-final.log` |
| Consume validation | exit 0; 위반 없음 | 1.76초 | `/tmp/c4-consume.log` |

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/warehouse_demo_readiness_test corepack yarn test:warehouse-demo:integration
env -u DATABASE_URL corepack yarn test:warehouse-demo:integration
corepack yarn --cwd native/warehouse-app test --maxWorkers=2
corepack yarn --cwd native/warehouse-app build
corepack yarn --cwd native/warehouse-app lint
corepack yarn type-check
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/warehouse_demo_readiness_test corepack yarn test --runInBand --testPathPattern='(inbound-origin|inbound-receipt.kernel|inbound-workflow-http|location-outbound|simple-outbound|outbound-preparation|movement-location-policy|warehouse-operation-auth|outbound-v2-authorization|picking-plan.spec|picking-strategy.contract.spec)'
env -u DATABASE_URL -u REQUIRE_WAREHOUSE_DEMO_DB corepack yarn test --ci --silent --maxWorkers=2
corepack yarn audit:consume-validation --gate
```

### 발견 및 수정 기록

- HTTP fixture 초기 실행: 2통과/5실패, 다음 3통과/4실패. DB allocation 필드(`qty`), cleanup 테이블명, 테스트 간 공유 actor의 active claim, 부족 상태 fixture 구성 오류를 수정했다. 제품 회귀 RED로 주장하지 않는다. 정리 실패로 남은 이 suite의 7개 고유 fixture만 별도 정리했다.
- 최초 Core 영향 범위: 20파일/316통과, audit suite의 33검사가 전용 DB 이름 guard에서 거절됐다. 기존 `inbound_workflow_consistency_test`와 이번 `warehouse_demo_readiness_test` 두 이름만 허용하도록 test guard를 확장했다. 다른 DB의 거절과 scoped cleanup을 유지했다. 위 최종 명령은 349/349 통과했다.
- 최초 native 전체: 91파일/684검사 통과였지만 **unhandled rejection 1개로 exit 1**이었다. 기존 PurchaseOrderReceiveScreen 마지막 검사가 두 번째 POST 시작 직후 종료되어 비동기 재확인이 jsdom 종료 이후 남았다. 즉시 완료 상태 assertion으로 **14통과/1실패 RED**를 재현한 뒤, 같은 키 비교를 유지하면서 재확인 버튼의 enabled 복귀를 기다리도록 수정했다. focused **15/15 GREEN**; 오류를 억제하거나 제품 코드를 바꾸지 않았다.
- 기본 CI 단위 검사는 첫 실행도 614파일/5,514검사 통과(93.161초)였고 종료 경고가 없었다. 최종 재실행은 동일 통과/skip 수와 exit 0이지만 worker 강제 종료 경고가 1회 있었다. 변경된 DB suite의 DB 없는 수집을 `--detectOpenHandles`로 검사한 결과 3파일/42검사 의도적 skip, 경고 없이 exit 0이었다. 새 HTTP suite는 실제 실행에서 app.close와 pool.end 및 scoped cleanup을 완료했다. 전체 unit 경고를 낸 suite는 특정하지 못했으며 최종 리뷰에 minor로 전달한다. 이를 경고 없는 실행으로 보고하지 않는다.
- 기존 AuditService 로그/권한 실패 주입 로그는 영향 범위 suite의 의도된 출력이다. 새로운 lint warning이나 schema 변경은 없다.

## 최종 리뷰 P2 수정 — GET 응답 순서와 큐 해제

- 기준 commit: `ec564cd4c`. 수정 commit은 `fix(warehouse): order current-state reconciliation before queue release`이며 정확한 SHA는 `git log -1 --format=%H --grep='^fix(warehouse): order current-state reconciliation before queue release$'`로 확인한다.
- 검증한 제품 파일 `LocationOutboundScreen.tsx`의 Git blob: `5867df230b71a875274e4a8eb493165d3fc24c54`. runtime 검사 파일 blob: `8b55db673b393c580e9e411ec1748694a4b87322`. 각각 `git rev-parse <수정-SHA>:native/warehouse-app/src/domains/outbound/<파일명>`으로 대조한다.
- 실제 screen/hook/runner/store/IndexedDB runtime에서, scan 전 GET A → scan commit → GET B 시작 → A의 과거 in_progress 응답 → B의 현재 shipped 응답 순서를 제어했다. 뒤의 recovery GET G3는 계속 대기시켰다. 기존 코드는 B를 버려 완료 표시 없이 큐를 해제했다. 서버 중복 재고 차감이 입증된 결함으로 확대하지 않는다.
- 각 GET에 시작 순번을 부여하고 **종료된 GET 중 가장 나중에 시작한 요청**만 상태를 바꾼다. 최신 요청이 실패한 사실도 같은 순서로 보존한다. 늦게 도착한 이전 성공은 최신 실패를 지울 수 없다. 단순히 새 요청이 시작됐다는 이유로 아직 유효한 scan 후 GET을 버리지 않는다.
- refresh 성공 반환은 실제 채택한 상태이며 해당 GET 또는 더 나중에 시작한 GET에서 온 상태다. 더 최신의 종료된 GET이 실패했다면 이전 성공도 거절하여 큐 head를 유지한다. 이후 재확인은 동일한 저장된 key/body/source를 사용한다. force의 현재 위치·라인·잔여수량 비교는 유지한다.
- HTTP 경계만 지연/실패시키는 회귀 5개를 추가했다. 최초 **RED 3실패/42통과**, 수정 후 **GREEN 45통과**. A가 B 전/후에 성공·실패하는 순서, G3 실패 뒤 B의 오래된 성공, 추가 스캔 차단과 동일 key 복구를 포함한다. 모든 지연 응답은 테스트 종료 전에 해제한다.

| 추가 gate | 결과 | 시간 | 로그 |
| --- | --- | --- | --- |
| Runtime RED | 예상 exit 1; 1파일 / 3실패·42통과 | 6.95초 | `/tmp/final-fix-red.log` |
| Runtime GREEN | exit 0; 1파일 / 45통과 | 4.74초 | `/tmp/final-fix-green.log` |
| Outbound + queue 영향 범위 | exit 0; 10파일 / 85통과 (100스캔 포함) | 6.36초 | `/tmp/final-fix-affected.log` |
| Native 전체 | exit 0; 91파일 / 689통과, 실패 0 / skip 0 / unhandled 0 | 48.85초 | `/tmp/final-fix-native.log` |
| Native build | exit 0; 기존 Vite chunk-size 경고 | 6.27초 | `/tmp/final-fix-build.log` |
| Native lint | exit 0; 오류 0 / 기존 경고 22 / 신규 경고 0 | 0.10초 | `/tmp/final-fix-lint.log` |
| Root type-check | exit 0 | 7.28초 | `/tmp/final-fix-types.log` |

```bash
corepack yarn --cwd native/warehouse-app test src/domains/outbound/LocationOutboundScreen.runtime.test.tsx --maxWorkers=2
corepack yarn --cwd native/warehouse-app test src/domains/outbound src/core/hardware/scan/workScanQueue.test.ts src/core/hardware/scan/useWorkScanQueue.test.tsx --maxWorkers=2
corepack yarn --cwd native/warehouse-app test --maxWorkers=2
corepack yarn --cwd native/warehouse-app build
corepack yarn --cwd native/warehouse-app lint
corepack yarn type-check
git diff --check
```

서버·DB 변경이 없어 위의 C-4 DB/default CI/consume gate는 재실행하지 않았고 기존 로그와 commit 증거를 유지한다. 특히 `/tmp/c4-unit-final.log`의 worker 강제 종료 경고는 발생 suite와 원인이 아직 불명이며 baseline 경고라고 단정하지 않는다. 첫 전체 실행 `/tmp/c4-unit.log`에는 경고가 없었고, 변경 suite의 별도 `--detectOpenHandles` 로그 `/tmp/c4-open-handles.log`에도 없었다. 이번 native 통과를 그 경고의 해결 증거로 취급하지 않는다.

## 인수 조건 매핑

| ID | 자동 증거 | 판정 |
| --- | --- | --- |
| A1 | useWorkReadiness, WorkBoundary.runtime의 로그인/자동 준비 | 로컬 통과 |
| A2 | readiness scope/restore/retry 및 operationStore transient open 복구 | 로컬 통과 |
| A3 | hook의 지연 응답·Suspense, real-provider 계정 전환 | 로컬 통과 |
| A4 | WorkBoundary.runtime, outbound runtime/scan queue의 정상 sending·uncertain 잠금 | 로컬 통과 |
| B1 | 새 HTTP 비활성 이동 409 + movement-location-policy integration | 로컬 통과 |
| B2 | movement-location-policy integration의 비활성 출발 회수·예약 보호 | 로컬 통과 |
| B3 | movement-location-policy concurrency의 이동/적치 양방향 잠금·교착 회귀 | 로컬 통과 |
| B4 | location query DTO/service 및 native 목적별 검색·응답 역전·창고 전환 | 로컬 통과 |
| B5 | movement-location-policy integration의 성공 후 비활성화 같은 키 재생 | 로컬 통과 |
| C1 | outbound-preparation integration의 보충 후 draft 교체 | 로컬 통과 |
| C2 | 새 HTTP 이동 전 draft 변형 및 preparation integration | 로컬 통과 |
| C3 | picking-plan/strategy, preparation policy/integration의 부족·송장·멤버·진행 이력 | 로컬 통과 |
| C4 | 새 HTTP 별도 연결의 차단 커밋, 같은/새 키; native 명시적 재준비 | 로컬 통과 |
| C5 | outbound-preparation concurrency의 독립 연결 경합 | 로컬 통과 |
| C6 | preparation integration의 scan/force 후속 실패 전체 rollback | 로컬 통과 |
| C7 | 새 HTTP 성공·차단·force 유실/복구·권한 철회; native current GET/queue 복구 | 로컬 통과 |
| E1 | 새 HTTP native runner→입고→적치→이동→출고 실제 수량 대사 | 로컬 통과; 로그인은 A runtime 증거 |
| E2 | 아래 실제 장비 체크리스트 | **미검증** |

## 실제 시연 전 남은 확인

- [ ] Windows 및 PDA 실제 로그인/자동 로그인, 실제 OIDC 흐름
- [ ] 실제 HID 연속 A/A/B와 100스캔, 중복·순서·처리량
- [ ] 장비에서 포커스 이동과 Enter 입력
- [ ] 실제 앱/Tauri/OS 재시작 뒤 작업 복구
- [ ] 실제 Wi-Fi 단절·재연결 후 같은 키 복구
- [ ] 시연 서버 Core/앱 배포 버전·계정·창고·송장 대조
- [x] 최종 P2 수정 wave의 독립 scoped 재리뷰 — `ec564cd4c..0c21f0260`, 원래 P2 해결·신규 지적 없음

기기 항목은 자동 스캔/runner 검사로 완료 처리하지 않는다. B의 새 거절 code는 앱 처리를 먼저 배포하고, C의 서버·앱 계약은 함께 맞춘다. 배포하거나 운영 재고를 보정한 사실은 없다.


## 최종 독립 검토

- C-4 `ec564cd4c`: 스펙·품질 승인. 실제 HTTP 인수와 실행 로그 확인.
- 전체 변경 `97728545d..ec564cd4c`: 서버 구조·위치 정책·복구 계약 검토. 출고 화면의 조회 응답 순서 P2를 발견했다.
- 수정 `0c21f0260`: 실패 재현 후 수정 및 native 전체 689검사 통과. 독립 scoped 재리뷰에서 P2 해결과 신규 문제 없음을 확인했으며 병합 가능 판정을 받았다.
- 잔여 비차단 항목: 원인 미확정 Jest worker 종료 경고, 기존 native lint 22건·Vite chunk 크기 경고. AuditService 출력은 의도된 복구/실패 주입 로그로 검토했다.
- 이 최종 문서 갱신은 제품 코드를 변경하지 않는다. 브랜치는 `codex/warehouse-demo-readiness`이며 merge/push/배포는 수행하지 않았다.

## 구현 중 판단 기록

실행 중 내린 판단을 발생 순서대로 보존한다. 아래 비용은 판단이 잘못되었을 때 다시 검토하거나 되돌려야 할 범위다.

| 순서 | 판단과 근거 | 비용·주의점 |
| --- | --- | --- |
| 1 | 공통 HTTP 필터에 알려진 출고 준비 오류 세부정보만 허용했다. 기존 필터가 이를 버려 앱의 복구 안내에 도달하지 못했다. | 공유 응답 필터의 작은 변경이므로 허용 목록의 호환성을 유지해야 한다. |
| 2 | IndexedDB open 실패 Promise 캐시를 해제했다. 재확인으로 실제 저장소 실패에서 회복하려면 필요했다. | 공유 저장소 초기화 경로가 변경된다. 저장 데이터는 삭제하지 않는다. |
| 3 | 검증된 거절 세부정보를 선택적 작업 메타데이터로 저장하고 runner에서 복원했다. 오류 객체만 바꾸면 재생 과정에서 정보가 사라진다. | 과거 레코드와의 호환성을 관리한다. DB 버전과 요청 키는 그대로다. |
| 4 | 시스템 위치 생성·재활성화 잠금을 UUID 순서로 정렬했다. 역할 순서 잠금과 이동 잠금의 교착을 재현했다. | 공유 위치 helper의 생성·재활성화 동작을 보존해야 한다. |
| 5 | 기본 위치를 사용하는 재고 조정도 재고 잠금을 먼저 잡도록 했다. 이동과의 잠금 역순 교착을 재현했다. | 재고 조정 경로의 잠금 순서가 바뀐다. 수량·권한 규칙은 유지한다. |
| 6 | 처음에는 출고 준비 전체에 공통 재고·구성요소 잠금을 먼저 적용했다. 기존 작업 행 선점과의 충돌을 해결하려는 판단이었다. | 준비 조회 경로를 재구성했다. 후속 검토에서 8번처럼 적용 범위를 좁혔다. |
| 7 | 송장 사용 가능성 확인 지점의 알려진 ConflictError만 출고 계획 원인으로 변환했다. 취소 송장을 검토 필요 결과로 확정하기 위해서다. | 해당 호출 경계의 오류 분류를 유지해야 한다. 알 수 없는 오류·권한·DB 오류는 전파한다. |
| 8 | 6번 공통 잠금 순서는 draft/no-plan에 한정하고 진행 중 작업은 기존 잠금 순서를 유지했다. 직접 피킹 진입점과의 새 교착을 막는다. | 준비 분기와 상태 전환 시 재시도 검사가 추가된다. |
| 9 | 다른 키의 동시 시작에서 draft→active 전환을 발견하면 전체 시도를 rollback하고 같은 원래 키로 재시도하도록 했다. 잠금 상태를 섞지 않기 위해서다. | 보수적인 일시 재시도가 발생할 수 있다. 새 키를 만들거나 영구 차단으로 확정하지 않는다. |
| 10 | 입고 일관성 audit 테스트의 DB 이름 허용 목록에 전용 `warehouse_demo_readiness_test`만 추가했다. 계획된 통합 명령이 해당 suite도 실행한다. | 테스트 안전 목록이 한 이름만 확장된다. 다른 DB 차단과 fixture 정리는 유지한다. |
