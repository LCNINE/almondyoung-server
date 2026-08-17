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
- **주문 수집 실패 격리** — 라인을 판매상품 variant 로 식별하지 못한 주문을 `order_collection_failures` 에 격리하고, 매핑을 고친 뒤 replay 한다 (구 `pending_orders` 계류는 제거됨)

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
| 동기화 상태 | `sync_statuses` | 채널별 수집 워터마크와 폴링 통계. **`last_sync_at` 은 하트비트가 아니다** — 폴링에서 항목을 처리했을 때만 갱신된다. 살아있는지는 `updated_at` 으로 본다 |
| 수집 실패 격리 | `order_collection_failures` | 식별 실패/사후 변경을 `(channel, externalOrderId, reason)` 당 1행으로 보관 |

> 채널 어댑터는 **매핑 테이블의 주인**이다. 원본 데이터(상품, 주문, 회원)의 SoT는 각 도메인 서비스에 있다.

## 3. 핵심 설계 패턴

### 3-1. Adapter + Factory 패턴
```
ChannelAdapterFactory.getAdapter(channelType) → ChannelAdapter 인터페이스
  ├─ NaverSmartstoreAdapter   (네이버 API)
  ├─ CoupangAdapter           (쿠팡 API)
  └─ (Medusa는 별도 경로)
```
- `ChannelAdapter` 인터페이스: `syncToChannel`, `executeCommand`, `reconcileCommand`, `executeQuery`, `findOrders`
- **주문 수집은 이 인터페이스가 하지 않는다.** 수집은 `ChannelOrderSource` 다 (§3-5).
- 새 채널 추가 시: 능력 표 `CHANNEL_CAPABILITIES` 한 줄 + `ChannelOrderSource` 구현 + (명령이 필요하면) `ChannelAdapter` 구현체와 Factory 등록

### 3-2. Inbox 패턴 (Outbox와 혼동 주의)
```
Kafka Consumer → inbox_events 테이블 저장 (빠른 ACK) → InboxWorkerService 폴링 → 외부 API 호출
```
- **Inbox**: Kafka → DB 저장 → 비동기 처리 (외부 API 호출이 느리므로 Consumer timeout 방지)
- **Outbox (공용 `@app/events`)**: DB → Kafka 발행 (트랜잭션 보장)
- `InboxWorkerService`는 handler start interval 마다 eventType allowlist 대상 row 1개를 atomic claim 하고, task-local handler concurrency 로 외부 API 압력을 제한
- 발행은 공용 `@app/events` 아웃박스(`event.outbox_events`)가 담당한다 (ADR-0029 Task 6-C)

### 3-3. `inbox_events` 는 이제 수신 전용이다
과거에는 이 테이블 하나가 수신 큐와 발행 큐를 겸했고, `aggregateType = 'ChannelAdapter'` 인 행을
앱 자체 `OutboxDispatcherService` 가 Kafka 로 발행했다. **그 디스패처와 발행 경로는 ADR-0029
Task 6-C-4 에서 제거됐다** — 발행은 전부 공용 아웃박스(`event.outbox_events`)로 나간다.

| 서비스 | 처리 대상 | 역할 |
|--------|-----------|------|
| **InboxWorkerService** | 명시적 eventType allowlist 의 Medusa/Firebase projection 이벤트 | 외부 API(Medusa/Firebase) 호출 |
| **ShipmentDispatchInboxWorker** | `ShipmentShipped`/`Delivered`/`DispatchRecalled`, `Fulfillment*` | 채널 발송처리 — 능력 표의 `route` 로 projection/adapter/manual 분기 |

- InboxWorker는 batch-size 기반 throttle 이 아니라 `INBOX_MAX_CONCURRENT_HANDLERS`, `INBOX_HANDLER_START_INTERVAL_MS`, processing lease 로 처리 압력을 제어
- `InboxService.enqueue` 는 `aggregateType = 'ChannelAdapter'` 를 **거부한다** — 발행 큐가 되돌아오는 것을 막는 회귀 네트(`outbox-reclaim.spec.ts`)

### 3-4. CQRS 스타일 Command/Query 분리
- `ChannelCommand`: 상태 변경 명령 (발송, 취소, 반품 승인 등) — `executeCommand()`
- `ChannelQuery`: 조회 전용 (배송 이력, 교환 요청 목록 등) — `executeQuery()`
- `OrderQuery`: 주문 조회 전용 (shipmentId, productOrderId, orderId) — `findOrders()`

### 3-5. Order Collection (Provider 패턴)
```
OrderPollerOrchestrator (@Cron 5분)
  → ChannelOrderSource   (채널 원어 스냅샷)
  → ChannelOrderTranslator (식별 해석 · 격리 판단 · Core 계약 조립)
  → 공용 아웃박스 (event.outbox_events)
```
- `CHANNEL_ORDER_PROVIDER` 토큰에 Provider 배열 주입
- 현재 source 는 `MedusaOrderSource` 하나. 채널을 늘리면 source 를 하나 더 만들어 배열에 더한다 — 번역기는 공유한다.
- **legacy `/adapter/poll` 경로는 제거됐다.** 수집 경로는 이 orchestrator 뿐이다.
- 증분 수집은 `sync_statuses.lastSyncAt` 에서 2분을 되감아 조회한다. 중복은 `wms_order_mappings`와 change hash로 흡수하고, `updated_at` 경계 주문 누락을 피하는 것이 우선이다.
- Medusa 주문이 한 번 수집된 뒤 변경되면 `OrderModified`를 발행하지 않는다. 변경은 `collected_order_modification_not_accepted` 로 격리하고, CS 주문 정정/추가출고는 별도 Core workflow 에서 다룬다.

### 3-5b. 채널 능력 레지스트리 (ADR-0031)
`src/services/channel-capabilities.ts` 의 `CHANNEL_CAPABILITIES` 가 채널 차이의 **유일한 선언
자리**다. 채널을 등급(퍼스트/서드파티)으로 나누지 않고 능력 벡터로 적는다.

- `integration`: `'api'` | `'none'` — `'none'`(=`3pl`, 전화주문 등)은 나머지 축을 갖지 않는다
- `productOwnership` · `lineIdentity`(`embedded`/`mapped`) · 축별 `route`
- `route: 'none'`(비대상)과 `'manual'`(미구현, 운영 큐에 남김)을 **섞지 말 것**
- `Record<SalesChannel, …>` 가 exhaustive 라 채널 추가 시 컴파일러가 모든 결정을 요구한다

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
├── event_logs              — (죽음) writer/reader 0. 삭제 대기 #642
├── sync_histories          — (죽음) writer/reader 0. 삭제 대기 #642
├── processed_events        — 멱등성 보장 (source + eventType + resourceId + version 유니크)
├── wms_order_mappings      — 채널 주문 ↔ WMS 주문 매핑 (salesChannel + channelOrderId 유니크)
├── sync_statuses           — 채널별 동기화 상태 영속화 (channelId + dataType 유니크)
├── pending_orders          — (죽음) writer/reader 0. 삭제 대기 #642
├── order_collection_failures — 수집 실패 격리 (channel + externalOrderId + reason 유니크)
├── inbox_events            — Inbox 패턴 이벤트 큐 (pending → processing → published/failed)
├── pim_medusa_mappings     — PIM ↔ Medusa 상품 매핑 (pimMasterId 유니크)
├── migration_progress      — 마이그레이션 진행 추적 (일회성 백필 스크립트용)
├── migration_failures      — 마이그레이션 실패 기록
└── cafe24_member_mappings  — Cafe24 회원 ↔ userId 매핑 (cafe24MemberId PK)
```

### 주의사항
- `inbox_events`는 **수신 전용**이다. 발행은 공용 `event.outbox_events` 로 나간다 (ADR-0029 Task 6-C).
- `channelId` 컬럼 타입이 테이블마다 다르다 (`uuid` vs `varchar(50)`). 통일 필요.
- `migration_progress`/`migration_failures`는 Phase 5 백필 스크립트(`scripts/backfill-v2.ts`) 전용. 런타임 서비스 코드에서는 사용하지 않는다. `migration_failures.snapshot` 컬럼에 PIM 스냅샷 원본을 저장해 `retry-failed.ts` 가 재시도에 활용한다.

## 6. 로컬 개발 주의사항

- `KAFKA_BROKERS` 환경변수가 없으면 `NullEventPublisher`로 대체되어 이벤트 발행이 no-op이 된다.
- `ACTIVE_CHANNELS` 환경변수는 제거됐다. 채널 활성화는 Core 의 `sales_channels.is_active` 가 갖기로 **결정**됐다 (ADR-0031).
  🔴 **다만 그 결정을 집행하는 코드가 아직 없다 (#654, 2026-08-18 확인).** `salesChannels.isActive` 를 읽는 곳은
  Core 의 어드민 목록 필터 하나뿐(`sales-channels.service.ts:110`)이고, `OrderPollerOrchestrator.poll()` 은
  채널 활성 여부를 보지 않는다. **채널을 비활성화해도 수집이 멈추지 않는다.** 그리고 `ACTIVE_CHANNELS` 는
  `config/env.validation.ts:39` 에 선언만 남아 있다(소비자 0) — #654 에서 함께 걷어낸다.
- Medusa 관련 동기화는 `MEDUSA_BACKEND_URL`, `MEDUSA_ADMIN_EMAIL`, `MEDUSA_ADMIN_PASSWORD` 환경변수 필요.
