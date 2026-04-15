# 01. Target Architecture

## 목표

`apps/almondyoung-server`를 단일 composition root로 삼아, 현재의 `PIM`, `WMS`, 이후의 `order-matching`을 내부 모듈로 수용한다.

최종 목표는 다음과 같다.

- 단일 deployable backend
- 단일 HTTP runtime
- 단일 DB
- 분리된 bounded context
- 외부 앱에는 기존과 호환되는 API와 이벤트 제공

## Target Runtime Topology

```
[almondyoung-server]
  ├─ Platform Layer
  │   ├─ Config
  │   ├─ Auth
  │   ├─ DB
  │   ├─ HTTP
  │   ├─ Outbox / Event Publishing
  │   └─ Observability
  │
  ├─ Catalog Context        (ex-PIM)
  ├─ Inventory Context      (ex-WMS inventory/inbound/movement/suppliers/stocktaking)
  ├─ Fulfillment Context    (ex-WMS order/fulfillments)
  ├─ Matching Context       (later)
  └─ Integration Context    (channel/search/analytics/etc. 외부 계약)
```

## 표준 앱 구조

`apps/almondyoung-server/src`는 다음 구조를 표준으로 삼는다.

```text
src/
  main.ts
  app.module.ts
  config/
  platform/
    auth/
    db/
    events/
    http/
    logging/
    observability/
  modules/
    catalog/
      application/
      domain/
      infrastructure/
      presentation/
    inventory/
      application/
      domain/
      infrastructure/
      presentation/
    fulfillment/
      application/
      domain/
      infrastructure/
      presentation/
    matching/
      application/
      domain/
      infrastructure/
      presentation/
    integrations/
      application/
      infrastructure/
      presentation/
  compatibility/
    pim/
    wms/
```

### 구조 원칙

- `platform`: 모든 컨텍스트가 공유하는 기술 인프라
- `modules/*`: bounded context
- `compatibility/*`: 기존 계약을 유지하기 위한 임시 레이어

초기 이전 단계에서는 `compatibility/pim`, `compatibility/wms`가 매우 중요하다. 기존 controller/service/dto를 그대로 재사용하면서 root shell에 꽂기 위한 완충지대 역할을 맡는다.

## HTTP 표준화

### 고정 결정

- `Express` 사용
- 전역 bootstrap은 `apps/almondyoung-server/src/main.ts` 하나로 통일
- PIM/WMS 개별 `main.ts`는 최종적으로 retire

### 이유

현재 PIM/WMS는 둘 다 Fastify를 쓰고 있다. 그러나 모놀리스 타깃에서는 다음 이유로 Express가 더 단순하다.

- Nest 기본 생태계와의 결합이 더 단순하다.
- WMS의 Fastify-전용 Passport shim을 제거할 수 있다.
- PIM의 multipart/cookie 설정도 Express 쪽 표준 middleware로 정리할 수 있다.
- 새 app shell과 feature module 표준화를 동시에 진행하기 쉽다.

### 라우팅 원칙

- PIM route는 prefix 없이 유지
- WMS route는 `/wms` prefix 유지
- app-level `setGlobalPrefix('wms')`는 사용하지 않음
- 대신 Nest `RouterModule` 또는 module-level path composition으로 WMS를 `/wms` 아래에 mount

이 결정은 중요하다. 기존 WMS는 global prefix에 기대고 있지만, 모놀리스에서는 PIM과 WMS가 같은 앱 안에 공존하므로 app-level global prefix를 사용할 수 없다.

## DB Target Topology

## 최종 상태

하나의 PostgreSQL database `almondyoung` 안에 schema를 분리한다.

```text
almondyoung
  ├─ pim
  ├─ wms
  ├─ matching
  ├─ authorization
  └─ eventing (또는 public)
```

### 원칙

- 앱은 하나지만 데이터 소유권은 유지한다.
- cross-context FK는 최소화한다.
- context 간 참조는 application layer를 통해 해결한다.
- schema 분리는 운영적/개념적 ownership 표시다.

### Drizzle 방향

현재 PIM/WMS schema 정의는 평면 namespace에 가깝다. 최종 구조로 가려면 다음 정리가 필요하다.

- `pgSchema('pim')`, `pgSchema('wms')`, `pgSchema('matching')` 도입
- 각 테이블 정의를 schema-aware하게 재구성
- 통합 schema export 제공
- migration 도구도 schema-aware하게 정리

## DB Migration Sequencing

최종 상태는 단일 DB + 다중 schema가 맞다. 다만 **런타임 통합과 DB 통합을 한 번에 묶지 않는다.**

권장 순서는 다음과 같다.

1. 모놀리스 런타임 수립
2. PIM/WMS 기능을 `almondyoung-server` 안으로 흡수
3. 동작 동일성 확보
4. 그 다음 DB를 `almondyoung` + 다중 schema로 통합

즉, 최종 target은 하나의 DB지만, migration 단계에서는 임시로 복수 connection을 허용할 수 있다.

## Platform Layer 책임

루트 app이 1회만 제공해야 하는 것:

- `ConfigModule`
- `AuthorizationModule`
- DB connection/registry
- outbox/event publisher
- tracing/logging
- global validation
- global exception mapping
- swagger composition

현재 PIM/WMS가 각자 `forRoot`로 올리는 인프라는 모놀리스에서 중복되면 충돌 가능성이 높다. 따라서 root ownership으로 옮겨야 한다.

## Internal Communication Model

### 이전 전

- PIM ↔ WMS 내부 상호작용도 Kafka 비동기 중심

### 모놀리스 1차 목표

- 외부 앱과의 Kafka/outbox 계약은 유지
- PIM ↔ WMS 내부는 아직 기존 이벤트 흐름을 일부 유지해도 됨

### 모놀리스 2차 목표

- PIM ↔ WMS 내부 핵심 흐름은 application service 호출 또는 로컬 도메인 이벤트로 전환
- Kafka는 외부 통합과 비핵심 비동기 후처리용으로 축소

## Context Boundaries

### Catalog Context

현재 `apps/pim`의 핵심 기능을 수용한다.

- products
- categories
- channels
- pricing
- tags
- banners
- approval
- bulk
- csv
- audit
- dashboard

### Inventory Context

현재 `apps/wms`에서 재고 자체를 다루는 기능을 수용한다.

- inventory
- movement
- inbound
- suppliers
- stocktaking

### Fulfillment Context

현재 `apps/wms`에서 주문과 이행에 가까운 기능을 수용한다.

- sales orders
- fulfillments
- order shared services

### Matching Context

후속 단계에서 추가한다.

- variant ↔ sku 매칭 규칙
- 판매주문 → 재고주문 변환 스냅샷
- hold 및 후속 운영 기능

### Integration Context

외부 시스템과의 계약을 담당한다.

- channel-adapter용 이벤트 발행/소비
- analytics/search/기타 앱과의 이벤트 계약
- 외부 webhook 또는 adapter endpoint

## Compatibility Layer 역할

초기에는 다음 두 레이어가 필요하다.

- `PimCompatibilityModule`
- `WmsCompatibilityModule`

역할은 다음과 같다.

- 기존 controller/service/dto 재사용
- 기존 route contract 유지
- root-owned infra에 맞는 adapter/provider 제공
- 점진적 리팩터링 시 도메인 모듈로 흡수될 여지를 남김

즉, compatibility layer는 임시지만 필수다. 이 단계를 건너뛰고 처음부터 예쁜 도메인 모듈로 재작성하면 계약 유지보다 재설계가 먼저 시작되어 migration 리스크가 커진다.

## Deferred Decisions

이번 문서에서 일부러 고정하지 않는 것:

- subdomain 별 reverse proxy/SST route 설계
- auth scope 재설계
- order-matching 세부 도메인 규칙
- search/analytics의 장기적 동기화 방식
