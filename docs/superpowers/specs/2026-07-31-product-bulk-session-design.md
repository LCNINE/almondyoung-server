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
- **phantom masterId** → **부분 해소다. 아래 정정을 먼저 읽어라.** §3.12 의 "신규 건은 master 까지 지운다"는 별개 사안 — 정리 시 draft 만 지우면 빈 master 가 남는 문제다

> **정정 (2026-08-03, 4단계 최종 리뷰).** 이 자리의 원문은 *"draft 생성은 이벤트를 내지 않으므로(발행 때만 낸다) 구조적으로 사라진다"* 였다. **그 단언은 거짓이다** — 4단계 최종 리뷰가 코드로 확인했다.
>
> **실제로 무엇이 남는가.** `createMaster` 는 트랜잭션 안에서 master·버전·기본 variant·매핑을 쓴 뒤 마지막에 `publishVariantCreatedEvent` 를 부른다(`apps/core/src/modules/catalog/core/products/services/product-masters.service.ts:228`). 그 함수는 트랜잭션 밖으로 새는 부수효과 **둘**을 낸다:
>
> 1. **비-트랜잭션 Kafka 이벤트.** `this.productPublisher.publishEvent({ eventType: 'ProductVariantCreated', … })`(`product-masters.service.ts:136`) → `StreamPublisher.publishEvent` → `sendMessage` 가 `kafkaClient.emit` 으로 **브로커에 곧장 보낸다**(`libs/events/src/publishers/stream-publisher.service.ts:209-228`). 아웃박스가 아니다 — 같은 클래스가 `outboxPublisher` 도 주입받고 있지만 이 경로는 그걸 쓰지 않는다. 발행 실패도 `catch` 로 삼켜 트랜잭션은 커밋된다(`:159-162`).
> 2. **별도 커넥션의 `product_matchings` 행.** 이어서 `productMatchingService.handleVariantCreated(...)` 를 **`tx` 없이** 부른다(`product-masters.service.ts:167`). 그 안의 `handleManualMatchingRequest` 는 `this.dbService.run(async (trx) => …)`(`apps/core/src/modules/product-matching/services/product-matching.service.ts:272`)로 **자기 트랜잭션을 새로 열어** insert 한다(`:297`) — 호출자의 트랜잭션과 무관하게 독립 커밋된다. 주입은 `@Optional()`(`product-masters.service.ts:119-121`) 이지만 `ProductsModule` 이 `ProductMatchingModule` 을 임포트하고(`products.module.ts:22`) 그 모듈이 `ProductMatchingService` 를 export 하므로(`product-matching.module.ts:25`) **프로덕션에서는 항상 non-null 이다.**
>
> 즉 **`createMaster` 이후에 실패해 롤백된 신규 행마다, 존재하지 않는 masterId·variantId 를 가리키는 Kafka 이벤트 하나와 `product_matchings` 행 하나가 남는다.** v3 가 남긴 것과 정확히 같은 모양이다.
>
> **이 브랜치의 회귀가 아니다.** `createMaster` 의 이 동작은 v1·v3 와 공유하는 **기존** 경로이고 4단계가 건드리지 않았다. 4단계가 실제로 없앤 것은 *다른* 축이다 — "한 행 = 한 트랜잭션"(부록 C.6.3)이 **부분 커밋으로 인한 고아 master 행**을 없앴다. 하지만 그것이 위 두 부수효과를 없애지는 못한다.
>
> **5단계가 알아야 할 것.** (a) 부록 C 의 안전 논증은 이 정정 뒤에도 성립하지만, 그 범위는 "DB 안의 고아 행"까지이지 "Kafka·product-matching 까지"가 아니다. (b) 5단계가 신규 행 재시도(§3.12)를 만들 때, 같은 행을 다시 처리하면 `createMaster` 가 **또** 이벤트와 매칭 행을 낸다 — 재시도 횟수만큼 누적된다. (c) 근본 수정은 `publishVariantCreatedEvent` 를 아웃박스로 옮기고 `handleVariantCreated` 에 `tx` 를 전파하는 것이며, 이는 catalog core 전체에 걸리는 **별건**이다(v1 스펙 후속 트래킹 1번, 사용자 결정: 현상 유지).
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
| **5** | 일괄 발행 + 정리 + 실패 행 재시도 (취소는 3·4단계가 이미 만들었다) | 컬럼 1 (`source_file_id` nullable — §10.6) |
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

## 10. 5단계 착수 전 확정 사항 (2026-08-03, 사용자 결정)

5단계(일괄 발행 + 취소 + 정리 + 실패 행 재시도)를 계획하며 정한 것들이다. **본문과 어긋나는 것이 셋 있고 이 절이 우선한다** — §3.10 의 `origin` 값, §7 의 "마이그레이션 0건", 그리고 잠금 우회 방식이다.

### 10.1 범위

**core 백엔드만.** 2·3·4단계와 같은 선택이다. admin-web 의 2~5단계 화면은 별도 "화면 단계"로 빠지며, 6단계(옛 `product_import_*` 제거)와도 독립이다.

취소는 이 단계의 신규 항목이 아니다 — `BulkSessionManager.cancel` 과 `BulkImageCleaner` 스윕이 3·4단계에서 이미 만들어졌다. 5단계가 하는 일은 **발행 레인 · 재시도 2지점 · `excluded` · 정리 두 종류**다.

### 10.2 `origin` 은 `bulk_import` 를 재사용한다 (§3.10 정정)

§3.10 은 `origin: 'bulk_session'` 을 적었지만 그러려면 `packages/event-contracts/streams/product.stream.ts:381` 의 `z.literal('bulk_import')` 를 enum 으로 넓혀야 하고, **런타임 zod 검증이 도는 소비자(analytics·search)의 선배포가 필수 조건이 된다**(§6 세 번째 전제). 세션 발행도 "한 번에 수백~수천 건"이라는 강등 판정 기준에는 동일하게 해당하고, 관측이 필요하면 `importSessionId` 가 세션 id 를 싣는다.

따라서 **이벤트 계약 변경 0건**이고 `channel-adapter` 의 `BULK_ORIGINS` 도 그대로다. 6단계가 옛 임포트를 지우고 나면 이 값은 유일한 bulk 경로를 가리키게 된다.

### 10.3 발행 경로는 플래그가 아니라 잠금 선해제로 4단계 가드를 통과한다

4단계가 `publishVersion` 에 "`bulkSessionId` 가 있으면 409"를 넣었으므로(`product-versions.service.ts:274`) 세션의 일괄 발행이 그것을 통과할 방법이 필요하다. **`PublishVersionOptions` 에 우회 플래그를 더하지 않는다.** 대신 발행 트랜잭션 안에서 `bulk_session_id = NULL` 을 **먼저 쓰고** `publishVersion` 을 부른다.

이유 둘:

- 플래그는 "잠긴 draft 를 발행할 수 있는 경로"를 코드에 영구히 남긴다. 4단계가 막으려던 것이 다른 호출부에서 다시 열린다.
- 플래그로 통과시키면 **active 가 된 버전에 `bulk_session_id` 가 그대로 남는다.** 그 값은 나중에 그 버전으로 롤백 발행(`publishVersion` 은 `inactive` 도 받는다)할 때 같은 가드에 막힌다. 세션은 이미 끝났는데도 그렇다.

같은 트랜잭션이므로 발행 실패 시 잠금 해제도 함께 롤백돼 재시도 시 draft 는 여전히 세션 소유다.

### 10.4 발행 레인의 행 단위 규약

행 하나 = 트랜잭션 하나이고 순서가 계약이다.

1. **세션 행 `SELECT … FOR UPDATE` + `cancel_requested_at` 재확인.** 취소가 걸려 있으면 아무것도 쓰지 않고 건너뛴다(실패로도 적지 않는다). 부록 B.4·C.11 이 다음 단계에 요구한 규약이며, 없으면 "취소했는데 상품이 발행됨"이 그대로 재현된다
2. **발행 시점 가드** — `현재 active.id === draft.parentVersionId`. 다르면 그 행만 실패시키고 "기준이 변경되었습니다"를 남긴다(§3.10). 신규 행은 active 도 `parentVersionId` 도 없어 자연히 통과한다
3. `bulk_session_id = NULL` (§10.3)
4. `publishVersion(draftId, trx, { origin: 'bulk_import', importSessionId: sessionId })`
5. `publish_status = 'published'`

**멱등**: 대상 버전이 이미 `active` 면 발행하지 않고 완료로만 마감한다(v3 선례).

**슬라이스는 5에서 시작**(`PRODUCT_BULK_PUBLISH_SLICE`). §2.3 의 목록이 행마다 붙어 draft 생성(10)보다 무겁다.

**claim 확장은 세 곳이다** — claim SQL 의 `phase IN (...)`, `CLAIMABLE_PHASES`, `recordJobError` 의 WHERE. 한 곳만 고치면 레인 예외가 연속 실패를 못 세어 세션이 굳는다.

**실패 행이 남아도 `phase='published'` 로 마감한다.** 세션 차원의 일은 끝났고 남은 것은 그 행들의 재시도·제외다.

### 10.5 라우트 넷

| 라우트 | 허용 phase | 대상 | 결과 |
|---|---|---|---|
| `POST :id/publish` | `drafted`·`published` | `status='drafted'` ∧ `publish_status IN ('idle','failed')` | → `publishing`. 최초 발행과 실패 행 재발행을 겸한다(v3 `queuePublish` 선례) |
| `POST :id/retry-draft` | `drafted` | `status='failed'` | `pending` 으로 되돌리고 → `drafting` |
| `POST :id/items/:itemId/exclude` | `drafted`·`published` | `status IN ('drafted','failed')` | `status='excluded'` + 그 draft 의 `bulk_session_id=NULL` |
| `POST :id/purge-drafts` | `canceled` 뿐 | 발행된 적 없고 제외(`excluded`)되지 않은 행 | 한 요청당 최대 100행, `{ purged, remaining }` 응답 |

**제외는 되돌릴 수 없다.** 재포함을 만들려면 "푼 사이에 개별 발행됐거나 삭제된 draft" 를 전부 다뤄야 해서 값이 비싸다. 풀린 draft 는 `my-drafts` 에 다시 나타나므로 개별 처리로 잃는 것이 없다.

**신규 행 재시도에는 대가가 있다.** `createMaster` 가 트랜잭션 밖으로 내는 부수효과 둘(Kafka 직송 이벤트 + `product_matchings` 행 — §5.1 정정)은 롤백돼도 남으므로 **재시도 횟수만큼 누적된다.** 근본 수정은 catalog core 전체에 걸리는 별건이고, API 설명과 화면 문구가 "무한정 누를 것이 아니다"를 반영해야 한다.

**`purge-drafts` 가 한 번에 안 끝나는 이유**: 취소 세션이 수천 행이면 삭제도 수천 번이라 ALB 60초를 넘는다. 100행씩 멱등하게 처리하고 화면이 `remaining === 0` **또는 `purged === 0`**(진전이 없으면 멈춘다 — 최종 리뷰가 정정: `remaining` 만으로는 영구 실패 행 앞에서 종료가 보장되지 않는다, D.5)까지 반복 호출한다 — 새 상태 컬럼 없이 진행을 표현하는 방법이다(3단계 이미지 스윕의 `fileId=NULL` 되돌리기와 같은 계열).

정리 규칙은 §3.12 그대로다. 수정 행은 draft 만, 신규 행은 master 까지, **발행된 적 있는 행은 미접촉.** 처리한 행의 `draft_version_id` 를 비우면 부록 B.6 의 스윕 제외 조건(`notExists(draft_version_id)`)이 저절로 풀려 **이미지 정리가 새 코드 없이 이어서 돈다.**

### 10.6 워크북 만료 — 마이그레이션 1건이 생긴다 (§7 정정)

부록 B.7 이 남긴 "세션 원본 워크북(`source_file_id`)을 아무도 지우지 않는다"를 닫는다. 종단(`published`·`canceled`) 세션의 엑셀을 30일 뒤 soft delete 하는 @Cron 을 둔다(하루 1회, 틱당 200건, 킬스위치는 기존 `PRODUCT_BULK_SESSION_WORKER_ENABLED` 재사용).

**`source_file_id` 를 nullable 로 푸는 마이그레이션 1건이 필요하다.** "이미 지웠다"를 표시할 자리가 그것뿐이고(스윕의 멱등성이 여기 걸린다), 지금은 NOT NULL 이다. NOT NULL 제거는 additive 라 **expand phase = `migrate` → `deploy`** 순서다. §7 표의 "5단계 마이그레이션 0" 은 이 결정으로 1이 된다.

옛 코드가 NULL 을 만나는 창은 없다 — 그 값을 읽는 곳은 검증 레인의 재다운로드뿐이고 종단 세션은 거기 오지 않는다.

### 10.7 함께 닫는 갭 4건 (C.9·A.8·B.7 에서 선택)

- **컨트롤러 역할 가드** — `BulkSessionController` 와 `FormExportController` **둘 다** 에 `RolesGuard('master','admin')`(`libs/authorization/src/guards/master-role.guard.ts`, 고객센터 컨트롤러 선례). 한쪽만 걸면 우회로가 남는다. ⚠️ **배포 사고 위험**: 이 가드는 토큰의 `roles` 클레임을 본다. 1단계 "양식 다운로드"는 이미 라이브라, 실제 MD 계정에 `admin`·`master` 가 없으면 켜는 순간 403 이다. 시드 롤은 `master`·`admin`·`membership`·`user`·`logistics_worker`·`logistics_manager` 여섯(`scripts/seeding/steps/user-service.seed-step.ts:94-108`) — **라이브 DB 실측이 배포 선행조건이다**
- **신규 행 "같은 조합 두 번"**(§C.4 d) — `checkCreateStructure` 가 `bundle.variants` 원본 배열을 함께 받도록 시그니처를 넓힌다. 지금은 평면화가 뒤 값으로 덮어써 오류도 없이 하나만 살아남는다
- **`errorMessage` 분류**(부록 A.8) — 예외 원문이 관리자 화면에 그대로 뜬다. 발행 실패는 종류가 유한하다(22001 길이 초과 · `productCode` 중복 · `variantCode` 중복 · 가격 검증 · 기준 변경). 한국어 문장으로 옮기는 분류기 하나를 두고 원문은 로그로만 남긴다
- **`variantCode` 전역 중복 사전검사**(§C.9) — v3 `ProductImportVariantCodeChecker` 를 2단계 검증 레인으로 이식한다. 지금은 전량 발행 뒤에야 그 행들이 죽는다

닫지 않고 남기는 것: 수정 행의 카테고리 전체 해제(§C.9 — 워크북 규약이 만든 구조적 한계), `loadReferencedImageRefs` 의 payload 전량 select(부록 B.4 후속), 스냅샷 리더 배치화(A.8), `createMaster` 의 트랜잭션 밖 부수효과(§5.1 정정 — catalog core 별건).

### 10.8 검증과 배포

실 Postgres 통합 6건이 이 단계의 회귀 잠금이다: ① 발행 시점 가드가 그 행만 실패시키는가 ② 취소 커밋 뒤 시작된 행이 발행되지 않는가(**커넥션 물리 분리 필수** — 부록 B.4) ③ 발행 성공한 버전의 세션 표식이 비워져 롤백 발행이 되는가 ④ 제외가 잠금을 실제로 푸는가 ⑤ 재시도가 이미 발행된 행을 두 번 발행하지 않는가 ⑥ 정리가 신규는 master 까지·수정은 draft 만·발행된 행은 미접촉인가.

부록 C.7 의 경고도 지킨다 — 새 정적 임포트가 통합 스위트를 부팅 단계에서 죽일 수 있으므로 **DB 를 붙여 한 번은 반드시 돌린다.**

배포: 마이그레이션 1건(§10.6, `migrate` → `deploy`) · 이벤트 계약 변경 0건(§10.2) · 새 시크릿 없음 · 새 env 는 `PRODUCT_BULK_PUBLISH_SLICE` 하나(선택, 기본 5) · **MD 계정 roles 실측**(§10.7) · 2·3·4단계의 미수행 수동 스모크가 여기 누적되므로 5단계 것과 합친 목록으로 정리한다.

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

---

# 부록 C — 4단계 구현이 실측한 사실 (2026-08-03)

4단계(draft 생성 — 신규 + 수정 — + 잠금)는 **core 백엔드만** 구현했다(F1, 사용자 결정). admin-web 은 2~4단계 화면을 5단계 이후 한 번에 만든다.

읽는 법: 부록 A·B 와 같다 — 아래는 2026-08-03 시점 실측이고, 5단계는 자기 범위의 인터페이스를 다시 확인한 뒤 이 표를 출발점으로만 쓴다. 계획서의 F1~F13(§"착수 전 확정된 사실")은 구현 착수 전 코드를 읽어 세운 예상이었다 — 이 부록은 그중 구현·리뷰·통합 테스트로 실제로 검증되거나 정정된 것만 추린다.

## C.1 F4 — 옵션 표시명 truthiness 는 계획대로 "행 오류로 거부"가 됐다

| 사실 | 근거 |
|---|---|
| `_applyOptionDiff` 는 여전히 truthiness 다 — `modify.displayName`(1603행), `valueModify.displayName`(1624행)이 빈 문자열을 falsy 로 거른다. `colorCode`는 `!== undefined`(1625행)라 반대로 빈 값이 실제로 써진다 | `product-masters.service.ts:1603,1624,1625` (Task 2 가 이 파일에 가드 2줄을 더하며 원래 1598/1619/1620 이던 줄번호가 밀렸다) |
| core 의 공용 쓰기 경로는 **고치지 않았다** — 계획대로 4단계 쪽에서 빈칸을 행 오류로 막는다 | `bulk-draft.options.ts` `buildOptionModify`: 그룹 표시명·값 표시명이 빈 문자열이면 오류를 밀고 그 항목을 `modify` 배열에 담지 않는다(`bulk-draft.options.spec.ts` "옵션명을 비우면 행 오류다"·"옵션값명을 비워도 행 오류다") |
| `colorCode` 는 반대로 **명시적 `null`** 을 담아 실제로 지워지게 한다 | `bulk-draft.options.ts` — F4 가 예상한 그대로. 정적 타입이 이를 막고 있었던 것은 별개 발견(C.1.1) |

### C.1.1 부수 발견 — `ModifyOptionDisplayDto.colorCode` 의 정적 타입이 런타임 요구와 어긋나 있었다

계획에 없던 타입 결함이다. `catalog.types.ts` 의 `ModifyOptionDisplayDto.values[].colorCode` 는 원래 `string | undefined` 로만 선언돼 있어, F4 가 요구하는 "빈칸 → 명시적 `null`" 을 대입하면 `TS2322`(`Type 'null' is not assignable to type 'string | undefined'`)가 났다. Task 4 는 "파일 2개만 만든다"는 자기 태스크 범위 제약과 "`any`/`as` 캐스팅 0건" 제약이 충돌한다고 보고했고, 코디네이터가 `colorCode?: string | null` 로 넓히는 것을 **파일 범위의 승인된 예외**로 승인했다. `grep -rn "ModifyOptionDisplayDto"` 로 다른 소비처를 확인했고, 유일한 실제 소비처(`_applyOptionDiff`)가 이미 `!== undefined` 로 `null` 을 처리하고 있어 widen 은 기존 동작과 완전히 일치했다(`catalog.types.ts:147` 근처).

**5단계 경고**: 이런 "타입이 런타임 요구를 못 따라간" 자리가 이 도메인에 더 있을 수 있다 — `undefined`(안 건드림)와 `null`(지움)을 구분해야 하는 다른 `Modify*Dto` 필드를 다룰 때는 타입 선언을 먼저 확인한다.

## C.2 F6 — variant CoW 는 계획대로 강제됐고, "가격은 CoW 뒤" 순서는 통합 테스트가 실제로 지킨다

| 사실 | 근거 |
|---|---|
| 수정 경로는 `applyVariantCodes` 가 내부적으로 `bulkUpdateVariantsInDraft` 를 호출한다 — v3 의 직접 UPDATE 경로는 재사용하지 않았다 | `bulk-draft.applier.ts` `applyUpdate` ④ 단계 |
| 신규 경로도 **같은 함수**(`applyVariantCodes`)를 공유한다 — 갓 만든 master 라 CoW 판정("다른 버전에도 매핑됐는가")이 단독 매핑에서 자연히 in-place UPDATE 로 떨어지므로, 경로를 둘로 나누지 않았다 | `bulk-draft.applier.ts:191-193` 주석: "두 경로를 나누면 나중에 한쪽만 고쳐진다" |
| **가격 룰 조립은 CoW *뒤*, 반환된(CoW 된) variantId 로 한다** — `applyUpdate` 의 단계 순서 ④(`applyVariantCodes`) → ⑤(가격) 가 코드 순서 그대로 실행 순서다 | `bulk-draft.applier.ts:126-154` |
| 이 순서가 결과를 실제로 바꾼다는 것을 **두 층에서 직접 실험으로 확인했다** | 단위: Task 7 이 가격 읽기를 ④ 앞으로 재배치한 임시 빌드로 돌려 `CoW 로 바뀐 variantId 로 가격 룰을 만든다` 케이스가 FAIL 함을 확인(`v-new` 단정이 깨짐) 후 원복. 통합: Task 11 의 케이스 5(`수정 행의 variantCode 변경이 active variant 를 건드리지 않는다`)가 실 Postgres 에서 `activeVariant.variantCode === 'OLD'` + `draft 쪽은 다른 variantId 로 'NEW'` 두 축을 동시에 단정 |
| **순서가 이렇게 된 이유는 프로덕션 side-effect 다** — `bulkUpdateVariantsInDraft` 내부의 `_cascadeVariantCoWToPricingRules`(`product-variants.service.ts:503`)가 **같은 트랜잭션 안에서** draft 의 기존 가격룰 매핑을 `v-old`→`v-new` 로 이미 리포인트해 둔다. 그래서 CoW 뒤에 `getVersionRules` 를 부르면 리포인트된 결과가 보인다 — 순서를 지키지 않으면 룰이 이미 사라진 `v-old` 를 가리켜 가격 변경이 유령 variant 에 적용된다 | Task 7 fix round 1, §7-2 |

**5단계 경고 (계획서가 이미 명시)**: 발행이 variant 를 다시 만지는 지점(`_reconcileMatchingsAfterPublish` 등)에서 같은 종류의 "CoW가 트랜잭션 내에서 참조를 바꾼 뒤에야 다음 단계가 정답을 본다" 규약을 다시 만난다. 정적 스텁으로 CoW 의 트랜잭션 내 side-effect 를 흉내 내려 하면 Task 7 이 처음 겪은 것과 같은 함정(§C.2 표 마지막 줄 — "현재(올바른) 순서에서도 정적 스텁으로는 테스트가 깨진다")에 걸린다. **상태 기반 페이크**(호출 여부로 분기하는 페이크)가 필요하다.

## C.3 F7 — 신규 행 조합키는 이름으로만 이어지고, 표시명 중복은 그래서 행 오류다

| 사실 | 근거 |
|---|---|
| `resolveCreatedCombos` 가 F7 의 4단계를 그대로 구현한다: `getOptionGroups` 로 (그룹명, 값명)→실제 id 맵 → 워크북 조합키를 `plan.valueNameByKey` 로 이름 조회 → id 로 치환해 정렬 조인 → `productMasterVariants` 의 각 variant 를 `getVariantOptionValues` 로 같은 방식의 id 키로 만들어 매칭 | `bulk-draft.applier.ts:214-231`(독스트링) + `:232-` |
| 이름 쌍의 결합 키는 **NUL 문자**(` `)로 만든다 — 단순 공백 결합이면 그룹 "A B"+값 "C" 와 그룹 "A"+값 "B C" 가 충돌한다 | `bulk-draft.applier.ts` `namePairKey` (Task 6 §1-3 — 공백 결합이던 최초 구현을 자체적으로 교정) |
| `combo === ''`(옵션 없는 상품)은 이름 조회를 건너뛰고 곧장 id 키 `''` 로 취급한다 — `getVariantOptionValues` 가 옵션 없는 variant 에 빈 배열을 돌려주므로 실제 쪽도 자연히 `''` 로 떨어져 F3 계약이 지켜진다 | `bulk-draft.applier.ts:223-226` |
| **표시명 중복 금지의 이유가 F7 그 자체다** — 이름으로만 짝짓는 한, 같은 그룹 안에서 값 표시명이 겹치면 어느 옵션값에 매칭할지 원리적으로 모호해진다. 그래서 `checkCreateStructure` 가 (a) 같은 그룹 안 값 표시명 중복을 신규 행 구조 검증에서 행 오류로 막는다(§C.4) | `bulk-draft.options.ts` `checkCreateStructure`, `bulk-draft.options.spec.ts` "한 그룹 안에서 값 표시명이 겹치면 오류다" |
| 수정 행은 이 문제가 없다 — 조합키가 이미 워크북 스냅샷 단계에서 실제 optionValueId 를 정렬 조인한 값이라(F3), `resolveExistingCombos` 는 이름 변환 없이 곧바로 `productMasterVariants` 조회 + 매칭만 한다 | `bulk-draft.applier.ts:340-347`(독스트링) — "`resolveCreatedCombos` 와 달리 이름→id 변환이 필요 없다" |

## C.4 F8 — 신규 행 구조 검증 갭을 4단계가 닫았다 (부분적으로)

계획서가 지목한 넷 중 **셋**을 `checkCreateStructure` 가 실제로 막는다: (a) 같은 그룹 안 값 표시명 중복, (b) 같은 옵션값키가 두 그룹에 걸침, (c) `조합` 이 옵션 시트에 없는 옵션값키를 가리킴. **넷째(같은 조합이 두 행)는 이 계층에서 검출 불가능하다는 것이 밝혀졌다** — 계획이 예상한 그대로 4단계가 다 메우지는 못했다.

| 사실 | 근거 |
|---|---|
| `checkCreateStructure(fields, optionRows)` 는 (a)(b)(c) 를 실제 워크북 옵션 행(`optionRows`)에서 그룹 귀속을 읽어(§C.6.1) 검사한다 | `bulk-draft.options.ts`, `bulk-draft.options.spec.ts` |
| (d) "같은 조합 두 번"은 함수 시그니처(`FlatFields` 를 받는 순수 함수) 로는 구조적으로 볼 수 없다 — `flattenBundle` 이 `variant:<조합>.<열>` 을 평면 맵의 키로 쓰므로, 같은 조합 문자열을 쓴 원본 행이 두 개 있어도 평면화 단계에서 **뒤 값이 앞 값을 덮어써 "몇 번 나왔는지" 정보 자체가 사라진다** | Task 4 §3.3, `bulk-session.fields.ts:64`(`flattenBundle` 의 덮어쓰기 지점), `bulk-draft.options.ts` 독스트링 — "**(a)(b)(c) 만 검사한다**", (d) 는 **의도적으로 구현하지 않았다** |
| 이 갭은 **행 오류로도 못 잡고 조용히 뒤 값이 이긴다** — 별건이 아니라 이 계층의 구조적 한계로, 5단계 이전에 닫으려면 `checkCreateStructure` 를 `FlatFields` 가 아니라 `bundle.variants`(평면화 이전 원본 배열)를 받는 시그니처로 바꿔야 한다 | 계획서 §"착수 전 확정된 사실" F8, Task 4 §3.3, progress.md "Task 4: minor (deferred)" |

## C.5 F9 — 가격은 재조립이고, `pricingEditable=false` 는 물론 "가격 칸 무터치"도 replace 를 막는다

F9 는 계획서가 `pricingEditable=false` 조건 하나만 명시했다. 구현·리뷰 과정에서 **두 번째 조건이 필수임이 드러나 계획서 자체가 수정됐다** — 이건 4단계가 새로 발견한 사실이다.

| 사실 | 근거 |
|---|---|
| `toReplaceDto(prices)` 는 `basePrice === null` 이면 **항상** `BadRequestError` 를 던진다 — `pricingRulesSetSchema` 의 "order 1 첫 base_price 룰은 all_variants" 제약을 어기는 DTO 를 안 만들려는 방어다 | `bulk-draft.pricing.ts` `toReplaceDto`, Task 5 리뷰 "toReplaceDto 는 basePrice=null 이면 항상 throw 한다(리뷰가 스키마로 확인)" |
| **따라서 가격 칸을 하나도 안 건드린 수정 행이 `replaceVersionRules` 를 부르면, 룰에 판매가 override 가 없는 상품(예: 조합별 override 만 있고 all_variants 판매가가 없는 상품)에서 그 행이 실패한다** — 브랜드만 고친 행이 가격 때문에 죽는 사고. 이 사실이 드러난 뒤 계획서 Task 7 에 `touchesPrice` 가드가 **추가됐다**(원래 계획서엔 없었다) | Task 5 리뷰 "⚠️ 해소(컨트롤러 판정)", progress.md "Task 5: ⚠️ 해소" |
| 최종 게이트는 **두 조건의 논리곱**이다: `input.baseSnapshot.pricingEditable !== false && touchesPrice` — 어느 한쪽만 있어도 `replaceVersionRules` 를 부르지 않는다. `touchesPrice` 는 `product.basePrice`·`product.membershipPrice`·`variant:*.basePrice`·`variant:*.membershipPrice` 중 하나라도 `fields` 에 있는지로 판정한다 | `bulk-draft.applier.ts:141-147` |
| 손대지 않을 때는 `_copyMappings` 가 포크 시점에 복사해 둔 기존 룰 매핑이 그대로 draft 에 남는다 — 계획서 F9 의 마지막 문장이 예상한 그대로 | `bulk-draft.applier.ts:135-140`(주석) |
| 신규 행은 이 가드가 없다 — 현재 룰이 원래 없으므로(빈 `SimplePrices` 에서 시작) 매번 `replaceVersionRules` 를 부른다. 판매가는 신규 상품에서 여전히 필수라(스펙 §3.8) `toReplaceDto` 의 throw 조건에 걸릴 일이 없다 | `bulk-draft.applier.ts:196-203`(`applyCreate` ⑥) |

## C.6 구현 중 리뷰가 잡은 계획서 결함 셋

계획서 자체에 있던 설계 구멍이다 — 아래 셋 다 "구현자의 이탈"이 아니라 **계획서가 틀렸거나 불완전했던 자리**였고, 코디네이터가 그렇게 판정했다(progress.md).

### C.6.1 옵션 그룹 귀속을 `fields` 키 삽입 순서로 추론하면 그룹이 번갈아 나올 때 값이 샌다 (Task 4, Critical)

계획서 초판은 "`fields` 의 키 삽입 순서로 마지막 그룹에 값을 붙인다"고 적었다. JS 객체는 **이미 있는 키를 재대입해도 삽입 위치가 움직이지 않는다** — 그래서 옵션 시트 행이 (색상,빨강)→(사이즈,S)→(색상,파랑) 순서면, `optionValue:C2`(파랑) 를 만나는 시점의 "마지막으로 본 그룹"이 `S` 로 관측돼 **파랑이 사이즈 그룹으로 샌다.** 신규 상품은 빈 템플릿에 사람이 직접 적으므로 행 순서를 강제할 수단이 없어 "색상 하나, 사이즈 하나, 색상 하나 더" 같은 흔한 편집으로 트리거된다.

재현: 컨트롤러가 node 로 직접 확인한 삽입 순서 `{"C":["C1"],"S":["S1","C2","S2"]}`.

수정: **계획서 자체를 고쳤다.** `buildOptionAdd`/`checkCreateStructure` 가 `optionRows: PrefillRow[]`(업로드 원본의 옵션 시트 행 — `optionKey`·`optionValueKey` 를 함께 담고 있어 추론이 필요 없다) 를 추가 인자로 받아, 그룹 귀속·그룹 순서·값 순서는 **전부 `optionRows` 에서** 읽고 표시값(표시명·색상·정렬)만 계속 `fields` 에서 읽는 2단계 구조로 재작성했다. `DraftInput.optionRows` 필드가 이 수정으로 새로 생겼고 Task 6·7·8 호출부 전부 이를 반영한다.

회귀 테스트: `flattenBundle` 을 실제로 호출해 그룹이 번갈아 나오는 4행 시트를 재현하고 `plan.add`·`plan.valueNameByKey` 양쪽이 제 그룹에 붙는지 단정한다(`bulk-draft.options.spec.ts` "그룹이 번갈아 나오는 옵션 시트에서도 값이 제 그룹에 붙는다").

### C.6.2 수정 행의 구매제약을 두 축 한 덩어리로 읽으면 안 건드린 축이 조용히 해제·삭제된다 (Task 7, Critical)

계획서는 "`applyConstraint` 재사용" 을 지시했는데, 그 함수는 **fields 가 입력 전체인 신규 행 전용**이다. 수정 행의 `fields` 는 변경분만 담으므로(`computeChanges`), 두 축(`requiresMembership`/`lifetimeQuantityLimit`) 을 한 덩어리로 읽어 없는 축을 `false`/`null` 로 채우면:

- 한도만 고친 행 → `requiresMembership` 이 `false` 로 조용히 해제됨
- 멤버십필요만 고친 행 → `isDeleteIntent`(`requiresMembership===false && lifetimeQuantityLimit==null`) 에 걸려 **한도까지 통째로 삭제**됨

둘 다 발행 후에야 발견되는 사고 모양이라 Critical 로 잡혔다. 수정: 수정 경로 전용 `applyConstraintUpdate` 를 새로 만들었다 — 두 축 중 fields 에 있는 축만 갱신하고, **없는 축은 포크한 draft 의 현재 값**(`constraints.getForVersion(masterId, draft.id, tx)` — 스냅샷이 아니라 포크한 draft, §3.6 병합 설계와 일관)으로 채운다. `applyConstraint`(신규 경로 전용)는 그대로 뒀다 — 거긴 안전하다.

회귀 테스트 2건이 이 결함을 되돌리면 정확히 실패하는 것을 직접 실행해 확인했다(수정 전 코드로 되돌려 실행 → 기대와 다른 값 수신을 로그로 남김, Task 7 §7-4).

### C.6.3 `draftOne` 이 한 행을 트랜잭션 둘로 쪼개면 phantom masterId 가 재발한다 (Task 8, Important)

계획서 Task 8 초안은 `apply()` 커밋과 `status='drafted'` 갱신을 별도 `this.db.run` 두 개로 나눴다. 두 커밋 사이에 워커가 죽으면(롤링 배포의 task stop 이 정확히 이 창을 때린다) 행은 `pending` 으로 남고, 다음 틱이 같은 행을 재처리해 `applyCreate` 의 무조건 `createMaster` 가 master 를 한 벌 더 만든다 — 앞의 master 는 어떤 item 도 가리키지 않는 고아가 된다. **v3 의 phantom masterId 사고와 정확히 같은 모양**이고, 애초에 스펙 §5.1 이 "draft 생성은 이벤트를 내지 않으므로 구조적으로 사라진다"고 단언했던 것과 배치된다 — 트랜잭션이 하나가 아니면 그 단언이 성립하지 않는다.

수정: `apply()` 호출과 `status='drafted'` 갱신을 **하나의 `this.db.run(async (trx) => {...})`** 로 합쳤다. 실패 시(`catch`)의 `failItem` 은 그대로 별도 트랜잭션이다(실패한 트랜잭션 안에서는 쓸 수 없다). 결과적으로 행 하나당 커밋은 "성공 시 1개, 실패 시 1개"로 확정됐다 — Task 11 케이스 6(22001 로 한 행만 실패)이 실 Postgres 에서 이 보장을 직접 확인한다(§C.8).

**정정 (최종 리뷰, 2026-08-03) — 이 단락이 인용한 스펙 §5.1 의 단언 자체가 거짓이었다.** 위 문장의 *"애초에 스펙 §5.1 이 «draft 생성은 이벤트를 내지 않으므로 구조적으로 사라진다»고 단언했던 것"* 은 사실이 아니다. `createMaster` 는 **트랜잭션 밖으로 새는 부수효과 둘**을 낸다: 브로커로 직송하는 `ProductVariantCreated` Kafka 이벤트(`product-masters.service.ts:136` → `libs/events/src/publishers/stream-publisher.service.ts:209-228`, 아웃박스가 **아니다**)와, `tx` 를 전파받지 않아 자기 트랜잭션을 새로 여는 `product_matchings` insert(`product-masters.service.ts:167` → `apps/core/src/modules/product-matching/services/product-matching.service.ts:272,297`). 전체 근거·귀결은 **스펙 §5.1 의 정정 블록**에 적었다.

이 정정이 위 C.6.3 의 수정 자체를 무효화하지는 않는다 — 트랜잭션을 하나로 합친 것은 여전히 옳고, 그것이 없애는 것은 **DB 안의 고아 master 행**이다. 다만 이 부록이 이후로 "phantom masterId 가 구조적으로 없다"를 근거로 삼는 자리(§C.8 의 케이스 6 서술 포함)는 그 범위를 **DB 행까지**로 읽어야 한다. `createMaster` 이후 롤백된 신규 행마다 Kafka 이벤트 하나 + `product_matchings` 행 하나는 **여전히 남는다.** 이 브랜치의 회귀가 아니라 v1·v3 와 공유하는 `createMaster` 의 기존 동작이며, 근본 수정은 catalog core 전체에 걸리는 별건이다.

## C.7 Task 8 이 lease 통합 스펙을 module-not-found 로 죽였고 Task 11 이 닫았다

Task 8 이 `BulkSessionJobManager` 에 `BulkDraftApplier` 를 정적으로 끌어오게 하면서(생성자 6번째 인자), **임포트 그래프가 `product-masters.service.ts` 까지 넓어졌다.** 그 파일은 bare `@packages/event-contracts` 를 임포트하는데, 루트 jest `moduleNameMapper` 는 **서브패스만** 매핑하고 bare import 는 매핑하지 않는다(레포 상시 debt). 그 결과 `bulk-session-lease.integration.spec.ts` 가 `Cannot find module '@packages/event-contracts'` 로 스위트 자체 부팅에서 죽었다 — Task 8 의 리뷰·재리뷰 둘 다 **DB 필요 스위트를 안 돌려서** 이 회귀를 못 잡았다.

| 사실 | 근거 |
|---|---|
| `bulk-session-merge.integration.spec.ts` 는 **같은 시점에 죽지 않았다** — 하지만 이유가 Task 8 과 무관하다. merge 스펙은 Task 8 **이전부터** 같은 우회(`jest.mock('@packages/event-contracts', ...)`)를 이미 갖고 있었다(2단계에서 `ProductBulkService` 를 진짜로 부르느라 넣은 것) | Task 11 §4.1 fix round 1 정정 — 초판 보고서가 "Task 8 이 merge 엔 우회를 넣고 lease 엔 빠뜨렸다"고 인과를 잘못 적었다가 `git show` 로 정정함 |
| Task 8 이 두 스펙 파일에 실제로 한 일은 `BulkSessionJobManager` 생성자 호출에 `undefined as never` 인자 하나씩을 채운 것뿐이다(둘 다 drafting 을 부르지 않는 범위) | Task 8 §4-1 |
| Task 11 이 lease 스펙 상단에 merge 스펙과 **동형의** `jest.mock` 우회를 추가해 닫았다 | Task 11 §4.1, 실 diff 18줄(코드 6 + 주석 12) |

**5단계 경고**: `bulk-draft.applier.ts`(→ catalog core 서비스들)를 새로 끌어오는 임포트를 추가할 때마다 이 그래프가 넓어질 수 있다. **DB 를 요구하는 통합 스펙은 `type-check:scoped`·단위 jest 로는 이 종류의 부팅 실패를 못 잡는다** — `describeIfDb` 가 스위트 내부를 skip 하지만 모듈 자체를 못 찾으면 스위트 로드 단계에서 죽으므로, 새 정적 임포트를 추가한 태스크는 **반드시 DB 를 붙여 통합 스위트를 한 번 돌려야** 이 종류의 회귀를 잡는다. 근본 수정(jest `moduleNameMapper` 에 bare `@packages/event-contracts` 항목 추가)은 전 스위트에 영향을 주는 별건으로 남아 있다(Task 11 §5).

## C.8 통합 스위트의 역검증 — 포크를 스냅샷 기준으로 되돌리면 케이스 1 만 빨개진다

스펙 §8 이 요구한 "핵심 주장 하나"(작업자가 A필드를, 남이 B필드를 바꿨을 때 발행 후 둘 다 살아있는가)를 4단계는 이렇게 검증했다: `bulk-draft.applier.ts` 의 `applyUpdate` 를 **스냅샷의 `versionId` 로 포크**하도록(= 스펙 §3.6 이전 설계로) 임시로 되돌리고 통합 스위트를 재실행했다.

결과 — **6케이스 중 정확히 케이스 1(병합)만 실패했다**:

```
● 작업자가 판매가를, 남이 브랜드를 바꿨을 때 draft 에 둘 다 살아있다
  Expected: "BETA"
  Received: "ACME"
Tests: 1 failed, 5 passed, 6 total
```

나머지 다섯(개별 발행 거부·my-drafts 제외·취소 잠금 해제·CoW·행 실패 격리)은 포크 기준과 무관하게 초록으로 남았다 — 즉 **이 설계의 유일한 회귀 잠금은 케이스 1 이고, 그것을 지우면 포크-후-적용 설계 전체가 무방비가 된다.** 단위 스펙(`bulk-draft.applier.spec.ts`)은 이 회귀를 애초에 못 잡는다 — 거기서는 `getActiveVersion`/`createDraftVersion` 이 둘 다 목이라 어느 버전에서 포크했든 목이 시킨 대로 답하기 때문이다. 임시 패치는 되돌렸고 `git status` 로 프로덕션 코드가 워킹트리에 남지 않았음을 확인했다(Task 11 §3.2).

## C.9 알려진 갭 (5단계가 받는다)

- **실패 행 탈출구가 없다.** `drafted` 에서 실패 행을 재시도하는 경로가 이 단계에 없다 — 스모크 중 행이 죽으면 취소 후 재업로드가 유일한 길이다. 스펙 §3.12 의 두 재시도 지점(생성 실패·발행 실패)을 5단계가 **한 쌍으로** 만든다. 이 결정의 근거: 라우트 shape·잠금 해제 규약·취소와의 상호작용을 두 번 열지 않기 위해서다(사용자 판단, 2026-08-02).
- **`excluded` 전이가 없다.** 발행이 없는 단계에서 제외는 관측 가능한 효과가 없다. 5단계 몫.
- **`variantCode` 전역 중복을 업로드 시점에 못 잡는다.** 2단계 검증기는 길이만 본다. 중복은 발행 시점 `_validateVariantCodeUniqueness`(`product-versions.service.ts:293` 호출, `:344` 정의 — Task 2 가 이 파일에 가드를 더하며 줄번호가 밀렸다)에서 그 행만 실패한다 — `productCode` 와 같은 성질이다(스펙 §5.2). v3 의 `ProductImportVariantCodeChecker` 에 해당하는 사전 검사는 이식하지 않았다.
- **수정 행에서 카테고리를 전부 해제할 수 없다.** 카테고리 행을 지우는 것은 "변경 없음"이므로(`bulk-session.fields.ts:76-81`) 해제를 표현할 방법이 없다. 스펙 §3.4 의 행 삭제 규약이 만든 구조적 한계다.
- **`errorMessage` 는 여전히 예외 원문이다.** 길이만 잘랐다(`ERROR_MESSAGE_MAX`, 500자). 분류는 부록 A.8 이 남긴 후속 그대로다.
- **세션 원본 워크북(`source_file_id`)을 아무도 지우지 않는다**(부록 B.7). 5단계 정리 경로 몫.
- **`applyUpdate` 가 행마다 옵션·variant 를 되읽는다.** 1,000행 세션에서 상품당 몇 번의 왕복이 붙는다. 슬라이스 10 으로 시작해 실측 후 `PRODUCT_BULK_DRAFT_SLICE` 로 조정한다(이름을 틀리면 `positiveInt` 가 파싱 실패를 조용히 기본값으로 흡수한다 — `bulk-session-job.manager.ts:176-179`).
- **`checkCreateStructure` 가 신규 행의 "같은 조합 두 번"을 검출하지 못한다**(§C.4) — `flattenBundle` 이 평면화 단계에서 뒤 값으로 덮어써 이 계층에서 관측 불가능하다. 닫으려면 `bundle.variants` 원본 배열을 받는 시그니처가 필요하다.
- ~~**`applyVariantCodes` 의 "조합에 해당하는 variant 없음" 오류가 `formatRowErrors` 를 안 거쳐 `[시트 N행]` 접두가 빠진다.**~~ → **최종 리뷰에서 닫았다.** `applyPriceChanges`(`bulk-draft.pricing.ts:65-69`)가 **똑같은 조건**에 대해 sheet `'조합'` 으로 `formatRowErrors` 를 타는 것과 형태를 맞췄다 — 이제 양쪽 다 `[조합] …` 접두가 붙는다(`bulk-draft.applier.ts` `applyVariantCodes`).
- **`resolveExistingCombos`/`resolveCreatedCombos` 후반부에 중복(N+1 가능성)이 있고, 미사용 `this.db` 주입이 남아 있다.** `getActiveVersion` 이 Nest `NotFoundException` 을 던지는 것(도메인 예외가 아님)은 `draftOne` 의 행 단위 `catch (error instanceof Error)` 가 흡수하므로 관측 가능한 결함은 아니지만, 다음에 이 예외를 세분화하려는 사람은 이 지점을 먼저 본다(Task 7 minor deferred).
- **`imageResolverFrom` 이 행마다 `Map` 을 다시 만든다.** 슬라이스 기본값(10)에서는 영향이 없지만, `PRODUCT_BULK_DRAFT_SLICE` 를 키우면 비용이 선형으로 는다(Task 8 minor deferred).
- **`type-check:scoped` 의 사각지대**: `tsconfig.spec-scope.json` 이 `product-masters.service.ts` 를 커버하지 않는다(스펙-스코프 include 패턴이 이 파일을 안 짚는다) — Task 2 가 전역 `tsc` + 파일명 grep 으로 보강 확인했지만, 다음에 이 파일을 더 건드리는 태스크는 같은 사각지대를 다시 만난다(Task 2 minor deferred, 레포 툴링 이슈로 이 브랜치 범위 밖).
- **`applyPriceChanges` 의 "입력 `current` 를 변형하지 않는다"를 단정하는 회귀 테스트가 없다.** 깊은 복사(`cloneSimplePrices`)는 코드로 확인됐으나 가드가 없다(Task 5 minor deferred).

## C.10 이번 태스크(Task 12)가 실측한 새 사실 — lint 게이트

계획서·브리프는 "변경 파일 기준 신규 lint error 0건"을 기대했다. 실측 결과 **정확히 0건이 아니다** — `product-versions.service.spec.ts` 에 develop 대비 **+11 error, +1 warning**(develop 114/71 → 브랜치 125/72)이 새로 생겼다. 다른 세 개의 기존 수정 파일(`product-masters.service.ts`, `product-versions.service.ts`, `catalog.schema.ts`)은 develop 과 문제 수가 **정확히 동일**했다(줄번호만 삽입만큼 밀림).

새 12건 전부 Task 2 가 추가한 `'일괄 세션에 잠기지 않은 draft 는 그대로 발행된다'` 케이스에서 나온다 — 그 케이스는 `publishVersion` 전체 파이프라인을 통과시키려고 `(service as any).getActiveVersion = jest.fn()` 류로 사설 메서드 9개를 목으로 바꾸는데, 이건 **같은 파일의 기존 테스트(예: 503행의 `jest.spyOn(service as any, 'getActiveVersion')`)가 이미 반복해서 쓰는 패턴**을 새 테스트 하나가 한 번 더 반복한 것이다. `no-unsafe-assignment`/`no-unsafe-member-access`/`no-unsafe-call` 12건 전부 `any` 캐스팅에서 기계적으로 파생된다.

**해소 (최종 리뷰, 2026-08-03).** 그 10개 스텁을 **같은 파일 503행이 이미 쓰는** `jest.spyOn(service as any, 'x').mockResolvedValue(...)` 형태로 바꿨다. 이 eslint 설정에서 그 형태는 `no-unsafe-argument`(**warning**)로만 재분류되므로 error 가 사라진다. 실측: `product-versions.service.spec.ts` 가 develop **114 error / 71 warning** → 브랜치 **114 error / 72 warning**. 즉 **신규 error 0건**, 신규 warning 1건(`publishVersion(version.id, tx as any)` 의 인자 — 이 파일 전역에 이미 같은 종류가 널려 있다). 두 테스트의 단정은 바꾸지 않았고 23개 케이스 전부 초록이다.

**교훈**: 이 파일에서 사설 메서드를 목으로 바꿀 때 `(service as any).x = jest.fn()` 는 error 를, `jest.spyOn(service as any, 'x')` 는 warning 만 낸다. 같은 `any` 캐스팅인데 규칙이 다르게 걸린다 — 새 패턴을 발명하지 말고 후자를 쓴다.

## C.11 최종 리뷰가 잡은 머지 차단 결함 — 취소 레이스가 draft 를 영구 미아로 만든다 (Critical)

Task 9 가 만든 취소 경로(`BulkSessionManager.cancel`)의 잠금 해제 UPDATE 는 `WHERE bulk_session_id = :sessionId` 다(`bulk-session.manager.ts:412-415`). 그건 **아직 커밋되지 않은** draft 를 볼 수 없다. 한편 `draftOne` 은 행마다 `renewLease` 로 취소를 감지하지만, **그 검사와 커밋 사이**에 취소가 커밋되면 그 행의 draft 는 `bulk_session_id` 를 단 채 커밋된다.

그 값을 나중에 지우는 경로가 레포에 **없다**:

- `claim()` 은 `cancel_requested_at IS NOT NULL` 세션을 다시 안 집는다(`bulk-session-job.manager.ts` claim SQL)
- 해제 writer 는 `cancel()` 하나뿐인데 `phase='canceled'` 면 `ConflictError`(409) 를 던진다(`bulk-session.manager.ts:397-399`)

결과: 그 draft 는 개별 발행(`publishVersion` 이 `bulkSessionId` 로 거부)·삭제·재취소가 전부 막히고 `my-drafts` 목록에도 안 나온다 — **API 로 복구 불가, 수기 SQL 만이 탈출구.** 트리거는 "긴 drafting 중 사용자가 취소"라는 가장 흔한 시나리오다. 리뷰어가 실 Postgres 로 재현했다.

**수정**: `draftOne` 의 트랜잭션 **첫 문장**으로 세션 행을 `SELECT … FOR UPDATE` 로 잠그고 `cancel_requested_at` 을 재확인한다. 취소가 걸려 있으면 **아무것도 쓰지 않고** 그 행을 건너뛴다 — 실패로 기록하지도 않는다(취소된 세션의 행은 실패가 아니다). 3단계 `bulk-image.manager.ts:192-212` 의 선례와 같은 형태이고, 잠그는 행이 하나(같은 세션)라 잠금 순서가 단일해 교착이 없다.

`cancel()` 의 CAS UPDATE 가 **같은 세션 행을 잠그기 때문에** 두 순서 모두 안전해진다:

- draft 가 먼저 잠그면 → 취소가 그 커밋을 기다렸다가 커밋된 draft 를 보고 잠금을 풀어 준다
- 취소가 먼저 잠그면 → draft 가 여기서 기다렸다가 취소를 보고 아무것도 쓰지 않는다

`renewLease` 기반의 기존 조기 중단은 **그대로 뒀다** — 그건 그 앞단의 값싼 필터이고 `FOR UPDATE` 가 마지막 방어선이다.

**회귀 잠금 3건 (전부 수정을 되돌리면 실제로 빨개지는 것을 확인했다)**:

| 층 | 케이스 | 되돌렸을 때 |
|---|---|---|
| 단위 | `draftOne 트랜잭션의 첫 문장은 세션 행 FOR UPDATE 잠금이다` — 페이크 트랜잭션에 begin/end 마커를 넣어 **순서**를 관측한다(별도 트랜잭션이거나 `apply` 뒤로 밀리면 창이 그대로 남으므로 "잠갔는가"만으로는 부족하다) | FAIL |
| 단위 | `트랜잭션 안에서 취소가 관측되면 draft 도 행 갱신도 하지 않는다 (실패로도 적지 않는다)` — `renewRows` 는 취소를 못 보게, `sessionRow` 는 취소를 보게 두어 **정확히 그 창**을 재현한다 | FAIL |
| 통합 | `취소가 커밋된 뒤 시작된 행은 draft 를 만들지 않는다 — 미아 draft 방지` (실 Postgres) | FAIL |

**통합 케이스가 `renewLease` 를 목으로 덮는 이유**: 그 창은 두 커넥션의 커밋 순서로만 열리는데, `renewLease` 자체가 세션 행을 UPDATE 하므로 어떤 순서로 짜도 취소 트랜잭션의 행 잠금 때문에 **그 값싼 필터가 먼저 취소를 관측해 버린다**. 즉 "취소를 못 본 `renewLease`" 는 목으로만 재현된다. 목은 그 필터 하나뿐이고 DB·트랜잭션·applier 는 전부 진짜다.

## C.12 통합 스위트가 옵션 있는 신규 행을 한 번도 돌리지 않았다 (최종 리뷰)

Task 11 의 `seedSession` 은 아이템의 `input` 을 항상 `options: []` 로 심었다. 그래서 **이 단계에서 가장 복잡한 경로** — 옵션이 있는 신규 행(옵션 생성 → 이름으로 되읽어 조합키↔variantId 매칭(F7) → 조합별 가격·variantCode) — 이 실 DB 에서 한 번도 실행되지 않았다. 리뷰어가 임시 프로브로 정상임을 확인했지만 영구 테스트가 없었다.

최종 리뷰가 통합 케이스 하나를 추가했다: **그룹이 번갈아 나오는** 옵션 시트((색상,빨강)→(사이즈,S)→(색상,파랑))로 신규 행 하나, 조합 2개, 각각 다른 `variantCode` 와 조합별 판매가. 단정 넷 — (a) 옵션값이 제 그룹에 귀속됐는가 (b) 조합 2개가 만들어졌는가 (c) `variantCode` 가 제 variant 에 붙었는가 (d) 조합별 가격 룰의 `scopeTargetIds` 가 올바른 variantId 를 가리키는가.

이 케이스가 §C.6.1(그룹 귀속)과 F7(이름으로 id 되찾기)을 **실 DB 에서** 동시에 잠근다. 변이 테스트로 확인했다: `parseOptionSheet` 의 그룹 귀속을 "직전 행의 그룹"(인접성 추론 — C.6.1 이 고친 것과 같은 부류의 결함)으로 바꾸면 이 케이스만 FAIL 한다.

---

# 부록 D — 5단계 구현이 실측한 사실 (2026-08-03)

5단계(일괄 발행 · 재시도 2지점 · `excluded` · 정리 두 종류)는 **core 백엔드만** 구현했다(§10.1, 사용자 결정). admin-web 은 2~5단계 화면을 별도 화면 단계로 미룬다.

읽는 법: 부록 A·B·C 와 같다. 아래는 2026-08-03 시점 실측이고, 6단계(옛 `product_import_*` 제거)는 자기 범위의 인터페이스를 다시 확인한 뒤 이 표를 출발점으로만 쓴다. §10 은 착수 전 코드를 읽어 세운 결정이었다 — 이 부록은 그중 구현·리뷰·실 Postgres 통합으로 실제로 검증되거나 정정된 것만 추린다.

## D.1 §10 의 결정 중 구현이 뒤집거나 보강한 것

§10 은 계획 시점의 결정이지 검증된 사실이 아니었다. 리뷰가 잡은 계획서·초안 결함이 **7건**(진행 원장의 "Important" 표식 기준: Task 3 ×1, Task 6 ×3, Task 7 ×2, Task 9 ×1)이고, 그 밖에 자체 리뷰·통합 테스트가 잡은 것이 둘 더(Task 2, Task 12) 있다. §10.4 의 "관문이 실제로 막는다"·"발행 실패는 종류가 유한하다"는 계약이 이 아홉 건 전부의 판정 기준이었다 — 계약을 어기면 계획서가 지시한 코드라도 컨트롤러가 고치기로 판정했다.

| # | 무엇이 틀렸는가 | 실제로 나는 사고 | 수정 | 근거 |
|---|---|---|---|---|
| 1 | §10.4②(발행 시점 가드)의 `getActiveVersion` 호출을 감싼 catch 가 바인딩 없는 bare catch 였다 | **신규 행**(`parentVersionId=null`)은 커넥션 끊김 같은 무관한 오류도 `currentActiveId=null`로 삼켜 가드를 **그냥 통과하고 발행됨** — 관문 ③이 막으려던 바로 그 사고. 수정 행은 반대로 무관한 오류에도 "기준이 변경되었습니다"로 오진단 | `catch (error) { if (!(error instanceof NotFoundException)) throw error; currentActiveId = null; }` — `@nestjs/common` 의 `NotFoundException`(`@app/shared` 의 `NotFoundError` 아님)만 "active 없음"으로 인정 | `bulk-session-job.manager.ts`, 커밋 `a507035c2`. 역검증: bare catch 로 되돌리면 "NotFound 아닌 오류" 회귀 테스트가 `publishVersion` 호출 0 기대·1 수신으로 FAIL |
| 2 | `classifyPublishError` 의 한국어 도메인 예외 판정이 `/[가-힣]/`(한글이 **어디든** 있으면) 였다 — 문서는 "한글로 **시작**하면" | 영어 DB 오류에 한국어 값이 섞이면(`… Key (name)=(아몬드영 크림) already exists.`) 원문이 500자까지 그대로 노출 — 이 함수가 없애려던 증상이 재현 | `DOMAIN_MESSAGE = /^(\[[^\]]*\]\s*)?[가-힣]/` — 한글로 시작하거나 `[조합]` 류 접두 뒤가 한글일 때만 도메인 문구로 인정 | `bulk-publish.errors.ts`, 커밋 `59b14fc4d` |
| 3 | `purgeDrafts` 의 `remaining` 재집계 테스트가 하네스의 `count()` 페이크가 필드를 무시하고 항상 원본 행을 돌려줘 값이 우연히 늘 0이었다 | `remaining` 계산 코드를 통째로 지워도(`return { purged, failed, remaining: 0 }`) 테스트가 계속 통과 — **아무것도 안 잠그는 테스트** | `aggregateCountKey(fields)` 헬퍼로 `.select({ value: count() })` 가 실제로 매칭된 행 수를 반환하도록 하네스를 고치고 "실패한 행은 remaining 재집계에 다시 잡힌다" 케이스 추가 | `bulk-session.manager.spec.ts`, 커밋 `0da944fe3` (아래 D.3 도 참조) |
| 4 | 정리(`purgeDrafts`) 실패 시 `classifyPublishError`의 generic 폴백 문구가 "발행에 실패했습니다"로 고정 | 관리자 화면에 "삭제"인데 "발행"으로 뜬다 — 실측 로그: `draft 정리 실패 … 발행에 실패했습니다. (원인: boom)` | `classifyPublishError(error, action: '발행'\|'정리' = '발행')` — 기본값이 기존 발행 경로 9건 호출부를 한 글자도 안 바꿈 | `bulk-publish.errors.ts`/`bulk-session.manager.ts`, 커밋 `0da944fe3` |
| 5 | `purgeDrafts` 성공 UPDATE 가 `errorMessage` 를 안 지웠다 | 실패 후 재시도로 성공해도 옛 오류 문구가 화면에 그대로 남는다 | 성공 `.set({...})` 에 `errorMessage: null` 추가 | `bulk-session.manager.ts`, 커밋 `0da944fe3` |
| 6 | `BulkSessionCleaner`(워크북 스윕) 스펙의 페이크 `.where()` 가 인자를 안 받고, 테스트가 **자기만의 술어 사본**(`TERMINAL_PHASES.includes(...) && ...`)으로 행을 걸렀다 | `lt`→`gt` 뒤집기, `inArray(phase)` 절 삭제 둘 다 목이 초록 그대로 — 진행 중 세션·30일 미만 세션을 실수로 지워도 테스트가 못 잡는다 | `rowMatchesCondition`(공용 렌더러, D.3)에 `lt` 지원을 더해 실제 drizzle 조건을 렌더·판정하도록 스펙을 재작성 | `bulk-session.cleaner.spec.ts` + `__support__/drizzle-row-matcher.ts`, 커밋 `309c70a6b` |
| 7 | 영구 실패 행(예: 며칠간 이어지는 file-service 장애로 soft-delete 가 계속 실패하는 행)이 `orderBy(updatedAt)` 정렬 때문에 워크북 스윕 배치 앞머리를 독점한다 | 형제 클래스(`BulkImageCleaner`)의 해법(실패 시 `updatedAt` 갱신해 뒤로 미룸)은 **여기서는 오히려 틀린다** — 이 스윕의 대상 판정 자체가 `updatedAt` 을 나이로 쓰므로, 갱신하면 판정이 자기 자신 때문에 흔들린다 | **수정 없음 — 사용자 판정(2026-08-03): 문서화하고 넘긴다.** 완화 근거: 하루 1회 · 배치 200 · core 가 자체 생성한 fileId. 도달하려면 다일간 file-service 장애가 필요하다. 진짜 해법(재시도 횟수 컬럼)은 마이그레이션이 필요해 5단계 범위 밖 | §D.5 "남긴 갭"에도 재기재. 리뷰가 실 코드로 지적, 컨트롤러가 파킹 |
| 8 | `bulk-session.controller.ts` 의 `publish`·`retry-draft`·`purge-drafts` 세 라우트가 매니저의 `NotFoundError`(세션 없음/내 것 아님)를 문서화하지 않고 409 만 달았다 | Swagger 문서가 실제 응답과 불일치 — API 소비자가 404 케이스를 놓친다 | `@ApiResponse({ status: 404, description: '세션이 없거나 내 것이 아님' })` 3줄 추가(`exclude` 가 이미 쓰는 문구·위치와 동일) | `bulk-session.controller.ts`, 커밋 `a35433301`. **`approve`·`cancel` 라우트의 같은 누락은 이번에도 안 고쳤다** — Task 9 가 범위 밖으로 남기고 "최종 리뷰가 트리아지"라 적었지만 이후 별도 최종 리뷰 라운드가 없어 **미결로 남는다**(D.5) |
| 9 | `BulkVariantCodeChecker.checkSession`(Task 11, §10.7 갭 4건 중 하나)의 정규식 `/^variant:.+\.variantCode$/`가 조합키 부분에 최소 1자를 요구했다 | **옵션 없는 상품**(카탈로그의 절대다수로 추정)은 조합키가 빈 문자열(`variant:.variantCode`)이라 `.+` 에 매칭되지 않는다 — 이 상품군에서 품목코드 중복 사전검사가 **한 번도 발동하지 않았다.** 발행 시점 DB 유니크 제약(`_validateVariantCodeUniqueness`)이 최종 방어선이라 데이터 정합성 자체는 안 깨졌지만, "업로드 직후 알려주기"라는 사전검사 고유의 목적이 무력했다 | `/^variant:.*\.variantCode$/`(`.+`→`.*`) — `bulk-session.fields.ts` 의 `parseFieldPath` 가 이미 같은 이유로 `.*` 를 쓰고 있었는데(§C.3 근거) Task 11 이 그 교훈을 놓쳤다 | `bulk-variant-code.checker.ts`, 커밋 `a48c520d7`. Task 12 가 실 DB 로 3테이블 조인을 처음 돌리며 발견(아래 D.3) |

**5단계가 실측으로 정정한 §10 자체의 문장**: 없다. §10.2(`origin` 재사용)·§10.3(잠금 선해제)·§10.6(마이그레이션 1건)은 구현 그대로 확정됐고 통합 테스트가 이를 검증했다(D.2). §10 이 어긋난 곳은 전부 **본문의 결정이 아니라 그 결정을 구현한 초안 코드**였다 — 부록 C 의 4단계 패턴과 같다.

## D.2 `publishVersion` 을 실 Postgres 로 확인한 것

Task 12 가 `bulk-session-publish.integration.spec.ts`(8케이스, 실 Postgres + 실 Nest DI)로 검증했다. 5스위트 합계 47건 전부 통과(기존 39건 회귀 없음).

### D.2.1 잠금 선해제 순서와 롤백 발행

§10.3 이 계획한 "`bulk_session_id=NULL` 을 먼저 쓰고 `publishVersion` 을 부른다" 순서를 단위 테스트(Task 3, `ops` 로그의 `kind:'call'` 마커로 순서 관측)와 통합 테스트(Task 12 케이스 3) 양쪽에서 확인했다. 발행 성공 뒤 직접 `bulkSessionId IS NULL` 을 질의해 확인했고, 그 버전을 새 draft 발행으로 밀어내 `inactive` 로 만든 뒤 **다시 `publishVersion` 을 불러 세션 관련 409 없이 통과함**을 실측했다 — §10.3 이 이유로 든 "롤백 발행이 나중에 막히는 사고"가 실제로 없음을 확인.

### D.2.2 두 커넥션 경합 (취소 레이스, 관문 ①)

`publishOne` 관문 ①(`SELECT … FOR UPDATE` + 취소 재확인)이 막는 타이밍은 "취소의 UPDATE 가 아직 uncommitted 인 동안 관문 ①이 낡은 상태를 읽고, 그 뒤 취소가 커밋되는" 창이다. **순차 실행으로는 이 창이 재현되지 않는다** — `FOR UPDATE` 유무와 무관하게 항상 안전해 보여서 관문의 존재를 증명하지 못한다. 그래서 통합 케이스 2는 물리적으로 분리된 **세 번째 커넥션**(`raceConn`, `max:1`)으로 세션 행에 `SELECT … FOR UPDATE`를 걸어 콜백 안에서 붙잡고, `cancel()`이 그 뒤에 줄서게 한 뒤(`pg_locks WHERE NOT granted` 로 대기를 폴링 확인) `runPublishSlice()`(같은 Nest DI 풀에서 다른 물리 커넥션)를 발사해 대기 순서를 강제했다. `renewLease`(값싼 조기 필터)만 목으로 덮어 관문 ① 자체를 시험대에 올렸다 — DB·트랜잭션·`BulkDraftApplier`/`ProductVersionsService`는 전부 진짜다. 20회 이상 반복에서 재현성을 확인(350~405ms 로 일정, 넓은 타이밍 창에 우연히 걸린 것이 아님).

### D.2.3 역검증 — 어느 관문을 지우면 어느 케이스가 빨개지는가

| 지운 것 | 빨개진 케이스 (그 외 7건은 초록 유지) | 실측 |
|---|---|---|
| 관문 ③(발행 시점 가드, `if (false && currentActiveId !== ...)`) | ① 발행 시점에 남이 먼저 발행했으면 그 행만 실패한다 | `Expected: "failed", Received: "published"` |
| 관문 ①의 `.for('update')` | ② 취소가 커밋된 뒤 시작된 행은 발행되지 않는다 (3회 반복 재현) | `Expected: "pending", Received: "published"` — FOR UPDATE 없으면 취소 커밋 뒤에도 실제로 발행돼 버린다 |
| `BulkVariantCodeChecker` 정규식(`.*`→`.+` 되돌림) | ⑦ 품목코드 중복 사전검사의 3테이블 조인이 실 DB 에서 돈다 | `Expected: 1, Received: 0` |

세 실험 모두 "정확히 그 케이스만" 빨개지고 나머지 7건은 흔들리지 않았다 — §10.8 이 요구한 6건의 회귀 잠금 목록에 케이스 7(품목코드 사전검사, D.1#9)이 실제 구현에서 하나 더 추가됐다.

## D.3 테스트 하네스에 관한 교훈 — "통과하지만 아무것도 안 잠그는 테스트"가 네 번 나왔다

같은 도메인(drizzle 페이크 하네스)에서 같은 종류의 결함이 4개 태스크에 걸쳐 반복됐다. 넷 다 **"조건을 실제로 렌더/평가하지 않고 항상 같은 답을 주는 페이크"** 라는 한 가지 모양이다.

| 태스크 | 무엇이 항상 같은 답을 줬는가 | 어떻게 살아남았는가 (지금 막힌 자리) |
|---|---|---|
| 6 (`purgeDrafts`) | `trx.select(fields)` 가 `fields` 를 무시하고 원본 행을 그대로 반환 — `.select({ value: count() })` 를 호출해도 `.value` 가 없어 `?? 0` 이 항상 `0` | `aggregateCountKey(fields)` — `fields` 를 순회해 값이 drizzle `SQL` 인스턴스(일반 컬럼 참조인 `PgColumn` 과 구분)인 첫 키를 찾아, 매칭된 행 수를 그 키에 담아 반환하는 집계 헬퍼 |
| 7 (`BulkSessionCleaner`) | `.where()` 가 인자를 안 받고, 스펙이 **자기 술어 사본**(`TERMINAL_PHASES.includes(...) && cutoff !== null && ...`)으로 필터링 — 프로덕션 조건과 완전히 분리돼 있어 `lt`→`gt` 뒤집기·`inArray` 절 삭제가 안 잡힘 | `rowMatchesCondition(row, condition)` — `PgDialect.sqlToQuery(condition)` 으로 **실제 drizzle 조건 트리를 렌더**해 정규식으로 판정. `__support__/drizzle-row-matcher.ts` 로 공용화(스펙-투-스펙 import 는 무관한 61건을 매번 같이 돌리는 부작용이 실측돼 기각) |
| 8 (`getProgress` 의 `publishCounts`) | `groupBy` 페이크가 인자를 무시하고 항상 픽스처의 `row.status` 필드로 그룹핑 — `itemCounts`/`imageCounts` 는 그 축도 우연히 `status` 라서 안 들켰다 | `groupByField` — `groupBy(...)` 가 실제로 받은 첫 drizzle 컬럼의 `.name`(SQL 컬럼명)을 camelCase 로 바꿔 그 필드로 집계. 테스트도 `toHaveLength(2)` 를 추가해 "여러 그룹이 하나로 뭉치는" 실패를 `arrayContaining` 단독보다 확실히 잡게 함 |
| 11 (`BulkVariantCodeChecker`) | 유닛 스펙 4건의 픽스처가 전부 조합키 **있는**(`variant:V-RED+V-S.variantCode`) 키만 썼다 — 정규식이 빈 문자열 조합키를 못 잡는 버그를 애초에 검증할 생각이 없었다 | 유닛 하네스 확장이 아니라 **실 Postgres 통합 테스트**(Task 12 케이스 7, 옵션 없는 신규 상품 픽스처)로 닫혔다 — 3테이블 조인이 실제로 처음 실행되며 잡힌 사고(D.1#9) |

**패턴**: 처음 셋은 "페이크가 인자를 안 보고 고정된 방식으로 응답"하는 결함이라 **하네스 자체를 실제 조건/컬럼 인식형으로 고치는 것**이 해법이었다. 넷째는 하네스의 문제가 아니라 **테스트 픽스처가 애초에 문제되는 입력(빈 조합키)을 만들 생각을 안 한 것**이라 하네스를 아무리 고쳐도 못 잡았을 것 — 실 DB 로 그 모양의 데이터를 흘려보내는 통합 테스트만이 닫을 수 있었다. **6단계 이후에도 이 도메인의 페이크 하네스를 확장할 때는 "인자를 실제로 쓰는가"와 "픽스처가 그 조건의 경계값(빈 문자열·NULL·0건)을 포함하는가"를 둘 다 따로 물어야 한다.**

## D.4 6단계가 알아야 할 것

- **`origin: 'bulk_import'` 재사용이 실제로 이벤트 계약을 건드리지 않았다**(§10.2, D.1 "정정 없음" 참조) — 6단계가 옛 `product_import_*` 를 지우고 나면 이 값이 유일한 bulk 경로를 가리키게 된다. `channel-adapter` 의 `BULK_ORIGINS` 는 그대로 둔다.
- **`createMaster` 의 트랜잭션 밖 부수효과(Kafka 직송 + `product_matchings` 미전파 insert, §C.6.3 정정)가 5단계의 신규 행 재시도로 실제로 누적된다.** §10.5 가 예고한 그대로이고 5단계는 이를 완화하지 않았다 — 재시도 버튼을 누를 때마다 유령 이벤트/행이 하나씩 남는다. 근본 수정은 catalog core 전체에 걸리는 별건.
- **잠금 해제(§10.3)는 발행 트랜잭션 안에서만 유효하다** — `purgeDrafts`(정리)는 별도 트랜잭션에서 `draftVersionId=NULL` 을 쓰고 draft 버전 자체를 하드삭제한다. 6단계가 "세션이 끝난 뒤 남는 흔적"을 정리하려면 두 코드 경로(발행 완료 vs 취소 정리)가 `bulk_session_id`/`draft_version_id` 를 서로 다른 방식으로 비운다는 것을 알아야 한다.
- **제외(`status='excluded'`)된 행은 `purgeDrafts` 의 정리 대상이 아니다**(최종 리뷰 발견 ①, `bulk-session.manager.ts` 의 `purgeDrafts`/`excludeItem`) — `excludeItem` 은 행을 세션에서 뺄 때 `draft_version_id` 를 **일부러 남겨** 그 draft 를 작업자 개인 draft 로 돌려준다. `purgeDrafts` 의 대상 판정이 `status` 를 안 보고 `draft_version_id`/`publish_status` 만 봤다면 취소 후 정리가 그 개인 draft 를 하드 삭제(신규 행이면 master 까지)하는 사고가 났다 — 지금은 `status<>'excluded'` 조건으로 막혀 있다. 6단계가 `bulk_session_id`/`draft_version_id` 두 경로를 다시 만나므로(위 항목), 세 상태(발행 완료·취소 정리·제외)가 이 두 컬럼을 각자 다르게 다룬다는 것을 셋 다 알아야 한다.
- **역할 가드(§10.7)가 `BulkSessionController`와 `FormExportController` 둘 다에 걸렸다** — 6단계가 옛 임포트 컨트롤러를 지우면서 새 라우트를 추가한다면 같은 `RolesGuard('master','admin')` 패턴을 따라야 한다(고객센터 컨트롤러 선례, 두 파일에 "⚠️ 배포 위험" 주석으로 남김).
- **워크북 만료 스윕(§10.6)의 "실패 시 `updatedAt` 갱신 금지" 규약**은 이 도메인의 형제 클래스(`BulkImageCleaner`)와 반대다 — 새 정리기를 만들 때 무심코 형제 클래스 패턴을 복사하면 D.1#7 과 같은 사고가 재발한다. 대상 판정이 스스로 나이를 재는 필드를 쓰는 스윕은 전부 이 규약을 따라야 한다.
- **`approve`·`cancel` 라우트의 404 Swagger 문서 누락이 아직 안 고쳐졌다**(D.1#8) — 6단계 근처에서 이 컨트롤러를 다시 열 일이 있으면 같이 정리할 기회다.
- **정적 임포트 확장은 통합 스위트 부팅을 죽일 수 있다**(부록 C.7 이 4단계에서 겪음, 5단계는 재발하지 않았지만 여전히 유효한 경고) — 6단계가 옛 `product_import_*` 를 지우며 새 임포트를 추가하면 **DB 를 붙인 통합 스위트를 반드시 한 번 돌려야** 이 종류의 회귀(모듈을 못 찾아 스위트 자체가 로드 단계에서 죽는 것, `describeIfDb` 로는 못 잡음)를 잡는다.

## D.5 남긴 갭 — 이 단계가 남긴 갭 전량(원장 기준)

닫지 않기로 한 것과 새로 발견해 미해결로 남은 것을 합친 목록이다. §10.7 말미의 "닫지 않고 남기는 것" 4건은 5단계에서도 그대로다(수정 행 카테고리 전체 해제 · `loadReferencedImageRefs` payload 전량 select · 스냅샷 리더 배치화 · `createMaster` 트랜잭션 밖 부수효과).

아래 표는 그 위에 진행 원장(`progress.md`)의 `minor (deferred)` 항목 **19건 전부를 재대조**한 결과다. **6건은 이후 태스크가 실측으로 닫았다**(더 이상 갭이 아니라 여기서 뺐다):

- Task 3 "`bulk-session.module.spec.ts` 의 `BulkSessionJobManager` 의존성 개수 주석이 낡았다(5→6)" — Task 11 이 자기 태스크에서 실제로 "8개"로 갱신(§D.1 근처 diff 로 확인)
- Task 3 "`bulk-session-job.manager.ts` 의 주석이 아직 없는 `excludeItem` 을 선행 참조" — Task 5 가 그 메서드를 실제로 만들어 참조가 유효해짐(현재 주석 재확인: "② `excludeItem` 이 이 행을 뺐을 수 있다" — 사실과 일치)
- Task 3 "DI 부팅은 Task 12 의 DB 실행 전까지 미증명" — Task 12 가 실 Postgres + 실 Nest DI 로 부팅 검증
- Task 6 "세션 격리 술어 `eq(sessionId)` 에 테스트 없음 → Task 12 몫" — Task 12 케이스 8(`purgeDrafts` 는 다른 세션의 draft 를 건드리지 않는다)이 정확히 이 술어를 실 DB 로 검증
- Task 6 "`bulk-publish.errors.spec.ts:39` prettier error" — 이번 태스크(T13)가 `--fix` 로 정리, 커밋 `9c0b442c0`
- Task 11 "3테이블 조인이 실 DB 에서 한 번도 실행되지 않았다" — Task 12 가 돌려서 발견한 정규식 버그가 D.1#9 로 승격

**남은 13건**을 아래 표에 실었다. 그 위에 §10.7·부록 C.9 를 다시 인용한 것(§10.5 의 `createMaster` 부수효과, C.9 의 `type-check:scoped` 사각지대) 과 사용자가 파킹한 D.1#7, 그리고 이번 리뷰가 직접 코드로 새로 확인한 것(모듈 스펙의 또 다른 낡은 의존성 개수 주석 — `BulkSessionManager` 쪽, 아래 표 첫 항목 다음 참조)을 더해 T13 시점 표는 17행이었다. **최종 전체 브랜치 리뷰가 3건을 더 추가했다**(순서만 다른 중복 조합의 (d) 검사 우회 · `retry-draft` 일방통행 · 킬스위치의 3중 범위) — 표 전체는 20행이다.

| 갭 | 왜 남기는가 |
|---|---|
| **워크북 스윕의 영구 실패 행이 배치 앞머리를 독점한다**(D.1#7) | **사용자가 명시적으로 파킹**(2026-08-03). 하루 1회·배치 200·core 자체 생성 fileId 라 도달하려면 다일간 장애가 필요 — 진짜 해법(재시도 횟수 컬럼)은 마이그레이션이 필요해 5단계 범위 밖 |
| **`approve`·`cancel` 라우트에 404 Swagger 문서가 없다**(D.1#8) | Task 9 가 범위 밖으로 미루며 "최종 리뷰가 트리아지"라 적었으나 이후 별도 최종 리뷰 라운드가 없어 미결로 남았다 — 다음에 이 컨트롤러를 여는 사람이 처리 |
| **신규 행 재시도가 `createMaster` 부수효과를 누적시킨다**(§10.5, D.4) | 근본 수정이 catalog core 전체에 걸리는 별건. API 설명·화면 문구로 "무한정 누를 것이 아니다"를 알리는 완화만 있다 |
| **소유권/존재 SELECT 블록이 7곳(approve·cancel·queuePublish·retryDraft·excludeItem·purgeDrafts 등)에 중복** | 트랜잭션 러너가 아니라 단순 조회라 ADR-0025 위반은 아니다 — 공용 private 헬퍼로 뽑을 여지만 있음(Task 4 부터 계속 누적) |
| **`purgeDrafts` 행 오류 로그가 원문 대신 분류된 문구를 찍는다** | 분류기가 원문을 버리진 않지만(500자 미만은 로그에도 안 남을 수 있음) 디버깅 시 원문이 더 유용할 자리 — 영향 낮음(Task 6) |
| **통합 케이스 7 의 `variantCode` 픽스처가 하드코딩**(`DUP-CODE-1`/`SELF-CODE-1`) | 중단된 실행이 스크래치 DB에 행을 남기면 다음 실행이 조용히 오염될 수 있다 — `randomUUID` 접미사 권고(Task 12) |
| **통합 스위트 `afterAll` 에 try/finally 가 없다** | 정리 실패 시 Nest 풀이 안 닫혀 행·워커가 잔존할 수 있음(Task 12) |
| **통합 케이스 2(취소 레이스)가 부하 시 무의미 통과로 퇴화 가능** | `waitForBlockedBackends` 가 타임아웃에도 throw 하지 않고 진행하도록 설계됨 — CI 부하가 로컬보다 훨씬 크면 대기자 수 확인 없이 통과할 수 있다(Task 12) |
| **통합 케이스 8이 update kind 만 덮는다** | 타 세션의 create 행에 대한 `deleteMaster` 분기가 세션 격리 테스트에서 미검증(Task 12) |
| **`checkOptionStructure`(수정 행 구조 검증)가 §C.4(d)와 같은 결함의 update 판을 그대로 갖고 있다** | Set 비교라 업로드 조합이 중복이면 dedupe 되어 no-op — 신규 행 쪽(§C.4(d))과 같은 근본 원인, 후속 태스크 권고(Task 10) |
| **`type-check:scoped` 의 사각지대**(부록 C.9) | `tsconfig.spec-scope.json` 이 `product-masters.service.ts` 를 커버 안 함 — 5단계는 이 파일을 건드리지 않아 재확인만 하고 넘어감 |
| **`bulk-session.module.spec.ts` 의 `BulkSessionManager` 의존성 개수 주석이 낡았다** — "`DbService<PimSchema>`/`FormExportFileClient` 2개 의존성"이라 적혀 있는데(`git log -S` 로 추적하면 이 문구는 **2단계**(`9d0cd7739`)에서 쓰여 그때는 사실이었다) `BulkSessionManager` 생성자는 5단계 Task 6 이후 `db, fileClient, reader, versions, masters` 5개다 | 원장 19건에 이 항목 자체는 없다 — 이번 T13 리뷰가 코드로 직접 새로 확인한 것이다. `BulkSessionJobManager` 쪽의 같은 종류 주석(5→8)은 Task 11 이 갱신했지만 `BulkSessionManager` 쪽은 갱신 담당 태스크가 없었다. 기능 영향 없는 문서 부채 — 다음에 이 생성자를 다시 여는 사람이 같이 고치면 된다 |
| **`publishOne` 의 `!draftVersionId` 분기(즉시 실패, `bulk-session-job.manager.ts:897-900`)에 전용 단위 테스트가 없다** — `runPublishSlice` 단위 describe 의 `it` 들 중 이 분기를 지나는 것이 없다 | Task 3 부터 이어진 원래 갭(단위 테스트 기준). 코드 경로 자체는 단순(즉시 `failPublish`)해 리뷰가 위험도를 낮게 봤지만, 단위 회귀 테스트로 못박히진 않았다. **최종 리뷰 정정**: 이 행이 원래 함께 묶었던 **멱등 분기**(`version.status==='active'` 면 도장만, `:924-931`)는 갭이 아니다 — 통합 케이스 5의 2층("층 2: publishOne 자체의 멱등", `bulk-session-publish.integration.spec.ts:761-786`)이 그 분기를 실 DB 로 이미 잠근다. 역검증(이번 최종 리뷰가 실행): `if (version.status === 'active')` 를 `if (false && …)` 로 지우면 그 케이스가 관문 ③(발행 시점 가드)의 `ConflictError` 를 내며 `publishStatus` 가 `published` 대신 `failed` 로 떨어져 빨개진다 |
| **`bulk-session.reader.spec.ts:61` 의 `groupByField` `'status'` 폴백 분기가 죽은 가지다** — 프로덕션은 항상 `.name` 이 있는 실제 drizzle 컬럼을 넘기므로 어떤 테스트도 이 분기에 도달하지 못한다 | 하네스 방어 코드일 뿐 프로덕션 동작에 영향 없음 — 지우거나 커버하거나 둘 다 낮은 우선순위(Task 8) |
| **job manager 스펙의 `DraftInput` 조립 테스트가 `variantRows` 를 단정하지 않는다** — `optionRows`·`conflictDecision`·`baseSnapshot`·`images` 는 검사하면서 같은 객체의 `variantRows`(`item.input.bundle.variants` 배선, `bulk-session-job.manager.ts:1089`)는 빠졌다 | 배선 자체는 코드로 확인됨(위 줄 참조) — 회귀로 못박히지 않은 것이 갭. 테스트에 `expect(input.variantRows).toEqual(...)` 한 줄을 더하면 닫힌다(Task 10) |
| **`excludeItem` 의 행 미발견 오류 문구가 `setConflictDecision` 선례와 다르다** — `excludeItem`: `세션의 행을 찾을 수 없습니다: ${itemId}`, `setConflictDecision`: `일괄 등록 세션의 행을 찾을 수 없습니다: ${itemId}`(`bulk-session.manager.ts:596`/`:243`) | 둘 다 정상 동작(문구만 다름) — 일관성 문제일 뿐 기능 결함이 아니다(Task 5) |
| **Task 12 보고서의 역검증 출력이 raw jest 출력이 아니라 정리된 요약이다** | 역검증은 실제로 돌았고 Expected/Received 값이 실제 단정과 일치하지만, 보고서에 붙은 것은 정리된 요약이다. 다음 단계는 raw 출력을 붙이는 편이 낫다 |
| **순서만 다른 중복 조합(`OV-1+OV-2` vs `OV-2+OV-1`)이 신규 행 (d) 중복 검사를 빠져나간다**(최종 리뷰 발견) — `checkCreateStructure` 의 (d)는 `variantRows` 원본 조합 문자열을 그대로 `Set` 비교하는데(`bulk-draft.options.ts:224-233`), `bulk-draft.applier.ts` 의 `workbookComboToIdKey`/`resolveCreatedCombos`(:268-271,286-301)는 실제 optionValueId 를 **정렬**해 매칭한다 — 순서만 다른 두 조합 문자열이 (d) 앞에서는 "다른 조합"으로 보이지만 실제로는 같은 variant 로 해석돼, 뒤 값이 앞 값을 조용히 덮어쓴다(§C.4(d)·D.5의 "`checkOptionStructure` update 판"과 같은 계열의 새 변종) | 실 워크북에서 같은 조합을 옵션값키 순서만 바꿔 두 번 적을 확률은 낮지만 구조적으로 열려 있다 — (d) 검사도 정렬 비교로 바꾸면 닫힌다. 5단계 범위 밖(신규 코드 아님, 회귀 아님) |
| **`retry-draft` 는 일방통행이다**(최종 리뷰 발견) — `drafted` phase 에서만 열리는데, 세션이 한 번이라도 발행(`queuePublish`)을 거쳐 `publishing`→`published` 로 넘어가면(§10.4 "실패 행이 남아도 published 로 마감"이라 draft 생성 실패 행이 섞여 있어도 넘어간다) `retryDraft`(phase≠`drafted` 라 409)도 `cancel`(phase=`published` 라 409)도 다시 열리지 않는다 — 그 실패 행을 고칠 유일한 길은 새 세션 업로드뿐이다. `BulkSessionManager.retryDraft` 단위 describe 도 해피패스 1건뿐이라 이 409 분기들이 회귀로 못박혀 있지 않다 | 서버 결함이 아니라 작업 순서 문제다 — 화면 단계가 "발행 전에 재시도부터 끝내라"를 강제해야 한다. 화면 단계·후속 태스크 몫 |
| **킬스위치 `PRODUCT_BULK_SESSION_WORKER_ENABLED` 가 워커·이미지 스윕(3단계)·워크북 스윕(5단계 §10.6) 셋을 동시에 끈다**(최종 리뷰가 배포 메모로 승격) — `bulk-session-job.worker.ts`·`bulk-image.cleaner.ts`·`bulk-session.cleaner.ts` 가 전부 같은 env 를 재사용한다(의도된 설계, `bulk-session.cleaner.ts:24` 주석 참조) | 갭이 아니라 배포·장애 대응 시 알아야 할 사실 — 하나만 끄고 싶어도 이 스위치로는 셋이 같이 꺼진다 |

| **취소 세션의 이미지 스윕이 "살아있는 draft 를 든 행"이 하나라도 있으면 세션 전체를 영구히 건너뛴다**(최종 fix wave 재리뷰가 코드로 확인, **이 브랜치 이전부터 있던 동작**) — `bulk-image.cleaner.ts:99-109` 의 게이트가 행 단위가 아니라 **세션 단위 상관 서브쿼리**라, `draft_version_id` 가 남은 행이 하나라도 있으면 그 세션의 업로드 이미지가 영영 정리되지 않는다. 그런 행은 두 종류다: (1) 발행된 행 — `publishOne` 은 성공 시 `productMasterVersions.bulkSessionId` 만 비우고 `productBulkItems.draftVersionId` 는 **그대로 둔다**(`bulk-session-job.manager.ts:956`), 그리고 `purgeDrafts` 는 원래부터 `publishStatus='published'` 를 대상에서 뺐다 (2) 제외된 행 — 이번 수정이 `ne(status,'excluded')` 를 더하며 같은 범주에 들어왔다 | **새 결함이 아니라 기존 패턴의 확장이다** — (1)은 이 브랜치 이전부터 성립했다(발행 중 취소 시나리오). 닫으려면 "정리 대상이 아닌 행"과 "이미지를 아직 붙들고 있는 행"을 다른 컬럼으로 구분해야 하는데 그건 마이그레이션이 필요하다. **6단계가 `bulk_session_id` 와 `draft_version_id` 두 컬럼을 다시 만지므로 그때 함께 본다** |

**5단계에서 새로 닫힌 것**(참고, 갭 아님): §10.7 의 갭 4건 중 컨트롤러 역할 가드·`errorMessage` 분류·`variantCode` 전역 사전검사 3건이 5단계에서 닫혔다(§10.7 이 예고한 그대로). **정정(최종 리뷰)**: T13 시점에는 이 "3건 닫힘" 이 부정확했다 — `errorMessage` 분류가 실은 발행 실패(`publishOne`)에만 걸려 있었고, draft 생성 실패(`draftOne`/`failItem`)는 `classifyPublishError` 를 아예 부르지 않고 예외 원문을 그대로 실었다(최종 리뷰 발견 ②, §3.12 가 명시한 "생성 시 22001"이 바로 이 경로). 이 최종 수정 라운드에서 `classifyPublishError` 의 `action` 유니온에 `'생성'` 을 더하고 `draftOne` 의 catch 가 그것을 쓰도록 고쳐(원문은 `publishOne` 과 같은 형태의 `logger.warn` 으로 남긴다) 지금은 실제로 3건이 닫혀 있다. 부록 C.9 가 남긴 "`excluded` 전이가 없다"·"실패 행 탈출구가 없다"도 5단계 라우트 넷으로 닫혔다.

## D.6 배포 선행조건 체크리스트

- [ ] **마이그레이션 1건** — `20260802213044_bulk-session-source-file-nullable.sql`(`source_file_id` DROP NOT NULL, additive). Expand phase 순서: **`migrate` → `deploy`**(§10.6)
- [ ] ⚠️ **라이브 DB 에서 MD 계정의 `roles` 실측** — `BulkSessionController`·`FormExportController` 둘 다 클래스 레벨 `RolesGuard('master','admin')` 로 잠겨 있다(Task 9). 시드 롤 6종(`master`·`admin`·`membership`·`user`·`logistics_worker`·`logistics_manager`) 중 `admin`/`master` 가 없는 MD 계정은 배포 즉시 403 — 이미 라이브인 "양식 다운로드"(`product-forms`)부터 영향받는다
- [ ] 새 env `PRODUCT_BULK_PUBLISH_SLICE`(선택, 기본값 5, `bulk-session-job.manager.ts:211-212` `get publishSlice()`) — **이름을 틀리면 `positiveInt` 파싱 실패가 조용히 기본값을 채택한다**(2·3·4단계의 `PRODUCT_BULK_LEASE_MS` 등과 같은 함정)
- [ ] 이벤트 계약 변경 0건(§10.2, D.4 확인) · 새 시크릿 0건 · admin-web 변경 0건 — 이번 태스크에서 `git diff --name-only 9dd40c391..HEAD` 로 재확인: 변경 디렉터리는 `apps/core`·`docs/superpowers`·`package.json` 뿐
- [ ] **2·3·4단계의 미수행 수동 스모크가 여기 누적된다**: 2단계 8건(전 구간) · 3단계 2건(master 없는 토큰의 file-service 실제 검증 — 본인 파일 교체 성공 / 남의 fileId 403) · 4단계는 별도 미수행 항목 없음(재검증 완료 기록)
- [ ] **5단계 수모크 5건**: 발행 전 구간 1회(업로드→검증→drafting→발행 완료) · 발행 중 취소 1회(관문 ① 이 실제로 그 행을 건너뛰는지) · 실패 행 재시도 1회(`retry-draft`/`publish` 재호출) · 제외 1회(`exclude` 후 개별 발행이 실제로 열리는지) · 취소 후 draft 전량 정리 1회(`purge-drafts` 를 `remaining===0` 또는 `purged===0` 까지 반복 호출)
