# core 는 테넌트마다 논리 DB 를 따로 둔다

## Status
Accepted (2026-10-29, 교정 10-30). 라이브(전환 배포 ②, 2026-11-02). 멀티테넌트 전체 그림은 `docs/multi-tenancy.md`.
같이 읽을 결정: [[0052-account-is-global-tenant-is-membership-and-grant]] · [[0053-event-tenant-stamped-by-library-gated-before-handler]] ·
[[0054-shared-services-serve-one-tenant]] · [[0055-tenant-shell-on-tenant-domain]].

## Context
두 번째 테넌트(자기 창고·상품·직원으로 이 시스템을 쓰는 회사)가 core 프로세스·RDS 인스턴스·Kafka·ALB 를 테넌트 1 과 함께 쓰게 됐다.
새 SST stage 는 VPC·NAT·RDS·브로커·검색까지 전부 복제돼 비용이 사실상 두 배라 배제했다 — **인스턴스는 공유**한다.

남은 질문은 core 데이터를 어떻게 가르는가였다. core 는 테이블 162개, unique 98개, FK 259개에 raw SQL 도 있다.

## Decision
1. **테넌트마다 같은 RDS 인스턴스 위의 별도 논리 DB.** 테넌트 1 은 기존 `core` DB 그대로(데이터를 옮기지 않는다), 새 테넌트는 `core_<slug>`.
2. **`DbService` 가 맥락의 테넌트로 풀을 고른다.** 요청·메시지·크론이 CLS 맥락(`TENANT_CONTEXT_KEY`)에 테넌트를 세우고,
   `apps/core/src/platform/tenancy/core-tenant-db-router.ts` 가 테넌트 목록의 `coreDb` 마다 풀을 하나씩 둔다.
3. **맥락이 없으면 기본 테넌트로 떨어지지 않고 실패한다**(`TenantContextMissingError`). 목록에 없는 테넌트도 실패(`TenantNotListedError`).
   «없으면 테넌트 1» 은 시한부로도 코드에 들이지 않는다 — 빠뜨린 곳이 조용히 테넌트 1 데이터를 읽기 때문이다.
4. **요청 밖 작업(크론·폴러·outbox·리컨실러·부팅 훅)은 `DbService.forEachDatabase` 로 테넌트마다 차례로 돈다.** 한 테넌트의 실패는 그 테넌트 결과로만 돌아온다.
   동시에 돌리지 않는다 — 크론 본문 다수가 인스턴스의 «도는 중» 깃발을 써서 둘째 테넌트가 조용히 건너뛴다.
5. **테넌트 목록은 코드가 아니라 Secret 이다**(값의 SoT 는 lcnine-auth 의 `TenantList`, services 앱은 SSM 으로 받는다). 모양은
   `{ id, slug, coreDb, publicBucket, privateBucket }[]`(`libs/tenancy/src/tenant-list.ts`). 이름·로고·도메인은 user-service 테넌트 행에 있다.
   id·slug 는 바뀌지 않는다. DB 접속 정보는 RDS 링크에서 만들고 목록엔 DB 이름만 담는다.
6. **테넌트 상태는 준비 → 활성 ↔ 정지**(user-service 테넌트 행). 준비 중엔 토큰이 발급되지 않는다. 즉시 멈추는 스위치는 목록(재배포 필요)이 아니라 «정지» 상태이고,
   core 는 그 상태를 짧게 캐시해 남은 액세스 토큰도 거절한다(`tenant-status-cache.ts`).
7. **DB 를 읽지 않는 라우트만 `@TenantFree()`** 로 맥락 판정에서 뺀다(ALB `/health` 등). 그런 라우트가 나중에 DB 에 닿으면 새지 않고 터진다.

## Considered Options
- **공유 테이블 + `tenant_id`(+RLS)** — 반려. 모든 쿼리·unique·FK·raw SQL 을 고쳐야 하고, 빠뜨린 조건 하나가 곧 누출이다. 막으려면 RLS + FORCE + 비소유자 역할 + 복합 FK 가
  다 필요하다. 교차 테넌트 SQL 이 쉽다는 것이 유일한 우위였다. 이 방식(DB 분리)에선 그 버그 종류가 사라지고 위험이 «맥락을 세우는 몇 곳»으로 모인다.
- **테넌트별 Postgres 스키마** — 반려. drizzle 생성 마이그가 `"public".` 을 박아 넣어(66/145 파일), 같은 SQL 을 테넌트 스키마에 다시 돌리면 FK 가 조용히 public 을 가리킨다.
  outbox(`event` 스키마)도 공유돼 버린다.
- **테넌트별 SST stage** — 반려. 비용 두 배.

## Consequences
- 테넌트를 가로지르는 SQL 은 없다. 운영 집계가 필요하면 테넌트마다 돌려 합친다.
- **마이그는 테넌트 DB 수만큼 돈다. 전 테넌트 동일 버전이 배포 조건이다**(일부 테넌트만 새 버전은 허용하지 않는다 — expand-contract 규율이 한 DB 전제로 쓰였다).
  `db:bootstrap`·`db:migrate`·`db:seed:ref`·`deploy:preflight` 의 core 항목은 정적 레지스트리의 DB 하나가 아니라 목록의 테넌트마다 펼친다
  (`scripts/seeding/lib/tenant-registry.ts`). 이름 규칙(`core_*`)으로 테넌트를 찾지 않는다. 목록에 아직 없는 준비 중 테넌트는 `--tenant <slug>` 로만 지목한다.
  preflight 는 테넌트 DB 사이 마이그 버전이 다르면 1, 목록 밖 `core_*` DB 는 경고만 한다.
- **참조 시드는 두 갈래**: `baseline`(모든 테넌트 — 보충 기본값·등급 규칙)과 `baseline-tenant-1`(테넌트 1 전용 — 창고·구역·창고 설정, 자사몰 판매채널).
  새 테넌트 DB 엔 첫 갈래만 든다. core 부팅은 창고를 만들지 않는다.
- 연결 수가 테넌트 수에 비례한다(core 풀 10/테넌트, 롤링 배포 중엔 두 배). 두 번째 테넌트 개통 전에 RDS 를 t4g.small(≤225 연결) → t4g.medium(≤450)으로 올렸다.
  테넌트를 늘리거나 다른 앱(Medusa 등)을 테넌트별로 넓히면 다시 잰다.
- 테넌트 내보내기·삭제는 `pg_dump` / `DROP DATABASE` 로 끝난다. 만들기의 마지막 단계가 «목록에 넣기»라, 목록 전 실패는 `DROP DATABASE` 로 되돌린다
  (목록에 들어가기 전엔 크론·outbox 가 그 DB 를 모른다).
- 테넌트가 10개를 넘을 전망이 생기면 이 결정을 다시 연다(풀·마이그 시간·연결 수가 선형으로 는다).
- 전환은 두 번의 배포였다: ① core 는 기존 단일 DB 를 그대로 쓰고 맥락 없는 요청을 세기만 한다(`TENANT_GATE_MODE=warn`, 라우터 없음),
  ② 라우팅과 «없으면 거절»을 함께 켠다(`reject`). ① 에서 «없으면 테넌트 1» 로 라우팅하지 않은 것은 결정 3 때문이다.
  🔴 **1 이 아닌 테넌트를 하나라도 만든 뒤에는 ② 이전으로 되돌리지 않는다** — ① 의 core 는 단일 DB(테넌트 1)를 써서 다른 테넌트 토큰이 테넌트 1 데이터를 읽는다.
