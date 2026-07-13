# 물류 도메인 로컬 통합 테스트 설계

- 날짜: 2026-07-13
- 브랜치: `test/logistics-local-integration`
- 목표: dev 스테이지 폐기 이후, 물류(inventory/fulfillment) 도메인 로직 정확성을 **로컬에서 jest 통합 테스트로** 검증할 수 있게 만든다. 더불어 새로 들어오는 물류 기능을 위한 간단한 통합 테스트 3개를 추가한다.

## 배경 / 현재 상태

- AWS dev 스테이지가 비용 문제로 제거됨. 통합 테스트를 로컬에서 돌려야 한다.
- 로컬 인프라는 이미 갖춰져 있다: 루트 `docker-compose.yml`(postgres/redis/kafka/zookeeper), `scripts/local/init-db.sql`(논리 DB 10개 생성), `npm run db:migrate:local`(localhost URL 주입 마이그레이션).
- core 통합 spec 13개가 이미 존재하며 전부 `DATABASE_URL` 게이트(`const describeIfDb = DATABASE_URL ? describe : describe.skip`)를 쓴다.
  - **11/13은 rollback-only**: 테스트 로직을 트랜잭션으로 감싸고 끝에 `Rollback` 예외를 throw → 커밋 안 됨. outbox는 `jest.fn()`으로 mock → **Kafka 불필요**. DB가 by-construction 깨끗.
  - **2/13만 실제 커밋**: `unified-reservation.service.lock.integration.spec.ts`(두 커넥션 동시 락 검증이라 롤백 불가), `store-return-exchange.refund.integration.spec.ts`. 둘 다 `randomUUID` 접미사 픽스처라 재실행 충돌은 없으나 행은 남긴다.
- 통합 테스트는 서비스를 **직접 와이어링**(HTTP·컨트롤러·auth 미경유)하므로 `.env`도 불필요하다. 필요한 것은 마이그레이션된 postgres + `DATABASE_URL`뿐.

### 갭 (= 이 작업이 메우는 것)

1. **편의 러너가 죽은 dev를 가리킴**: `scripts/test-core-integration.sh` → `scripts/test-core-integration.cjs`가 `sst shell` + VPC 터널로 dev RDS(`Resource.Db`)에 붙는다. dev가 없어졌으므로 이 경로는 못 쓴다. 로컬 compose `core` DB를 물리는 러너가 없다.
2. 물류 도메인의 몇몇 근본 연산에 전용 통합 커버리지가 없다: 입고(`receive`, IN), 예약 생명주기(reserve→release), 창고내 이동(`moveInternal`).

## 결정: 러너 격리 전략

**공유 compose `core` DB 재사용.** 매 실행 ephemeral 컨테이너를 띄우는 대신, 이미 떠 있는 compose `core` DB에 대고 실행한다.

- 근거: 11/13이 rollback-only라 DB를 더럽히지 않고, 나머지 2개는 unique 접미사 픽스처라 재실행 충돌이 없다. ephemeral(매번 ~10–20s 컨테이너 부팅)은 이 워크로드에 과함.
- "새 것같은 core+db"는 rollback-only 패턴이 자동 보장한다. pristine이 꼭 필요하면 `docker compose down -v && docker compose up -d` 후 `db:migrate:local`로 초기화(문서에 명시).

## Part 1 — 로컬 통합테스트 인에이블먼트

### 1.1 새 러너 `scripts/local/test-core-integration-local.sh`

동작 순서 (콜드 스타트부터 한 방 보장):

1. `docker compose up -d postgres` — 이미 떠 있으면 no-op.
2. `pg_isready` 폴링으로 postgres 준비 대기(타임아웃 있음).
3. core 스키마 마이그레이션: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx drizzle-kit migrate --config apps/core/drizzle.config.ts` — 이미 적용됐으면 no-op.
4. 테스트 실행: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx jest --testPathPattern="${1:-integration}" --runInBand`.

- 첫 번째 인자로 jest 패턴 지정 가능(기존 러너와 동일 UX). 예: `npm run test:core:integration:local -- receive.integration`.
- `LOCAL_PG` 환경변수로 접속 URL 오버라이드 가능(포트 충돌 시). `migrate-all.sh`의 컨벤션과 일치.
- `set -euo pipefail`.

### 1.2 `package.json` 스크립트

```json
"test:core:integration:local": "./scripts/local/test-core-integration-local.sh"
```

### 1.3 죽은 러너 처리

`scripts/test-core-integration.sh`와 `scripts/test-core-integration.cjs` 상단 주석에 **deprecated (dev 스테이지 폐기됨 — `npm run test:core:integration:local` 사용)** 한 줄 추가. 파일 삭제는 이번 범위 밖.

### 1.4 문서 `docs/local-dev.md`

"물류 통합 테스트" 섹션 추가:

- 한 줄 실행법 + 특정 spec만 돌리는 법.
- **새 물류 통합 테스트 작성 레시피**: `describeIfDb` 게이트, `class Rollback` + `inRollbackTx(fn)` 헬퍼, 픽스처 빌더로 warehouse→location→sku를 tx 안에서 직접 insert, outbox는 `{ enqueue: jest.fn() }`로 mock.
- **커밋형 2개 caveat**: `unified-reservation.service.lock`, `store-return-exchange.refund`는 unique 접미사 행을 남긴다. pristine이 필요하면 compose 볼륨 초기화.

## Part 2 — 새 통합 테스트 3개

공통 규약: 전부 rollback-only, `DATABASE_URL` 게이트, 픽스처 빌더 사용, outbox mock. 기존 `transfer.service.integration.spec.ts`/`fulfillment-order-reservation-retry.worker.integration.spec.ts`의 패턴을 그대로 따른다.

### A. 입고(`receive`, IN) 무손실

- 파일: `apps/core/src/modules/inventory/core/services/inventory-command.service.receive.integration.spec.ts`
- 대상: `InventoryCommandService.receive`
- 검증: 빈 (sku, warehouse)에 대해 receive N 실행 후 —
  - `stock_summary`의 ON_HAND == N
  - `stock_events`에 `IN` 타입 이벤트 1건, quantity == N
  - `stock_summary.version`이 +1 증가

### B. 예약→해제 원복

- 파일: `apps/core/src/modules/inventory/shared/services/unified-reservation.service.lifecycle.integration.spec.ts`
- 대상: `UnifiedReservationService.reserveStock` / `releaseReservation`
- 검증: ON_HAND N 세팅 후 —
  - `reserveStock(qty=k)` → available(ON_HAND − reserved) == N−k, ON_HAND 불변
  - 이어서 `releaseReservation(id)` → available == N 로 원복, ON_HAND 여전히 불변
  - 예약 레코드 상태가 해제됨을 확인

### C. 창고내 이동(`moveInternal`) 보존

- 파일: `apps/core/src/modules/inventory/core/services/inventory-command.service.move-internal.integration.spec.ts`
- 대상: `InventoryCommandService.moveInternal`
- 검증: 같은 warehouse 안 로케이션 A에 ON_HAND N 세팅 후 A→B로 k 이동 —
  - 창고 전체 ON_HAND 합 == N (불변)
  - 로케이션 A == N−k, 로케이션 B == k
  - 이동 이벤트(MOVE 계열)가 적절히 기록됨

## 비범위 (YAGNI)

- Kafka/outbox 실발행, 데이터 시딩, 프론트 테스트베드 — rollback-only + outbox mock이라 불필요.
- ephemeral DB 모드(`--ephemeral`).
- confirm(OUT) 소비 경로 — 이미 `outbound-consumption.integration.spec.ts`가 커버하고 복잡함.

## 검증 방법

- `npm run test:core:integration:local -- inventory` 로 신규 3개 포함 물류 통합 테스트가 로컬 compose DB에서 green.
- `DATABASE_URL` 미설정 시 `npm test`에서는 자동 skip(기존 게이트) — CI/유닛 흐름 무영향.
