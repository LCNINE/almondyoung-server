# 판매상품 대량등록 v2 — 필드 확장 + 이벤트 폭주 대응 설계 스펙

- 날짜: 2026-07-28
- 대상: `apps/core` (catalog/operations/import, catalog/core/products) + `apps/channel-adapter` (medusa inbox worker) + `apps/admin-web`
- 브랜치: `feat/product-bulk-import-v2` (base `3073756ce`)
- 상태: 0~3 단계 develop 머지 + live 배포 완료 (임포트 워커 가동 중). 4 단계 설계 확정 (§4.4.1~4.4.5), 5 단계는 계획 미착수
- 선행 이슈: #550 (`InboxWorkerService` supersede 단위테스트가 red — 배치 claim 착수 전 정리 필요)
- 관련: `docs/superpowers/specs/2026-07-10-product-bulk-import-redesign-design.md` (v1), `docs/adr/0019-core-catalog-medusa-product-projection-events.md` (bulk edit 을 부채로 남긴 ADR), `docs/runbooks/selmate-stock-pipeline.md` §"반영이 늦을 때" (inbox 처리량 실측)

## 1. 목표

MD 의 공격적 소싱으로 손수 만들어지는 신규 상품 데이터를 엑셀로 대량 등록한다. 두 가지를 동시에 해결한다.

1. **필드 공백** — 현재 가격을 넣을 수 없어 게시하면 0원 상품이 스토어프론트까지 나간다.
2. **이벤트 폭주** — 세션 단위 일괄 게시가 `ProductMasterActiveVersionChanged` 를 상품 수만큼 발행하고, 그것이 멤버십·배송·주문취소 같은 고객 체감 이벤트 앞에 줄 선다.

운용 규모는 **상시(주 단위 수십~수백 행) + 초기 대량 이관(수천 행)** 양쪽이다. 따라서 동기 HTTP 로 수천 행을 처리하는 현재 구조는 규모와 무관하게 교체 대상이다.

## 2. 현재 상태 실측

### 2.1 등록 가능한 필드 (템플릿 전량)

| 시트 | 필드 |
|---|---|
| Products (21) | `productKey`, `name`\*, `productCode`, `brand`, `alternativeName`, `description`, `material`, `marketPrice`, `supplyPrice`, `productType`, `fulfillmentKind`, `salesClassification`, `purchaseClassification`, `ageRestriction`, `minQuantity`, `maxQuantity`, `seller`, `categoryPath`(단일), `isOverseas`, `isVisibleToMembersOnly`, `hideMembershipPriceForNonMembers` |
| Options (4) | `productKey`, `optionName`, `optionValues`(`\|` 구분), ~~`sortOrder`~~ |

`sortOrder` 는 템플릿 헤더에만 있고 `product-import.normalizer.ts:62-72` 가 읽지 않는다 — 죽은 컬럼이다.

### 2.2 등록 불가한 필드

| 우선순위 | 항목 | 결과 |
|---|---|---|
| 1 | **판매가·멤버십가·구간가 (pricing rules)** | 가격 규칙이 없으면 계산기가 0 을 반환하고 `PricingValidatorService.validateCalculatedPrices` 는 `>= 0` 만 보므로 **0원으로 publish 가 성공**한다. 스냅샷 `basePrice: 0` 이 Medusa·검색으로 나간다 (`SKIP_VARIANTS_WITHOUT_PRICE` 도 `0` 은 유효값이라 못 거른다) |
| 2 | **`variantCode`** | 채널·WMS 매칭의 유일한 다리인데 설정 불가 |
| 3 | 이미지(대표/부가), `descriptionHtml`, SEO 3종, 태그 | — |
| 4 | 구매제약(멤버십 전용 구매·평생수량한도), `isWholesaleOnly`, 판매기간, 배송방법, 공급처 | — |
| 5 | 카테고리 다중 지정 / 신규 카테고리 생성 | `categoryPath` 1개만, 기존 트리 해석만 |
| 6 | 옵션값별 색상코드·이미지·정렬 | 도메인 DTO 는 지원, 시트가 미사용 |
| 7 | 기존 상품 수정 | 신규 생성 전용. `productCode` 중복은 commit 을 통과하고 **publish 에서 터진다** |

### 2.3 이벤트 발행량

| 시점 | 이벤트 | 비고 |
|---|---|---|
| commit | `ProductVariantCreated` ×1/상품 | 직접 Kafka publish(트랜잭션 밖) + product-matching 직접호출 |
| commit (옵션 조합 variant) | **0건** | `_generateVariantsWithoutEvents` — 조합 variant 는 매칭이 생기지 않는다 (별개 결함, §6) |
| publish | `ProductMasterActiveVersionChanged` ×1/상품 | outbox, **full snapshot** 페이로드 |
| publish | `ProductSellableQuantityChanged` ×variant | 매칭이 없으면 0건 |

### 2.4 live inbox 처리량 상한은 Medusa 가 아니라 워커 페이싱이다

`InboxWorkerService` 는 인터벌마다 **한 건**을 claim 한다 (`setInterval(tryStartNextHandler, handlerStartIntervalMs)` → `claimNextInboxEvent()` 의 `LIMIT 1`). 따라서 상한 = `60초 / 인터벌` 이고 **동시성과 무관**하다. 런북 실측표가 이 식과 정확히 일치한다:

| 런북 실측 | `60/인터벌` |
|---|---|
| 동시성 1 / 10초 → 분당 6건 | 60/10 = 6 |
| 동시성 3 / 3초 → 분당 20건 | 60/3 = 20 |
| 동시성 2 / 3초 → 분당 20~25건 | 60/3 = 20 |

동시성만 2→3 으로 올렸을 때 처리량이 그대로였던 것도 같은 이유다. 그때 기록된 Medusa CPU **30~35%** 는 "Medusa 는 3분의 1만 쓰고 있었다" 는 뜻이다. 즉 런북의 "처리량 상한을 정하는 건 Medusa 다" 는 **오진**이며, 처방도 그에 맞춰 바뀐다 (§4.5).

> 이 진단은 코드 + 런북 수치로부터의 추론이고 live 직접 측정은 아니다. 다만 §4.5 의 처방이 인터벌을 건드리지 않으므로 검증은 필수 선행조건이 아니다.

### 2.5 폭주 파급 경로

`ProductMasterActiveVersionChanged` 는 `BULK_EVENT_TYPES`(강등 대상)에 없다. 강등 대상은 `ProductSellableQuantityChanged` 하나뿐이므로(4단계 이전 기준 — §4.4 에서 origin 마커가 추가된다), 임포트 게시 이벤트는 **우선 레인**에서 멤버십·배송·주문취소와 `created_at` FIFO 로 경쟁한다. 2026-07-21 에 17,604 건 적체로 멤버십 1건이 이틀 대기한 사고와 같은 구조다.

## 3. 측정 결과 — Medusa 배치 API

`POST /admin/products/batch`(`sdk.admin.product.batch`)는 v2.13.4 에 존재하고 `create` 원소는 단건 생성과 동일한 전체 페이로드다. 로컬에서 프로덕션 빌드 Medusa 를 `taskset -c 0`(1 vCPU 재현)로 띄우고, 실제 `transformPimToMedusa` 로 생성한 페이로드로 측정했다. 스크립트: `apps/channel-adapter/scripts/bench-medusa-batch.ts`.

### 3.1 버킷별 배수 (batch-25 대 단건, 동시성 2)

| 버킷 | variant/상품 | 0~15k variants | 15~58k | 58k+ (순서 역전) |
|---|---|---|---|---|
| S | 4 | 7.41x | 5.84x | **4.09x** |
| M | 20 | 2.31x | 1.86x | **1.28x** |
| L | 48 | 1.17x | 1.12x | **1.15x** |

live 카탈로그는 약 27,068 variants 로 위 구간 사이에 놓인다. **배치 이득은 카탈로그 규모에 민감하고 배치 쪽에만 걸린다** — 단건은 평평했다(S single CPU 11.7→13.2s). dead tuple 0 · autovacuum 수행 확인으로 블로트·통계 노후화 가설은 기각했으므로 인덱스 성장에 따른 실제 효과다.

순서 역전 대조군이 원인을 갈랐다: L 을 **맨 먼저**(가장 작은 테이블) 돌려도 1.15x 로, 맨 마지막에 돌린 1.12x 와 같다. **L 의 저조함은 테이블 크기가 아니라 variant 수 때문이다.**

### 3.2 이득의 정체는 CPU 절감

상품 100개 처리에 든 Medusa CPU 시간. 모든 arm 에서 wall ≈ cpu 였다(코어 99% 점유) — 대기가 아니라 계산으로 포화된 상태다.

| 버킷 | 단건 | 배치 | 절감 |
|---|---|---|---|
| S | 11.74s | **2.00s** | 5.9배 |
| M | 17.69s | 9.11s | 1.9배 |
| L | 41.66s | 27.41s | 1.5배 |

배치가 줄인 것은 네트워크 왕복이 아니라 **Medusa 워크플로 기동·트랜잭션·이벤트 발행의 상품당 고정비**다. live 의 병목이 정확히 CPU(1 vCPU, valkey 사이드카와 공유, `scaling max 1`)이므로 이 절감은 그대로 전이된다.

### 3.3 실제 분포로 가중한 집계

live active 상품의 variant 수 분포: **S(≤4) 9,621 / M(5~20) 731 / L(>20) 160** (총 10,512).

| 전략 | 전 카탈로그 소요 | 배수 |
|---|---|---|
| 단건 | 22.4분 | 1.00x |
| batch-25 (전 버킷) | 7.4분 | 3.04x |
| S·M 만 배치, L 은 단건 | 7.5분 | 2.98x |
| **S 만 배치 (채택 — §4.5)** | 8.0분 | **2.80x** |

S 가 소요시간의 85% 를 차지하므로 이득은 사실상 전부 S 에서 나온다. **L 을 배치로 묶어 얻는 건 0.06x 인데 대가는 호출당 p50 9,473ms** — 묶지 않는다. M 은 1.28x 로 판단선(1.5x) 아래이므로 역시 묶지 않는다. 즉 채택안은 **S 만 배치(2.80x)** 이고, 전 버킷 배치(3.04x)와의 차이 0.24x 는 지연·안전성과 교환한 값이다.

`variant 총량 예산` 청킹(vbudget-200)은 집계 3.11x 로 미세하게 앞서지만 버킷별로는 S 에서만 이기고 M·L 에서 진다. 단일 규칙으로서의 근거가 없으므로 채택하지 않는다. 단 **지연에서는 확실히 이긴다** — L 의 호출당 p50 이 9,473ms → 1,568ms. §4.5 의 배치 크기 산정에 이 성질을 쓴다.

## 4. 설계

### 4.1 템플릿 — Variants 시트 신설

엑셀 작성 시점에 variant UUID 가 없으므로 **옵션 조합 문자열**로 variant 를 지목한다.

```
[Products]
productKey | name    | basePrice | membershipPrice | ...(기존 필드)
P1         | 예시니트 | 29000     | 26000           |

[Options]
productKey | optionName | optionValues | sortOrder   ← sortOrder 를 실제로 읽도록 수정
P1         | 색상       | 빨강|파랑     | 0
P1         | 사이즈     | S|M|L        | 1

[Variants]  ← 신규 (선택 시트)
productKey | optionCombination | basePrice | membershipPrice | variantCode
P1         | 색상=빨강;사이즈=L  | 31000     |                 | KNIT-RD-L
P1         | 색상=파랑;사이즈=S  |           |                 | KNIT-BL-S
```

- 빈 칸은 Products 의 기본가를 상속한다. 값이 있으면 해당 variant override.
- `Variants` 시트는 **선택**이다 — 없으면 전 variant 가 Products 기본가를 쓴다. 조합의 일부만 적어도 된다.
- `optionCombination` 은 `옵션명=값` 을 `;` 로 이은 형태다. **축 순서는 무시한다** — `색상=빨강;사이즈=L` 과 `사이즈=L;색상=빨강` 은 같은 variant 를 가리킨다 (해석 시 옵션명으로 정렬해 정규화).
- 행 오류가 되는 경우: Options 시트에 없는 옵션명/값 참조, 상품의 옵션 축을 전부 지정하지 않은 부분 조합, **같은 조합을 두 번 지정**(어느 쪽이 맞는지 알 수 없으므로 양쪽 다 오류로 표시), 존재하지 않는 `productKey` 참조.
- **`variantCode` 를 여기서 심는다** — §2.2 의 2순위 공백이 같은 시트에서 해소되고, 대량 이관 후 반드시 따라오던 별도 SKU 매칭 작업(런북 ②, 18,176 건 이벤트를 만든 그 작업)의 규모가 줄어든다.

### 4.2 가격 → pricing rules 매핑

`PricingService.replaceVersionRules(versionId, rulesSet)` 를 상품당 1회 호출한다. variant 가 생성된 **뒤**여야 하므로 `updateVersion`(옵션 diff → variant 생성) 이후 순서로 고정한다.

| 시트 값 | 생성되는 규칙 |
|---|---|
| Products `basePrice` | `base_price` order 1, `all_variants`, `override` |
| Products `membershipPrice` | `membership_price` order 1, `all_variants`, `override` |
| Variants `basePrice` | `base_price` order 2+, `variants`, `override` (조합 → variantId 해석) |
| Variants `membershipPrice` | `membership_price` order 2+, `variants`, `override` |

`pricingRulesSetSchema` 가 "order 1 인 첫 `base_price` 규칙은 `all_variants` 여야 한다" 를 요구하므로 Products `basePrice` 는 **필수**가 된다.

**0원 게시 차단**: `basePrice` 누락 또는 0 이면 validate 단계에서 행 오류로 처리한다. `validateCalculatedPrices` 가 0 을 통과시키는 현재 동작은 이 스펙 범위에서 바꾸지 않는다 — 임포트 입구에서 막는다.

### 4.3 commit / publish 비동기 잡화

현재 두 엔드포인트 모두 동기 HTTP 다. 1,000 행이면 요청 하나가 수 분~수십 분이고, publish 는 건당 가격검증 + 캐시 + 매칭 인계 + 스냅샷 조립이라 특히 무겁다.

- `POST /product-imports/commit` · `POST /product-imports/:id/publish` 는 **접수만 하고 즉시 반환**한다.
- 진행 상태는 `product_import_sessions` 에 저장하고 폴링으로 조회한다.
- `product_import_items` 에 **게시 상태 컬럼을 추가**한다 (v1 의 알려진 제약 해소 — 지금은 게시 여부를 영속 추적하지 못한다).
- 재개 가능해야 한다. 중단 후 재실행 시 이미 처리된 행은 건너뛴다.

실행 주체는 Core 안의 폴링 워커로 둔다. 새 인프라를 들이지 않고 `OutboxDispatcher` 와 같은 `@Cron` + 원자적 claim 패턴을 따른다.

#### 4.3.1 접수 시점에 영속화하는 것은 파일이 아니라 정규화된 행이다

`commit` 은 `parse → normalize → validate` 까지를 **동기로** 끝낸다 (전부 인메모리 + 카테고리 트리 1쿼리로, 지금 `/validate` 가 이미 감당하는 비용이다). 검증된 `ProductRecord` 를 행마다 `product_import_items.payload`(jsonb) 로 적고 즉시 반환한다. 워커로 넘어가는 것은 **상품 생성이라는 느린 부분뿐**이다.

파일 자체(S3/bytea)를 저장하고 워커가 재파싱하는 대안은 버린다: 저장소가 새로 필요하고, 재개가 "행 오프셋 커서"가 되어 약해지며, 무엇보다 **오류가 업로드 시점이 아니라 워커 시점에 뒤늦게 드러난다**. 행을 저장하면 검증 실패 행은 접수 즉시 `failed` 로 확정되어 사용자가 그 자리에서 본다.

대가: 배포가 세션 처리 중간에 끼면 워커가 옛 형태의 payload 를 읽을 수 있다. 좁은 타입 가드를 두고, 어긋나면 그 행만 "파일을 다시 올려주세요" 로 실패시킨다.

#### 4.3.2 잡 모델 — 세션 컬럼 + `FOR UPDATE SKIP LOCKED`

잡 종류가 세션당 commit·publish 둘뿐이고 순차적이므로 별도 `jobs` 테이블을 만들지 않는다.

| 테이블 | 추가 컬럼 |
|---|---|
| `product_import_sessions` | `commit_status`(queued\|running\|completed\|failed), `publish_status`(idle\|queued\|running\|completed\|failed), `lease_until`, `commit_error`, `publish_error`, `published_count`, `publish_failed_count` |
| `product_import_items` | `payload`(jsonb), `status` 에 `pending` 추가, `publish_status`(pending\|published\|failed\|skipped), `publish_error`, `published_at` |

기존 `product_import_sessions.status`(`completed`\|`archived`)는 **건드리지 않는다** — 의미 전용은 파괴적 변경이라 ADR-0005 §5 상 PR 3개짜리가 된다.

#### 4.3.3 워커는 세션 하나를 클레임해 슬라이스 단위로 처리한다

`@Cron` 5초. 한 틱이 세션 하나를 클레임하고(commit 우선, 없으면 publish) **행 N개만 처리한 뒤 lease 를 놓는다** (commit 20 / publish 10, env 조절). 세션을 통째로 돌리지 않는 이유가 셋이다:

- 틱 길이가 유계라 배포 롤링에 끌려가지 않는다
- 세션은 `created_at` 오름차순으로 하나만 클레임한다. 슬라이스가 끝나도 lease 만
  놓고 `commit_status`/`publish_status` 는 `running` 그대로 두므로, 가장 오래된
  세션이 끝날 때까지 그 세션이 워커를 독점한다 — **FIFO 다, 교대 진행이 아니다**.
  한 틱은 commit 클레임을 publish 보다 항상 먼저 시도하므로, commit 적체가 길면
  publish 레인이 굶주릴 수 있다
- 재개가 공짜다 — **진행 원장은 행의 status 자체**다. 크래시 후 lease 가 만료되면 남은 `pending` 행부터 이어간다

publish 슬라이스가 더 작은 것은 건당 outbox 이벤트 + 스냅샷 조립이 붙기 때문이다. §4.4(레인 강등) 이전까지의 임시 완충이기도 하다.

#### 4.3.4 API

| 엔드포인트 | 변경 |
|---|---|
| `POST /product-imports/commit` | 202. `{sessionId, status:'queued', totalRows, queuedCount, invalidCount}` — 검증 실패 수는 접수 시점의 확정값이다 |
| `POST /product-imports/:id/publish` | 202. 이미 `queued`/`running` 이면 409 |
| `GET /product-imports/:id` | `commitStatus`/`publishStatus`/진행 카운트 + 행별 `publishStatus`. 폴링 대상 |

`CommitResultDto` 는 형태가 바뀐다 (`createdCount` 를 접수 시점에 알 수 없다). admin-web 은 `sst.aws.Nextjs('AdminWeb')` 로 core 와 같은 스택이라 `sst deploy` 한 번에 함께 나간다.

#### 4.3.5 마이그레이션 함정

`ALTER TYPE ... ADD VALUE` 로 추가한 값을 **같은 트랜잭션에서 DEFAULT 로 쓰면 실패한다**(`unsafe use of new value`). `items.status` 는 지금도 default 가 없으므로 그대로 두고 앱이 명시 지정한다. 같은 마이그레이션에서 **새로 만든** 타입은 이 제약을 받지 않는다. 레포 선례(`20260727141456`)는 `::text` 캐스트로 우회했다 — 생성된 SQL 을 눈으로 확인한다.

### 4.4 이벤트 마커 + 레인 강등

- `ProductMasterActiveVersionChanged` payload 에 `origin?: ProductPublishOrigin` 와 `importSessionId?: string` 를 추가한다 (additive — 기존 소비자 무영향). `ProductPublishOrigin` 은 지금 `'bulk_import'` 하나짜리 유니온이고 계약(`product.stream.ts`)이 export 한다 — core 와 channel-adapter 가 같은 리터럴을 공유하기 위해서다.
- `InboxWorkerService` 의 강등 판정을 `eventType` 단독에서 `(eventType, origin)` 으로 확장한다. `origin='bulk_import'` 인 행은 `ProductSellableQuantityChanged` 와 같은 후순위 레인으로 보낸다.

**이게 1순위다.** 배치가 3x 를 내도 임포트가 고객 체감 이벤트 앞에 줄 서는 문제는 남는다 — 3x 는 40분을 13분으로 줄이지만 0 으로 만들지 못한다.

마이그레이션 없음, 신규 환경변수 없음. 건드리는 프로덕션 파일은 5개다 (계약 1 · core 2 · channel-adapter 2). 테스트는 별도.

계약의 zod 스키마는 **소비 측에선 이미 런타임 게이트다** — `SchemaValidationInterceptor` 는 `EventsModule.forConsumerModule` 이 `APP_INTERCEPTOR` 로 등록하고(`libs/events/src/events.module.ts:271-277`), 기본 옵션(`validateOnConsume`/`throwOnValidationError` 둘 다 `true`, `packages/event-contracts/types/schema-validation.types.ts:55-60`)을 어느 소비자도 오버라이드하지 않는다. `ProductMasterActiveVersionChanged` 소비자는 셋이다 — channel-adapter 는 `EventsModule.forRoot` 로 붙어 있어 이 인터셉터가 없고(검증 없음), analytics(`analytics.module.ts:34`)와 search(`search.module.ts:32`)는 `forConsumerModule` 로 붙어 있어 검증에 걸리면 던진다. 검증이 없는 쪽은 오직 **발행** 경로다 — `OutboxDispatcher` 는 `publishRawEnvelope`(`libs/events/src/publishers/stream-publisher.service.ts:250-252`)로 나가는데 이 메서드는 페이로드 검증을 거치지 않는다. 그럼에도 좁은 `z.literal('bulk_import').optional()` 로 두면 소비자를 깨뜨릴 위험이 없는 이유는 검증 부재가 아니라 **unknown key strip** 이다 — `ProductMasterActiveVersionChangedSchema` 는 `.strict()` 없는 평범한 `z.object` 라, analytics/search 가 이 변경 이전 빌드로 떠 있는 동안 새 페이로드를 받아도 `origin`/`importSessionId` 는 조용히 잘려나가고 나머지 필드로 검증을 통과한다.

#### 4.4.1 origin 은 publishVersion 의 선택적 인자로 흘린다

`publishVersion` 은 임포트 워커와 단건 UI 가 **같이** 부른다. 임포트일 때만 마커가 붙어야 하므로 출처를 넘기는 배선이 필요하고, 이 단계에서 설계 판단이 필요한 곳은 여기 하나다. 나머지는 선택 필드 추가와 `ORDER BY` 한 항이다.

```ts
// product-versions.service.ts — PublishVersionOptions 는 이 파일이 정의·export 한다
export interface PublishVersionOptions {
  origin?: ProductPublishOrigin;
  importSessionId?: string;
}

async publishVersion(versionId: string, tx?: DbTransaction, options?: PublishVersionOptions): Promise<void>
```

`options` 는 `_emitActiveVersionChangedEvent` 로 한 홉 전달되어 payload 에 병합된다. **호출부 3곳 중 임포트 워커 1곳만 수정한다** — 단건 UI 컨트롤러(`product-master-versions.controller.ts:200`)와 `product-bulk.service.bulkActivate`(`:209`)는 인자를 안 넘기므로 payload 가 지금과 동일하다(키 자체가 없다).

AsyncLocalStorage 컨텍스트 대안은 버린다. 시그니처는 안 건드리지만 호출 그래프를 봐선 origin 이 어디서 오는지 알 수 없다.

#### 4.4.2 강등 판정은 payload 가 아니라 inbox 행의 metadata 를 읽는다

`ORDER BY` 표현식은 `LIMIT 1` 이어도 **후보 행 전부**에 대해 계산된다. `payload` 는 full snapshot 이라 TOAST 대상이고, 적체가 클수록 매 틱 압축해제 비용이 붙는다. 반면 `inbox_events.metadata` 는 correlationId·messageId 정도만 든 수백 바이트라 페이지 안에 있다.

그래서 컨슈머(`pim-product-event.consumer.ts`)가 inbox 행을 쓸 때 `payload.origin` 을 `metadata.origin` 으로 **함께** 적고, 워커는 metadata 를 읽는다. `importSessionId` 는 복사하지 않는다 — 정렬 핫패스가 안 쓰고 운영 조회는 일회성이라 `payload->>'importSessionId'` 로 충분하다. metadata 에는 매 틱 읽히는 것만 넣는다.

인덱스는 추가하지 않는다. 현행 쿼리도 이미 표현식 정렬이라 인덱스를 못 쓰는 건 마찬가지고, metadata 추출은 행당 사실상 공짜다.

#### 4.4.3 `COALESCE` 가 없으면 레인이 뒤집힌다

```sql
ORDER BY (
  event_type = 'ProductSellableQuantityChanged'
  OR COALESCE(metadata->>'origin', '') = 'bulk_import'
), created_at ASC
```

`COALESCE` 를 빼면 마커 없는 행에서 `false OR NULL` = **NULL** 이 되고, NULL 은 ASC 정렬에서 맨 뒤로 간다. 즉 정상 이벤트가 통째로 후순위로 밀려 **이 단계가 고치려던 문제가 정확히 반대 방향으로 발생한다.** 에러는 안 난다. `event_type` 은 NOT NULL 이라 현행 표현식엔 이 함정이 없었다 — jsonb 항을 OR 로 붙이면서 새로 생기는 것이다.

표현식 전체를 괄호로 묶는 것도 좋다 — `ORDER BY` 항 구분 쉼표와 시각적으로 섞이지 않는다. (연산자 우선순위상 `OR` 가 쉼표보다 먼저 묶이므로 괄호가 없어도 파싱은 같다 — psql 로 확인함. 괄호는 가독성 문제고, 진짜 함정은 위의 `COALESCE` 다.)

이 함정은 SQL 문자열 단정으로는 못 잡는다 (`COALESCE` 가 *있다*는 것만 보인다). §8 의 통합 테스트가 이걸 맡는다.

#### 4.4.4 배포 순서 제약이 없다

§7 표는 "core 선배포 → channel-adapter" 로 적었으나 **제약이 아니다.** 둘은 같은 `sst deploy` 로 나가고, origin 이 선택 필드라 어느 쪽이 먼저 떠도 깨지지 않는다.

- core 선행 — payload 에 origin 이 실리지만 옛 컨슈머가 metadata 로 안 옮겨 강등이 안 걸린다
- channel-adapter 선행 — 읽을 origin 이 없어 역시 안 걸린다

어느 쪽이든 **현행 동작으로 degrade** 할 뿐이고, 달라지는 건 효과 발현 시점뿐이다. 배포 시점에 이미 inbox 에 쌓여 있던 임포트 이벤트도 metadata 에 origin 이 없어 강등되지 않는다 — 새로 들어오는 것부터 적용된다.

#### 4.4.5 범위는 임포트 게시뿐이다

`ProductMasterActiveVersionChanged` 의 생산자는 둘이다. 다른 하나인 `categories.service.publishProductProjectionRefresh` 는 이번에 마킹하지 않는다.

이 경로는 카테고리 **연결이 실제로 바뀐 상품**만 재발행한다 (이름·부모·노출 변경은 `CategoryChanged` 만 내고 여기 안 온다). 호출부가 셋이다:

| 호출부 | 대상 | 규모 |
|---|---|---|
| `deleteCategory` (`:252`) | 그 카테고리에 걸려 있던 활성 버전 전부 | 카테고리 소속 상품 수 — **무계** |
| `moveProductsToCategory` (`:782`) | 호출자가 지정한 `versionIds` | 관리자가 고른 수 |
| `addProductsToCategory` (`:870`) | 새로 연결된 것만 | 관리자가 고른 수 |

셋 다 관리자가 방금 한 조작의 결과라 즉시 반영 기대가 임포트보다 강하다 (임포트는 접수 후 폴링 대기가 이미 전제다). 무계 폭발 가능성은 `deleteCategory` 하나뿐이고, 그건 origin 마커보다 "삭제 시 재발행을 슬라이스로 쪼갠다" 쪽이 어울리는 모양이며 지금 실측 근거가 없다.

`product-bulk.service.bulkActivate` 도 마킹하지 않는다 — 관리자가 UI 에서 고른 수만큼이라 유계이고, 판매재개는 즉시 확인 대상이다.

타입은 `ProductPublishOrigin` 유니온으로 두어 근거가 생기면 값만 늘리면 되게 한다.

**단, 다음에 값을 늘릴 때는 §4.4 초입에서 정리한 배포 순서가 그대로 적용되지 않는다.** 예를 들어 `'category_refresh'` 를 추가하는 경우, analytics·search 는 `forConsumerModule` 로 검증을 걸고 실패 시 던지므로, 넓어진 유니온을 담은 계약이 analytics·search 에 **먼저** 반영돼 있어야 한다 — core 가 새 값을 담아 발행을 시작하는 시점보다 늦으면, 두 소비자 모두 `z.literal` 불일치로 검증에서 던지고 재시도 후 DLQ 로 간다 (`origin` 은 지금처럼 unknown key 로 잘려나가는 게 아니라, 값 자체가 허용된 리터럴 집합 밖이라 필드 검증에서 걸린다). §4.4.4 의 "배포 순서 제약이 없다" 는 **이번 변경**(선택 필드 추가, 값 1개)에만 해당하고, 값 추가에는 적용되지 않는다 — 값을 늘릴 때는 어느 서비스가 먼저 뜨는지 다시 확인한다.

### 4.5 InboxWorker — 동시성 1 + 배치 단위

**한 번에 잡는 작업 단위를 하나로 유지한다.** 과거 사고(약 20% CPU 를 먹는 50초 작업을 10초마다 시작 → 누적 → CPU 100% → 마비)의 재현을 구조적으로 막는 축이다.

현재도 `inFlightHandlers >= maxConcurrentHandlers` 가드가 누적을 막고 있다(live 2). 인스턴스도 `ServicesBundleA` 의 `scaling {min:1,max:1}` 로 1개뿐이라 ADR-0019 가 경고한 "task 수 × limit" 도 지금은 1×2=2 다. 다만 **가드가 제한하는 건 개수이지 비용이다** — 배치를 얹으면 한 단위 비용이 K배가 되므로 개수 제한이 비용 제한 역할을 못 한다.

| 축 | 현행 | v2 |
|---|---|---|
| 동시성 | 2 | **1** |
| 한 단위 | 이벤트 1건 | 배치 K건 |
| Medusa 미결 요청 | 2 | **1** |
| 처리량 상한 | 20/min (인터벌) | 배치 대상은 25×20/min, 그 외 20/min |
| 배치 게이팅 | — | **variant ≤ 4 만 배치**(청크 25), 초과는 단건 |
| 요청 타임아웃 | **없음** | **60초** |

**게이팅 기준은 `variant ≤ 4`.** §3.1 의 측정점은 4·20·48 이고, 4 에서 4.09x·20 에서 1.28x·48 에서 1.15x 다. 미리 못 박은 판단선(`<1.5x` 폐기)에 대면 **4 만 통과**한다. 5~20 사이의 교차점은 측정하지 않았으므로 게이트를 올리려면 그 구간을 먼저 재야 한다. 이 보수적 게이트로도 집계 2.80x 이고, M 까지 넣어 얻는 추가분은 0.18x 다 (§3.3).

- 인터벌은 건드리지 않는다. 처리량은 **한 틱이 처리하는 양**으로 얻는다 — 인터벌 단축은 사고 재현 여지를 되살린다.
- 미결 요청이 1개면 런북이 관찰한 자기경합(동시성 3 에서 CPU 90% 인데 처리량 불변)이 사라진다. 즉 **동시성 1 + 배치가 동시성 2 + 단건보다 안전하다.**
- 배치 크기는 실측 기반으로 정하고, **다른 소비자 몫을 남긴다** — 같은 1 vCPU 를 `OrderPollerOrchestrator`(@Cron 5분) 주문 수집, storefront revalidate, 고객 트래픽이 함께 쓴다.
- 실측 근거: variant 4 상품의 배치 25건이 호출당 약 0.73초 → 3초 틱에 25건 ≈ 500/min (현행 20/min 대비 25배). variant 5 이상은 단건 유지이므로 20/min 그대로다.
- 타임아웃 60초의 근거: 채택하는 배치(variant ≤ 4, 25건)의 실측 호출시간이 약 0.73초, 측정 전체에서 최악이던 조합(L batch-50)이 22초였다. 60초는 최악값의 약 3배로, 정상 동작을 끊지 않으면서 5분 정지를 막는다.

**동시성 1 의 선행 조건 — 요청 타임아웃.** `medusa.client.ts` · `medusa-sdk.config.ts` · `inbox-worker.service.ts` 어디에도 타임아웃이 없다 (JS SDK 의 `AbortController` 는 SSE 스트림 경로 전용). Node/undici 기본값(`headersTimeout`/`bodyTimeout` 각 300초)에 의존하므로 한 요청이 최대 5분 핸들러를 물 수 있다. 동시성 2 에서는 절반만 멈추지만 **동시성 1 에서는 전면 정지**다. 타임아웃 없이 동시성을 내리지 않는다.

**실패 격리.** 배치 응답의 건별 결과로 성공/실패를 가르고, 실패 건만 단건 재시도로 강등한다. 배치 전체를 함께 `failed` 로 보내지 않는다.

## 5. 하지 않는 것

- **bulk Kafka 이벤트 신설** — 실패 격리 상실(한 건이 터지면 K건이 함께 재시도/DLQ), 압축 전 크기 관리를 코드가 떠안음, search·analytics·channel-adapter 3곳 계약 변경. 그리고 묶을 재료는 이미 `inbox_events` 에 낱개로 모여 있어 Kafka 에서 묶어도 절약되는 것이 없다.
- **인터벌 단축 / 동시성 상향** — §4.5.
- **variant 총량 예산 청킹** — §3.3. 처리량 근거가 없다.
- **`validateCalculatedPrices` 의 0원 허용 수정** — 임포트 입구에서 막는다. 단건 경로의 동작 변경은 별건.
- **기존 상품 수정(upsert) 임포트** — 신규 생성 전용을 유지한다.
- **이미지·SEO·태그·구매제약 임포트** — §2.2 의 3~6순위. 이번 범위 밖.
- **초기 대량 이관용 백필 우회** — `apps/medusa/src/scripts/backfill-from-core.ts` 는 이미지 baking 이 필요한 수동 절차다. 상시 기능에 넣지 않는다.

## 6. 알려진 결함 — 이번에 손대지 않지만 기록

- **조합 variant 에 매칭이 생기지 않는다.** `createMaster` 는 기본 variant 1개에 대해 `ProductVariantCreated` + product-matching 직접호출을 하지만, 옵션 diff 로 조합 variant 를 만드는 `_generateVariantsWithoutEvents` 는 이름 그대로 이벤트를 내지 않는다. 그 뒤 기본 variant 는 정리되므로 **매칭이 붙은 variant 는 사라지고 남은 variant 는 매칭이 없다.** 런북이 기술한 "유령 매칭" 과 같은 계열이며, 매칭 없는 variant 는 `MATCHING_MISSING` 으로 재고 게이팅을 받지 않아 무한 판매된다. §4.1 의 `variantCode` 로 완화되지만 근본 해결은 별건이다.
- **phantom masterId** — commit 중 한 행이 롤백되면 비-트랜잭션 Kafka 이벤트 + product-matching 행이 없는 masterId 로 잔존한다 (v1 스펙의 후속 트래킹 1번, 사용자 결정: 현상 유지).

### 6.1 미확인 질문 (결함 아님 — 확인 필요)

- **Medusa 가 상품이 연결된 카테고리 삭제를 어떻게 다루는가.** 상품이 여럿 붙은 카테고리를 지울 때 연결을 자동으로 끊고 삭제하는 기능이 Medusa 쪽에 있는지 확인하지 않았다. 있다면 core 의 `deleteCategory` 가 상품마다 스냅샷을 재발행하는 현재 방식(§4.4.5)이 필요 이상일 수 있다. 4 단계 범위 밖이고, 확인 결과에 따라 별건으로 다룬다.

## 7. 단계 분할

| 단계 | 내용 | 배포 결합 |
|---|---|---|
| **0** | #550 정리 — supersede 테스트를 행위 기준으로 재작성 | 없음 |
| **1** | 타임아웃 도입 (`MedusaClient` 전 호출) | channel-adapter 단독 |
| **2** | 템플릿 확장 (Variants 시트 + 가격 + `variantCode` + `sortOrder` 수정) + 0원 게시 차단 | core → admin-web |
| **3** | commit/publish 비동기 잡화 + `product_import_items` 게시상태 컬럼 | 마이그레이션 1건 (additive → `migrate` 먼저, 그 뒤 `deploy`) |
| **4** | 이벤트 `origin` 마커 + 레인 강등 | **순서 제약 없음** (§4.4.4) |
| **5** | InboxWorker 배치 claim + 동시성 1 + variant 게이팅 | channel-adapter 단독. 1·4 완료 후 |

3 단계 마이그레이션은 additive 이므로 ADR-0005 §5 의 expand phase — **`migrate` → `deploy`** 순서다 (contract phase 의 반대).

**구현 계획은 단계별로 따로 쓴다.** 이 스펙은 한 이니셔티브를 담지만 6 단계가 3개 앱에 걸쳐 있고 각 단계가 독립 배포 가능하다. 특히 0~1(선행조건) · 2~3(임포트 기능) · 4~5(처리량·공정성)은 성격이 달라, 하나의 계획 문서로 묶으면 검토 단위가 지나치게 커진다. 2~3 을 먼저 계획하고, 4~5 는 그 뒤 별도 계획으로 잇는다.

## 8. 검증 계획

- 단위: 조합 문자열 → variantId 해석, 가격 규칙 생성(order·scope 조합), 0원 차단, 배치 청킹의 variant 게이팅 경계값.
- 타입 게이트: `nest build core`, `nest build channel-adapter`. 레포 eslint 는 전역 미게이트 debt 이므로 권위가 아니다. spec 파일은 `nest build` 가 제외하므로 `npm run type-check:scoped` 로 따로 본다.
- 전역 jest·전역 tsc 는 develop 에서도 red 라 "전체 그린"으로 판정할 수 없다. 변경 파일 기준 차분으로 본다.
- 4 단계 정렬 회귀: 실 Postgres 통합 테스트 1건 (`REQUIRE_*_DB=1` opt-in, 테스트별 스키마 — `shipment-dispatch-persistence.integration.spec.ts` 선례). 마커 없는 행 / `bulk_import` 행 / `ProductSellableQuantityChanged` 행 / `metadata` 가 NULL 인 행을 섞어 넣고 클레임 순서를 단정한다. §4.4.3 의 NULL 함정은 터져도 에러가 안 나고 조용히 레인을 뒤집으므로, SQL 문자열 단정만으로는 방어가 안 된다.
- 처리량 회귀: `apps/channel-adapter/scripts/bench-medusa-batch.ts` 를 배치 게이팅 구현 후 다시 돌려 §3 수치와 대조한다.
- 배치 크기 확정: live 에서 `inbox_events.published_at` 분당 건수와 Medusa CPU 를 함께 보며 단계적으로 올린다. 런북의 측정 주의 두 가지(롤아웃 직후 5분의 lease 버스트, 최소 15분 관찰)를 따른다.

## 9. 2 단계 리뷰 지적 13건의 처리 순서

2 단계(`68175bdca`) 머지 후 제기된 지적 13건은 성격이 갈린다. "3·4·5 단계를 먼저 끝내고 일괄 수정" 은 ① 무리에 대해서만 옳다.

**① 3~5 단계가 그 코드를 다시 쓰는 것 — 해당 단계에 흡수한다 (별도 패스 없음)**

| # | 내용 | 흡수 단계 |
|---|---|---|
| 4 | `getVariantComboMap` 이 Variants 시트 없어도 실행 | 3 (commit 루프를 워커로 재작성하며 가드) |
| 6 | admin-web 업로드 안내가 2시트 기준 (`upload-step.tsx:51`) | 3 (위저드를 폴링 UI 로 재배선하며) |
| 7 | `as Promise<T>` 캐스팅 (`inbox-worker.service.ts:336`) | 5 (배치 claim 으로 재작성) |
| 11 | inbox 성공 경로에 CAS 가드 없음 — 주석이라도 | 5 (같은 함수를 건드림) |

**② 3 단계의 *입력*이지 결과가 아닌 것 — 3 단계 착수 전에 닫는다**

- **#12 (spec 필수필드 타입 게이트)** — 결함이 아니라 *도구*다. "spec 4개의 누락이 테스트 실행으로만 드러났다" 가 지적 내용인데, 그 상태로 3 단계를 더 진행한 뒤 게이트를 다는 건 순서가 거꾸로다.
- **#8 (죽은 `NormalizedVariantOverride.combination`)** — 3 단계는 정규화된 행을 jsonb 로 영속화한다 (§4.3.1). 죽은 필드를 두면 **DB 에 박힌다**.
- **#2 (`variantCode` DB 전역 유일성 미검사)** — 검사가 들어갈 자리가 `applyVariantCodes`, 즉 3 단계가 워커로 옮기는 바로 그 함수다. 나중에 하면 같은 함수를 두 번 고치고 두 번 리뷰한다. 품질이 아니라 **정합성 구멍**이고, 이 이니셔티브가 대량 도달을 쉽게 만드는 중이다.

**③ 3~5 단계와 무관 — 5 단계 뒤 정리 커밋 하나로 묶는다**

#1(Products 시트 `variantCode`), #3(`values[].sortOrder`), #5(comboKey NFC), #9(`basePrice` 헤더 검사), #10(오류 행번호 불일치). 전부 1~5 줄이다.

**#13**(`PUT /masters/:id/versions/:id` 의 `optionDiff` 가 임포트 검증을 우회)는 단건 API 경로의 기존 문제로 이 이니셔티브와 무관하다 — 범위 밖.
