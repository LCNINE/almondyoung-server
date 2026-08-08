# `@app/events` 등록 표면 — 소비 집합은 선언하지 않고 도출한다

## Status

Proposed (2026-08-09). `@app/events` 등록 방식을 규정하는 첫 ADR. 기존 ADR 을 대체하지 않는다.

## Context

2026-08-08 아키텍처 리뷰가 channel-adapter 의 배선 비대칭을 발견했다 — `adapter.module.ts` 의 `EventsModule.forRoot({streams})` 에는 스트림이 11개인데 `main.ts` 의 `EventsModule.forConsumer({streams})` 에는 6개뿐이고, `PAYMENT_STREAM`·`USER_STREAM`·`CORE_ORDER_STREAM` 이 빠져 있다. 리뷰는 이를 근거로 **21개 `@OnEvent` 핸들러가 영원히 구독되지 않으며 Medusa 결제 Projection 에 살아있는 producer 가 없다**고 결론지었다.

**그 결론은 틀렸다.** 이 ADR 이 존재하는 첫 번째 이유가 이것이다 — 같은 오판이 재발할 조건이 코드에 그대로 남아 있다.

```js
// node_modules/@nestjs/microservices/server/server-kafka.js:92  (v11.1.17)
async bindEvents(consumer) {
  const registeredPatterns = [...this.messageHandlers.keys()];
  const consumerSubscribeOptions = this.options.subscribe || {};
  if (registeredPatterns.length > 0) {        // ← 0개면 subscribe 자체를 건너뛴다
    await this.consumer.subscribe({
      ...consumerSubscribeOptions,
      topics: registeredPatterns,             // ← spread 뒤에 오므로 subscribe.topics 를 덮어쓴다
    });
  }
}
```

`@OnEvent(topic, eventType)` 은 `applyDecorators(EventPattern(topic), SetMetadata(EVENT_TYPE_FILTER, eventType))` 이고 (`libs/events/src/consumers/decorators.ts:76`), `EventPattern` 의 패턴이 곧 토픽 문자열이다. 따라서 **실제 구독 집합은 컨테이너 안의 데코레이터가 결정하며, `forConsumer` 에 넘긴 `streams` 는 사용되지 않는다.** 21개 핸들러는 정상 구독돼 있다.

측정된 사실:

- **세 등록 표면이 같은 이름·같은 타입의 `streams` 를 받고 각각 다른 뜻이다.** `forRoot` → 스트림당 `StreamPublisher` provider + 토픽 부트스트랩 (= 발행 능력 선언). `forConsumerModule` → `SchemaValidationInterceptor` 의 `topic → StreamConfig` 조회 맵 + 부트스트랩 (= 검증 능력 선언). `forConsumer` → `subscribe.topics` 를 만들지만 Nest 가 버림 (= 무의미). 어느 표면이 어느 능력을 주는지 타입은 말하지 않는다.
- **틀린 모델이 코드에 체크인돼 있다.** `apps/analytics/src/main.ts:65–75` 의 10줄 주석이 "`forConsumer` 에 없는 스트림은 메시지가 영영 안 온다"고 단언하고 `PRODUCT_STREAM` 을 그 사례로 지목한다. 리뷰가 오판한 직접 원인이다. `apps/search/src/search.module.ts:26` 도 두 표면을 "짝"으로 설명한다.
- **한 토픽의 핸들러는 전부 실행된다.** `server.js:51–56` 이 같은 패턴의 event handler 를 링크드 리스트로 잇고 `listeners-controller.js:87` 이 `handlerRef.next` 를 타고 체인 전체를 호출한다. `EventTypeGuard` 가 `envelope.messageType` 으로 걸러 안 맞으면 `of(undefined)` 로 조용히 버린다. channel-adapter 는 payments 메시지 하나당 17개 핸들러가 실행되고 16개가 no-op 하며, `EventTypeGuard` 가 호출마다 `message.value` 를 `JSON.parse` 한다.
- **outbox 가 5벌이다.** `libs/events/src/outbox/`(자체 `outbox_events` 테이블) · `apps/core/.../fulfillment/outbox/` · `apps/core/.../inventory/shared/outbox/` · `apps/wallet/src/messaging/` · `apps/channel-adapter/src/services/outbox-dispatcher.service.ts`. core 의 두 벌은 **import 경로 한 줄만 다르고 나머지가 완전히 동일**하며 같은 `wmsTables.outboxEvents` 를 쓴다. 그리고 core 판본의 `enqueue` 는 `idempotencyKey`·`partitionKey` 를 받는데 공용 `saveEvent` 는 **둘 다 없다** — 앱들이 공용 모듈을 우회한 게 아니라 공용 모듈이 부족해서 각자 다시 만들었다.
- **outbox 경로에는 스키마 검증이 없다.** `OutboxPublisher.saveEvent` 는 검증 없이 envelope 를 넣고, `OutboxDispatcher.processEvent` 는 `publishRawEnvelope` → `sendMessage` 로 zod 를 우회한다. 직접 발행만 `validateOnPublish` 를 탄다. 즉 **트랜잭션에 묶이는 가장 중요한 이벤트가 검증되지 않는 쪽 경로를 탄다.**
- **깊은 인터페이스를 만들 타입 기계가 이미 있고 아무도 안 쓴다.** `packages/event-contracts/types/stream-builder.ts` 의 `EventKeysOf` · `EventPayloadOf` · `EventMessageTypeOf` 사용처 **각 0건**. 대신 `@OnEvent('users.events.v1', 'UserEmailVerified')` 의 토픽·이벤트명이 생문자열이고 `@EventPayload() payload: UserEmailVerifiedPayload` 의 타입은 손으로 단 주석이다.
- **두 번째 어댑터가 없다.** `libs/events/src` 소스 29 / 스펙 5, 인메모리·페이크 트랜스포트 0개. 발행→소비 왕복을 브로커 없이 테스트할 방법이 없고, 그래서 위의 배선 문제는 **어떤 테스트로도 잡히지 않는다.**

## Decision

### 1. 사실별로 소유자를 하나만 둔다

| 사실 | 소유자 |
|---|---|
| 계약 (스트림·이벤트·payload) | `packages/event-contracts` — 그대로 |
| 이 프로세스가 **발행**하는 것 | 선언 (`publishes`) — 코드에서 도출 불가하므로 선언이 필요하다 |
| 이 프로세스가 **소비**하는 것 | **데코레이터** — 이미 authoritative 하므로 선언하지 않는다 |
| 전송 설정 (groupId·브로커·튜닝) | 선언 |
| 정책 (검증·DLQ·retry) | 선언 |

**원칙: 선언은 코드에서 도출할 수 없는 사실에만 둔다.** 도출 가능한 사실을 선언으로 받으면 두 벌이 생기고, 두 벌은 어긋나고, 어긋남이 무증상이면 그 자리에 틀린 주석이 자란다.

### 2. `forConsumer` 의 `streams` 를 제거한다

인자를 deprecated 로 표시하고 무시한 뒤 제거한다. `forConsumer` 가 실제로 기여하는 것은 `groupId`·브로커 설정·`sessionTimeout`·`autoCommit` 이며 이는 유지한다.

### 3. 표면을 하나로 줄이고 소비 집합은 파생한다

```ts
// app.module.ts — 이 앱이 가진 "능력"만 선언
EventsModule.forApp({
  service: 'channel-adapter',
  kafka: kafkaFromEnv(),
  publishes: [ORDER_STREAM, CHANNEL_ADAPTER_STREAM],
  policy: { validateOnConsume: true },
})

// main.ts — 구독 리스트 인자 없음
await EventsModule.startConsumer(app, { groupId });
```

`startConsumer` 는 컨테이너를 갖고 있으므로 `DiscoveryService` 로 `@On` 메타데이터를 훑어 `(topic, eventType)` 집합을 얻고, 거기서 **구독 토픽 · 검증 스키마 맵 · 토픽 부트스트랩 목록을 전부 파생**한다. 계약 레지스트리에 없는 토픽을 구독하려 하면 부팅을 거부한다.

이를 위해 `packages/event-contracts` 에 `topic → StreamConfig` 레지스트리를 추가한다. `streams/index.ts` 가 이미 전 스트림을 export 하므로 순수 추가이며 위험이 없다.

### 4. 계약을 타입 seam 으로 끌어올린다

이미 존재하는 유틸을 실제 seam 에 연결한다.

```ts
@On(USER_STREAM, 'UserEmailVerified')                                  // 이벤트명은 EventKeysOf 로 좁혀짐
async onVerified(@Payload() payload: EventPayloadOf<typeof USER_STREAM, 'UserEmailVerified'>) {}

@InjectPublisher(ORDER_STREAM) private readonly orders: PublisherFor<typeof ORDER_STREAM>;
```

`@InjectStreamPublisher('orders.events.v1') p: StreamPublisher<OrderEvents>` 의 **문자열과 제네릭 두 사실**이 하나로 줄고, payload 타입이 계약에서 도출되어 손으로 단 주석과 스키마가 어긋날 수 없게 된다.

### 5. 발행 경로를 하나의 인터페이스로 통합한다

```ts
await this.orders.publish('OrderCreated', { aggregateId, payload });        // 즉시
await this.orders.enqueue('OrderCreated', { aggregateId, payload }, tx);    // outbox
```

같은 객체·같은 타입 도출·같은 검증. 다른 것은 배달 방식뿐이다. 공용 outbox 에 `idempotencyKey`·`partitionKey` 를 넣어 앱 자체 판본과 기능 동등하게 만든 뒤 5벌을 회수한다.

**검증은 `enqueue` 시점에, 도메인 트랜잭션 안에서** 수행한다. 잘못된 payload 가 poison row 로 남는 대신 비즈니스 연산을 즉시 실패시킨다. `publishRawEnvelope` 의 zod 우회는 제거한다.

### 6. 토픽당 한 번 파싱하고 타입으로 디스패치한다

envelope 를 최외곽 인터셉터에서 한 번 파싱해 컨텍스트에 싣고, 토픽당 디스패처가 `messageType` 테이블 조회로 핸들러를 고른다. 핸들러 작성 모양은 그대로 두되 N회 파싱과 N−1회 no-op 을 없앤다.

### 7. transport 를 port 로 두고 인메모리 어댑터를 만든다

deep module 이 소유할 것: envelope 구성 · 검증 · `messageId`/`correlationId`/`chainId` 전파 · retry·DLQ 분류. 어댑터가 소유할 것: 전송뿐. 프로덕션 Kafka 와 인메모리, **두 어댑터가 생겨야 이 seam 이 가설이 아니라 실재가 된다** — 어댑터가 하나뿐인 seam 은 간접층일 뿐이다.

**port 는 발행 방향에만 긋는다. 소비 방향은 port 가 아니다** (2026-08-09 결정):

```ts
export interface EventTransport {
  send(topic: string, message: { key: string; value: string; headers?: Record<string, string> }): Promise<void>;
}
```

`subscribe(topics, handler)` 를 같은 port 에 넣지 않는 이유는 **소비 루프를 `libs/events` 가 소유하고 있지 않기 때문**이다. 소비는 각 앱 `main.ts` 의 `app.connectMicroservice()` 가 만든 Nest `ServerKafka` 가 수행하며, `libs/events` 는 설정값만 넘긴다 — 그나마 그 설정값 중 `subscribe.topics` 는 Nest 가 덮어쓴다(이 ADR Context 참조). 따라서 `KafkaTransport.subscribe()` 는 ① Nest 의 컨슈머를 대체하거나(대규모 동작 변경, 이 ADR 의 expand-contract 규율 위반) ② 스텁으로 남는(한 어댑터가 구현 못 하는 메서드 = 거짓 인터페이스) 두 길뿐이고, 둘 다 나쁘다.

대신 **소비 방향의 다형성은 Nest 가 이미 제공하는 확장점에서 얻는다** — `CustomTransportStrategy`. 운영은 Nest 의 `ServerKafka`, 테스트는 `InMemoryServer` 를 `connectMicroservice({ strategy })` 로 붙인다. 두 구현 모두 실재이고, 운영 경로는 한 줄도 바뀌지 않는다.

**인메모리 배달은 반드시 진짜 `KafkaContext` 인스턴스를 만들어야 한다.** 이것이 이 비대칭 설계의 결정적 제약이다:

```ts
// libs/events/src/interceptors/event-retry.interceptor.ts:72
if (!(kafkaContext instanceof KafkaContext)) return next.handle();
```

가짜 context 객체를 넣으면 이 줄에서 빠져나가 **재시도·DLQ 분류가 통째로 건너뛰어진다.** 그러면 "스키마 위반 → DLQ" 테스트는 초록불이 뜨지만 아무것도 증명하지 못한다 — 이 ADR 이 없애려는 실패 모드(무증상 거짓)를 테스트 안에서 재생산하는 꼴이다. `EventTypeGuard`(52곳에서 `@UseInterceptors` 로 부착)와 `SchemaValidationInterceptor` 도 같은 이유로 `KafkaContext` 를 요구한다. `Server` 를 상속한 전략은 이 요구를 자연히 만족하지만, 손으로 만든 페이크 디스패처는 만족하지 못한다.

**Kafka 로 나가는 모든 경로가 이 port 를 지난다.** `StreamPublisher.sendMessage` · `OutboxDispatcher`(publisher 경유) · `DLQHandler.sendToDLQ`. 특히 `DLQHandler` 는 `@Inject('KAFKA_CLIENT')` 로 `ClientKafka` 를 직접 잡고 있었으므로 함께 이관한다 — 그러지 않으면 DLQ 적재를 관찰할 방법이 port 밖에 따로 생겨 "모든 발행은 port 를 지난다" 가 거짓이 된다. `GracefulShutdownService` 는 전송이 아니라 연결 종료가 관심사이므로 `KAFKA_CLIENT` 를 계속 쓴다.

### 8. 소비 측 전역 인터셉터는 `APP_INTERCEPTOR` 가 아니라 마이크로서비스 스코프로 붙인다

**(2026-08-09 실측으로 추가된 결정. 이 ADR 이 고치려는 실패 모드의 세 번째 실례다.)**

`EventRetryInterceptor`(재시도·DLQ·offset commit) · `SchemaValidationInterceptor` · `ChainContextInterceptor` 는 `forRoot`/`forConsumerModule` 에서 `APP_INTERCEPTOR` 로 등록된다. `event-retry.interceptor.ts` 의 주석은 "전역(APP_INTERCEPTOR) 등록 전제"라고 못박고 있다. **그 전제가 현재 7개 소비 앱 전부에서 성립하지 않는다.**

```js
// node_modules/@nestjs/core/nest-application.js:125–131  (v11.1.17)
connectMicroservice(microserviceOptions, hybridAppOptions = {}) {
  const { inheritAppConfig } = hybridAppOptions;
  const applicationConfig = inheritAppConfig
    ? this.config
    : new ApplicationConfig();          // ← 기본값: 전역 enhancer 가 하나도 없는 새 config
  const instance = new NestMicroservice(this.container, microserviceOptions, this.graphInspector, applicationConfig);
```

7개 앱 모두 `app.connectMicroservice(consumerOptions)` 를 두 번째 인자 없이 부른다(실측). 따라서 Kafka 핸들러는 **빈 `ApplicationConfig`** 위에서 바인딩되고, `APP_INTERCEPTOR` 로 모은 전역 인터셉터 목록은 소비 경로에 **적용되지 않는다**. 컨트롤러 레벨 `@UseInterceptors(EventTypeGuard)`(52곳)는 메타데이터에서 해석되므로 영향이 없다 — 그래서 필터링은 동작하고 검증·재시도·DLQ 만 조용히 죽어 있었다.

인메모리 하네스로 확인한 결과 (`libs/events/src/transport/start-consumer.spec.ts`):

| 배선 | 스키마 위반 메시지 | DLQ | `onModuleInit` 호출 |
|---|---|---|---|
| `connectMicroservice(opts)` — **현재 7개 앱** | **핸들러까지 도달** | 0건 | 1회 |
| `connectMicroservice(opts, { inheritAppConfig: true })` | 차단 | 1건 | 1회 |
| `connectMicroservice(opts, { deferInitialization: true })` + `useGlobalInterceptors` | 차단 | 1건 | **2회** ⚠️ |
| 위 + `registerListeners()` + `setIsInitialized/setIsInitHookCalled` | 차단 | 1건 | 1회 |

`inheritAppConfig: true` 는 기각한다. HTTP 앱의 전역 파이프·필터·**가드**까지 통째로 RPC 핸들러에 얹히며, 앱마다 그 목록이 다르다 — 이벤트 소비가 각 앱의 HTTP 인증 가드를 통과해야 하는 상태가 된다.

`deferInitialization: true` 단독도 기각한다. 초기화가 미뤄진 마이크로서비스는 `listen()` 에서 `registerModules()` 를 부르고, 그 안에서 `callInitHook()`/`callBootstrapHook()` 이 **컨테이너 전체에 대해 다시** 실행된다(`nest-microservice.js:66–79`). 위 표의 `onModuleInit` 2회가 그것이다.

**따라서 `startConsumer` 는 마이크로서비스 자신의 `ApplicationConfig` 에만 이벤트 인터셉터를 얹는다:**

```ts
const microservice = app.connectMicroservice(options, { deferInitialization: true });
microservice.useGlobalInterceptors(retry, schemaValidation, chainContext);  // 등록 순서 = 래핑 순서
microservice.registerListeners();          // 비-defer 경로가 하던 일을 그대로
microservice.setIsInitialized(true);       // 초기화 훅 재실행을 막는다
microservice.setIsInitHookCalled(true);
```

붙는 것은 이벤트 인터셉터 셋뿐이고 앱의 HTTP 설정은 건드리지 않는다. `useGlobalInterceptors` 는 인스턴스를 받으므로 `startConsumer` 가 직접 생성한다 — `SchemaValidationInterceptor` 는 **도출된** 스트림 목록을, 검증 정책(`validateOnConsume` 등)은 앱이 이미 선언한 것을 컨테이너에서 읽어 쓴다. 정책은 도출 불가한 사실이므로 선언이 옳고(§1), 스트림 목록은 도출 가능하므로 선언을 지운다.

**이행 결과: 앱 이주(§Follow-up 5)는 동작 중립이 아니다.** `startConsumer` 로 옮기는 순간 그 앱에서 스키마 검증·재시도·DLQ 가 **처음으로 켜진다.** 지금까지 검증 없이 소비해 온 인바운드 payload 가 스키마를 만족하지 않으면 이주 자체가 DLQ 폭탄이 된다. channel-adapter 에만 붙어 있던 경고가 **7개 앱 전부**로 확대된다.

### 명시적으로 하지 않는 것

- **두 리스트를 부팅 시 대조(reconcile)하는 안은 기각한다.** 어긋남을 시끄럽게 만들 뿐 중복은 그대로 남는다. 중복을 없애는 파생이 우월하다.
- **핸들러 레코드 형태**(`handlers(STREAM, { EventName: async (payload) => … })`)는 payload 완전 추론과 "소비 집합이 값이 됨"이라는 이점이 있으나 클로저에서 Nest DI 생성자 주입을 잃고 8개 앱을 한 번에 고쳐야 한다. 지금은 채택하지 않되 4번의 데코레이터 설계가 이를 막지 않도록 둔다.
- **계약 패키지 구조**(`stream()`/`event()` 빌더, zod 병치, 프레임워크 독립성)는 바꾸지 않는다. 좋은 상태다.
- **outbox 패턴 자체 · DLQ · retry interceptor** 는 유지한다. 문제는 개념이 아니라 seam 위치다.

## Consequences

**실패 모드의 소리 크기가 재정렬된다.** 현재 상태:

| 실수 | 지금 | 이후 |
|---|---|---|
| 컨트롤러를 `controllers: []` 에 미등록 | **완전 무증상** | 부팅 거부 (선언된 능력과 불일치) |
| `forConsumer` 에 스트림 누락 | **아무 일도 안 일어남** | 인자가 없어짐 |
| `forConsumerModule` 에 스트림 누락 | 메시지마다 warn, 검증 없이 통과 | 파생되므로 불가능 |
| outbox 에 잘못된 payload | 검증 0 → 소비자에서 터지거나 조용히 통과 | enqueue 실패 = 도메인 연산 실패 |
| `forRoot` 에 스트림 누락 + 발행 | DI 실패 / 디스패처 throw | 동일 (이미 시끄럽다) |
| 하이브리드 앱에서 소비 인터셉터 미적용 | **완전 무증상** (검증·재시도·DLQ 가 통째로 죽음) | `startConsumer` 가 마이크로서비스 스코프로 직접 붙인다 (§8) |

**가장 치명적인 실수가 가장 조용하다는 현재의 역전이 해소된다.**

`validateOnConsume` 기본값이 `true` 이므로 (`packages/event-contracts/types/schema-validation.types.ts:55–60`), zod 스키마에 **enum·literal 값을 추가할 때는 소비자를 먼저 배포해야 한다**는 기존 제약은 그대로 유지된다. 현재 해당하는 앱: core · analytics · search. notification·membership·wallet 은 `validateOnConsume: false` 를 명시했고, channel-adapter 는 `forConsumerModule` 을 아예 호출하지 않아 소비 측 검증이 없다 — 이 ADR 이 시행되면 channel-adapter 도 검증 대상이 되므로 **이주 시점에 그 앱의 인바운드 payload 가 스키마를 실제로 만족하는지 먼저 확인해야 한다.**

**이행은 expand-contract 로 한다** — [[0005-drizzle-migration-and-autodeploy]] §5 가 스키마에 요구하는 것과 같은 규율이다. 새 표면을 추가 → 앱을 하나씩 이주 → 마지막에 옛 표면 제거.

한 번에 갈아엎는 rewrite 는 선택지가 아니다. 이 모듈은 **가볍게 쓰이는 유틸이 아니라 plumbing 의 중심**이다 (2026-08-09 실측, spec 제외):

| app | 소비 `@OnEvent` | 직접 발행 | outbox enqueue/save |
|---|---:|---:|---:|
| channel-adapter | 34 | 8 | 10 |
| notification | 22 | — | 1 |
| membership | 11 | 4 | 1 |
| analytics | 11 | — | — |
| core | 4 | 8 | 25 |
| wallet | 4 | — | — |
| search | 3 | — | — |
| user-service | — | 17 | — |
| ugc-service | — | 2 | — |
| **합계** | **89** | **39** | **37** |

7개 앱 · 컨슈머 핸들러 89개 · 발행 호출 76곳 · 부팅 경로 8개. **outbox 가 5벌인 것은 이 모듈이 안 쓰여서가 아니라 공용 판본이 부족해서 초과 수요가 각자 구현으로 샌 결과다** — 무관심의 흔적이 아니라 그 반대다. 동시에 `libs/events/src` 는 소스 29 / 스펙 5, 인메모리 어댑터 0개다. 즉 **무겁게 쓰이면서 저투자 상태**이고, 이것이 재설계의 값어치를 키우는 동시에 rewrite 를 금지하는 같은 하나의 사실이다.

## Follow-ups

1. ~~**`apps/analytics/src/main.ts:65–75` 의 틀린 주석을 즉시 삭제한다.**~~ **완료 (2026-08-09).** 실제 동작을 설명하는 주석으로 교체했다. 검증: `ProductEventsConsumer` 는 `analytics.module.ts:50` 의 `controllers` 에 등록돼 있고 `products.events.v1` 핸들러 6개를 선언하므로 해당 토픽은 정상 구독된다 — 옛 주석의 "have never received a live message" 는 틀렸다. `apps/search/src/search.module.ts:26` 은 **고치지 않았다**: "forConsumerModule 은 provider 만 등록하고 connectMicroservice 를 부르지 않으므로 두 번째 컨슈머를 만들지 않는다"는 사실이며 #510 회귀 방지 근거로 유효하다. 두 표면을 "짝"이라 부른 표현만 느슨할 뿐이다.
2. 계약 레지스트리(`topic → StreamConfig`) 추가 — 순수 추가, 위험 0.
3. ~~**인메모리 transport 어댑터 + 발행→소비 왕복 테스트.**~~ **완료 (2026-08-09).** 하네스가 첫 실행에서 실재 버그를 찾았다: Nest 는 수신 `value` 를 `KafkaParser` 로 JSON 파싱해 넘기는데(즉 **객체**), `schema-validation.interceptor.ts:69` · `event-retry.interceptor.ts:194` · `chain-context.interceptor.ts:26` 이 `String(value)` 관용구로 `"[object Object]"` 를 만들어 `JSON.parse` 가 터졌다. `utils/envelope.util.ts` 의 `parseEnvelope` 로 수정.

   ⚠️ **2026-08-09 정정 (아래 10번의 발견에 따름).** 당시 이 항목은 "`validateOnConsume: true` 인 core·analytics·search 에서 모든 메시지가 재시도 3회 후 DLQ 전송마저 실패 → offset 미커밋 → **무한 재전달**"이라고 단언했다. **그 결론은 틀렸다.** 그 세 인터셉터는 `APP_INTERCEPTOR` 전역 등록에 의존하는데, 7개 소비 앱 모두 하이브리드 `connectMicroservice` 를 쓰므로 애초에 소비 경로에 붙지 않는다(§8). 즉 파싱 버그의 프로덕션 영향 범위는 **0** 이었다 — 터질 코드가 실행되지 않았기 때문이다. 수정 자체는 유효하고 필요하다: §8 의 배선이 켜지는 순간 그 경로가 살아나며, 그때 이 버그가 없어야 한다. 하네스가 "실재 버그를 찾았다"는 것도 여전히 사실이다. 틀린 것은 **영향 범위 추정**이며, 그 오판의 원인도 같다 — 두 번째 어댑터가 없어 배선을 실행해 본 적이 없었다. **이 ADR 이 "두 번째 어댑터가 없어서 배선 문제가 어떤 테스트로도 안 잡힌다"고 한 주장의 실증 사례다.** 남은 별건: 소비 경로에 CLS 컨텍스트가 열리지 않아(`middleware.mount: false` + RPC 용 ClsGuard 부재) `chainId` 전파가 죽어 있다 — `round-trip.spec.ts` 에 `it.failing` 으로 박아뒀다. 아래 9번.

   착수 당시 근거(보존): 원래 마지막에 두려던 것을 앞으로 당겼다. 발행→소비를 브로커 없이 검증할 방법이 **아예 없어서**(`libs/events/src` 소스 29 / 스펙 5, 페이크 트랜스포트 0) 어댑터가 없으면 이후 모든 단계가 자기 증거를 남기지 못하고, 여러 세션에 걸친 작업에서 다음 작업자는 앞 단계가 무엇을 보장했는지 알 수 없기 때문이다. **검증 도구를 먼저 만들고 나머지를 그 위에 얹는다** — 그 판단은 결과로 정당화됐다.
4. ~~`startConsumer(app)` 도입 + `forConsumer` 의 `streams` deprecated. 앱 수정 없이 동작해야 한다.~~ **완료 (2026-08-09).** 소비 집합은 `@OnEvent` 데코레이터에서 도출되고, 레지스트리에 없는 토픽·핸들러 0개는 부팅을 거부한다. 도출 과정에서 §8 과 아래 10번을 발견했다.
5. `@On` / `@InjectPublisher` 를 기존 데코레이터와 병행 도입, 앱별 이주 (7개 앱 = 7 PR). ⚠️ **§8 에 따라 이주는 동작 중립이 아니다** — 그 앱에서 스키마 검증·재시도·DLQ 가 처음으로 켜진다.
6. 공용 outbox 에 `idempotencyKey`·`partitionKey`·enqueue 시점 검증 추가 후 앱 자체 판본 5벌 회수. **core 의 두 벌은 import 경로만 다른 동일 파일이므로 이 작업과 무관하게 지금 하나로 합칠 수 있다.**
7. 옛 표면(`forRoot`/`forConsumerModule`/`forConsumer`) 제거 — contract phase.
8. channel-adapter 가 `forConsumerModule` 을 호출하지 않는 현재 상태는 이 ADR 이 시행되기 전까지 남는 실재 구멍이다 — 소비 측 zod 검증이 없다. 4번 이전에 단독으로 메울지, 이주에 묶을지 결정한다.
9. **소비 경로 CLS 컨텍스트 부재** (2026-08-09 발견, 미수정).
 `ClsModule.forRoot({ middleware: { mount: false } })` 이고 RPC 경로에 ClsGuard/ClsInterceptor 가 없어 `EventChainService.setChainId` 가 "No CLS context available" 로 던지고, `ChainContextInterceptor` 의 `catch {}` 가 그것을 삼킨다. 결과적으로 **소비 측 `chainId`/`eventId` 전파가 전 앱에서 죽어 있다.** 3번의 파싱 버그와 원인이 다르므로 별도 수정이 필요하다 — 이 워크스트림에 묶을지 독립 처리할지 결정한다. 회귀 감지는 `round-trip.spec.ts` 의 `it.failing` 이 맡는다. (그 인터셉터 자체가 하이브리드 앱에서 붙지 않는다는 §8 이 겹친다 — 두 원인이 독립적으로 존재한다.)
10. 🔴 **라이브 구멍: 7개 소비 앱 전부에서 스키마 검증·재시도·DLQ·chain 인터셉터가 적용되지 않고 있다** (2026-08-09 발견, §8). `startConsumer` 는 이 구멍이 없는 새 배선을 제공하지만, **앱들이 이주하기 전까지 라이브 상태는 그대로다.** 옛 표면(`forConsumer`)에 같은 배선을 소급 적용하는 것은 의도적으로 하지 않았다 — 7개 앱에서 검증·DLQ 가 한 배포에 동시에 켜지며, 지금까지 검증 없이 통과하던 인바운드 payload 가 있다면 그 배포가 DLQ 폭탄이 된다. 대신 앱별 이주(5번)에서 하나씩, 관찰 가능한 단위로 켠다. **이 항목이 닫히는 시점은 마지막 앱이 이주한 때다.**

실행 계획은 [`docs/superpowers/plans/2026-08-09-events-module-registration.md`](../superpowers/plans/2026-08-09-events-module-registration.md).
