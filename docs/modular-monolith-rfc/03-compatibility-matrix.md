# 03. Compatibility Matrix

## 목적

이 문서는 `apps/pim`과 `apps/wms`를 `apps/almondyoung-server`로 이전할 때 반드시 유지해야 할 계약을 표로 고정한다.

원칙은 하나다.

- 내부 구현이 아니라 외부에서 관측 가능한 동작을 맞춘다.

## PIM Compatibility Matrix

| 항목 | Current | Target in `almondyoung-server` | 비고 |
|------|---------|--------------------------------|------|
| HTTP adapter | Fastify | Express | 구현 방식만 변경 |
| Route prefix | 없음 | 없음 | 유지 |
| Health endpoint | `/health` | `/health` | 유지 |
| Swagger | `/docs`, `/docs.yaml` | 동일 경로 또는 동일한 접근 경로 제공 | 우선 동일 유지 권장 |
| Validation | PIM 전용 `ValidationPipe` 옵션 | 동일 옵션 재현 | 에러 shape 중요 |
| Exception filter | `GlobalExceptionFilter` | 동일 shape 재현 | root 또는 route-scope |
| Cookie | Fastify plugin | Express middleware | 동작 동일성 확인 필요 |
| Multipart | Fastify multipart | Express multipart/multer | 업로드 동작 회귀 테스트 필요 |
| Auth | 기존 PIM auth 설정 | 동일 scope/guard 유지 | root-owned infra 위에서 재현 |
| DB ownership | PIM 전용 DB | 최종적으로 `almondyoung.pim` schema | 초기 migration에서는 별도 connection 허용 가능 |
| Event publish | product stream 발행 | 유지 | 외부 소비자 보호 |

## WMS Compatibility Matrix

| 항목 | Current | Target in `almondyoung-server` | 비고 |
|------|---------|--------------------------------|------|
| HTTP adapter | Fastify | Express | 구현 방식만 변경 |
| Route prefix | app global prefix `/wms` | `/wms` route space 유지 | app-level global prefix는 제거 |
| Health endpoint | `/wms` 및 `/wms/health` 계열 | 동일 route 유지 | 확인 필요 |
| Swagger | `/docs`, `/docs.yaml` under WMS app | root app에서 동등 접근 경로 제공 | prefix 정책 확정 필요 |
| Validation | 단순 `ValidationPipe` | 동일 동작 유지 | |
| Error shape | WMS 전용 예외 응답 | 동일 shape 유지 | route/module scope adapter 필요 |
| Passport shim | Fastify reply shim | 제거 가능 | Express에서는 불필요해야 함 |
| Auth | WMS scope/guard | 동일 유지 | |
| DB ownership | WMS 전용 DB | 최종적으로 `almondyoung.wms` schema | 초기 migration에서는 별도 connection 허용 가능 |
| Event consume | product/order stream 소비 | 유지 후 점진 축소 | 내부 계약 제거는 나중 |
| Event publish | fulfillment/inventory 관련 이벤트 | 유지 | 외부 소비자 보호 |

## Shared Infrastructure Matrix

| 항목 | Current | Target | 비고 |
|------|---------|--------|------|
| Config boot | PIM/WMS 각각 `forRoot` | root 1회 초기화 | 필수 |
| DB boot | PIM/WMS 각각 `forRoot` | root-owned connection registry | 필수 |
| Auth boot | 각 앱별 초기화 | root-owned auth + module-specific policy | 필수 |
| Event boot | 각 앱별 초기화 | root-owned publisher + module consumers | 필수 |
| Logging/Tracing | 앱별 부트스트랩 | root 표준화 | 점진 정리 가능 |

## Route Compatibility Rules

### 유지해야 하는 것

- PIM route path
- WMS route path
- HTTP method
- status code
- response body field 이름
- validation failure shape
- auth failure shape

### 당장 바꾸지 않는 것

- route naming
- controller grouping
- swagger tag 구조

## DB Compatibility Rules

### 유지해야 하는 것

- 기존 데이터 의미
- 기존 primary key 값
- 기존 외부 참조 방식
- migration 전후 데이터 row count와 핵심 invariant

### 바꿔도 되는 것

- 물리 DB 위치
- schema namespace
- connection topology
- migration tool 구성 방식

## Event Compatibility Rules

### 유지해야 하는 것

- stream name
- event name
- payload field shape
- consumer가 기대하는 correlation semantics

### 나중에 바꿔도 되는 것

- 내부에서 그 이벤트를 만드는 방식
- 내부 앱 간 event choreography
- internal projection 구조

## Phase Gate Checklist

각 phase가 끝날 때 아래를 확인한다.

### PIM Gate

- `/health` 포함 핵심 endpoint 응답 동일
- 대표 생성/조회/수정 API 통과
- swagger 접근 가능
- auth/validation 에러 shape 동일

### WMS Gate

- `/wms/...` 핵심 endpoint 응답 동일
- 대표 inventory/order/fulfillment API 통과
- swagger 접근 가능
- auth/error shape 동일

### DB Gate

- 데이터 이관 전후 row count 검증 완료
- schema별 ownership 명확
- rollback 절차 준비 완료

### Event Gate

- `[나머지 앱]`의 consumer가 깨지지 않음
- 기존 stream contract 유지
- event tracing/outbox 동작 확인
