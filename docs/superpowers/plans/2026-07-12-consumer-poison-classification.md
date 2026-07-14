# 컨슈머 포이즌 분류 구현 계획 (작업 13, WS-D P1-1·P1-2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `OrderEventsConsumer` 에 `EventsExceptionFilter` 를 부착하고 핸들러별 재시도 정책으로 영구/일시 실패를 분류해, 실패 메시지의 무한 포이즌(P1-1·P1-2)을 재시도→DLQ→offset commit 로 전환한다.

**Architecture:** 순수 데코레이터 배선 변경. auto-DLQ 인프라(`EventsExceptionFilter`·`DLQHandler`)는 `sales-order.module.ts` 의 `enableAutoDLQ: true` 로 이미 등록·global export 되어 있고, 이 컨슈머만 `@UseFilters` 미부착이었다. 클래스에 `@UseFilters(EventsExceptionFilter)` + 포이즌 유발 핸들러에 `@RetryPolicy({ nonRetryableErrors: [...] })`(Nest 4xx 를 영구 실패 마커로) + OrderCreated 에 관대한 재시도(P2-15 완화)를 붙인다. 프로덕션 로직·스키마 무변경.

**Tech Stack:** NestJS(Kafka microservice), `@app/events`(EventsExceptionFilter/RetryPolicy/RETRY_POLICY_METADATA), Jest.

**설계 근거:** `docs/superpowers/specs/2026-07-12-consumer-poison-classification-design.md`.

## Global Constraints

- 스키마·마이그레이션 무변경. admin-web 무변경. dev DB 무의존(유닛만).
- 검증 체크리스트(현황판 공통 규약): `nest build core` exit 0 · arch 경계 spec(`inventory-write-boundary.arch.spec.ts`) PASS · **변경 파일 신규 eslint error 만**으로 판정(repo 전역 lint 는 상시 debt) · 삭제 심볼 없음(추가 위주).
- 컨슈머 4개 핸들러의 기존 멱등 가드(`orderEvents.eventId` unique·`checkAndRecordEvent`·businessLinks 가드·cancel `existingCancellation` 가드·`findByChannelOrderId` unique)와 try/catch(log+rethrow) 블록을 건드리지 않는다 — 필터 재시도의 안전 전제(G4·G7 보존).
- P2-15(grant tx 분리)·P3-1(도메인 에러 이관)·OrderModified 유실은 범위 밖.

## File Structure

- **Modify** `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts` — import 확장 + 클래스 `@UseFilters` + 3개 핸들러 `@RetryPolicy`. (`handleOrderModified` 무변경.)
- **Modify** `apps/core/src/modules/sales-order/consumers/order-events.consumer.spec.ts` — 파일 말미에 필터·분류 메타데이터 회귀 가드 describe 추가. (기존 wiring 스펙 무변경.)

---

### Task 1: EventsExceptionFilter 부착 + 핸들러별 재시도 분류

**Files:**
- Modify: `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts`
- Test: `apps/core/src/modules/sales-order/consumers/order-events.consumer.spec.ts`

**Interfaces:**
- Consumes:
  - `EventsExceptionFilter`, `RetryPolicy`, `RETRY_POLICY_METADATA` from `@app/events` (기존 barrel export).
  - `EXCEPTION_FILTERS_METADATA` from `@nestjs/common/constants` (`"__exceptionFilters__"`, 클래스레벨 `@UseFilters` 가 배열로 저장).
  - `RetryPolicy` 시그니처: `(config?: { maxRetries?: number; backoff?: 'fixed'|'exponential'|'linear'; initialDelayMs?: number; maxDelayMs?: number; retryableErrors?: Array<new (...a:any[])=>Error>; nonRetryableErrors?: Array<new (...a:any[])=>Error> }) => MethodDecorator`.
- Produces: 없음(컨슈머는 리프 — 다른 태스크가 의존하는 심볼 미생산).

- [ ] **Step 1: 실패 테스트 추가 (필터·분류 회귀 가드)**

`order-events.consumer.spec.ts` 상단 import 블록(마지막 import 라인 `import type { MessageEnvelope } ...` 바로 다음)에 아래 값 import 를 추가한다:

```typescript
import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EXCEPTION_FILTERS_METADATA } from '@nestjs/common/constants';
import { EventsExceptionFilter, RETRY_POLICY_METADATA } from '@app/events';
```

그리고 파일 **맨 끝**(기존 `describe('OrderEventsConsumer', ...)` 블록 닫는 `});` 다음 줄)에 아래 describe 블록을 추가한다:

```typescript
/**
 * 작업 13 (WS-D, P1-1·P1-2) 회귀 가드.
 *
 * 근본 원인은 컨슈머에 EventsExceptionFilter 미부착이라 실패 메시지가
 * offset 미커밋 → 무한 포이즌이 된 것. 누군가 필터/분류를 제거하면 재발하므로
 * wiring 을 메타데이터 레벨에서 봉인한다 (이 spec 의 기존 wiring-drift 방지 철학과 동일).
 */
describe('OrderEventsConsumer poison classification (작업 13)', () => {
  it('attaches EventsExceptionFilter (재시도→DLQ→offset commit)', () => {
    const filters = (Reflect.getMetadata(EXCEPTION_FILTERS_METADATA, OrderEventsConsumer) ?? []) as unknown[];
    expect(filters).toContain(EventsExceptionFilter);
  });

  it('classifies OrderCancelled SO-not-found + post-ship reject as non-retryable (즉시 DLQ)', () => {
    const policy = Reflect.getMetadata(RETRY_POLICY_METADATA, OrderEventsConsumer.prototype.handleOrderCancelled);
    expect(policy?.nonRetryableErrors).toEqual(expect.arrayContaining([NotFoundException, BadRequestException]));
  });

  it('classifies OrderRefundCreated SO-not-found as non-retryable (즉시 DLQ)', () => {
    const policy = Reflect.getMetadata(RETRY_POLICY_METADATA, OrderEventsConsumer.prototype.handleOrderRefundCreated);
    expect(policy?.nonRetryableErrors).toEqual([NotFoundException]);
  });

  it('gives OrderCreated a more generous retry budget (P2-15 완화, no non-retryable business class)', () => {
    const policy = Reflect.getMetadata(RETRY_POLICY_METADATA, OrderEventsConsumer.prototype.handleOrderCreated);
    expect(policy?.maxRetries).toBe(5);
    expect(policy?.nonRetryableErrors).toBeUndefined();
  });

  it('leaves OrderModified on the default policy (수정 무시 = 의도적 무변경)', () => {
    const policy = Reflect.getMetadata(RETRY_POLICY_METADATA, OrderEventsConsumer.prototype.handleOrderModified);
    expect(policy).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx jest --testPathPattern=order-events.consumer.spec`
Expected: 새 describe 5건 중 필터·분류 4건 FAIL(필터/정책 메타데이터 부재로 `toContain`/`nonRetryableErrors` 불일치), `OrderModified` 1건 PASS(현재도 정책 없음). 기존 wiring 테스트는 PASS 유지.

- [ ] **Step 3: 컨슈머에 필터·정책 데코레이터 배선**

`order-events.consumer.ts` 를 아래처럼 수정한다.

(1) 1번째 줄 import 에 `UseFilters`·`BadRequestException` 추가:

```typescript
import { Controller, Logger, NotFoundException, BadRequestException, UseInterceptors, UseFilters } from '@nestjs/common';
```

(2) `@app/events` import 에 `EventsExceptionFilter`·`RetryPolicy` 추가:

```typescript
import { OnEvent, EventPayload, EventEnvelope, EventsExceptionFilter, RetryPolicy } from '@app/events';
```

(3) 클래스 데코레이터에 `@UseFilters(EventsExceptionFilter)` 추가 (`@UseInterceptors(EventTypeGuard)` 바로 아래, `export class` 위):

```typescript
@Controller()
@UseInterceptors(EventTypeGuard)
@UseFilters(EventsExceptionFilter)
export class OrderEventsConsumer {
```

(4) `handleOrderCreated` 의 `@OnEvent('orders.events.v1', 'OrderCreated')` 바로 아래에 관대 정책 추가:

```typescript
  @OnEvent('orders.events.v1', 'OrderCreated')
  @RetryPolicy({ maxRetries: 5, backoff: 'exponential', initialDelayMs: 1000, maxDelayMs: 15000 })
  async handleOrderCreated(
```

(5) `handleOrderCancelled` 의 `@OnEvent('orders.events.v1', 'OrderCancelled')` 바로 아래에 분류 추가:

```typescript
  @OnEvent('orders.events.v1', 'OrderCancelled')
  @RetryPolicy({ nonRetryableErrors: [NotFoundException, BadRequestException] })
  async handleOrderCancelled(
```

(6) `handleOrderRefundCreated` 의 `@OnEvent('orders.events.v1', 'OrderRefundCreated')` 바로 아래에 분류 추가:

```typescript
  @OnEvent('orders.events.v1', 'OrderRefundCreated')
  @RetryPolicy({ nonRetryableErrors: [NotFoundException] })
  async handleOrderRefundCreated(
```

`handleOrderModified` 는 데코레이터 무추가(기본 정책 유지). 핸들러 본문·try/catch·멱등 가드는 전부 무변경.

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npx jest --testPathPattern=order-events.consumer.spec`
Expected: 새 describe 5건 전부 PASS + 기존 wiring 테스트 PASS.

- [ ] **Step 5: 회귀 — 전체 consumer 스펙 + arch 경계 스펙 확인**

Run: `npx jest --testPathPattern="order-events.consumer.spec|inventory-write-boundary.arch.spec"`
Expected: 두 스펙 모두 PASS(기존 wiring/tx 전파 테스트 무회귀, 쓰기 경계 무영향).

- [ ] **Step 6: 빌드 + 변경 파일 eslint 확인**

Run: `npx nest build core`
Expected: exit 0 (tsc/webpack 성공).

Run: `npx eslint apps/core/src/modules/sales-order/consumers/order-events.consumer.ts apps/core/src/modules/sales-order/consumers/order-events.consumer.spec.ts`
Expected: 변경 파일 신규 error 0. (기존 pre-existing 경고가 있으면 diff 로 신규 여부만 판정 — 전역 lint debt 는 무관.)

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/sales-order/consumers/order-events.consumer.ts \
        apps/core/src/modules/sales-order/consumers/order-events.consumer.spec.ts
git commit -m "$(cat <<'EOF'
fix(core): 컨슈머 포이즌 분류 — EventsExceptionFilter 부착 + 재시도 분류 (작업 13, P1-1·P1-2)

OrderEventsConsumer 만 유일하게 auto-DLQ 필터 미부착이라 SO-not-found 취소·
출고 후 취소가 offset 미커밋 → 무한 포이즌으로 파티션을 정체시켰다.

- @UseFilters(EventsExceptionFilter): 재시도→DLQ→offset commit 로 전환
- OrderCancelled: nonRetryableErrors=[NotFound, BadRequest] → 즉시 DLQ (P1-1·P1-2)
- OrderRefundCreated: nonRetryableErrors=[NotFound] → 즉시 DLQ (P1-1)
- OrderCreated: maxRetries 5 관대 정책 — 일시 grant/DB 실패 완화 (P2-15)
- 필터·분류 메타데이터 회귀 가드 유닛 추가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage:**
- §3.1 필터 부착(A안) → Step 3(3). ✓
- §3.2 핸들러별 정책 표(Created 관대 / Cancelled·Refund non-retryable / Modified 무변경) → Step 3(4)(5)(6) + Step 1 테스트 5건. ✓
- §3.3 P2-15 완화(OrderCreated maxRetries 5, grant tx 무분리) → Step 3(4) + 테스트. ✓
- §5 멱등성·try/catch 보존 → Global Constraints + Step 3 "본문 무변경". ✓
- §7 필터·분류 메타데이터 회귀 가드 → Step 1 테스트. ✓
- §7 검증 체크리스트(build/arch/eslint) → Step 5·6. ✓
- §6 범위 밖(P2-15 tx/P3-1/Modified) → Global Constraints 명시. ✓

**2. Placeholder scan:** TBD/TODO/"적절히"/추상 지시 없음 — 모든 코드 블록이 실제 편집 내용. ✓

**3. Type consistency:** `RETRY_POLICY_METADATA`/`EXCEPTION_FILTERS_METADATA`/`EventsExceptionFilter`/`RetryPolicy` 명칭이 테스트(Step 1)와 구현(Step 3)에서 일치. `nonRetryableErrors` 배열 원소(`NotFoundException`/`BadRequestException`)가 양쪽 동일 클래스 참조. ✓
