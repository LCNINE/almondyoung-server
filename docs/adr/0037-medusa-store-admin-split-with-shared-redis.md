# Medusa 는 store 와 admin 두 서비스로 나누고, 공유 Redis 를 복원한다

## Status
Accepted (2026-09-13). #853 의 결정, 구현은 #855. 설계 초안은
`docs/superpowers/specs/2026-08-13-bulk-import-medusa-load-design.md` §5D.
이 결정은 2026-07-05 의 「ElastiCache 제거 → Medusa valkey 사이드카」(`docs/aws-cost-report-2026-07-07.md`)
를 되돌린다.

## Context
Medusa 는 Fargate 태스크 **한 개**다. `deployments/lcnine/services/infra/services.ts` 의 Medusa
`createService` 가 `scaling: { min: 1, max: 1 }` 로 고정하고, 주석이 사유를 적는다 — Redis 가
**같은 태스크의 valkey 사이드카**라서 태스크가 둘이면 세션·BullMQ 큐·워크플로 상태가 갈라진다.
그 사이드카는 2026-07 비용절감에서 ElastiCache(월 약 17.5달러)를 대체한 것이다.

그 한 태스크가 두 부류의 일을 같은 Node 이벤트 루프에서 받는다.

- **읽기** — 스토어프론트의 모든 렌더가 `/store/*` 를 친다 (상품·카테고리·장바구니·결제).
- **쓰기** — channel-adapter 가 PIM 이벤트를 소비해 `/admin/*` 를 상품 1건씩 친다
  (`pim-medusa-sync.service.ts` 의 `upsertProduct` → `attachProductToCategories` → `syncPriceLists`).
  호출 1건의 비용은 데이터 양이 아니라 **워크플로 고정비**가 바닥을 만든다 (설계 §2-2·§5A 실측).

2026-09-12 라이브 실측(#852)에서 관리자 일괄 작업 구간과 스토어프론트 지연 구간이 분 단위로
일치했다 — CPU 가 작업 내내 90% 대에 고정되고 ALB p95 가 비-작업 구간의 10배 이상, 스토어프론트
p99 가 Lambda 타임아웃에 붙는다. 같은 날의 정정 코멘트가 「캐시 파괴」 가설을 반증했다 —
무효화 빈도는 무-작업일과 겹쳤고, 요청 1건당 CPU 비용이 작업 중 약 2.5배로 오른 것이 지배
원인이다. 즉 **비싼 쓰기가 읽기와 같은 줄에 서는 것**이 문제다.

#631 은 쓰기 «횟수»(revalidate 배치화·신규 상품 price list remove 스킵)를 줄였고, 위 실측은
전부 그 머지 뒤다. 설계 §5D 는 분리 + 공유 캐시를 이미 적어 두었으나 「비용 목표와 반대 방향」이라
미뤄 두었다. 2026-09-13 에 그 비용을 수용하기로 결정했다.

## Decision
- **공유 Redis 를 복원한다.** 기본 후보는 설계 §5D 의 ElastiCache Serverless(Valkey). 노드형과의
  비용 비교는 #855 에서 한 번 하고, 결과를 이 ADR 에 추기한다. 사이드카의 `appendonly no` +
  `save ''`(재시작 시 인플라이트 큐 유실 허용) 전제는 공유 캐시에서 폐기한다 — 영속 정책은
  관리형 기본값을 따르고, 큐 유실을 «설계의 전제»로 두지 않는다.
- **Medusa 를 두 서비스로 나눈다.**
  - **store** — `workerMode: server`. `/store/*` 와 `/auth/*` 만 받는다. subscriber·scheduled job·
    워크플로 비동기 단계를 돌리지 않는다. 스토어프론트의 `MEDUSA_BACKEND_URL` 이 여기를 본다.
  - **admin** — `workerMode: shared`. `/admin/*` 와 백그라운드 전부(subscriber·cron·워크플로 엔진).
    channel-adapter·admin-web·타임세일 크론·백필이 여기를 본다.
  - 라우팅은 **ALB 리스너 룰의 경로 조건**으로 한다(`/admin/*` → admin). `createService` 가 이미
    `transform.listenerRule` 로 host 조건을 덮어쓰므로 같은 자리에 붙인다.
- **`max: 2` + shared 하나는 채택하지 않는다.** ALB 라운드로빈이라 스토어프론트 요청이 여전히
  대량등록과 같은 이벤트 루프에 줄을 선다. 비용이 같은데 격리가 없다 (설계 §5D 「대안 기각」).
- **`workerMode` 분리만으로는 부족하다.** admin API 가 실행하는 워크플로는 요청을 받은
  인스턴스에서 **동기** 실행된다. 경로 조건이 없으면 쓰기가 store 에서 빠지지 않는다.
- **쓰기 비용 자체는 별도로 줄인다** — #856(상품 N 건 묶음 동기화 라우트). 분리는 격리를, 묶음은
  admin 인스턴스의 비용을 N 분의 1 로 줄이는 독립 효과를 갖는다. 둘은 서로를 대체하지 않는다.
- **전후 비교는 #710(트레이스 샘플링) 정리 뒤 같은 측정 창에서 한다.** 무샘플링 계측이 CPU 수치의
  교란 변수다.

## Consequences
- 월 비용이 오른다 — 두 번째 Fargate 태스크 + 관리형 Redis. 추정치는 설계 §5D, 실측치는 배포 후
  `docs/aws-cost-report-*.md` 에 적는다. [[aws-cost-optimization]] 의 완료 항목
  「ElastiCache → valkey 사이드카」는 이 ADR 로 **번복**된 것으로 표시한다.
- store 가 `max: 1` 잠금에서 풀린다. 스케일아웃은 이 ADR 의 목표가 아니지만, 막는 사유는 사라진다.
- **cron 중복 실행 문제가 사라진다.** `apps/medusa/src/jobs/sync-product-sort-index.ts` 주석이
  지적한 「태스크가 둘이면 두 번 돈다」는 백그라운드를 admin 하나만 돌리므로 성립하지 않는다.
  store 를 나중에 스케일아웃해도 같다.
- `locking-redis`·`workflow-engine-redis`·`event-bus-redis`·`cache-redis`·`caching-redis` 가 전부
  같은 공유 Redis 를 본다(`medusa-config.js`). 인덱스 분리는 ElastiCache 시절과 같다.
- 배포는 SST 한 스택이다 — 「A 먼저」를 실행할 수단이 없다([[sst-single-stack-no-deploy-order]]).
  Redis 복원 → 두 서비스 생성 → 호출자 URL 전환을 **한 배포**로 묶고, 롤백은 `services.ts` 의
  해당 블록 되돌리기다. 옛 사이드카 valkey 의 인플라이트 큐는 전환 시점에 유실된다 — 대량등록이
  돌지 않는 시각에 배포한다(#852 의 구간 도출 SQL 로 확인).
- Medusa ECS Exec(`--container main`)·백필 스크립트는 admin 서비스를 대상으로 한다.
- 닫기 판정: 대량등록 세션 구간의 **store** CPU·ALB p95 가 비-대량 구간과 구분되지 않는다
  (#852 의 닫기 조건을 store 로 좁힌 것). 측정 함정은 #852 본문 — AWS CLI 타임스탬프는 KST,
  `inbox_events` 는 UTC.
- 이 ADR 은 Medusa 를 읽기 경로에서 빼는 것(카탈로그를 별도 read model 에서 읽기)을 결정하지
  **않는다**. 그 방향은 [[storefront-perf-structural-roots]] 에 지평선 옵션으로만 적혀 있다.
