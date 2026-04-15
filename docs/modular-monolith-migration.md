# Modular Monolith Migration RFC

## Status

진행 중인 상위 RFC 문서다. 세부 설계는 `docs/modular-monolith-rfc/` 아래 문서들에 정리한다.

## Goal

첫 목표는 다음과 같다.

- 현재 `apps/pim` + `apps/wms`가 제공하는 기능을 `apps/almondyoung-server` 하나에서 동일하게 제공한다.
- `[나머지 앱]`과의 외부 계약은 최대한 유지한다.
- `order-matching`은 PIM/WMS 이전이 끝난 뒤 `almondyoung-server` 내부 모듈로 추가한다.
- 배포, 서브도메인 라우팅, SST 구성은 현재 스코프에서 제외한다.

핵심은 "아키텍처를 더 예쁘게" 만드는 것이 아니라, **기존 계약을 깨지 않고 한 프로세스 안으로 수렴시키는 것**이다.

## Locked Decisions

- 단일 deployable app: `apps/almondyoung-server`
- 단일 HTTP adapter: `Express`
- 최종 DB 토폴로지: 단일 `almondyoung` database + 다중 schema
- schema 분리 원칙:
  - `pim`
  - `wms`
  - `matching`
  - `authorization`
  - `eventing` 또는 `public`
- 초기 마이그레이션 원칙:
  - 런타임 통합과 DB 통합은 분리한다.
  - 즉, 처음부터 모든 DB를 한 번에 옮기지 않는다.
- 이전 순서:
  - `PIM`
  - `WMS`
  - `order-matching`
- 목표 우선순위:
  - 1순위: 외부 동작 동일성
  - 2순위: 내부 인프라 단일화
  - 3순위: 내부 비동기 choreography 제거

## Non-Goals

이번 단계에서 하지 않는 일:

- 외부 API contract 변경
- endpoint path 변경
- request/response payload 변경
- 인증 정책 재설계
- 주문/재고/상품 도메인 재모델링
- `order-matching` 구현
- 외부 앱과의 Kafka/outbox 계약 제거

## Document Map

- [README](./modular-monolith-rfc/README.md)
- [01 Target Architecture](./modular-monolith-rfc/01-target-architecture.md)
- [02 Migration Phases](./modular-monolith-rfc/02-migration-phases.md)
- [03 Compatibility Matrix](./modular-monolith-rfc/03-compatibility-matrix.md)

## Current Constraints

현재 코드베이스에서 바로 드러나는 제약은 다음과 같다.

- PIM과 WMS는 둘 다 Fastify bootstrap을 사용한다.
- `almondyoung-server`는 아직 거의 빈 root shell이다.
- PIM/WMS는 각자 `ConfigModule.forRoot`, `DbModule.forRoot`, `AuthorizationModule.forRoot`, 이벤트 초기화를 수행한다.
- 현재 `libs/db`는 전역 단일 `DbService` 구조라 모듈러 모놀리스로 바로 쓰기 어렵다.
- WMS는 `/wms` global prefix에 의존한다.

따라서 첫 구현 과제는 기능 이전보다 먼저 **root shell과 platform layer를 표준화**하는 것이다.

## Immediate Next Step

바로 다음 작업은 세부 RFC를 기준으로 다음 순서로 진행한다.

1. `almondyoung-server`의 target architecture 확정
2. migration phase와 exit criteria 확정
3. compatibility baseline 고정
4. platform layer 초안 구현
5. PIM 이전 시작
