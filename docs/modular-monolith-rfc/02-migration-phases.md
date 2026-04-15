# 02. Migration Phases

## 목표

이 문서는 `PIM → WMS → order-matching` 순서로 `apps/almondyoung-server`로 수렴시키는 단계별 계획을 정의한다.

핵심 원칙은 다음과 같다.

- phase별로 중간 성공 상태가 있어야 한다.
- 각 phase는 rollback 가능한 단위여야 한다.
- 외부 계약은 구조보다 우선한다.

## Phase 0. Compatibility Baseline

먼저 "무엇이 같아야 하는지"를 고정한다.

### 작업

- PIM Swagger snapshot 확보
- WMS Swagger snapshot 확보
- 대표 API golden test 선정
- 대표 에러 응답 shape 저장
- 외부 앱이 실제로 쓰는 PIM/WMS endpoint 목록 정리
- Kafka event contract 목록 정리

### 산출물

- PIM compatibility checklist
- WMS compatibility checklist
- golden test 목록
- 외부 소비자 목록

### Exit Criteria

- "이전 후에도 같아야 하는 계약"이 문서화되어 있다.
- 대표 API와 이벤트 목록이 빠짐없이 식별되어 있다.

## Phase 1. Platform Foundation in almondyoung-server

`apps/almondyoung-server`를 실제 모놀리스 셸로 만든다.

### 작업

- `Express` 기반 bootstrap 정리
- global validation/filter/cors/cookie/swagger 표준화
- platform layer 디렉터리 도입
- named DB connection 또는 connection registry 설계
- root-owned auth/events registration 설계
- `RouterModule` 기반 route composition 초안 작성

### 중요 결정

- 초기에는 복수 DB connection을 허용할 수 있다.
- 이유는 기능 이전과 DB topology 변경을 분리하기 위해서다.

### Exit Criteria

- `almondyoung-server`가 독자적인 표준 bootstrap을 가진다.
- PIM/WMS를 얹을 수 있는 platform API가 준비된다.

## Phase 2. Introduce Compatibility Modules

기존 PIM/WMS 모듈을 root-owned infra 위에 얹기 위한 adapter layer를 만든다.

### 작업

- `compatibility/pim`
- `compatibility/wms`
- 기존 `PimModule`, `WmsModule`이 직접 올리던 `forRoot` 계층 분리
- root app가 제공하는 provider를 feature module이 사용하도록 조정

### 주의

현재 PIM/WMS는 각각 다음을 직접 초기화한다.

- config
- db
- auth
- events

이를 그대로 import하면 provider collision이 날 수 있다. compatibility module은 이 중복을 제거하는 첫 단계다.

### Exit Criteria

- root app에서 PIM/WMS feature module을 import할 수 있다.
- `forRoot` 중복 초기화 없이 앱이 기동된다.

## Phase 3. Absorb PIM into almondyoung-server

PIM을 먼저 흡수한다.

### 작업

- PIM route를 동일 path로 노출
- PIM swagger를 root app에서 구성
- PIM controller/service/dto 재사용 또는 이동
- PIM health, products, categories, channels, pricing, tags, banners, approval, bulk, csv, audit, dashboard를 순차 이관
- 기존 PIM 테스트 또는 smoke test를 `almondyoung-server` 기준으로 재실행

### 이유

- PIM은 WMS보다 prefix/부트스트랩이 단순하다.
- order-matching과의 경계도 먼저 PIM 쪽 SoT를 안정화해야 정리하기 쉽다.

### Exit Criteria

- `almondyoung-server` 하나로 PIM API가 기존과 동일하게 응답한다.
- 주요 PIM golden test가 통과한다.

## Phase 4. Absorb WMS into almondyoung-server

WMS를 두 번째로 흡수한다.

### 작업

- `/wms` route space 유지
- WMS health, inventory, movement, inbound, suppliers, stocktaking, sales-orders, fulfillments를 순차 이관
- WMS swagger를 root app에서 구성
- WMS auth/error shape를 compatibility layer에서 유지
- WMS consumer bootstrap 로직을 root integration layer로 이동

### 주의

- 기존 WMS는 Fastify-specific Passport shim과 global prefix에 의존한다.
- Express target에서는 이 전제를 그대로 가져오지 않고, route composition과 auth adapter로 바꿔야 한다.

### Exit Criteria

- `almondyoung-server` 하나로 WMS API가 기존과 동일하게 응답한다.
- `/wms` prefix가 유지된다.
- 주요 WMS golden test가 통과한다.

## Phase 5. Single-Process Compatibility State

이 단계는 "모놀리스로의 1차 수렴"이 완료된 상태다.

### 달성 상태

- `apps/almondyoung-server` 단독 실행
- PIM API 제공
- WMS API 제공
- `[나머지 앱]`과의 이벤트 계약 유지
- 기존 admin-web 등 클라이언트가 큰 변경 없이 붙는다

### Exit Criteria

- PIM/WMS 기능이 한 프로세스에서 함께 동작한다.
- 기존 운영 시나리오를 재현할 수 있다.

## Phase 6. Consolidate Database into almondyoung + Schemas

런타임 통합이 끝난 뒤 DB topology를 최종 형태로 바꾼다.

### 작업

- `almondyoung` database 생성
- `pim`, `wms`, `authorization`, `eventing` schema 정의
- Drizzle schema를 `pgSchema(...)` 기반으로 재구성
- migration tool과 seed 흐름 정리
- 데이터 복제/이관/cutover 계획 수립
- `DbModule`을 최종 단일 connection 기준으로 단순화

### 권장 전략

- PIM과 WMS를 동시에 옮기지 않는다.
- schema 단위로 순차 cutover 한다.
- migration 전후 데이터 검증 스크립트를 준비한다.

### Exit Criteria

- `almondyoung` 하나의 DB만으로 앱이 동작한다.
- PIM/WMS 데이터가 schema별로 분리되어 있다.

## Phase 7. Reduce Internal PIM↔WMS Choreography

이제야 내부 복잡도를 줄인다.

### 작업

- 내부 Kafka-only 흐름 식별
- PIM→WMS 내부 이벤트를 직접 application service 호출 또는 로컬 도메인 이벤트로 대체
- 내부 projection과 중복 저장 제거
- outbox는 외부 계약용으로만 유지

### 예시

- PIM variant 생성 → WMS pending matching 생성 같은 내부 choreography 제거
- 동일 앱 내부에서 필요한 책임만 직접 호출로 정리

### Exit Criteria

- 내부 핵심 흐름이 Kafka 순서/유실/재시도에 덜 의존한다.
- 외부 이벤트 계약은 유지된다.

## Phase 8. Introduce ProductMatchingModule

이제 `order-matching`을 모놀리스 내부 bounded context로 추가한다.

### 작업

- 기존 WMS 내 매칭 책임 식별 및 분리
- `ProductMatchingModule` 생성
- variant ↔ sku 매칭 SoT 이전
- 판매주문 → 재고주문 변환 스냅샷 책임 이전
- PIM/WMS는 facade를 통해 matching에 접근

### Exit Criteria

- 매칭 책임이 PIM/WMS에서 분리된다.
- `order-matching`이 새 마이크로서비스가 아니라 내부 모듈로 동작한다.

## Phase 9. Retire Legacy Apps

최종 단계다.

### 작업

- `apps/pim`, `apps/wms`를 thin compatibility app 또는 retired 상태로 전환
- 불필요한 bootstrap/env/script 정리
- build/start/test 스크립트 정리

### Exit Criteria

- 운영 진입점은 `apps/almondyoung-server` 하나다.
- legacy app는 더 이상 필수 런타임이 아니다.

## Cross-Phase Rules

모든 phase에 공통으로 적용할 규칙:

- API path를 함부로 바꾸지 않는다.
- event contract를 함부로 바꾸지 않는다.
- phase를 건너뛰지 않는다.
- DB topology 변경은 런타임 통합 이후로 미룬다.
- order-matching은 PIM/WMS 흡수 이후에만 시작한다.
