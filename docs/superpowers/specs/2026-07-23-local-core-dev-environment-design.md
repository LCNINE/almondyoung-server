# 로컬 core 개발 환경 + `dev_core` 시드 설계 스펙

- 날짜: 2026-07-23
- 대상: `apps/core`, `scripts/local`, `native/warehouse-app`, `docs/local-dev.md`
- 브랜치: `docs/local-core-dev-environment`
- 상태: 설계 승인됨 (구현 전) — 브레인스토밍 산출물
- 관련 문서:
  - `docs/local-dev.md` — 로컬 개발 환경의 SoT. 본 설계의 결과물은 최종적으로 여기에 흡수된다.
  - `docs/superpowers/specs/2026-07-20-warehouse-native-app-design.md` — 물류 현장 앱 마스터 설계 (Phase 구분).
  - `docs/superpowers/specs/2026-07-22-warehouse-app-page-structure-design.md` — 앱 IA. Phase 1~4 라우트 정의.
  - `docs/adr/0005-drizzle-migration-and-autodeploy.md` — 마이그레이션 규율. 본 설계는 로컬 전용이라 배포 절차와 무관하다.

## 1. 배경 / 목표

`native/warehouse-app` 이 조회 전용(재고조회) 단계를 넘어 **쓰기 워크플로우**(실사·이동·입고·피킹·패킹)로 들어간다. 라이브 core 에 쓰기를 날릴 수 없으므로, 로컬 core + 전용 DB + 반복 가능한 시드가 필요하다.

### 목표

1. core 를 로컬에서 **단독** 기동한다 (전용 논리 DB `dev_core`).
2. **한 명령**으로 DB 를 싹 밀고 "완전한 세계"를 재시딩한다. 네 Phase(실사·이동 / 입고 / 피킹 / 패킹) 전부를 처음부터 가정한다.
3. warehouse-app 이 로컬 core ↔ 라이브 core 를 마찰 없이 전환한다.
4. **라이브 데이터와 라이브 이벤트 버스를 절대 오염시키지 않는다.**

### 비목표

- user-service 로컬화 — 라이브(`https://user.almondyoung.com`)를 그대로 쓴다.
- medusa / channel-adapter / wallet 등 타 서비스의 로컬 기동 — core 단독.
- 오프라인 개발 — 로그인과 JWKS fetch 가 라이브 의존이라 성립하지 않는다.
- CI 통합 — 본 시드는 로컬 수동 개발 전용이다. 통합테스트(`npm run test:core:integration:local`)는 기존 경로를 그대로 쓴다.

## 2. 현황 — 이미 있는 것과 빠진 것

로컬 개발 인프라는 이미 상당 부분 구축돼 있다. 본 설계는 새 환경을 만드는 게 아니라 **빠진 조각을 채운다.**

| 이미 있음 | 위치 |
|---|---|
| postgres / redis / kafka / zookeeper 컨테이너 | 루트 `docker-compose.yml` (현재 postgres 만 기동 중 — §3.1 참고) |
| 논리 DB 10개 자동 생성 | `scripts/local/init-db.sql` (postgres 최초 기동 시) |
| 전 서비스 drizzle 마이그레이션 | `npm run db:migrate:local` → `scripts/local/migrate-all.sh` |
| 서비스 일괄 기동 | `npm run start:all:local` → `scripts/local/start-all.sh` |
| 라이브 데이터 복제 | `scripts/local/refresh-from-live.sh` |
| 포트맵·셋업 절차·트러블슈팅 | `docs/local-dev.md` |
| 통합테스트 러너 | `npm run test:core:integration:local` |
| 도메인 서비스 수동 DI + 픽스처 | `apps/core/src/modules/fulfillment/services/__support__/` |

| 빠진 조각 | 본 설계의 대응 |
|---|---|
| 로컬 PG 용 시드 (`db:seed:ref`/`db:seed:demo` 는 `sst shell` 의 `Resource.Db` 의존 → 로컬 불가) | §7 시드 스크립트 |
| "싹 밀고 재시딩" 리셋 명령 | §7 `npm run dev:core:reset` |
| warehouse-app 의 로컬/라이브 전환 | §8 |
| `apps/core/.env` (이 머신에 없음 — core 를 로컬로 띄운 적이 없다) | §5 |

## 3. 안전 경계 — 라이브 오염 방지

조회만 할 때는 드러나지 않다가 **쓰기부터 터지는** 위험들이다. 이 절이 본 설계에서 가장 중요하다.

### 3.1 Kafka 컨슈머 그룹 하이재킹 (최우선)

core 는 outbox dispatcher 가 5초마다 publish 하고(`libs/events/src/outbox/outbox-dispatcher.service.ts` 의 `@Cron('*/5 * * * * *')`), 동시에 `CORE_ORDER_STREAM` / `SHIPMENT_STREAM` / `FULFILLMENT_V2_STREAM` 등을 **consume** 한다. 라이브 배포는 `kafkaEnv('core', 'core-group')` 으로 그룹 ID 가 `core-group` 이다.

라이브 `.env` 를 그대로 복사해 `KAFKA_BROKERS` 가 Confluent 를 가리키면:

- 로컬 core 가 **라이브 컨슈머 그룹에 합류해 파티션을 가져간다** → 그 파티션의 라이브 주문 이벤트를 라이브 core 가 못 받는다. 로컬 DB 로 흡수되고 조용히 유실된다.
- 로컬의 모든 쓰기가 outbox 를 통해 **라이브 토픽으로 발행**된다 → channel-adapter 가 실제 마켓플레이스로 dispatch 할 수 있다.

**대응(이중 안전장치)**:
1. `KAFKA_BROKERS=localhost:9092` — 로컬 compose 브로커.
2. `KAFKA_API_KEY` / `KAFKA_API_SECRET` 를 **아예 넣지 않는다** → SASL 분기 자체를 타지 않아 Confluent 인증이 불가능. `KAFKA_BROKERS` 를 잘못 적어도 붙지 못한다. **실질 방어선은 이것 하나다.**

> ⚠️ **`KAFKA_GROUP_ID` 는 안전장치가 아니다** (Task 11 구현 중 확인). `apps/core/src/main.ts` 가 컨슈머 `groupId` 를 리터럴 `'almondyoung-order-consumer'` 로 하드코딩하고 `process.env.KAFKA_GROUP_ID` 를 읽지 않는다 (`sales-order.module.ts` 도 같은 리터럴을 중복 보유). 라이브 배포도 `kafkaEnv('core','core-group')` 로 이 변수를 세팅하지만 **모든 환경에서 무시된다**. 따라서 그룹 이름으로 로컬/라이브를 격리한다는 발상은 성립하지 않으며, 초안에 있던 "세 번째 안전장치" 서술은 사실이 아니었다. 다른 서비스(notification·membership·wallet·analytics·channel-adapter·search)는 모두 이 env 를 읽으므로, core 만 예외인 것은 별건 후속 대상이다.

#### Kafka 를 끄는 선택지는 없다 — 로컬 브로커로 **격리**한다

core 단독 테스트에는 Kafka 가 논리적으로 불필요하다. 판매주문을 시드가 직접 만들어 consume 할 이벤트가 없고, 모든 도메인 쓰기는 트랜잭션 안에서 outbox 테이블에 기록되므로 발행 실패는 outbox 행이 pending 으로 남을 뿐 도메인 상태를 해치지 않는다. 통합테스트가 outbox 를 mock 해 Kafka 없이 도는 것도 같은 이유다.

**그러나 core 의 부팅이 브로커를 요구한다.** `apps/core/src/main.ts` 는 조건 없이 `app.connectMicroservice(EventsModule.forConsumer({ streams: [ORDER_STREAM], … }))` + `await app.startAllMicroservices()` 를 수행하고, 브로커 연결 실패 시 `ServerKafka.listen` → `NestMicroservice.listen()` 이 reject 하며 `bootstrap().catch(…)` 가 `process.exit(1)` 한다. 즉 **브로커가 없으면 core 가 뜨지 않는다.**

검토한 대안과 기각 사유:

| 안 | 판단 |
|---|---|
| **로컬 compose 브로커 기동 (채택)** | `docker-compose.yml` 에 kafka + zookeeper 가 이미 정의돼 있어 코드 변경이 0 이다. 비용은 컨테이너 2개(대략 0.7~1GB RAM). outbox 가 실제로 드레인되는 것을 관찰할 수 있어 **피킹·출고의 이벤트 발행 회귀를 로컬에서 잡는다** — 브로커가 없으면 outbox 만 쌓이는 상태를 "발행됐다" 고 착각한 채 개발하게 된다 |
| Redpanda 단일 컨테이너로 교체 | zookeeper 가 빠져 200~300MB 로 줄지만, `docker-compose.yml` 은 팀 공용이라 타인의 로컬과 통합테스트에 영향이 간다. 얻는 것이 RAM 몇백 MB 뿐이라 정당화되지 않는다 |
| Kafka 없이 부팅하도록 코드 변경 | `createKafkaConfigFromEnv()` 는 `KAFKA_BROKERS` 미설정 시 이미 `null` 을 반환해 lib 에 no-Kafka 경로가 있다. 그러나 core 의 `env.validation.ts` 가 `KAFKA_BROKERS` 를 필수로 강제하고 `main.ts` 가 무조건 `connectMicroservice` 를 부르므로 둘 다 손봐야 한다. **프로덕션 부팅 경로에 로컬 전용 분기를 넣는 변경**이고, 라이브에서 Kafka 설정 누락이 즉시 부팅 실패로 드러나던 안전망이 약해진다. "이벤트 없는 로컬 모드" 를 정식 기능으로 만들 때의 출발점으로만 남겨둔다 |

**주의**: 이 머신은 현재 compose 에서 postgres 만 떠 있고 kafka·zookeeper 는 컨테이너가 생성조차 되지 않았다(`docker compose ps -a`). core 를 띄우기 전에 `docker compose up -d` 로 전체를 올려야 한다.

### 3.2 외부 부작용 env

| 변수 | 로컬 정책 | 근거 |
|---|---|---|
| `HANJIN_*` | **미설정** | 설정하면 Phase 4 패킹에서 실제 운송장이 발행된다. 라이브 core env 에도 아직 없어 발행이 503 이므로, 로컬도 동일하게 둔다 |
| `WALLET_BASE_URL` / `WALLET_API_KEY` | 미설정 | 취소 후 자동 환불이 라이브 wallet 을 호출한다. 미설정 시 `manual_pending` 으로만 기록 |
| `FILE_SERVICE_URL` | 미설정 | 라이브 file-service signed URL 호출 방지 |
| `ELASTICSEARCH_*` | 미설정 | 창고 워크플로우에 불필요 |

### 3.3 DB 파괴 가드

리셋 스크립트가 `DROP DATABASE` 를 수행하므로 §7.3 의 가드가 필수다.

## 4. 인증 모델

user-service 를 라이브로 두는 결정의 파급을 정리한다.

### 4.1 토큰 검증 — 그대로 동작한다

core 는 `OIDC_ISSUER_URL` 로 JWKS 를 받아 RS256 을 검증한다(`libs/authorization/src/strategies/jwt-access.strategy.ts`, dual-mode). 로컬 core 에 `OIDC_ISSUER_URL=https://user.almondyoung.com` 만 넣으면 warehouse-app 의 라이브 로그인 토큰이 그대로 통과한다. 앱의 OIDC 설정(`VITE_OIDC_*`)은 **바꾸지 않는다.**

### 4.2 scope 는 core 자기 DB — 시딩이 필요하다

`ScopeGuard` → `AuthorizationService.getScopesByRoles()` 는 **core 자신의 DB**(`auth.scopes`, `auth.role_scope_mapping`)를 조회한다. 이 행들은 부팅 시 `ScopeBootstrapService.onModuleInit()` 이 `ALL_SCOPES`(`apps/core/src/platform/auth/merged-scopes.ts`) + `FULFILLMENT_ROLE_MAPPINGS` 로 생성한다.

**부팅 시 1회뿐**이라는 점이 중요하다. 리셋이 이 테이블을 날리면 watch 로 띄워둔 core 는 계속 403 을 뱉는다. 그래서 §7.2 에서 **시드 스크립트가 스코프 부트스트랩을 직접 수행**한다 — core 를 안 내리고 리셋할 수 있게.

### 4.3 role 은 라이브 JWT claim — Phase 3 의 관문

role 이름은 토큰 claim 에서 오고, core 는 그것을 자기 scope 로 매핑만 한다.

```
logistics_worker   → fulfillment.warehouse.operate
logistics_manager  → tracking.ingest 를 제외한 모든 fulfillment scope
master             → ScopeGuard 를 전면 우회
```

**scope 게이트가 걸린 범위가 모듈별로 다르다:**

| 모듈 | 게이트 | 해당 Phase |
|---|---|---|
| `inventory` (재고조회·실사·이동·입고) | `@RequireScopes` **없음** — 전역 `JwtAuthGuard` 만 | Phase 1, 2 |
| `fulfillment` (피킹·패킹·출고·shipment) | `fulfillment.warehouse.operate` 등 필요 | Phase 3, 4 |

따라서 **Phase 1·2 는 현재 계정으로 바로 되고, Phase 3 진입 시 처음 403 을 만난다.** 그때 라이브 user-service 에서 개발자 계정에 `logistics_worker`(또는 `logistics_manager`) 역할 부여가 선행돼야 한다 — 이 구성에서 **유일한 라이브 데이터 쓰기**다. 착수 전에 로그인 토큰의 `roles` claim 을 먼저 확인한다.

### 4.4 operator 신원 — core 시딩 불필요

`shipment_operations.operator_id` 는 FK 없는 plain `uuid`(`inventory.schema.ts:2299`)다. 라이브 토큰의 `sub` 가 그대로 저장되므로 core 에 사용자 행을 시딩할 필요가 없다.

### 4.5 HS256 우회로 (디버깅용)

core 는 dual-mode 라 `AUTH_SECRET` 을 함께 설정하면 `npm run generate:token` 으로 **임의 role 이 박힌 HS256 토큰**을 만들 수 있다. 앱 로그인 경로는 여전히 라이브 RS256 이지만, curl 로 fulfillment 엔드포인트를 두드려 보거나 role 부여 전에 Phase 3 배선을 확인할 때 쓴다.

## 5. `apps/core/.env` (신규)

```dotenv
PORT=3100
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dev_core

# 로컬 compose 브로커. API 키를 넣지 않아 라이브 Confluent 접속 자체가 불가능하다.
# 브로커가 없으면 core 는 부팅하지 않는다 (§3.1) — 끄는 게 아니라 격리하는 것이다.
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID_PREFIX=core-local
KAFKA_GROUP_ID=core-local-<사용자>
# KAFKA_BOOTSTRAP_TOPICS 는 설정하지 않는다(기본 활성). compose kafka 가
# KAFKA_AUTO_CREATE_TOPICS_ENABLE=true 라 어느 쪽이든 토픽은 생기지만, 활성으로 두면
# 파티션 수가 stream 선언과 일치하고 DLQ 토픽도 함께 만들어진다.

FULFILLMENT_WORKFLOW_MODE=v2
FULFILLMENT_V2_CUTOVER_AT=1970-01-01T00:00:00.000Z

OIDC_ISSUER_URL=https://user.almondyoung.com
AUTH_SECRET=<로컬 전용 임의값>

# 아래는 의도적으로 비운다 (§3.2)
# WALLET_BASE_URL= / WALLET_API_KEY= / FILE_SERVICE_URL= / HANJIN_* / ELASTICSEARCH_*
```

`apps/core/src/config/env.validation.ts` 기준 필수는 `DATABASE_URL`, `KAFKA_BROKERS`, `FULFILLMENT_WORKFLOW_MODE`, `FULFILLMENT_V2_CUTOVER_AT`(v2 일 때), 그리고 `AUTH_SECRET` 또는 `OIDC_ISSUER_URL` 중 하나다. 나머지는 optional.

값 없는 템플릿을 `env-templates/.env.core.local.example` 로 커밋한다. 기존 `env-templates/.env.wms.example` 은 core 의 옛 이름(wms) 시절 템플릿이고 라이브 배포용 플레이스홀더라 로컬 안내로는 부적합하다.

## 6. `dev_core` 논리 DB

### 6.1 기존 `core` 를 재사용하지 않는 이유

로컬에 이미 `core` 논리 DB 가 있지만 두 소비자가 더 있다:

- `npm run test:core:integration:local` — 대부분 rollback-only 지만 커밋형 스펙 2개(`unified-reservation.service.lock.integration.spec.ts`, `store-return-exchange.refund.integration.spec.ts`)가 행을 남긴다.
- `scripts/local/refresh-from-live.sh` — 라이브 전체를 `--clean` 으로 복원하므로 시드 세계를 통째로 날린다.

수동 테스트 세계와 이들이 섞이면 "이 행이 시드인가 테스트 잔재인가"를 매번 따져야 한다. 분리 비용은 §6.2 대로 거의 0 이므로 분리한다.

### 6.2 생성과 마이그레이션

- `scripts/local/init-db.sql` 에 `CREATE DATABASE dev_core;` 한 줄 추가 (신규 머신의 최초 기동용).
- **기존 볼륨엔 initdb 가 다시 돌지 않는다.** 이미 postgres 볼륨이 있는 머신에서는 리셋 스크립트가 어차피 `CREATE DATABASE` 를 하므로 별도 수동 작업이 필요 없다.
- `scripts/local/migrate-all.sh` 는 **건드리지 않는다.** 리셋 스크립트가 `dev_core` 에 대해 `drizzle-kit migrate --config apps/core/drizzle.config.ts` 를 직접 호출한다. (`drizzle.config.ts` 의 `config({path})` 는 이미 설정된 env 를 덮어쓰지 않으므로 셸에서 주입한 `DATABASE_URL` 이 이긴다 — `migrate-all.sh` 가 쓰는 것과 같은 성질이다.)

`apps/core/drizzle.config.ts` 의 `schemaFilter` 가 `public`, `event`, `auth` 라 세 스키마가 전부 마이그레이션으로 생성된다.

## 7. 시드 / 리셋

### 7.1 인터페이스

```bash
npm run dev:core:reset            # drop → create → migrate → 스코프 부트스트랩 → 시드(소형)
npm run dev:core:reset -- --bulk  # 위 + 대량 데이터 추가
```

단일 진입점만 둔다. "리셋 없이 추가 시딩" 같은 변형은 YAGNI — 요구사항은 "싹 밀고 다시 시딩" 하나다.

### 7.2 절차

1. **가드** (§7.3) — 실패 시 즉시 중단.
2. `postgres` 시스템 DB 에 접속 → `pg_terminate_backend` 로 `dev_core` 세션 종료 → `DROP DATABASE IF EXISTS dev_core` → `CREATE DATABASE dev_core`.
   - core 를 watch 로 띄워둔 채여도 postgres.js 풀이 재연결하므로 core 를 내릴 필요가 없다.
3. `DATABASE_URL=<dev_core> npx drizzle-kit migrate --config apps/core/drizzle.config.ts`.
4. **스코프 부트스트랩** — `AuthorizationService` 를 직접 생성해 `ensureScopesExist('almondyoung', ALL_SCOPES)` + `ensureRoleScopeMappings(FULFILLMENT_ROLE_MAPPINGS)` 호출. §4.2 의 이유로 필수다.
5. **세계 생성** (§7.5).

### 7.3 가드

`DROP DATABASE` 를 수행하는 스크립트이므로 다음을 모두 만족하지 않으면 거부한다:

- 접속 호스트가 `localhost` 또는 `127.0.0.1`.
- 대상 DB 이름이 정확히 `dev_core`.

호스트 조건이 라이브 RDS 를 막고, DB 이름 조건이 공용 로컬 `core` 를 막는다. **DB 이름 조건이 실질적 방어선**인데, `sst tunnel` 이 떠 있으면 `localhost:5432` 가 원격을 가리킬 수 있어 호스트 조건만으로는 부족하기 때문이다.

### 7.4 구현 방식 — 도메인 서비스 직접 호출

`scripts/local/seed-dev-core.ts` 가 `__support__/logistics-wiring.ts` 의 `makeDb` / `makeDbService` / `wireLogistics` 와 `__support__/logistics-fixtures.ts` 의 빌더를 재사용해 **도메인 서비스를 직접 호출**한다.

**선정 근거**: 재고 원장(`stock_events` append-only) · 투영(`stock_ledgers`) · 예약(`stock_reservations`) 의 정합성은 생 INSERT 로 재현하면 반드시 어긋나고, 앱이 거부하는 세계가 나온다. 이 정합성을 지키며 세계를 만드는 코드가 통합테스트에 이미 있다. core 부팅도 토큰도 불필요해 리셋 반복이 초 단위로 끝난다.

**기각한 대안**:
- *Nest ApplicationContext 부팅* — 수동 wiring 유지보수가 없어지는 대신 전체 env 가 필요하고, outbox cron·컨슈머가 같이 뜨며, 시드가 앱 부팅 실패에 묶인다. 리셋을 자주 돌리는 용도에 부적합.
- *HTTP API 호출* — `POST /warehouses`, `POST /inventory/skus`, `POST /sales-orders`, `/sales-orders/:id/confirm` 이 실제로 있어 가능은 하지만, 중간 상태(부분 피킹, 특정 예약 상태)를 만들 수 없고 core 기동 + 토큰이 전제된다. 시드가 아니라 **시드된 세계 위에서 도는 스모크 스크립트**가 이 방식의 제 역할이며, 필요해지면 그때 별도로 만든다.

**inbound 는 wiring 확장이 필요하다.** `wireLogistics` 는 inventory/fulfillment 만 엮으므로, PO + `inbound_plans` 는 (a) `PurchaseOrderService` 를 wiring 에 추가하거나 (b) `apps/core/scripts/import-inbound-plans.ts` 가 이미 검증한 직접 insert 형태를 따른다. 구현 시 (a) 를 먼저 시도하고, 의존성이 과하게 번지면 (b) 로 내려온다.

**`__support__` 의존**: 테스트 디렉터리를 프로덕션 외 스크립트가 import 하는 형태가 된다. 일단 그대로 두고, 거슬리거나 다른 소비자가 생기면 그때 공용 위치로 승격한다. `inRollbackTx` 만 jest 전역(`expect`)에 의존하므로 시드는 그 함수를 부르지 않는다.

### 7.5 세계 구성 (기본 소형)

네 Phase 전부를 처음부터 가정한다.

| 계층 | 내용 | 어느 Phase 를 위한 것인가 |
|---|---|---|
| 창고 | 2개 — 부천(domestic) / 중국(overseas). `scripts/seeding/constants/uuids.ts` 의 `FIXED_UUIDS` 재사용 | 전부 |
| 로케이션 | 창고별 시스템 존 4개(입고/출고/불량/반품 기본존) + 부천 일반 랙·빈 6개 | 이동·실사 |
| 화주 | 2개 | 전부 |
| SKU | 20개. 코드 `DEV-SKU-0001…`, 바코드 `88000000001…` 고정. SKU 당 primary 바코드 1개 | 전부 |
| 재고 | SKU 별로 **재고 0 / 단일 로케이션 / 다중 로케이션 분산** 세 케이스를 모두 포함 | 실사 차이·이동 대상·품절 경로 |
| 입고 | PO 2 + `inbound_plans` 3 (미도착 / 부분입고 / 완료) | Phase 2 |
| 판매주문 | 10건 + product matching + variant→SKU link + FO | Phase 3 |
| shipment | `draft` 와 `planned`(예약완료 = 피킹 대기) 각각 최소 1건 | Phase 3 |
| 운송장 | 미발행 (§3.2 로 한진 미설정) | Phase 4 |

**shipment 는 `planned` 까지만 만든다.** 피킹 중 · 피킹 완료 · 출고완료 · short-pick 상태는 batch custody 세션 + 운송장 등록 + dispatch 와이어링이 있어야 도달할 수 있고(`outbound-v2-scenarios.integration.spec.ts` 의 `preparePackingAndDispatch` 가 그 무게를 보여준다), 그건 Phase 4 에서 붙일 표면이다. 더 근본적으로 **그 전이를 만드는 것이 앱 개발의 목적**이므로 시드가 미리 만들어 둘 이유가 약하다. 출고 이력 조회용 완료 건이 필요해지면 Phase 4 착수 시 별도로 추가한다.

### 7.6 `--bulk`

SKU +300(바코드 포함), 로케이션 +50. 재고조회가 서버 페이지네이션 표라 규모가 있어야 페이지네이션·검색·정렬의 실제 감각을 볼 수 있다. 평소 리셋은 소형으로 빠르게 돌린다.

> 구현 후 확정된 축소 3건 (초안 대비): ① 판매주문 +50 은 만들지 않는다 — 목록 규모만 필요한데 300건에 FO 변환·예약을 태우면 리셋이 눈에 띄게 느려진다. ② sub-barcode 보유 SKU 와 ③ 배치/유통기한 관리 SKU 도 만들지 않는다 — 해당 워크플로우가 아직 없다. 참고로 `master-data.ts` 가 넣는 `use_sub_barcode='true'` 설정은 **현재 어떤 서비스도 읽지 않는 비활성 데이터**다. 무언가를 켜는 것처럼 보이지만 아니다.

### 7.7 결정론성 규약

모든 ID · 바코드 · 주문번호는 **고정 상수이거나 인덱스에서 파생**한다. `randomUUID()` 를 쓰지 않는다 (통합테스트 픽스처는 격리를 위해 랜덤을 쓰지만, 시드는 정반대 요구다).

근거: 스캔 워크플로우를 개발하므로 바코드가 리셋마다 바뀌면 못 쓴다. 종이에 적어두거나 인쇄해서 계속 쓸 수 있어야 하고, 재현 가능한 버그 리포트도 여기 의존한다.

## 8. warehouse-app 전환

Vite 는 `.env` 파일을 파싱한 뒤 **셸의 `VITE_*` 로 덮어쓴다**(`vite/dist/node/chunks/node.js:5697`). 따라서 파일은 하나만 두고 셸 env 로 전환한다.

- `native/warehouse-app/.env.local` 의 `VITE_API_BASE_URL` 기본값을 `http://localhost:3100` 으로 변경.
- `VITE_OIDC_*` 3개는 라이브 그대로 유지 (§4.1).
- `.env.local.example` 도 같은 기본값 + 전환 방법 주석으로 갱신.

```bash
npm run tauri:dev                                                   # 로컬 core (기본)
VITE_API_BASE_URL=https://core.almondyoung.com npm run tauri:dev    # 라이브 core
VITE_API_BASE_URL=http://<tailscale-ip>:3100 npm run tauri:dev      # 안드로이드/타 기기
```

`package.json` 에 `tauri:dev` (= `tauri dev`) 와 `tauri:dev:live` 를 추가한다. 현재는 tauri 실행 스크립트 자체가 없다.

**안드로이드 주의**: 평문 HTTP 로 LAN/Tailscale IP 에 붙으려면 cleartext 허용이 별도로 필요하다. 데스크톱은 `tauri.conf.json` 의 `csp: null` 이고 core CORS 가 `origin: true` 라 추가 설정이 없다.

## 9. 검증 (스모크)

리셋 직후 다음을 순서대로 확인한다.

1. `docker compose up -d` 후 `docker compose ps` 에 **postgres · kafka · zookeeper 가 모두 running**. 브로커가 없으면 core 가 부팅하지 않으므로 이게 선행 조건이다 (§3.1).
2. `npm run dev:core:reset` 이 가드 통과 → 마이그레이션 → 시드까지 에러 없이 완료.
3. `npm run start:main:dev` 로 core 부팅. 로그에 `Scope initialization complete` 가 뜨고, Kafka 가 `localhost:9092` 에 붙으며, 토픽 부트스트랩이 성공(실패해도 크래시는 없지만 재시도로 부팅이 ~10초 지연된다).
4. warehouse-app 로그인(라이브 OIDC) → `/inventory` 표에 시드 SKU 20건.
5. 로그인 토큰의 `roles` claim 확인 → Phase 3 착수 전 `logistics_worker` 보유 여부 판정 (§4.3).
6. 리셋을 core 를 띄운 채로 한 번 더 돌려 403 이 나지 않는지 확인 (§4.2 의 스코프 부트스트랩 검증).
7. 쓰기 워크플로우를 한 번 태운 뒤 `outbox` 테이블이 **pending 으로 쌓이지 않고 드레인되는지** 확인. 쌓인다면 브로커 연결이 실패한 것이다 (§3.1 의 관찰 이득이 이 확인에서 나온다).

> ⚠️ **알려진 예외 — `StockReceived` 26건은 드레인되지 않는다.** 이 브랜치와 무관한 **기존 프로덕션 결함**이다. `InventoryCommandService.receive()` 가 만드는 페이로드(`afterQuantity`/`occurredAt` 포함, `stockEventId`/`inboundType`/`receivedAt` 누락)가 `packages/event-contracts/streams/inventory.stream.ts` 의 `StockReceivedSchema` 를 만족하지 않아 `StreamPublisher` 가 발행 시 throw 한다. 스키마는 2025-10-09, 문제의 페이로드는 2026-04-17 작성으로 **처음부터 불일치**했고 `develop` 에도 그대로 있다. 시드가 이 경로를 처음으로 충분히 두드려 드러났을 뿐이다. `StockReceived` 소비자가 현재 0개라 기능 파손은 없고, 5회 재시도 후 `failed` 로 종료된다(무한 루프 아님). **드레인 확인 시 이 26건은 제외하고 본다.** 수정은 별건 — `receive()` 의 입력 타입과 페이로드 빌더 + `InboundService` 호출부 3곳이 대상이다.

## 10. 문서화

`docs/local-dev.md` 에 "core 단독 개발 + `dev_core` 시드" 섹션을 추가한다. 이 문서가 로컬 환경의 SoT 라 여기 없으면 다음 사람이 찾지 못한다. 기존 "아직 로컬화 안 된 것" 의 시드 항목(`db:seed:ref`/`db:seed:demo` 가 로컬에서 못 돈다는 서술)도 본 설계의 결과에 맞춰 갱신한다.

## 11. 리스크 / 후속

| 항목 | 판단 |
|---|---|
| `wireLogistics` 수동 DI 를 시드가 공유 → 서비스 생성자 변경 시 동반 수정 | 한계비용 0 에 가깝다. 통합테스트가 이미 그 부담을 지고 있고, 깨지면 테스트가 먼저 알려준다 |
| 시드가 테스트 디렉터리(`__support__`)를 import | 소비자가 하나뿐인 동안은 승격하지 않는다 |
| 라이브 user-service 의존 → 오프라인 개발 불가, 토큰 만료 시 재로그인 | 수용. curl 디버깅은 §4.5 의 HS256 으로 우회 |
| Phase 3 진입 시 라이브 계정 role 부여 필요 | 유일한 라이브 쓰기. 착수 전에 토큰 claim 을 먼저 확인해 놀라지 않게 한다 |
| 로컬 PG 에 에이전트 작업 잔재 DB 9개(`core_task13_…` 등) | 본 설계와 무관하나 정리 대상. 별건으로 처리 |

## 12. 구현 체크리스트

- [ ] `env-templates/.env.core.local.example` 신규 — §5 (값 없는 템플릿)
- [ ] `apps/core/.env` 작성 (gitignore 대상, 커밋하지 않음) — §5
- [ ] `scripts/local/init-db.sql` 에 `CREATE DATABASE dev_core;` 추가 — §6.2
- [ ] `scripts/local/seed-dev-core.ts` 신규 — §7.2~7.7
  - [ ] 가드 (호스트 + DB 이름)
  - [ ] drop / create / migrate
  - [ ] 스코프 부트스트랩
  - [ ] 세계 생성 (창고·로케이션·화주·SKU·재고·입고·SO·FO·shipment)
  - [ ] `--bulk`
- [ ] `package.json` 에 `dev:core:reset` 추가
- [ ] `native/warehouse-app/.env.local` + `.env.local.example` 기본값 변경 — §8
- [ ] `native/warehouse-app/package.json` 에 `tauri:dev` / `tauri:dev:live` 추가 — §8
- [ ] `docs/local-dev.md` 섹션 추가 및 시드 관련 서술 갱신 — §10
  - [ ] core 로컬 기동에 kafka·zookeeper 기동이 선행 조건임을 명시 — §3.1
- [ ] §9 스모크 7단계 수행
