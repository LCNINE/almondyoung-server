# 대량등록의 Medusa 부하와 처리량 설계

작성 2026-08-13. 대량등록이 Medusa 를 포화시켜 storefront 를 느리게 만드는 문제와, 상품 2,553건에
17시간이 걸리는 처리량 문제를 함께 다룬다.

## 1. 배경

2026-08-12 이전 진단은 storefront 체감 지연의 원인을 렌더당 Medusa 호출 증가(1.45 → 2.08)로 지목했고,
`listShippingGroups()` 캐시 누락을 고쳐(`7c3d5f557`) 08-12 15:22 KST 에 배포했다. **그 수정은 실제로
먹혔다** — 배포 직후 6시간(15~21시) 렌더당 호출 1.59~1.79, Medusa p95 0.95~1.96s, CPU 24~51%.

그러나 08-12 22시부터 별개의 국면이 시작됐고 이 문서 작성 시점까지 15시간 넘게 진행 중이다.
CPU 68~86% 지속, 메모리 74~84% 고착. 이 국면의 원인은 storefront 트래픽이 아니다.

## 2. 측정 근거

모든 수치는 라이브 CloudWatch 실측이다. 별도 표기가 없으면 창은 **2026-08-13 04:00~09:00 KST
(18,000초)**, Medusa 는 `1 vCPU / 2 GB / scaling min 1 max 1 / valkey 사이드카 동거`.

### 2-1. 부하는 트래픽이 아니라 대량등록에서 온다

| 시각 | storefront Lambda 호출 | Medusa CPU |
|---|---:|---:|
| 08-12 05시 | 3,658 | 27.9% |
| 08-13 05시 | 2,588 (더 적음) | **75.8%** |

트래픽이 더 적은데 CPU 는 2.7배. 요청 처리가 아니라 백그라운드 유입이 태우고 있다.

### 2-2. Medusa 요청 시간 귀속

`[SLOW]` 미들웨어(`apps/medusa/src/api/middlewares.ts:27`)가 300ms 초과 요청만 남기므로 아래는 하한선이다.

| 총시간 | 건수 | 평균 | 엔드포인트 |
|---:|---:|---:|---|
| 2,548s | 771 | 3.30s | `POST /admin/price-lists/{id}/products` (remove) |
| 2,523s | 770 | 3.28s | `POST /admin/price-lists/{id}/prices/batch` (add) |
| 2,193s | 766 | 2.86s | `POST /admin/products` |
| 387s | 301 | 1.29s | `POST /admin/inventory-items` |
| 300s | 198 | 1.51s | `POST /admin/price-lists/{id}` |
| **≈8,130s** | | | **대량등록 소계 = 창의 45%** |
| 1,110s | 1,605 | 0.69s | `GET /store/product-categories` |
| 294s | 145 | 2.03s | `GET /store/products` |
| 250s | 162 | 1.54s | `GET /store/products-sorted` |
| **≈1,900s** | | | **storefront 소계 = 창의 10.5%** |

대량등록이 storefront 의 4.3배. Medusa 시간 10.6초/상품 중 **price list 가 6.6초(62%)** 로,
상품 생성(2.86초)보다 2.3배 비싸다.

### 2-3. 처리량 회계

핸들러 실제 소요는 `Syncing from event snapshot: {masterId}` → `revalidate ... for handle={masterId}`
쌍으로 측정했다(창 08-13 07:00~09:00 KST, 269쌍). `Sync completed` 로그(`:387`)는 price list 동기화와
revalidate **이전에** 찍히므로 종료 표지로 쓸 수 없다.

- 핸들러 소요 **p50 21.2s / mean 23.9s / p90 35.4s**
- 처리량 **26.6초/상품**, 슬롯 가동률 **45%** (`INBOX_MAX_CONCURRENT_HANDLERS=2`)
- 슬롯이 빈 뒤 다음 시작까지 **p50 9.0s / mean 16.9s**, 3.5초 이내는 21%뿐
  (최솟값이 정확히 3.0초 = `INBOX_HANDLER_START_INTERVAL_MS` 이므로 타이머 자체는 정상)

상품 1건당 가용 슬롯시간 53.2초의 구성:

| 항목 | 초 | 비중 |
|---|---:|---:|
| 클레임 유휴 | 29.3 | 55% |
| channel-adapter 자체 작업 | 8.3 | 16% |
| price-list remove + add | 6.6 | 12% |
| storefront revalidate 대기 | 5.0 | 9% |
| Medusa 상품 생성 | 2.9 | 5% |
| Medusa 기타 | 1.2 | 2% |

대량등록은 08-12 22시에 시작해 17시간 동안 약 2,553건을 처리했다.

### 2-4. 기각된 가설 (재조사 금지)

- **sort-index subscriber 중복 실행** — 아니다. 5시간에 워크플로 773회, 상품 766건 = **1.01회/상품**.
  로그 2줄(step 의 `Sort index updated` + subscriber 의 `Price sync completed`)을 중복 실행으로
  오독했던 것. 디바운스는 1% 남짓만 아낀다.
- **valkey noeviction 폭탄** — 아직 안 터졌다. Medusa 로그에 OOM/maxmemory 0건.
- **revalidate 라우트의 `listRegions()` 되먹임** — 아니다. 창 안 `/store/regions` 33건뿐, Next fetch
  캐시가 먹고 있다.
- **캐시 무효화가 죽어 있다** — 아니다. storefront 쪽 `storefront.revalidate.completed` **770/770**.
  `AbortSignal.timeout(5000)` 은 호출자 fetch 만 끊고 Lambda 는 끝까지 실행한다.

## 3. 문제 정의

두 축이고 답이 다르다.

- **축 A — storefront 가 느리다.** 대량등록이 Medusa 1 vCPU 를 포화시킨다. 최대 기여자는 price list(62%).
- **축 B — 대량등록이 17시간 걸린다.** 최대 기여자는 인박스 클레임 유휴(55%).

price list 는 두 축 상단에 동시에 등장하는 유일한 항목이고, **유일하게 카탈로그 크기에 따라 자란다**
(같은 대량등록 안에서 평균 2.6초 → 5.4초).

## 4. 범위

**포함**

- A. price list 호출 배치화
- B. storefront revalidate 배치화
- C. 인박스 클레임 유휴 (선행 조사 후)
- D. Medusa admin/store 인스턴스 분리 + 공유 캐시

**제외**

- **in-process 경로 전환** — `apps/medusa/src/scripts/backfill-from-core.ts` 가 `createProductsWorkflow`
  를 직접 불러 HTTP/auth/ALB 를 통째로 우회하는 경로가 이미 있고 백필로 검증됐다. 처리량을 분 단위로
  내릴 수 있는 유일한 수단이지만, 현재는 image 에 baking 된 JSON 전용이라 런타임 경로로 쓰려면
  재설계가 필요하다. **별도 과제로 분리한다.**
- sort-index subscriber 디바운스 — §2-4 에서 기각.
- Medusa 수직 확장 — Node 단일 스레드라 1→2 vCPU 효과가 제한적.

## 5. 설계

### A. price list 호출 배치화

**현재.** `syncPriceLists`(`apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.ts:567`)가
상품마다 `removeProductFromPriceList` + `addPricesToPriceList` 를 부른다(`:620`, `:633`).
상품 766건에 price-list 호출 1,541회.

**왜 3.3초인가.** 가격 데이터 처리가 아니라 호출당 고정비다. 두 엔드포인트 모두
`batchPriceListPricesWorkflow` 로 들어가는데, 이 워크플로는 create / update / remove **세 개의 중첩
워크플로를 `parallelize` 로 항상 전부 실행한다**. remove 요청이라 `create: []`, `update: []` 인데도
건너뛰지 않는다 — 조기 반환 가드가 `if (!data.length)` 로 **바깥 배열 길이(=1)** 를 보지 안쪽 `prices`
를 보지 않기 때문이다(`validate-variant-price-links.js`, `validate-price-lists.js`). 결과적으로 빈
작업인 하위 워크플로 2개가 매 호출 쿼리를 낸다. 여기에 라우트 자체의 remote query 3회
(`fetchPriceListPriceIdsForProduct` 2회 + `fetchPriceList` 1회)와 workflow-engine 체크포인트
(Redis 쓰기 + Postgres `workflow_execution` upsert)가 스텝마다 얹힌다.

방증: 단순 갱신인 `POST /admin/price-lists/{id}` 도 1.51초다. 워크플로 오버헤드 바닥이 1.5초쯤이고,
price list 조작은 중첩 워크플로가 더 얹혀 3.3초가 된다.

**설계.** 상품 단위 호출을 세션 단위 배치로 바꾼다.

- 핸들러는 price list 항목을 즉시 반영하지 않고 버퍼에 누적한다
- 주기적으로(§B 와 같은 flush 지점) 누적분을 `POST /admin/price-lists/{id}/prices/batch` **한 번**으로
  보낸다. 이 엔드포인트는 `create` 에 여러 variant·여러 상품의 가격을 한 번에 받도록 설계돼 있다
- `remove` 는 배치 안에서 한 번만 수행한다. `upsertProduct` 가 반환하는
  `action: 'created' | 'updated'`(`medusa.client.ts:1674`)를 버퍼에 같이 담아, 배치의 `delete` 대상은
  `updated` 인 상품의 기존 price id 로만 구성한다. 신규 생성 상품은 price list 에 항목이 있을 수 없다
- 기존 주석이 밝힌 remove 의 이유("재동기화 시 중복 누적, 낮은 옛 가격이 이김")는 배치 안에서
  delete+create 를 한 워크플로로 처리하면 그대로 유지된다

**효과.** 호출 1,541회 → 수십 회. 상품당 6.6초 → 0에 수렴. Medusa CPU 부하의 62% 제거.
카탈로그 크기에 따른 악화도 멈춘다.

**주의.** `action='created'` 인데 실제로는 상품이 이미 존재하는 경로(매핑 기록 실패 후 재시도 등)가
있으면 중복 가격이 생긴다. 구현 전에 `upsertProduct` 의 분기(`medusa.client.ts:1683`, `:1706`, `:1714`)
를 읽고 그 경우가 가능한지 확인할 것.

### B. storefront revalidate 배치화

**현재.** `syncFromSnapshot:400` 이 상품마다 `revalidateProduct(handle)` 를 **await** 한다.
창 안 771건 중 762건이 5초 타임아웃(`AbortSignal.timeout(5000)`,
`storefront-revalidate.service.ts:56`). 그런데 storefront 쪽은 770/770 완료 — 호출자만 기다렸다 버린다.

**진짜 문제는 과잉 무효화다.** `web/almondyoung-storefront/src/app/api/revalidate/route.ts` 는
`handle` 하나를 받으면:

| 작업 | 범위 |
|---|---|
| `revalidateTag('product-{handle}')` | 해당 상품 — 적정 |
| `revalidateTag(PRODUCT_LIST_TAG)` | **전체 상품 목록** |
| `revalidatePath('/{cc}/products/{handle}')` | 국가별 상세 경로 |
| `revalidatePath('/[countryCode]/category/[...segments]', 'page')` | **모든 카테고리 페이지** |
| `revalidateTag(...body.tags)` | `pim-detail-{handle}` |

상품 1건마다 목록 캐시 전체와 카테고리 페이지 전체가 날아간다. 17시간 × 2,553건이면 캐시가 데워질
틈이 없다. 라우트 설계 자체는 단건 변경에 합리적이다 — 목록 fetch 태그가
`${tag}-${_medusa_cache_id}` 로 **방문자별**이라 백엔드가 지목할 수 없고, 그래서 공용 태그를 칠 수밖에
없다(라우트 주석). 문제는 대량 경로가 그 단건 API 를 2,553번 부르는 것이다.

**설계.**

- bulk origin 이면 개별 상품 sync 에서 revalidate 를 호출하지 않는다
- handle 을 버퍼에 모았다가 **주기적으로 한 번** 호출한다. 그 한 번에 전역 무효화도 1회만 일어난다
- 라우트는 이미 `tags: []` / `paths: []` 배열을 받으므로 **storefront 변경 없이** 가능하다
- flush 주기는 60초를 기본값으로 하되 환경변수로 조정 가능하게 둔다

**flush 지점 선택.** `importSessionId` 는 이벤트 **payload** 에 실린다(metadata 에는 없다 — 인박스
정렬이 payload TOAST 해제를 피하려는 의도적 설계). 핸들러 시점에는 payload 가 이미 로드돼 있어
세션 단위 그룹핑이 가능하다. 그럼에도 **주기적 flush 를 택한다**:

| 방식 | 평가 |
|---|---|
| core 가 "세션 완료" 이벤트 발행 | 가장 정확하나 core 변경 필요 |
| 세션별 디바운스(N초 무이벤트 시 flush) | core 변경 0. 세션 경계 추적 필요 |
| **주기적 flush (60초마다 누적분 1회)** | **세션 개념 불필요. 재시작에 강함** |

주기 flush 는 프로세스가 죽어도 최악이 "그 주기분이 캐시 TTL(1시간)까지 늦게 반영"이다.

**효과.** 상품당 5초 회수(처리량 21%)와, 더 중요하게 **대량등록 중에도 storefront 캐시가 살아남는다.**
이건 Medusa CPU 와 독립된 두 번째 지연 축이다.

**부수 작업.** fire-and-forget 이 되면 5초 타임아웃은 의미가 없어지므로 정리한다. 지금은 762건이
`error` 로그라 진짜 실패가 묻힌다 — 실패 로그는 실제 실패에만 남긴다.

### C. 인박스 클레임 유휴 — 선행 조사 필요

**현상.** 슬롯이 비어도 다음 핸들러가 평균 16.9초 뒤에야 뜬다. 상품당 가용 슬롯시간의 55%.

**가설.** `claimNextInboxEvent`(`apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts:214`)
의 `ORDER BY (bulk lane), created_at`. 코드 주석 자체가 "ORDER BY 표현식은 LIMIT 1 이어도 후보 행
전부에 대해 계산된다"고 밝힌다. 적체가 클수록 매 틱 전수 정렬이 된다. `tryStartNextHandler` 는
`isClaiming` 전역 뮤텍스로 감싸여 있어 클레임이 느리면 그동안 틱이 통째로 스킵된다.

**선행 조사.** 구현 전에 확정한다.

1. 프로덕션 `inbox_events` 에서 클레임 쿼리 `EXPLAIN ANALYZE`
2. `(event_type, created_at)` 및 metadata origin 표현식을 받쳐줄 인덱스 존재 여부
3. pending 행 수 추이

**조사 결과에 따른 갈래.** 인덱스로 해결되면 인덱스 추가(마이그레이션 1건). 표현식 정렬 자체가
문제면 레인을 컬럼으로 승격(`lane smallint` 생성 컬럼 + 인덱스)해 정렬을 인덱스에 태운다.

**순서 제약이 있다.** C 를 A·B 보다 먼저 하면 처리량만 2배가 되면서 Medusa 가 100% 에 박혀
storefront 가 지금보다 나빠진다. **A·B 로 상품당 작업량을 먼저 줄이고 그다음 C 로 큐를 연다.**

### D. Medusa admin/store 인스턴스 분리

**현재.** `scaling: { min: 1, max: 1 }` 고정이고, 사유는 valkey 가 사이드카라 태스크 2개면 세션과
BullMQ 큐가 갈라지는 것(`deployments/lcnine/services/infra/services.ts:464-472`).

**설계.**

- 공유 캐시 복원: **ElastiCache Serverless (Valkey)**. 이 규모에선 노드형보다 싸고 운영 부담이 0이며,
  현재 사이드카의 `appendonly no` + `save ''`(재시작 시 인플라이트 큐 유실)도 해소된다
- Medusa 를 두 서비스로 분리하고 ALB **path 조건**으로 `/admin/*` 을 admin 쪽으로 보낸다.
  `createService` 가 이미 `transform.listenerRule` 로 host 조건을 덮어쓰므로 같은 자리에 붙는다
  - **Store 인스턴스**: `MEDUSA_WORKER_MODE=server`. store API 만, 백그라운드 잡·cron 없음
  - **Admin 인스턴스**: `shared`. admin API + subscriber/워크플로/cron 전부
- 이로써 cron 중복 실행 문제도 사라진다(`apps/medusa/src/jobs/sync-product-sort-index.ts:8` 주석이
  지적한 그 문제)
- locking 은 이미 `locking-redis`(`medusa-config.js:234`)라 공유 캐시만 생기면 멀티 인스턴스 정합성은 확보

**대안 기각.** 단순 `max: 2` + shared 모드는 ALB 라운드로빈이라 storefront 요청이 계속 대량등록과
같은 이벤트 루프에 큐잉된다. 비용이 같은데 격리가 없다.

**비용.** 두 번째 Fargate 태스크(arm64 1vCPU/2GB) 약 +$33/월 + 캐시 약 +$10/월 = **월 +$43**.
현재 $392, 목표 $180~220 이므로 목표와는 반대 방향이다. A·B·C 로 "2대면 충분"을 먼저 만들어 두는 것이
순서상 맞다.

## 6. 미확정 사항

구현 전 또는 구현 중 확정한다. 추정을 사실로 옮기지 않는다.

| 항목 | 확정 방법 |
|---|---|
| price list 지연이 카탈로그에 비례해 자라는 원인 — 빈 IN 리스트(`variant_id: []`)의 무필터 퇴화 vs `workflow_execution` 누적 | `EXPLAIN ANALYZE` + `SELECT count(*) FROM workflow_execution`. SST 터널 필요 |
| revalidate 라우트가 5초를 넘기는 원인 — OpenNext ISR 태그 캐시 팬아웃 추정 | 태그 캐시 DynamoDB 테이블 크기와 revalidation 큐 유입량 |
| 클레임 쿼리 비용 (§C) | 프로덕션 `EXPLAIN ANALYZE` |
| `action='created'` 인데 상품이 이미 존재하는 경로 가능 여부 | `medusa.client.ts:1674-1714` 분기 정독 |
| 조용한 시간대 `GET /admin/orders` 분당 10회의 정체 | 미해결. 시간 귀속 상위는 아니라 우선순위 낮음 |

## 7. 순서와 의존

```
A (price list 배치) ─┐
                     ├─ 같은 버퍼·flush 배관 공유 → 한 작업으로 묶는다
B (revalidate 배치) ─┘
        ↓
C 선행 조사 (EXPLAIN) → C 구현
        ↓
D (admin/store 분리 + ElastiCache)
```

A 와 B 는 둘 다 "상품마다 하던 걸 모아서 한 번에"라 누적 버퍼와 flush 지점을 공유한다. 따로 만들면
같은 배관을 두 번 깐다.

D 는 A·B·C 와 독립적으로 배포 가능하지만, C 로 처리량이 오르면 순간 부하가 커지므로 C 앞이나
동시에 두는 편이 안전하다.

## 8. 예상 효과

처리량 모형: `동시성 × 상품당소요 = 핸들러소요 + 슬롯유휴`. 현재 `2 × 26.6 = 23.9 + 29.3` 이다.
핸들러를 줄여도 슬롯유휴 29.3초는 그대로 남는다.

| 단계 | 핸들러 | 상품당 | 2,553건 소요 | 부수 효과 |
|---|---:|---:|---:|---|
| 현재 | 23.9s | 26.6s | 17시간 | 전역 캐시 2,553회 무효화 |
| +A | 17.3s | 23.3s | 16.5시간 | **Medusa CPU 부하 −62%** |
| +B | 12.3s | 20.8s | 14.7시간 | **CloudFront 적중률 회복** |
| +C | 12.3s | ~7.7s | **~5.5시간** | |
| +D | — | — | — | storefront 를 구조적으로 격리 |

**A·B 는 17시간 문제를 거의 못 줄인다** (17 → 14.7시간). 슬롯유휴가 상품당 가용시간의 55%를
차지하기 때문이다. A·B 의 값어치는 처리량이 아니라 **축 A(storefront 지연) 해소**에 있다 —
Medusa CPU 부하 −62%, 전역 캐시 폭격 제거. 17시간을 5시간대로 내리는 것은 C 다.

역으로 **C 를 먼저 하면 Medusa 가 포화한다.** C 만 적용하면 464건/시로 올라가는데, A 이전의 Medusa
비용 10.6초/상품이면 시간당 4,918초가 필요해 1 vCPU(3,600초)를 넘는다. A 를 먼저 적용해 4.0초/상품이
되면 1,856초 = 52% 로 들어온다. **순서를 지켜야 하는 이유가 이 계산이다.**

## 9. 테스트

- **A**: 배치 delete+create 가 단건 remove+add 와 같은 최종 가격 상태를 만드는지 — 신규 상품 / 기존
  상품 재동기화 / 멤버십+티어 혼재 세 경우. `apps/core` 통합 테스트 러너는
  `npm run test:core:integration:local` (워크트리에서는 `COMPOSE_PROJECT_NAME=almondyoung-server` 필수)
- **A**: 배치 중 일부 상품 실패 시 나머지가 반영되는지 (부분 실패 격리)
- **B**: flush 주기 안에 같은 handle 이 여러 번 들어와도 태그가 중복 전송되지 않는지
- **B**: 프로세스 재시작으로 버퍼가 유실돼도 다음 주기 또는 TTL 로 수렴하는지
- **C**: 인덱스 추가 전후 `EXPLAIN ANALYZE` 비교를 근거로 남긴다
- **D**: admin path 라우팅이 `/admin/*` 만 정확히 가르는지, store 인스턴스에 cron·subscriber 가 뜨지
  않는지 부팅 로그로 확인

`web/almondyoung-storefront` 와 `apps/admin-web` 은 컴포넌트 테스트 환경이 없다 — 판정 로직은 순수
함수로 뽑아야 검증된다.

## 10. 리스크

| 리스크 | 완화 |
|---|---|
| A 의 배치 delete 대상 산정이 틀리면 가격 중복 또는 유실 | `action` 신뢰성 확인(§6), 통합 테스트 3케이스 |
| B 로 신규 상품 노출이 flush 주기만큼 늦어짐 | 기본 60초. 대량등록 총 소요가 4시간대로 줄면 체감 미미 |
| D 배포 시 ElastiCache 전환 중 인플라이트 BullMQ 잡 유실 | 현재 사이드카도 재시작마다 유실되므로 신뢰도 등급은 동일. 대량등록 비활성 시간대에 전환 |
| D 가 월 $43 비용 증가 | A·B·C 를 먼저 배포해 실제로 2대가 필요한지 재측정한 뒤 결정 |
| 대량등록이 도는 동안 다른 도메인 이벤트가 지연 | 후순위 레인이 이미 존재. C 로 클레임이 빨라지면 함께 개선 |

## 11. 참고

- 측정 시 AWS CLI 는 타임스탬프를 이미 KST(+09:00)로 반환한다. Logs Insights 의 `bin()` 결과는 UTC 다.
  두 축을 섞으면 창이 어긋난다
- `Sync completed` 로그(`pim-medusa-sync.service.ts:387`)는 핸들러 종료 표지가 아니다. price list
  동기화와 revalidate 가 그 뒤에 온다
- `[SLOW]` 미들웨어는 300ms 초과만 남긴다. 시간 귀속은 항상 하한선이다
