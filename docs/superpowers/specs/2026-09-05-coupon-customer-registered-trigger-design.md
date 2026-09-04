# 쿠폰 자동발급 `customer_registered` 트리거 재지정 — 설계

> 2026-09-05. 이슈 #775 의 결정 ⓵ 을 확정하고 그 귀결을 설계로 편 것.
> 이 문서는 **왜** 를 적는다. **무엇을 어떤 순서로** 는 같은 날짜의 plans 문서에 있다.
> 상위 SoT 는 #488, 로드맵은 `docs/superpowers/plans/2026-08-29-coupon-domain-master-plan.md`.

## 1. 문제

자동발급 트리거 두 값 중 `customer_registered` 는 **발화할 수 없다**(리허설 2차 R11 ❌, 2026-09-01).
트리거는 user-service 의 Kafka 이벤트 `UserEmailVerified` 를 기다리는데, 그 이벤트를 발행하는 유일한
코드(`auth.service.ts:321`, 이메일 인증 처리기 안)는 도달 불가다 — 가입이 사용자를 이미 인증된
상태(`isEmailVerified: true`)로 넣고, 인증 처리기는 미인증 사용자만 찾는다(`:278`). 2026-04-22 커밋
`19c998a97` 부터 그랬고, 자동발급이 한 번도 돈 적 없어 드러나지 않았다.

뒷단(Kafka → channel-adapter inbox → 워커 → `POST /admin/customers/:id/issue-coupons` → 워크플로 →
`coupon_grant` → 메트릭)은 이벤트를 강제 발화시켜 정상임을 실측했다. **죽은 것은 입구 하나다.**

### 1.1 왜 어떤 테스트도 못 잡았나

user-service · channel-adapter · Medusa 의 유닛·통합 스펙이 전부 초록이다. 각 층은 자기 층 안에서
맞다. 깨진 곳은 **층 사이의 암묵 전제**(「이 이벤트를 내는 곳이 있다」)이고, 어느 층의 테스트도 그
전제를 검사하지 않는다.

같은 실패 모드가 이미 **셋**이다. Medusa `subscribers/user.updated.ts` · `user.deleted.ts` 가
`users.events.v1` 을 기다리는데, Medusa 는 Kafka 를 소비하지 않고 그 이름을 emit 하는 코드도 없다
(§2 ⑧). 특히 `user.deleted` 는 탈퇴 회원의 Medusa 고객 정보를 익명화하는 코드라, 죽어 있다는 것은
탈퇴자의 이름·이메일이 Medusa 에 남아 있다는 뜻이다 — 쿠폰과 별개로 급한 후속 이슈다.

그래서 이 설계는 트리거 수정보다 **구조적 가드**(§4.4)를 더 무겁게 본다. 가드가 없으면 다음 트리거에서
같은 일이 반복된다.

## 2. 실측 근거 (2026-09-04 ~ 05, 소스 확인)

| # | 사실 | 좌표 | 설계에 미치는 영향 |
|---|---|---|---|
| ① | Medusa 코어가 고객 생성 워크플로 끝에 `customer.created` 를 낸다. 우리 가입 경로가 그 워크플로를 지난다 | `@medusajs/core-flows` `create-customers.js:50` (`emitEventStep`) · `workflows/auth/workflows/register-customer-workflow.ts:27` → `createCustomerAccountWorkflow` | 안 3 의 전제. 워크플로 밖 직접 쓰기가 아니라 이벤트가 실제로 뜬다 |
| ② | `customer.created` 는 **어드민이 만든 고객**(코어 `POST /admin/customers`, `has_account=false`)에도 뜬다. 게스트 결제 고객은 `findOrCreateCustomerStep` 이 모듈 서비스를 직접 불러 만들며 **오늘은 이벤트가 없다**(모듈 서비스의 `@EmitEvents` 가 메시지를 안 쌓는다) | `core-flows/customer/workflows/create-customer-account.js:41` (`has_account: !!authIdentityId`) · `core-flows/cart/steps/find-or-create-customer.js:71` · `@medusajs/customer` `customer-module.js`(`eventBuilders` 0건) | subscriber 는 **`has_account === true`** 만 발급한다. 게스트 경로는 엔진이 바뀌어도 같은 게이트가 덮는다 |
| ③ | Redis 이벤트버스 재시도 기본값 **`attempts: 1`**, `medusa-config.js` 는 `jobOptions` 를 안 준다. subscriber 가 던지면 warn 로그 후 종료 | `@medusajs/event-bus-redis` `event-bus-redis.js:145` · `apps/medusa/medusa-config.js:209-219` | inbox 를 안 거치면 재시도 사다리가 없다 → 결정 2 |
| ④ | 페이로드는 고객당 `{ id }` 하나(`emitEventStep` 이 배열을 쪼갠다). 워크플로가 **성공적으로 끝난 뒤에만** 발행 → `metadata.almond_user_id` 는 있고 고객그룹은 아직 없다 | `core-flows/common/steps/emit-event.js:11,53` | 그룹 룰 쿠폰은 가입 시점 `group_mismatch` 스킵 — 기존 경로와 같은 의미 |
| ⑤ | Medusa 에 Prometheus `/metrics` 가 **없다**. Alloy 의 OTLP 수신기는 trace·log 만 출력한다. `coupon_auto_issue_total` 은 channel-adapter 의 prom-client 시리즈(포트 13010) | `apps/medusa/package.json`(prom-client 없음) · `config.alloy:6-19` · `apps/channel-adapter/src/observability/coupon-issue.metrics.ts` | 「subscriber 가 같은 메트릭을 낸다」(이슈 대가 2-(b)) 는 배관을 새로 놓아야 한다 → 결정 1 |
| ⑥ | Medusa 의 `instrument.http` 는 OTel http 계측이 아니라 Medusa 라우트 레이어 자체 계측 | `@medusajs/medusa/dist/instrumentation/index.js:310` (`instrumentHttpLayer`) | 별도 포트의 plain `http.createServer` 는 계측되지 않는다 — #613 이 겪은 「스크레이프가 빈 trace 를 남긴다」 는 해당 없음 |
| ⑦ | Medusa `tsc` 는 CI 게이트가 아니다(선재 3건, CI 는 `tsconfig.instrumentation.json` 만 검사). 루트 jest 는 CI 게이트이고, `packages/domain-types/coupon-vocabulary-drift.spec.ts` 가 **소스 파일을 읽어 대조**하는 선례다 | `.github/workflows/medusa-unit-tests.yml:4,55` | 가드는 타입이 아니라 **jest 스펙**이어야 한다 |
| ⑧ | Medusa 의 BullMQ 큐(`{medusa-events}`)에 밖에서 넣는 코드 **0곳**, 우리 소스가 emit 하는 커스텀 이벤트 **0개**. `users.events.v1` 을 내는 곳은 어디에도 없다 | 전수 grep (`medusa-events|bullmq` in channel-adapter·user-service·membership·libs / `emitEventStep|eventBus.emit` in apps/medusa/src) | `user.updated`·`user.deleted` 의 사망은 정황이 아니라 **정적 증명** — 이슈 ⓹ 의 런타임 확인은 불필요 |
| ⑨ | Medusa Dockerfile 이 `ENV PORT=9000` 을 박는다. 9개 앱의 메트릭 포트는 `PORT+10000` 파생(`libs/shared/src/observability/metrics-server.ts`) | `apps/medusa/Dockerfile:8` | Medusa 메트릭 포트 **19000**, SST env 추가 0 |
| ⑩ | 발급 키는 `trigger:<trigger>` 로 고정이고 `coupon_grant` 에 `(promotion_id, customer_id, issue_key) WHERE deleted_at IS NULL` 파셜 유니크가 있다 | `issue-coupons/route.ts` · `Migration20260902100000.ts:42` | 멤버십 가입·해지를 반복해도 같은 쿠폰은 두 번 안 나간다(`already_issued`). 재발급 경로는 어드민 회수(soft delete)뿐이며 의도된 것 |

## 3. 결정

| # | 결정 | 근거 |
|---|---|---|
| **1** | **안 3 + b-1.** `customer_registered` 의 입구를 Medusa `customer.created` subscriber 로 옮기고, Medusa 에 prom-client + 별도 포트 `/metrics` + Alloy 스크레이프를 놓아 **channel-adapter 와 같은 이름·같은 라벨의 카운터**를 낸다 | 안 3: 고객이 정의상 존재해 「Medusa 고객 미존재 → 최대 1시간 백오프」 함정이 원인부터 사라진다. b-1: #613 이 9개 앱에 깐 것과 같은 모양이라 기존 대시보드·알림 PromQL(`sum by (trigger,outcome)`)이 두 트리거를 그대로 합산한다. 이 결함이 「관측으로도 정상과 구별이 안 됐다」에서 왔으니 옮기면서 관측을 약하게 만들 수 없다 |
| **2** | **재시도 없음.** subscriber 실패는 `coupon_auto_issue_failures_total{trigger="customer_registered",kind="permanent"}` + error 로그. 복구는 사람이 어드민 라우트를 한 번 부른다 | channel-adapter 가 재시도를 5단 둔 이유는 **다른 서비스**를 HTTP 로 불렀기 때문. 안 3 은 같은 프로세스·같은 DB 라 남는 실패는 DB 순단(드묾)과 버그(재시도 무의미)뿐. 전역 `attempts` 는 subscriber 8개 전부의 동작을 바꾸고, 스윕 크론은 「가입 20시간 뒤 새 쿠폰 소급 발급」이라는 의미 변경을 낳는다 |
| **3** | **`UserEmailVerified` 경로를 channel-adapter 에서 지운다.** 이벤트 계약과 user-service 발행 코드는 안 건드린다 | 남기면 정확히 이 이슈가 문제 삼은 「구독자는 있는데 발행자가 없다」 모양이고, 방금 만들 가드에 예외부터 다는 셈. user-service 쪽은 「가입에 이메일 인증을 요구하나」라는 제품 결정(이슈 안 1, 기각) |
| **4** | **가드 A + B.** A: 트리거 어휘의 모든 값에 등록된 살아 있는 발행자. B: Medusa subscriber 가 듣는 이벤트는 emit 하는 곳이 있다. B 의 예외 목록에 `users.events.v1` 을 후속 이슈 번호와 함께 올린다 | B 를 오늘 돌리면 나머지 둘이 즉시 빨갛다 — 가드가 그 가족을 잡는다는 실증 |
| **5** | **메트릭은 발화시킨 쪽이 센다.** `membership_activated` 는 channel-adapter, `customer_registered` 는 Medusa subscriber. 라우트 안에서는 세지 않는다 | 라우트에서 세면 `membership_activated` 가 두 번 세어진다 |
| — | 이슈 ⓻(어드민 폼의 「회원가입 완료」 경고)는 **하지 않는다** | 같은 PR 이 트리거를 살린다 |

## 4. 설계

### 4.1 전체 그림

```
[전]  가입 ─▶ user-service ─Kafka UserEmailVerified(도달 불가)─▶ channel-adapter inbox ─HTTP─▶ Medusa 발급
[후]  가입 ─▶ Medusa customer.created ─▶ subscriber ─(같은 프로세스)─▶ autoIssueCoupons ─▶ coupon_grant
                                              └─▶ prom 카운터 → :19000/metrics → Alloy → Grafana

      멤버십 ─▶ Kafka MembershipStatusChanged ─▶ channel-adapter inbox ─HTTP─▶ 라우트 ─▶ autoIssueCoupons
                                              └─▶ channel-adapter 카운터 (변경 없음)
```

두 진입점(subscriber · 라우트)이 **하나의 발급 함수**를 공유한다. 라우트는 `membership_activated` 의
정상 입구이자 결정 2 의 수동 복구 입구이므로 **두 트리거를 계속 받는다.**

### 4.2 Medusa

#### 4.2.1 발급 로직 추출 — 순수 선별기 + 얇은 오케스트레이터

라우트 150줄의 심장은 「메타·프로모션·고객그룹 → public/발급창/룰 게이트 → 워크플로 요청 목록 + 스킵
사유」 루프다. 두 층으로 뽑는다.

| 파일 | 역할 | 의존 |
|---|---|---|
| `modules/promotion-meta/auto-issue-selection.ts` (신규) | **순수 함수** `selectAutoIssueCandidates({ trigger, customerId, customerGroupIds, metas, promotions, now })` → `{ requests, skipped, codeById, unsupportedRules }`. 라우트 루프 본문 그대로, I/O 없음. `skipped[].reason` 은 닫힌 유니온 `AutoIssueSkipReason` | `issuance-rules.ts` · `validity.ts` · `resolveVisibility` |
| `workflows/coupons/auto-issue-coupons.ts` (신규) | `autoIssueCoupons(container, { customerId, trigger })` → 고객(`id, groups.id`)·메타·프로모션 로드 → 선별기 → `unsupportedRules` 를 warn 로그 → `issueCouponGrantWorkflow` **1회** → verdict 를 `{ issued, skipped, failed }` 로 접음. 고객 없으면 `MedusaError NOT_FOUND`. **플래그는 보지 않는다**(진입점의 책임) | container |
| `api/admin/customers/[id]/issue-coupons/route.ts` | 플래그 게이트 → 트리거 검증 → `autoIssueCoupons` → `failed` 있으면 `UNEXPECTED_STATE`(500) → `{ issued, skipped }`. **응답 모양·상태코드 불변** | |

워크플로로 한 겹 더 감싸지 않는다. 쓰기는 이미 워크플로(`issueCouponGrantWorkflow`)를 지나
ADR-0034 결정 2 를 만족하고, 나머지는 읽기다. `workflow-engine-redis` 가 실행마다 상태를 영속하므로
가입마다 래퍼 실행 기록을 하나 더 남길 이유가 없다.

`isAutoIssueEnabled()` — `process.env.COUPON_AUTO_ISSUE_ENABLED === 'true'` 한 줄을 `auto-issue-coupons.ts`
가 export 하고 두 진입점이 같은 함수를 부른다. 라우트의 「꺼져 있으면 200 + 빈 배열」 계약(channel-adapter
가 published 로 마킹하도록)은 그대로다.

#### 4.2.2 subscriber — `subscribers/coupon-auto-issue-on-customer-created.ts`

```
config: { event: 'customer.created', context: { subscriberId: 'coupon-auto-issue-customer-registered' } }

1. isAutoIssueEnabled() 아니면 → return           (이 PR 배포가 개통이 되면 안 된다)
2. data.id 없으면 → return
3. 고객 조회 { id, has_account } → has_account !== true → return   (어드민 생성·게스트 배제, §2 ②)
4. autoIssueCoupons(container, { customerId, trigger: 'customer_registered' })
5. 결과를 카운터에 기록(§4.2.3). issued > 0 이면 info 로그
6. 던져지면 catch → failures 카운터(kind=permanent) + error 로그. 재던지지 않는다
```

6 의 error 로그는 복구에 필요한 것을 전부 싣는다 — `customer_id`, 예외 메시지, 그리고 복구 명령
`POST /admin/customers/<id>/issue-coupons { trigger: 'customer_registered' }`. 발급 키가 결정적이라
몇 번 불러도 한 장이다(§2 ⑩). 재던지지 않는 이유는 재시도가 없어서(결정 2) 재던져도 버스의 warn
한 줄이 더 붙을 뿐이기 때문이다.

3 의 조회와 4 안의 조회가 겹친다(고객을 두 번 읽는다). 가입 한 번에 가벼운 SELECT 하나가 더 붙는
것이고, `has_account` 게이트는 «회원가입» 의 의미이지 발급 함수의 관심사가 아니라 subscriber 에 둔다.

#### 4.2.3 메트릭 — 이름·라벨은 channel-adapter 와 동일

| 파일 | 내용 |
|---|---|
| `observability/coupon-issue.metrics.ts` (신규) | `coupon_auto_issue_total{trigger, outcome}` · `coupon_auto_issue_failures_total{trigger, kind}`. 백로그 게이지는 없다(inbox 가 없다). `outcome` 은 선별기의 닫힌 유니온 + `issued` 이므로 channel-adapter 의 `KNOWN_OUTCOMES` 허용목록이 필요 없다 — 값의 생산자가 여기다. 모듈 스코프 싱글턴(prom-client 전역 register 는 같은 이름을 두 번 등록하면 던진다 — channel-adapter 와 같은 이유) |
| `observability/metrics-server.ts` (신규) | `libs/shared/src/observability/metrics-server.ts` 의 소형 사본(Medusa 는 `@app/*` 를 import 하지 못한다 — 번들러 없음). #613 의 교훈 셋을 이식: `METRICS_PORT > 0` 가드(`Number('') === 0` 함정), `listen` 의 `error` 리스너(관측 실패가 부팅 실패로 승격되지 않게), 기본값 `PORT + 10000` |
| `instrumentation.ts` | `register()` 첫 줄에서 메트릭 서버 기동. **OTLP endpoint 유무와 독립** — 지금은 endpoint 없으면 early return 이라 그 앞에 둔다. CI 의 `tsconfig.instrumentation.json` 이 이 파일을 타입 검사한다 |
| `package.json` | `prom-client ^15.1.3`(루트와 같은 메이저). Medusa 는 **yarn**(`yarn.lock` + Dockerfile `yarn start`) — lockfile 갱신을 같은 커밋에 |

`kind` 라벨: **subscriber 의 모든 실패는 `permanent`** 다. 재시도가 없으므로 모든 실패가 최종이고
사람이 봐야 한다 — P7 의 알림 후보 `sum(increase(coupon_auto_issue_failures_total{kind="permanent"}[1h])) > 0`
이 정의 그대로 이 트리거도 덮는다.

### 4.3 channel-adapter — 죽은 경로 삭제

| 파일 | 변경 |
|---|---|
| `consumers/user-event.consumer.ts` | `onUserEmailVerified` 삭제. `Cafe24Linked` / `Cafe24Unlinked` 는 그대로 |
| `adapters/medusa/inbox-worker.service.ts` | 처리 타입 배열에서 `'UserEmailVerified'` 제거, `case` 블록 삭제, payload 타입 import 제거 |
| `services/coupon-issue-reconciliation.service.ts` | `retryUserEmailVerified` 와 분기, 「고객이 몇 달 뒤 첫 로그인할 수 있다」 긴 창 상수 삭제 |
| `observability/coupon-issue.metrics.ts` | `COUPON_TRIGGER_EVENT_TYPES = ['MembershipStatusChanged']` → 백로그 게이지의 `UserEmailVerified` 라벨 소멸 |
| 위 넷의 스펙 | `UserEmailVerified` 케이스 제거 |

**일부러 안 건드리는 것:**
- `adapters/medusa/medusa.client.ts` 의 `issuePromotionsByTrigger` 트리거 유니온은 **두 값 유지**.
  이 클라이언트는 「두 트리거를 받는 라우트」의 거울이고, `coupon-vocabulary-drift.spec.ts` 가 그
  시그니처를 어휘 사이트로 읽는다 — 좁히면 어휘 가드가 빨개진다. 좁아지는 것은 호출부(워커·리컨실)뿐.
- `@packages/event-contracts` 의 `UserEmailVerified` 계약, user-service 의 발행 코드(결정 3).
- DB: 라이브 `inbox_events` 에 `UserEmailVerified` 행은 없다(발화한 적 없음). 마이그레이션 0.

### 4.4 가드 둘

#### 가드 A — 트리거마다 «살아 있는 발행자» (`packages/domain-types/coupon-trigger-producers.spec.ts`, 루트 jest)

등록부는 데이터다 — `packages/domain-types/coupon-trigger-sources.ts`:

```ts
export const COUPON_TRIGGER_SOURCES: Record<AutoIssueTrigger, TriggerSource> = {
  customer_registered: {
    kind: 'medusa_subscriber',
    file: 'apps/medusa/src/subscribers/coupon-auto-issue-on-customer-created.ts',
    event: 'customer.created',
  },
  membership_activated: {
    kind: 'kafka_inbox',
    producerFile: 'apps/membership/src/services/membership-event.publisher.ts',
    eventType: 'MembershipStatusChanged',
    consumerFile: 'apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts',
  },
};
```

스펙이 확인하는 것:

1. 등록부의 키 집합 = Medusa `modules/promotion-meta/service.ts` 에서 읽은 어휘(어휘 가드와 같은 앵커
   재사용). 어휘에 값을 더하고 등록을 안 하면 빨갛다.
2. `medusa_subscriber` — 파일 존재 · `config.event` 리터럴 = 등록 이벤트 · 그 이름이 **Medusa 코어 이벤트
   상수에 있음**(`apps/medusa/node_modules/@medusajs/utils/dist/core-flows/events.js` 를
   `require.resolve('@medusajs/utils/package.json', { paths: [apps/medusa] })` + `path.join` 으로 읽는다 —
   `issuance-rules-engine-drift.unit.spec.ts` 와 같은 기법. exports 맵 때문에 직접 import 는 막힌다) ·
   파일 안에 트리거 리터럴 존재.
3. `kafka_inbox` — 발행 파일에 `enqueue(` 호출 안의 `eventType: '<X>'` · 소비 파일에 `case '<X>'` 와
   트리거 리터럴.

`AUTO_ISSUE_TRIGGERS` 사본(현재 `coupon-vocabulary-drift.spec.ts` 안의 상수)을
`packages/domain-types/coupon-auto-issue-trigger.ts` 로 승격해 등록부·어휘 가드가 공유한다.
`coupon-visibility.ts` 와 같은 자리다.

**한계를 적어 둔다.** 이 가드는 「발행 코드가 존재한다」까지 본다. 오늘의 결함처럼 발행 코드가 있으되
**도달 불가**한 것은 정적으로 못 잡는다. 그것은 리허설(런타임)의 몫이고, 가드는 「발행자가 아예
없다」·「이름이 어긋났다」·「다음 사람이 발행자를 안 적었다」를 잡는다.

#### 가드 B — subscriber 가 듣는 이벤트는 누군가 emit 한다 (`apps/medusa/src/subscribers/__tests__/subscriber-events-have-emitters.unit.spec.ts`, Medusa 유닛)

`src/subscribers/*.ts`(README · `__tests__` 제외) 전부에서 `config.event`(문자열·배열)를 읽어, 각 이름이
**코어 이벤트 상수 집합**(가드 A 와 같은 파일에서 읽음) 안에 있는지 확인한다. 우리 소스가 emit 하는
커스텀 이벤트는 현재 0개(§2 ⑧)라 그 집합으로 충분하고, 생기면 그때 `emitEventStep` 스캔을 더한다.

예외 목록 `KNOWN_DEAD: Record<string, string>` = `{ 'users.events.v1': '#<번호>' }` — 번호는 §7 의 후속 이슈를 신설하는 플랜 태스크가 채운다. 값이 `#\d+`
꼴이 아니면 스펙이 거부한다 — 예외에는 반드시 닫힐 이슈가 붙는다.

### 4.5 인프라

`deployments/lcnine/services/observability/alloy/config.alloy` 에 14줄:

```
discovery.dns "medusa" {
	names = ["Medusa." + sys.env("METRICS_DNS_SUFFIX_SERVICES")]
	type  = "A"
	port  = 19000
}

prometheus.scrape "medusa" {
	targets         = discovery.dns.medusa.targets
	job_name        = "medusa"
	metrics_path    = "/metrics"
	scrape_interval = "60s"
	forward_to      = [prometheus.relabel.service_labels.receiver]
}
```

`Medusa` 는 `createService('Medusa', …)` 의 이름이고 Core 와 같은 SST 앱(`lcnine-services`)이다.
SG·포트 매핑은 #613 때 확인된 대로 변경 0(태스크 SG 가 `10.0.0.0/16` 전 포트, SST 가 `1-65535` 매핑).
SST env 0(§2 ⑨). **Medusa · channel-adapter · Alloy 가 한 스택이라 `sst deploy` 한 번**이고 순서 제약이
없다 — 지우는 경로가 이미 죽어 있어 어느 쪽이 먼저 떠도 무해하다.

## 5. 실패 처리

| 지점 | 실패 | 처리 |
|---|---|---|
| subscriber | 고객 조회·메타 조회·워크플로가 던짐 | catch → `failures_total{kind=permanent}` + error 로그(복구 명령 포함). 재던지지 않음 |
| subscriber | 워크플로가 요청별 `error` verdict | `failed[]` 로 돌아옴 → 같은 카운터·같은 로그. 다른 요청의 발급은 그대로 진행(스텝이 요청 단위로 격리) |
| 라우트 | 위와 같음 | **불변**: `failed` 있으면 500 → channel-adapter 가 transient 로 세고 inbox 재시도 |
| 메트릭 서버 | 포트 점유·바인딩 실패 | `error` 리스너가 로그만 남기고 앱은 뜬다. 관측 실패는 가용성 실패가 아니다 |
| 메트릭 서버 | `METRICS_PORT` 가 빈 문자열·NaN·0 | 미설정으로 취급 → `PORT+10000`. `PORT` 도 없으면 서버를 안 띄우고 로그 |
| 이벤트버스 | Medusa 태스크가 처리 중 재시작 | BullMQ stalled 처리로 1회 재처리될 수 있다 — 발급 키가 결정적이라 멱등 |

## 6. 테스트

| 층 | 무엇 |
|---|---|
| Medusa 유닛 | 선별기 — 라우트의 분기 전부 이식(public 스킵 · `not_started`/`expired` · `unsupported_rule`/`group_mismatch` · 요청 생성 · `expires_at`/`max_claims` 계산). subscriber — 플래그 OFF 면 조회 0회 / `has_account=false` 면 발급 0회 / 성공 → `autoIssueTotal` 증가 + info / 예외 → `failuresTotal{permanent}` + error + 재던지지 않음. 메트릭 서버 — 포트 가드 · `error` 리스너 · `/metrics` 응답. 가드 B |
| Medusa HTTP 통합(실 DB, `scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'`) | 기존 `coupon-issuance-rules.spec.ts` **무수정 통과** = 리팩터 가드. 신규 `coupon-auto-issue-subscriber.spec.ts`: 트리거 쿠폰을 만들고 **실제 `createCustomerAccountWorkflow` 로 고객을 만들어**, 로컬 이벤트버스가 subscriber 를 깨워 `coupon_grant` 행이 생기는지(짧은 폴링) — 「층 사이」의 자동 증명. `has_account=false`(모듈 서비스 직접 생성) 고객은 행이 안 생긴다. 로컬 버스 디스패치가 불안정하면 subscriber 직접 호출(`coupon-consume.spec.ts` 선례)로 후퇴하고 그 사실을 플랜에 기록 |
| 루트 jest | 가드 A · channel-adapter 스펙 갱신 · 어휘 가드 초록 유지 |
| 게이트 | 루트 `type-check` 0 · 루트 jest 0 · Medusa 유닛 · Medusa HTTP 통합 · `npx tsc -p apps/medusa/tsconfig.json` 선재 3 유지 · `npx tsc --noEmit --project apps/medusa/tsconfig.instrumentation.json` |

**통합 스펙에서 `.rejects.toThrow()` 를 쓰지 않는다** — 워크플로 엔진을 거친 에러는 `Error` 인스턴스가
아니다(P10-B 실측). `try/catch` + `expect(err.message).toContain(...)`.

## 7. 문서·이슈·배포

- **ADR-0035 (신규)** 「자동발급 트리거는 사실이 확정되는 시스템에서 발화한다」. 담는 것:
  `customer_registered` := Medusa `customer.created` ∧ `has_account` / 메트릭은 발화시킨 쪽이 센다 /
  재시도 없음(결정 2) / 재발급 불가의 근거는 파셜 유니크 인덱스(§2 ⑩) / **가드 규칙** — 트리거 어휘의
  모든 값은 등록된 살아 있는 발행자를 가진다, subscriber 가 듣는 이벤트는 emit 하는 곳이 있어야 한다.
- #775 갱신(결정 5건 + §2 사실), #488 에 절 추가, 마스터플랜 「A5 개통 차단」 체크, 메모리
  `coupon-domain-p-series` 갱신.
- **후속 이슈 1건 신설**: Medusa `user.updated` · `user.deleted` 사망 — 이메일 동기화 미전파 + 탈퇴 익명화
  미전파(PII). 가드 B 의 예외 목록이 이 번호를 가리킨다.
- 배포: `sst deploy`(lcnine-services) 한 번. 마이그레이션 0 · 시크릿 0 · env 0. 플래그는 **꺼진 채**.
  배포 후 판정은 `up{job="medusa"} == 1` 하나 — 발급 시리즈는 플래그가 꺼져 있는 동안 **존재하지 않는 것이
  정상**이다(`No Data` 를 `Alerting` 으로 매핑하지 말 것).
- 그 다음은 리허설 3차(별도 지침서) → A5 플립. R11 은 「가입 → 스토어프론트 첫 로그인 → 손대지 않고
  쿠폰 확인」으로 바뀐다.

## 8. 하지 않는 것

- A5 플립. 리허설 3차 통과 전에는 켜지 않는다.
- 리허설 3차 지침서. 다음 세션, 별도 문서.
- user-service 의 이메일 인증 제품 결정(이슈 안 1).
- Medusa `user.updated` · `user.deleted` 수정 — 후속 이슈.
- 이슈 ⓻ 어드민 폼 경고 — 같은 PR 이 트리거를 살린다.
- channel-adapter `KNOWN_OUTCOMES` 와 Medusa `AutoIssueSkipReason` 의 드리프트 가드. 오늘은 값이 같고,
  어휘 가드에 사이트를 더하는 것은 값이 갈리는 첫 순간에 한다.

## 9. 기각한 대안

| 대안 | 기각 이유 |
|---|---|
| 안 1 `isEmailVerified` 흐름 수정 | 버그 수정이 아니라 제품 결정. 로그인 게이팅·notification·메일 템플릿이 딸려오고 배포 단위가 `lcnine-auth` 로 다르다 |
| 안 2 `UserCreated` 로 재지정 | 그 시점엔 Medusa 고객이 확실히 없어 정상 경로가 항상 슬로우 리트라이를 거친다(수분~수시간) |
| b-2 OTel metrics push | 이 저장소 유일의 push 경로. 라벨 집합(`service.name`)이 스크레이프 시리즈와 달라 대시보드가 갈린다 |
| b-5 로그 기반(Loki) | 두 트리거가 다른 백엔드에 살아 7-4 의 알림 3개를 Loki 쌍둥이로 다시 써야 한다 |
| 이벤트버스 전역 `attempts` | subscriber 8개 전부의 동작이 바뀐다. 멱등성 검토 없는 범위 밖 변경 |
| Medusa 스윕 크론 | 「가입 20시간 뒤 새 쿠폰 소급 발급」 의미 변경. 막으려면 처리 마커가 필요해 복잡도가 뛴다 |
| 자동발급을 새 워크플로로 감싸기 | 쓰기는 이미 워크플로. 래퍼는 가입마다 `workflow-engine-redis` 실행 기록 하나를 더 남길 뿐 |
| `UserEmailVerified` 소비자를 주석과 함께 남기기 | 방금 만든 가드에 예외부터 다는 셈 |
