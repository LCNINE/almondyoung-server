# Search 컨슈머 재시도/DLQ 배선 (#510) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `apps/search`가 전역 `EventRetryInterceptor`(재시도·DLQ·offset commit) + `SchemaValidationInterceptor` 밖에 있던 유일한 컨슈머 앱인 것을 바로잡아, 포이즌 메시지 시 offset 미커밋 → 무한 재전달을 막는다.

**Architecture:** search는 `main.ts`에서 `EventsModule.forConsumer(...)`로 **Kafka 전송만** 배선하고(어느 토픽을 들을지) 어느 모듈에서도 `EventsModule`을 import하지 않아 DI 컨테이너에 `APP_INTERCEPTOR = EventRetryInterceptor`가 아예 없다. 다른 모든 컨슈머 앱(core·notification·wallet·analytics·channel-adapter)은 **2단 구성** — main.ts `forConsumer`(전송) + 모듈 `forRoot`/`forConsumerModule`(인터셉터 DI 등록) — 인데 search만 2단째가 빠졌다. 해소는 `search.module.ts` imports에 `EventsModule.forConsumerModule(...)`를 **`process.env.KAFKA_BROKERS` 조건부로** 추가(순수 컨슈머라 `forRoot`가 아닌 `forConsumerModule`, publisher 배선 불요). 조건부인 이유는 아래 Global Constraints 참조.

**Tech Stack:** NestJS DI(`APP_INTERCEPTOR`), `@app/events`(`EventsModule.forConsumerModule`, `EventRetryInterceptor`), `@packages/event-contracts`(`PRODUCT_STREAM`, `UGC_EVENT_STREAM`), Jest.

## Global Constraints

- **조건부 import (channel-adapter 판례 `adapter.module.ts:112`)**: `createKafkaConfigFromEnv()`는 `KAFKA_BROKERS` 미설정 시 `null`을 반환하고(`kafka-config.util.ts:17-20`), `@Module` 데코레이터 인자는 import 시점에 평가되므로 **무조건** `forConsumerModule`을 넣으면 브로커 없는 환경에서 `kafka.clientId` null 역참조로 search HTTP 서버 부팅 자체가 실패한다. search의 `main.ts`는 현재 `if (kafkaConfig)`로 Kafka 없이도 뜨게 설계돼 있으므로(`main.ts:22-34`), 모듈 import도 **반드시 `...(process.env.KAFKA_BROKERS ? [ ... ] : [])`** 로 감싸 graceful degradation을 보존한다.
- **streams·groupId는 `main.ts`와 일치**: `streams: [PRODUCT_STREAM, UGC_EVENT_STREAM]`, `groupId: process.env.KAFKA_GROUP_ID || 'search-indexer'` — `main.ts:24-26`와 동일 값. 불일치 시 토픽 부트스트랩/구독 어긋남.
- **`forConsumer`는 그대로 유지**: `main.ts`의 `EventsModule.forConsumer(...)` + `connectMicroservice`가 실제 Kafka 컨슈머를 바인딩한다. `forConsumerModule`은 provider(인터셉터·DLQ·부트스트랩)만 등록하고 `connectMicroservice`를 부르지 않아 **두 번째 컨슈머를 만들지 않는다** — 공존이 정상(analytics·notification·wallet 전부 이 구성). main.ts는 손대지 않는다.
- **스키마 무변경**: DB/마이그레이션 변경 없음. search는 OpenSearch만 쓰고 Postgres/Drizzle 무관 → **dev DB 게이트 없음**(마이그레이션 5건과 달리 지금 완결 가능).
- **검증 스코프(현황판 line 281 공통 규약)**: `nest build search` exit 0 · 변경 파일 **신규** eslint error만(repo 전역 lint는 상시 debt) · admin-web 무변경. 아키텍처 경계 spec(`inventory-write-boundary.arch.spec.ts`)은 inventory 전용이라 search와 무관(해당 없음).
- **런타임 실검증은 이연**: 실제 포이즌 → DLQ → offset commit 관찰은 라이브 Kafka 필요라 배포 환경에서 확인. 로컬에서는 "SearchModule 컨테이너에 인터셉터가 등록됐다"까지 정적으로 봉인(#508과 동일 confidence 수준).

---

### Task 1: SearchModule에 이벤트 재시도/DLQ 인터셉터 배선 + 회귀 가드

**Files:**
- Modify: `apps/search/src/search.module.ts` (imports 배열 + 상단 import 문)
- Test: `apps/search/src/search.module.spec.ts` (신규)

**Interfaces:**
- Consumes:
  - `EventsModule.forConsumerModule(options: { streams; groupId; kafka; enableAutoDLQ })` from `@app/events` — DynamicModule을 반환하며 그 `providers`에 `{ provide: APP_INTERCEPTOR, useClass: EventRetryInterceptor }`를 **첫 번째 전역 인터셉터**로 등록(`events.module.ts:265-268,302-306`).
  - `createKafkaConfigFromEnv(): KafkaConfig | null` from `@app/events`.
  - `EventRetryInterceptor` from `@app/events`(`index.ts:36`에서 re-export).
  - `PRODUCT_STREAM`, `UGC_EVENT_STREAM` from `@packages/event-contracts`(`main.ts:6`이 이미 동일 경로에서 import).
- Produces: 없음(앱 배선 종단 — 후속 태스크 없음).

- [ ] **Step 1: 회귀 가드 스펙 작성 (실패하는 테스트)**

`apps/search/src/search.module.spec.ts` 생성:

```typescript
/**
 * #510 회귀 가드: SearchModule 이 EventsModule.forConsumerModule 을 통해
 * 전역 EventRetryInterceptor(재시도/DLQ/offset commit)를 실제로 등록하는지 봉인한다.
 *
 * SearchModule 의 imports 는 process.env.KAFKA_BROKERS 조건부(channel-adapter 판례)이므로
 * 브로커를 설정/해제한 뒤 모듈을 fresh 로 로드한다. 컨테이너를 compile 하지 않고 @Module
 * 메타데이터('imports')만 정적 검사하므로 OpenSearch/Kafka 등 라이브 인프라가 불필요하다.
 * (require 는 @Module 데코레이터 인자만 평가할 뿐 provider 를 인스턴스화하지 않는다.)
 */
import 'reflect-metadata';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { EventRetryInterceptor } from '@app/events';

type AppInterceptorProvider = { provide?: unknown; useClass?: unknown };
type DynamicModuleLike = { providers?: AppInterceptorProvider[] };

function loadSearchModuleImports(): unknown[] {
  let SearchModule: unknown;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    SearchModule = require('./search.module').SearchModule;
  });
  // Nest 의 MODULE_METADATA.IMPORTS 키는 문자열 'imports' 다.
  return (Reflect.getMetadata('imports', SearchModule as object) ?? []) as unknown[];
}

function isDynamicModuleWithProviders(m: unknown): m is DynamicModuleLike {
  return typeof m === 'object' && m !== null && Array.isArray((m as DynamicModuleLike).providers);
}

describe('SearchModule 이벤트 재시도/DLQ 배선 (#510)', () => {
  const ORIGINAL = process.env.KAFKA_BROKERS;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.KAFKA_BROKERS;
    else process.env.KAFKA_BROKERS = ORIGINAL;
  });

  it('KAFKA_BROKERS 설정 시 EventRetryInterceptor 를 전역 APP_INTERCEPTOR 로 등록한다', () => {
    process.env.KAFKA_BROKERS = 'localhost:9092';

    const imports = loadSearchModuleImports();
    const registersRetryInterceptor = imports
      .filter(isDynamicModuleWithProviders)
      .some((m) =>
        m.providers!.some(
          (p) => p.provide === APP_INTERCEPTOR && p.useClass === EventRetryInterceptor,
        ),
      );

    expect(registersRetryInterceptor).toBe(true);
  });

  it('KAFKA_BROKERS 미설정 시 전역 인터셉터를 등록하지 않는다 (graceful degradation 보존)', () => {
    delete process.env.KAFKA_BROKERS;

    const imports = loadSearchModuleImports();
    const registersAnyAppInterceptor = imports
      .filter(isDynamicModuleWithProviders)
      .some((m) => m.providers!.some((p) => p.provide === APP_INTERCEPTOR));

    expect(registersAnyAppInterceptor).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx jest --config apps/search/../../jest.config.js apps/search/src/search.module.spec.ts` 
(레포 표준: `npx jest apps/search/src/search.module.spec.ts` — 루트 jest 설정이 monorepo 전체를 커버)

Expected: 첫 번째 테스트 FAIL — `expect(registersRetryInterceptor).toBe(true)`가 `false`. 현재 `search.module.ts`는 `EventsModule`을 import하지 않으므로 imports에 인터셉터 등록 provider가 없다. 두 번째 테스트는 PASS(아직 아무 인터셉터도 없으므로).

- [ ] **Step 3: SearchModule에 조건부 forConsumerModule 배선**

`apps/search/src/search.module.ts` 상단 import에 추가:

```typescript
import { EventsModule, createKafkaConfigFromEnv } from '@app/events';
import { PRODUCT_STREAM, UGC_EVENT_STREAM } from '@packages/event-contracts';
```

`imports` 배열을 다음으로 교체(`ConfigModule.forRoot({...})` 블록 바로 뒤에 조건부 항목 추가):

```typescript
  imports: [
    LoggerModule.forRoot(loggerConfig),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'apps/search/.env'],
    }),
    // #510: Kafka 브로커가 있으면 전역 재시도/DLQ/스키마검증 인터셉터를 등록한다.
    // main.ts 의 forConsumer(전송 배선)와 짝 — forConsumerModule 은 provider 만 등록하고
    // connectMicroservice 를 부르지 않으므로 두 번째 컨슈머를 만들지 않는다.
    // 조건부인 이유: createKafkaConfigFromEnv() 는 KAFKA_BROKERS 미설정 시 null 이라
    // 무조건 넣으면 브로커 없는 로컬에서 부팅 실패 (channel-adapter adapter.module.ts:112 판례).
    ...(process.env.KAFKA_BROKERS
      ? [
          EventsModule.forConsumerModule({
            streams: [PRODUCT_STREAM, UGC_EVENT_STREAM],
            groupId: process.env.KAFKA_GROUP_ID || 'search-indexer',
            kafka: createKafkaConfigFromEnv()!,
            enableAutoDLQ: true,
          }),
        ]
      : []),
  ],
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npx jest apps/search/src/search.module.spec.ts`
Expected: 두 테스트 모두 PASS. 첫 번째는 브로커 설정 시 `EventRetryInterceptor`가 imports의 dynamic module providers에 등록됨을 확인, 두 번째는 미설정 시 등록되지 않음(graceful degradation)을 확인.

- [ ] **Step 5: 빌드 + 기존 search 유닛 스위트 회귀 확인**

Run: `npx nest build search`
Expected: exit 0 (webpack compiled, tsc 에러 0).

Run: `npx jest apps/search/src`
Expected: 신규 `search.module.spec.ts` 포함 전체 PASS. 기존 스펙(`product-index.service.spec.ts`·`search.service.spec.ts`·`search.controller.spec.ts`·`review-events.consumer.spec.ts`)은 이 변경(모듈 imports 추가)의 영향을 받지 않아야 함 — 그들은 `Test.createTestingModule`에 개별 provider/controller를 직접 지정하지 SearchModule 전체를 import하지 않으므로 무영향.

- [ ] **Step 6: 변경 파일 eslint 신규 error 확인**

Run: `npx eslint apps/search/src/search.module.ts apps/search/src/search.module.spec.ts`
Expected: 신규 error 0. (`require` 사용에 대한 `@typescript-eslint/no-var-requires`는 스펙 내 인라인 `eslint-disable-next-line`으로 처리됨. 만약 다른 신규 error가 뜨면 수정.)

- [ ] **Step 7: 커밋**

```bash
git add apps/search/src/search.module.ts apps/search/src/search.module.spec.ts
git commit -m "$(cat <<'EOF'
fix(search): 이벤트 컨슈머를 전역 재시도/DLQ 인터셉터에 배선 (#510)

search 는 main.ts 의 forConsumer(전송 배선)만 있고 어느 모듈에서도
EventsModule 을 import 하지 않아 EventRetryInterceptor(재시도·DLQ·offset
commit)가 DI 컨테이너에 등록되지 않던 유일한 컨슈머 앱이었다. 포이즌
메시지 시 offset 미커밋 → 무한 재전달.

search.module.ts imports 에 EventsModule.forConsumerModule 을 조건부
(process.env.KAFKA_BROKERS)로 추가해 다른 컨슈머 앱과 정합. 조건부는
브로커 없는 로컬에서의 graceful degradation 보존 (channel-adapter 판례).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. 스펙 커버리지 (이슈 #510 요구):**
- "search가 EventRetryInterceptor 전역 등록 밖" → Task 1 Step 3이 `forConsumerModule` 배선으로 해소. ✅
- "SchemaValidationInterceptor도 미적용" → `forConsumerModule`이 둘 다 등록(`events.module.ts:271-277,305`)하므로 동반 해소. ✅
- "SearchModule에 forConsumerModule 도입 필요" → 정확히 그대로 구현. ✅
- "앱 설정(스트림/그룹/토픽 부트스트랩) 검토 필요" → Global Constraints에서 streams/groupId를 main.ts와 일치, `enableAutoDLQ: true`로 DLQ 토픽 부트스트랩 활성, 조건부 import로 부팅 안전성 확보. ✅

**2. Placeholder 스캔:** 모든 스텝에 실제 코드/명령/기대 출력 존재. TODO/TBD 없음. ✅

**3. 타입 일관성:** `EventRetryInterceptor`(`@app/events` export 확인 `index.ts:36`), `createKafkaConfigFromEnv`(`KafkaConfig | null` 확인), `forConsumerModule` options 4필드(streams/groupId/kafka/enableAutoDLQ, `ConsumerModuleOptions`와 정합), `APP_INTERCEPTOR`(`@nestjs/core`), 메타데이터 키 `'imports'` — 전부 실재 심볼. ✅

**미커버(의도적 범위 밖):**
- #509(channel-adapter 로컬 RetryPolicy 이관) — `needs-triage`, 별도 이슈.
- 런타임 DLQ 동작 실검증 — 배포 환경 이연(Global Constraints).
- DLQ 토픽 알림(observability) 존재 확인 — 현황판 별도 잔여 항목(ops).
