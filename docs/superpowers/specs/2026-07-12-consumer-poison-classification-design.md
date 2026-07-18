# 작업 13 — 컨슈머 포이즌 분류 설계 (WS-D, P1-1·P1-2)

> 물류 백엔드 정상화 스프린트 현황판(`docs/logistics-backend-hardening-2026-07.md`) §5 WS-D 작업 13.
> 착수 노트(현황판 line 283)의 설계 쟁점을 브레인스토밍(2026-07-12)으로 확정한 결과.

## 1. 배경

`OrderEventsConsumer`(`apps/core/src/modules/sales-order/consumers/order-events.consumer.ts`)는 `orders.events.v1` 토픽의 4개 이벤트(OrderCreated / OrderCancelled / OrderModified / OrderRefundCreated)를 소비한다. 핸들러가 에러를 throw 하면 재throw 되고 — **컨슈머에 exception 필터가 부착돼 있지 않아** — Kafka offset 이 커밋되지 않는다. 결과적으로 실패 메시지가 파티션을 **무한 재전달(포이즌)**로 정체시킨다.

- **P1-1**: `OrderCancelled`(`:126`)·`OrderRefundCreated`(`:212`)가 SO 미존재 시 `NotFoundException` throw → 포이즌.
- **P1-2**: 출고완료 주문의 채널발 전체취소 → `SalesOrdersService.cancel`(`:454,470`)이 `BadRequestException` throw → 포이즌.

## 2. 착수 재확인으로 확정한 사실 (2026-07-12)

- **auto-DLQ 인프라 기존재**: `EventsExceptionFilter`(`libs/events/src/filters/events-exception.filter.ts`)가 재시도(`@RetryPolicy`, 기본 3회 exp backoff) → 실패 시 DLQ 전송 → **에러 삼킴 → offset commit**(파티션 정체 해소)을 수행. `SchemaValidationError` 는 하드코딩 non-retryable(즉시 DLQ). `nonRetryableErrors` 로 지정한 타입도 재시도 없이 즉시 DLQ.
- **인프라는 배선돼 있으나 필터만 미부착**: `sales-order.module.ts:33` 이 `EventsModule.forConsumerModule({ enableAutoDLQ: true })` 로 `DLQHandler` 를 이미 등록(global module, export). 그러나 `EventsExceptionFilter` 는 `APP_FILTER` 로 자동 등록되지 **않는다** — 각 컨슈머가 `@UseFilters(EventsExceptionFilter)` 를 붙여야 발동. 타 앱(notification·wallet·analytics·ugc) 컨슈머는 전부 부착, **core `OrderEventsConsumer` 만 유일 미부착** = 무한 재시도의 직접 원인.
- **파티션 순서 = 분류의 결정적 근거**: 주문 이벤트는 `aggregateId = externalOrderId` 를 파티션 키로 발행(`apps/channel-adapter/src/services/order-event.publisher.ts:170,216,264`). 즉 **같은 주문의 Created/Cancelled/Modified 는 같은 파티션 = 순서 보장**. "취소가 생성보다 먼저" 라는 out-of-order 는 사실상 발생 불가 — SO 미존재 취소의 실제 원인은 **OrderCreated 가 DLQ 로 빠진 경우**(재시도해도 SO 는 나타나지 않음). ⟹ SO-not-found 는 **영구 실패**로 분류(즉시 DLQ)가 정당.
- **`EventTypeGuard`(인터셉터) 무충돌**: 핸들러 진입 전 eventType 불일치를 에러 없이 조용히 통과/무시(`of(undefined)`). 필터는 핸들러 **에러**만 잡으므로 상호작용 안전.
- **글로벌 필터 상호작용**: main.ts 의 `app.useGlobalFilters(new GlobalExceptionFilter())`(HTTP용)는 컨트롤러레벨 `@UseFilters` 에 밀린다 — 이 컨슈머 한정으로 `EventsExceptionFilter` 가 우선. (현재는 필터 부재라 RPC 에러가 HTTP용 글로벌 필터로 흘러 offset 미커밋 → 포이즌.)
- **4개 핸들러 전부 이미 멱등** — 필터 재시도의 안전 근거(§5). G4(SO+backlog 동일 tx)·G7(주문 수집 멱등) 보존.

## 3. 결정 (브레인스토밍, 2026-07-12)

### 3.1 분류 방식 = Nest 4xx 예외 타입을 non-retryable 마커로 (선택지 A)

`@UseFilters(EventsExceptionFilter)` 부착 + 포이즌 유발 핸들러에 `@RetryPolicy({ nonRetryableErrors: [...] })` 로 Nest 4xx 클라이언트 에러를 "메시지를 그대로는 처리 불가 = 영구"로 표시. 기존 throw(컨슈머·`cancel()`)를 그대로 살려 **최소·외과적 변경**. 도메인 에러 이관(P3-1, WS-E)을 침범하지 않는다.

- 기각한 대안 (B) 도메인 에러 이관 + `ApplicationException` 분류: 컨벤션 정합은 높으나 변경이 크고 P3-1(WS-E)과 중복 — 스프린트 범위 분리 원칙 위배.
- 기각한 대안 (C) 분류 없이 필터만: 착수 노트의 "영구/일시 분류" 미달 + 영구 실패마다 ~7s 파티션 블로킹 낭비.

### 3.2 핸들러별 재시도 정책

| 핸들러 | `@RetryPolicy` | 근거 |
|---|---|---|
| **handleOrderCreated** | `{ maxRetries: 5, backoff: 'exponential', initialDelayMs: 1000, maxDelayMs: 15000 }` (nonRetryable 없음) | **P2-15 경량 완화** — 최고가치 경로(유료 주문 수용). 일시 grant/DB 실패에 최대 기회를 줘 DLQ 낙하 확률↓. bad payload 는 빌트인 `SchemaValidationError` non-retryable 로 즉시 DLQ. **⚠️ 현 시점 실제 동작 주의**(리뷰 발견, §8): 공유 필터 버그로 maxRetries/backoff 값이 **inert** — 일시 실패는 1s 간격으로 (성공까지) 계속 재시도, 영구 retryable 실패는 DLQ 로 escalate 안 됨. 이 정책 값은 필터 수정(fast-follow) 후 의도대로 발효되는 **forward-correct** 설정. P1 경로(nonRetryable)는 루프 미진입이라 무영향 |
| **handleOrderCancelled** | `{ nonRetryableErrors: [NotFoundException, BadRequestException] }` (기본 3회) | **P1-1**: SO-not-found(`NotFoundException`) → 즉시 DLQ. **P1-2**: 출고 후 취소(`cancel()` 의 `BadRequestException`, 비즈니스 영구 거부) → 즉시 DLQ. 일시(DB 등) → 3회 후 DLQ |
| **handleOrderRefundCreated** | `{ nonRetryableErrors: [NotFoundException] }` (기본 3회) | **P1-1**: SO-not-found → 즉시 DLQ. 이 핸들러는 `NotFoundException` 만 throw |
| **handleOrderModified** | 오버라이드 없음 (기본 3회 → DLQ) | not-found 시 이미 skip(`:176`)이고 수정 자체를 무시하는 **의도된 결정**이라 유실 아님. 필터만 클래스레벨로 커버(일시 DB 오류 → 재시도 → DLQ). 의도적 무변경 |

### 3.3 P2-15 처분 = grant tx 분리 제외, OrderCreated 정책 완화로 갈음

grant 를 SO-생성 tx 에서 분리하는 구조 변경은 G4(SO+backlog 동일 tx) 보장과 얽혀 별도 검토가 안전 — 착수 노트도 "동반 검토"지 "동반 수정" 아님. 대신 §3.2 의 OrderCreated 관대 정책(maxRetries 5)이 **일시적** grant/DB 실패로 유료 주문이 DLQ 로 떨어질 확률을 낮춘다. 영구 grant 실패(버그)는 DLQ 로 가시화되는 게 정상. P2-15 는 현황판 ⬜ 유지(WS-D 미편입, 향후 별도).

### 3.4 DLQ = 유실 아님 (skip 도 무한재시도도 아닌 중간 지점)

SO-not-found 취소를 skip(현 `OrderModified` 방식)하면 유실, 재throw 하면 포이즌. DLQ 는 메시지를 **보존**하므로 실제 원인(OrderCreated 의 DLQ 낙하)을 ops 가 재구동하면 취소도 재구동 가능. 착수 노트가 선호한 "취소 = DLQ + 운영 격리" 와 정합.

## 4. 스코프 — 변경 사항

1. **`order-events.consumer.ts`**
   - 클래스에 `@UseFilters(EventsExceptionFilter)` 추가(import `EventsExceptionFilter`, `@RetryPolicy` from `@app/events`; `UseFilters` from `@nestjs/common`).
   - `handleOrderCreated`·`handleOrderCancelled`·`handleOrderRefundCreated` 에 §3.2 표대로 `@RetryPolicy(...)` 부착. `handleOrderModified` 무변경.
   - 핸들러 내부 `try/catch (log + rethrow)` 블록은 **존치**(notification 컨슈머 패턴과 동일 — 핸들러별 진단 로그가 필터 일반 로그보다 앞서 남음, 무해).
2. **`order-events.consumer.spec.ts`** — wiring/분류 회귀 가드 추가(§5, §7).

스키마·마이그레이션 무변경. admin-web 무변경.

## 5. 불가침 / 회귀 가드

- **멱등성 보존**: 4개 핸들러의 멱등 가드(`orderEvents.eventId` unique·`checkAndRecordEvent`·businessLinks 가드·cancel `existingCancellation` 가드·`findByChannelOrderId` unique)를 건드리지 않는다 — 필터 재시도의 안전 전제(G4·G7).
- **G4**(SO+backlog 동일 tx)·**G7**(주문 수집 멱등) 회귀 금지.
- **필터·분류 존재 자체가 회귀 대상** — 누군가 `@UseFilters`/`@RetryPolicy` 를 제거하면 P1-1 재발. 이를 유닛 스펙으로 봉인(§7).

## 6. 경계 / 비목표 (out of scope)

- **P2-15 grant tx 분리** — 제외(§3.3, 정책 완화만).
- **P3-1 도메인 에러 이관** — WS-E 소유. 컨슈머 throw 는 Nest 예외 그대로.
- **OrderModified 유실** — 수정 무시가 의도된 결정이라 무변경(§3.2).
- **DLQ 재구동 도구/운영 런북** — 인프라(`DLQHandler`) 기존재, 재구동 UX 는 별도.

## 7. 검증 / 테스트

dev DB 무의존(스키마 무변경). 유닛만.

- **필터 부착 회귀 가드**: `EXCEPTION_FILTERS_METADATA`(from `@nestjs/common/constants`)로 `OrderEventsConsumer` 클래스에 `EventsExceptionFilter` 존재 단언.
- **분류 회귀 가드**: `RETRY_POLICY_METADATA`(from `@app/events`)로 각 핸들러 prototype 메서드의 `nonRetryableErrors`(`NotFoundException`/`BadRequestException` 포함)·`maxRetries` 단언.
- 기존 wiring 스펙(grant 호출·tx 전파) GREEN 유지.
- **공통 규약 체크리스트**: `nest build core` exit 0 · arch 경계 spec(`inventory-write-boundary.arch.spec.ts`) PASS · 변경 파일 신규 eslint error 0 · 삭제 심볼 없음(추가 위주).

## 8. 리스크

- **⚠️ 공유 필터 버그 (리뷰 발견 2026-07-12, 본 작업 범위 밖·fast-follow)**: `EventsExceptionFilter.handleException`(`events-exception.filter.ts:112`)이 pure 함수 `updateRetryContext` 의 반환값을 **폐기**하고 `retryContext`(`:65`, `const`)를 재대입하지 않아 `attemptNumber` 가 0 에 고정된다. 결과: 영구 **retryable** 실패 시 (1) `while(attemptNumber < maxRetries)`(`:80`)가 종료 불가 = 무한 루프, (2) `calculateBackoffDelay(attemptNumber+1, …)`(`:82`)가 항상 1s = backoff 무escalate. 즉 `maxRetries`/`backoff` 지정이 **전 컨슈머에서 inert**. **본 작업 영향**: P1-1/P1-2 핵심 경로는 nonRetryable 로 while 루프 **미진입**이라 즉시 DLQ 정상 동작 — **무영향**. 영향받는 건 OrderCreated 관대 정책의 "N회 후 DLQ" 스토리뿐(§3.2). 원 상태(필터 부재 시 Kafka 재전달 포이즌) 대비 악화 아님(일시 실패는 오히려 회복). **fast-follow**: 필터 `:112` 를 `Object.assign(retryContext, updateRetryContext(...))` 등으로 수정 — `@app/events` 공유 인프라라 별도 PR(전 컨슈머 회귀 테스트 동반).
- **BadRequestException 과대분류 우려**: `cancel()` 의 `BadRequestException` 은 전부 영구 비즈니스 거부(출고 후 취소·출고수량 존재·빈 부분취소 라인)라 일시 조건이 이 타입으로 새지 않음 — non-retryable 안전.
- **DLQ 관측성 부담 이전 (리뷰 권고)**: 본 변경은 P1-1/P1-2 를 *시끄러운* 파티션 정체(consumer-lag 알람)에서 *조용한* DLQ 적재 + offset commit 으로 바꾼다(§3.4 의도된 "DLQ + 운영 격리"). 프로덕션 의존 전 **DLQ 토픽 알림/모니터링 존재 확인 필요** — 없으면 정당한 출고 후 취소가 보이지 않게 격리됨.
- **필터 DI**: `@UseFilters(EventsExceptionFilter)`(클래스 전달)는 Nest 가 DI 로 인스턴스화 → global `EventsModule` 의 `DLQHandler`·`Reflector` 주입. 타 앱 컨슈머가 동일 방식으로 라이브 검증됨.
