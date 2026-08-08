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

- [ ] `@On(STREAM, 'EventName')` — 이벤트명을 `EventKeysOf` 로 좁힌다
- [ ] `@Payload()` + `EventPayloadOf<typeof STREAM, 'EventName'>` 로 payload 타입이 계약에서 도출되게 한다
- [ ] `@InjectPublisher(STREAM)` + `PublisherFor<typeof STREAM>` — 문자열 토큰과 제네릭 두 사실을 하나로
- [ ] 타입 레벨 스펙: 잘못된 이벤트명이 컴파일 에러가 되는지 (`@ts-expect-error`)
- [ ] `npm run type-check` 초록 · 커밋 · 푸시

**완료 기준:** 새 데코레이터가 존재하고 타입이 도출되며, 옛 데코레이터도 그대로 동작한다.

---

## Task 5: 앱별 이주 (7 PR)

**앱 하나 = PR 하나 = 세션 하나.** 순서는 위험도 역순 — 작은 앱부터 배워서 큰 앱으로 간다.

권장 순서와 규모 (핸들러 / 발행 / outbox):

- [ ] 5a. `search` (3 / — / —)
- [ ] 5b. `wallet` (4 / — / —)
- [ ] 5c. `core` (4 / 8 / 25)
- [ ] 5d. `analytics` (11 / — / —)
- [ ] 5e. `membership` (11 / 4 / 1)
- [ ] 5f. `notification` (22 / — / 1)
- [ ] 5g. `channel-adapter` (34 / 8 / 10) — **마지막.** 유일하게 `forConsumerModule` 을 호출하지 않는 앱이라 이주 시 처음으로 소비 측 zod 검증이 켜진다

각 앱에서:

- [ ] `main.ts` 를 `startConsumer(app, { groupId })` 로 교체 (streams 인자 제거)
- [ ] `@OnEvent` → `@On`, `@InjectStreamPublisher` → `@InjectPublisher` 로 이주
- [ ] `nest build <app>` · `npm run type-check` 초록
- [ ] 커밋 · 푸시 · **배포 후 다음 앱으로**

**⚠️ 이주는 동작 중립이 아니다 — 7개 앱 전부에 해당 (Task 3 발견, ADR-0029 §8).**

원래 이 경고는 5g(channel-adapter) 에만 붙어 있었다. Task 3 이 밝혀낸 바에 따르면 **7개 앱 모두** 지금 소비 측 스키마 검증·재시도·DLQ 가 적용되지 않고 있다 — `app.connectMicroservice(opts)` 가 빈 `ApplicationConfig` 를 만들기 때문이다. `startConsumer` 로 이주하는 순간 그 앱에서 이 셋이 **처음으로 켜진다.**

따라서 각 앱 이주 PR 은 다음을 포함해야 한다:

- [ ] 그 앱의 `validateOnConsume` 선언 확인. `false` 를 명시한 앱(notification·membership·wallet)은 검증이 계속 꺼진 채 이주하므로 위험이 낮다. 명시하지 않은 앱(core·analytics·search = 기본값 `true`)과 `forConsumerModule` 자체가 없는 앱(channel-adapter)은 **이주가 곧 검증 활성화**다.
- [ ] 검증이 새로 켜지는 앱은 인바운드 payload 가 실제로 zod 스키마를 만족하는지 먼저 확인한다. 확인 없이 이주하면 **이주 자체가 DLQ 폭탄이 된다.** 확인 방법은 착수 시 결정 — 스테이징 트래픽 샘플링 또는 `validateOnConsume: false` 로 먼저 붙이고 로그만 관찰.
- [ ] 재시도·DLQ 가 새로 켜지는 것은 **전 앱 공통**이다. 지금까지 핸들러 에러는 아무 분류 없이 Nest 기본 경로로 갔다. 이주 후에는 `@RetryPolicy` 분류 → backoff 재시도 → DLQ 로 흐른다. 그 앱의 핸들러가 idempotent 한지 확인한다 (재시도가 처음으로 실재하게 된다).

**완료 기준:** 7개 앱 전부 `startConsumer` 를 쓰고, `forConsumer` 호출이 0건이다.

---

## Task 6: 발행 경로 통합 + outbox 회수

- [ ] `PublisherFor<S>` 에 `publish(eventName, {...})` 와 `enqueue(eventName, {...}, tx)` 를 함께 둔다
- [ ] **`enqueue` 시점에 zod 검증** — 잘못된 payload 가 poison row 가 되는 대신 도메인 트랜잭션을 실패시킨다
- [ ] `publishRawEnvelope` 의 zod 우회 제거
- [ ] 공용 outbox 스키마에 `idempotencyKey` · `partitionKey` 추가 (core 판본과 기능 동등하게)
- [ ] 앱 자체 outbox 판본을 하나씩 회수 — core(Task 0 이후 1벌) · wallet · channel-adapter
- [ ] Task 2 하네스로 "잘못된 payload → enqueue 실패" 를 증명하는 스펙
- [ ] 마이그레이션이 필요하면 **expand phase 이므로 `migrate → deploy` 순서** (CLAUDE.md 의 phase 별 순서 주의)
- [ ] `npm run type-check` 초록 · 커밋 · 푸시

**완료 기준:** outbox 경로가 검증되고, `wmsTables.outboxEvents`/`outbox_events` 에 쓰는 코드가 공용 인터페이스 하나를 지난다.

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

- [ ] `grep -rn "forConsumer(" apps --include=*.ts | grep -v spec` 결과가 0건
- [ ] `grep -rn "@OnEvent(" apps --include=*.ts | grep -v spec` 결과가 0건
- [ ] `EventKeysOf` / `EventPayloadOf` 사용처가 0건이 아니다
- [ ] 인메모리 어댑터로 발행→소비 왕복이 테스트된다
- [ ] outbox enqueue 가 zod 검증을 탄다
- [ ] `libs/events/src` 스펙 파일 수가 5개보다 많다
- [ ] 컨트롤러를 `controllers: []` 에 등록하지 않으면 부팅이 실패한다
- [ ] `npm run type-check` 가 이 워크스트림으로 새 오류를 만들지 않았다
- [ ] ADR-0029 의 Status 가 Accepted 로 갱신됐다

---

## 세션 간 인수인계

현재 위치는 **메모리 `events-module-redesign.md`** 가 SoT 다. 이 플랜의 체크박스는 그 다음이다 — 체크박스는 커밋됐지만 푸시 안 된 상태를 구분하지 못한다.

새 세션 시작 시:

1. 메모리 `events-module-redesign.md` 를 읽는다
2. `git log --oneline origin/develop..develop` 과 `git status --short` 로 **미푸시/미커밋** 을 확인한다
3. ADR-0029 를 읽는다 (설계 질문의 답은 전부 거기 있다)
4. 이 플랜의 다음 미체크 태스크로 간다
