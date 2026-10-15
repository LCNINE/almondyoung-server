# 컨슈머 오프셋 커밋 켜기 (#1073) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모든 Kafka 컨슈머 그룹이 처리를 마친 메시지의 오프셋을 커밋하게 해서, 배포·재시작·리밸런스 때 메시지가 조용히 사라지지 않게 한다.

**Architecture:** `startConsumer` 가 kafkajs 에 넘기는 `run.autoCommit` 을 `true` 로 고정한다(끄는 옵션은 없앤다). Nest `ServerKafka.handleEvent` 는 이미 핸들러 Observable 을 `lastValueFrom` 으로 기다리므로, kafkajs 는 `eachMessage` 가 끝난 메시지만 resolve·커밋한다 — 별도 서버 클래스가 필요 없다. 소비 앱 7곳에 `enableShutdownHooks()` 를 더해 SIGTERM 때 컨슈머가 커밋하고 그룹을 깨끗이 떠나게 한다.

**Tech Stack:** NestJS 11.1.17 `@nestjs/microservices` (`ServerKafka`), kafkajs 2.2.4, Redpanda(라이브 EC2 단일 노드), Jest.

**Spec:** GitHub 이슈 #1073 본문 + 아래 «실측 결과»(2026-10-15). 이슈 본문의 «사실 2»는 틀렸다 — 이 계획의 Task 5 가 본문을 고친다.

---

## 실측 결과 (2026-10-15) — 이 계획의 근거

**1. 커밋은 정말 0이다 (라이브 확정).** Grafana `events_consumer_lag` 에서 9개 그룹 × 전 파티션(222 시리즈) **전부 `-1`**, `>= 0` 은 0개. `-1` 은 폴러가 `fetchOffsets` 에 성공했는데 커밋 오프셋이 없을 때만 나온다(`consumer-lag.collector.ts` — 폴러 실패면 씨 뿌린 `0` 이 남는다).

```bash
# 재현 (basic auth = 3066614:<GrafanaCloudApiToken>)
curl -s -u "3066614:$TOKEN" https://prometheus-prod-49-prod-ap-northeast-0.grafana.net/api/prom/api/v1/query \
  --data-urlencode 'query=count by (group) (events_consumer_lag >= 0)'   # 지금: 빈 결과
```

**2. 이슈의 «사실 2(완료를 기다리지 않는다)»는 틀렸다.** 이슈와 `handler-failure.spec.ts` 머리 주석, ADR-0029 §8 은 기본 `Server.handleEvent`(`server.js:100-118`)를 봤다. 그런데 **`ServerKafka` 가 그 메서드를 덮어써서 `await lastValueFrom(resultOrStream)` 한다**(`node_modules/@nestjs/microservices/server/server-kafka.js:225-236`, lock 의 11.1.17). 실행으로 확인: 300ms 걸리는 핸들러에서 `ServerKafka.handleEvent` 는 302ms 뒤 resolve, 기본 `Server` 는 0ms. 그래서 지금도:
- 같은 파티션은 **직렬**로 처리된다(순서 보장 OK)
- `EventRetryInterceptor` 의 재시도 대기가 그 파티션을 **막는다**
- 인터셉터를 탈출한 에러(`DlqDeliveryError`)는 kafkajs `eachMessage` 까지 **올라간다** — 사라지지 않는다

**3. 커밋이 없으면 리밸런스마다 «최신»으로 점프한다 = 유실 방향(재처리 아님).** kafkajs 는 `sync()` 마다 `OffsetManager` 를 새로 만들고 생성자가 `clearAllOffsets()` 로 캐시를 비운다(`consumerGroup.js:310`, `offsetManager/index.js:361`). 그래서 리밸런스 뒤엔 브로커에 오프셋을 다시 묻고, 없으니 `fromBeginning: false` → 최신. 옛 주인이 못 읽은 메시지와 리밸런스 사이에 들어온 메시지를 **아무도 안 읽는다.** 로그·DLQ·메트릭 어디에도 흔적이 없다.
- 에러 경로도 같다: `eachMessage` 가 던지면 kafkajs 가 몇 번 재시도하다 crash → restart → rejoin → 최신. 즉 `DlqDeliveryError` 는 지금 «재전달»이 아니라 «그 메시지와 뒤 메시지 건너뛰기»가 된다.

**4. 라이브 유실 실례 1건 확정.** 2026-10-01 ServicesBundleA 배포:
- 03:44:38 SIGTERM → 03:45:06 supervisor SIGKILL(28s) → **03:45:15.044 core 가 `inventory.events.v1` 발행**(trace `2c8c082028203b9aa9573f5bb8551272`, key `166c807f-18fe-4c2f-bfb8-a7f158690b52`) → 03:45:35 리밸런스
- channel-adapter `ProductSellableQuantityConsumer` 는 핸들러 첫 줄에서 무조건 `수신` 로그를 남기는데, 이 trace_id 로그가 **어느 태스크에도 없다** → 처리되지 않았다. 결과: 그 variant 의 Medusa 판매가능수량이 다음 변경까지 낡은 값.

**5. Tempo 만으로 유실을 세면 과대계상된다.** 14일·10% 샘플·약 3,000 send 트레이스 대조에서 «구독자 span 없음» 후보가 3건 더 나왔지만, 2건(10-07 analytics, 10-02 channel-adapter)은 옛 태스크 stdout 에 같은 trace_id 처리 로그가 있었다. `telemetry.ts:86` 이 SIGTERM 때 OTel SDK 를 먼저 꺼서 **처리는 됐는데 span 만 안 나간** 것. 유실 판정은 반드시 stdout 로그로 교차확인한다.

**6. 유실 창의 모양.** ServicesBundleA/B 는 태스크 1개, 앱 7곳은 `enableShutdownHooks` 가 없다. SIGTERM 뒤에도 자식 프로세스가 계속 소비하다가(`telemetry.ts` 의 SIGTERM 리스너가 기본 종료를 막는다) 28s 뒤 SIGKILL, 그 뒤 `sessionTimeout` 30s 가 지나야 리밸런스 → **배포마다 약 30초**, 죽은 멤버가 쥐던 파티션의 메시지가 사라진다. ServicesBundleA 는 14일 동안 SIGTERM 20회.

**7. 켜는 순간의 «옛 오프셋 대량 재처리» 위험은 없다.** 이슈 «고칠 방향 4»가 걱정한 오래된 커밋 오프셋이 라이브에 하나도 없다(1번). 켜고 나서 첫 배포는 오늘과 똑같이 최신에서 시작하고, 그때부터 커밋이 쌓인다.

---

## Global Constraints

- 소비 앱 목록의 정본은 `grep -ln "EventsModule.startConsumer(app" apps/*/src/main.ts` (지금 9곳: ai, analytics, channel-adapter, core, membership, notification, search, ugc-service, wallet). 숫자를 문서에 박지 말 것.
- 실제 그룹 이름 = `<groupId>` + `KAFKA_CONSUMER_GROUP_POSTFIX`(`-server`). 라이브 groupId 는 SST 가 `KAFKA_GROUP_ID` 로 준다(core 만 하드코딩 `almondyoung-order-consumer`).
- `npm run type-check` 에러 0 · `npx jest` 실패 0 (`CLAUDE.md` 검증 게이트).
- 실 브로커가 필요한 스펙은 env 가드로 기본 게이트에서 skip 된다. 스펙 안에서 `dotenv.config()` 금지.
- 스펙·코드 주석에 채팅용 기호(→, 굵게)를 넣지 않는다.
- 커밋 메시지는 한국어, 이 저장소 관례(`fix(events): …` / `docs(…): …`)와 `(#1073)` 꼬리표.

## Review Focus

1. **한 번도 메시지를 받지 않은 파티션의 리밸런스** — 커밋은 «처리한» 메시지에만 생긴다. 켠 뒤 아직 메시지가 한 건도 안 온 파티션은 여전히 커밋이 없으므로, 그 파티션의 첫 메시지가 하필 리밸런스 창에 오면 오늘처럼 사라진다. 트래픽이 지나가면 스스로 닫히는 잔여 구멍이다. Task 2 스펙은 같은 키(=같은 파티션)로만 검증하고, Task 4 의 배포 후 점검이 `-1` 시리즈 감소로 이 구멍이 닫혀가는 것을 본다.
2. **중복 재처리(at-least-once)** — 커밋 주기 사이(kafkajs 는 배치가 끝날 때마다 커밋)에 SIGKILL·crash 가 나면 처리했지만 커밋 못 한 메시지가 다시 온다. 오늘은 «유실», 켠 뒤엔 «드문 중복»이다. 중복이 고객에게 보이는 notification 은 Task 0 이 먼저 막는다. 나머지 앱은 부록 감사상 안전하다.
3. **`DlqDeliveryError` 의 새 의미론** — 켠 뒤엔 DLQ 발행까지 실패하면 kafkajs 가 같은 메시지를 계속 다시 준다(파티션 정지). `event-retry.interceptor.ts` 주석이 «의도된 의미론»이라 적은 그대로다. 그 파티션이 멈춰 있는 동안 `events_consumer_lag` 가 오른다 — #815 알림이 그걸 잡는지 Task 4 에서 확인.
4. **`app.close()` 가 컨슈머를 먼저 멈추는지** — `enableShutdownHooks` 뒤 SIGTERM 이 Nest `close()` 를 부르면 `ServerKafka.close()` → `consumer.disconnect()` 가 진행 중 배치를 끝내고 커밋한 뒤 그룹을 떠난다. Task 2 스펙의 «재시작 뒤 이미 처리한 메시지를 다시 받지 않는다»가 이 경로(`app.close()`)를 그대로 탄다.
5. **supervisor 의 28초 안에 종료가 끝나는지** — 재시도 대기 중인 핸들러가 있으면 `disconnect` 가 그만큼 늦는다. 28초를 넘기면 SIGKILL 로 떨어지고 그 메시지는 다시 온다(중복, 유실 아님). Task 4 배포 후 로그에서 `graceful timeout reached; forcing SIGKILL` 가 남는지 본다.

---

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `apps/notification/src/dispatcher/handlers/event-notice-key.ts` (+ `.guard.spec.ts`) | 이벤트 알림 멱등 키 — 재전달 중복 발송 차단 (Task 0) | Create |
| `apps/notification/src/dispatcher/handlers/*.consumer.ts` | 키 없는 `send` 에 `idempotencyKey` | Modify |
| `libs/events/src/transport/kafka-consumer-options.ts` | `startConsumer` 가 Nest 에 넘기는 Kafka 마이크로서비스 옵션을 만든다 — 커밋 정책이 사는 곳 | Create |
| `libs/events/src/transport/kafka-consumer-options.spec.ts` | 커밋이 켜져 있는지·끌 길이 없는지를 고정 | Create |
| `libs/events/src/events.module.ts` | `startConsumer` 가 위 함수를 쓰고 `autoCommit` 옵션을 없앤다 | Modify `:110-130`, `:398-430` |
| `libs/events/src/transport/kafka-commit.integration.spec.ts` | 실 브로커에서 «재시작해도 안 잃고, 처리한 건 다시 안 받는다» | Create |
| `libs/events/src/transport/start-consumer-shutdown-hooks.spec.ts` | 소비 앱 `main.ts` 가 `enableShutdownHooks()` 를 부르는지 가드 | Create |
| `apps/{analytics,channel-adapter,membership,notification,search,ugc-service,wallet}/src/main.ts` | `app.enableShutdownHooks()` | Modify |
| `libs/events/src/transport/handler-failure.spec.ts` | 머리 주석 정정 | Modify `:1-27` |
| `libs/events/src/interceptors/event-retry.interceptor.ts` | 주석이 가리키는 근거 보강 | Modify `:1-45` |
| `docs/adr/0029-events-module-registration-surfaces.md` | §8 의 `Server.handleEvent` 서술 정정 노트 | Modify `:226-228` |
| `docs/superpowers/specs/2026-10-15-event-failure-exits-design.md` | 선행 조건 노트 갱신 | Modify `:7-9` |

---

### Task 0: notification 핸들러가 멱등 키를 넘긴다 (커밋보다 먼저)

커밋을 켜면 «처리했지만 커밋 못 한» 메시지가 드물게 다시 온다(Review Focus 2). 107개 `@On` 핸들러를 감사한 결과(아래 부록) **중복이 고객에게 보이는 것은 notification 뿐**이다. notification 핸들러는 `@RetryPolicy({ maxRetries: 0 })` 라 지금은 중복이 안 나므로, 이건 커밋이 **새로 여는** 위험이다 — 그래서 Task 1 보다 먼저 한다.

장치는 이미 있다: `NotificationDispatcherService.send` 는 `dto.idempotencyKey` 가 있으면 `(idempotency_key, channel)` ON CONFLICT 로 두 번째를 버린다(`notification-dispatcher.service.ts:169-186`, 통합 스펙 `notification-dispatcher.idempotency.integration.spec.ts`). 핸들러가 키를 안 넘길 뿐이다 — 넘기는 곳은 `membership-event.consumer.ts:180,209` 둘뿐.

**Files:**
- Create: `apps/notification/src/dispatcher/handlers/event-notice-key.ts`
- Create: `apps/notification/src/dispatcher/handlers/event-notice-key.guard.spec.ts`
- Modify: `apps/notification/src/dispatcher/handlers/{order,wallet,user,ugc,membership}-event.consumer.ts` — `notificationDispatcherService.send(` 호출 중 `idempotencyKey` 가 없는 것 전부(도출: `grep -n "notificationDispatcherService.send(" apps/notification/src/dispatcher/handlers/*.consumer.ts`)
- Test: 기존 `order-event.consumer.spec.ts`, `wallet-event.consumer.spec.ts`, `membership-event.consumer.spec.ts`, `ugc-event.consumer.spec.ts`

**Interfaces:**
- Produces: `eventNoticeKey(messageId: string, eventKey: string, userId: string): string`

- [ ] **Step 1: 가드 스펙을 쓴다**

`event-notice-key.guard.spec.ts`:

```ts
/**
 * 이벤트로 보내는 알림은 멱등 키를 갖는다 (#1073)
 *
 * 컨슈머가 오프셋을 커밋하면서, 처리했지만 커밋 못 한 메시지가 재시작 뒤 다시 올 수 있게 됐다.
 * 키가 없으면 디스패처는 새 행을 만들어 같은 알림을 또 보낸다(알림톡·SMS 면 돈도 든다).
 * 키가 있으면 (idempotency_key, channel) ON CONFLICT 가 두 번째를 버린다.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const HANDLERS = __dirname;
const consumerFiles = readdirSync(HANDLERS).filter((f) => f.endsWith('.consumer.ts'));

describe('notification 컨슈머의 send 호출', () => {
  it('검사할 파일이 있다', () => {
    expect(consumerFiles.length).toBeGreaterThan(0);
  });

  it.each(consumerFiles)('%s 의 send 호출 수만큼 idempotencyKey 가 있다', (file) => {
    const src = readFileSync(join(HANDLERS, file), 'utf8');
    const sends = (src.match(/notificationDispatcherService\.send\(/g) ?? []).length;
    const keys = (src.match(/idempotencyKey:/g) ?? []).length;

    expect(keys).toBeGreaterThanOrEqual(sends);
  });
});
```

글자 수 대조라 거칠다 — 이 저장소의 IDOR 가드처럼 «빠뜨림을 막는 그물»로 쓴다. `sendDto` 변수를 만들어 넘기는 핸들러는 그 객체 리터럴에 `idempotencyKey:` 를 넣으면 같은 파일 안이라 잡힌다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/notification/src/dispatcher/handlers/event-notice-key.guard.spec.ts`
Expected: FAIL — order·wallet·user·ugc·membership 행.

- [ ] **Step 3: 키 함수를 만든다**

`event-notice-key.ts`:

```ts
/**
 * 이벤트 하나가 만든 알림의 멱등 키 (#1073).
 *
 * messageId 는 envelope 마다 유일하므로 Kafka 재전달이면 같은 키가 된다. eventKey·userId 를 붙이는
 * 이유: 한 이벤트가 서로 다른 알림이나 여러 수신자에게 보낼 때 두 번째가 «중복»으로 버려지면 안 된다.
 * 채널은 디스패처의 ON CONFLICT 대상에 이미 있다.
 */
export const eventNoticeKey = (messageId: string, eventKey: string, userId: string): string =>
  `event:${messageId}:${eventKey}:${userId}`;
```

- [ ] **Step 4: 키가 없는 `send` 호출마다 넣는다**

각 호출의 DTO 에 한 줄을 더한다. 값은 그 DTO 의 `eventKey`·`userId` 와 핸들러의 `envelope.messageId`:

```ts
        idempotencyKey: eventNoticeKey(envelope.messageId, 'ORDER_CREATED', payload.customerId),
```

`eventKey` 가 변수(`eventMapping.eventKey` 등)면 그 변수를, `userId` 도 DTO 에 넣는 바로 그 값을 쓴다. 핸들러가 `envelope` 을 안 받고 있으면 `@EventEnvelope() envelope: EnvelopeOf<…>` 파라미터를 더한다(같은 파일의 다른 핸들러가 본이다). 이미 도메인 키를 넘기는 `membership-event.consumer.ts:180,209` 는 건드리지 않는다.

`order-event.consumer.ts:212`(`OrderPaymentCompleted`)는 `userId` 에 `orderId` 를 넣는 기존 결함(TODO)이 있다 — 키는 똑같이 붙이되 그 결함은 이 계획에서 고치지 않는다. PR 본문에 별건으로 적는다.

- [ ] **Step 5: 기존 컨슈머 스펙에 재전달 단언을 하나씩 더한다**

`order-event.consumer.spec.ts`·`wallet-event.consumer.spec.ts`·`membership-event.consumer.spec.ts`·`ugc-event.consumer.spec.ts` 에서 dispatcher `send` 를 mock 하는 기존 케이스 하나를 골라, 같은 envelope 으로 핸들러를 두 번 부르고 두 호출의 `idempotencyKey` 가 같고 비어 있지 않은지 단언한다:

```ts
  it('같은 메시지가 다시 오면 같은 멱등 키로 보낸다 — 디스패처가 두 번째를 버린다 (#1073)', async () => {
    await consumer.onOrderCreated(envelope, payload);
    await consumer.onOrderCreated(envelope, payload);

    const [first, second] = dispatcher.send.mock.calls.map(([dto]) => dto.idempotencyKey);
    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });
```

변수 이름(`consumer`·`dispatcher`·`envelope`·`payload`)은 각 스펙 파일의 기존 픽스처에 맞춘다. `user-event.consumer.ts` 는 스펙 파일이 없으므로 가드 스펙만으로 둔다.

- [ ] **Step 6: 통과를 확인하고 커밋한다**

Run: `npx jest apps/notification && npm run type-check`
Expected: 실패 0, 에러 0

```bash
git add apps/notification/src/dispatcher/handlers
git commit -m "fix(notification): 이벤트 알림에 멱등 키 — 커밋 켠 뒤 재전달돼도 두 번 안 보낸다 (#1073)"
```

---

### Task 1: 커밋을 켜고 끌 길을 없앤다

**Files:**
- Create: `libs/events/src/transport/kafka-consumer-options.ts`
- Create: `libs/events/src/transport/kafka-consumer-options.spec.ts`
- Modify: `libs/events/src/events.module.ts:110-130` (`StartConsumerOptions`), `:398-430` (`startConsumer` 의 옵션 조립)

**Interfaces:**
- Produces: `buildKafkaConsumerServerOptions(kafka: KafkaConfig, consumer: KafkaConsumerTuning): KafkaOptions['options']` 와 `interface KafkaConsumerTuning { groupId: string; sessionTimeout?: number; heartbeatInterval?: number; maxPollInterval?: number }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`libs/events/src/transport/kafka-consumer-options.spec.ts`:

```ts
/**
 * 컨슈머 커밋 정책 (#1073)
 *
 * 커밋이 꺼져 있던 동안 라이브 9개 그룹 전 파티션의 커밋 오프셋이 없었고(`events_consumer_lag`
 * 전부 -1), kafkajs 는 리밸런스마다 브로커에 오프셋을 다시 물어 없으면 최신으로 점프했다 —
 * 배포 때마다 죽은 멤버가 쥐던 파티션의 메시지가 조용히 사라졌다. 커밋은 «켜는 옵션»이 아니라
 * 고정값이어야 한다: 끌 수 있으면 언젠가 누가 끈다.
 */
import { buildKafkaConsumerServerOptions } from './kafka-consumer-options';
import { KAFKA_CONSUMER_GROUP_POSTFIX } from './kafka-consumer-options';

const kafka = { clientId: 'spec', brokers: ['localhost:9092'] };

describe('buildKafkaConsumerServerOptions', () => {
  it('처리를 마친 메시지의 오프셋을 커밋한다', () => {
    const options = buildKafkaConsumerServerOptions(kafka, { groupId: 'g' });

    expect(options.run).toMatchObject({ autoCommit: true });
  });

  it('커밋을 끄는 입력 자리가 없다', () => {
    // 타입 수준 고정: autoCommit 을 넘기면 컴파일이 깨져야 한다.
    // @ts-expect-error autoCommit 은 KafkaConsumerTuning 에 없다
    buildKafkaConsumerServerOptions(kafka, { groupId: 'g', autoCommit: false });
  });

  it('커밋 오프셋이 없을 때만 최신에서 시작한다 — 처음부터 다시 읽지 않는다', () => {
    const options = buildKafkaConsumerServerOptions(kafka, { groupId: 'g' });

    expect(options.subscribe).toEqual({ fromBeginning: false });
  });

  it('그룹 이름 접미사를 lag 폴러와 같은 상수로 명시한다', () => {
    const options = buildKafkaConsumerServerOptions(kafka, { groupId: 'g' });

    expect(options.postfixId).toBe(KAFKA_CONSUMER_GROUP_POSTFIX);
    expect(options.consumer).toMatchObject({ groupId: 'g', allowAutoTopicCreation: false });
  });

  it('타이밍 기본값을 유지한다', () => {
    const options = buildKafkaConsumerServerOptions(kafka, { groupId: 'g' });

    expect(options.consumer).toMatchObject({
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      maxPollInterval: 300000,
    });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest libs/events/src/transport/kafka-consumer-options.spec.ts`
Expected: FAIL — `Cannot find module './kafka-consumer-options'`

- [ ] **Step 3: 함수를 만든다**

`libs/events/src/transport/kafka-consumer-options.ts`:

```ts
import type { KafkaOptions } from '@nestjs/microservices';
import type { KafkaConfig } from '@packages/event-contracts/types';

/**
 * (events.module.ts 에 있던 주석을 그대로 옮긴다) — `events.module.ts` 가 이 파일을 import 하므로
 * 상수를 여기로 옮겨야 순환이 안 생긴다. `events.module.ts` 는 `export { KAFKA_CONSUMER_GROUP_POSTFIX } from './transport/kafka-consumer-options';`
 * 로 다시 내보내 공개 이름(`index.ts` 의 `export * from './events.module'`)을 유지한다.
 */
export const KAFKA_CONSUMER_GROUP_POSTFIX = '-server';

/** 앱이 고를 수 있는 컨슈머 설정. 커밋 정책은 여기 없다 — 아래 `run` 주석 참조. */
export interface KafkaConsumerTuning {
  groupId: string;
  sessionTimeout?: number; // ms (기본: 30000)
  heartbeatInterval?: number; // ms (기본: 3000)
  maxPollInterval?: number; // ms (기본: 300000)
}

/**
 * `startConsumer` 가 Nest `ServerKafka` 에 넘기는 옵션 (#1073).
 *
 * subscribe.topics 를 만들지 않는다 — `ServerKafka.bindEvents()` 가 등록된 `@On` 패턴으로
 * 어차피 덮어쓴다(`server-kafka.js:92`). 만들어 두면 "이 목록이 구독을 결정한다"는 틀린
 * 모델이 다시 자란다 (ADR-0029 §2).
 */
export function buildKafkaConsumerServerOptions(
  kafka: KafkaConfig,
  consumer: KafkaConsumerTuning,
): NonNullable<KafkaOptions['options']> {
  return {
    postfixId: KAFKA_CONSUMER_GROUP_POSTFIX,
    client: {
      clientId: kafka.clientId,
      brokers: kafka.brokers,
      ssl: kafka.ssl,
      sasl: kafka.sasl,
      retry: kafka.retry,
    },
    consumer: {
      groupId: consumer.groupId,
      sessionTimeout: consumer.sessionTimeout || 30000,
      heartbeatInterval: consumer.heartbeatInterval || 3000,
      maxPollInterval: consumer.maxPollInterval || 300000,
      allowAutoTopicCreation: false,
    },
    // 커밋 오프셋이 없을 때만 쓰인다. 커밋이 켜진 뒤로는 그룹이 처음 생길 때 한 번뿐이다.
    subscribe: { fromBeginning: false },
    // 커밋은 끌 수 없다. `ServerKafka.handleEvent` 가 핸들러 Observable 을 `lastValueFrom` 으로
    // 기다리므로(`server-kafka.js:225-236`) kafkajs 는 `eachMessage` 가 끝난 메시지만 resolve 하고,
    // 배치가 끝날 때마다 그 오프셋을 커밋한다. 핸들러가 던지면 그 메시지는 resolve 되지 않아
    // 재시작 뒤 다시 온다. 꺼져 있던 동안에는 리밸런스마다 최신으로 점프해 메시지를 잃었다.
    run: {
      autoCommit: true,
      autoCommitInterval: 5000,
      autoCommitThreshold: 100,
    },
  };
}
```

`events.module.ts` 에서 `export const KAFKA_CONSUMER_GROUP_POSTFIX = '-server';` 와 그 주석을 지우고, 위 re-export 한 줄과 `import { buildKafkaConsumerServerOptions, KAFKA_CONSUMER_GROUP_POSTFIX, KafkaConsumerTuning } from './transport/kafka-consumer-options';` 를 더한다(lag 폴러가 같은 파일에서 이 상수를 쓴다).

- [ ] **Step 4: `startConsumer` 가 이 함수를 쓰게 한다**

`events.module.ts` `StartConsumerOptions` 에서 `autoCommit?: boolean; // 기본: false` 줄을 지우고, 타이밍 세 필드를 `KafkaConsumerTuning` 상속으로 바꾼다:

```ts
export interface StartConsumerOptions extends KafkaConsumerTuning {
  kafka?: KafkaConfig; // 없으면 환경변수에서 생성

  /** 도출된 토픽의 DLQ 토픽까지 부트스트랩할지 (기본: true) */
  enableAutoDLQ?: boolean;

  /** (기존 strategy 주석 그대로) */
  strategy?: CustomTransportStrategy;
}
```

`startConsumer` 의 `microserviceOptions` 조립부(지금 `:400-430`)를 이것으로 바꾼다:

```ts
    const microserviceOptions:
      | { strategy: CustomTransportStrategy }
      | { transport: Transport.KAFKA; options: unknown } = options.strategy
      ? { strategy: options.strategy }
      : { transport: Transport.KAFKA, options: buildKafkaConsumerServerOptions(kafka, options) };
```

그 위의 `subscribe.topics` 주석 블록은 새 파일로 옮겼으므로 지운다.

- [ ] **Step 5: 통과를 확인한다**

Run: `npx jest libs/events/src/transport/kafka-consumer-options.spec.ts libs/events/src/transport/start-consumer.spec.ts libs/events/src/events.module.spec.ts`
Expected: PASS

Run: `npm run type-check`
Expected: 에러 0 (앱 어디도 `autoCommit` 을 넘기지 않으므로 — `grep -n autoCommit apps/*/src/main.ts` 결과 0 — 깨질 호출부가 없다)

- [ ] **Step 6: 커밋**

```bash
git add libs/events/src/transport/kafka-consumer-options.ts libs/events/src/transport/kafka-consumer-options.spec.ts libs/events/src/events.module.ts
git commit -m "fix(events): 컨슈머가 처리를 마친 오프셋을 커밋한다 — 리밸런스마다 최신으로 점프해 메시지를 잃던 것 (#1073)"
```

---

### Task 2: 실 브로커로 «재시작해도 안 잃는다»를 고정한다

`InMemoryServer` 에는 그룹·오프셋이 없으므로 이 결함은 하네스로 못 본다. 로컬 kafka(`npm run bootstrap:e2e:local` 이 띄우는 :9092)로 한 번 돌려 고정한다.

**Files:**
- Create: `libs/events/src/transport/kafka-commit.integration.spec.ts`

**Interfaces:**
- Consumes: `EventsModule.forApp`, `EventsModule.startConsumer`, `EventsModule.getPublisherToken`, `StreamPublisher.publishEvent({ eventType, aggregateId, payload })` (파티션 키 = `aggregateId`, `stream-publisher.service.ts:263`)

- [ ] **Step 1: 스펙을 쓴다**

```ts
/**
 * 컨슈머 오프셋 커밋 — 실 브로커 (#1073)
 *
 * 커밋이 없던 동안 kafkajs 는 그룹에 다시 들어올 때마다 브로커에 오프셋을 물어, 없으면 최신으로
 * 점프했다. 그래서 컨슈머가 내려가 있던 사이 발행된 메시지는 영영 안 읽혔다(라이브 2026-10-01
 * channel-adapter 재고 이벤트 유실). 이 스펙은 같은 groupId 로 컨슈머를 내렸다 올려 그걸 본다.
 *
 * 세 메시지 모두 같은 aggregateId(= 같은 파티션)로 보낸다. 커밋은 처리한 메시지가 있는 파티션에만
 * 생기므로, 다른 파티션으로 보내면 고친 뒤에도 «아직 한 번도 안 받은 파티션» 구멍에 빠진다.
 *
 * 실행: KAFKA_IT_BROKERS=localhost:9092 npx jest libs/events/src/transport/kafka-commit.integration.spec.ts --runInBand
 */
import { Controller, INestApplication, UseInterceptors } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { CART_STREAM } from '@packages/event-contracts/streams/cart.stream';
import { EventsModule } from '../events.module';
import { EventPayload, On } from '../consumers/decorators';
import { EventTypeGuard } from '../guards/event-type.guard';
import { StreamPublisher } from '../publishers/stream-publisher.service';

const BROKERS = process.env.KAFKA_IT_BROKERS;
const describeIfKafka = BROKERS ? describe : describe.skip;
const kafka = { clientId: 'kafka-commit-it', brokers: (BROKERS ?? '').split(',') };
const TOPIC = CART_STREAM.topic.topic;

const received: string[] = [];

@Controller()
@UseInterceptors(EventTypeGuard)
class CartProbe {
  @On(CART_STREAM, 'CartCreated')
  onCreated(@EventPayload() payload: { id: string }): void {
    received.push(payload.id);
  }
}

async function startConsumerApp(groupId: string): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [EventsModule.forApp({ publishes: [CART_STREAM], serviceName: 'kafka-commit-it', kafka })],
    controllers: [CartProbe],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await EventsModule.startConsumer(app, { groupId, kafka });
  await app.init();
  return app;
}

async function startPublisherApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [EventsModule.forApp({ publishes: [CART_STREAM], serviceName: 'kafka-commit-it-pub', kafka })],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return app;
}

function cart(id: string) {
  return { id, customerId: 'cust-it', regionId: 'region-it', createdAt: new Date().toISOString() };
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return predicate();
}

describeIfKafka('컨슈머 오프셋 커밋 (실 브로커)', () => {
  jest.setTimeout(120_000);

  const run = randomUUID();
  const groupId = `kafka-commit-it-${run}`;
  const aggregateId = `probe-${run}`;
  let publisherApp: INestApplication;
  let publisher: StreamPublisher<typeof CART_STREAM.events>;

  const publish = (id: string) =>
    publisher.publishEvent({ eventType: 'CartCreated', aggregateId, payload: cart(id) });

  beforeAll(async () => {
    publisherApp = await startPublisherApp();
    publisher = publisherApp.get(EventsModule.getPublisherToken(TOPIC));
  });

  afterAll(async () => {
    await publisherApp?.close();
  });

  it('내려가 있던 사이 발행된 메시지를 다시 올라온 컨슈머가 받고, 이미 처리한 것은 다시 받지 않는다', async () => {
    const first = await startConsumerApp(groupId);

    // fromBeginning: false 라 그룹 합류·위치 확정 전에 보낸 건 못 받는다 — 받을 때까지 데운다.
    let warm = 0;
    const warmed = await waitFor(() => {
      if (received.some((id) => id.startsWith(`warm-${run}`))) return true;
      void publish(`warm-${run}-${warm++}`);
      return false;
    }, 60_000);
    expect(warmed).toBe(true);

    await publish(`a-${run}`);
    expect(await waitFor(() => received.includes(`a-${run}`), 30_000)).toBe(true);

    await first.close();
    received.length = 0;

    await publish(`b-${run}`);

    const second = await startConsumerApp(groupId);
    try {
      expect(await waitFor(() => received.includes(`b-${run}`), 60_000)).toBe(true);
      // 커밋된 a 는 다시 오지 않는다. b 를 받았다면 a 는 그보다 앞 오프셋이므로 이미 지나갔다.
      expect(received).not.toContain(`a-${run}`);
    } finally {
      await second.close();
    }
  });
});
```

- [ ] **Step 2: 고치기 전 코드에서 빨간지 확인한다**

`kafka-consumer-options.ts` 의 `autoCommit: true` 를 잠시 `false` 로 바꾸고(커밋하지 않는다):

```bash
npm run bootstrap:e2e:local   # :9092 가 이미 열려 있으면 생략
KAFKA_IT_BROKERS=localhost:9092 npx jest libs/events/src/transport/kafka-commit.integration.spec.ts --runInBand
```

Expected: FAIL — `b-<run>` 을 60초 안에 못 받는다(`expect(false).toBe(true)`). 이것이 라이브 유실의 재현이다.
`git checkout libs/events/src/transport/kafka-consumer-options.ts` 로 되돌린다.

- [ ] **Step 3: 고친 코드에서 초록을 확인한다**

Run: `KAFKA_IT_BROKERS=localhost:9092 npx jest libs/events/src/transport/kafka-commit.integration.spec.ts --runInBand`
Expected: PASS

Run: `npx jest libs/events/src/transport/kafka-commit.integration.spec.ts`
Expected: `skipped` (env 없음 — 기본 게이트에 안 들어온다)

- [ ] **Step 4: 커밋**

```bash
git add libs/events/src/transport/kafka-commit.integration.spec.ts
git commit -m "test(events): 실 브로커에서 재시작 뒤 유실·재처리 없음을 고정 (#1073)"
```

---

### Task 3: 소비 앱이 SIGTERM 때 커밋하고 그룹을 떠나게 한다

커밋만 켜도 유실은 멈춘다. 하지만 지금 7개 앱은 SIGTERM 을 받아도 28초 동안 소비를 계속하다 SIGKILL 당하고, 그 뒤 `sessionTimeout` 30초가 지나야 파티션이 넘어간다. 그 사이 처리하던 메시지는 커밋되지 않아 다시 오고(중복), 파티션은 약 1분 멈춘다. `enableShutdownHooks()` 가 있으면 Nest `close()` → `ServerKafka.close()` → `consumer.disconnect()` 가 진행 중 배치를 끝내고 커밋한 뒤 그룹을 떠난다.

**Files:**
- Create: `libs/events/src/transport/start-consumer-shutdown-hooks.spec.ts`
- Modify: `apps/analytics/src/main.ts`, `apps/channel-adapter/src/main.ts`, `apps/membership/src/main.ts`, `apps/notification/src/main.ts`, `apps/search/src/main.ts`, `apps/ugc-service/src/main.ts`, `apps/wallet/src/main.ts`

- [ ] **Step 1: 가드 스펙을 쓴다**

```ts
/**
 * 컨슈머를 띄우는 앱은 종료 훅을 켠다 (#1073)
 *
 * 훅이 없으면 SIGTERM 뒤에도 컨슈머가 소비를 계속하다 SIGKILL 당한다 — 처리 중이던 메시지는
 * 커밋되지 못해 다시 오고, 그룹은 sessionTimeout(30s) 이 지나야 파티션을 넘긴다.
 * 훅이 있으면 Nest close() 가 consumer.disconnect() 로 커밋하고 그룹을 떠난다.
 */
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const APPS_DIR = join(__dirname, '../../../../apps');

function consumerMains(): string[] {
  return readdirSync(APPS_DIR)
    .map((app) => join(APPS_DIR, app, 'src/main.ts'))
    .filter((file) => existsSync(file) && readFileSync(file, 'utf8').includes('EventsModule.startConsumer(app'));
}

describe('startConsumer 를 부르는 앱의 종료 훅', () => {
  it('소비 앱이 하나 이상 있다 — 경로가 틀려 0개를 검사하는 일을 막는다', () => {
    expect(consumerMains().length).toBeGreaterThan(0);
  });

  it.each(consumerMains())('%s 가 app.enableShutdownHooks() 를 부른다', (file) => {
    expect(readFileSync(file, 'utf8')).toMatch(/app\.enableShutdownHooks\(\)/);
  });
});
```

`APPS_DIR` 상대 경로는 `libs/events/src/transport/` 기준 4단계 위가 저장소 루트다. 워크트리(`.claude/worktrees/…`)에서도 같은 상대 위치라 안전하다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest libs/events/src/transport/start-consumer-shutdown-hooks.spec.ts`
Expected: FAIL — core·ai 를 뺀 7개 앱 행이 빨갛다.

- [ ] **Step 3: 7개 `main.ts` 에 훅을 더한다**

각 파일에서 `NestFactory.create(…)` 로 `app` 을 만든 바로 다음 줄에 넣는다(core 의 `apps/core/src/main.ts:62` 와 같은 자리):

```ts
  // SIGTERM 때 Nest close() 가 컨슈머를 커밋하고 그룹에서 빼낸다 (#1073)
  app.enableShutdownHooks();
```

넣기 전에 그 앱이 이미 `process.on('SIGTERM'…)` 을 직접 다는지 본다: `grep -n "SIGTERM" apps/<app>/src/main.ts`. 지금은 `libs/shared/src/observability/telemetry.ts:86` 하나뿐이고 그건 OTel 종료만 하므로 충돌하지 않는다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest libs/events/src/transport/start-consumer-shutdown-hooks.spec.ts`
Expected: PASS (9행)

Run: `npm run type-check && npx jest`
Expected: 에러 0, 실패 0

- [ ] **Step 5: 로컬에서 종료가 깨끗한지 본다**

```bash
npm run start:all:local
# 다른 터미널에서 notification 프로세스에 SIGTERM
kill -TERM $(pgrep -f "dist/apps/notification/main" | head -1)
```

Expected: notification 로그에 kafkajs `Stopped` / `Consumer has left the group` 류 INFO 가 남고 프로세스가 수 초 안에 끝난다. 남은 컨슈머 쪽 로그에 즉시 `rebalancing` 이 찍힌다(30초 기다리지 않음).

- [ ] **Step 6: 커밋**

```bash
git add libs/events/src/transport/start-consumer-shutdown-hooks.spec.ts apps/*/src/main.ts
git commit -m "fix: 소비 앱이 SIGTERM 때 커밋하고 컨슈머 그룹을 떠난다 (#1073)"
```

---

### Task 4: 틀린 서술을 고친다

**Files:**
- Modify: `libs/events/src/transport/handler-failure.spec.ts:1-27`
- Modify: `libs/events/src/interceptors/event-retry.interceptor.ts` (머리 주석, `:44`, `:141` 근처)
- Modify: `docs/adr/0029-events-module-registration-surfaces.md:226-228`
- Modify: `docs/superpowers/specs/2026-10-15-event-failure-exits-design.md:7-9`

- [ ] **Step 1: `handler-failure.spec.ts` 머리 주석의 «운영에서 escape 한 에러» 절을 바꾼다**

지금 글은 기본 `Server.handleEvent` 를 근거로 «구독만 하고 기다리지 않는다 → 에러가 사라진다»고 한다. Kafka 경로에선 틀렸다. 그 절(9~21행)을 이것으로 바꾼다:

```ts
 * ## 운영에서 escape 한 에러가 어떻게 처리되는가 — 이 하네스가 흉내내지 *않는* 부분
 *
 * 기본 `Server.handleEvent`(`server.js:100-118`)는 Observable 을 구독만 하고 기다리지 않지만,
 * Kafka 경로의 `ServerKafka` 는 그 메서드를 덮어써 `lastValueFrom` 으로 **기다린다**
 * (`server-kafka.js:225-236`). 그래서 인터셉터를 탈출한 에러는 kafkajs `eachMessage` 까지 올라가고,
 * kafkajs 는 그 메시지를 resolve 하지 않은 채 재시도하다 컨슈머를 재시작한다. 커밋이 켜진 뒤(#1073)
 * 재시작한 컨슈머는 마지막 커밋 오프셋부터 다시 읽으므로 그 메시지를 다시 받는다. 커밋이 꺼져 있던
 * 동안에는 재시작이 최신으로 점프해 그 메시지와 뒤 메시지를 건너뛰었다.
 *
 * `InMemoryServer` 도 `lastValueFrom` 으로 기다리므로 에러가 `broker.deliveryFailures` 에 남는다 —
 * 그 배열이 «에러가 파이프라인을 탈출했다»의 관찰 창구다.
```

22~26행(«따라서 아래 두 describe 가 증명하는 것») 중 «= offset commit» 은 이제 참이므로 그대로 둔다.

- [ ] **Step 2: `event-retry.interceptor.ts` 주석에 근거를 붙인다**

머리 주석 «3. 최종 실패 → DLQ 전송 후 에러 삼킴 (offset commit)» 다음 줄에 추가:

```ts
 *    커밋은 `buildKafkaConsumerServerOptions` 의 `autoCommit: true` 가 한다 — #1073 전까지는 꺼져 있어
 *    이 문장이 거짓이었다(리밸런스마다 최신으로 점프).
```

`:44` «(offset 미커밋 → Kafka 재전달이 의도된 의미론)» 과 `:141` «에러 삼킴 → 정상 완료 → offset commit» 은 이제 참이므로 글은 그대로 둔다.

- [ ] **Step 3: ADR-0029 §8 에 정정 노트를 단다**

`docs/adr/0029-events-module-registration-surfaces.md` 228행 문단 바로 뒤에:

```markdown
> **2026-10-15 정정 (#1073).** 위 문단은 기본 `Server.handleEvent` 를 근거로 했다. Kafka 경로의 `ServerKafka` 는 그 메서드를 덮어써 `lastValueFrom` 으로 기다린다(`server-kafka.js:225-236`) — 옛 배선에서도 escape 한 에러는 kafkajs 까지 올라갔다. 한편 표의 «삼킴 → offset commit» 은 그 시점에 거짓이었다: `startConsumer` 가 `autoCommit: false` 로 띄워 커밋이 한 번도 일어나지 않았고(라이브 9개 그룹 전부 커밋 오프셋 없음), 리밸런스마다 최신으로 점프해 메시지를 잃었다. #1073 이 커밋을 고정으로 켰다.
```

- [ ] **Step 4: 이벤트 실패 출구 스펙의 선행 조건 노트를 갱신한다**

`docs/superpowers/specs/2026-10-15-event-failure-exits-design.md` 7~9행을 이것으로 바꾼다:

```markdown
> **선행 조건 — #1073 (2026-10-15 확인).** 세 전제 중 둘은 원래 참이었다: §6.2 «같은 순서 키는 차례로 온다»와 D5 «컨슈머 재시도가 파티션을 막는다» — `ServerKafka.handleEvent` 가 핸들러 완료를 기다린다(이슈 본문의 «기다리지 않는다»는 기본 `Server` 를 본 오독). §6.3 «기록 실패 → 미커밋 → 재전달»만 거짓이었고(커밋 0), #1073 이 커밋을 켜면서 참이 된다. 구현 계획은 #1073 배포 뒤에 쓴다.
```

- [ ] **Step 5: 커밋**

```bash
git add libs/events/src/transport/handler-failure.spec.ts libs/events/src/interceptors/event-retry.interceptor.ts docs/adr/0029-events-module-registration-surfaces.md docs/superpowers/specs/2026-10-15-event-failure-exits-design.md
git commit -m "docs(events): ServerKafka 는 핸들러를 기다린다 — 틀린 서술 정정, 커밋 근거 연결 (#1073)"
```

---

### Task 5: 이슈 본문을 실측으로 고치고 PR 을 연다

- [ ] **Step 1: #1073 본문 «사실 2»를 정정한다**

«사실 2 — 핸들러 완료를 기다리지 않는다» 절 전체를 «사실 2 — (정정) 핸들러 완료는 기다린다»로 바꾸고, 이 계획 «실측 결과» 2·3·4·5·6·7번을 옮겨 적는다. «라이브 조사» 절에는 결과(전 그룹 `-1`, 유실 1건 확정, 오래된 오프셋 없음)를 적는다. 수치(그룹 수 등)는 박지 말고 도출 명령을 적는다. `gh issue edit 1073 --body-file <파일>`.

- [ ] **Step 2: PR 을 연다**

본문에 «배포 절차»로 Task 6 을 그대로 붙인다. 리뷰 포인트로 Review Focus 1~5 를 적는다.

---

### Task 6: 배포와 라이브 판정 (운영자 체크리스트 — 머지 뒤)

마이그레이션 없음. 라이브러리 변경이라 모든 소비 앱이 같은 배포에 실린다 — SST 한 스택에는 앱 간 배포 순서가 없고, 이 변경은 순서가 필요 없다(앱마다 독립적으로 커밋을 시작한다).

- [ ] **배포 직전:** 오래된 커밋 오프셋이 여전히 없는지 한 번 더 본다. `count by (group) (events_consumer_lag >= 0)` 가 빈 결과여야 한다. **결과가 있으면 멈춘다** — 그 그룹은 켜는 순간 그 오프셋부터 재처리한다. 그 경우 그룹을 비운 상태(해당 서비스 desired 0)에서 `docker exec redpanda rpk group seek <group> --to end` 로 맞춘 뒤 진행한다(SSM 은 사람이 `!` 로 실행).
- [ ] **배포 직전:** Redpanda 오프셋 보존 설정을 기록한다: `docker exec redpanda rpk cluster config get group_offset_retention_sec`. 이미지가 `redpandadata/redpanda:latest` 라 버전이 고정돼 있지 않다 — 보존이 «빈 그룹에만 적용»인지(활성 그룹 오프셋이 만료되지 않는지) 버전 문서로 확인해 PR 에 남긴다.
- [ ] **배포 직후 (~10분):** `count by (group) (events_consumer_lag >= 0)` 에 트래픽 있는 그룹부터 나타나기 시작해야 한다. `-1` 시리즈 수(`count(events_consumer_lag == -1)`)가 시간이 지나며 줄어야 한다 — 남는 `-1` 은 켠 뒤 메시지를 한 건도 안 받은 파티션이다(Review Focus 1).
- [ ] **배포 직후:** `max by (group) (events_consumer_lag)` 가 0 근처로 머무는지. 계속 오르는 그룹은 Review Focus 3(DLQ 발행 실패로 파티션 정지) 후보 — 그 앱 로그에서 `DlqDeliveryError`·`Crash` 를 찾는다.
- [ ] **배포 로그:** ServicesBundleA/B 로그에서 SIGTERM 뒤 `graceful timeout reached; forcing SIGKILL` 이 **안** 남는지, `rebalancing` 이 SIGTERM 직후(30초 뒤가 아니라) 찍히는지.
- [ ] **다음 배포 때 유실 판정:** 그 배포의 SIGTERM~리밸런스 창에 발행된 send 트레이스를 Tempo 로 뽑고, 구독자 span 이 없는 건은 **stdout 로그에서 trace_id 로 처리 여부를 교차확인**한다(실측 결과 5 — span 누락은 유실이 아닐 수 있다). 0건이면 #1073 을 닫는다.
- [ ] **닫을 때:** #1016 7·8번 계획 작성을 재개할 수 있다고 그 이슈/메모에 남긴다.

#### 🔴 롤백 절차 — 이 배포 뒤로 코드를 되돌릴 때 (PR 본문에도 그대로 싣는다)

커밋을 켠 버전이 한 번이라도 돈 뒤 커밋을 안 하는 옛 코드로 되돌리면, 커밋 오프셋이 **롤백 시점에서 얼어붙는다.** 옛 코드는 리밸런스·재시작마다 그 얼어붙은 오프셋부터 다시 읽으므로, 롤백이 길어질수록 매 재시작이 «롤백 이후 전부»를 재처리한다(notification 은 Task 0 키로 막히지만, 그것도 롤백 대상이면 중복 발송).

- 롤백 배포와 **같은 작업 창에서** 그룹 오프셋을 지운다. 그룹이 비어 있어야 하므로(해당 서비스 desired 0 또는 배포 사이) SSM 으로 사람이 실행: `docker exec redpanda rpk group delete <group>` (그룹 목록: `docker exec redpanda rpk group list`, 이름은 `<groupId>-server`). 지운 그룹은 다음 합류 때 최신부터 시작한다 — 오늘과 같은 상태.
- 판정: 롤백 뒤 `count(events_consumer_lag >= 0)` 가 0 으로 돌아가야 한다.
- Task 1 이 `autoCommit` 옵션을 없앴으므로, 앞으로 «설정으로 커밋 끄기»라는 같은 함정은 코드로는 안 생긴다. 생기는 길은 이 롤백뿐이다.

---

## Task 0 부록 — 소비자 멱등성 감사 (2026-10-15)

107개 `@On` 핸들러. `@app/events` 에는 소비 측 공용 중복 제거가 없어서, 안전은 핸들러 코드에만 달려 있다. 재감사 도출: `grep -rn "@On(" apps/*/src --include=*.ts | grep -v '\.spec\.'`.

| 앱 | 판정 | 근거 |
|---|---|---|
| ai | 안전(자연) | soft-delete 가 `deleted_at IS NULL` 행만 건드린다 |
| analytics | 안전 | 주문·멤버십은 `fact_*_events.messageId` ON CONFLICT, 상품 dim 은 upsert |
| channel-adapter | 안전 | `processed_events`·inbox 유니크 키, 나머지는 Medusa 덮어쓰기·이미 처리 스킵 |
| core | 안전 | `order_events.event_id` 유니크(`checkAndRecordEvent`), `OrderCreated` 는 (채널, 외부주문번호) 조회 |
| membership | 안전 | `billing_events` ON CONFLICT, 상태 필터 |
| search | 안전(자연) | 인덱스 덮어쓰기·삭제 |
| ugc-service | 안전(자연) | `revoked_at IS NULL`·상태 필터 |
| wallet | 안전 | `point_events`·`payment_intents`·`invoices` 유니크 키 |
| **notification** | **27개 무방비** | 키 없는 `send` — Task 0 |

notification 무방비 중 고객 영향 큰 순: 무통장 입금 안내(`wallet-event.consumer.ts` `payment.intent.awaiting_deposit`) → 환불 완료·결제 승인/실패 → 주문 접수·발송(송장번호)·클레임 → 멤버십 가입/해지/갱신 안내 → CMS 승인/거절·세금계산서 → 인증코드·가입·탈퇴·Q&A 답변.

참고(이 계획 밖, 기존 위험): channel-adapter `pim-category`·`membership-event` 컨슈머는 dedupe 기록과 처리가 한 트랜잭션이 아니라 crash 때 «유실» 쪽으로 기운다. membership `payment.intent.captured` 체크아웃은 intentId 키가 아니라, 구독이 그 사이 void 되면 재전달이 새 구독을 만들 수 있다(경계 사례).
