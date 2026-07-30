# 판매상품 대량등록 v3 — 필드 확장 + 이미지 파이프라인 + 운영 구멍 설계 스펙

- 날짜: 2026-07-30
- 대상: `apps/core` (catalog/operations/import) + `apps/admin-web` (product-imports 위저드·세션상세)
- 브랜치: `feat/product-bulk-import-v3` (base `a2cadccd0`)
- 상태: 설계 확정. 1~3단계 구현 완료(§6), 4단계(이미지 파이프라인)는 구현 계획 미착수
- 관련:
  - `docs/superpowers/specs/2026-07-10-product-bulk-import-redesign-design.md` (v1)
  - `docs/superpowers/specs/2026-07-28-product-bulk-import-v2-design.md` (v2 — 0~4단계 배포 완료, **5단계는 이 스펙 범위 밖으로 그대로 남는다**)
  - `docs/adr/0005-drizzle-migration-and-autodeploy.md` (마이그레이션 순서)
  - `docs/adr/0019-core-catalog-medusa-product-projection-events.md`

## 1. 목표

v2 가 가격·`variantCode`·비동기 잡·이벤트 레인 강등을 해결했다. 남은 공백은 셋이다.

1. **필드 공백** — 이미지를 넣을 수 없어 대량등록한 상품이 전부 이미지 없이 생성된다. (카테고리 다중 지정·구매제약·SEO·판매기간은 3단계에서 이미 채워졌다 — §6.)
2. **오류를 늦게 안다** — 이미지가 URL 기반이면 도달 가능성·MIME·크기는 다운로드해봐야 알고, 그건 워커 시점이다.
3. **운영 구멍** — 세션 취소 수단이 없고, 슬라이스 밖으로 탈출한 예외가 무한 재시도로 굳는다. `product_import_job_status.'failed'` 를 쓰는 코드 경로가 하나도 없다.

**이벤트 발행량은 이 스펙에서 바뀌지 않는다.** v2 4단계(origin 마커 + inbox 레인 강등)가 배포돼 임포트 게시가 후순위 레인으로 가고 있고, 5단계(inbox 배치 claim)는 별개 이니셔티브로 남는다.

## 2. 현재 상태 실측 (2026-07-30, `a2cadccd0`)

### 2.1 등록 가능한 필드

| 시트 | 필드 | 근거 |
|---|---|---|
| Products (29) | `productKey`, `name`\*, `basePrice`\*, `membershipPrice`, `productCode`, `brand`, `alternativeName`, `description`, `material`, `marketPrice`, `supplyPrice`, `productType`, `fulfillmentKind`, `salesClassification`, `purchaseClassification`, `ageRestriction`, `minQuantity`, `maxQuantity`, `seller`, `categoryPath`(단일), `isOverseas`, `isVisibleToMembersOnly`, `hideMembershipPriceForNonMembers`, `seoTitle`, `seoDescription`, `seoKeywords`(`\|` 구분), `isWholesaleOnly`, `salesStartDate`, `salesEndDate` | `product-import.template.ts:3-33`(헤더) — 뒤 6개는 3단계 신설, `validator.ts:105-143` 이 채운다 |
| Options (4) | `productKey`, `optionName`, `optionValues`(`\|` 구분), `sortOrder` | `normalizer.ts:73-82` — v1 의 죽은 컬럼이었으나 v2 2단계에서 실제로 읽는다 |
| Variants (5, 선택) | `productKey`, `optionCombination`, `basePrice`, `membershipPrice`, `variantCode` | v2 2단계 신설. 축 순서 무시(`comboKey` 정렬 정규화) |
| Categories (3, 선택) | `productKey`, `categoryPath`, `isPrimary`(상품당 정확히 1개) | 3단계 신설. `Products.categoryPath` 하위호환과 동시 사용 시 행 오류 — `normalizer.ts:243-321` |
| Constraints (3, 선택) | `productKey`, `requiresMembership`, `lifetimeQuantityLimit`(1~2147483647 정수) | 3단계 신설. 상품당 최대 1행, 둘 다 비면 구매제약을 만들지 않는다 — `normalizer.ts:327-356`, `validator.ts:210-236` |

`basePrice` 는 필수다 — 0 또는 누락이면 행 오류(`validator.ts:59-64`). v1 의 0원 게시 구멍은 입구에서 막혀 있다.

### 2.2 등록 불가한 필드

| 구분 | 항목 |
|---|---|
| 버전 스칼라 | `thumbnail`(대표이미지), 부가이미지 |
| 연관 엔티티 | 태그(`tagValueIds`), 옵션**값**별 `colorCode`/`imageUrl`/정렬 |
| 구조적 제약 | 카테고리 신규 생성 불가(기존 트리 해석만), 가격은 상품/조합 2단만, **기존 상품 수정(upsert) 불가 — 신규 생성 전용** |

`descriptionHtml` 도 현재 등록 불가이나 확장 대상이 아니다 — §2.3.

### 2.3 `descriptionHtml` 은 레거시다 — 확장 대상이 아니다

v2 스펙 §2.2 가 `descriptionHtml` 을 3순위 공백으로 적었으나, **canonical 상세설명 필드는 `description`(마크다운)이고 그건 이미 임포트 가능하다.**

- admin-web 편집기가 저장하는 것은 `description` 이다 (`description/index.tsx:110`)
- `descriptionHtml` 은 **"레거시 HTML을 비웠습니다"** 버튼으로 지우는 대상이다 (`description/index.tsx:130`)
- 표시 로직도 `description` 우선, 없을 때만 `descriptionHtml` 폴백이다 (`:180-198`)

임포트에 `descriptionHtml` 을 추가하는 것은 레거시 경로를 되살리는 일이므로 **하지 않는다.**

### 2.4 본문 이미지는 이미 `fileId` 간접참조를 쓴다

`description` 마크다운의 이미지는 URL 이 아니라 디렉티브다.

```
::product-image{fileId="0193...-...." alt="..."}
```

`packages/product-description/directive.ts:63` 이 생성하고 `:24` 가 파싱한다. `fileId` 는 UUID 정규식으로 검증된다(`:22`, `:34`).

**즉 워크북이 도입할 "임시 이미지 번호"는 새 개념이 아니라 이 구조에 워크북 스코프 키를 하나 얹는 것이다.**

### 2.5 `shippingMethodId` 와 `supplierId` 는 죽은 컬럼이다

| 확인 항목 | `shippingMethodId` | `supplierId` |
|---|---|---|
| 참조 테이블 | **없다** (레포에 `shipping_methods` 류 0건) | `suppliers` 는 inventory 에 실재 (`inventory.schema.ts:313`) |
| FK 제약 | 없다 (`catalog.schema.ts:173`) | 없다 (`:178`) |
| 쓰기 경로 | **없다** — `create-master.dto.ts`·`update-master.dto.ts` 어디에도 없다 | **없다** |
| 스냅샷 포함 | 아니다 — Medusa·검색·스토어프론트로 안 나간다 | 아니다 |
| admin-web UI | 없다 | 없다 (상품 화면의 "공급처"는 `seller` varchar) |
| 유일한 등장 | 버전 diff 비교 목록 (`product-versions.service.ts:1393`) + mapper→entity→API 응답 통과 | 같음 (`:1396`) + `idx_versions_supplier` 인덱스 |

값을 넣어도 아무 데도 도달하지 않는다. **임포트 대상이 아니다.** 정리한다면 임포트가 아니라 스키마 정리(ADR-0005 contract phase) 건이다.

### 2.6 file-service 이미지 컨텍스트가 용도별로 다르다

`apps/file-service/src/database/default-file-contexts.ts`

| context | 허용 MIME | 최대 크기 | 경로 |
|---|---|---|---|
| `product-image` (대표/부가) | `image/jpeg`, `image/png`, `image/webp` **만** | 10MB | `products/images` |
| `product-description-image` (본문) | `image/*` | **20MB** | `products/description-image` |

같은 이미지라도 용도에 따라 통과 여부와 저장 경로가 갈린다. **워크북이 용도를 알아야 한다.**

업로드는 서버가 **버퍼를 콘텐츠 스니핑**해 컨텍스트 화이트리스트로 검증한다(`upload.service.ts:57-66`). 즉 MIME·크기 방어는 이미 file-service 쪽에 있다.

### 2.7 core → file-service 업로드 경로 상태

- 서비스 토큰 발급은 **이미 있다** — `AUTH_SECRET` 공유 HS256, `scopes:['master']` (`library/clients/file-service.client.ts:26-41`)
- 그 클라이언트는 **다운로드 전용**이다 (`fetchFile`/`getDownloadUrl`/`fetchMetadata`)
- 삭제 권한은 통한다 — `file-access.ts:62` 가 `scopes:['master']` 위임 토큰을 명시적으로 허용한다
- live env 에 `AUTH_SECRET`·`FILE_SERVICE_URL` 둘 다 이미 있다 (`services.ts` Core 블록) — **신규 시크릿 없음**

**함정:** `uploads.uploaded_by` 가 **NOT NULL uuid** 인데(`file-service/src/database/schema.ts:50`), 업로드 컨트롤러가 `@User()` 의 `userId` 를 그대로 쓴다(`upload.controller.ts:78`). 현재 서비스 토큰은 `sub:'core-library-service'` 만 있고 `userId` 가 없어 **그대로 쓰면 NOT NULL 위반으로 죽는다.**

### 2.8 file-service 에 고아 파일 정리 잡이 없다

`apps/file-service/src/lifecycle/` 에 수동 `DELETE /files/:fileId`(soft delete) 하나뿐이다. `@Cron` 정리 작업이 없다. **업로드 후 참조되지 않게 된 파일은 S3 에 영구 잔존한다.**

### 2.9 진행 조회가 전체 행을 2초마다 실어 나른다

`getSession` 이 세션의 모든 아이템 행을 **무제한으로** 반환한다(`session.reader.ts:74-86`). 그리고 코드 주석이 admin-web 이 이 응답을 **2초마다 폴링**한다고 적어 놓았다(`:19-23`, `queries.ts useImportSession`). 1,000 행 세션이면 2초마다 1,000 행이 오간다. `payload` jsonb 를 프로젝션에서 제외한 흔적이 있는 것으로 보아 한 번 밟은 문제다.

### 2.10 `failedCount` 가 두 종류를 한 칸에 섞는다

- `acceptCommit` 이 **접수 시점 검증실패 수**로 초기화한다 (`manager.ts:48`)
- 그 뒤 `failItem` 이 **생성 실패**마다 +1 한다 (`job.manager.ts:365`)

따라서 "생성 대상 행 수"(= 총 행 − 접수시점 검증실패)를 이 값으로는 복원할 수 없다.

### 2.11 배포 경로의 제약 두 가지

| 제약 | 값 | 근거 |
|---|---|---|
| ALB idle timeout | **60초** (AWS 기본값 — override 없음) | `deployments/lcnine/services/infra/shared.ts:136-149` 가 `loadBalancer` 에 `idleTimeout` 을 지정하지 않는다. 그리고 이 ALB 는 **전 서비스 공용**이라 늘리면 blast radius 가 core 만이 아니다 |
| outbound NAT | **단일 `t4g.nano` fck-nat, 고정 EIP** | `deployments/lcnine/platform/infra/shared.ts:22` 가 `nat:"ec2"`, 인스턴스 타입 override 없음 → SST 기본값 `t4g.nano` (`.sst/platform/src/components/aws/vpc.ts:69`). `services/infra/shared.ts:184` 가 모든 태스크 outbound 를 여기로 보낸다 |

NAT 는 Medusa→외부, notification→NHN/Resend 등이 **함께 쓰는 자원**이다.

## 3. 설계

### 3.1 워크북 구조 — 시트 3개 신설

```
[Images]  ← 신규
imageKey | sourceUrl
IMG-1    | https://supplier.example/p/123/main.jpg
IMG-2    | https://supplier.example/p/123/detail-01.jpg

[Products]  (신규 컬럼 8개)
productKey | ... | thumbnailImageKey | additionalImageKeys | description
P1         | ... | IMG-1             | IMG-3|IMG-4         | 부드러운 니트\n::product-image{imageKey="IMG-2"}
  + seoTitle | seoDescription | seoKeywords(| 구분) | isWholesaleOnly | salesStartDate | salesEndDate

[Categories]  ← 신규 (다중 지정)
productKey | categoryPath      | isPrimary
P1         | 여성패션>니트      | Y
P1         | 기획전>겨울신상    | N

[Constraints] ← 신규 (구매제약)
productKey | requiresMembership | lifetimeQuantityLimit
P1         | Y                  | 2

[Options] / [Variants]  ← 변경 없음
```

**결정 사항**

- **용도는 참조 지점에서 추론한다.** `thumbnailImageKey`/`additionalImageKeys` 에 등장 → `product-image`, `description` 본문 디렉티브에 등장 → `product-description-image`. **양쪽에 등장하면 오류로 막지 않고 두 번 업로드해 fileId 두 개를 만든다.** MD/AI 가 채울 칸이 하나 줄고, 컨텍스트별 MIME 제약(§2.6)이 자동으로 맞는다.
- `additionalImageKeys` 는 **최대 5개** — 도메인 상한이다 (`create-master.dto.ts:11`).
- 본문 디렉티브는 `imageKey=` 로 쓰고 임포터가 `fileId=` 로 치환한다. 워크북에는 UUID 가 등장하지 않는다.
- `Products.categoryPath` 컬럼은 **유지한다** — 기존 워크북 하위호환. `Categories` 시트가 있으면 그쪽이 우선하고, 둘 다 있으면 행 오류.
- `Categories.isPrimary` 는 상품당 정확히 1개여야 한다(0개 또는 2개 이상이면 행 오류).
- 행 오류 규칙(기존 계승): 존재하지 않는 `productKey` 참조, 중복 `imageKey`, 해석 불가 `categoryPath`, 정의되지 않은 `imageKey` 참조.

**AI 작성 관점.** MD 의 raw 데이터를 AI 가 이 양식으로 채우는 운용을 전제한다. 그래서 이미지는 어느 칸에서든 항상 `IMG-n` 이고, AI 가 바이너리나 UUID 를 다룰 필요가 없다. 시트를 정규화해 쪼개는 것은 이 작업 방식과 정합한다.

### 3.2 이미지 파이프라인 — URL 다운로드

**이번 범위는 URL 뿐이다.** 로컬 파일 드롭존(브라우저가 file-service 로 직접 업로드)은 시트 모양을 바꾸지 않고 나중에 얹을 수 있으므로 뒤로 미룬다. 그때는 `Images` 시트에 `fileName` 컬럼이 추가되고 `sourceUrl` 과 배타 관계가 된다.

#### 3.2.1 신규 테이블

```
product_import_images
  id            uuid pk
  session_id    uuid not null → product_import_sessions
  image_key     varchar not null      -- 워크북 스코프
  usage         'main' | 'description'
  source_url    text not null
  status        'pending' | 'probed' | 'uploaded' | 'probe_failed' | 'fetch_failed'
  file_id       uuid                  -- 업로드 성공 시
  mime_type     varchar
  size_bytes    bigint
  error_message text
  created_at / updated_at
  UNIQUE (session_id, image_key, usage)
  INDEX (session_id, status)
```

**`status` 를 5값으로 나누는 이유는 진행률이다** — probe 실패는 fetch 단계의 분모에서 빠져야 하는데, 실패를 한 값으로 뭉치면 어느 단계에서 죽었는지 알 수 없어 분모가 틀린다. 5값이면 `GROUP BY status` 하나로 두 단계의 분모·분자·실패가 전부 나온다 (§3.5).

**행의 단위는 `(imageKey, usage)` 이지 참조 횟수가 아니다.** 여러 상품이 같은 `imageKey` 를 같은 용도로 가리키면 행 하나·업로드 한 번이고 `fileId` 를 공유한다. 같은 이미지를 여러 상품에 쓰는 것이 흔한 운용이므로 이 dedup 이 NAT 부하(§3.2.4)를 직접 줄인다. 반대로 한 키가 대표·본문 양쪽에 쓰이면 §3.1 대로 행이 둘 생기고 컨텍스트가 갈린다.

#### 3.2.2 두 phase — probe 후 fetch

```
pending ──probe(HEAD)──▶ probed ──fetch(GET+업로드)──▶ uploaded
   └──▶ probe_failed              └──▶ fetch_failed
```

한 슬라이스는 `pending` 이 남아 있으면 probe 를, 없으면 `probed` 를 fetch 한다.

**"probe 전량 완료"는 `count(status='pending') = 0` 으로 관측된다.** UI 가 그 시점에 URL 점검 결과를 확정 표시한다.

**probe 를 별도 phase 로 두는 이유.** `/validate` 는 동기 엔드포인트라 **ALB 60초 천장**(§2.11)에 걸린다. 고유 URL 3,000개면 병렬 20 × HEAD 300ms = 45초로, 정상일 때도 여유가 없고 넘기면 504 라 **검사 결과를 통째로 버린다**. probe 를 워커로 옮기면 전량 검사·진행률 표시·타임아웃 무관이 동시에 성립하고, 바디를 안 받으므로 fetch 보다 훨씬 빠르다.

대가는 **commit 을 눌러야 알 수 있다 = 세션이 생긴다** 는 것이고, 그래서 세션 취소(§3.4)가 짝으로 필요하다.

동기 `/validate` 에 상한(고유 URL 300개)을 두는 안은 채택하지 않는다 — "3,000개 중 300개는 괜찮았다"는 확신을 주지 못하면서 검사했다는 착각만 준다. `/validate` 는 지금처럼 URL **형식**과 키 참조 해석까지만 본다.

#### 3.2.3 core 측 네트워크 가드

MIME·크기 검증은 file-service 가 이미 한다(§2.6). core 가 맡는 것은 네트워크 경계다.

| 가드 | 이유 |
|---|---|
| `http`/`https` 스킴만 허용 | `file://`·`gopher://` 차단 |
| **사설·링크로컬·loopback IP 차단** | ECS 태스크 메타데이터 `169.254.170.2`, EC2 IMDS `169.254.169.254`. **가장 중요한 항목** |
| 리다이렉트 3회 제한 + **매 홉 IP 재검사** | 공개 URL → 사설 IP 리다이렉트 우회 차단 |
| 응답 크기 상한 초과 시 abort | 컨텍스트 상한(10/20MB) 초과분을 끝까지 받지 않는다 |
| 연결·전체 타임아웃 | 느린 소싱처가 슬라이스를 물지 않게 |

DNS 재바인딩(검사 후 실제 연결에서 다른 IP 로 해석)까지 막으려면 해석한 IP 로 직접 연결하고 Host 헤더를 세팅해야 한다. 이번 범위에서는 **하지 않는다** — 입력이 관리자가 올린 워크북이고 임의 사용자 입력이 아니다. 이 판단을 기록해 둔다.

#### 3.2.4 동시성은 1

**근거는 core CPU 가 아니라 NAT 다** (§2.11). 3,000장 × 평균 500KB ≈ **1.5GB** 가 단일 `t4g.nano` 를 지나고, 그 인스턴스는 Medusa·notification 의 outbound 와 공유된다. 고정 EIP 라 소싱처가 IP 하나만 rate-limit 하면 전체가 막힌다.

나중에 "느리니 동시성을 올리자"는 판단이 나오면 **올려야 할 것은 core 슬라이스가 아니라 NAT 인스턴스 타입**이다. 이 근거를 코드 주석에 남긴다.

#### 3.2.5 업로드 시 `userId` 를 실어 보낸다

§2.7 의 NOT NULL 함정 대응. 서비스 토큰에 **세션의 `uploaded_by` 를 `userId` 클레임으로** 실어 발급한다. 이미지가 워크북을 올린 MD 에게 귀속되어 소유자 기반 접근이 자연스럽게 동작한다. commit 슬라이스가 이미 그 값을 읽고 있다(`job.manager.ts:171-177`).

기존 `FileServiceClient`(library 모듈)는 건드리지 않는다 — 임포트용 업로드 메서드는 별도 클라이언트에 둔다. library 의 다운로드 위임과 용도가 다르고, 토큰 클레임 구성이 달라진다.

### 3.3 잡 모델 — 레인 3개

```
image (probe → fetch)  →  commit  →  publish
```

probe/fetch 를 별도 레인으로 두지 않는다. 레인이 늘면 세션 상태 컬럼과 **굶주림 경로**가 함께 는다. 두 phase 는 `product_import_images.status` 로 이미 구분되므로 세션에는 `image_status` 하나만 추가된다.

워커 틱(@Cron 5초)은 `image` → `commit` → `publish` 순으로 claim 을 시도한다. 기존 "가장 오래된 세션이 끝날 때까지 워커를 독점한다 — FIFO 지 교대 진행이 아니다" 규칙(`job.manager.ts:127-135`)이 그대로 확장된다.

**Images 시트가 없는 워크북은 접수 즉시 `image_status='completed'`** 라 기존 흐름과 동일하게 동작한다.

| 테이블 | 추가 컬럼 |
|---|---|
| `product_import_sessions` | `image_status`, `image_error`, `cancel_requested_at`, `consecutive_failures`, `invalid_count` |
| `product_import_images` | (신규 테이블 — §3.2.1) |

#### 3.3.1 마이그레이션 함정

**`image_status` 의 DEFAULT 는 반드시 `completed` 여야 한다.** `queued` 로 두면 마이그레이션 이전에 만들어진 세션 전부가 이미지 레인에 걸려 영원히 대기한다. `commit_status` 가 이미 같은 이유로 `.default('completed')` 다 (`catalog.schema.ts:1026`) — 선례를 그대로 따른다. v2 3단계 배포 때 `publish_status` DEFAULT 가 만든 운영 주의사항과 같은 계열이다.

**`canceled` 는 기존 enum 에 값을 추가하는 것이다.** `product_import_job_status` 는 현재 `idle|queued|running|completed|failed` 뿐이므로(`catalog.schema.ts:986-992`) `ALTER TYPE ... ADD VALUE 'canceled'` 가 필요하다. 이 경우 **추가한 값을 같은 트랜잭션에서 DEFAULT 로 쓰면 실패한다**(`unsafe use of new value`) — `canceled` 는 DEFAULT 로 쓰지 않으므로 걸리지 않지만, 같은 마이그레이션에서 `image_status` DEFAULT 를 지정하는 것과 섞이지 않게 확인한다. 반면 `product_import_images.status` 는 같은 마이그레이션에서 **새로 만드는** 타입이라 이 제약을 받지 않는다. 레포 선례(`20260727141456`)는 `::text` 캐스트로 우회했다 — 생성된 SQL 을 눈으로 확인한다.

전부 additive 이므로 ADR-0005 §5 의 **expand phase — `migrate` → `deploy`** 순서다 (contract phase 의 반대).

### 3.4 취소와 고착

#### 3.4.1 취소는 "여기서 멈춘다"이지 "없던 일로"가 아니다

`POST /product-imports/:id/cancel` + 세션 `cancel_requested_at`.

워커는 **`renewLease` 의 `returning` 에 `cancel_requested_at` 을 얹어** 읽는다 (`job.manager.ts:334-344`). 매 아이템마다 이미 도는 왕복이라 **쿼리가 늘지 않는다.** 감지하면 lease 를 놓고 모든 레인 상태를 `canceled` 로 확정한다.

| 취소 시점 | 되돌리는 것 | 남는 것 |
|---|---|---|
| probe 중 | — | — |
| fetch 중 | **업로드된 이미지 soft delete** | — |
| commit 중 | 없음 | 이미 생성된 draft 상품 |
| publish 중 | 없음 | 이미 게시된 상품 + **이미 나간 이벤트** |

**draft 자동 삭제는 하지 않는다.** 삭제는 되돌릴 수 없고, 부분 생성된 상품은 사람이 보고 판단하는 것이 맞다 — 세션 상세에 `masterId` 가 전부 있으므로 수동 정리가 가능하다. phantom masterId 문제(§5)와도 얽힌다.

**이미지 정리는 반드시 한다.** file-service 에 고아 정리 잡이 없어(§2.8) 안 지우면 S3 에 영구 잔존한다. `product_import_images.file_id` 를 전부 추적하므로 정리는 싸고, 권한도 이미 통한다(`file-access.ts:62`). 정리 실패는 로그만 남기고 취소를 막지 않는다 — 취소가 정리 때문에 실패하는 편이 더 나쁘다.

취소는 **종단**이다. 재개하지 않는다. 다시 하려면 워크북을 재업로드한다.

#### 3.4.2 고착 — 진짜 경로는 하나다

lease 는 60초라 만료되면 재클레임되므로 그 자체로는 굳지 않는다. 진짜 고착은 **슬라이스 밖으로 탈출한 예외**다. `recordJobError` 가 메시지만 남기고 상태를 바꾸지 않도록 **의도적으로** 설계돼 있어(`job.manager.ts:370-374` — 일시적 DB 오류로 임포트를 영구 실패시키는 편이 더 나쁘다) 매 틱 무한 재시도한다. 그래서 `'failed'` 를 쓰는 코드가 하나도 없다.

- 세션에 `consecutive_failures int not null default 0`
- 슬라이스 탈출 예외마다 +1, 슬라이스 정상 종료 시 0 으로 리셋
- 상한(10회) 초과 → 그 레인을 `failed` 로 확정하고 lease 해제 → **`'failed'` 값이 드디어 쓰인다**
- 일시적 오류는 10회(약 50초 이상) 안에 회복되므로 원래 설계 의도가 보존된다

**별도 `reset-lease` API 는 만들지 않는다** — 굳은 세션은 취소로 푼다. 취소가 고착 해소를 겸한다.

### 3.5 진행률 — 집계 전용 엔드포인트

`GET /product-imports/:id/progress` — 행 목록 없이 단계별 집계만 반환한다.

```jsonc
{
  "canceled": false,
  "stages": [
    { "key": "probe",   "label": "이미지 점검",   "status": "completed", "done": 3000, "total": 3000, "failed": 4 },
    { "key": "fetch",   "label": "이미지 업로드", "status": "running",   "done": 1240, "total": 2996, "failed": 2 },
    { "key": "commit",  "label": "상품 생성",     "status": "queued",    "done": 0,    "total": 1000, "failed": 0 },
    { "key": "publish", "label": "게시",          "status": "idle",      "done": 0,    "total": 0,    "failed": 0 }
  ]
}
```

**쿼리 3개.** 세션 1행 + `items GROUP BY status, publish_status` + `images GROUP BY status`. 전부 `session_id` 인덱스를 타고 결과가 20행 미만이다. **세션 크기와 무관한 고정 비용**이라, §2.9 의 현행(1,000행을 2초마다)보다 오히려 싸다.

카운터 컬럼 증가가 아니라 **매번 집계**하므로 드리프트가 없다 — 워커 중단 시 `createdCount`/`publishedCount` 가 실제와 어긋나는 현행 문제가 함께 사라진다.

**단계별 분모**

| 단계 | total | done | failed |
|---|---|---|---|
| probe | 전체 이미지 행 | `status != 'pending'` | `probe_failed` |
| fetch | `status ∈ {probed, uploaded, fetch_failed}` | `uploaded + fetch_failed` | `fetch_failed` |
| commit | `totalRows - invalidCount` | `created + (failedRows - invalidCount)` | `failedRows - invalidCount` |
| publish | `items.status = 'created'` | `publish_status ∈ {published, failed}` | `publish_status = 'failed'` |

commit 행에 뺄셈이 들어가는 이유가 §2.10 이다. `items.status` 는 **접수 시점 검증실패와 생성 실패를 둘 다 `'failed'`** 로 적고(`manager.ts:57-66`, `job.manager.ts:361`), `publish_status='skipped'` 까지 같아서 상태만으로는 갈리지 않는다. 얼려 둔 `invalidCount` 를 빼야 생성 실패분이 나온다.

commit 의 분모를 위해 **세션에 `invalid_count` 를 얼린다** — §2.10 의 오염 때문에 `failedCount` 로는 복원할 수 없다. 접수 시점 값을 별도 컬럼에 넣으면 깨끗하게 나온다. 옛 세션은 NULL 이고 UI 가 현행과 같은 표시로 폴백한다.

(`items.status` enum 에 `invalid` 를 추가해 가르는 방법도 있으나, 컬럼 하나 추가가 기존 데이터에 손을 덜 댄다.)

**화면 4단계 ↔ 내부 3레인.** 관리자에게 보이는 단계는 4개고 워커 레인은 3개다. 이 층 분리는 유지한다 — 레인은 claim·lease·굶주림의 단위고, 단계는 사람이 이해하는 단위다. `progress` 응답이 그 변환을 담당한다. 이미지가 없는 워크북은 probe/fetch 의 `total` 이 0 이라 UI 가 접어 표시하고 실질 2단계로 보인다.

**기존 `GET /product-imports/:id` 는 폴링 대상에서 뺀다** — 행 목록은 사용자가 펼칠 때만 조회한다. admin-web `queries.ts` 의 `refetchInterval` 을 `progress` 쪽으로 옮긴다.

## 4. 하지 않는 것

- **로컬 파일 업로드(드롭존)** — 시트 모양을 바꾸지 않고 나중에 얹을 수 있다 (§3.2 초입).
- **태그 임포트** — `Tags` 시트 하나를 붙이면 되는 구조라 부채가 쌓이지 않는다. 이번 범위 밖.
- **`shippingMethodId`·`supplierId` 임포트** — 죽은 컬럼이다 (§2.5). 넣으면 MD 가 아무 효과 없는 칸을 채운다.
- **`descriptionHtml` 임포트** — 레거시다 (§2.3).
- **옵션값별 색상코드·이미지·정렬** — 도메인 DTO 는 지원하나 `optionValues` 가 `|` 구분 단일 셀이라 시트 모양을 바꿔야 한다. 별건.
- **기존 상품 수정(upsert)** — 신규 생성 전용을 유지한다.
- **카테고리 신규 생성** — 기존 트리 해석만. 임포트가 카테고리 트리를 만들면 오타 하나가 유령 카테고리를 낳는다.
- **`validateCalculatedPrices` 의 0원 허용 수정** — v2 와 동일하게 임포트 입구에서 막는다.
- **DNS 재바인딩 방어** — §3.2.3.
- **InboxWorker 배치 claim (v2 5단계)** — 이 스펙 범위 밖. 이벤트 발행량은 이번에 바뀌지 않는다.
- **draft 자동 삭제** — §3.4.1.

## 5. 알려진 결함 — 이번에 손대지 않지만 기록

- **조합 variant 에 매칭이 생기지 않는다.** `createMaster` 는 기본 variant 1개에만 `ProductVariantCreated` + product-matching 직접호출을 하고, 옵션 diff 로 조합 variant 를 만드는 `_generateVariantsWithoutEvents` 는 이벤트를 내지 않는다. 매칭 없는 variant 는 `MATCHING_MISSING` 으로 재고 게이팅을 받지 않아 무한 판매된다. v2 의 `variantCode` 로 완화되지만 근본 해결은 별건.
- **phantom masterId** — commit 중 한 행이 롤백되면 비-트랜잭션 Kafka 이벤트 + product-matching 행이 없는 masterId 로 잔존한다 (v1 스펙 후속 트래킹 1번, 사용자 결정: 현상 유지).
- **file-service 고아 파일** — §2.8. 이번 스펙은 취소 경로에서만 정리한다. 전역 정리 잡은 별건.
- **v2 2단계 리뷰 지적 ③군 5건** — `#1`(Products 시트 `variantCode`), `#3`(`values[].sortOrder`), `#5`(comboKey NFC), `#9`(`basePrice` 헤더 검사), `#10`(오류 행번호 불일치). 전부 1~5줄. v2 5단계 뒤 정리 커밋으로 묶기로 했던 것이 아직 남아 있다.
- **판매기간에 편집·해제 UI 가 없다.** `sales_start_date`/`sales_end_date` 는 재고 게이팅이 읽지만(`product-sellable-quantity.calculator.ts:90-96`) 쓰기 경로가 v3 3단계 임포트뿐이다. 잘못 넣으면 화면에서 고칠 수 없고 스토어프론트만 조용히 품절된다 — 3단계는 프리뷰 표시(`resolved.salesPeriod`)로 커밋 전 확인만 제공한다. admin UI 판매기간 편집은 별건.
- **varchar 길이 검증이 seoTitle 에만 있다.** `name`(255)·`brand`(100)·`productCode`(100)·`alternativeName`(255)·`salesClassification`(100)·`purchaseClassification`(100)·`seller`(100) 는 여전히 입구를 통과하고 commit 에서 Postgres 22001 로 그 행만 죽는다. v1 부터 있던 공백이고 5줄짜리 정리 건이다.

## 6. 단계 분할

| 단계 | 내용 | 배포 결합 |
|---|---|---|
| **1** | 운영 구멍 — 세션 취소 + `consecutive_failures` 상한 + `invalid_count` 얼리기 | 마이그레이션 1건 (additive → `migrate` → `deploy`) |
| **2** | 진행률 API + admin-web 폴링 전환 | core → admin-web (같은 `sst deploy`) — **구현 완료(2026-07-30)** |
| **3** | 순수 스칼라 필드 6종 + `Categories`·`Constraints` 시트 | core → admin-web — **구현 완료(2026-07-30)**, 마이그레이션 0건 |
| **4** | 이미지 파이프라인 — `Images` 시트 + `product_import_images` + probe/fetch 레인 + 업로드 클라이언트 | 마이그레이션 1건 (additive) |

**1·2 를 먼저 하는 이유가 있다.** 4단계(이미지)가 "commit 을 눌러야 오류를 안다"는 대가를 지불하는데, 그 대가를 받아낼 수단(취소)과 확인 수단(진행률)이 먼저 있어야 한다. 순서를 뒤집으면 이미지 실패를 만난 관리자가 굳은 세션을 손으로 풀어야 한다.

3 단계는 1·2 와 독립이라 병행 가능하지만, 같은 파일(`template.ts`·`normalizer.ts`·`validator.ts`)을 4단계가 다시 건드리므로 4 보다 먼저 둔다.

**구현 계획은 단계별로 따로 쓴다.**

## 7. 검증 계획

- **단위**: `imageKey` 해석(용도 추론, 양쪽 등장 시 2건 생성), 본문 디렉티브 `imageKey`→`fileId` 치환, `Categories` 다중 지정 + `isPrimary` 정확히 1개 규칙, `Constraints` 매핑, 진행률 집계의 단계별 분모(특히 probe 실패가 fetch 분모에서 빠지는지), `consecutive_failures` 리셋·상한, 취소 감지 시점.
- **SSRF 가드**: 사설·링크로컬 IP 거부, 리다이렉트 홉마다 재검사, 크기 초과 abort — 각각 단위 테스트. `169.254.169.254`·`169.254.170.2` 를 명시적 케이스로 넣는다.
- **통합(실 Postgres)**: 취소가 진행 중 슬라이스를 실제로 멈추는지, `image_status` DEFAULT 가 옛 세션을 이미지 레인에 가두지 않는지. `shipment-dispatch-persistence.integration.spec.ts` 선례를 따른다.
- **타입 게이트**: `nest build core`. 레포 eslint 는 전역 미게이트 debt 이므로 권위가 아니다. spec 파일은 `nest build` 가 제외하므로 `npm run type-check:scoped` 로 따로 본다.
- **전역 jest·전역 tsc 는 develop 에서도 red** 라 "전체 그린"으로 판정할 수 없다. 변경 파일 기준 차분으로 본다.
- **수동 스모크**: dev 에서 이미지 3~5장짜리 워크북 1건 — probe→fetch→commit→publish 전 구간과 취소 1회.

## 8. 배포 선행조건

- 마이그레이션 2건 (1단계·4단계), 전부 additive → **`migrate` → `deploy`** 순서 (ADR-0005 §5 expand phase).
- **신규 시크릿 없음** — Core live env 에 `AUTH_SECRET`·`FILE_SERVICE_URL` 이 이미 있다 (§2.7).
- 신규 env (전부 기본값 있음, 미설정 시 동작): `PRODUCT_IMPORT_IMAGE_SLICE`, `PRODUCT_IMPORT_IMAGE_FETCH_TIMEOUT_MS`, `PRODUCT_IMPORT_IMAGE_MAX_BYTES`.
- `PRODUCT_IMPORT_WORKER_ENABLED=false` 가 기존 킬스위치로 그대로 유효하다 — 이미지 레인도 같은 워커에 붙으므로 함께 멈춘다.
