# `@app/events` 등록 표면 — 소비 집합은 선언하지 않고 도출한다

## Status

Accepted (2026-08-09). `@app/events` 등록 방식을 규정하는 첫 ADR. 기존 ADR 을 대체하지 않는다.

설계가 코드로 실현되기 시작한 시점에 Accepted 로 올렸다 — 계약 레지스트리(Follow-up 2) · 인메모리 어댑터(3) · `startConsumer` 도출과 소비 인터셉터 배선(4·§8)이 머지됐다. 남은 Follow-up 5~7 은 이 결정의 **이행**이지 재검토가 아니다. 이행 중 설계가 바뀌면 이 문서를 먼저 고친다.

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

**이행 시 위 스케치에서 두 가지가 달라졌다 (2026-08-09, Follow-up 5 전반부).**

- **payload 파라미터 데코레이터는 기존 `@EventPayload()` 를 그대로 쓴다.** 위 예시의 `@Payload()` 는 채택하지 않았다 — `@nestjs/microservices` 가 이미 `Payload` 라는 이름으로 **다른 것**(파싱된 메시지 전체)을 export 하고 있고, `@app/events` 는 `export *` 로 데코레이터를 공개하므로 같은 이름이 import 경로에 따라 다른 뜻을 갖게 된다. 그건 이 ADR 이 없애려는 실패 모드를 이름 공간에서 재생산하는 것이다. 도출되는 것은 데코레이터 이름이 아니라 **타입**이므로(`EventPayloadOf<typeof S, 'K'>`) §4 의 목적은 그대로 달성된다.
- **`EnvelopeOf<S, K>` 를 계약 패키지에 추가했다.** 소비 핸들러 87개 중 75개가 `@EventEnvelope() envelope: DomainEvent<XPayload>` 를 함께 받는다(실측). `DomainEvent<EventPayloadOf<typeof S, 'K'>>` 를 매번 손으로 조합하게 두면 이주 시 옛 손수 타입이 그대로 살아남는다.

**`@On` 은 계약에 없는 이벤트를 소비할 수 없다 — 그래서 이주가 계약의 구멍을 드러낸다 (2026-08-09, Follow-up 5 후반부).**

`@OnEvent('payments.events.v1', 'gateway.refund.succeeded')` 는 생문자열 두 개라 계약과 무관하게 컴파일되고 부팅된다. `@On(PAYMENT_STREAM, 'gateway.refund.succeeded')` 는 `EventKeysOf` 에 없으면 **컴파일 에러**이고, `as any` 로 빠져나가도 데코레이터 평가 시점에 던진다. 즉 이주는 "소비 중인데 계약에 없는 이벤트"를 전수로 노출시킨다.

실제로 노출됐다. 이주 착수 시점에 소비 핸들러 87개 중 **5개가 계약에 없는 이벤트를 구독하고 있었다** — `payment.intent.refund_requested` · `payment.intent.refund_request_rejected` · `gateway.charge.captured` · `gateway.refund.succeeded` (channel-adapter 4 + membership 1). 넷 다 죽은 코드가 아니라 `apps/wallet/src/messaging/gateway-event.builder.ts` 가 실제로 발행하는 라이브 이벤트다. `PAYMENT_STREAM` 이 `payment.intent.*` 8종은 계약화하면서 이 4종을 빠뜨린 것이다.

`deriveConsumerConfig` 는 이것을 잡지 못한다 — **토픽** 단위로만 레지스트리를 확인하기 때문이다(`consumer-discovery.ts`). 토픽은 `payments.events.v1` 로 등록돼 있으므로 통과한다. 이벤트명 단위의 구멍은 `@On` 만이 드러낸다. 이는 §3 의 "레지스트리에 없는 토픽 → 부팅 거부" 가 이벤트명 층위에서도 성립해야 함을 뜻하며, 데코레이터 이주가 그 역할을 대신한다.

**해소는 계약을 채우는 쪽이다** — 소비 중인 이벤트가 계약에 없으면 틀린 것은 소비자가 아니라 계약이다(§1: 계약의 소유자는 `packages/event-contracts`). 다만 **스키마는 관대하게(전 필드 optional + passthrough) 둔다.** `PaymentIntentEventSchema` 가 이미 같은 이유로 그렇게 돼 있다: 계약 등록만으로 소비 검증이 켜지면 그 순간이 라이브 트래픽의 DLQ 폭탄이 된다. 검증을 조이는 결정은 payload 를 실제로 샘플링한 뒤 앱별 이주(Follow-up 5 / 플랜 Task 5-C)에서 내린다. 이 원칙 덕분에 **데코레이터 이주는 계약을 채우면서도 동작 중립을 유지한다.**

**발행 쪽에도 같은 함정이 있고, 같은 방법으로 닫았다 (2026-08-09, Task 6-B).** `@InjectPublisher(S)` 는 `Inject(getPublisherToken(S.topic.topic))` 만 돌려주므로 **파라미터 타입과 아무 관계가 없다.** 따라서 아래는 컴파일된다:

```ts
@InjectPublisher(ORDER_STREAM) p: PublisherFor<typeof PRODUCT_STREAM>
```

런타임에는 orders 토픽 publisher 를 쥔 채 PRODUCT 이벤트를 발행하게 되고, `publishEvent` 의 `validatePayload` 는 `streamConfig.events[eventType]` 를 못 찾으면 **warn 하고 통과시킨다** — 조용히 잘못된 토픽으로 나간다. 데코레이터는 파라미터 타입을 볼 수 없으므로(`Inject()` 의 반환은 `ParameterDecorator` 이고 그 시그니처에 타입이 들어오지 않는다) 타입으로 막을 방법이 없다. 그래서 `scripts/events/publisher-contract-audit.js`(`npm run audit:event-publishers`)가 AST 로 **데코레이터 스트림 ≡ 타입 파라미터 스트림**을 단언한다. 소비 쪽 게이트와 같은 이유로 남는다.

이 게이트는 **주입 표면 자체가 우회되는 것도 함께 막는다** — `@Inject(getPublisherToken(topic))`(토큰 직접 생성) 과 `'STREAM_PUBLISHER_…'`(손으로 적은 토큰 문자열). 둘 다 이주 시점에 실재했다(아래 §4 이행 결과 참조). 7종 검사를 전부 일부러 어긋뜨려 exit 1 을 재현했고, `STREAM_MISMATCH` 는 실제 파일 변이로 기본 스캔 경로에서도 무는 것을 확인했다.

**`@On` 이 핸들러 시그니처를 타입으로 강제하지는 않는다.** 검토했고 기각했다. 파라미터 데코레이터 순서가 앱마다 다르고(envelope-우선 45 · payload-우선 20 · payload-only 12 · envelope-only 10, 실측), 이 레포는 `strictFunctionTypes` 가 꺼져 있어 `TypedPropertyDescriptor` 제약이 반공변으로 걸리지도 않는다. 따라서 `@On(S, 'A')` 와 `@EventPayload() p: EventPayloadOf<typeof S, 'B'>` 가 어긋나는 것은 여전히 컴파일을 통과한다 — 이벤트명 **오타**는 잡히지만 이벤트명 **불일치**는 잡히지 않는다. 이를 닫으려면 "명시적으로 하지 않는 것" 의 핸들러 레코드 형태가 필요하며, 그 판단은 바뀌지 않았다.

### 5. 발행 경로를 하나의 인터페이스로 통합한다

```ts
await this.orders.publishEvent({ eventType: 'OrderCreated', aggregateId, payload });     // 즉시
await this.orders.enqueue({ eventType: 'OrderCreated', aggregateId, payload }, tx);      // outbox
```

같은 객체·같은 타입 도출·같은 검증. 다른 것은 배달 방식뿐이다. 공용 outbox 에 `idempotencyKey`·`partitionKey` 를 넣어 앱 자체 판본과 기능 동등하게 만든 뒤 5벌을 회수한다.

**검증은 `enqueue` 시점에, 도메인 트랜잭션 안에서** 수행한다. 잘못된 payload 가 poison row 로 남는 대신 비즈니스 연산을 즉시 실패시킨다. `publishRawEnvelope` 의 zod 우회는 제거한다.

**이행 완료 (2026-08-09, Task 6-A).** 스케치에서 세 가지가 달라졌고, 하나가 추가됐다.

- **인자 모양은 `publishEvent` 를 그대로 따른다** — 위 스케치의 `enqueue('OrderCreated', {…}, tx)` 가 아니라 `enqueue({ eventType, aggregateId, payload }, tx)` 다. "다른 것은 배달 방식뿐"이라는 §5 의 주장은 두 메서드가 **같은 파라미터 타입**(`PublishEventParams`)을 받을 때만 참이고, 인자 배치를 다르게 두면 그 문장이 문서에서만 참이 된다. envelope 조립·검증은 `buildEventEnvelope` 하나로 합쳐 두 메서드가 공유한다.
- **적재 대상은 port 로 받는다** — `OutboxWriter`(`outbox/outbox-writer.port.ts`). publisher 가 drizzle 을 알면 §7 의 seam 이 무너지고, 스펙이 DB 없이 적재를 관찰할 수 없다. `forRoot({ enableOutbox: true })` 인 앱에서만 주입되며, 켜지 않은 앱에서 `enqueue` 를 부르면 던진다(조용히 삼키는 것보다 낫다).
- **`publishRawEnvelope` 는 이름째 없앴다** — `publishStoredEnvelope` 로 대체하고 검증을 넣었다. 이름을 남기면 "raw = 검증 안 함"이라는 옛 모델이 이름 안에서 계속 산다. 이 문은 `enqueue` 를 지나지 않은 행(이 변경 이전에 적재된 PENDING 행, 테이블에 직접 insert 하는 wallet 판본)에 실제로 문다.
- **`publishCommand` 에도 검증을 넣었다 (스케치에 없던 것).** 이 메서드는 §8 의 "발행 경로 전수 폐쇄" 논증이 **놓친 네 번째 경로**였다 — `publishEvent` 와 `publishRawEnvelope` 만 세었고 커맨드는 세지 않았다. 호출자는 `ugc-service` 1곳(`EarnPointsRequested` → wallet 소비)뿐이라 실해는 없었지만, 그 논증이 "wallet 은 켜도 안전"이라고 판정한 근거에는 구멍이 있었다. 지금은 `sendMessage` 를 부르는 세 메서드가 전부 검증한다.

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

**세 스위치를 분리해서 켠다 (2026-08-09, 배선 이주 시점의 이행 결정).** 위 문단이 뭉뚱그린 "처음으로 켜진다"는 실은 성질이 다른 두 가지다. 배선(재시도·DLQ)은 켜는 편이 이득이고, 검증은 라이브 payload 를 모르는 채 켜면 사고다. 그래서 배선 이주 PR 에서 **검증이 기본값으로 넘어가는 앱은 `validateOnConsume: false` 를 명시**해 둘을 갈랐다 — 검증을 켜는 것은 payload 를 샘플링한 뒤 앱별로 내리는 별도 결정이다. 명시하지 않으면 `DEFAULT_SCHEMA_VALIDATION_OPTIONS` 의 `true` 가 먹어 **선택이 아니라 누락으로** 두 스위치가 같이 켜진다.

**배선 스위치의 before/after 가 실행으로 확정됐다** (`libs/events/src/transport/handler-failure.spec.ts`). 옛 배선에서 핸들러가 throw 하면 무슨 일이 일어나는지가 이 ADR 안에서도 불명확했는데 — 재전달 루프인지 Nest 가 삼키는지 — 답은 **둘 다 아니고 "조용한 소실"** 이었다:

| | 옛 배선 (`connectMicroservice(opts)`) | `startConsumer` |
|---|---|---|
| 핸들러 실행 | 1회 (재시도 없음) | `@RetryPolicy` 대로 |
| DLQ | 0건 | 1건 |
| 에러의 최후 | **아무 데도 안 남는다** | 삼킴 → offset commit |

`Server.handleEvent` 는 핸들러가 Observable 을 돌려주면 `connectable(...).connect()` 로 구독만 하고 기다리지 않으며(`server.js:105–117`), 그 connector 는 구독자 없는 `Subject` 라 에러가 들어와도 보고되지 않는다(rxjs 의 unhandled-error 경로조차 타지 않음 — 실행 확인). `handleEvent` 는 그 사이 정상 resolve 했으므로 offset 은 전진한다. **즉 지금까지 실패한 소비는 로그 한 줄 없이 사라져 왔다.** §8 이 "가장 치명적인 실수가 가장 조용하다"고 한 것의 네 번째 실례이며, 배선 스위치가 위험을 더하는 게 아니라 **없던 탈출구를 만드는 쪽**이라는 근거이기도 하다.

#### 검증 스위치(C)는 샘플링이 아니라 발행 경로를 닫아서 판정한다 (2026-08-09)

세 스위치 중 C 만 남았을 때, 플랜은 그 게이트를 "인바운드 payload 를 스테이징에서 샘플링하거나 5-B 배포 후 로그로 관찰"로 적어 두었다. **그 두 방법은 지금 둘 다 존재하지 않는다** — AWS `dev` stage 는 폐기됐고, 5-B 가 배포되기 전에는 검증 인터셉터 자체가 안 붙어 관찰할 로그가 생기지 않는다. 즉 플랜대로면 5-C 는 배포가 선행돼야 하고, 배포는 5-C 의 결과를 기다린다 — 순환이다.

**샘플링을 발행 경로의 전수 폐쇄로 대체한다.** 논증은 세 걸음이고 전부 이 레포에서 실측된다:

1. Kafka 로 나가는 모든 경로는 `StreamPublisher` 를 지난다 (§7). 프로덕션 코드에서 `kafkajs` 를 직접 잡는 곳은 **0곳**이다(스펙 3개 제외, 실측).
2. `StreamPublisher` 의 발행 진입점은 둘뿐이다. `publishEvent` 는 `validateOnPublish` 로 검증하며 — 이 값을 `false` 로 끄는 곳은 레포에 **하나도 없다** — 게다가 envelope 에 싣는 것이 원본이 아니라 **zod 가 파싱한 결과**다(`stream-publisher.service.ts:123`). 파싱은 멱등이므로 **`publishEvent` 로 나간 payload 는 같은 스키마의 소비 검증을 반드시 통과한다.** 나머지 하나인 `publishRawEnvelope` 는 zod 를 우회한다.
3. 따라서 위험한 것은 `publishRawEnvelope` 가 실어 나를 수 있는 (토픽, 이벤트) 뿐이고, **그 호출자는 레포 전체에 2곳**이다: `libs/events` 공용 outbox dispatcher 와 wallet outbox dispatcher. (core·channel-adapter 의 자체 outbox dispatcher 는 `publishEvent` 를 부르므로 우회가 아니다 — 이 구분이 판정을 크게 바꾼다.)

이 판정은 `scripts/events/consume-validation-readiness.ts` (`npm run audit:consume-validation`) 가 수행한다. 스키마 분류는 zod 내부(`_def`)를 들여다보지 않고 **실행해서**(`safeParse({})`) 한다 — 빈 객체를 통과시키는 관대한 스키마는 켜도 동작이 안 바뀐다.

실측 결과 (2026-08-09):

| 앱 | 이벤트 | SAFE | PROVEN | UNVERIFIED | 판정 |
|---|---:|---:|---:|---:|---|
| **core** | 4 | 0 | **4** | **0** | ✅ 켠다 |
| notification | 22 | 1 | 21 | 0 | (해당 없음 — 명시 `false` 유지) |
| wallet | 4 | 0 | 4 | 0 | (해당 없음) |
| analytics | 10 | 0 | 7 | **3** | ⏸ Task 6 뒤로 |
| search | 3 | 0 | 1 | **2** | ⏸ Task 6 뒤로 |
| channel-adapter | 34 | 11 | 19 | **4** | ⏸ Task 6 뒤로 |
| membership | 10 | 5 | 0 | 5 | (해당 없음) |

**core 를 켠다.** 4개 이벤트가 전부 `orders.events.v1` 이고 그 토픽의 발행자는 셋 다 `publishEvent` 를 지난다(`OrderRefundCreated` 는 발행자가 아예 없다). 우회 경로 2곳 중 어느 것도 이 토픽에 닿지 않는다. core 는 동시에 **DLQ 가 관측되는 유일한 앱**이므로(`dlq.metrics.ts:10`), 증명이 틀렸을 때 알아차릴 수 있는 유일한 앱이기도 하다.

**나머지 3개 앱의 게이트는 관측성이 아니라 Task 6 이다 — 플랜의 순서를 뒤집는다.** 이 앱들을 막는 UNVERIFIED 는 전부 같은 원인의 4개 이벤트다: `MembershipStatusChanged` · `ProductMasterActiveVersionChanged` · `ProductMasterDeleted` · `CategoryChanged`. 넷 다 `OutboxPublisher.saveEvent` 로 적재돼 `publishRawEnvelope` 로 나간다. **Task 6 의 "enqueue 시점 zod 검증"이 정확히 이 구멍을 메우며, 그 순간 넷 다 기계적으로 PROVEN 이 된다.** 즉 5-C 를 먼저 하면 payload 를 추측해야 하고, Task 6 을 먼저 하면 추측할 것이 남지 않는다. 게다가 Task 6 은 실패를 **발행자의 도메인 트랜잭션**에서 드러내므로, 소비자 DLQ 에서 사후에 발견하는 것보다 진단 위치가 낫다.

그래서 **5-C 는 core 에서 끝내고, 나머지 3개 앱은 Task 6 의 후속으로 옮긴다.** 플랜의 "core 밖으로 나가기 전에 DLQ 관측 범위를 넓힐지 결정한다"는 항목은 사라지지 않지만 긴급성이 낮아진다 — Task 6 이후에는 켤 때 증명이 있고, 관측은 증명이 틀렸을 경우의 대비책이 된다.

**관측 결정 — 로그다. Prometheus 를 넓히지 않는다 (2026-08-10).** 플랜이 "core 밖으로 나가기 전에 결정하라"고 남긴 항목의 답이다. 스크레이프를 넓히는 쪽은 이 결정의 범위를 넘는다 — 대상 4개 앱 중 3개는 `/metrics` 컨트롤러가 없고, 넷 다 `ServicesBundleA/B` 의 Fargate 태스크 2개에 supervisor 로 묶여 있어 앱별 타깃을 세우려면 Alloy 설정 · SST env · ALB 노출까지 인프라를 건드려야 한다. 로그 쪽은 배선이 이미 있다: 네 앱 전부 `startTelemetry` → OTLP 로그 → Alloy → Grafana Loki 이고 `service_name` 으로 갈린다(가짜 OTLP 수신기로 실행 확인, 엔드포인트 없는 대조군은 무전송).

**그 결정이 드러낸 것: 진단 로그가 필드를 잃고 있었다.** `logger.error('메시지', { topic, messageId, errors })` 의 두 번째 인자는 nestjs-pino 를 지나며 **통째로 버려진다** — Nest 의 `Logger` 가 context 를 마지막 인자로 덧붙이므로 `Logger.call` 은 마지막을 context 로 쓰고 나머지를 pino 의 보간 인자로 넘기는데, 메시지에 `%s` 가 없으면 pino 가 출력하지 않는다. 즉 검증을 켜도 "어느 앱의 어느 이벤트가 실패했는가"까지만 보이고 **어느 필드가 왜 틀렸는지는 안 보인다.** `libs/events` 의 그 모양 23곳을 `{ msg, ...필드 }` 로 옮겼고, 옛 모양이 다시 자라지 않게 AST 스펙으로 막았다(`observability/log-shape.spec.ts`). **이 수정은 5-C 앱별 PR 보다 먼저 배포한다** — 안 그러면 켠 뒤 진단이 없다.

**감사가 무엇을 안 지키는지 (2026-08-10).** `publishStoredEnvelope` 의 zod 파싱을 실제로 제거하는 변이를 넣었는데 `audit:consume-validation --gate` 는 초록이었다. 감사는 `VALIDATED_SEND_ENTRYPOINTS` 라는 **이름 목록**과 호출 그래프의 모양을 보지, 그 진입점이 정말 검증하는지는 보지 않는다. 그 가정을 지키는 것은 6-A 가 남긴 `outbox/enqueue-validation.spec.ts` 다(같은 변이로 빨간불 확인). **감사는 모양을, 스펙은 내용을 지킨다** — 이 절의 증명은 둘 다 있어야 선다.

**Task 6-A 이후 이 표는 전부 뒤집혔다 (2026-08-09).** 적재·발행 양쪽 문이 생겨 zod 우회 경로가 0이 되면서 **UNVERIFIED 14건이 0건**이 됐다 — 7개 앱 전부 `켜도 안전` 이다(core 는 이미 켜져 있다).

| 앱 | 이벤트 | SAFE | PROVEN | UNVERIFIED | 판정 |
|---|---:|---:|---:|---:|---|
| **core** | 4 | 0 | 4 | 0 | ✅ 켜짐 |
| analytics | 10 | 0 | 10 | 0 | ☑️ 켜도 안전 |
| channel-adapter | 34 | 11 | 23 | 0 | ☑️ 켜도 안전 |
| membership | 10 | 5 | 5 | 0 | ☑️ 켜도 안전 |
| notification | 22 | 1 | 21 | 0 | ☑️ 켜도 안전 |
| search | 3 | 0 | 3 | 0 | ☑️ 켜도 안전 |
| wallet | 4 | 0 | 4 | 0 | ☑️ 켜도 안전 |

**membership 의 원인은 나머지 셋과 달랐다.** 5-C 가 "같은 4개 이벤트가 세 앱을 막는다"고 정리했을 때 membership 은 논외였는데, 실측하면 그 5건은 `saveEvent` 가 아니라 **wallet 이 자기 outbox 테이블에 직접 insert 하는 행**(`invoice.*` · `mandate.rejected`)에서 왔다. 즉 6-A 의 `enqueue` 문이 아니라 **`publishStoredEnvelope` 문**이 그것을 닫는다. 두 문을 다 달았기 때문에 함께 풀린 것이지, `enqueue` 만 넣었다면 membership 은 그대로 막혀 있었을 것이다.

**증명의 모양이 바뀌었으므로 게이트도 바뀌었다.** 옛 게이트는 "우회 경로 2곳이 무엇을 실어 나를 수 있는가"를 계산했다. 이제 우회가 없으므로 게이트가 지키는 것은 **우회가 다시 생기지 않는 것**이다 — `transport.send` 호출 지점 집합, `StreamPublisher.sendMessage` 를 부르는 메서드 집합, `validateOnPublish: false` 의 부재, `publishRawEnvelope` 의 부재. 넷 다 AST 로 세며, 앞의 둘은 손으로 유지하는 목록과 대조한다. 실제로 무는 것은 확인했다(새 `sendMessage` 호출자를 심어 exit 1, `validateOnPublish: false` 를 심어 exit 1).

**`DLQHandler.reprocessDLQ` 는 명시적으로 면제한다.** 이 관리자 수동 경로는 DLQ 메시지를 원본 토픽으로 되돌려 보내며 `StreamPublisher` 를 지나지 않는다. 면제 근거는 "그 토픽에 이미 있던 메시지만 다시 보낸다 — 새 모양을 만들지 않는다"이며, 이는 이 증명이 원래부터 덮지 못한다고 선언한 "토픽에 남아 있는 옛 메시지"와 같은 한계다. 면제를 목록에 적어 두었으므로 조용히 늘어날 수 없다.

**계약의 구멍이 하나 드러났고 고쳤다 — `CategoryChanged.ancestors`.** payload 인터페이스에는 처음부터 있었는데 zod 스키마에만 빠져 있었다. 검증이 발행 경로에 없던 동안은 무증상이었지만, 적재 시점 검증이 켜지면 zod 가 미선언 키를 **조용히 떼어낸다**. channel-adapter 의 Medusa 카테고리 동기화가 `ancestors` 로 부모를 먼저 보장하므로(`pim-medusa-sync.service.ts:662`), 그 손실은 자식 카테고리를 최상위로 붙이는 버그가 됐을 것이다. 스키마에 optional 로 추가했다(additive — 옛 producer 를 깨지 않는다). **이것이 이 변경의 실질적 위험이 어디에 있는지 보여준다**: 검증 실패는 시끄럽지만 *strip* 은 조용하다. 그래서 회귀 네트는 "통과하는가"가 아니라 **"손실 없이 통과하는가"**(`parse(payload)` 가 `payload` 와 deep-equal)를 단언한다 — `projection-snapshot.assembler.spec.ts` 와 `categories.service.spec.ts` 에 실 조립 결과로 걸어 두었다.

**이 분석은 일회성 결론이 아니라 상시 불변식이 된다.** `--gate` 는 *검증을 켜 둔 앱*에 UNVERIFIED 이벤트가 생기면 exit 1 한다. core 에 나중에 outbox 발행 이벤트의 핸들러를 추가하면 CI 가 막는다 — 이 워크스트림이 반복해서 만난 "판정이 조용히 낡는" 실패 모드를 그 자리에서 닫는 것이다. 게이트가 실제로 무는 것은 확인했다(search 를 일부러 `true` 로 바꿔 exit 1 재현). 게이트는 자기 자신의 가정도 감시한다 — `publishRawEnvelope` 호출 지점을 AST 로 세어 손으로 유지하는 우회 목록과 어긋나면 실패한다. (첫 실행에서 이 검사가 실제로 걸렸다: grep 판본이 근거 주석 속 함수명을 세 번째 "호출자"로 집계했다. 그래서 AST 로 바꿨다.)

**켜는 비용은 낮다 — 스키마 위반은 재시도하지 않는다.** `EventRetryInterceptor` 가 `SchemaValidationError` 를 `nonRetryableErrors` 에 강제로 넣으므로(`event-retry.interceptor.ts:91`) 위반 메시지는 백오프 없이 즉시 DLQ 로 가고 offset 이 전진한다. 검증을 켜는 것이 파티션을 막는 재시도 폭풍을 부르지 않는다는 뜻이다. 이 사실과 위 2번의 멱등성은 `libs/events/src/transport/consume-validation.spec.ts` 가 실행으로 고정한다 — 재시도 억제는 **대조군**(스키마와 무관한 에러는 같은 `@RetryPolicy` 로 4회 실행됨)과 나란히 두어야 `maxRetries` 설정 탓이 아님이 드러나므로 둘을 함께 넣었다.

### 5-1. outbox 는 `libs/events` 가 스키마까지 소유하고 각 앱 DB 의 `event` 스키마에서 돈다

*(2026-08-09 결정. Task 6-C 착수 전 필요한 결정이라 여기 못박는다.)*

Task 6-C 의 "outbox 5벌 회수" 가 두 가지로 읽혀서 코드가 갈렸다. 결정한다 — **(B) 수렴**이다.

- **(A) 기각 — 서술자 파라미터화.** `libs/events` 가 구현만 소유하고 각 앱이 자기 테이블을 서술자로 선언. 마이그레이션이 0 이지만 한 구현이 N 가지 테이블 모양을 떠받쳐야 하고, 컬럼명·타입 차이가 서술자로 새어 나온다. 이 ADR §1 의 원칙("두 벌은 어긋난다")을 outbox 층에서 그대로 재생산한다.
- **(B) 채택 — `event.outbox_events` 로 수렴.** `libs/events` 가 구현과 스키마를 **둘 다** 소유한다. 각 앱은 **자기 DB 의** `event.outbox_events` 를 쓴다(`pgSchema('event')`). 테이블 모양이 하나이므로 서술자 추상화 자체가 필요 없다.

**이미 절반 깔려 있다.** `event` 스키마는 analytics · channel-adapter · core · membership · file-service · wallet 의 baseline 마이그레이션에 이미 들어 있고, core 의 `merged-schema.ts` 에는 `// Phase 6+: ...EventsModule.outboxSchema,` 가 주석으로 남아 있다 — 원래 설계 의도가 (B) 였다는 흔적이다. core catalog 와 membership 은 이미 `enableOutbox: true` 로 공용 테이블에 적재 중이다.

**행 이관은 없다. 드레인이다.** 앱마다 DB 가 다르므로 테이블을 옮길 일이 없고, outbox 행은 디스패처가 5초 주기로 비우는 휘발성 데이터다. expand 단계에서 새 코드가 `event.outbox_events` 에 쓰기 시작하고, 옛 디스패처는 옛 테이블이 빌 때까지 계속 돌린다. contract 단계에서 옛 테이블과 디스패처를 지운다.

#### 선행 조건 — 공용 판본이 core 판본보다 약하다

5벌이 생긴 이유는 우회가 아니라 **공용이 모자랐기 때문**이고, 그 격차가 지금도 그대로다:

| | 공용 `event.outbox_events` | core 로컬 `outboxEvents` |
|---|---|---|
| 멱등 | 없음 | `idempotencyKey` + **`unique(topic, eventType, idempotencyKey)`** |
| 파티션 키 | 없음 | `partitionKey` |
| 재시도 | `retryCount` (즉시 폴링) | `attempts` + **`nextAttemptAt`** (예약 백오프) |

**core 에서 `idempotencyKey` 를 넘기는 호출이 254곳이다.** 컬럼 추가 없이 호출자를 공용으로 갈아끼우면 그 254곳의 중복 방어가 조용히 사라진다 — 이 ADR 이 내내 다룬 "무증상 소실"의 새 사례를 만드는 것이다.

따라서 6-C 의 순서는 **(1) 공용을 core 와 기능 동등하게 만든다 → (2) 회수한다** 이고, 역순은 금지다. **결정: 공용에 넣는다** (2026-08-09). 안 넣으면 core 회수가 조용한 동작 변경이 된다 — 영구 실패 행이 5초마다 재시도되다 빠르게 FAILED 로 가고, 그 변화가 18개 파일 분량 이벤트에 한꺼번에 적용된다. 공용이 core 보다 약한 채로 회수하는 것은 이 ADR §5-1 의 전제("5벌이 생긴 이유는 공용이 모자라서")를 그대로 재생산하는 것이다. `nextAttemptAt` 은 core 에서 **lease 역할도 겸한다**(`outbox-dispatcher.service.ts:132` — 발행 중 프로세스가 죽으면 만료 후 attempts 증가 없이 재시도). 승격 시 그 성질까지 옮긴다.

~~`nextAttemptAt` 은 컬럼이 아니라 **의미론 차이**임에 주의한다~~ — **정정 (2026-08-09, Task 6-C-1 실측).** 그 문장은 틀렸다. 공용 테이블에는 `next_attempt_at` 컬럼이 **아예 없었다**(`libs/events/src/outbox/outbox.schema.ts` 실측). 의미론 차이인 동시에 컬럼 차이이며, 따라서 승격의 마이그레이션 범위는 2컬럼이 아니라 **3컬럼**이다. 이 오기는 아래 "마이그레이션은 6개 앱 전부에 생긴다" 와 함께 6-C-1 의 실제 크기를 플랜보다 작게 보이게 하고 있었다.

#### 이행 완료 (2026-08-09, Task 6-C-1) — 호출자 변경 0

승격된 것은 컬럼 3개(`idempotency_key` · `partition_key` · `next_attempt_at`) + `unique(topic, event_type, idempotency_key)` + 디스패처의 예약 백오프(`10/30/60/300초`, core 와 같은 표)다. **`OutboxPublisher.write` 는 새 컬럼을 아직 채우지 않는다** — 그래서 이미 공용을 쓰는 두 앱(core catalog · membership)의 라이브 동작이 그대로다. 실제 값이 들어오는 것은 core 호출자를 회수하는 6-C-2 부터다.

**lease 는 성질만 옮기고 인코딩은 옮기지 않았다 — 설계 변경이다.** core 는 `next_attempt_at` 한 컬럼에 "다음 시도 시각"과 "지금 발행 중"을 겹쳐 싣는다. 공용에는 이미 `status='PROCESSING'` + `processing_started_at` 기반 lease 가 **있었고**(스펙도 붙어 있다), 그것이 core 와 같은 성질(만료 후 `retryCount` 증가 없이 재시도)을 이미 제공한다. 즉 빠져 있던 것은 lease 가 아니라 **예약 백오프 하나**였다. 두 인코딩 중 core 쪽을 택하면:

- 롤링 배포 중 **이중 발행 창이 열린다.** 옛 디스패처는 `next_attempt_at` 을 모르고 `status='PENDING'` 만 본다. lease 를 `status` 가 아니라 timestamp 로만 표현하면, 발행 중인 행이 옛 쪽에는 여전히 `PENDING` 으로 보인다. `PROCESSING` 은 두 판본 모두 존중하므로 그 창이 없다.
- 한 컬럼에 두 역할을 겹치는 것은 이 레포에서 이미 버그의 출처였다(양식 생성 비동기 워크스트림의 `lease_until` — 점유와 재시도를 분리한 것이 수정이었다).

그래서 **생명주기는 `status`, 일정은 `next_attempt_at`** 으로 나눠 두었고, ADR §1 의 "한 사실에 소유자 하나" 는 두 사실을 각각 한 곳에 두는 쪽으로 지킨다. 기능 동등성(백오프 · 크래시 시 attempts 미증가 · 증가 지점 단일)은 그대로 성립한다.

**`next_attempt_at` 만 `timestamptz` 다 — 의도적이다.** 이 테이블에서 *DB 가 쓴 값*(`DEFAULT now()`)과 *앱이 쓴 값*(JS `Date`)을 **서로 비교**하는 컬럼은 이것뿐이다. `timestamp`(without tz) 면 앞은 세션 TZ, 뒤는 UTC 로 저장돼 그 차이만큼 백오프가 어긋나고, 세션 TZ 가 UTC 인 환경에서는 무증상이라 더 나쁘다. core 로컬 판본도 `withTimezone: true` 다.

**마이그레이션은 6개 앱 전부에 생긴다 — 2개가 아니다.** 공용 디스패처가 실제로 도는 앱은 `enableOutbox: true` 인 core · membership 둘뿐이지만, `libs/events/src/outbox/outbox.schema.ts` 를 **schema 목록에 물고 있는 `drizzle.config.ts` 는 6개**다(analytics · channel-adapter · core · file-service · membership · wallet, 실측). 한 앱이라도 빠뜨리면 그 앱의 다음 무관한 `db:generate` 가 이 변경을 조용히 그 마이그레이션에 끼워 넣는다. expand phase 이므로 순서는 **`migrate → deploy`** 다([[0005-drizzle-migration-and-autodeploy]] §5 — contract 와 반대다).

**기존 행을 막지 않는다는 가정은 실행으로 확인했다** (Postgres 16.14, 세션 TZ `Asia/Seoul`, 생성된 마이그레이션을 그대로 적용). 같은 `(topic, event_type)` 중복 행 3개가 있는 테이블에 unique 를 걸어도 성공했고, `pg_index.indnullsnotdistinct = f` 이며(= `NULLS DISTINCT`, PG15+ 기본값), 제약이 생긴 뒤에도 NULL 키 중복 삽입이 계속 통과하고, 실제 키가 들어오면 그때 비로소 거부된다. `next_attempt_at` 은 기존 행에 `now()` 로 백필돼 즉시 자격을 얻는다 = 옛 동작 그대로.

**wallet 만 마이그레이션을 만들지 못했다 — 이 작업과 무관한 선행 결함이다.** `drizzle-kit generate` 가 `apps/wallet/drizzle/meta/` 의 **스냅샷 체인 분기**에서 멈춘다(`20260630052942` 와 `20260708064014` 가 같은 `prevId` 를 가리킨다). PR #501 의 rebase 산물이며 HEAD 에 그대로 있다. 게다가 최신 스냅샷에는 `cash_receipts` · `refund_requests` 가 **빠져 있다**(두 테이블의 마이그레이션은 journal 에 있고 적용됐는데도) — 즉 `prevId` 만 고쳐 generate 하면 이미 있는 테이블에 `CREATE TABLE` 을 내는 마이그레이션이 나온다. wallet 은 `enableOutbox` 가 아니라 이 조각에서 그 컬럼을 쓰지 않으므로 **6-C-1 의 정확성에는 영향이 없다.** 다만 **6-C-3 전에 반드시 복구해야 하고**, 그 전까지 wallet 의 스키마 변경 전체가 막혀 있다.

#### core 회수 (2026-08-09, Task 6-C-2) — 설계 결정 5건

6-C-1 은 **컬럼**을 승격했고 인터페이스는 열지 않았다. 6-C-2 가 그 seam 을 열면서 ADR 이 정하지 않았던 다섯 가지를 정했다. 앞의 넷은 실측이 강제했고, 다섯째는 계약 구멍이었다.

**1. `partitionKey` 는 파생을 기본으로 두되 호출자 지정을 허용한다.** 공용 publisher 는 `streamConfig.partitionKey?.(payload) ?? aggregateId` 로 도출하고 core 로컬은 호출자가 넘겨서, 둘 중 하나를 골라야 했다. 파생이 §1 의 원칙이지만 **파생의 단위는 스트림이고 실제 키는 이벤트별로 갈린다**(실측):

| 토픽 | 이벤트 | partitionKey | aggregateId |
|---|---|---|---|
| `inventory.events.v1` | `Stock*` | `skuId` | 재고이벤트 id |
| `inventory.events.v1` | `ProductSellableQuantityChanged` | `variantId` | `variantId` |
| `fulfillments.events.v1` | `Fulfillment*`(FO 완료) | `salesOrderId ?? foId` | `foId` |
| `fulfillments.events.v1` | `ORDER_*` | `orderId` | `orderId` |

`(payload: any) => string` 하나로는 이 갈래를 페이로드 필드 유무로 넘겨짚지 않고서는 표현할 수 없다. 그리고 파생으로 밀어붙이면 재고 이벤트가 `skuId` 가 아니라 재고이벤트 id 로 파티션돼 **SKU 단위 순서 보장이 조용히 사라진다** — 이 ADR 이 내내 다룬 무증상 소실의 새 사례다. 그래서 우선순위를 **호출자 지정 → 스트림 파생 → `aggregateId`** 로 두고, 파생 함수가 있는 두 스트림(`shipments.events.v1` · `fulfillments.events.v2`)은 그대로 파생을 쓴다. 해석은 **적재 시점**에 끝내 행에 싣는다 — 디스패처에서 해석하면 적재와 발행 사이에 파생 함수가 바뀔 때 행이 조용히 다른 파티션으로 간다.

**2. 멱등의 주체는 코드가 아니라 DB 제약이고, 충돌은 던지지 않는다.** `OutboxPublisher.write` 가 `onConflictDoNothing()` 을 붙인다. 던지면 **호출자의 도메인 트랜잭션 전체가 롤백**되므로, 이미 기록된 사실을 다시 적재하려 했다는 이유로 재고 이동이나 출고가 되돌아간다. core 로컬 판본이 회수 전까지 하던 것과 같은 선택이다.

**3. 디스패치 가능한 토픽은 선언이 아니라 파생이다.** publisherMap 은 `enableOutbox` 를 켠 `forRoot` 호출의 `streams` 로 만들어졌는데, 아웃박스는 **앱 하나에 테이블 하나**이고 BC 별 `forRoot` 는 여럿이라 그 선언은 "이 앱이 적재하는 토픽 집합"과 어긋난다. core 가 그렇다 — 아웃박스를 켠 것은 catalog(`PRODUCT_STREAM`) 하나인데 적재하는 토픽은 6개다. 선언을 늘리는 대신 `ModuleRef` 로 `getPublisherToken(topic)` 을 조회한다: 행이 들고 있는 topic 이 곧 조회 키다. §3 이 소비 집합에 적용한 원칙을 발행 쪽에 같이 적용한 것이다. 같은 이유로 `OutboxPublisher` 는 이제 **항상 optional 로** 주입된다 — 모듈이 `@Global()` 이라 어느 한 곳이 켜면 앱 전체 publisher 가 `enqueue` 를 쓸 수 있고, 아무도 켜지 않은 앱에서는 그대로 던진다.

**4. 발행 보류(maintenance)는 port 로 옮긴다 — 이 조각에서 바뀌어도 되는 것은 재시도 의미론뿐이다.** core 로컬 디스패처는 `FULFILLMENT_WORKFLOW_MODE=maintenance` 동안 fulfillment·shipment 계열 행을 **선택하지 않았다**(적재는 계속되고 발행만 멈춘다). 회수하면서 빠뜨리면 정비 중에 이벤트가 나가기 시작한다. `OutboxDispatchGate` port 로 옮겼고, 앱은 **서술자**(보류할 topic / event_type 접두사)만 돌려준다 — drizzle `SQL` 을 돌려주게 하면 앱이 다시 아웃박스 테이블을 알아야 하고, 그게 §5-1 (B) 가 `libs/events` 로 모은 지식이다. 보류는 **선택 단계**에 건다: 고른 뒤 걸러내면 lease 를 잡아 놓고 버려 행이 `PROCESSING` 에 갇힌다.

**5. `ORDER_CREATED` · `ORDER_MODIFIED` 를 `FULFILLMENT_STREAM` 계약에 추가한다 (additive).** 두 이벤트는 `fulfillments.events.v1` 로 **이미 발행되고 있었는데 계약에 없었다** — `validatePayload` 가 "Event type not found in stream config" 를 warn 하고 그대로 통과시키는, 6-A 가 닫은 것과 같은 종류의 우회다. `enqueue<K extends keyof TEvents>` 는 계약에 없는 이름을 컴파일 단계에서 막으므로 회수하려면 계약에 올려야 하고, 올리면 검증도 따라온다. 스키마는 실제로 실려 나가던 모양 그대로(`{ orderId: string }`)다. **소비자는 0곳이다**(실측: `fulfillments.events.v1` 의 `@On` 은 channel-adapter 의 `FulfillmentShipped`/`Delivered`/`Cancelled` 셋뿐) — 즉 이 둘은 발행되지만 아무도 읽지 않는다. 라우팅 재검토는 이 조각의 일이 아니라 별도 결정이다.

**재고 이벤트 3종은 회수 대신 적재를 중단했다 (사람 결정, 2026-08-09).** `StockReceived` · `StockShipped`(비-batch) · `StockAdjusted` 의 payload 는 자기 계약 스키마를 만족한 적이 없다 — `stockEventId` · `inboundType`/`outboundType`/`adjustmentType` · `receivedAt`/`shippedAt`/`adjustedAt` 이 없고, 대신 `afterQuantity` · `journalId` · `occurredAt` 을 실었다. 발행 경로는 zod 를 타므로(`validateOnPublish` 기본 true) 옛 디스패처가 그 행마다 던졌고, 재시도 5회 뒤 `failed` 로 끝났다 — **Kafka 로 나간 적이 없다.** 공용 `enqueue` 는 적재 시점에 검증하므로 그대로 옮기면 `receive`/`ship`/`adjust` 트랜잭션이 터진다. 계약에 맞춰 채우는 대안은 없는 enum 값을 지어내야 하고, 3종이 처음으로 발행되기 시작한다. **소비자가 0곳**이라(이 스트림의 유일한 소비자는 `ProductSellableQuantityChanged`) 적재 중단은 관측 가능한 동작 변화가 없고, 사라지는 것은 매번 쌓이던 poison 행뿐이다. 되살릴 때는 payload 를 맞추는 것이 아니라 **계약을 먼저 정한다.** 배치 출고 경로의 `StockShipped` 는 계약을 만족하므로 그대로 회수했다.

**공용 테이블의 `payload` 컬럼에는 envelope 전체가 실린다 — 옛 core 테이블은 도메인 payload 만 실었다.** 그래서 옛 디스패처는 `publishEvent` 로 envelope 를 다시 조립했고, 공용 디스패처는 `publishStoredEnvelope` 로 그대로 보낸다. 행을 읽어 payload 를 단언하던 스펙들이 이 차이로 깨졌다(회수 중 실제로 4개 suite 가 빨간불이 됐다).

**옛 아웃박스를 읽는 코드가 둘 있었다 — 그중 하나는 이동만으로는 깨진다.** `shipment-delivery-tracking.service.ts` 의 `v1DeliveryTimestamp` 는 `${foId}:fully-shipped` **행의 존재**로 "FO 가 전량 출고됐는가"를 판정한다. 새 코드가 새 테이블만 읽으면, **배포 이전에 출고돼 배포 이후에 배송 완료되는 모든 FO** 가 그 행을 찾지 못해 v1 `FulfillmentDelivered` 를 잃는다 — 롤링 배포의 몇 분짜리 창이 아니라 며칠치 재고(출고→배송 리드타임) 전체다. expand 기간에는 **두 테이블을 모두 읽는다**. 옛 갈래 제거는 6-C-4 몫이다.

**6-C-4 실행 결과 (2026-08-10): 이동만이 아니라 이 판정 자체가 문제였다.** 옛 갈래를 지우려면 드레인만으로 부족하다 — 이 행들은 **큐가 아니라 존재 표지**라서, 미발행 행이 다 빠진 뒤에도 `published` 로 굳은 채 계속 읽힌다. 드레인 완료와 표지 수명은 시계가 다르다. 같은 성질의 읽기가 wallet 에도 둘 있었다(`payment.intent.failed` dedupe · `mandate.rejected` dedupe). 그래서 6-C-4 는 **표지 백필을 선행 단계로 추가**했다(`scripts/events/outbox-marker-backfill.ts`): 세 술어가 찾는 행만 골라 `status='PUBLISHED'` 로 공용 테이블에 옮긴다(그 상태라 공용 디스패처가 재발행하지 않는다). 배포 순서가 **백필 → deploy → migrate(DROP)** 로 한 단계 길어졌다.

**교훈:** "옛 테이블을 비운 뒤 지운다"는 울타리는 그 테이블이 **큐일 때만** 충분하다. 같은 테이블을 존재 판정에 쓰는 읽기가 하나라도 있으면 드레인은 그것을 보호하지 못한다. 회수(6-C-2·3)에서 "옛 아웃박스를 *읽는* 코드"를 셀 때, **읽기의 목적이 소비인지 판정인지**까지 갈라 적어야 한다.

**6. 파티션 순서 보장은 opt-in 으로 공용에 옮긴다 (2026-08-09, 6-C-3).** wallet 로컬 디스패처의 acquire 술어에는 공용에 없는 조건이 하나 더 있었다 — 같은 `partition_key` 의 **더 이른 미발행 행**이 있으면 뒤 행을 고르지 않는다. 없으면 `payment.intent.created` 가 재시도를 도는 동안 `payment.intent.captured` 가 먼저 도착할 수 있고, 파티션 키를 인텐트/구독자로 잡아 둔 이유가 바로 그 순서다. 결정 4 와 같은 논리로 **회수는 재시도 의미론 말고 아무것도 바꾸지 않아야** 하므로 옮긴다.

다만 `OutboxDispatchGate` 와 달리 port 가 아니라 **설정 플래그**(`OutboxConfig.strictPartitionOrdering`, 기본 `false`)다. 게이트는 앱마다 *다른 서술자*를 돌려주는 자리라 port 가 맞지만, 이것은 켜고 끄는 한 비트이고 앱이 돌려줄 지식이 없다. 기본값이 `false` 인 이유는 대가가 있기 때문이다 — head-of-line blocking. 한 행이 재시도를 소진할 때까지 그 파티션이 막히므로, **순서가 필요한 앱이 스스로 고를 성질**이지 공용 기본값이 아니다. 현재 켠 앱은 wallet 하나다.

세 가지를 술어에 못박았고 실 Postgres 스펙이 각각을 고정한다. (1) **`(created_at, id)` 사전식 비교** — `created_at` 만 보면 한 트랜잭션에서 적재된 두 행이 서로를 막아 그 파티션이 **영구 정지**한다. (2) **`PUBLISHED`/`FAILED` 는 막지 않는다** — 최종 실패 행이 뒤를 영원히 막으면 순서 보장이 아니라 가용성 사고다. (3) **`partition_key` 가 NULL 인 행은 서로 막지 않는다** — SQL 의 `=` 가 NULL 을 같다고 하지 않으며, 이 컬럼이 생기기 전 행들이 서로를 막으면 회수 배포 직후 아웃박스가 선다.

이 술어의 상관 서브쿼리를 받을 인덱스(`outbox_partition_created_idx (partition_key, created_at)`)를 공용 스키마에 넣었다 — 없으면 아웃박스가 밀린 순간 스캔량이 `배치 × 백로그` 로 커진다. 즉 **장애 중에 나빠지는 모양**이다. wallet 로컬 테이블에 같은 목적의 인덱스가 있었고, 그것까지가 회수 대상이다. 순서 보장을 켜지 않은 5개 앱에는 쓰이지 않지만 스키마가 한 벌이라 함께 생긴다 — 쓰기 비용은 인덱스 하나분이고, 앱마다 다른 스키마를 두는 쪽이 훨씬 비싸다.

**계약이 실제와 어긋난 것 3건 — 회수가 드러냈다 (2026-08-09, 6-C-3).** 셋 다 `enqueue<K>` 의 타입 도출이 발행 지점에 처음으로 걸리면서 보였다.

1. **`PaymentIntentEventPayload` 의 필수 필드 4개가 거짓이었다.** `userId` · `status` · `payableAmount` · `currency` 를 필수로 적어 뒀지만 `PaymentIntentEventSchema` 는 처음부터 전부 `.optional()` 이었고 — 즉 **런타임 계약은 이미 선택이었다** — 실제로 두 발행 경로가 그 값 없이 내보낸다: 인텐트 **생성 전** 실패(`billing-charge.consumer.ts`, 인텐트가 아직 없다)와 `payment.intent.refund_requested`/`…_request_rejected`(소비자는 intentId 만 읽는다). **인터페이스를 스키마에 맞췄고 발행되는 내용은 바꾸지 않았다** — additive 규칙의 예외가 아니라, 문서가 런타임을 따라간 것이다. 소비 파급은 1곳(notification 무통장 안내)이었고 `userId` 부재 시 발송하지 않는 가드를 넣었다.
2. **`gateway.refund.failed` 는 계약에 없다.** `GatewayEventType` 상수에는 있지만 계약에도 없고 적재하는 곳도 없다. 계열 이름 목록을 `satisfies readonly (keyof typeof PAYMENT_STREAM.events)[]` 로 좁혀 두었더니 컴파일에서 걸렸다.
3. 🔴 **`gateway.charge.*` 는 발행자가 레포 전체에 0곳인데 channel-adapter 가 `gateway.charge.captured` 를 구독한다.** `buildChargeEventPayload` 는 프로덕션 호출자가 없다. 플랜 5-A 가 이 넷을 "wallet 이 실제로 발행하는 라이브 이벤트"로 적고 계약에 올렸는데, `gateway.refund.succeeded` 는 맞고 **`gateway.charge.captured` 는 틀렸다.** 고아 소비자를 지울지 발행을 되살릴지는 계약 결정이라 6-C-3 범위 밖으로 두었다 — **6-C-4 도 판정하지 않았다(2026-08-10): 그 조각은 아웃박스 저장소 삭제에 한정했고, 이것은 계약을 정하는 결정이라 성격이 다르다. Task 7 로 넘긴다.** 여전히 미해결이다.

### 명시적으로 하지 않는 것

- **두 리스트를 부팅 시 대조(reconcile)하는 안은 기각한다.** 어긋남을 시끄럽게 만들 뿐 중복은 그대로 남는다. 중복을 없애는 파생이 우월하다.
- **핸들러 레코드 형태**(`handlers(STREAM, { EventName: async (payload) => … })`)는 payload 완전 추론과 "소비 집합이 값이 됨"이라는 이점이 있으나 클로저에서 Nest DI 생성자 주입을 잃고 8개 앱을 한 번에 고쳐야 한다. 지금은 채택하지 않되 4번의 데코레이터 설계가 이를 막지 않도록 둔다.
- **계약 패키지 구조**(`stream()`/`event()` 빌더, zod 병치, 프레임워크 독립성)는 바꾸지 않는다. 좋은 상태다.
- **outbox 패턴 자체 · DLQ · retry interceptor** 는 유지한다. 문제는 개념이 아니라 seam 위치다.

## Consequences

**실패 모드의 소리 크기가 재정렬된다.** 현재 상태:

| 실수 | 지금 | 이후 |
|---|---|---|
| publisher 주입의 스트림과 타입이 어긋남 | **완전 무증상** (잘못된 토픽으로 발행, `validatePayload` 는 warn 후 통과) | `audit:event-publishers` 가 exit 1 (§4) |
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

   **배선 이주 완료 (2026-08-09).** 7개 앱 `main.ts` 가 전부 `startConsumer(app, { groupId })` 로 옮겨졌다 — `forConsumer` 호출 **0건**, `@OnEvent` 호출 **0건**. 이로써 §8 의 라이브 구멍(재시도·DLQ·chain 미적용)이 **코드상으로는** 닫혔다. 라이브에서 닫히는 시점은 배포다(아래 10번). 검증 스위치는 함께 켜지 않았다 — core·analytics·search·channel-adapter 에 `validateOnConsume: false` 를 명시해 분리했고, 그 한 줄을 뒤집는 것이 남은 작업이다(플랜 Task 5-C).

   부팅 거부(§3)가 이주를 깨지 않는지 전수로 확인했다: 7개 앱의 `(등록된 컨트롤러 → @On → 토픽)` 집합에 핸들러 0개인 앱도, 레지스트리 밖 토픽도 없다. 실측 핸들러는 **87개**(ADR Consequences 표의 89 는 이주 전 `@OnEvent` 기준 수치이며 analytics·membership 이 각 1 많다). `controllers:[]` 에 등록되지 않은 `@On` 핸들러는 0개다. **channel-adapter 의 도출 토픽은 9개** — 옛 `forConsumer` 목록의 6개가 아니며, 빠져 있던 셋이 정확히 이 ADR Context 의 오판 대상(`PAYMENT_STREAM`·`USER_STREAM`·`CORE_ORDER_STREAM`)이다. 도출은 처음부터 옳은 값을 낸다.

   **검증 스위치(C) — core 만 켰다 (2026-08-09).** `apps/core/.../sales-order.module.ts` 가 `validateOnConsume: true`. 근거는 샘플링이 아니라 발행 경로 전수 폐쇄이며 상세는 위 §8 의 "검증 스위치(C)" 절에 있다. **나머지 3개 앱(analytics·search·channel-adapter)은 6번(outbox enqueue 검증) 뒤로 미뤘다** — 막는 원인이 관측성이 아니라 outbox 의 zod 우회라, 6번이 그것을 메우면 추측 없이 켤 수 있다. notification·membership·wallet 은 원래부터 해당 없음이다. 판정과 회귀 방지는 `npm run audit:consume-validation -- --gate` 가 맡는다.

   **검증 스위치(C) 완료 — 5개 앱이 켜져 있다 (2026-08-10).** core 에 이어 **analytics · search · membership · channel-adapter** 를 앱 하나 = PR 하나로 뒤집었다. **notification · wallet 은 켜지 않는다** — 그 `false` 는 이 워크스트림 이전부터의 의도이며(notification 은 `HTTP 요청과 충돌 방지` 주석), Follow-up 7 에서 정책을 `forApp` 으로 옮길 때 **반드시 보존해야 한다.**

   **membership 의 재분류가 위 문장을 바꿨다.** 이 Follow-up 은 membership 을 "원래부터 해당 없음" 으로 적었지만 틀렸다 — `git log -L` 로 보면 그 `false` 는 #501 이 `forConsumerModule` 을 처음 붙이며 같이 들어온 값이고 근거 주석이 없다. 판단의 흔적이 있는 것은 notification·wallet 뿐이다.

   **채택한 형태는 명시 `true` 다** (선언을 걷어내고 기본값에 기대지 않는다). 기본값에 기대면 결정이 소스에서 사라지고, 감사의 `policyAt` 도 실제 줄을 가리키지 못한다. 그리고 이 대칭이 없으면 §8 이 경고한 "선택이 아니라 누락으로 켜짐" 과 구별되지 않는다.

   **channel-adapter 의 정책 선언 모양에 스펙이 없었다.** 이 앱만 `forConsumerModule` 이 아니라 모듈 providers 의 `EVENTS_CONSUMER_POLICY` 로 선언하는데(그 표면이 `streams` 를 필수로 받기 때문 — §1 이 지우는 중인 두 번째 진실), 그 경로는 어느 스펙도 덮지 않았다. 배선이 끊기면 `optionalGet` 이 기본값 `true` 로 떨어져 **검증을 켠 뒤에는 원하던 값과 같아지므로 증상이 없다.** `consumers/consumer-policy-wiring.spec.ts` 가 `false` 대조군과 함께 고정한다 — provider 를 실제로 읽었음을 증명하는 것은 그 대조군뿐이다.

   **앱별 데코레이터 이주 완료 (2026-08-09).** 7개 앱 · 소비 핸들러 **87개 전량**이 `@On` + `EventPayloadOf`/`EnvelopeOf` 로 옮겨졌고 `@OnEvent` 호출은 0건이다. `main.ts` 는 손대지 않았으므로 **이 단계는 동작 중립**이다 — §8 의 라이브 구멍은 배선 이주(플랜 Task 5-B) 전까지 그대로 남는다. 이주 중 계약의 구멍 두 종류가 드러났다(위 §4 의 "`@On` 은 계약에 없는 이벤트를 소비할 수 없다" 참조). 회귀 방지는 `scripts/events/event-handler-contract-audit.js` (`npm run audit:event-handlers`) 가 맡는다 — `@On` 의 이벤트 키와 payload/envelope 도출 키의 불일치는 타입이 끝내 잡지 못하므로, 이 게이트는 이주 종료 후에도 남긴다.

   **발행 쪽 이주 완료 (2026-08-09, Task 6-B).** `@InjectStreamPublisher` 사용처 **0건**이고 주입 지점 **22곳 전부**가 `@InjectPublisher(STREAM)` + `PublisherFor<typeof STREAM>` 이다. 이 단계는 **동작 중립**이다 — 두 표면이 같은 토큰을 만든다. 실측이 플랜과 세 군데 어긋났다:

   - **21곳이 아니라 22곳.** wallet outbox dispatcher 가 `@Inject(EventsModule.getPublisherToken(PAYMENT_EVENTS_TOPIC))` 로 토큰을 직접 만들어 주입하고 있었고, 타입은 제네릭 없는 `StreamPublisher` 였다 — 스트림과의 연결이 **아예 없어** 옛 표면보다 나빴다. `@InjectStreamPublisher` 를 세는 어떤 grep 에도 안 잡힌다. 게이트의 `RAW_TOKEN` 검사가 여기서 나왔다.
   - **토큰 문자열이 손으로 5벌.** `adapter.module.ts` 의 로컬용 `NullEventPublisher` fallback provider 들이 `'STREAM_PUBLISHER_orders.events.v1'` 식 리터럴이었다 — 형식의 소유자를 `publisher-token.ts` 한 곳으로 모은 뒤에도 살아남은 사본이다. 계약 상수에서 도출하도록 바꿨고 `HARDCODED_TOKEN` 검사가 재발을 막는다.
   - **`order-event.publisher.legacy.ts` 는 죽어 있었다 — 삭제했다.** 어느 모듈의 providers 에도 없고 참조는 자기 spec 과 형제 파일의 `@see` 뿐이었다. 게다가 산 판본과 **동작이 이미 갈라져 있었다**(`customerId` 에 구매자 이름을 넣는다 vs 산 판본은 `null`) — 죽은 코드가 옛 동작의 예제로 남는 전형적인 모양이다.

   **`@InjectStreamPublisher` 자체는 남겨 `@deprecated` 만 달았다** — 삭제는 Follow-up 7(contract phase)이다. 사용처가 0이고 게이트가 재유입을 막으므로 남겨두는 비용이 없다.

   **전반부(데코레이터 도입) 완료 (2026-08-09).** `@On` · `@InjectPublisher` · `PublisherFor` · `EnvelopeOf` 가 옛 표면과 **병행**으로 존재한다. `@On` 은 `@OnEvent` 과 **바이트 단위로 같은 메타데이터**를 남기고(스펙이 메타데이터 키 집합과 값을 전수 비교한다), `@InjectPublisher` 는 `EventsModule.getPublisherToken` 과 같은 토큰을 만든다 — 토큰 형식은 `publishers/publisher-token.ts` 한 곳으로 모았다. 따라서 한 앱 안에서 두 표면을 섞어 써도 되고, 앱 이주는 파일 단위로 쪼갤 수 있다. 앱 이주(후반부)는 아직 0개다. 위 §4 의 두 가지 이행 차이도 참조.
6. 공용 outbox 에 `idempotencyKey`·`partitionKey`·enqueue 시점 검증 추가 후 앱 자체 판본 5벌 회수. **core 의 두 벌은 import 경로만 다른 동일 파일이므로 이 작업과 무관하게 지금 하나로 합칠 수 있다.**

   ~~⚠️ **이 항목이 5-C 의 나머지 3개 앱을 막고 있다.**~~ **enqueue 시점 검증 완료 (2026-08-09, Task 6-A).** `StreamPublisher.enqueue` + `publishStoredEnvelope` 두 문이 들어가 zod 우회가 0이 됐고, `npm run audit:consume-validation` 의 UNVERIFIED 가 **14 → 0** 이 됐다. 막고 있던 4개 이벤트만이 아니라 membership 의 5건까지 함께 풀렸다(원인이 달랐다 — 위 §8 참조). **7개 앱 전부 `켜도 안전`이다.**

   **`@InjectStreamPublisher` → `@InjectPublisher` 완료 (2026-08-09, Task 6-B)** — 사용처 0건, 주입 지점 22곳 전부 도출. 상세는 위 5번의 "발행 쪽 이주 완료" 참조.

   남은 것은 이 항목의 다른 절반이다: `idempotencyKey`·`partitionKey` 추가와 5벌 회수(Task 6-C, 데이터 마이그레이션 성격). 6-A 에서 `OutboxPublisher.saveEvent` 는 삭제했고 공용 outbox 의 유일한 진입점은 `OutboxWriter.write` 다 — 6-C 의 회수 대상은 그 port 뒤로 들어온다.
7. 옛 표면(`forRoot`/`forConsumerModule`/`forConsumer`) 제거 — contract phase.
8. ~~channel-adapter 가 `forConsumerModule` 을 호출하지 않는 현재 상태는 이 ADR 이 시행되기 전까지 남는 실재 구멍이다 — 소비 측 zod 검증이 없다. 4번 이전에 단독으로 메울지, 이주에 묶을지 결정한다.~~ **결정: 이주에 묶었다 (2026-08-09).** 다만 배선 이주 시점에 **검증을 켜지는 않았다.** `forConsumerModule` 미호출 → `EVENTS_CONSUMER_POLICY` 토큰 부재 → `optionalGet` 이 undefined → 기본값 `true` 라, 아무 조치 없이 `startConsumer` 로 옮기면 이 앱만 배선과 검증이 **선택이 아니라 누락으로** 동시에 켜진다. 외부 채널 유래 payload 라 그 조합이 가장 위험한 앱이기도 하다. 그래서 `adapter.module.ts` 의 providers 에 `EVENTS_CONSUMER_POLICY` 를 직접 등록하고 `validateOnConsume: false` 를 명시했다. `forConsumerModule` 을 새로 부르지 않은 이유는 그 표면이 `streams` 를 필수로 받기 때문이다 — 그 목록이야말로 §2·§3 이 지우는 중인 두 번째 진실이라, 정책 하나를 얻자고 그것을 되살릴 수 없다. Task 7 의 `forApp` 이 이 자리를 흡수한다. 검증을 실제로 켜는 것은 payload 샘플링 후(플랜 Task 5-C).
9. **소비 경로 CLS 컨텍스트 부재** (2026-08-09 발견, 미수정).
 `ClsModule.forRoot({ middleware: { mount: false } })` 이고 RPC 경로에 ClsGuard/ClsInterceptor 가 없어 `EventChainService.setChainId` 가 "No CLS context available" 로 던지고, `ChainContextInterceptor` 의 `catch {}` 가 그것을 삼킨다. 결과적으로 **소비 측 `chainId`/`eventId` 전파가 전 앱에서 죽어 있다.** 3번의 파싱 버그와 원인이 다르므로 별도 수정이 필요하다 — 이 워크스트림에 묶을지 독립 처리할지 결정한다. 회귀 감지는 `round-trip.spec.ts` 의 `it.failing` 이 맡는다. (그 인터셉터 자체가 하이브리드 앱에서 붙지 않는다는 §8 이 겹친다 — 두 원인이 독립적으로 존재한다.)
10. 🔴 **라이브 구멍: 7개 소비 앱 전부에서 스키마 검증·재시도·DLQ·chain 인터셉터가 적용되지 않고 있다** (2026-08-09 발견, §8). `startConsumer` 는 이 구멍이 없는 새 배선을 제공하지만, **앱들이 이주하기 전까지 라이브 상태는 그대로다.** 옛 표면(`forConsumer`)에 같은 배선을 소급 적용하는 것은 의도적으로 하지 않았다 — 7개 앱에서 검증·DLQ 가 한 배포에 동시에 켜지며, 지금까지 검증 없이 통과하던 인바운드 payload 가 있다면 그 배포가 DLQ 폭탄이 된다. 대신 앱별 이주(5번)에서 하나씩, 관찰 가능한 단위로 켠다.

    **코드상으로는 닫혔다 (2026-08-09) — 라이브에서는 아직이다.** 7개 앱이 모두 `startConsumer` 로 이주했으나 이 레포는 autodeploy 가 없어([[0005-drizzle-migration-and-autodeploy]] §4) 누군가 `sst deploy` 를 부르기 전까지 라이브는 옛 배선이다. **이 항목이 닫히는 시점은 마지막 앱이 배포된 때다.** 그때 `start-consumer.spec.ts` 의 "옛 앱 배선" describe 도 함께 지운다 — 그 전까지는 아직 살아 있는 결함의 유일한 실행 가능한 기록이다. 배포는 앱 간 순서가 없다(각 앱 이주가 그 앱에만 영향을 준다). 배포 후 켜지는 것은 **재시도·DLQ·chain 뿐이고 스키마 검증은 아니다** — 8번·5번 참조.
11. ⚠️ **notification 의 소비 핸들러는 재실행에 안전하지 않다** (2026-08-09 발견, 미수정). 배선 이주로 재시도가 처음 실재하게 되면서 87개 핸들러의 멱등성을 전수 확인했고, 6개 앱은 안전했다(core = `messageId` 마커 / channel-adapter = `inbox_events` 단일 insert / membership = unique 마커 + 상태 가드 / wallet = idempotency key / analytics = `onConflictDoNothing(messageId)` + upsert / search = 고정 ID upsert). **notification 만 멱등 키가 없다.** `NotificationDispatcherService.send` 는 `dto.channels` 를 루프 돌며 채널마다 행을 insert 하고 큐에 넣으므로, 채널 1 성공 후 채널 2 에서 throw 하면 재시도가 루프를 처음부터 다시 돌아 **채널 1 이 다시 발송된다.** 노출은 좁다 — 프로바이더 전송 실패는 `sendNotificationDirectly` 의 `catch` 가 삼켜 핸들러까지 올라오지 않고, 실제로 throw 하는 건 DB·템플릿 조회 실패 정도다. 그 경우 옛 배선에서는 메시지가 통째로 소실됐고 새 배선에서는 앞 채널이 최대 4회 중복될 수 있다. **결정 (2026-08-09, 5-B PR 에 포함): (b) `@RetryPolicy({ maxRetries: 0 })`.**

"소실 ↔ 중복" 교환으로 제시했으나 **교환이 아니었다.** `maxRetries: 0` 은 시도 횟수를 옛 배선과 동일한 1회로 유지하므로 중복 위험이 0 이고, 동시에 실패가 조용한 소실이 아니라 **DLQ 로 관측된다.** 두 축 모두에서 옛 배선보다 나쁘지 않고 한 축에서 낫다 — 저울에 올릴 사안이 아니었다. (a) dedup 키는 재시도의 이점을 실제로 얻고 싶어질 때 별건으로 다룬다.

부수 변경: 정책 조회를 `reflector.get(META, handler)` → `getAllAndOverride(META, [handler, class])` 로 바꿔 **클래스 레벨 선언을 허용**했다(핸들러 선언이 여전히 우선). 이유는 편의가 아니라 누락 방지다 — 핸들러만 본다면 notification 의 22개 핸들러에 데코레이터를 22번 반복해야 하고, **새 핸들러가 추가될 때 조용히 기본 재시도로 돌아간다.** `@DisableDLQ` 도 같은 이유로 함께 바꿨다(한쪽만 클래스 레벨을 지원하면 그 자체가 함정이다).

실행 계획은 [`docs/superpowers/plans/2026-08-09-events-module-registration.md`](../superpowers/plans/2026-08-09-events-module-registration.md).
