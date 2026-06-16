# Channel Adapter — CLAUDE.md

> 이 문서는 `channel-adapter` 앱에만 해당하는 규칙과 맥락을 담습니다.
> 프로젝트 공통 규칙(레이어 아키텍처, DB 패턴 등)은 루트 `CLAUDE.md`를 참조하세요.

## 1. 앱의 역할과 경계

### 책임지는 것
- **외부 판매채널(네이버 스마트스토어, 쿠팡) API 통합** — 주문 수집, 발송처리, 취소/반품/교환 명령 실행
- **내부 도메인 이벤트 → 외부 채널 반영** — WMS 출고 완료 시 채널에 송장 전달, PIM 상품 변경 시 Medusa 동기화
- **Medusa 커머스 동기화** — PIM 상품 → Medusa 상품 upsert, 멤버십 상태 → Medusa 고객 그룹 동기화
- **Medusa 주문 수집 → WMS 전달** — Medusa 주문을 폴링하여 `orders.events.v1`으로 발행 (WMS가 구독)
- **채널 간 데이터 형식 변환** — 채널별 API 응답을 `InternalOrderEvent` 등 내부 표준 모델로 정규화
- **미매핑 주문 계류 관리** — 채널 상품 → PIM Variant 매핑이 없는 주문을 `pending_orders`에 보관 후 재처리

### 책임지지 않는 것
- 주문 이행/재고 관리 → **WMS**
- 상품 마스터 데이터 관리 → **PIM**
- 결제/정산 → **Wallet**
- 사용자 인증/계정 → **user-service**
- Medusa 자체 비즈니스 로직 (할인, 장바구니 등) → **Medusa**

## 2. Source of Truth (SoT)

| 데이터 | SoT | 설명 |
|--------|-----|------|
| 채널-WMS 주문 매핑 | `wms_order_mappings` | 채널 주문 ID ↔ WMS 주문 UUID 매핑 |
| PIM-Medusa 상품 매핑 | `pim_medusa_mappings` | PIM masterId ↔ Medusa productId 매핑 |
| Cafe24 회원 매핑 | `cafe24_member_mappings` | cafe24MemberId ↔ userId/email 매핑 |
| 이벤트 처리 상태 | `inbox_events`, `processed_events` | 멱등성 보장 + 비동기 처리 상태 |
| 동기화 상태/이력 | `sync_statuses`, `sync_histories` | 채널별 마지막 동기화 시점, 성공/실패 이력 |
| 미매핑 계류 주문 | `pending_orders` | PIM 매핑이 없어 처리 보류된 주문 원본 |

> 채널 어댑터는 **매핑 테이블의 주인**이다. 원본 데이터(상품, 주문, 회원)의 SoT는 각 도메인 서비스에 있다.

## 3. 핵심 설계 패턴

### 3-1. Adapter + Factory 패턴
```
ChannelAdapterFactory.getAdapter(channelType) → ChannelAdapter 인터페이스
  ├─ NaverSmartstoreAdapter   (네이버 API)
  ├─ CoupangAdapter           (쿠팡 API)
  └─ (Medusa는 별도 경로)
```
- `ChannelAdapter` 인터페이스: `processIncomingEvent`, `syncFromChannel`, `syncToChannel`, `executeCommand`, `executeQuery`, `findOrders`
- 새 채널 추가 시: 인터페이스 구현체 + Factory에 등록

### 3-2. Inbox 패턴 (Outbox와 혼동 주의)
```
Kafka Consumer → inbox_events 테이블 저장 (빠른 ACK) → InboxWorkerService 폴링 → 외부 API 호출
```
- **Inbox**: Kafka → DB 저장 → 비동기 처리 (외부 API 호출이 느리므로 Consumer timeout 방지)
- **Outbox (공용 `@app/events`)**: DB → Kafka 발행 (트랜잭션 보장)
- `InboxWorkerService`는 handler start interval 마다 eventType allowlist 대상 row 1개를 atomic claim 하고, task-local handler concurrency 로 외부 API 압력을 제한
- `OutboxDispatcherService`가 `@Cron(EVERY_10_SECONDS)`로 Kafka 발행

### 3-3. Inbox를 두 서비스가 나눠 처리
`inbox_events` 테이블 하나를 두 서비스가 역할 분담:

| 서비스 | 처리 대상 이벤트 | 역할 |
|--------|------------------|------|
| **InboxWorkerService** | 명시적 eventType allowlist 의 Medusa/Firebase projection 이벤트 | 외부 API(Medusa/Firebase) 호출 |
| **OutboxDispatcherService** | `OrderCreated`, `OrderModified`, `OrderCancelled`, 기타 `ChannelAdapter` 집계 이벤트 | Kafka 발행 |

- InboxWorker는 batch-size 기반 throttle 이 아니라 `INBOX_MAX_CONCURRENT_HANDLERS`, `INBOX_HANDLER_START_INTERVAL_MS`, processing lease 로 처리 압력을 제어
- OutboxDispatcher는 `aggregateType != 'Product'` 조건으로 Product 이벤트를 제외

### 3-4. CQRS 스타일 Command/Query 분리
- `ChannelCommand`: 상태 변경 명령 (발송, 취소, 반품 승인 등) — `executeCommand()`
- `ChannelQuery`: 조회 전용 (배송 이력, 교환 요청 목록 등) — `executeQuery()`
- `OrderQuery`: 주문 조회 전용 (shipmentId, productOrderId, orderId) — `findOrders()`

### 3-5. Order Collection (Provider 패턴)
```
OrderPollerOrchestrator (@Cron 5분) → ChannelOrderProvider[] → InboxService.enqueue()
```
- `CHANNEL_ORDER_PROVIDER` 토큰에 Provider 배열 주입
- 현재 `MedusaOrderProvider`만 등록 (Medusa 신규 주문 → `OrderCreated`, 수집 후 변경 → 격리)
- Provider 추가로 다른 채널 주문 수집 확장 가능
- Medusa 주문 수집은 이 orchestrator 가 canonical 경로다. legacy `/adapter/poll` 은 Naver/Coupang adapter 조회용 경로이며 Medusa 주문 수집에 사용하지 않는다.
- 증분 수집은 `sync_statuses.lastSyncAt` 에서 2분을 되감아 조회한다. 중복은 `wms_order_mappings`와 change hash로 흡수하고, `updated_at` 경계 주문 누락을 피하는 것이 우선이다.
- Medusa 주문이 한 번 수집된 뒤 변경되면 `OrderModified`를 발행하지 않는다. 변경은 `collected_order_modification_not_accepted` 로 격리하고, CS 주문 정정/추가출고는 별도 Core workflow 에서 다룬다.

### 3-6. Core(legacy PIM) → Medusa 상품 동기화 흐름
```
Core(구 PIM) (Kafka) → PimProductEventConsumer → inbox_events
                                                    ↓
                                       InboxWorkerService → PimMedusaSyncService → MedusaClient
                                                                  ↓
                                                        pim_medusa_mappings 업데이트
```
- Core(구 PIM 도메인)에 직접 HTTP 호출하지 않음 (런타임에서 `PimClient` 제거됨 — MSA 경계 준수)
- 이벤트 페이로드에 포함된 `snapshot`으로 Medusa upsert
- **백필 스크립트만 예외**: `scripts/` 의 v2 백필은 Core DB 직결 (`CORE_DB_URL`). v1 잔재(`scripts/legacy/`)는 사용 중지.
- 백필 시 `MedusaClient.primeAll()` 로 카테고리/태그/타입/세일즈채널 캐시를 사전 적재해 상품당 list/verify HTTP 호출을 0 회에 가깝게 축소.
- **대량 백필**: 본격 backfill 은 Medusa 컨테이너 안에서 실행하는 in-process 스크립트 사용. `apps/medusa/scripts/extract-core-snapshots.ts` 로 데이터를 image 에 baking → `apps/medusa/src/scripts/backfill-from-core.ts` 가 `createProductsWorkflow` 직접 호출해 HTTP/ALB 우회. 끝나면 `apps/channel-adapter/scripts/sync-mappings-from-medusa.ts` 로 `pim_medusa_mappings` 일괄 갱신. 절차 상세는 `apps/medusa/scripts/README.md` 참조.

### 3-7. 멤버십 → Medusa 고객 그룹 동기화
두 경로가 존재:
1. **MembershipStatusChanged** → `MembershipMedusaSyncService` → Medusa 고객 그룹 추가/제거
2. **Cafe24Linked/Unlinked** → `FirebaseMembershipSyncService` → Firebase 멤버십 조회 후 Medusa 동기화

## 4. 다른 앱과의 연동

### 구독하는 Kafka 스트림 (Inbound)
| 스트림 | 이벤트 | 처리 |
|--------|--------|------|
| `products.events.v1` | `ProductMasterActiveVersionChanged` | Inbox → Medusa 상품 동기화 |
| `products.events.v1` | `CategoryChanged` | Inbox → Medusa 카테고리 동기화 |
| `fulfillments.events.v1` | `FulfillmentShipped`, `FulfillmentCancelled` | 채널에 송장/취소 전파 |
| `core.orders.events.v1` | `SalesOrderCancelled` (cancellationScope=full 만) | Inbox → Medusa 주문 취소 동기화 |
| `membership.events.v1` | `MembershipStatusChanged` | Inbox → Medusa 고객 그룹 동기화 |
| `users.events.v1` | `Cafe24Linked`, `Cafe24Unlinked` | Inbox → Firebase → Medusa 멤버십 동기화 |

### 발행하는 Kafka 스트림 (Outbound)
| 스트림 | 이벤트 | 소비자 |
|--------|--------|--------|
| `orders.events.v1` | `OrderCreated`, `OrderModified`, `OrderCancelled` | WMS |
| `channel-adapter.events.v1` | `OrderSyncCompleted`, `InventorySyncCompleted` 등 | 모니터링/분석 |

### 외부 API 의존
| 대상 | 클라이언트 | 용도 |
|------|-----------|------|
| 네이버 커머스 API | `NaverAuthClient`, `NaverOrderClient`, `NaverClaimClient`, `NaverProductClient` | 주문/클레임/상품 관리 |
| 쿠팡 WING API | `CoupangOrderClient`, `CoupangReturnClient`, `CoupangExchangeClient`, `CoupangProductClient` | 주문/반품/교환/상품 관리 |
| Medusa Admin API | `MedusaClient` | 상품/고객/주문 동기화 |
| AlmondAuth (Firebase) | `AlmondAuthClient` | 멤버십 상태 조회 |
| user-service | `UserServiceClient` | 사용자 정보 조회 |
| PIM (channel-listing) | `ChannelListingClient` | 채널 리스팅 매핑 조회 |

## 5. 스키마 구조

```
channelAdapterSchema
├── event_logs              — 채널 이벤트 수신 로그 (channelId + orderId + claimId 유니크)
├── sync_histories          — 동기화 이력 (채널별/타입별 성공/실패 카운트)
├── processed_events        — 멱등성 보장 (source + eventType + resourceId + version 유니크)
├── wms_order_mappings      — 채널 주문 ↔ WMS 주문 매핑 (salesChannel + channelOrderId 유니크)
├── sync_statuses           — 채널별 동기화 상태 영속화 (channelId + dataType 유니크)
├── pending_orders          — 미매핑 계류 주문 (channel + externalOrderId 유니크)
├── inbox_events            — Inbox 패턴 이벤트 큐 (pending → processing → published/failed)
├── pim_medusa_mappings     — PIM ↔ Medusa 상품 매핑 (pimMasterId 유니크)
├── migration_progress      — 마이그레이션 진행 추적 (일회성 백필 스크립트용)
├── migration_failures      — 마이그레이션 실패 기록
└── cafe24_member_mappings  — Cafe24 회원 ↔ userId 매핑 (cafe24MemberId PK)
```

### 주의사항
- `inbox_events`는 Inbox(수신 처리)와 Outbox(발행) 두 역할을 겸하는 단일 테이블이다. `aggregateType`과 `eventType`으로 처리 주체가 구분된다.
- `channelId` 컬럼 타입이 테이블마다 다르다 (`uuid` vs `varchar(50)`). 통일 필요.
- `migration_progress`/`migration_failures`는 Phase 5 백필 스크립트(`scripts/backfill-v2.ts`) 전용. 런타임 서비스 코드에서는 사용하지 않는다. `migration_failures.snapshot` 컬럼에 PIM 스냅샷 원본을 저장해 `retry-failed.ts` 가 재시도에 활용한다.

## 6. 로컬 개발 주의사항

- `KAFKA_BROKERS` 환경변수가 없으면 `NullEventPublisher`로 대체되어 이벤트 발행이 no-op이 된다.
- `ACTIVE_CHANNELS` 환경변수로 활성 채널 제어 가능 (기본값: `naver_smartstore,coupang`).
- Medusa 관련 동기화는 `MEDUSA_BACKEND_URL`, `MEDUSA_ADMIN_EMAIL`, `MEDUSA_ADMIN_PASSWORD` 환경변수 필요.
