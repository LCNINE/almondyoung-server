# `@app/events` 등록 표면 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 소비 스트림 집합을 선언이 아니라 `@OnEvent` 데코레이터에서 **도출**하게 만들고, 발행 경로(즉시/outbox)를 하나의 타입 도출 인터페이스로 통합하고, 브로커 없이 발행→소비를 검증할 수 있게 만든다.

**Architecture:** 설계와 근거는 [`docs/adr/0029-events-module-registration-surfaces.md`](../../adr/0029-events-module-registration-surfaces.md) 에 있다. **이 플랜은 설계를 다시 쓰지 않는다** — 진실이 두 벌 생기는 것이 이 워크스트림이 고치려는 실패 모드 그 자체다. 설계 질문이 생기면 ADR 을 읽고, 설계가 바뀌면 ADR 을 고친 뒤 이 플랜을 맞춘다.

**Tech Stack:** NestJS 11 microservices(Kafka transport) · kafkajs · zod · drizzle · Jest

---

## Global Constraints

- **expand-contract 로 간다.** 새 표면 추가 → 앱 하나씩 이주 → 마지막에 옛 표면 제거. 이 모듈은 7개 앱 · 컨슈머 핸들러 89개 · 발행 호출 76곳 · 부팅 경로 8개를 물고 있어 한 번에 갈아엎는 rewrite 는 선택지가 아니다 (실측 표는 ADR-0029 Consequences).
- **태스크 1개 = 브랜치 1개 = PR 1개.** 태스크 경계는 아래 4조건을 모두 만족해야 한다:
  1. 단독 롤백 가능
  2. 끝난 시점에 `npm run type-check` 와 `nest build <app>` 이 초록
  3. **다른 태스크의 배포를 선행조건으로 요구하지 않음** (Task 7 만 예외 — 아래)
  4. 기존 앱을 고치지 않고도 동작 (Task 5 의 앱별 이주 제외)
- **머지 리듬과 배포 리듬은 분리한다.** 머지는 태스크마다, 배포는 편할 때 묶어서. 이 레포는 autodeploy 가 없어(ADR-0005 §4) 배포가 사람이 `sst deploy` 를 부르는 수동 작업이므로, 태스크마다 배포를 강제하지 않는다. 실제로 필요한 배포 요구는 아래뿐이다:

  | 구간 | 배포 요구 |
  |---|---|
  | Task 0~4 | **없음.** 순수 추가이고 아무도 호출하지 않는다. 다음 아무 배포에 묻어가면 된다 |
  | Task 5a~5g | **앱 간 순서 없음.** 각 앱 이주는 그 앱에만 영향을 준다. 여러 앱을 한 배포에 묶어도 된다 |
  | Task 6 | 마이그레이션이 생기면 expand phase → **`migrate → deploy`** |
  | **Task 7** | ⚠️ **Task 5 전량이 배포 완료된 뒤에만.** 이 워크스트림의 유일한 진짜 울타리 — contract phase 라 순서는 **`deploy → migrate`** 가 아니라 "옛 코드가 이미 사라진 뒤" 를 뜻한다 |

- **장수 통합 브랜치를 만들지 않는다.** 0~7 을 한 브랜치에 모아 마지막에 develop 으로 보내면 Task 5 와 Task 7 이 같은 배포에 들어가 위 울타리가 무너진다. 또한 `libs/events` 는 8개 앱이 물고 있어 여러 주에 걸친 브랜치는 drift 가 비싸고, 이 레포는 장수 브랜치 재구성 전례가 나쁘다(#484 stacked→rebase+수기이식, #501 squash-rebase, 운송장 모듈은 머지 후에도 `--is-ancestor` 로 미머지로 보임). **예외:** Task 5 착수 시점에 앱 이주들이 실제로 서로 맞물린다고 밝혀지면 5a~5g 만 묶는 **짧은** 통합 브랜치는 허용한다 — 지금 미리 정하지 않는다.
- **태스크가 끝나면 푸시한다.** 이 레포에서 "미푸시" 상태가 세션 간 오해를 반복적으로 만들었다. 로컬에만 있는 완료는 완료가 아니다.
- **서브에이전트를 쓸 경우 워크트리 오염을 확인한다.** 이 레포에서 5회 재발했다. `git -C <메인 워크트리> status --short` 를 반드시 같이 볼 것 — 미커밋 편집 변종은 `origin/develop..develop` 탐지를 통과한다.
- **`packages/event-contracts` 의 구조는 바꾸지 않는다.** `stream()`/`event()` 빌더, zod 병치, 프레임워크 독립성은 유지 대상이다.
- **zod 스키마에 enum·literal 값을 추가하지 않는다.** 이 워크스트림 범위 밖이며, `validateOnConsume` 기본값이 `true` 라 소비자 선배포가 필요하다 (현재 해당: core · analytics · search).
- 검증 게이트는 `npm run type-check` (전역 tsc). ⚠️ `tail` 로 자른 출력에 개수를 매기지 말 것 — 과거 그 착각으로 오보한 적이 있다.

### 검증된 사실 (2026-08-08~09 실측)

이 플랜이 의존하는 사실. **재확인 없이 뒤집지 말 것.**

- `ServerKafka.bindEvents()` 가 `subscribe.topics` 를 `[...this.messageHandlers.keys()]` 로 덮어쓴다 (`node_modules/@nestjs/microservices/server/server-kafka.js:92`, v11.1.17). 따라서 `forConsumer({streams})` 의 `streams` 는 **무효**다. 같은 함수에 `registeredPatterns.length > 0` 가드가 있어, 핸들러가 0개면 **subscribe 자체를 건너뛴다** — 컨트롤러 미등록이 로그조차 남기지 않는 이유다 (2026-08-09 추가 확인).
- `NestApplication.connectMicroservice(opts)` 를 두 번째 인자 없이 부르면 마이크로서비스에 **새 `ApplicationConfig`** 가 주어진다 (`nest-application.js:128`). **7개 소비 앱 전부가 그렇게 부르므로 `APP_INTERCEPTOR` 전역 인터셉터가 소비 경로에 적용되지 않는다** — 스키마 검증·재시도·DLQ·chain 이 전부 죽어 있다. 컨트롤러 레벨 `@UseInterceptors(EventTypeGuard)` 만 살아 있다 (2026-08-09 실측, ADR-0029 §8).
- `deferInitialization: true` 로 붙인 마이크로서비스는 `listen()` 에서 `registerModules()` 를 타고, 그 안에서 `callInitHook()` 이 컨테이너 전체에 대해 **다시** 실행된다 — `onModuleInit` 2회 (실측). 그래서 `startConsumer` 는 `registerListeners()` + 초기화 플래그를 직접 세운다.
- `@OnEvent(topic, type)` = `EventPattern(topic)` + `SetMetadata(EVENT_TYPE_FILTER, type)` (`libs/events/src/consumers/decorators.ts:76`). 등록 패턴이 곧 토픽 문자열.
- 한 토픽의 event handler 는 링크드 리스트로 이어져 **전부 실행**된다 (`server.js:51–56` + `listeners-controller.js:87`). `EventTypeGuard` 가 `messageType` 불일치 시 `of(undefined)` 로 조용히 버리며, **호출마다 `JSON.parse`** 한다.
- `OutboxPublisher.saveEvent` 는 검증하지 않고, `OutboxDispatcher` 는 `publishRawEnvelope` → `sendMessage` 로 zod 를 우회한다. **outbox 경로에 스키마 검증이 없다.**
- outbox 구현이 5벌. `apps/core/.../fulfillment/outbox/outbox.service.ts` 와 `apps/core/.../inventory/shared/outbox/outbox.service.ts` 는 **import 경로 한 줄만 다르고 나머지가 동일**하며 같은 `wmsTables.outboxEvents` 를 쓴다.
- `EventKeysOf` · `EventPayloadOf` · `EventMessageTypeOf` (`packages/event-contracts/types/stream-builder.ts`) 사용처 **각 0건**.
- `libs/events/src` 소스 29 / 스펙 5. 인메모리·페이크 트랜스포트 **0개**.
- channel-adapter 만 `forConsumerModule` 을 호출하지 않는다 → 소비 측 zod 검증 없음. (`EventRetryInterceptor`·DLQ 는 `forRoot` 에서 받고, 11개 스트림 부트스트랩도 거기서 된다.)

---

## File Structure

| 파일 | 책임 | 태스크 |
|---|---|---|
| `packages/event-contracts/streams/registry.ts` (신규) | `topic → StreamConfig` 레지스트리 | 1 |
| `libs/events/src/transport/transport.port.ts` (신규) | 발행 port 인터페이스 + `EVENT_TRANSPORT` 토큰 | 2 |
| `libs/events/src/transport/kafka.transport.ts` (신규) | 프로덕션 어댑터 (기존 배선 이관) | 2 |
| `libs/events/src/transport/in-memory.broker.ts` (신규) | 토픽별 발행 로그 · 적대적 입력 주입 | 2 |
| `libs/events/src/transport/in-memory.transport.ts` (신규) | 테스트용 발행 어댑터 | 2 |
| `libs/events/src/transport/in-memory.server.ts` (신규) | 테스트용 **소비** 전략 (Nest `CustomTransportStrategy`) | 2 |
| `libs/events/src/events.module.ts` | `startConsumer` 추가, `forConsumer({streams})` deprecate | 3 |
| `libs/events/src/consumers/decorators.ts` | `@On` / `@Payload` 추가 (기존 `@OnEvent` 병행 유지) | 4 |
| `libs/events/src/publishers/stream-publisher.service.ts` | `publish`/`enqueue` 통합 인터페이스, `publishRawEnvelope` zod 우회 제거 | 6 |
| `libs/events/src/outbox/` | `idempotencyKey`·`partitionKey`·enqueue 시점 검증 | 6 |
| `apps/*/src/main.ts`, `apps/*/src/*.module.ts` | 앱별 이주 | 5 |
| `apps/core/.../{fulfillment,inventory/shared}/outbox/` | 동일 파일 2벌 → 1벌 | 0 |

---

## Task 0: core 의 중복 outbox 서비스 합치기

**이 워크스트림과 독립적이다.** 먼저 하든 나중에 하든 상관없고, 다른 태스크를 막지 않는다. 몸풀기로 두기 좋다.

- [ ] `apps/core/src/modules/fulfillment/outbox/outbox.service.ts` 와 `apps/core/src/modules/inventory/shared/outbox/outbox.service.ts` 가 import 경로 외 동일함을 `diff` 로 재확인
- [ ] 한 곳으로 합치고 다른 쪽은 re-export 또는 삭제 — 사용처 8곳 확인 후 결정
- [ ] `npm run type-check` 초록
- [ ] 커밋 · 푸시

**완료 기준:** `wmsTables.outboxEvents` 에 쓰는 core 내 서비스 클래스가 1개다.

---

## Task 1: 계약 레지스트리 추가

순수 추가. 아무것도 소비하지 않으므로 위험 0.

- [x] `packages/event-contracts/streams/registry.ts` 에 `STREAM_REGISTRY: Record<string, StreamConfig>` 를 만든다. `streams/index.ts` 가 이미 전 스트림을 export 하므로 그것을 모은다
- [x] `streamForTopic(topic: string): StreamConfig | undefined` 를 노출
- [x] 스펙: 모든 등록 스트림의 `topic.topic` 이 레지스트리 키와 일치하고, 키 중복이 없음을 단언
- [x] `npm run type-check` 초록 · 커밋 · 푸시

**완료 기준:** 레지스트리가 존재하고 스펙이 초록. 소비자는 아직 없다.

**완료 (2026-08-09).** 브랜치 `feat/events-stream-registry`.

- 레지스트리는 선언이 아니라 **도출**이다 — `import * as from './index'` 를 훑어 `StreamConfig` 모양인 export 만 고른다. 스트림을 추가해도 손댈 목록이 없다.
- 중복 토픽 · 빈 토픽은 **모듈 로드 시점에 throw**. 스펙 단언에 그치지 않고 부팅에서 죽는다.
- 공개 표면은 패키지 루트 `index.ts` 에만 추가했다. `streams/index.ts` 에 넣으면 순환 import 라 레지스트리가 빈 채로 굳는다 — `registry.public-api.spec.ts` 가 그 회귀를 잡는다.
- 실측: 도출된 토픽 15개. `TEST_STREAM`·`INVENTORY_STREAM_WITH_SCHEMA` 는 `streams/index.ts` 가 export 하지 않으므로 제외됐고, 어느 앱도 구독하지 않는다(확인함).
- **Task 3 에 넘기는 사실:** 앱들이 `@OnEvent` 로 실제 구독하는 토픽은 14개이며 **전부 레지스트리에 있다.** 즉 Task 3 의 "레지스트리에 없는 토픽 → 부팅 거부" 는 현재 앱을 하나도 깨지 않는다. (`analytics.events.v1` 은 `retry-policy.decorator.ts` 의 doc 주석, `wiring.*.v1` 은 `event-retry.wiring.spec.ts` 안에만 있다.)
- 검증: 스펙 13개 초록(계약 패키지 전체 7 suite / 99 tests) · `npm run type-check` 오류 164개로 develop 과 **file:line:code 집합 동일** · `nest build core` 초록 · eslint 초록.

---

## Task 2: transport port + 인메모리 어댑터 + 왕복 테스트

**이 워크스트림에서 가장 중요한 태스크다.** ADR-0029 는 이것을 원래 마지막에 두려 했으나 앞으로 당겼다 — 지금은 발행→소비를 브로커 없이 검증할 방법이 아예 없어서, 이게 없으면 이후 모든 태스크가 "되는 것 같다"로 끝나고 다음 세션의 작업자는 앞 단계가 무엇을 보장했는지 알 수 없다.

**⚠️ port 표면은 브레인스토밍에서 확정됐다 (2026-08-09): 발행 방향만.** `subscribe(topics, handler)` 는 port 에 넣지 않는다 — 소비 루프는 `libs/events` 가 아니라 Nest `ServerKafka` 가 소유하므로 정직한 Kafka 구현이 없다. 근거와 대안(`CustomTransportStrategy`)은 ADR-0029 §7 에 있다. **이 플랜의 옛 문구(`send` + `subscribe` 대칭)는 ADR 과 충돌해 폐기됐다.**

- [x] `EventTransport` 정의: `send(topic, {key, value, headers})` 만. `EVENT_TRANSPORT` DI 토큰 동봉
- [x] `KafkaTransport` — `ClientKafka.emit` + `firstValueFrom` 을 그대로 옮긴다. **동작 변경 없음** (GZIP 압축은 어댑터 내부로)
- [x] `InMemoryBroker` — 토픽별 발행 로그(`messagesOn`), 적대적 envelope 주입(`inject`)
- [x] `InMemoryTransport` — `send` → broker 적재 → 구독 서버에 **동기** 배달 (await 후 단언 가능해야 함)
- [x] `InMemoryServer` — `Server implements CustomTransportStrategy`. **진짜 `KafkaContext` 인스턴스**를 만들어야 한다 (`event-retry.interceptor.ts:72` 의 `instanceof` 게이트). 디스패치는 `ServerKafka.handleEvent` 를 그대로 흉내 — `handler(data, ctx)` 한 번만 부르면 다중 핸들러 체인은 `ListenersController.forkJoinHandlersIfAttached` 가 알아서 순회한다
- [x] `StreamPublisher` · `DLQHandler` 생성자를 port 로 교체, `events.module.ts` 배선 4곳 조정. **앱 코드 변경 0**
- [x] 왕복 스펙: `StreamPublisher.publishEvent` → 인메모리 → `@OnEvent` 핸들러 호출까지 한 프로세스에서 검증
- [x] 왕복 스펙에 **`EventTypeGuard` 필터링**(같은 토픽 다중 핸들러 중 1개만 실행) 케이스 포함
- [x] 왕복 스펙에 **스키마 위반 → DLQ 분류** 케이스 포함. ⚠️ `validateOnPublish` 기본값이 `true` 라 잘못된 payload 는 발행 단계에서 먼저 터진다 — publisher 를 우회해 `broker.inject()` 로 적대적 envelope 를 직접 넣을 것 (실제로도 그런 메시지는 *다른 서비스가* 보낸다)
- [x] `npm run type-check` 초록 · 커밋 · 푸시

**완료 기준:** 브로커 없이 발행→소비 왕복이 테스트로 증명된다. 이후 모든 태스크는 이 하네스 위에서 증거를 남긴다.

**완료 (2026-08-09).** 브랜치 `feat/events-transport-port`.

- port 표면은 **발행만**(`send`). 소비 다형성은 Nest `CustomTransportStrategy` 에서 얻는다 — 근거는 ADR-0029 §7.
- **하네스는 `EventsModule` 을 실제로 import 한다.** `forRoot` + `forConsumerModule` 을 그대로 쓰고 `EVENT_TRANSPORT` 하나만 `overrideProvider` 로 바꾼다. 즉 인터셉터·가드·파라미터 데코레이터·생성자 DI 가 전부 실물이다.
- `InMemoryServer` 는 Nest 가 export 하는 `KafkaParser` 를 **그대로 재사용**한다. 흉내내면 운영과 다른 것을 테스트하게 된다.
- **`Kafka 로 나가는 모든 경로`가 port 를 지난다** — `StreamPublisher` · `OutboxDispatcher`(publisher 경유) · `DLQHandler`. `GracefulShutdownService` 만 연결 종료 목적으로 `KAFKA_CLIENT` 를 계속 쓴다.

**🔴 하네스가 첫 실행에서 실재 프로덕션 버그를 찾았다 (같은 브랜치에서 수정).**

Nest 는 수신 `value` 를 `KafkaParser.decode` 로 **JSON 파싱해서** 넘긴다(`keepBinary` 기본 false). 즉 운영에서 `KafkaContext.getMessage().value` 는 Buffer 가 **아니라 객체**다. 그런데 세 곳이 `Buffer.isBuffer(v) ? v.toString() : String(v)` 관용구를 써서 `"[object Object]"` 를 만들고 `JSON.parse` 가 터졌다:

| 위치 | 증상 |
|---|---|
| `schema-validation.interceptor.ts:69` | 모든 메시지가 SyntaxError → 재시도 3회(7초 블로킹) |
| `event-retry.interceptor.ts:194` | DLQ 전송도 같은 이유로 실패 → `DlqDeliveryError` → **offset 미커밋 → 무한 재전달** |
| `chain-context.interceptor.ts:26` | `catch {}` 로 삼킴 → 조용히 no-op |

`validateOnConsume: true` 인 앱(**core · analytics · search**)이 해당. 수정은 `utils/envelope.util.ts` 의 `parseEnvelope` 하나로 모았다. 인접한 4곳(`event-type.guard.ts:41`, `decorators.ts` 3곳)은 원래부터 객체를 처리하고 있었다 — 관용구가 불일치했던 것.

**⚠️ 고치지 않고 남긴 것:** 소비 경로에서 `chainId` 가 CLS 로 전파되지 않는다. 파싱과 **무관한 별개 원인** — `ClsModule.forRoot({ middleware: { mount: false } })` 이고 RPC 경로에 ClsGuard/Interceptor 가 없어 `setChainId` 가 "No CLS context available" 로 던지며 `ChainContextInterceptor` 의 `catch {}` 가 삼킨다(실측 확인). 범위 밖이라 `round-trip.spec.ts` 에 **`it.failing`** 으로 박아뒀다 — 누가 고치면 그 테스트가 실패해서 알린다.

- 검증: `libs/events`+계약 패키지 **14 suite / 129 tests 초록** · `npm run type-check` **164 = develop 기준선과 동일**(libs/events 잔여 4건은 전부 기존 부채) · **9개 앱 전부 `nest build` 초록** · 신규 파일 eslint 초록(libs/events 기존 부채 116건은 별개) · 전체 jest 실패 suite 집합이 develop 과 **동일**(18), 통과 테스트 +9.
- **Task 3 에 넘기는 사실:** `InMemoryServer.dispatch` 는 `handler(data, ctx)` 를 **한 번만** 부른다. 같은 토픽 다중 핸들러 순회는 `ListenersController.forkJoinHandlersIfAttached` 가 하므로 운영과 동일하다. 또한 같은 토픽 핸들러가 N개면 인터셉터 체인도 N번 돌아 **스키마 위반 시 DLQ 메시지가 N개** 생긴다(하네스에서 확인) — Task 6 의 "토픽당 한 번 파싱" 설계가 이것도 같이 없앤다.

---

## Task 3: `startConsumer(app)` 도입, `forConsumer({streams})` deprecate

- [x] `EventsModule.startConsumer(app, { groupId, kafka })` 추가. `DiscoveryService` 로 `@OnEvent`/`@On` 메타데이터를 훑어 `(topic, eventType)` 집합을 얻는다
- [x] 그 집합에서 **구독 토픽 · 검증 스키마 맵 · 토픽 부트스트랩 목록**을 파생 (Task 1 레지스트리 사용)
- [x] 레지스트리에 없는 토픽을 구독하려 하면 **부팅 거부**
- [x] `@OnEvent` 핸들러가 하나도 없는데 `startConsumer` 를 부르면 **부팅 거부** (컨트롤러 미등록 = 현재 가장 조용한 실수)
- [x] `forConsumer({streams})` 의 `streams` 를 `@deprecated` 로 표시하고 무시. 시그니처는 유지 — 앱을 아직 고치지 않는다
- [x] Task 2 하네스로 파생 결과를 검증하는 스펙
- [x] `npm run type-check` 초록 · 커밋 · 푸시

**완료 기준:** `startConsumer` 가 존재하고 테스트되며, **기존 8개 앱은 한 줄도 고치지 않았고 전부 그대로 동작한다.**

**완료 (2026-08-09).** 브랜치 `feat/events-start-consumer`.

- 도출은 Nest 자신의 `ListenerMetadataExplorer` 로 한다 (`consumers/consumer-discovery.ts`). 흉내낸 스캐너를 쓰면 "우리가 도출한 집합"과 "Nest 가 바인딩하는 집합"이 갈라질 수 있고, 그 어긋남이 정확히 이 워크스트림이 없애려는 종류의 무증상 결함이다. **컨트롤러만 훑는다** — Nest 의 `setupListeners` 도 `module.controllers` 만 순회하므로 provider 의 `@OnEvent` 는 지금도 아무 일을 하지 않는다(스펙으로 고정).
- 도출은 순수 함수 2개로 갈랐다: `discoverEventHandlers(app)`(컨테이너 → 핸들러 목록) · `deriveConsumerConfig(handlers)`(핸들러 목록 → 토픽·계약, 거부 판정). 후자는 컨테이너 없이 테스트된다.
- 부팅 거부 두 건 다 실행 가능한 스펙으로 박혔다. 에러 메시지가 **어느 컨트롤러의 어느 메서드**인지 지목한다.
- `forConsumer` 는 이제 `subscribe.topics` 를 **만들지 않는다.** 남겨두면 "이 목록이 구독을 결정한다"는 틀린 모델이 다시 자란다. 옵션 타입도 `ConsumerTransportOptions` 로 갈라 `streams` 를 optional + `@deprecated` 로 표시했다 — 기존 7개 호출부는 그대로 컴파일된다.
- 실측 보강: `ServerKafka.bindEvents` 에는 `registeredPatterns.length > 0` 가드가 있다. 즉 핸들러 0개면 **subscribe 자체를 건너뛴다** — 로그조차 남지 않으므로 "핸들러 0개 → 부팅 거부"는 장식이 아니다. (ADR Context 의 인용문을 이 가드까지 포함하도록 고쳤다.)

**🔴 이 태스크가 두 번째 실재 프로덕션 결함을 찾았다 — 이번엔 영향 범위가 크다.**

`app.connectMicroservice(opts)` 를 두 번째 인자 없이 부르면 Nest 가 마이크로서비스에 **빈 `ApplicationConfig`** 를 만들어 준다(`nest-application.js:128`). **7개 소비 앱 전부가 그렇게 부른다.** 따라서 `APP_INTERCEPTOR` 로 등록한 `SchemaValidationInterceptor` · `EventRetryInterceptor`(재시도·DLQ·offset commit) · `ChainContextInterceptor` 가 **소비 경로에 하나도 붙지 않는다.** 컨트롤러 레벨 `@UseInterceptors(EventTypeGuard)` 는 메타데이터에서 해석되므로 살아 있다 — 그래서 필터링만 동작하고 검증·재시도·DLQ 는 조용히 죽어 있었다.

하네스로 4가지 배선을 실행해 비교했고(ADR-0029 §8 표), 채택한 것은 **마이크로서비스 스코프 전역 인터셉터**다: `deferInitialization: true` → `useGlobalInterceptors` → `registerListeners()` → 초기화 플래그 수동 세팅. `inheritAppConfig: true` 는 앱의 HTTP 전역 파이프·필터·**가드**까지 RPC 에 얹혀 기각했고, `deferInitialization` 단독은 `onModuleInit` 이 **2회** 실행돼 기각했다(둘 다 실측).

**파급 1 — Task 2 의 결론 일부가 틀렸다.** Task 2 는 파싱 버그가 "core·analytics·search 에서 무한 재전달"을 일으킨다고 적었다. 그 세 인터셉터가 애초에 붙지 않으므로 **프로덕션 영향 범위는 0** 이었다. 수정 자체는 유효하다(§8 배선이 켜지면 그 경로가 살아난다). ADR Follow-up 3 에 정정을 남겼다.

**파급 2 — Task 5 는 동작 중립이 아니다.** 아래 Task 5 경고 참조.

- 검증: `libs/events`+계약 패키지 **16 suite / 145 tests 초록**(Task 2 대비 +2 suite / +16 tests) · `npm run type-check` **164 = develop 기준선과 동일** · **10개 앱 전부 `nest build` 초록** · 신규 파일 eslint 초록(`events.module.ts` 는 기존 부채 11 error / 4 warning 그대로) · 전체 jest 실패 suite 집합이 develop 과 **동일**(18).
- **Task 4·5 에 넘기는 사실:** `startConsumer` 는 검증 **정책**(`validateOnConsume` 등)을 `EVENTS_CONSUMER_POLICY` 토큰으로 컨테이너에서 읽는다 — `forConsumerModule({validation})` 이 등록한다. 정책은 도출 불가한 사실이라 선언이 맞고, 스트림 목록만 도출로 대체됐다. **`forConsumerModule` 을 부르지 않는 앱(channel-adapter)은 이 토큰이 없어 기본값(`validateOnConsume: true`)으로 떨어진다.** Task 7 에서 `forConsumerModule` 을 걷어낼 때 이 정책을 `forApp` 으로 옮겨야 하며, 그 전에는 정책 선언을 지우면 안 된다 — 지우는 순간 `validateOnConsume: false` 를 명시한 앱(notification·membership·wallet)에서 검증이 켜진다.

---

## Task 4: 타입 도출 데코레이터 `@On` / `@InjectPublisher` 추가

기존 `@OnEvent` / `@InjectStreamPublisher` 와 **병행**한다. 아직 아무 앱도 고치지 않는다.

- [x] `@On(STREAM, 'EventName')` — 이벤트명을 `EventKeysOf` 로 좁힌다
- [x] ~~`@Payload()`~~ 기존 `@EventPayload()` + `EventPayloadOf<typeof STREAM, 'EventName'>` 로 payload 타입이 계약에서 도출되게 한다
- [x] `@InjectPublisher(STREAM)` + `PublisherFor<typeof STREAM>` — 문자열 토큰과 제네릭 두 사실을 하나로
- [x] 타입 레벨 스펙: 잘못된 이벤트명이 컴파일 에러가 되는지 (`@ts-expect-error`)
- [x] `npm run type-check` 초록 · 커밋 · 푸시

**완료 기준:** 새 데코레이터가 존재하고 타입이 도출되며, 옛 데코레이터도 그대로 동작한다.

**완료 (2026-08-09).** 브랜치 `feat/events-typed-decorators`.

- 새 표면 4개: `@On` · `@InjectPublisher` · `PublisherFor<S>` · `EnvelopeOf<S, K>`. 옛 표면(`@OnEvent` · `@InjectStreamPublisher`)은 한 줄도 안 건드렸고 **앱 코드 변경 0**.
- **`@Payload()` 는 채택하지 않았다.** ADR §4 스케치가 그렇게 적혀 있었지만 `@nestjs/microservices` 가 이미 `Payload` 로 **다른 것**(메시지 전체)을 export 한다. `@app/events` 는 `export *` 라 같은 이름이 import 경로에 따라 다른 뜻이 되고, 그건 이 워크스트림이 없애려는 실패 모드를 이름 공간에서 재생산하는 것이다. 도출되는 것은 데코레이터 이름이 아니라 **타입**이므로 §4 의 목적은 그대로 달성된다. **ADR §4 를 먼저 고쳤다.**
- **`EnvelopeOf<S, K>` 를 계약 패키지에 추가했다** (ADR §4 에도 기록). 소비 핸들러 87개 중 **75개**가 `@EventEnvelope() envelope: DomainEvent<XPayload>` 를 함께 받는다(실측). 이 조합을 매번 손으로 쓰게 두면 이주해도 옛 손수 타입이 그대로 살아남는다.
- **런타임 동등성이 스펙으로 고정됐다.** `@On` 이 남기는 메타데이터를 `@OnEvent` 과 **키 집합·값 전수 비교**하고, 인메모리 하네스(Task 2)로 `@InjectPublisher` → 발행 → `@On` 핸들러 왕복을 실제로 돌린다. "같아 보인다"가 아니라 실행 증거다. 그래서 앱 이주는 **파일 단위로** 쪼갤 수 있다.
- Publisher 토큰 형식(`STREAM_PUBLISHER_${topic}`)을 `publishers/publisher-token.ts` 한 곳으로 모으고 `EventsModule.getPublisherToken` 이 그것을 부르게 했다 — 두 벌이면 어긋남이 무증상 DI 실패로 나온다.
- 타입을 우회한 호출(`as any`)은 **데코레이터 평가 시점 = 부팅**에 던진다. 계약에 없는 이벤트명 · 토픽 없는 객체 둘 다.

**⚠️ Task 5 에 넘기는 사실 — `@On` 은 이벤트명 *오타*를 잡지만 *불일치*는 못 잡는다.**

`@On(S, 'A')` + `@EventPayload() p: EventPayloadOf<typeof S, 'B'>` 는 여전히 컴파일된다. 핸들러 시그니처를 타입으로 강제하는 안을 검토하고 기각했다: 파라미터 데코레이터 순서가 앱마다 다르고(**envelope-우선 45 · payload-우선 20 · payload-only 12 · envelope-only 10**, 실측 87개), 이 레포는 `strictFunctionTypes` 가 꺼져 있어 `TypedPropertyDescriptor` 제약이 반공변으로 걸리지도 않는다. **이주할 때 payload/envelope 주석의 이벤트명을 사람이 맞춰야 한다** — 기계가 안 잡아준다.

- 검증: `libs/events`+계약 패키지 **17 suite / 151 tests 초록**(Task 3 대비 +1 suite / +6 tests) · `npm run type-check` **164 = develop 기준선과 동일** · **10개 앱 전부 `nest build` 초록** · 신규 파일 eslint 초록, 손댄 기존 파일(`decorators.ts` 4 · `events.module.ts` 15)은 메시지 집합이 develop 과 동일 · 전체 jest 실패 suite **18 = develop 과 동일**(3013 통과).
- `@ts-expect-error` 단언이 살아 있음을 확인했다 — 하나를 지우면 `tsc` 가 `TS2345: '"NoSuchEvent"' is not assignable to '"OrderCreated" | "OrderCancelled"'` 로 실패한다(실행 확인). 쓸모없어진 directive 는 `TS2578` 로 스스로 드러나므로 이 단언들은 썩어도 조용하지 않다.

---

## Task 5: 앱별 이주 — 스위치 3개로 분해한다

**앱 하나를 이주시키면 독립적인 스위치 3개가 동시에 켜진다.** 위험 프로파일이 완전히 다르므로 한 PR 에 묶지 않는다. 묶으면 C 때문에 롤백할 때 멀쩡한 A 까지 되돌아가고, 각 PR 의 blast radius 가 불분명해진다.

| 스위치 | 무엇이 바뀌나 | 위험 |
|---|---|---|
| **A. 데코레이터** | 없음 — Task 4 가 런타임 동등성을 실행 증거로 고정 | 0 (단, 핸들러 87개 수작업 함정) |
| **B. 배선** (`startConsumer`) | 재시도·DLQ·chain-context 가 **처음으로** 붙는다 | 낮음 — 오히려 이득 |
| **C. 검증 정책** (`validateOnConsume`) | 스키마 검증이 **처음으로** 켜진다 | **여기가 진짜 게이트** |

### 앱별로 C 가 무엇을 바꾸는가 (실측)

| 앱 | 현재 정책 | C 가 바꾸는 것 | DLQ 관측 |
|---|---|---|---|
| `core` (4 핸들러) | 기본 `true` | 검증 ON | ✅ Alloy 스크레이프 |
| `analytics` (11) | 기본 `true` | 검증 ON | ❌ |
| `search` (3) | 기본 `true` | 검증 ON | ❌ |
| **`channel-adapter` (34)** | **정책 없음 → 기본 `true`** | 검증 ON, 외부 유래 payload | ❌ |
| `notification` (22) | 명시 `false` | **없음 (no-op)** | ❌ |
| `membership` (11) | 명시 `false` | **없음 (no-op)** | ❌ |
| `wallet` (4) | 명시 `false` | **없음 (no-op)** | ❌ |

**⚠️ channel-adapter 함정 — 누락으로 터진다.** `forConsumerModule` 을 호출하지 않으므로 `EVENTS_CONSUMER_POLICY` 프로바이더가 없고, `consumer-interceptors.ts:59` 의 `optionalGet` 이 `undefined` 를 반환해 `DEFAULT_SCHEMA_VALIDATION_OPTIONS` 의 `validateOnConsume: true` 가 먹는다. **아무 조치 없이 이주하면 B 와 C 가 같은 PR 에서 동시에 켜진다** — 선택이 아니라 누락으로. 이주 시 `validateOnConsume: false` 를 **명시**할 것.

**관측성 제약.** `dlq/dlq.metrics.ts:10` — Alloy 는 Core `/metrics` 만 스크레이프한다. **core 외 6개 앱은 DLQ 카운터가 돌아도 아무도 보지 않는다.** C 를 core 밖에서 먼저 켜는 것은 눈 감고 켜는 것이다.

---

### Task 5-A: 데코레이터 일괄 이주 (위험 0)

- [x] **AST 게이트 스크립트를 먼저 만든다.** `@On(S,'A')` + `@EventPayload() p: EventPayloadOf<typeof S,'B'>` 는 컴파일된다 — 파라미터 데코레이터 순서가 4가지(envelope-우선 45 · payload-우선 20 · payload-only 12 · envelope-only 10)이고 `strictFunctionTypes` 도 꺼져 있어 타입으로 막을 수 없다. 핸들러 87개를 사람 눈으로 맞추면 실수가 난다. 핸들러마다 `@On` 의 이벤트 키와 `EventPayloadOf<…, K>` 의 K 일치를 단언하고 불일치면 exit 1. **선례: `scripts/security/route-authz-audit.js`**
- [x] 게이트를 켠 채 7개 앱의 `@OnEvent` → `@On`, ~~`@InjectStreamPublisher` → `@InjectPublisher`~~(아래 참조), payload/envelope 타입을 `EventPayloadOf` / `EnvelopeOf` 로 이주
- [x] `npm run type-check` 기준선(164) · 10개 앱 `nest build` 초록 · AST 게이트 exit 0
- [x] 스크립트는 이주 종료 후 버리거나 CI 게이트로 남긴다 (착수 시 결정) → **남긴다.** 아래 참조

`main.ts` 는 건드리지 않는다. Task 4 가 두 표면 혼재를 실행으로 검증했으므로 앱 단위·파일 단위로 쪼개도 안전하다.

**완료 (2026-08-09).** 브랜치 `docs/plan-task5-split`.

- 게이트는 `scripts/events/event-handler-contract-audit.js`. **CI 게이트로 남긴다** — 이주가 끝나도 새 핸들러는 계속 추가되고, 이 게이트가 막는 불일치는 타입이 끝내 잡지 못하는 종류다. 검사는 5종: `LEGACY`(`@OnEvent` 잔량) · `UNDERIVED`(손수 단 payload/envelope 주석) · `STREAM_MISMATCH` · `EVENT_MISMATCH` · `WRONG_DERIVED_TYPE`(`@EventEnvelope` 에 `EventPayloadOf`). **5종 전부를 일부러 어긋뜨려 exit 1 을 확인했다** — 초록불이 무엇을 뜻하는지 모르는 게이트를 남기지 않기 위해서다.
- 게이트는 **순수 구문 검사**다. `@On` 의 스트림·이벤트가 실재하는지는 검사하지 않는다 — `EventKeysOf` 가 컴파일에서, `@On` 의 런타임 가드가 부팅에서 이미 잡는다. 여기서 또 검사하면 계약 로딩이라는 두 번째 진실이 생긴다.
- 87개 전량 이주. 파일 상수로 이벤트명을 쓰는 곳(`@OnEvent(PRODUCT_TOPIC, MASTER_DELETED)`)이 있어 게이트는 **같은 파일의 문자열 상수를 푼다**. 못 풀면 그 핸들러만 조용히 감사 밖으로 빠지는데, 그건 이 게이트가 없애려는 실패 모드 그 자체다.
- `@InjectStreamPublisher` → `@InjectPublisher` 는 **하지 않았다.** 그건 소비가 아니라 발행 쪽 표면이고(21곳: core 7 · user-service 7 · channel-adapter 3 · membership 2 · ugc-service 2), 이 게이트가 검사하지 않는다. Task 6 이 발행 경로(`publish`/`enqueue` 통합)를 손대므로 거기서 같이 옮기는 편이 PR 경계가 깔끔하다. **워크스트림 완료 기준에는 그대로 남아 있다.**

**🔴 이주가 계약의 구멍 두 종류를 드러냈다 — `@OnEvent` 로는 영원히 안 보이는 것들이다.**

1. **계약에 없는 이벤트를 5개 핸들러가 구독하고 있었다.** `payment.intent.refund_requested` · `payment.intent.refund_request_rejected` · `gateway.charge.captured` · `gateway.refund.succeeded` (channel-adapter 4 + membership 1). 넷 다 `apps/wallet/src/messaging/gateway-event.builder.ts` 가 실제로 발행하는 라이브 이벤트인데 `PAYMENT_STREAM` 에 빠져 있었다. `deriveConsumerConfig` 는 **토픽** 단위로만 확인하므로 이걸 못 잡는다. `PAYMENT_STREAM` 에 추가했고, **스키마는 기존 `PaymentIntentEventSchema` 선례대로 관대하게(전 필드 optional + passthrough)** 뒀다 — 계약 등록만으로 소비검증이 켜지면 그게 곧 DLQ 폭탄이다. 검증을 조이는 결정은 5-C 몫.
2. **`PaymentIntentEventPayload` 가 소비자가 실제로 읽는 필드를 빠뜨리고 있었다.** membership 이 `errorCode`/`errorMessage`(billing-result) 와 `metadata.type`(membership-checkout) 을 읽는데 계약에 없어 각자 로컬 인터페이스를 다시 선언해 두고 있었다. 발행측 실재를 확인하고(`direct-billing-charge.service.ts:214` · `invoice-executor.service.ts:489` · `bank-transfer-admin.service.ts:178`) 계약에 optional 로 추가했다.

**부수 발견 — `gateway.refund.succeeded` 에는 `orderId` 가 없다.** channel-adapter 의 `forwardRefundToMedusa` 가 `payload.orderId` 로 channelOrderId 를 보강하는데, 그 경로만 payload 에 `orderId` 가 아예 없어 **예전부터 조회를 건너뛰고 있었다**(`Record<string, unknown>` 이라 `undefined` 가 조용히 통과). 동작은 그대로 두고 헬퍼 시그니처를 `coreOrderId?: string` 으로 좁혀 사실이 타입에 보이게 했다.

- **스펙 3개가 부분 payload 를 넘기고 있었다** (membership billing-result · membership-checkout · membership-refund). 옛 로컬 인터페이스가 느슨해서 3필드 stub 이 통과했을 뿐이다. 계약 필수 필드를 채우는 팩토리를 각 스펙에 넣었다.
- 검증: `npm run type-check` **164 — develop 기준선과 file:line:code 집합 완전 동일**(신규 0 · 소멸 0) · **10개 앱 전부 `nest build` 초록** · AST 게이트 exit 0 · `libs/events`+계약 패키지 **17 suite / 151 tests 초록** · 변경 파일 eslint **150 → 143 error**(신규 0, 감소는 미사용 파라미터 제거분) · 전체 jest 실패 suite 집합이 develop 과 동일.
- **5-B 에 넘기는 사실:** `main.ts` 는 한 줄도 안 건드렸다. 7개 앱 전부 여전히 `forConsumer` + 하이브리드 `connectMicroservice` 를 쓰므로 **§8 의 라이브 구멍(검증·재시도·DLQ 미적용)은 그대로다.** 이 PR 은 동작 중립이다.

### Task 5-B: 배선 켜기 (`startConsumer`) — 앱별

- [x] **선행 확인 1건.** 지금 핸들러가 throw 하면 실제로 어떻게 되는지(재전달 루프인지 Nest 가 삼키는지)를 Task 2 하네스로 재현해 확정한다. B 의 before/after 를 말할 수 있어야 한다
- [x] 각 앱: `main.ts` 를 `startConsumer(app, { groupId })` 로 교체 (streams 인자 제거)
- [x] **검증이 기본 ON 으로 넘어가는 앱은 이 PR 에서 `validateOnConsume: false` 를 명시**해 B 와 C 를 분리한다 (core · analytics · search · **channel-adapter**)
- [x] 그 앱 핸들러의 idempotency 확인 — 재시도가 처음으로 실재하게 된다
- [x] `nest build <app>` · `npm run type-check` 초록

B 는 위험을 더하는 게 아니라 **없던 탈출구를 만드는 쪽에 가깝다.** `EventRetryInterceptor` 의 의미론은 "최종 실패 → DLQ 전송 후 에러 삼킴 → offset commit" 인데 지금은 그게 안 붙어 있어 독약 메시지에 탈출구가 없다.

**완료 (2026-08-09).** 브랜치 `docs/plan-task5-split`. 7개 앱 전부 한 커밋에 — 플랜 Global Constraints 의 "Task 5a~5g 는 앱 간 순서 없음, 여러 앱을 한 배포에 묶어도 된다"에 따른다. 각 앱 이주는 서로를 참조하지 않으므로 배포는 여전히 앱 단위로 쪼갤 수 있다.

**선행 확인 결과 — 옛 배선에서 핸들러 throw 는 재전달 루프가 아니라 "조용한 소실"이다.** 둘 중 하나일 거라 적어뒀는데 답은 후자였고, 그 편이 나쁘다. `libs/events/src/transport/handler-failure.spec.ts` 가 두 배선을 나란히 실행해 박아뒀다:

| | 옛 배선 (`connectMicroservice(opts)`) | `startConsumer` |
|---|---|---|
| 핸들러 실행 횟수 | **1회** (재시도 없음) | `@RetryPolicy` 대로 (기본 1+3) |
| DLQ | **0건** | 1건 (원본 토픽·에러 이름 보존) |
| 에러의 최후 | **아무 데도 안 남는다** | 인터셉터가 삼킴 → offset commit |

마지막 칸이 핵심이다. Nest 의 `Server.handleEvent` 는 핸들러가 Observable 을 돌려주면 `connectable(...).connect()` 로 **구독만 하고 기다리지 않으며**(`server.js:105–117`), 그 connector 는 구독자 없는 `Subject` 라 에러가 흘러들어와도 `hasError` 만 세워지고 보고되지 않는다 — rxjs 의 unhandled-error 경로조차 타지 않는다(별도 스크립트로 실행 확인: `uncaughtException`·`unhandledRejection` 둘 다 안 뜬다). 그 사이 `handleEvent` 는 이미 정상 resolve 했으므로 offset 은 전진한다. **즉 지금까지 실패한 소비는 로그 한 줄 없이 사라져 왔다.** 하네스에서만 `broker.deliveryFailures` 로 보이는데, 그건 인메모리 서버가 동기 배달 보장을 위해 그 Observable 을 기다리기 때문이고 **운영에는 그 관찰 창구가 없다.** 스펙 상단 주석에 그 비대칭을 적어뒀다.

**부팅 거부 위험은 0으로 확인했다.** `startConsumer` 는 ① 레지스트리에 없는 토픽 ② 핸들러 0개 에서 부팅을 거부하므로, 이주가 곧 부팅 실패가 될 수 있다. 7개 앱의 `(등록된 컨트롤러 → @On → 토픽)` 집합을 정적으로 재현해 전수 확인했다 — 핸들러 0개인 앱 없음, 레지스트리 밖 토픽 없음.

| 앱 | 핸들러 | 도출 토픽 |
|---|---:|---:|
| core | 4 | 1 |
| notification | 22 | 3 |
| membership | 10 | 1 |
| wallet | 4 | 2 |
| analytics | 10 | 3 |
| search | 3 | 2 |
| channel-adapter | 34 | **9** |

- **플랜의 앱별 핸들러 수 표가 2건 낡았다** — analytics·membership 은 11 이 아니라 **10** 이다(합계 89 가 아니라 87). 87 은 5-A 가 이주한 수와 정확히 일치하고, `@On` 원시 grep 도 87 이다. `controllers:[]` 에 등록되지 않은 `@On` 핸들러는 **0개**임도 같이 확인했다(있었다면 그게 ADR 의 "가장 조용한 실수"의 실례였을 것).
- **channel-adapter 의 도출 토픽이 9개다** — 옛 `forConsumer` 목록의 6개가 아니다. 빠져 있던 `users.events.v1` · `core.orders.events.v1` · `payments.events.v1` 이 바로 2026-08-08 리뷰가 "구독되지 않는다"고 오판한 그 세 개다. 도출은 처음부터 옳은 값을 낸다.

**C 분리 — 4개 앱에 `validateOnConsume: false` 명시.** core·analytics·search 는 각자의 `forConsumerModule` 에 넣었다. **channel-adapter 는 선언할 자리 자체가 없었다** (`forConsumerModule` 미호출 → `EVENTS_CONSUMER_POLICY` 토큰 부재 → `optionalGet` 이 undefined → 기본값 `true`). `forConsumerModule` 을 새로 부르지 않았다 — 그 표면은 `streams` 를 필수로 받는데 그 목록이야말로 이 워크스트림이 지우는 중인 두 번째 진실이다. 필요한 건 정책 하나뿐이라 `adapter.module.ts` 의 providers 에 `EVENTS_CONSUMER_POLICY` 를 직접 등록했다. Task 7 의 `forApp` 이 이 자리를 흡수한다. 이것으로 ADR Follow-up 8 (channel-adapter 소비 검증 구멍)은 "이주에 묶는다"로 결정됐다.

**⚠️ idempotency 확인 결과 — notification 1개 앱만 재실행에 안전하지 않다.** 재시도가 처음으로 실재하게 되므로 87개 핸들러를 전수로 훑었다. 표면 grep 은 얕아서(가드가 컨슈머가 아니라 서비스에 있다) 서비스까지 따라 들어갔다.

| 앱 | 재실행 안전 | 근거 |
|---|---|---|
| core (4) | ✅ | `checkAndRecordEvent(envelope.messageId)` 를 도메인 tx 안에서 — 중복이면 즉시 return |
| channel-adapter (34) | ✅ | 핸들러는 `inbox_events` 단일 insert 만 한다. 외부 API 호출은 `InboxWorkerService` 소관이라 재시도 범위 밖 |
| membership (10) | ✅ | billing/invoice 결과에 unique 마커 `(contract, intent, eventType)` → 충돌 시 skip. `voidByPaymentIntent` 는 `status === 'CANCELLED'` 가드 |
| wallet (4) | ✅ | idempotency key |
| analytics (10) | ✅ | fact 테이블 `onConflictDoNothing(messageId)`, dimension 은 upsert |
| search (3) | ✅ | 문서 ID 고정 upsert / delete |
| **notification (22)** | ⚠️ | **멱등 키 없음** |

`NotificationDispatcherService.send` 는 `dto.channels` 를 루프 돌며 채널마다 `notifications` 행을 insert 하고 큐에 넣는다. 멱등 키가 없어, **채널 1이 성공한 뒤 채널 2에서 throw 하면 재시도가 루프를 처음부터 다시 돌아 채널 1이 다시 발송된다.** 다만 노출은 좁다 — 프로바이더 전송 실패는 `sendNotificationDirectly` 의 `catch` 가 삼키고 행을 FAILED 로만 바꾸므로 핸들러까지 올라오지 않는다. 실제로 throw 하는 건 DB/템플릿 조회 실패 정도다. 그 경우 옛 배선에서는 메시지가 통째로 소실됐고, 새 배선에서는 앞 채널이 최대 4회 중복될 수 있다. **고치지 않았다** — 5-B 의 항목은 "확인"이고, 수정은 dedup 키(+마이그레이션)를 요구해 이 PR 의 blast radius 를 바꾼다. ADR Follow-up 11 로 올렸다.

- `start-consumer.spec.ts` 의 "옛 배선" describe 는 **아직 지우지 않았다.** Task 5 완료 기준은 grep 3종(`forConsumer` 0 · `@OnEvent` 0 · 7앱 이주)이 충족되면 지우라고 하고 지금 셋 다 충족이지만, 이 레포는 autodeploy 가 없어(ADR-0005 §4) **배포 전까지 라이브는 여전히 옛 배선**이다. 즉 그 describe 의 주장은 지금도 참이다. 삭제 시점을 "5-B 배포 후"로 못박는 주석으로 바꾸고 이름만 `현재 앱 배선` → `옛 앱 배선` 으로 고쳤다.
- 검증: `npm run type-check` **164 — HEAD 기준선과 file:line:code 집합 완전 동일**(신규 0 · 소멸 0) · **10개 앱 전부 `nest build` 초록** · `libs/events`+계약 패키지 **18 suite / 157 tests 초록**(5-A 대비 +1 suite / +6 tests) · 전체 jest **실패 suite 18개 = 기준선과 동일**(통과 3019, 5-A 대비 +6) · AST 게이트 `npm run audit:event-handlers` exit 0 (87 핸들러 / `@OnEvent` 0) · 변경 파일 eslint **메시지 집합이 기준선과 완전 동일**(신규 0), 신규 스펙 파일은 clean.
- **5-C 에 넘기는 사실:** 4개 앱의 `validateOnConsume: false` 는 **현상 유지 표식**이지 결정이 아니다. 지우는 순간 검증이 켜진다. notification·membership·wallet 의 `false` 는 원래부터 있던 것이며 5-C 에서도 해당 없음이다. 그리고 이제 4개 앱 전부 `EVENTS_CONSUMER_POLICY` 를 실제로 갖고 있으므로, 5-C 는 이 한 줄을 앱별로 뒤집는 작업이 된다.

### Task 5-C: 검증 켜기 — 앱별, 게이트

- [x] notification · membership · wallet 은 **해당 없음** — 명시 `false` 가 정상 상태다. 5-A + 5-B 로 종결
- [x] 나머지 4개 앱: 인바운드 payload 가 실제로 zod 스키마를 만족하는지 **먼저** 확인 ~~(스테이징 샘플링 또는 5-B 상태에서 로그 관찰)~~ → **둘 다 불가능해 발행 경로 전수 폐쇄로 대체.** 아래 참조
- [x] core 를 먼저 켜고 ~~DLQ 대시보드로 관찰한다~~ → **켰다.** 관찰은 배포 후 사람 몫 (아래 배포 체크리스트)
- [x] core 밖으로 나가기 전에 DLQ 관측 범위를 넓힐지, 로그 기반으로 갈지 결정한다 → **둘 다 아니다. 게이트는 Task 6 이다** (아래)
- [x] `validateOnConsume` 명시를 걷어내거나 `true` 로 전환 → core 만 `true`. 나머지 3개는 Task 6 뒤로

**완료 (2026-08-09).** 브랜치 `docs/plan-task5-split`.

**샘플링이 불가능해서 정적 증명으로 갈아탔다.** 이 항목이 지시한 두 방법이 지금 둘 다 존재하지 않는다 — AWS `dev` stage 는 폐기됐고, 5-B 는 배포 전이라 검증 인터셉터가 아직 안 붙어 관찰할 로그가 생기지 않는다. 플랜대로면 5-C 가 배포를 기다리고 배포는 5-C 를 기다리는 순환이 된다. 대신 **발행 경로를 전수로 닫았다** (ADR-0029 §8 "검증 스위치(C)" 절이 정본):

1. 프로덕션 코드에서 `kafkajs` 를 직접 잡는 곳 **0곳** → 모든 발행이 `StreamPublisher` 를 지난다.
2. `publishEvent` 는 envelope 에 **zod 파싱 결과**를 싣는다(`stream-publisher.service.ts:123`). 파싱은 멱등이므로 그 경로로 나간 payload 는 소비 검증을 **반드시** 통과한다. `validateOnPublish: false` 인 곳은 레포에 없다.
3. 남는 것은 `publishRawEnvelope` 뿐이고 호출자는 **2곳**이다 (공용 outbox · wallet outbox). core·channel-adapter 의 자체 outbox dispatcher 는 `publishEvent` 를 부르므로 우회가 아니다 — 이 구분이 판정을 크게 바꿨다(초기 분석은 "모든 outbox = 우회"로 잡아 UNVERIFIED 를 36건으로 과대집계했다).

도구는 `scripts/events/consume-validation-readiness.ts` (`npm run audit:consume-validation`). 스키마 강도는 zod 내부를 읽지 않고 **실행해서**(`safeParse({})`) 분류한다.

| 앱 | 이벤트 | SAFE | PROVEN | UNVERIFIED | 결과 |
|---|---:|---:|---:|---:|---|
| **core** | 4 | 0 | **4** | **0** | ✅ **켰다** |
| notification | 22 | 1 | 21 | 0 | 해당 없음 |
| wallet | 4 | 0 | 4 | 0 | 해당 없음 |
| analytics | 10 | 0 | 7 | **3** | ⏸ Task 6 뒤 |
| search | 3 | 0 | 1 | **2** | ⏸ Task 6 뒤 |
| channel-adapter | 34 | 11 | 19 | **4** | ⏸ Task 6 뒤 |
| membership | 10 | 5 | 0 | 5 | 해당 없음 |

**🔴 순서를 뒤집었다 — 나머지 3개 앱의 게이트는 관측성이 아니라 Task 6 이다.** 세 앱을 막는 UNVERIFIED 는 전부 같은 원인의 **4개 이벤트**다: `MembershipStatusChanged` · `ProductMasterActiveVersionChanged` · `ProductMasterDeleted` · `CategoryChanged`. 넷 다 `OutboxPublisher.saveEvent` 로 적재돼 `publishRawEnvelope` 로 나간다. Task 6 의 "enqueue 시점 zod 검증"이 정확히 이 구멍이며, 들어가는 순간 넷 다 기계적으로 PROVEN 이 된다. 5-C 를 먼저 하면 payload 를 추측해야 하고, Task 6 을 먼저 하면 추측할 것이 남지 않는다. 게다가 Task 6 은 실패를 **발행자의 도메인 트랜잭션**에서 드러내므로 소비자 DLQ 에서 사후 발견하는 것보다 진단 위치가 낫다. **ADR-0029 §8 과 Follow-up 6 을 먼저 고쳤다.**

**남은 5-C 대상은 3개가 아니라 4개다 (2026-08-09 게이트 리포트 실측).** `membership` 도 UNVERIFIED 5건으로 같은 처지인데 5-C 논의에서 빠져 있었다 — 6-A 후에 함께 판정한다. **판정 완료: 원인이 달랐다** — 그 5건은 core 카탈로그의 `saveEvent` 가 아니라 wallet 이 자기 outbox 테이블에 직접 insert 하는 `invoice.*`/`mandate.rejected` 행이었다. 6-A 가 `enqueue` 와 `publishStoredEnvelope` 두 문을 다 달았기에 함께 풀렸다. 반대로 **`notification`(UNVERIFIED 0 · PROVEN 21) 과 `wallet`(PROVEN 4) 은 이미 `켜도 안전`** 이다. 두 앱의 `validateOnConsume: false` 는 이 워크스트림 이전부터의 **의도**(notification 은 "HTTP 요청과 충돌 방지" 주석)이므로 그대로 두되, **Task 7 에서 정책을 `forApp` 으로 옮길 때 그 `false` 를 반드시 보존해야 한다** — 안 그러면 의도치 않게 켜진다.

- **core 를 켠 근거:** 4개 이벤트가 전부 `orders.events.v1` 이고 발행자 셋(channel-adapter order publisher 2벌 + 자체 outbox dispatcher)이 모두 `publishEvent` 를 지난다. `OrderRefundCreated` 는 발행자가 아예 없다. 우회 2곳 중 어느 것도 이 토픽에 닿지 않는다. core 는 **DLQ 가 관측되는 유일한 앱**이라(`dlq.metrics.ts:10`) 증명이 틀렸을 때 알아차릴 수 있는 유일한 앱이기도 하다.
- **분석을 상시 불변식으로 바꿨다.** `--gate` 는 *검증을 켜 둔 앱*에 UNVERIFIED 가 생기면 exit 1 한다 — core 에 나중에 outbox 발행 이벤트 핸들러를 추가하면 CI 가 막는다. 게이트가 실제로 무는 것을 확인했다(search 를 일부러 `true` 로 바꿔 exit 1 재현 후 원복). 게이트는 자기 가정도 감시한다: `publishRawEnvelope` 호출 지점을 AST 로 세어 손으로 유지하는 우회 목록과 어긋나면 실패하며, **첫 실행에서 실제로 걸렸다** — grep 판본이 내가 방금 쓴 근거 주석 속 함수명을 세 번째 "호출자"로 집계했다. 그래서 AST 로 바꿨다.
- **켜는 비용이 낮다는 것도 실행으로 고정했다.** `SchemaValidationError` 는 `nonRetryableErrors` 에 강제 편입되므로(`event-retry.interceptor.ts:91`) 위반 메시지는 백오프 없이 즉시 DLQ 로 가고 offset 이 전진한다 — 재시도 폭풍으로 파티션이 막히지 않는다. `libs/events/src/transport/consume-validation.spec.ts` 가 이것과 멱등성을 함께 고정하며, 재시도 억제는 **대조군**(스키마와 무관한 에러는 같은 `@RetryPolicy` 로 4회 실행)과 나란히 두었다 — 대조군이 없으면 `maxRetries` 를 0으로 바꿔도 초록이라 아무것도 증명하지 못한다. 검증을 끄는 변이를 넣어 6개 중 3개가 실패하는 것도 확인했다.
- **부수 정정:** channel-adapter 를 "외부 유래 payload 라 가장 위험"이라고 적어온 서술은 소비 측에는 맞지 않는다. 외부 payload 는 HTTP 로 들어와 이 앱이 *발행측*에서 정규화하므로, 소비하는 34개는 전부 내부 발행이다(프로덕션 `kafkajs` 직접 사용 0곳으로 확인). 남은 위험은 외부성이 아니라 outbox 우회다.

**⚠️ 배포 후 사람이 할 것 (core):** 배포 시점에 core 는 **배선(B)과 검증(C)이 같이 켜진다** — 5-B 도 아직 미배포이기 때문이다. `events_dlq_messages_total{topic="orders.events.v1"}` 을 확인한다. 0 이 아니면 계약 이전에 토픽에 쌓인 옛 메시지이거나(이 증명이 덮지 않는 유일한 구멍) 증명이 틀린 것이며, 되돌리기는 그 한 줄을 `false` 로 바꾸는 것이다.

### 권장 순서 (2026-08-09 갱신)

```
5-A   데코레이터 일괄 (7앱)                    ✅ 완료 · 위험 0 · AST 게이트
5-B   7개 앱 배선 일괄                         ✅ 완료
5-C   core                                     ✅ 완료 — 정적 증명 · 관측 가능한 유일 앱
──────────────────────────────────────────────────────────────
6-A   outbox enqueue 시점 zod 검증            ✅ 완료 — UNVERIFIED 14 → 0
5-C   analytics · search · channel-adapter     남은 것은 `validateOnConsume` 한 줄을 뒤집는 결정뿐
      (+ membership — 원인이 달랐으나 6-A 가 함께 풀었다)
6-B   @InjectStreamPublisher → @InjectPublisher (26곳)
6-C   outbox 5벌 회수 (Task 0 선행)
```

**완료 기준:** 7개 앱 전부 `startConsumer` 를 쓰고, `forConsumer` 호출이 0건이며, `@OnEvent` 호출이 0건이다. `start-consumer.spec.ts` 의 "옛 배선" describe 를 삭제한다 (그게 초록이라는 사실이 라이브 결함의 증거였다). ⚠️ **삭제 시점은 5-B 배포 후다** — 배포 전까지 라이브는 여전히 옛 배선이라 그 describe 의 주장은 아직 참이다.

---

## Task 6: 발행 경로 통합 + outbox 회수

> ⚠️ **이 태스크가 5-C 의 나머지 3개 앱을 막고 있다** (2026-08-09, ADR-0029 Follow-up 6). analytics·search·channel-adapter 에서 검증을 못 켜는 원인은 관측성이 아니라 `saveEvent`→`publishRawEnvelope` 의 zod 우회다. 아래 "enqueue 시점 zod 검증"이 들어가면 막고 있던 4개 이벤트(`MembershipStatusChanged` · `ProductMasterActiveVersionChanged` · `ProductMasterDeleted` · `CategoryChanged`)가 기계적으로 PROVEN 이 된다. **완료 후 `npm run audit:consume-validation` 이 그 세 앱을 `켜도 안전` 으로 바꾸는지 확인하고, 그 시점에 5-C 를 마저 끝낸다.**

**Task 5 완료 후 실측(2026-08-09)이 이 태스크를 세 조각으로 갈랐다.** 원안은 한 PR 을 가정했으나 두 사실이 그걸 막는다:

- `@InjectStreamPublisher` 는 플랜이 적은 21곳이 아니라 **26곳**이다 (core 7 · user-service 7 · libs/events 5 · channel-adapter 3 · membership 2 · ugc-service 2). **`user-service`·`ugc-service` 는 이 워크스트림이 한 번도 건드리지 않은 앱**이다 — Task 5 의 이주 대상(소비 7앱)과 집합이 다르다.
- outbox 5벌은 **서로 다른 테이블**에 쓴다 (`outbox_events` / `wmsTables.outboxEvents` / wallet 자체 스키마). 회수는 리팩터가 아니라 **앱 간 데이터 마이그레이션**이다.

그리고 **5-C 를 막고 있는 것은 6-A 하나뿐**이다. 6-B·6-C 를 기다릴 이유가 없다.

### Task 6-A: enqueue 시점 zod 검증 (5-C 를 푸는 최소 변경) — ✅ 완료 (2026-08-09)

- [x] `PublisherFor<S>` 에 `enqueue(…, tx)` 를 둔다 — `publishEvent` 와 같은 타입 도출, 같은 검증. **인자 모양도 `publishEvent` 와 같게 했다**(`enqueue({ eventType, aggregateId, payload }, tx)`) — 원안의 `enqueue('Name', {…}, tx)` 를 쓰면 "다른 건 배달 방식뿐"이 문서에서만 참이 된다. 적재 대상은 `OutboxWriter` port 로 받는다(publisher 가 drizzle 을 알면 §7 seam 이 무너진다)
- [x] **`enqueue` 시점에 zod 검증** — 잘못된 payload 가 poison row 가 되는 대신 도메인 트랜잭션을 실패시킨다
- [x] `publishRawEnvelope` 의 zod 우회 제거 — **이름째 없애고** `publishStoredEnvelope`(검증함)로 대체. 호출자 2곳 모두 이주
- [x] **`publishCommand` 에도 검증 추가 (계획에 없던 것).** 5-C 의 "발행 경로 전수 폐쇄" 논증이 세지 않은 **네 번째 경로**였다. 호출자는 ugc-service 1곳뿐이라 실해는 없었지만, 그 논증이 wallet 을 `켜도 안전`으로 판정한 근거에는 구멍이 있었다
- [x] `OutboxPublisher.saveEvent` 삭제 — 호출부 5곳(core 카탈로그 4 · membership 1)을 `enqueue` 로 이주. 검증 없는 적재 API 를 남기면 새 호출자가 우회를 조용히 되살린다
- [x] Task 2 하네스 스펙 `libs/events/src/outbox/enqueue-validation.spec.ts` (7건) — **대조군 포함**: `validateOnPublish: false` publisher 로 같은 payload 가 적재되고, 같은 poison envelope 가 발행되는 것을 나란히 둔다
- [x] `npm run audit:consume-validation` 판정 — **UNVERIFIED 14 → 0.** analytics·search·channel-adapter 가 `켜기 전 사람 확인 필요` → `켜도 안전` 으로 바뀌었다. **membership(5건)도 함께 풀렸다 — 원인이 달랐다**: 그 5건은 `saveEvent` 가 아니라 wallet 이 자기 outbox 테이블에 직접 insert 하는 행에서 왔고, `enqueue` 문이 아니라 `publishStoredEnvelope` 문이 닫았다
- [x] 게이트 재설계 — 우회 목록 대신 **우회가 다시 생기지 않는 것**을 지킨다(`transport.send` 호출 지점 · `sendMessage` 호출 메서드 · `validateOnPublish: false` 부재 · `publishRawEnvelope` 부재, 전부 AST). 변이 2종으로 exit 1 재현 확인
- [x] 계약 구멍 1건 수정 — `CategoryChanged.ancestors` 가 payload 인터페이스에만 있고 스키마에 없어, 검증이 켜지면 **조용히 strip** 됐다(channel-adapter 의 Medusa 부모 카테고리 보장이 그 배열을 읽는다). optional 로 추가(additive). 회귀 네트는 "통과"가 아니라 **"손실 없이 통과"** 를 단언한다

**게이트 실측:** `type-check` 164 = 기준선 · `audit:event-handlers` exit 0 · `audit:consume-validation --gate` exit 0 · jest 실패 suite **18 = 기준선**(집합 동일, 신규 0) · 10개 앱 `nest build` 전부 OK.

**⚠️ 배포 전 결정 1건 (사람):** wallet 아웃박스에 **이 배포 시점에 PENDING 으로 남아 있는 행**은 `enqueue` 를 지나지 않았으므로 `publishStoredEnvelope` 에서 처음 검증을 만난다. 위반하면 발행되지 않고 백오프 후 `DEAD_LETTER` 로 남는다(옛 동작: 그대로 발행). 정적으로는 안전하다 — wallet 의 `invoice.*`/`mandate.rejected` payload 는 전부 계약 타입으로 빌드되고(`invoice-event.builder.ts`), `payment.intent.*`/`gateway.*` 스키마는 `catchall` 이라 확장 필드를 보존한다. 그래도 배포 직후 `outbox_events` 의 `DEAD_LETTER`/`FAILED` 증가와 `lastErrorCode` 를 한 번 본다.

### Task 6-B: `@InjectStreamPublisher` → `@InjectPublisher` (26곳)

- [ ] 5-A 가 "발행 표면이라 PR 경계가 깔끔하다"는 이유로 미뤄둔 것. 동작 중립
- [ ] `user-service`(7) · `ugc-service`(2) 는 소비 이주를 하지 않은 앱이다 — `startConsumer` 를 부르지 않으므로 **발행 표면만** 바꾼다

### Task 6-C: outbox 5벌 회수 (데이터 마이그레이션 성격)

- [ ] **선행: Task 0** — core 의 `outbox.service.ts` 2벌(fulfillment · inventory/shared, import 경로만 다름)을 먼저 합친다. 안 하면 같은 회수를 두 번 한다
- [ ] 공용 outbox 스키마에 `idempotencyKey` · `partitionKey` 추가 (core 판본과 기능 동등하게) — **이게 5벌이 생긴 원인이다.** 공용이 부족해서 각자 만든 것이지 우회한 게 아니다
- [ ] 앱 자체 판본을 하나씩 회수 — core · wallet · channel-adapter
- [ ] **마이그레이션은 expand phase 이므로 `migrate → deploy` 순서** (CLAUDE.md 의 phase 별 순서 주의 — contract phase 와 반대다)
- [ ] 테이블이 다르므로 **기존 미발행 행의 이관 전략을 먼저 정한다** (dual-write 후 드레인 / 옛 dispatcher 를 큐가 빌 때까지 유지 / 그 외)

각 조각의 공통 게이트: `npm run type-check` **164** · `audit:event-handlers` exit 0 · `audit:consume-validation --gate` exit 0 · 전체 jest 실패 suite **18 = 기준선** · 10개 앱 `nest build`.

**완료 기준:** outbox 경로가 검증되고, `wmsTables.outboxEvents`/`outbox_events` 에 쓰는 코드가 공용 인터페이스 하나를 지나며, `@InjectStreamPublisher` 사용처가 0건이다.

---

## Task 7: 옛 표면 제거 (contract phase)

**Task 5 가 전부 끝나고 배포가 완료된 뒤에만 착수한다.**

- [ ] `forConsumer` 삭제
- [ ] `forConsumerModule` 을 `forApp` 으로 흡수하거나 삭제
- [ ] `@OnEvent` / `@InjectStreamPublisher` 삭제
- [ ] `npm run type-check` 초록 · 전 앱 `nest build` 초록 · 커밋 · 푸시

**완료 기준:** 등록 표면이 `forApp` + `startConsumer` 둘뿐이다.

---

## 완료 기준 (워크스트림 전체)

- [x] `grep -rn "forConsumer(" apps --include=*.ts | grep -v spec` 결과가 0건 — 5-B
- [x] `grep -rn "@OnEvent(" apps --include=*.ts | grep -v spec` 결과가 0건 — 5-A
- [x] `EventKeysOf` / `EventPayloadOf` 사용처가 0건이 아니다 — 5-A (87 핸들러)
- [x] 인메모리 어댑터로 발행→소비 왕복이 테스트된다 — Task 2
- [x] outbox enqueue 가 zod 검증을 탄다 — Task 6-A
- [x] `libs/events/src` 스펙 파일 수가 5개보다 많다 — 현재 11
- [x] 컨트롤러를 `controllers: []` 에 등록하지 않으면 부팅이 실패한다 — Task 3 에서 구현, 5-B 로 7개 앱 전부에 실효
- [ ] `npm run type-check` 가 이 워크스트림으로 새 오류를 만들지 않았다 — 5-B 까지 164 유지. Task 6·7 후 최종 확인
- [x] ADR-0029 의 Status 가 Accepted 로 갱신됐다

---

## 세션 간 인수인계

현재 위치는 **메모리 `events-module-redesign.md`** 가 SoT 다. 이 플랜의 체크박스는 그 다음이다 — 체크박스는 커밋됐지만 푸시 안 된 상태를 구분하지 못한다.

새 세션 시작 시:

1. 메모리 `events-module-redesign.md` 를 읽는다
2. `git log --oneline origin/develop..develop` 과 `git status --short` 로 **미푸시/미커밋** 을 확인한다
3. ADR-0029 를 읽는다 (설계 질문의 답은 전부 거기 있다)
4. 이 플랜의 다음 미체크 태스크로 간다
