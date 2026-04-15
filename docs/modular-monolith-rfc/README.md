# Modular Monolith RFC

## 목적

이 RFC 묶음의 목적은 현재 분리된 `PIM`, `WMS`, 이후의 `order-matching`을 `apps/almondyoung-server` 하나로 수렴시키는 기준을 고정하는 것이다.

첫 단계의 성공 조건은 단순하다.

- 현재 `apps/pim`과 `apps/wms`가 제공하는 HTTP 동작을 `apps/almondyoung-server` 하나에서 동일하게 제공한다.
- 기존 외부 앱들은 endpoint, payload, event contract를 가능한 한 바꾸지 않고 계속 동작한다.
- 내부 구조는 모듈러 모놀리스로 재편한다.

## 범위

이번 RFC의 직접 범위:

- target runtime topology
- 표준 app structure
- DB topology와 migration sequencing
- compatibility-first migration plan
- phase별 exit criteria

이번 RFC의 직접 범위 밖:

- SST 배포 설계
- 서브도메인 라우팅
- order-matching 세부 도메인 설계
- channel-adapter, search, analytics 등의 재설계

## 고정된 결정

- 단일 애플리케이션 셸은 `apps/almondyoung-server`다.
- HTTP adapter는 `Express`로 통일한다.
- 최종 DB는 단일 `almondyoung` database 안에서 schema를 분리한다.
- `order-matching`은 PIM/WMS 이전 완료 후에만 넣는다.
- 첫 목표는 구조 개선이 아니라 **외부 계약 유지**다.

## 문서 목록

- [01 Target Architecture](./01-target-architecture.md)
- [02 Migration Phases](./02-migration-phases.md)
- [03 Compatibility Matrix](./03-compatibility-matrix.md)

## 읽는 순서

1. `01-target-architecture.md`
2. `02-migration-phases.md`
3. `03-compatibility-matrix.md`

## 핵심 원칙

### 1. Compatibility First

내부 구현보다 외부 계약이 우선이다. API path, payload, status code, error shape, 이벤트 계약을 먼저 고정한다.

### 2. App Monolith, Data Ownership Separation

앱은 하나로 합치되, 데이터 소유권은 schema와 모듈 경계로 유지한다.

### 3. Runtime Consolidation Before Domain Simplification

먼저 한 프로세스 안에 담고, 그 다음에 내부 비동기 choreography와 중복 책임을 걷어낸다.

### 4. Order-Matching Comes Later

지금 order-matching이 어려운 가장 큰 이유는 PIM과 WMS가 이미 앱 경계를 사이에 두고 있기 때문이다. 따라서 PIM/WMS를 먼저 흡수하지 않은 상태에서 order-matching부터 다시 설계하지 않는다.
