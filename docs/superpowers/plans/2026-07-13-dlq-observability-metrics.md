# DLQ 관측 메트릭 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `DLQHandler`가 메시지를 DLQ로 발행할 때 Prometheus 카운터를 방출해, 조용히 유실되던 DLQ 이벤트를 Grafana Cloud에서 관측·알림 가능하게 만든다.

**Architecture:** `libs/events/src/dlq/`에 모듈 스코프 싱글턴 카운터 2종(신규 `dlq.metrics.ts`)을 prom-client 전역 `register`에 등록하고, `DLQHandler.sendToDLQ`의 emit 성공/실패 지점에서 `.inc()`한다. 코드는 공유 lib이라 전 컨슈머에 균일 배포되나 실관측은 Alloy가 스크레이프하는 Core로 한정(Core 우선 MVP). 알림이 무의미해진 dead code(`shouldAlert` + TODO 주석)는 절제.

**Tech Stack:** NestJS, prom-client `^15.1.3`(루트 의존성), Jest, RxJS.

## Global Constraints

- 카운터는 **모듈 스코프 싱글턴** — 인스턴스 필드 금지(`DLQHandler`가 `events.module.ts:109`·`:255` 2곳 프로바이드 → 전역 `register` 중복 등록 예외).
- `error` 라벨 = **예외 클래스명(`error.name`)만** — `error.message`는 카디널리티 폭발이라 금지.
- 메트릭 이름 접두 = `events_`(공유 인프라, WMS 전용 `wms_` 아님).
- **무변경**: `DLQHandler.sendToDLQ` 시그니처·DLQ envelope 포맷·`getDLQTopicName`·`EventsModule` 배선·Core `MetricsService`/`/metrics` 컨트롤러·DB schema.
- **존치**: `sendToDLQ`의 DB 저장 TODO(`:117-118`)·`reprocessDLQ`/`resolveDLQ`(별개 관심사).
- 검증(스프린트 규약): `nest build core` exit 0 · arch 경계 spec(`inventory-write-boundary.arch.spec.ts`) PASS · 변경 **프로덕션** 파일 신규 eslint error 0 · 삭제 심볼(`shouldAlert`) 저장소 참조 0. 스키마 무변경이라 dev DB 의존 ⏸ 없음.

---

## File Structure

- **Create** `libs/events/src/dlq/dlq.metrics.ts` — 카운터 2종 싱글턴 정의 + export.
- **Create** `libs/events/src/dlq/dlq.metrics.spec.ts` — 메트릭 방출 유닛 테스트.
- **Modify** `libs/events/src/dlq/dlq-handler.service.ts` — 카운터 import + 2개 inc 지점 + dead code 절제.
- **Modify** `docs/logistics-backend-hardening-2026-07.md` — 완료 블록 + §5 ① 정정.

---

## Task 1: DLQ 메트릭 카운터 정의 + sendToDLQ 배선

**Files:**
- Create: `libs/events/src/dlq/dlq.metrics.ts`
- Create: `libs/events/src/dlq/dlq.metrics.spec.ts`
- Modify: `libs/events/src/dlq/dlq-handler.service.ts`

**Interfaces:**
- Produces: `dlqMessagesTotal: Counter<'topic'|'consumer'|'error'>`, `dlqSendFailuresTotal: Counter<'topic'|'consumer'>` (named exports from `dlq.metrics.ts`). `DLQHandler.sendToDLQ` inc 지점 2곳.
- Consumes: `DLQHandler.sendToDLQ(params)` 시그니처(무변경), prom-client `register`, `MessageEnvelope`, `ClientKafka`.

- [ ] **Step 1: 카운터 싱글턴 파일 생성**

Create `libs/events/src/dlq/dlq.metrics.ts`:

```typescript
import { Counter, register } from 'prom-client';

/**
 * DLQ 관측 메트릭 — 모듈 스코프 싱글턴.
 *
 * DLQHandler 는 EventsModule 에서 2곳(events.module.ts:109, :255)에서 프로바이드되므로,
 * 카운터를 인스턴스 필드로 두면 두 번째 생성 시 prom-client 전역 register 중복 등록
 * 예외가 난다. 모듈 스코프 싱글턴이면 인스턴스 수와 무관하게 1회만 등록된다.
 *
 * 관측 커버리지: 전역 register 는 프로세스 단위이고 Alloy 는 Core /metrics 만 스크레이프하므로,
 * 실관측되는 것은 Core 프로세스의 DLQ 뿐이다(설계 스펙 §2 Core 우선 MVP).
 */

/** DLQ 로 발행 성공한 메시지 누적 수 — 조용히 유실되던 케이스의 관측 지점. */
export const dlqMessagesTotal = new Counter({
  name: 'events_dlq_messages_total',
  help: 'Messages routed to a dead-letter queue after retries were exhausted or the error was non-retryable',
  labelNames: ['topic', 'consumer', 'error'],
  registers: [register],
});

/** DLQ 발행 자체가 실패한 수 — offset 미커밋→무한 재전달로 이어지는 치명 케이스. */
export const dlqSendFailuresTotal = new Counter({
  name: 'events_dlq_send_failures_total',
  help: 'Failures to deliver a message to its dead-letter queue (offset not committed, message will be redelivered)',
  labelNames: ['topic', 'consumer'],
  registers: [register],
});
```

- [ ] **Step 2: 실패하는 테스트 작성**

Create `libs/events/src/dlq/dlq.metrics.spec.ts`:

```typescript
import { of, throwError } from 'rxjs';
import type { ClientKafka } from '@nestjs/microservices';
import type { MessageEnvelope } from '@packages/event-contracts/types';
import { DLQHandler } from './dlq-handler.service';
import { dlqMessagesTotal, dlqSendFailuresTotal } from './dlq.metrics';

function buildParams() {
  const originalMessage = {
    messageId: 'msg-1',
    messageType: 'OrderCancelled',
    source: { aggregateId: 'order-123' },
  } as unknown as MessageEnvelope;

  return {
    originalTopic: 'orders.events.v1',
    originalMessage,
    error: new Error('handler boom'), // name === 'Error'
    context: {
      partition: 0,
      offset: '42',
      consumer: 'OrderEventsConsumer',
      retryCount: 3,
    },
  };
}

describe('DLQHandler metrics', () => {
  beforeEach(() => {
    // 모듈 스코프 싱글턴이라 register.clear() 대신 값만 리셋(등록 유지).
    dlqMessagesTotal.reset();
    dlqSendFailuresTotal.reset();
  });

  it('DLQ 발행 성공 시 events_dlq_messages_total 을 라벨과 함께 증가시킨다', async () => {
    const kafka = { emit: () => of(undefined) } as unknown as ClientKafka;
    const handler = new DLQHandler(kafka);

    await handler.sendToDLQ(buildParams());

    const metric = await dlqMessagesTotal.get();
    const sample = metric.values.find(
      (v) =>
        v.labels.topic === 'orders.events.v1' &&
        v.labels.consumer === 'OrderEventsConsumer' &&
        v.labels.error === 'Error',
    );
    expect(sample?.value).toBe(1);
  });

  it('DLQ 발행 실패 시 events_dlq_send_failures_total 을 증가시키고 에러를 재던진다', async () => {
    const kafka = {
      emit: () => throwError(() => new Error('broker down')),
    } as unknown as ClientKafka;
    const handler = new DLQHandler(kafka);

    await expect(handler.sendToDLQ(buildParams())).rejects.toThrow('broker down');

    const metric = await dlqSendFailuresTotal.get();
    const sample = metric.values.find(
      (v) => v.labels.topic === 'orders.events.v1' && v.labels.consumer === 'OrderEventsConsumer',
    );
    expect(sample?.value).toBe(1);
  });
});
```

- [ ] **Step 3: 테스트 실행 → 실패 확인**

Run: `npx jest libs/events/src/dlq/dlq.metrics.spec.ts`
Expected: 2 tests FAIL — `sample` is `undefined`(핸들러가 아직 inc 안 함), `sample?.value` is `undefined` ≠ `1`. (실패 테스트는 rethrow는 통과하나 send-failures counter 미증가로 실패.)

- [ ] **Step 4: sendToDLQ 에 카운터 배선**

In `libs/events/src/dlq/dlq-handler.service.ts`:

(4a) import 추가 — `import { DLQMessage } from './dlq.types';` 줄 바로 아래에:

```typescript
import { dlqMessagesTotal, dlqSendFailuresTotal } from './dlq.metrics';
```

(4b) 성공 inc — `sendToDLQ` 내 `this.logger.warn(...)` 블록(현행 `:108-115`) **바로 다음**, `// TODO: 필요 시 DB에도 저장` 줄 **앞**에 삽입:

```typescript
      dlqMessagesTotal.inc({
        topic: params.originalTopic,
        consumer: params.context.consumer,
        error: params.error.name,
      });

```

(4c) 실패 inc — `catch (error) {` 블록 내 `this.logger.error(...)` 호출 **앞**에 삽입:

```typescript
      dlqSendFailuresTotal.inc({
        topic: params.originalTopic,
        consumer: params.context.consumer,
      });

```

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run: `npx jest libs/events/src/dlq/dlq.metrics.spec.ts`
Expected: 2 tests PASS.

- [ ] **Step 6: eslint(변경 프로덕션 파일) 확인**

Run: `npx eslint libs/events/src/dlq/dlq.metrics.ts libs/events/src/dlq/dlq-handler.service.ts`
Expected: 프로덕션 2파일 신규 error 0. (spec 파일의 `as unknown as` 캐스트 계열 경고는 test-scope 허용 — 스프린트 규약 §281.)

- [ ] **Step 7: 커밋**

```bash
git add libs/events/src/dlq/dlq.metrics.ts libs/events/src/dlq/dlq.metrics.spec.ts libs/events/src/dlq/dlq-handler.service.ts
git commit -m "$(cat <<'EOF'
feat(events): DLQ 발행 관측 메트릭 카운터 추가

events_dlq_messages_total{topic,consumer,error} +
events_dlq_send_failures_total{topic,consumer} 를 sendToDLQ emit
성공/실패 지점에서 방출(모듈 스코프 싱글턴). Core 우선 MVP.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: dead alert code 절제

**Files:**
- Modify: `libs/events/src/dlq/dlq-handler.service.ts`

**Interfaces:**
- Consumes: 없음. 순수 삭제(동작 무변경) — 메트릭이 알림 의도를 대체했으므로 오도성 dead code 제거.

- [ ] **Step 1: 알림 TODO 주석 블록 삭제**

In `libs/events/src/dlq/dlq-handler.service.ts`, `sendToDLQ` 내에서 다음 4줄(현행 `:120-123`)을 삭제:

```typescript
      // TODO: 중요한 에러는 알림 발송
      // if (this.shouldAlert(params.originalTopic, params.error)) {
      //   await this.sendAlert(dlqMessage);
      // }
```

바로 위 DB 저장 TODO 2줄(`// TODO: 필요 시 DB에도 저장` / `// await this.saveDLQToDatabase(dlqMessage);`)은 **존치**.

- [ ] **Step 2: `shouldAlert` private 메서드 삭제**

같은 파일에서 `shouldAlert` 메서드 전체(현행 `:217-235`, 상단 JSDoc `/** 알림이 필요한지 판단 */` 포함)를 삭제:

```typescript
  /**
   * 알림이 필요한지 판단
   */
  private shouldAlert(topic: string, error: Error): boolean {
    // 중요한 도메인은 즉시 알림
    const criticalTopics = ['orders.events.v1', 'payments.events.v1'];

    if (criticalTopics.some((t) => topic.includes(t))) {
      return true;
    }

    // 특정 에러는 즉시 알림
    const criticalErrors = ['DatabaseError', 'TimeoutError', 'FatalError'];
    if (criticalErrors.includes(error.name)) {
      return true;
    }

    return false;
  }
```

- [ ] **Step 3: 삭제 심볼 참조 0 확인**

Run: `grep -rn "shouldAlert\|sendAlert" libs apps`
Expected: 출력 없음(참조 0).

- [ ] **Step 4: 빌드 + 테스트 회귀 확인**

Run: `npx nest build core && npx jest libs/events/src/dlq/dlq.metrics.spec.ts`
Expected: build exit 0, 2 tests PASS.

- [ ] **Step 5: eslint 확인**

Run: `npx eslint libs/events/src/dlq/dlq-handler.service.ts`
Expected: 신규 error 0.

- [ ] **Step 6: 커밋**

```bash
git add libs/events/src/dlq/dlq-handler.service.ts
git commit -m "$(cat <<'EOF'
refactor(events): DLQHandler dead alert 코드 절제

메트릭이 알림 의도를 대체 — 주석 처리된 shouldAlert/sendAlert TODO
블록과 참조 0인 shouldAlert private 메서드 제거. 동작 무변경.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 현황판 갱신 + 최종 검증

**Files:**
- Modify: `docs/logistics-backend-hardening-2026-07.md`

**Interfaces:**
- Consumes: 없음. 문서 + 최종 게이트 검증.

- [ ] **Step 1: 완료 블록 추가**

`docs/logistics-backend-hardening-2026-07.md`의 WS-E 섹션 직전(§5 `**WS-E. 컨벤션/횡단**` 줄 앞)에 다음 블록을 삽입:

```markdown
> **✅ DLQ 관측 메트릭 (잔여 우선순위 ① DLQ 알림 확인 후속) 완료 — 2026-07-13:** 작업 13/이벤트 인터셉터 재설계가 실패 모드를 "조용한 DLQ 적재 + offset commit"으로 바꾼 뒤, DLQ 이벤트에 알림·메트릭이 **코드·인프라 어디에도 없던 것**(조사: 앱 알림 주석처리·메트릭 미등록·Redpanda 미스크레이프·로그만 존재)을 메트릭 방출로 해소. 스키마 무변경.
> - **메트릭**: `libs/events/src/dlq/dlq.metrics.ts` 신규 — `events_dlq_messages_total{topic,consumer,error}`(발행 성공=조용한 유실 관측) + `events_dlq_send_failures_total{topic,consumer}`(발행 실패=offset 미커밋 치명 케이스). prom-client 전역 register 모듈 스코프 싱글턴(DLQHandler 2곳 프로바이드 중복 등록 회피). `error` 라벨=클래스명만(카디널리티).
> - **배선**: `DLQHandler.sendToDLQ` emit 성공/catch 지점 inc. 시그니처·envelope·EventsModule 무변경. dead alert 코드(`shouldAlert`+TODO 주석) 절제.
> - **커버리지(Core 우선 MVP)**: 코드는 전 컨슈머 균일 배포되나 Alloy가 Core `/metrics`만 스크레이프 → **실관측은 Core DLQ**(작업 13 하드닝한 주문/환불/재고 컨슈머 커버). non-Core 확장(각 앱 `/metrics`+Alloy 타겟)은 known gap.
> - **운영자 후속(리포 밖)**: Grafana Cloud 알림 규칙은 UI 관리 — 이 작업은 메트릭 방출만 제공. 권장 PromQL: warn `sum(increase(events_dlq_messages_total[10m])) by (topic,consumer) > 0` · critical `sum(increase(events_dlq_send_failures_total[5m])) > 0`.
> - 설계 `docs/superpowers/specs/2026-07-13-dlq-observability-metrics-design.md` · 계획 `docs/superpowers/plans/2026-07-13-dlq-observability-metrics.md`.
> - 검증: `nest build core` exit 0 · arch 경계 spec PASS · `dlq.metrics.spec.ts` 2 GREEN · 삭제 심볼(`shouldAlert`) 참조 0 · 프로덕션 변경파일 신규 eslint 0. 통합 spec 없음(신규 전부 유닛).
```

- [ ] **Step 2: §5 잔여 우선순위 ① 정정**

같은 문서 §5 마지막 문단(줄 355 부근, `**잔여 우선순위**:`로 시작)에서 `① ✅ 이슈 #507·#508 … **잔여는 DLQ 토픽 알림 확인 + #509**` 부분을 찾아, "DLQ 토픽 알림 확인"을 다음으로 갱신:

`DLQ 관측 메트릭(✅ 2026-07-13, events_dlq_* 방출 — Grafana Cloud 알림 규칙은 운영자 후속) + #509`

(정확한 문자열은 문서 현재 내용으로 로케이트 — 라인 드리프트 가능.)

- [ ] **Step 3: 최종 게이트 검증**

Run:
```bash
npx nest build core
npx jest libs/events/src/dlq/dlq.metrics.spec.ts inventory-write-boundary.arch
```
Expected: build exit 0 · `dlq.metrics.spec.ts` 2 PASS · `inventory-write-boundary.arch.spec.ts` PASS.

- [ ] **Step 4: 커밋**

```bash
git add docs/logistics-backend-hardening-2026-07.md
git commit -m "$(cat <<'EOF'
docs(core): 현황판 — DLQ 관측 메트릭 완료 반영

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- §3.1 카운터 정의(모듈 싱글턴, 라벨) → Task 1 Step 1. ✅
- §3.2 증가 지점(emit 성공/catch) → Task 1 Step 4b/4c. ✅
- §3.3 dead code 절제(`shouldAlert`+TODO) → Task 2. ✅
- §4 테스트(ledger-drift 패턴·rethrow) → Task 1 Step 2. ✅
- §6 현황판 갱신 + 권장 PromQL → Task 3 Step 1/2. ✅
- §5 비목표(Grafana 규칙·non-Core·DB TODO 존치) → Global Constraints + Task 3 블록 명시. ✅

**Placeholder scan:** 코드 스텝 전부 실제 코드 포함, "TBD/적절히" 없음. ✅

**Type consistency:** `dlqMessagesTotal`/`dlqSendFailuresTotal` 이름·라벨(`topic`/`consumer`/`error`)이 Task 1 정의·배선·테스트에서 일치. `sendToDLQ` params 접근 경로(`params.originalTopic`/`params.context.consumer`/`params.error.name`)가 실제 시그니처와 일치. ✅
