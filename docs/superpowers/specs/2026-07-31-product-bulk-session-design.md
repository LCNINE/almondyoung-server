# 상품 일괄 등록/수정 세션 설계 스펙

- 날짜: 2026-07-31
- 대상: `apps/core` (catalog) + `apps/admin-web`
- 상태: **설계 확정, 구현 미착수**
- 관련:
  - `docs/superpowers/specs/2026-07-30-product-bulk-import-v3-fields-and-images-design.md` (v3 — 이 스펙이 **대체**한다)
  - `docs/superpowers/specs/2026-07-28-product-bulk-import-v2-design.md` (v2)
  - `docs/adr/0004-variant-draft-scoped-edit-cow.md` (버전 CoW·variantCode)
  - `docs/adr/0005-drizzle-migration-and-autodeploy.md` (마이그레이션 순서)

## 1. 목표

대량등록 v1~v3 는 **신규 생성 전용**이었다. 이 스펙은 그것을 일반화해, 상품의 **등록과 수정을 한 양식·한 생애주기**로 다루는 세션을 만든다.

핵심 변화 셋:

1. **수정(upsert)이 열린다.** 기존 상품을 선택해 데이터가 프리필된 양식을 받고, 고쳐서 올린다.
2. **결과가 draft 버전이다.** 세션이 상품을 바로 만들지 않고 draft 를 만들며, 작업자가 통상의 draft 편집 UI 로 검토한 뒤 일괄 발행한다.
3. **이미지가 URL 이 아니라 파일이다.** `fileId` 또는 작업자 로컬 파일명만 받고 웹 URL 은 받지 않는다.

**v3 를 대체한다.** 기존 대량등록 메뉴는 새 세션으로 바뀌고, v3 4단계의 URL 이미지 파이프라인(probe/fetch 레인, SSRF 가드, `product_import_images`, 정리기)은 제거한다. v3 4단계는 아직 실운용에 안 쓴 상태라 걷어낼 비용이 가장 싼 시점이다.

## 2. 현재 상태 실측 (2026-07-31, `d96576365`)

### 2.1 버전 시스템이 이미 이 설계의 절반을 갖고 있다

`product_master_versions` 는 `draft | inactive | active` 와 `draftOwnerId` 를 갖는다(`catalog.schema.ts:114`). 그리고 이미 있는 것:

| 기능 | 위치 |
|---|---|
| 새 draft 버전 생성 (부모에서 포크 + 매핑 복사) | `product-versions.service.ts:206` `createDraftVersion` |
| draft 편집 / 삭제 | `product-master-versions.controller.ts` `PUT :versionId` / `DELETE :versionId` |
| draft 컨텍스트 variant 편집 (CoW) | `PUT :versionId/variants/bulk`, `PUT :versionId/variants/:variantId` |
| 버전 발행 | `PATCH :versionId/publish` → `publishVersion` (`:268`) |
| 버전 비교 | `GET :versionId/compare/:compareVersionId` |
| 내 작성중 목록 | `product-versions.controller.ts:31` `GET /my-drafts` + `mall/my-drafts` 화면 |

**그리고 지금의 임포트도 이미 draft 를 만들고 발행한다** — `product-import.manager.ts:142` 가 "레코드 하나로 draft 상품을 만든다"이고, 게시 레인이 `publishVersion` 을 부른다. 즉 이 스펙의 draft 모델은 새 개념이 아니라 **이미 있는 것에 수정 경로와 세션 소유권을 붙이는 것**이다.

### 2.2 `publishVersion` 은 병합이 아니라 통째 교체다

`product-versions.service.ts:295-304` 가 기존 active 를 `inactive` 로 내리고 대상 draft 를 `active` 로 올린다. **필드 단위 병합이 없다.**

따라서 draft 를 옛 버전에서 포크해 두면, 그 사이 남이 발행한 변경은 이 draft 가 발행되는 순간 통째로 사라진다. draft 가 오래 살아있는 설계(§3.2)에서는 이 창이 며칠 단위로 열린다. **이 스펙의 병합 전략(§3.6)이 존재하는 이유가 이것이다.**

`product_master_versions` 에 **master 당 draft 유니크 제약이 없다**(인덱스는 `draftOwnerId` 에만). 즉 같은 상품에 세션 draft 와 개인 draft 가 동시에 존재할 수 있다.

### 2.3 `publishVersion` 은 무겁다

한 건마다 도는 것: variantCode 유니크 검증, **다른 master 와의** productCode 유니크 검증, 가격 검증, 가격 캐시 생성, 기존 active → inactive, matching 인계(`_reconcileMatchingsAfterPublish`), asset link 인계, 디지털 자산 가드, variant 변경 이벤트, active 변경 이벤트, sellable 재계산.

**일괄 발행은 동기 엔드포인트로 불가능하고 행 단위 실패 격리가 필수다.** 그리고 수천 건이면 Kafka 이벤트도 수천 개다 — v2 4단계의 origin 마커 + inbox 레인 강등을 그대로 써야 한다. `PublishVersionOptions { origin, importSessionId }` 가 `product-versions.service.ts:54-57` 에 이미 있다.

### 2.4 옵션은 정체성과 표시가 분리돼 있다

| 테이블 | 내용 |
|---|---|
| `product_option_groups` (`catalog.schema.ts` §3) | `id` 뿐 |
| `product_option_group_displays` | `displayName`·`sortOrder` 를 `(optionGroupId, masterId, versionId, locale)` 로 스코프 |
| `product_option_values` (`:450`) | `id` + `optionGroupId` 뿐 — **이름이 없다** |
| `product_option_value_displays` | `displayName`·`colorCode`·`imageUrl`·`sortOrder` 를 `(optionValueId, masterId, versionId, locale)` 로 스코프 |
| `variant_option_values` (`:498`) | variant ↔ `optionValueId` |

그리고 매칭 인계가 쓰는 키는 `_comboKey(pv.optionValueIds)` — **ID 기반**이다.

**결론: displayName 을 바꿔도 `optionValueId` 가 그대로면 comboKey 가 동일해 매칭 인계가 정상 동작한다.** displays 가 `versionId` 로 스코프돼 있어 draft 에서 이름만 바꾸는 것도 버전 격리가 이미 맞다.

위험선은 "구조 변경 vs 표시명 변경"이 아니라 정확히 **variant 별 `optionValueId` 집합이 바뀌는가**이다.

| 작업 | comboKey | 매칭 |
|---|---|---|
| displayName·색상·정렬 변경 | 그대로 | 안전 |
| 옵션값 추가 | 기존 유지, 새 조합 추가 | 기존 안전 / 새 조합은 매칭 없음 |
| 옵션값 삭제 | 그 값을 쓰던 조합 소멸 | 해당 조합 매칭 고아 |
| 옵션 축 추가·삭제 | 전 조합 재구성 | 전멸 |

매칭 없는 variant 는 `MATCHING_MISSING` 이라 재고 게이팅을 받지 않아 **무한 판매된다**(v3 스펙 §5 의 알려진 결함).

### 2.5 가격은 룰 기반이고 임포트가 표현할 수 있는 건 진부분집합이다

`product_master_pricing_rules`(`catalog.schema.ts:317`) + `pricing_rules`(`:597`), 버전 스코프.

| 축 | 실제 지원 | v3 임포트가 만드는 것 |
|---|---|---|
| layer (`:594`) | `base_price`, `membership_price`, **`tiered_price`** | 앞 둘만 |
| scopeType (`:595`) | `all_variants`, **`with_option`**, `variants` | `all_variants`·`variants` 만 |
| operationType (`:596`) | **`offset`**, **`scale`**, `override` | `override` 만 |

그리고 임포트가 쓰는 DTO 는 `ReplacePricingRulesDto` — **replace** 다(`product-import-pricing.builder.ts`). 즉 `tiered_price`·`scale` 룰이 걸린 상품을 프리필해 판매가 한 칸만 고쳐 올리면 **가격 체계가 통째로 단순 override 로 뭉개진다.** 신규 등록만 하던 v3 에는 없던 위험이다.

### 2.6 admin-web 에 이미 있는 것

- 상품 목록 다중선택 — `features/mall/products-list/components/table/products-list-selection-model.ts`, `SelectedProductsModal`
- 별도의 일괄 작업 화면 — `features/mall/bulk/` (정책·액션 일괄 적용). **이 스펙과 별개 기능이며 경계 정리는 범위 밖.**
- file-service 업로드 클라이언트 — `lib/api/domains/files/upload.client.ts`. file-service 에 `POST /upload`(`upload.controller.ts:31`)·`POST /batch-upload`(`:84`) 존재

### 2.7 인프라 제약 (v3 스펙에서 계승)

| 제약 | 값 | 영향 |
|---|---|---|
| ALB idle timeout | 60초 (AWS 기본값, 전 서비스 공용) | 양식 생성·업로드 파싱·일괄 발행 전부 동기로 불가 |
| file-service 고아 파일 정리 잡 | **없다** (`lifecycle/` 에 수동 DELETE 하나) | 정리는 core 가 명시적으로 해야 한다 |

### 2.8 v3 가 남긴 운영 갭 (이 스펙이 해소한다)

- **commit 실패 행 재시도 경로가 없다.** publish 는 실패 행을 `pending` 으로 되돌려 재시도되지만(`product-import.manager.ts:247-270`) commit 에는 대응이 없다. upsert 불가와 곱해져, 1,000행 중 30행 실패 시 성공한 970행을 손으로 걷어내고 재업로드해야 한다.
- **varchar 길이 검증이 일부 필드에만 있다.** `name`·`brand`·`productCode`·`seller` 등은 프리뷰를 통과한 뒤 commit 에서 Postgres 22001 로 그 행만 죽는다.
- **`items.status` 가 검증 실패와 생성 실패를 둘 다 `'failed'` 로 적는다.** 그래서 v3 는 `invalid_count` 를 얼려 뺄셈해야 했다.

## 3. 설계

### 3.1 애그리게이트 두 개

**① 양식 생성 잡** (`product_form_exports`) — 상품 선택부터 엑셀 파일까지.

관리자가 목록에서 N개를 선택하면 202 로 접수되고 워커가 엑셀을 조립한다. 완성된 파일은 file-service 에 올리고 잡 행에 `fileId` 를 단다(DB 에 바이너리를 넣지 않는다).

**스냅샷은 통째로 복사하지 않고 `(masterId, versionId)` 쌍만 기록한다.** active/inactive 버전은 CoW 라 불변이므로 그 `versionId` 로 언제든 원본을 재구성할 수 있다. 수천 건이어도 잡에 붙는 건 uuid 쌍 목록뿐이다. (⚠️ 이 전제는 §6 에서 확인한다.)

**② 세션** (`product_bulk_sessions`) — 업로드부터 발행까지.

양식의 숨은 열에서 `exportId` 를 읽어 잡과 연결한다. 없으면 **신규 전용 세션**(빈 양식을 받은 경우)이다. 작업자가 붙인 이름을 갖는다.

**⚠️ 2단계 필수 전제 — "없음" 과 "있지만 모름" 을 반드시 구분한다.** 양식 생성 잡은 30일 후 만료돼 스냅샷째 삭제되지만(§3.12), 워크북 파일은 작업자 디스크에 그대로 남는다. 그러면 프리필된 `exportId` 를 든 워크북이 아무 잡에도 해석되지 않는 상태로 올라올 수 있다. 이때 위 규칙을 문자 그대로 적용해 "신규 전용 세션" 으로 읽으면 **프리필된 모든 행이 신규 상품으로 재분류돼 카탈로그가 통째로 중복 생성된다.**

따라서 2단계는 세 갈래로 나눈다: `exportId` 가 **없으면** 신규 전용 세션, **있고 해석되면** 정상, **있는데 해석 안 되면 업로드를 거부**하고 양식을 다시 받으라고 안내한다. (1단계 최종 리뷰가 지적한 갭 — 1단계가 스냅샷보다 오래 사는 워크북을 만들어내는 시점부터 도달 가능해진다.)

**세션이 다운로드 시점이 아니라 업로드 시점에 생기는 이유.** 다운로드 시점에 세션을 만들면 "양식만 받고 안 올린" 고아 세션이 대량 발생한다. 반대로 스냅샷을 양식의 숨은 열에만 담으면 작업자가 시트를 복사·재생성할 때 기준이 사라진다. 잡이 스냅샷을 보관하고 세션은 업로드에서 생기면 둘 다 피한다 — 고아는 가벼운 잡 행 하나로 끝나고, 양식의 숨은 정보는 `exportId` 하나로 줄어 훼손 위험이 작다.

### 3.2 phase 상태 머신

```
uploaded
   │ (워커)
validating ──────────────┐
   │                     ↓
review          ← 사람: 프리뷰 확인 + 충돌 행별 결정 → 승인
   │
awaiting_images ← 사람: 요구 이미지 전량 업로드 (요구 0건이면 건너뜀)
   │                    ※ 마지막 하나가 채워지면 자동 전진
drafting (워커)
   │
drafted         ← 사람: 개별 draft 검토·편집, 세션에서 제외, 실패 행 재시도
   │
publishing (워커)
   │
published                canceled               failed
```

**세션에 상태 컬럼은 `phase` 하나뿐이다.** v3 는 `image_status`·`commit_status`·`publish_status` 3개를 뒀는데, 4컬럼 × 6값이면 표현 가능한 조합이 1,296개인 반면 유효한 건 십여 개다. 나머지는 전부 "있어서는 안 되는 상태"이고, **v3 4단계 최종 리뷰가 잡은 Critical 버그가 정확히 그 종류였다** — `image_status='failed'` + `commit_status='idle'` 조합이 막다른 길이 되어 세션이 동결되고 취소도 409 를 받았다. 상태를 하나로 두면 그 조합이 타입 수준에서 존재하지 않는다.

워커는 `validating | drafting | publishing` 인 세션만 claim 한다. 오류는 `phase_error` 하나.

`failed` 는 연속 실패 상한에 닿은 상태이고 **취소로만 풀린다** — v3 의 사고를 되풀이하지 않도록 처음부터 취소 대상에 넣는다.

### 3.3 세션은 draft 를 소유하지 않고 잠근다 (하이브리드)

`product_master_versions` 에 **`bulk_session_id` nullable 컬럼 하나**를 더한다.

| 동작 | 세션 draft |
|---|---|
| 편집 (`PUT :versionId`, variant CoW) | **허용** — "통상의 draft 처럼 검토·수정"이 목적 |
| 개별 발행 (`PATCH :versionId/publish`) | **거부** |
| 삭제 (`DELETE :versionId`) | **거부** |
| `my-drafts` 노출 | **제외** (`bulk_session_id IS NULL` 조건 추가) |

**`my-drafts` 에서 빼는 이유**: 일괄 수정 특성상 세션 draft 가 수백 건이라, 작업자가 따로 신경 써서 편집 중이던 draft 가 묻혀 그 화면의 용도 자체가 없어진다.

**컬럼을 catalog core 쪽에 두는 이유**: 역방향(core 가 세션 아이템 테이블을 조회)으로 하면 core 가 operations 모듈에 의존하게 된다. 컬럼 한 개가 의존 방향까지 옳다.

세션 취소 시 이 값을 `NULL` 로 되돌리면 잠금이 풀린다.

### 3.4 워크북 구조

헤더는 전부 한국어, 필수 항목은 **볼드**이며 맥락을 해치지 않는 선에서 앞쪽에 온다.

| 시트 | 열 |
|---|---|
| **상품** | **상품키·상품명·판매가** / 멤버십가·상품코드·브랜드·대표이미지키·부가이미지키·상세설명·소재·시중가·공급가·상품유형·배송유형·판매분류·구매분류·연령제한·최소/최대수량·판매처·해외직구·회원전용노출·멤버십가숨김·SEO 3종·도매전용·판매시작·판매종료 |
| **옵션** | 상품키·옵션키·옵션명·옵션정렬·**옵션값키**·옵션값명·색상코드·값정렬 |
| **조합** | 상품키·조합(옵션값키 결합)·〔참고: 조합명〕·판매가·멤버십가·품목코드 |
| **카테고리** | 상품키·카테고리경로·대표여부 |
| **구매제약** | 상품키·멤버십필요·평생구매한도 |
| **이미지** | 이미지키·원본(파일ID 또는 파일명) |
| **카테고리 참조** | 읽기 전용 상수 — 파서가 아예 읽지 않는다 |

**옵션 시트가 v3 대비 크게 바뀐다.** v3 는 옵션값이 `|` 구분 단일 셀이라 값별 식별자를 달 자리가 없다. 수정 건에서 displayName·색상·정렬을 고치려면 값이 **행 단위로 펼쳐져야** 한다. 축을 반복해 적는 대신 시트를 늘리지 않는 쪽을 골랐다. 덤으로 v3 가 "등록 불가"로 적어둔 옵션값별 `colorCode`·정렬이 열린다.

**조합 참조가 이름이 아니라 키다.** v3 는 `optionCombination` 을 `"빨강/S"` 같은 텍스트로 썼는데, 옵션값 이름을 바꾸는 순간 참조가 깨진다. 옵션값키 결합(`OV-1+OV-3`)으로 바꾸고 사람이 읽을 수 있도록 옆에 읽기 전용 참고 열을 둔다.

**행 정체성.** 프리필 행의 `상품키` 는 시스템이 채우고, 그 키 ↔ `masterId` 매핑은 **양식이 아니라 잡이 갖는다**(`product_form_export_items`). 그래서 양식의 숨은 정보는 `exportId` 하나뿐이다. 업로드 시 상품키가 매핑에 있으면 **수정**, 없으면 **신규**다. 프리필 행을 복사해 새 상품을 만들려다 키가 중복되면 행 오류로 잡힌다.

**헤더 매핑.** 한국어 헤더 ↔ 내부 키 매핑표를 둔다. 헤더 **이름**으로 찾으므로 열 순서는 자유이고, 모르는 열은 무시하며(작업자가 메모 열을 추가해도 안전), 필수 열이 없으면 파일 오류다.

**카테고리 참조 시트는 상수다.** 양식 다운로드 시점의 카테고리 트리를 경로 문자열로 담고, 작업자가 수정해도 파서가 읽지 않으므로 반영되지 않는다.

**행 삭제는 변경 없음이다.** 프리필된 기존 상품 행을 작업자가 지우면 삭제가 아니라 "이 상품은 이번에 안 건드림"으로 해석한다. **임포트는 상품을 삭제하지 않는다.**

### 3.5 빈 칸의 의미 — 스냅샷 기준 3-way

프리필된 수정 행에서 빈 칸은 스냅샷과 비교해 판정한다.

```
스냅샷에 값이 있었는데 빈칸  →  명시적 비움
스냅샷도 빈칸               →  변경 없음
```

**신규 행에서는 스냅샷이 없으므로 빈칸은 그냥 미입력이다.** 이 규칙은 프리필된 수정 행에만 적용된다.

이 방식을 고른 이유는 "비움을 표현할 수 있어서"가 아니라 **"바뀌는 것만 정확히 프리뷰에 뜨기 때문"**이다. 원래 비어 있던 칸이 노이즈로 뜨지 않고, 실수로 지운 칸은 `ACME → (비움)` 으로 눈에 띈다.

### 3.6 충돌 — 정의와 병합 전략

**draft 를 스냅샷이 아니라 현재 active 에서 포크한다.**

```
draft = createDraftVersion(현재 active)   ← 최신에서 포크
      + payload 의 변경분만 얹기          ← payload 가 "전체"가 아니라 "diff"인 이유
```

§2.2 때문이다. `publishVersion` 이 통째 교체이므로, 작업자가 판매가만 고치고 그 사이 남이 브랜드만 고쳤을 때 스냅샷 기준으로 draft 를 만들면 남의 브랜드 수정이 발행 순간 사라진다.

| 상황 | 처리 |
|---|---|
| 작업자가 A필드, 남이 B필드 | **자동 병합** — 남의 B 유지 + 내 A 적용. 충돌 아님 |
| 작업자가 A필드, 남도 A필드 | **진짜 충돌** — 결정 필요 |
| 남이 아무것도 안 바꿈 | 평소대로 |

즉 **충돌 = 작업자가 바꾼 필드 ∩ 스냅샷 이후 남이 바꾼 필드**다. 이렇게 좁히면 결정 화면에 뜨는 건 정말 사람이 판단해야 하는 것만 남는다.

**결정은 행이 아니라 필드 단위다.** 한 행에서 판매가는 내 값으로, 브랜드는 남의 값으로 고를 수 있어야 한다 — 행 단위로 뭉치면 무관한 필드까지 함께 되돌아간다. 그래서 `conflict_decision` 이 jsonb 다(§3.11).

새 active 버전을 만드는 건 사람이 상품을 실제로 편집해 발행한 경우뿐이다(재고량은 inventory BC 의 SKU 에 귀속되며 판매상품 버전을 만들지 않는다). 그래서 **충돌은 드물지만 나면 전부 진짜 의미가 있고, "덮어쓰기"를 고르는 건 항상 남의 편집을 되돌리는 결정**이다 — 화면 문구가 그 무게를 반영해야 한다.

충돌 검사는 두 시점에 돈다.

- **업로드 시점** — 다운로드 기준 vs 현재 active. 행별 결정 대상
- **발행 시점** — §3.10 의 가드. draft 를 만든 뒤 발행 전까지의 창을 막는다

### 3.7 수정 가능 범위

| 대상 | 수정 | 근거 |
|---|---|---|
| 상품 스칼라 필드 전부 | **가능** | |
| 카테고리 연결, 구매제약 | **가능** | |
| 이미지 (대표·부가·본문) | **가능** | |
| 옵션/옵션값의 `displayName`·`colorCode`·`sortOrder` | **가능** | §2.4 — `optionValueId` 불변이라 매칭 안전 |
| 조합별 가격 (단순 룰인 상품만) | **가능** | §3.8 |
| **옵션값 추가·삭제, 옵션 축 추가·삭제** | **불가** | §2.4 — 매칭 파괴 또는 매칭 없는 조합 대량 발생 |
| **복합 가격규칙 상품의 가격** | **불가** | §3.8 |
| **상품 삭제** | **불가** | 행 삭제는 "변경 없음" |

옵션 구조 관련 시트 행 수·키 집합이 스냅샷과 다르면 **행 오류**다.

**옵션값 추가를 지금 막고 나중에 여는 건 additive 지만, 열어놓고 좁히는 건 못 한다.** 실제 수요가 확인되면 "매칭 없는 신규 조합 N개" 발행 시점 경고와 함께 별건으로 연다.

### 3.8 가격 — 표현 가능한 상품만 수정 허용

§2.5 의 위험 대응. 프리필 시 서버가 그 상품의 룰을 읽어 **임포트 표현 집합**(layer ∈ {base_price, membership_price} × scopeType ∈ {all_variants, variants} × operationType = override) 안인지 판정한다.

- 안이면 판매가·멤버십가 칸이 정상 채워지고 수정 가능
- 밖이면 `[복합 가격규칙]` 센티넬이 들어간다. 센티넬이 그대로면 가격 변경 없음, 고치면 **행 오류**

**판정 결과를 잡에 얼려둔다**(`export_items.pricing_editable`). 업로드 시점에 다시 판정하면 그 사이 누가 가격 룰을 바꿨을 때 양식의 센티넬과 어긋난다. 양식이 어떤 전제로 만들어졌는지는 잡이 기억해야 한다.

신규 상품은 v3 와 동일하게 `판매가` 필수다(0 또는 누락은 행 오류).

### 3.9 이미지

`Images` 시트는 `fileId`(UUID) 또는 **로컬 파일명**만 받는다. 웹 URL 은 행 오류이며 "URL 은 지원하지 않습니다"로 안내한다.

- `source_kind='file_id'` 인 행은 즉시 `resolved` — 프리필로 내려온 기존 이미지가 대부분 여기 해당한다
- `file_name` 인 것만 업로드를 기다린다

**업로드는 브라우저 → file-service 직접**이다. core 를 경유시키면 ALB 60초 천장과 NAT 를 다시 만난다. 작업자가 폴더를 끌어다 놓으면 브라우저가 파일명으로 매칭해(대소문자 무시, 앞뒤 공백 제거) `POST /files/batch-upload` 로 올리고, core 에는 `(imageKey, usage, fileId)` 만 통보한다. 매칭 안 된 파일은 무시하고 화면에 알린다.

**용도는 참조 지점에서 추론한다**(v3 계승): 대표/부가 → `product-image`, 본문 → `product-description-image`. 한 키가 양쪽에 쓰이면 컨텍스트가 달라 두 번 올라간다. 행의 단위는 `(imageKey, usage)` 이고 여러 상품이 같은 키를 같은 용도로 가리키면 `fileId` 를 공유한다.

본문 이미지는 `::product-image{imageKey="IMG-2"}` 로 쓰고 draft 생성 시점에 `fileId=` 로 치환한다 — 워크북에 UUID 가 등장하지 않는다(v3 계승).

**전량 게이트다.** 요구된 파일명이 전부 채워져야 다음으로 넘어간다. 로컬 파일은 "실패"가 아니라 "아직 안 올림"이라 사람이 바로 풀 수 있는 종류의 게이트이고, 부분 진행을 허용하면 "빠진 걸 나중에 알아채야 하는" 화면이 추가로 필요해진다. 마지막 하나가 `resolved` 되는 순간 자동으로 `drafting` 으로 전진한다.

### 3.10 draft 생성과 일괄 발행

**`drafting`** — 행 슬라이스.

- **신규**: v3 `createFromRecord` 계승 (master + draft + 옵션 + 조합 + 가격룰 + 카테고리 + 구매제약 + 이미지)
- **수정**: §3.6 의 포크-후-적용. 충돌 결정이 `skip` 인 필드는 적용하지 않는다

두 경우 모두 draft 에 `bulk_session_id` 를 심어 잠근다. `createDraftVersion` 이 `draftOwnerId` 를 업로더로 심지만 `bulk_session_id` 가 `my-drafts` 에서 걸러주므로 오염이 없고, 나중에 취소로 잠금이 풀리면 자연스럽게 본인 draft 가 된다.

**`publishing`** — 행마다 두 단계.

1. **발행 시점 가드** — `현재 active.id === draft.parentVersionId` 인지 확인. 다르면 그 행만 실패시키고 "기준이 변경되었습니다"를 남긴다. `parentVersionId` 가 이미 스키마에 있어 추가 비용이 없다
2. `publishVersion(draftId, tx, { origin: 'bulk_session', importSessionId: sessionId })`

§2.3 때문에 슬라이스를 작게 잡는다 — v3 publish 가 10이었으니 그 이하에서 시작해 실측으로 조정한다.

### 3.11 데이터 모델

```
product_form_exports              -- 양식 생성 잡
  id, requested_by, status('queued'|'running'|'completed'|'failed')
  file_id, product_count, error_message
  lease_until, lease_token, consecutive_failures
  expires_at                      -- 생성 + 30일
  INDEX (status, lease_until), INDEX (expires_at)

product_form_export_items         -- 스냅샷 기준. uuid 쌍만 담는다
  id, export_id → exports (cascade)
  master_id, version_id           -- 다운로드 시점의 active
  row_key                         -- 양식의 상품키
  pricing_editable boolean        -- §3.8 판정을 얼린다
  UNIQUE (export_id, master_id), UNIQUE (export_id, row_key)

product_bulk_sessions
  id, name, export_id(nullable — 신규 전용), uploaded_by
  file_name, source_file_id       -- 업로드된 원본 엑셀
  phase, phase_error
  lease_until, lease_token, consecutive_failures, cancel_requested_at
  total_rows
  INDEX (phase, lease_until)

product_bulk_items
  id, session_id → sessions (cascade)
  row_number, row_key, kind('create'|'update')
  master_id                       -- update: 입력 / create: 결과. kind 가 의미를 가른다
  base_version_id                 -- update 만. 스냅샷 기준
  payload jsonb                   -- 정규화된 변경분(diff)
  status('pending'|'invalid'|'drafted'|'excluded'|'failed')
  conflict jsonb                  -- 충돌 필드별 { 스냅샷, 내 값, 현재 active 값 }
  conflict_decision jsonb         -- 필드별 'overwrite' | 'skip'. 행 단위가 아니다(§3.6)
  draft_version_id
  publish_status('idle'|'pending'|'published'|'failed')
  error_message, publish_error
  UNIQUE (session_id, row_key), INDEX (session_id, status)

product_bulk_images
  id, session_id → sessions (cascade)
  image_key, usage('main'|'description')
  source_kind('file_id'|'file_name'), source_value
  file_id, status('resolved'|'awaiting_upload')
  UNIQUE (session_id, image_key, usage), INDEX (session_id, status)

product_master_versions
  + bulk_session_id uuid nullable   -- 잠금 + my-drafts 제외. INDEX
```

**설계 노트**

- **`status` 에 `invalid` 를 따로 둔다.** v3 는 검증 실패와 생성 실패를 둘 다 `'failed'` 로 적어 `invalid_count` 를 얼리고 뺄셈해야 했다(§2.8). 새 테이블에는 기존 데이터가 없으니 상태값을 나눈다 — 카운터도 뺄셈도 사라진다.
- **`payload` 에 `Date` 를 담지 않는다.** jsonb 왕복에서 문자열이 되고 drizzle `timestamp` 매퍼에 넘기면 그 행이 죽는다. ISO 문자열로만 담고 되살리는 지점을 한 곳으로 모은다(v3 3단계에서 실제로 밟은 함정).
- **진행률은 카운터가 아니라 매번 집계**한다(`items GROUP BY status, publish_status` + `images GROUP BY status`). 워커가 중단돼도 드리프트하지 않는다(v3 2단계 결론).
- **lease·claim 알고리즘은 v3 에서 그대로 가져온다** — `SKIP LOCKED` 클레임, uuid 펜싱 토큰 CAS, 행마다 `renewLease`, `returning` 에 `cancel_requested_at` 을 얹어 취소 감지, 연속 실패 상한. 컬럼 모양만 다르고 로직은 동일하다. **공통 추상화는 뽑지 않는다** — 옛 임포트가 곧 제거되므로 중복이 일시적이고, 사용자가 하나로 줄어들 추상화를 미리 만드는 셈이 된다.

### 3.12 오류·취소·정리

**오류는 3층이다.**

| 층 | 예 | 결과 |
|---|---|---|
| 파일 | 파싱 실패, 필수 시트·열 누락, 행 상한 초과 | 세션 전체 `failed`. 재업로드가 유일한 답 |
| 행 | 필수 필드 누락, 카테고리 해석 불가, 옵션 구조 변경 시도, 가격 센티넬 훼손, 상품키 중복, 생성 시 22001 | 그 행만 `invalid`/`failed`, 나머지 진행 |
| 레인 | 슬라이스 밖 탈출 예외 | `consecutive_failures` +1, 상한 10 → `phase='failed'` |

**varchar 길이 검증을 전 필드로 확장한다** — 검증기를 새로 쓰므로 v3 의 5줄짜리 미정리 건을 여기서 닫는다.

**실패 행 재시도가 두 지점에 생긴다** (v3 의 가장 큰 운영 갭).

- `drafted` 에서 "draft 생성 실패 행 재시도" → 실패 행만 `pending` 으로 되돌리고 `phase='drafting'`
- `published` 에서 "발행 실패 행 재시도" → v3 `queuePublish` 선례 그대로

**취소**는 진행 중 phase 만 `canceled` 로 바꾸고 `published` 는 덮지 않는다. **`failed` 도 취소 대상이다.** 워커는 `renewLease` 의 `returning` 으로 감지한다. 취소는 종단이며 재개하지 않는다.

취소 시 draft 의 `bulk_session_id` 를 `NULL` 로 되돌려 잠금을 푼다. **draft 자체는 남긴다** — 수천 건 세션에서 작업 결과가 통째로 날아가는 건 취소의 대가로 너무 크고, v3 의 "부분 생성된 상품은 사람이 보고 판단하는 것이 맞다"와 같은 선택이다. `my-drafts` 로 쏟아지지 않고 세션 화면에 묶여 있으며, 거기서 개별 발행·삭제가 열린다.

이미지는 시점에 따라 다르다.

- `drafting` **이전** 취소 → 아무도 참조하지 않으므로 정리한다(§2.7 — 안 지우면 S3 영구 잔존)
- `drafting` **이후** → draft 가 참조 중이므로 유지한다

**"이 세션의 draft 전량 정리"** 는 취소된 세션에서만 열리는 명시적 관리자 동작이다. 수정 건 draft 는 삭제하면 끝이고(원래 active 는 멀쩡), **신규 건은 master 까지 함께 지운다** — draft 만 지우면 유령 master 가 남는다. 세션이 올린 이미지도 같이 정리한다. 발행된 적 있는 행은 건드리지 않는다.

**양식 생성 잡은 30일 후 만료된다.** 잡 행과 엑셀 파일을 함께 정리한다.

## 4. 하지 않는 것

- **태그 임포트** — `Tags` 시트 하나를 붙이면 되는 구조라 부채가 쌓이지 않는다. 범위 밖
- **옵션값 추가·삭제, 옵션 축 변경** — §3.7
- **복합 가격규칙 상품의 가격 수정** — §3.8
- **상품 삭제** — 행 삭제는 "변경 없음"
- **카테고리 신규 생성** — 기존 트리 해석만. 임포트가 트리를 만들면 오타 하나가 유령 카테고리를 낳는다
- **URL 이미지 소싱** — v3 4단계를 제거한다
- **`descriptionHtml` 임포트** — 레거시다(v3 스펙 §2.3)
- **`shippingMethodId`·`supplierId` 임포트** — 죽은 컬럼이다(v3 스펙 §2.5)
- **`mall/bulk`(기존 일괄 작업 화면)와의 경계 정리** — 별건
- **InboxWorker 배치 claim (v2 5단계)** — 별개 이니셔티브로 남는다

## 5. 알려진 결함

### 5.1 이 스펙이 없애는 것

- **commit 실패 행 재시도 없음** → §3.12 에 두 지점 신설
- **upsert 불가** → 이 기능의 존재 이유
- **phantom masterId** → v3 의 이 결함은 commit 중 행이 롤백돼도 비-트랜잭션 Kafka 이벤트와 product-matching 행이 남는 것이었다. draft 생성은 이벤트를 내지 않으므로(발행 때만 낸다) 구조적으로 사라진다. §3.12 의 "신규 건은 master 까지 지운다"는 별개 사안 — 정리 시 draft 만 지우면 빈 master 가 남는 문제다
- **varchar 길이 검증이 일부 필드에만** → 전 필드 확장
- **판매기간을 화면에서 해제할 수 없음** → 수정 임포트가 해제 경로가 된다

### 5.2 남는 것

- **조합 variant 에 매칭이 생기지 않는다.** `_generateVariantsWithoutEvents` 가 이벤트를 내지 않아 신규 상품의 조합 variant 는 `MATCHING_MISSING` 이고 재고 게이팅을 못 받는다. 별건이며, 옵션값 추가를 금지한 덕에 *수정 경로에서는* 새로 발생하지 않는다.
- **file-service 전역 고아 파일 정리 잡이 없다.** 이 스펙은 취소·정리 경로에서만 지운다.
- **`productCode` 유니크 충돌은 발행 시점에야 확정된다.** 다른 master 와의 충돌이라 업로드 시점 검증으로 완전히 못 잡는다(세션 사이 경합). 발행 시 그 행만 실패한다.
- **취소 정리에 한 장짜리 경계가 남는다.** 정리가 도는 사이 진행 중 슬라이스가 이미지 하나를 더 올릴 수 있다(v3 와 동일).

## 6. 구현 전 확인할 전제

- **active·inactive 버전은 직접 수정되지 않는다.** §3.1 의 스냅샷을 `versionId` 만으로 보관하는 설계가 여기 기댄다. active 를 CoW 없이 UPDATE 하는 경로가 있으면 스냅샷을 값으로 복사해야 하고 잡 테이블이 커진다. **구현 착수 전 확인 필수.**
- **`ProductPublishOrigin` 에 새 값을 더할 때 이벤트 계약 소비자를 먼저 배포해야 한다.** `libs/events` 의 zod 계약은 런타임 검증되고 `forConsumerModule` 소비자(analytics·search)에서 throw 한다. enum/literal 값 추가는 소비자 선배포가 필요하다.
- **워크북 파일 크기 상한.** v3 는 10MB 였다. 수천 행 × 7시트면 초과할 수 있으므로 실측 후 조정한다.

## 7. 단계 분할

| 단계 | 내용 | 마이그레이션 |
|---|---|---|
| **1** | 양식 생성 잡 + 프리필 다운로드 (한국어 헤더·카테고리 참조 시트·가격 센티넬 판정 포함) | 테이블 2 |
| **2** | 업로드 · 검증 레인 · 프리뷰 · 충돌 해소 | 테이블 3 |
| **3** | 이미지 단계 (브라우저 직접 업로드 + 전량 게이트) | 0 |
| **4** | draft 생성 (신규 + 수정) + 잠금 | 컬럼 1 (`bulk_session_id`) |
| **5** | 일괄 발행 + 취소 + 정리 + 실패 행 재시도 | 0 |
| **6** | 옛 `product_import_*` 제거 | **contract phase — 별도 PR** |

**규모는 v3(4단계)보다 크고, 1~2단계만으로는 쓸 수 있는 게 없다.** 4단계까지 가야 처음으로 동작하는 기능이 된다.

~~1~3단계는 사용자에게 노출하지 않거나 기능 플래그 뒤에 둔다.~~ **→ 오버라이드 (2026-08-01, 사용자 결정).** 1단계는 플래그 없이 상품 목록에 "양식 다운로드" 버튼을 그대로 노출한다. 1단계 산출물은 읽기 전용 내보내기라 그 자체로는 무해하고, MD 가 2단계를 기다리지 않고 프리필 양식으로 오프라인 작업을 시작할 수 있는 편익이 더 크다는 판단이다.

**대가는 §3.1 의 전제가 실운용에서 진짜가 된다는 것이다** — 노출 시점부터 스냅샷보다 오래 사는 워크북이 실제로 유통되므로, 2단계는 "`exportId` 있는데 해석 안 됨" 을 반드시 업로드 거부로 처리해야 한다. 이건 선택이 아니라 이 오버라이드가 만든 필수 조건이다.

6단계만 파괴적이므로 앞 5단계가 실운용에 안착한 뒤 독립 PR 로 뺀다.

## 8. 검증 계획

**핵심 주장 하나를 통합 테스트로 못 박는다** — "작업자가 A필드를, 남이 B필드를 바꿨을 때 발행 후 둘 다 살아있는가." §3.6 의 포크-후-적용 설계 전체가 이 한 줄에 걸려 있다.

- **통합(실 Postgres)**: 위 병합 시나리오, lease CAS 소유권(이 레포에서 목이 초록인 채 3번 깨진 이력), 취소가 진행 중 슬라이스를 실제로 멈추는지, `payload` jsonb 왕복, 발행 시점 가드, `bulk_session_id` 가 개별 발행·삭제를 실제로 막는지
- **단위**: 한국어 헤더 매핑, 빈칸 3종 판정(§3.5), 충돌 교집합 판정, 옵션 구조 불변 검사, 가격 센티넬, 이미지 용도 추론, 진행률 단계별 분모
- **타입 게이트**: `npm run type-check:scoped`. 레포 eslint 는 전역 미게이트 debt 이므로 권위가 아니다
- **전역 jest·tsc 는 develop 에서도 red** 라 "전체 그린"으로 판정할 수 없다. 변경 파일 기준 차분으로 본다
- **수동 스모크**: 프리필 10건 + 신규 5건 + 이미지 5장짜리 워크북 1건으로 다운로드→편집→업로드→충돌 1건 해소→이미지 업로드→draft→발행 전 구간. 취소 1회와 "draft 전량 정리" 1회

## 9. 배포 선행조건

- 마이그레이션은 **전부 additive** → ADR-0005 §5 **expand phase = `migrate` → `deploy`** 순서
- 배포 순서: core 먼저 → admin-web
- **신규 시크릿 없음** — `AUTH_SECRET`·`FILE_SERVICE_URL` 이 Core live env 에 이미 있다
- `PRODUCT_IMPORT_WORKER_ENABLED` 계열의 킬스위치를 새 워커에도 둔다

---

# 부록 A — 1단계 구현이 실측한 사실 (2026-08-01)

이 부록은 1단계(양식 생성 잡 + 프리필 다운로드) 구현 중 **실제 코드를 읽어 확인한 것**만 담는다. 스펙 본문과 1단계 계획서가 확인 없이 단언했다가 틀린 것들이 여기 있고, **2~5단계가 같은 자리를 다시 밟지 않도록** 남긴다.

읽는 법: 아래 사실은 2026-08-01 시점 실측이다. 시간이 지나면 낡으므로, 다음 단계는 **자기 범위의 인터페이스를 다시 확인**하고 이 표를 출발점으로만 쓴다.

## A.1 스펙 §6 전제의 처리

**"active·inactive 버전은 CoW 없이 UPDATE 되지 않는다"** — 1단계 설계 전체가 여기 기댄다(스냅샷을 `versionId` 만으로 보관).

**확인 방식: 도메인 소유자 확인(2026-08-01).** core 판매상품 모듈이 active/inactive 불변을 유지하도록 기능을 노출하고 있다는 소유자 판단. **코드 전수 조사로 확인한 것은 아니다** — 근거의 종류를 구분해 기록해 둔다. 이 전제가 흔들리면 스냅샷을 값 복사로 바꿔야 하고 잡 테이블이 커진다.

## A.2 카탈로그 도메인

| 사실 | 근거 | 왜 중요한가 |
|---|---|---|
| `productMasterVersions.thumbnail` 은 **죽은 컬럼**이다 | 쓰기 경로 `product-masters.service.ts:906-915` 가 채우지 않는다. 실제 대표이미지는 `productImages.isPrimary=true` 행이고 `ProductReadAssembler`·`ProductMapper`·`ProjectionSnapshotAssembler` 전부 이 규약 | 이 컬럼을 대표이미지 출처로 쓰면 거의 모든 상품에서 빈칸이 된다 |
| `productCategories.path` 는 **ID materialized path** 다 | `categories.service.ts:106,401` 이 `${parentPath}/${id}` 로 쓴다 | 사람이 읽는 `조상>자식` 경로는 `getCategoryTree()` 에서 따로 만들어야 하고, 워크북의 두 시트가 같은 인덱스를 써야 매칭된다 |
| `productMasterVersions.seller` 는 **실존**한다 | `catalog.schema.ts:200` | 1단계 계획서는 없을 수 있다고 추측했다 |
| 옵션은 **정체성과 표시가 분리**돼 있다 | `product_option_values` 에 이름이 없다(`catalog.schema.ts:450`). 이름·색상·정렬은 `product_option_value_displays` 가 `(optionValueId, masterId, versionId, locale)` 로 스코프 | displayName 변경은 `optionValueId` 를 안 바꾸므로 매칭에 무해하다. 조합 참조는 반드시 ID 기반이어야 한다 |
| 매칭 인계 키는 `_comboKey(optionValueIds)` — **ID 비교** | `product-versions.service.ts` `_reconcileMatchingsAfterPublish` | 위와 같은 이유 |
| `OptionReadLoader.getOptionGroups()` 는 원래 `colorCode` 를 프로젝션하지 않았다 | 1단계에서 `OptionValueReadModel` 에 추가. 다른 소비자 2곳(`ProjectionSnapshotAssembler` 는 `{id,name}` 만 pick, `ProductReadAssembler` 는 통과)은 additive 라 안전함을 확인 | 지금은 흐른다 |
| 가격 룰 3축의 **전체 집합** | layer `base_price|membership_price|tiered_price`, scopeType `all_variants|with_option|variants`, operationType `offset|scale|override` (`catalog.schema.ts:594-596`) | 임포트가 만드는 건 진부분집합이고 DTO 가 **replace** 다 |
| 가격 계산기는 **매칭되는 룰마다** 가격을 덮어쓴다 | `pricing-calculator.service.ts:78-93`, `order` 오름차순 | `all_variants` 는 전 variant 에 매칭되므로 **뒤에 오는 all_variants 가 앞선 조합별 오버라이드를 이긴다.** 1단계 계획서가 이걸 반대로 알고 있었다 |
| `parentVersionId` 로 **발행 시점 재충돌 감지가 공짜** | 스키마에 이미 있다 | `현재 active.id === draft.parentVersionId` 확인만으로 "그 사이 남이 발행했다"를 안다 |
| `PublishVersionOptions { origin, importSessionId }` 가 이미 있다 | `product-versions.service.ts:54-57` (v2 4단계 산물) | 일괄 발행이 채널 어댑터 inbox 레인을 강등하는 데 그대로 쓴다 |
| 새 테이블은 `catalogSchema` 집합에도 넣어야 한다 | 1단계 T1 이 빠뜨렸다가 T8 에서 보강 | 안 넣으면 나중에 `relations()` 를 달아도 drizzle 이 못 보고 **조용히 무시**한다 |

## A.3 file-service 계약

| 사실 | 근거 |
|---|---|
| 업로드는 `POST /files/upload`, 멀티파트 필드 `file`·`contextId`, 응답 `{ id }` | `upload.controller.ts:31,67` |
| 다운로드 URL 은 **`GET /files/:fileId/download`** 이고 응답은 **`{ signedUrl, expiresAt }`** | `download.controller.ts:27`, `signed-url-response.dto.ts` |
| **`?download=true` 를 붙여야** `Content-Disposition` 이 붙는다 | `download.service.ts:30-33`. 안 붙이면 S3 키(UUID) 이름으로 저장된다 |
| `FileAccess.isMasterOrOwner` 는 `scopes:['master']` 에서 **단락**한다 | `file-access.ts:54-63`. core 가 발급하는 토큰은 항상 이 스코프라 **file-service 는 누가 core 를 호출했는지 전혀 강제하지 않는다** — 소유권 검사는 core 쪽에 있어야 한다 |
| 컨텍스트는 **마이그레이션이 아니라 시드**로 만들어진다 | `scripts/seeding/steps/file-service.seed-step.ts`, `db:seed:ref` (그룹 `baseline`) |
| `digital-asset-file` 외 전 컨텍스트는 `ON CONFLICT DO NOTHING` 이다 | 같은 파일 `:96-115`. **최초 시드 후 형태를 바꿔도 반영되지 않고 드리프트 감지도 안 된다** |
| file-service 는 `file_contexts` 를 **DB 에서 실시간 조회**하고 `default-file-contexts.ts` 를 import 하지 않는다 | `file-context-validator.service.ts` | 컨텍스트 추가에 file-service **재배포 의존성이 없다** — 필요한 건 시드 실행뿐 |
| 삭제는 **soft delete** 다 | `lifecycle.controller.ts:15`. S3 바이트는 남는다(§5.2 기존 부채) |

## A.4 인증·인가

| 사실 | 근거 |
|---|---|
| `@User()` 는 `{ userId: string }` 을 준다 | `libs/authorization/src/decorators/user.decorator.ts` + 기존 컨트롤러 10여 곳 |
| `userId` 는 검증된 JWT 클레임에서 온다 | `JwtAccessStrategy.validate` → `AuthenticationService.validatePayload` (`userId: payload.sub`) — 클라이언트가 넣을 수 없다 |
| **catalog 모듈에는 scope/role 데코레이터가 하나도 없다** | 전역 `JwtAuthGuard`(`app.module.ts:53`)만 걸린다. `fulfillment`·`inventory`·`warehouse` 는 `@RequireScopes` 를 쓰는 것과 대조 |
| core 의 OIDC issuer 는 **storefront 와 공유**다 | `deployments/lcnine/services/infra/services.ts:346`. core 에 `ALLOWED_AUDIENCES` 가 설정돼 있지 않다 | 즉 "이 라우트에는 관리자 토큰만 온다"는 **성립하지 않는다.** 2~5단계도 소유권 검사를 각자 넣어야 한다 |

## A.5 모듈·부트스트랩

| 사실 | 근거 |
|---|---|
| 클래스명은 `CategoriesModule` 이다 (`ProductCategoriesModule` 은 없다) | `categories/categories.module.ts` |
| `ProductsModule` 은 `ProductVersionReadLoader` 를 **export 하지 않고 있었다** | 1단계 T7 에서 추가. **타입 체크로는 절대 안 잡힌다** — Nest DI 는 런타임 reflection 이다 |
| `ScheduleModule.forRoot()` 는 `inventory.module.ts:39` 에 한 번 있고 전역 discovery 로 모든 `@Cron` 을 찾는다 | `@nestjs/schedule` 의 `getProviders()` 기반 explorer |
| `bootstrapKafkaTopics` 는 실패를 **삼킨다** | `topic-bootstrap.service.ts:56-69`. 브로커가 죽어도 앱은 뜨고, 대신 kafkajs 재시도 백오프로 ~11초 느려진다. `KAFKA_BOOTSTRAP_TOPICS=false` 로 건너뛴다 |
| `CatalogModule` 체인은 `forConsumerModule` 을 타지 않는다 | 그래서 부팅 테스트에서 컴파일해도 컨슈머 행 위험이 없다 |

## A.6 프런트엔드(admin-web)

| 사실 | 근거 |
|---|---|
| `.tsx` 는 레포 `lint`/`format` 글롭(`**/*.ts`)을 **빠져나간다** | `npx eslint <파일>` 로 직접 봐야 한다 |
| 테스트 실행은 루트에서 `npm run test:admin-web -- <경로>` 다 | `apps/admin-web` 에 jest 설정이 없어 `cd apps/admin-web && npx jest` 는 동작하지 않는다 |
| 전역 query 기본값은 `retry: 2`, `refetchOnWindowFocus: false` | `query-provider.tsx:16-17` |
| `refetchInterval` 콜백은 v5 의 `(query) => query.state.data` 형태를 쓴다 | 기존 `useImportProgress` 선례 |
| **렌더러가 없다** — `@testing-library/react`·`react-test-renderer` 미설치 | 컴포넌트 배선은 단위 테스트 불가. 순수 헬퍼로 뽑아야 테스트된다 |
| 상품 목록의 선택 id 는 **masterId** 다 | `products-list/components/table/index.tsx` 의 `getRowId: (row) => row.masterId` |

## A.7 exceljs 실측 (4.4.0)

| 동작 | 결과 |
|---|---|
| `worksheet.protect()` | async. `sheet:true` 는 write→load 왕복에서 살아남고, 하위 플래그는 떨어진다 |
| `worksheet.state = 'veryHidden'` | 왕복에서 유지된다 |
| `views` 고정 창 | 왕복에서 유지된다 |
| `header.commit()` | 비스트리밍 `Workbook` 에서는 **no-op** 이다 |
| 날짜 셀 | `cell.text` 가 로케일·TZ 의존 `Date.toString()` 이라 그대로 못 쓴다. 셀 값은 항상 규격 문자열로 굳힌다 |

## A.8 1단계가 남긴 후속 (2~5단계가 이어받는다)

- **`purgeExpired` 는 soft delete 라 S3 바이트가 남는다** — file-service 전역 고아 정리 잡이 생기면 함께 사라진다 (§5.2)
- **스냅샷 리더가 상품당 ~7 쿼리 + variant 당 1 쿼리를 단일 장기 트랜잭션에서 돈다** — 5,000건 상한에서 커넥션 하나를 오래 점유하고 vacuum 을 막는다. 큰 선택이 실제로 들어오기 전에 배치화 필요
- **`errorMessage` 가 원문 예외 텍스트다** — 관리자 화면에 그대로 렌더된다. 분류·절단 필요
- **1단계는 기능 플래그 없이 노출된다**(§7 오버라이드) — 그래서 §3.1 의 "만료 exportId 는 업로드 거부" 가 2단계의 필수 조건이다

---

# 부록 B — 3단계 구현이 실측한 사실 (2026-08-02)

3단계(이미지 단계)는 **core 백엔드만** 구현했다(사용자 결정). admin-web 은 2·3단계 화면을 나중에 한 번에 만든다.

읽는 법: 부록 A 와 같다 — 아래는 2026-08-02 시점 실측이고, 다음 단계는 자기 범위의 인터페이스를 다시 확인한 뒤 이 표를 출발점으로만 쓴다.

## B.1 file-service 계약 (부록 A.3 보강)

| 사실 | 근거 |
|---|---|
| `GET /files/:fileId/metadata` 가 `{ id, contextId, status, originalName, mimeType, size, ... }` 를 준다 | `download.controller.ts:54`, `dto/file-metadata-response.dto.ts` |
| `loadReadable` 이 `status !== 'active'` 인 파일을 **404 로 던진다** — soft-delete 된 파일도 아직 `pending` 인 파일도 `getMetadata` 에서 똑같이 `null` 로 보인다 | `apps/file-service/src/access/file-access.ts:20-24`, `download.service.ts:50` (`getMetadata` 가 `loadReadable` 을 그대로 씀) |
| 위 결과로 `checkFileMetadata` 의 `status==='deleted'` 분기는 **실무상 도달하지 않는다** — 삭제된 파일은 애초에 `meta` 자체가 `null` 이라 그 앞의 `if (!meta)` 에서 걸린다. 방어적 코드로 그대로 남겼다 | `bulk-session.images.ts:87` |
| 업로드 직후 `status:'active'` 다 — 활성화 단계도 미사용 파일 GC 도 없다 | `upload.service.ts:99,105` |
| `POST /files/batch-upload` 는 `Promise.all` 이라 **한 장 실패 = 배치 전체 reject**, 성공분은 고아로 남는다 | `upload.service.ts:127-129` |
| batch-upload 응답에 `originalName` 이 없다 — 로컬 파일과의 대응은 **배열 순서**뿐이다 | `dto/upload-response.dto.ts` |
| 컨텍스트 제약: `product-image` = jpeg/png/webp 10MB, `product-description-image` = `image/*` 20MB | `default-file-contexts.ts:161-182` |
| 두 이미지 컨텍스트 모두 `allowPublic: true, allowPrivate: false` 다 — 업로드된 상품 이미지는 **항상 공개**이고, `loadReadable` 이 `isPublic` 에서 먼저 단락하므로 메타데이터 조회는 소유자가 아니어도 통과한다. 반면 `delete` 에는 그 단락이 없어 소유권을 실제로 본다 | `default-file-contexts.ts:165-166,176-177`, `file-access.ts:25-27`(읽기 단락) vs `file-access.ts:42-52`(삭제) |

**화면 단계가 읽을 것:** 위 두 줄 때문에 프런트는 batch-upload 를 큰 묶음으로 부르면 안 된다. 작은 청크로 나누고, 응답을 **인덱스로** 로컬 파일과 짝지어야 한다. 사용자에게 보이는 "찾을 수 없습니다" 문구는 삭제된 파일과 애초에 없는 파일을 구분하지 않는데, file-service 응답 자체가 구분을 안 주므로 그게 맞는 안내다.

## B.2 스펙 §3.9 의 "브라우저 → file-service 직접"의 실제 의미

admin-web 은 `/api/proxy/file/files/upload` (Next.js 프록시)로 올린다(`lib/api/domains/files/upload.client.ts`). "직접"은 **core 를 경유하지 않는다**는 뜻이지 브라우저가 file-service 오리진을 때린다는 뜻이 아니다. 그래서 CORS·인증 경로는 이미 있는 것을 그대로 쓴다.

## B.3 이 단계가 정한 것 (스펙에 없던 결정)

| 결정 | 이유 |
|---|---|
| core 가 통보받은 fileId 를 메타데이터로 검증한다(존재·컨텍스트) | 안 하면 깨진 참조가 4단계 draft 에 굳고 발견은 발행 후다 |
| 해석 통보는 **부분 성공** — 요청당 최대 50건 | 배치 전체를 400 으로 돌리면 성공분이 재업로드돼 S3 고아가 생긴다(전역 GC 없음) |
| `awaiting_images` 동안 이미 올린 파일의 **교체 허용**, 옛 fileId 는 best-effort soft delete | 엉뚱한 파일을 올렸을 때 되돌릴 길이 그것뿐이다 |
| `sourceKind='file_id'` 행은 교체 불가 | 그건 워크북에서 키를 고칠 일이다 |
| 취소 정리를 **인라인이 아니라 @Cron 스윕**으로 | 세션당 이미지 행 상한이 1만이라 인라인 삭제가 ALB 60초를 넘긴다 |
| 스윕이 `draft_version_id` 붙은 세션을 제외 | `cancel` 이 `drafting` 이후에도 허용되므로, 4단계가 오면 스윕이 draft 가 쓰는 파일을 지우게 된다. 마이그레이션 없이 지금 막아 둔다 |
| 전량 게이트 술어를 `BulkSessionReader` 로 이관 | 승인·조회·해석 셋이 공유해야 한다. 복사본이 생기면 승인과 게이트가 서로 다른 답을 낸다 |

## B.4 동시 해석 요청의 게이트 경합 — 실측된 프로덕션 결함과 그 수정 (가장 중요)

통합 테스트를 물리적으로 분리된 **두 커넥션**으로 바꾸자 드러난 결함이다. `max:1` 단일 커넥션으로 두 "동시" 트랜잭션을 흉내 내면 postgres.js 가 내부적으로 쿼리를 직렬화해 경합 자체가 재현되지 않는다 — 이 레포에 이미 그 선례가 있다(`bulk-session-lease.integration.spec.ts:149-150` 의 `clientA`/`clientB` 물리 분리).

| 사실 | 근거 |
|---|---|
| READ COMMITTED 아래에서 동시 `resolve()` 두 개가 세션의 마지막 두 이미지를 나눠 채우면, 각 트랜잭션의 `hasPendingImageWork(trx, sessionId)` 호출이 **서로의 미커밋 UPDATE 를 보지 못해** 둘 다 "아직 이미지가 남았다"고 판정한다 → 전진 CAS 가 아무도 걸리지 않아 세션이 `awaiting_images` 에 멈춘다 | `bulk-image.manager.ts` ③ 블록(수정 전 상태), 재현 테스트 `bulk-session-image.integration.spec.ts:208`("동시 통보에서 전진 CAS 는 한 번만 이기고...") |
| `hasPendingImageWork` 를 재평가하는 호출 지점은 `approve`(2단계 승인)·`resolve`(3단계 해석) 둘뿐이라 위 상태는 **스스로 풀리지 않는다** — 세션이 `awaiting_images` 에 영구 정체하고 탈출구는 취소(작업 전량 포기)뿐이다 | `bulk-session.reader.ts`(`hasPendingImageWork` 정의), 호출부는 `bulk-session.manager.ts:334`·`bulk-image.manager.ts:183` 두 곳뿐 |
| **수정: `bulk-image.manager.ts` 의 ③ 트랜잭션 맨 앞에서 세션 행을 `SELECT ... FOR UPDATE` 로 잠가 동시 요청을 직렬화한다.** 잠그는 행이 세션 하나뿐이라 잠금 순서가 단일해 교착이 없다. 사용자 판정(2026-08-02) | `bulk-image.manager.ts:190-199`; 선례 `apps/core/src/modules/inventory/core/repositories/stock-event.store.ts:377`(dispatch attempt 잠금), `apps/core/src/modules/inventory/core/services/transfer.service.ts:128`(movement job 잠금) |
| **잠금 구간은 짧지 않다 (2026-08-02 최종 리뷰 정정).** 초판이 "③ 안에는 HTTP 왕복이 없어 잠금 구간이 짧다"고 적었는데, **HTTP 가 없다는 것만 맞고 "짧다"는 틀렸다.** 잠금을 쥔 채 (1) `hasPendingImageWork` → `loadReferencedImageRefs` 가 세션의 `status='pending'` 아이템 **payload jsonb 를 전량** Node 로 끌어오고, (2) `getProgress` 가 아이템·이미지 집계 스캔을 둘 더 돈다. 아이템 상한 1,000행 × 수 KB payload 면 매 요청 수 MB 다 | `bulk-image.manager.ts:226`(게이트 호출)·`:248`(진행률), `bulk-session.reader.ts:349-358`(`hasPendingImageWork`)·`:364-370`(`loadReferencedImageRefs` — `select({ payload })` 전량), `:154-187`(`getProgress` 집계 둘) |
| **완화 하나만 이번에 넣었다**: 취소 요청이 이미 걸린 세션은 전진 CAS 가 어차피 지므로 게이트 스캔 자체를 건너뛴다(`locked.cancelRequestedAt === null &&` 단축 평가) | `bulk-image.manager.ts:226` |

**후속(이번 범위 밖, 성능)**: `loadReferencedImageRefs` 가 payload 전량 대신 `payload->'imageRefs'` 만 select 하도록 좁힌다. 그러면 잠금 아래로 오는 바이트가 한 자릿수 배 줄어든다. 게이트 술어를 SQL 쪽 `jsonb_array_elements` 집계로 내리는 것도 선택지이지만, 그 경우 `collectReferencedImageRefs` 의 방어적 형태 검증(옛 shape 을 만나도 안 죽는다)을 SQL 로 옮겨야 해서 비용이 더 크다. 어느 쪽이든 **동작 변경이 아니라 읽는 열만 좁히는 변경**이어야 한다 — 게이트 술어가 조금이라도 달라지면 승인(`approve`)과 해석(`resolve`)이 서로 다른 답을 내기 시작한다.

**잠금은 phase 도 다시 읽는다 (2026-08-02 최종 리뷰에서 추가).** ①의 phase 검사와 ③ 사이에는 ②의 HTTP 왕복(최대 50건 × 5초)이 있어 그 창에서 phase 가 움직인다 — 이 부록 B.5 자신이 그 창을 근거로 전진 CAS 를 정당화한다. 그런데 **이미지 행 UPDATE 에는 phase 조건이 없었다.** 다른 탭이 먼저 `drafting` 으로 전진시키고 4단계 워커가 draft 를 만든 뒤 늦게 도착한 ③ 이 `fileId` 를 갈아끼우면, ④ 가 **draft 가 참조 중인 파일을 soft delete** 한다. 3단계에는 drafting 워커가 없어 도달 불가였지만 4단계에 활성화되는 지뢰였다. 수정: 잠금 select 가 `phase`·`cancelRequestedAt` 을 함께 읽고, `awaiting_images` 가 아니면 **아무것도 기록하지 않고 그 요청의 `applied` 항목을 실패로 내린다**(④ 정리도 건너뛴다). "UPDATE 만 조용히 건너뛰기"를 고르지 않은 이유는 이 응답의 계약이 "항목마다 그 파일이 기록됐는가"이기 때문이다 — 기록하지 않고 `ok:true` 를 주면 화면은 업로드 완료로 믿고 그 파일은 되돌릴 수 없는 S3 고아가 된다. 근거: `bulk-image.manager.ts:190-215`, 회귀 테스트 `bulk-image.manager.spec.ts:406-455`.

**다음 단계 경고**: 게이트를 재평가하는 새 경로(4단계 drafting 워커 등)를 추가할 때 이 잠금 규약(세션 행 `FOR UPDATE` + 잠금 후 phase 재확인)을 함께 지켜야 한다. 그리고 **통합 테스트에서 진짜 경합을 보려면 커넥션을 물리적으로 분리해야 한다** — `max:1` 단일 커넥션으로 쓴 "동시성" 테스트는 검증력이 없다(postgres.js 가 직렬화한다). `bulk-session-image.integration.spec.ts:75-81` 이 이 이유를 그대로 코멘트로 남겨 뒀다.

## B.5 전진 CAS 의 `isNull(cancelRequestedAt)` 조건 — 논리적으로는 잉여이지만 지우면 안 된다

| 사실 | 근거 |
|---|---|
| `cancel()` 이 `phase`·`cancelRequestedAt` 을 **같은 UPDATE** 로 함께 쓴다 — `cancelRequestedAt` 이 non-null 인 유일한 경로는 그 순간 `phase` 도 `'canceled'` 로 바뀌는 경로뿐이다 | `bulk-session.manager.ts:389-395` |
| 그 결과 `resolve()` 전진 CAS 의 `eq(phase,'awaiting_images')` 가 참이면, 지금 도달 가능한 상태 공간에서는 `isNull(cancelRequestedAt)` 도 항상 참이다 — **후자가 논리적으로 잉여**다 | `bulk-image.manager.ts:187-197` (CAS 정의) |
| **그런데도 지우면 안 된다.** `bulk-image.manager.spec.ts:380-391`("취소 요청이 걸린 세션은 요구가 전부 채워져도 전진하지 않는다")가 `phase='awaiting_images'` 를 유지한 채 `cancelRequestedAt` 만 픽스처로 직접 채워 두 조건을 각각 고정한다. **직접 추적 확인(2026-08-02): `isNull(cancelRequestedAt)` 을 코드에서 지우면 이 테스트가 빨개진다** — 이 픽스처 상태는 실제 `cancel()` 경로로는 도달 불가능하지만(실 DB 에서는 그 조합이 생기지 않는다), 리뷰가 정확히 이 "겉보기엔 중복" 판단을 선제적으로 막아 뒀다 | `bulk-image.manager.spec.ts:376-379`(코멘트: "어느 하나만 검사해도 기존 14건은 전부 초록이었다"), 테스트 본문 `:380-391` |
| **다음 단계 경고**: 4단계가 `phase` 를 `drafting` 너머로 옮기는 새 경로를 추가할 때, 그 경로가 "cancelRequestedAt 은 오직 `cancel()` 만 쓴다"는 지금의 불변식을 깨면(예: 취소 신청과 phase 전환을 분리하는 중간 상태를 도입하면) 이 조건이 잉여에서 **필수**로 바뀐다. 지금 지우지 않는 것이 안전한 기본값이다 | — |

## B.6 정리 스윕(`BulkImageCleaner`)이 4단계에 놓는 함정

- 스윕 대상 술어에 `notExists(draft_version_id 있는 아이템)` 이 있고, 이것이 **세션 단위 상관 서브쿼리**임을 코드로 확인했다 — `productBulkItems.sessionId = productBulkSessions.id` 로 엮여 세션 안에 draft 가 하나라도 있으면 그 세션 전체를 스윕 대상에서 뺀다(행 단위가 아니다) (`bulk-image.cleaner.ts:99-110`). `cancel` 이 `drafting` 이후에도 허용되므로, **4단계가 draft 를 만들기 시작하면 이 조건이 draft 참조 파일을 지키는 유일한 방어선**이 된다.
- 스윕 성공 시 행을 `fileId=NULL, status='awaiting_upload'` 로 되돌려 멱등성을 얻는다 — 새 컬럼 없이 진행 상태를 표현한 것이다(`bulk-image.cleaner.ts:146-154`). 이 규약을 모르고 `status` 를 다른 의미로 쓰면(예: 4단계가 `awaiting_upload` 를 "업로드 대기" 이외의 뜻으로 재사용하면) 스윕이 대상 술어(`eq(productBulkImages.sourceKind, 'file_name'), isNotNull(fileId)`)를 잘못 계산해 무한 반복하거나 멈춘다.
- 실패한 행은 `updatedAt` 만 갱신해 정렬 순서상 다음 배치 뒤로 밀린다(`bulk-image.cleaner.ts:112-115,140-142`) — 영구 실패 파일 하나가 매 틱 배치 앞머리를 차지해 뒤의 정상 행이 영영 안 지워지는 걸 막는 장치다. 이것도 4단계가 정렬 기준을 건드리면 같이 깨진다.

## B.7 3단계가 남긴 후속

- **세션 원본 워크북(`source_file_id`)은 아무도 지우지 않는다.** `productBulkSessions.sourceFileId` 는 업로드 시 쓰이고 검증 레인이 다시 내려받을 때 읽힐 뿐, 정리 경로가 없다(양식 잡에만 30일 만료가 있고 세션에는 없다). 5단계 정리 경로의 몫.
- **임의 파일 삭제 취약점 — 3단계에서 수정함 (2026-08-02 최종 리뷰).** 3단계 초판은 이미지 경로도 `scopes:['master']` 위임 토큰을 썼다. file-service 는 master 스코프에서 소유권 검사를 단락하므로(`file-access.ts:54-63`), **"공격자가 정한 임의 fileId 를 core 가 master 권한으로 지운다"** 는 프리미티브가 만들어져 있었다. 익스플로잇 체인 네 고리 전부 확인됨: (1) `bulk-session.controller.ts` 에 role/scope 가드가 없고 전역 `JwtAuthGuard` 는 서명·만료만 본다, (2) core 의 OIDC issuer 가 storefront 와 공유이고 `allowedAudiences` 미설정이라 쇼핑몰 회원 토큰도 통과한다(`jwt-access.strategy.ts:110-120` — `aud` 검증이 설정 있을 때만 돈다), (3) 피해자 `fileId` 는 `@Public()` 인 `GET /masters/:id` 응답(`dto/products/product-image.dto.ts`)에서 공개로 샌다, (4) core 의 검증은 컨텍스트·상태뿐이라(`bulk-session.images.ts:82-89`) 남의 `product-image` 가 통과한다. 그 뒤 세션을 취소하면 `BulkImageCleaner` 가 1분 내 지우고, 자기 파일로 재통보하면 ④ 가 `previousFileId` 를 즉시 지운다.
  - **수정: 이미지 경로의 위임 토큰에서만 master 스코프를 뺐다.** `FormExportFileClient` 가 토큰을 둘로 나눈다 — `masterToken`(워크북 전용: `upload`·`getDownloadUrl`·`download`·`softDelete`)과 `ownerToken`(이미지 전용: `getMetadata`·`softDeleteOwnedFile`). master 가 빠지면 `file-access.ts:55` 의 `file.uploadedBy === user.userId` 분기가 실제로 강제된다. 정상 파일은 작업자 본인이 admin-web 프록시(`/api/proxy/file/[...path]/route.ts` → `_lib/forward.ts` 가 작업자 `accessToken` 쿠키를 그대로 전달)로 올린 것이라 통과하고, 남의 파일은 403 이다. 403 은 `getMetadata` 쪽에서는 항목 실패로, 삭제 쪽에서는 best-effort catch 로 흡수된다.
  - **워크북 경로가 master 를 유지하는 이유**: 양식을 만든 사람과 그 양식으로 업로드하는 사람이 다른 것이 정상 업무이고(`bulk-session.manager.ts` 의 `assertExportUsable`), 만료 정리(`form-export.manager.ts` 의 `purgeExpired`)는 잡 소유자와 다른 맥락(크론)에서 돈다. 그 대신 워크북 경로의 fileId 는 전부 core 가 스스로 만들어 DB 에 적어 둔 값이라 임의 주입 통로가 없다.
  - **스키마·DTO·마이그레이션 0건이고 file-service 는 손대지 않았다.** 회귀 방지는 `form-export-file.client.spec.ts` 의 토큰 클레임 단정(이미지 토큰에 `master` 없음 + `userId` 있음 / 워크북 토큰에 `master` 있음)과, 이미지 스펙들의 페이크가 `softDelete` 를 **일부러 두지 않아** 되돌리면 TypeError 가 나는 장치다.
  - **남은 것 (4단계 담당자에게)**: (a) `bulk-session.controller.ts` 에 여전히 role/scope 가드가 없다 — 인증된 아무나(쇼핑몰 회원 포함) 자기 소유 세션을 만들 수 있다. 이제 남의 파일은 못 지우지만 **가드 부재 자체는 별건으로 남는다.** (b) 상품 이미지 컨텍스트가 `allowPublic` 이라 `getMetadata` 는 남의 공개 파일도 읽는다 — 즉 남의 공개 `fileId` 를 자기 세션 행에 **기록**하는 것 자체는 아직 가능하다. 그건 작업자가 워크북에 파일ID 를 직접 적는 `sourceKind='file_id'` 경로로도 원래 가능한 일이라 새 권한 상승은 아니지만, 4단계 draft 가 그 참조를 굳히므로 소유자 필드가 생기면 그때 좁힌다(`BulkFileMetadata` 에 소유자 필드가 없다 — `form-export-file.client.ts` 의 `BulkFileMetadata`).
- **스윕은 soft delete 라 S3 바이트가 남는다**(file-service 전역 고아 정리 잡 부재 — 스펙 §5.2 기존 부채).
- **`awaiting_images` 에 갇힌 세션을 푸는 길은 취소뿐이다.** 요구 파일을 못 구하면(원본 분실 등) 세션을 버리고 다시 올려야 한다. "이 이미지 참조를 포기하고 진행" 같은 탈출구는 만들지 않았다 — 스펙 §3.9 의 전량 게이트가 의도한 바다.
- **4단계 주의**: draft 생성은 `product_bulk_images.file_id` 를 읽어 `::product-image{imageKey=...}` 를 `fileId=` 로 치환해야 한다(스펙 §3.9). 프리필 그대로인 참조는 `refs` 에 담기지 않으므로(2단계 `resolveImageRefs` 독스트링) `base_snapshot.images` 가 근거다.
