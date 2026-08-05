# 품목 판매정책을 대량등록 양식에 넣기 — 설계 스펙

- 날짜: 2026-08-06
- 대상: `apps/core` (catalog/bulk-session + catalog/core/products + product-matching) + `apps/admin-web`
- 상태: **설계 확정, 구현 미착수**
- 관련:
  - `docs/superpowers/specs/2026-07-31-product-bulk-session-design.md` (모체 스펙 — 세션 상태 머신·발행 레인의 계약이 여기 있다)
  - `docs/adr/0004-variant-draft-scoped-edit-cow.md` (variant CoW 와 publish 시 인계 — §6 이 그 인계 목록을 늘린다)
  - `docs/adr/0028-coming-soon-is-stock-gated.md` (입고가 출시예정을 걷는다 — §4.2 의 충돌 전제)
  - `docs/adr/0005-drizzle-migration-and-autodeploy.md` (**마이그레이션 0건이라 해당 없음**)

## 1. 목표

판매상품 상세의 품목 테이블에는 품목별 판매정책 체크박스 4종이 있다(수동 품절 · 출시 예정 · 선판매 · 항상 판매). 지금은 **화면에서 한 건씩만** 바꿀 수 있고 대량등록 양식에는 이 필드가 아예 없다. 수백 품목의 품절을 거는 일이 클릭 수백 번이다.

이 스펙은 그 4종(+출시예정일)을 대량등록 양식에 넣는다. 그 과정에서 두 가지를 함께 고친다:

1. **변경분이 비어 있는 행도 새 버전을 만든다.** 정책 열이 생기면 "정책만 채운 행"이 흔해지므로, 지금은 드문 이 구멍이 상시 경로가 된다.
2. **CoW 로 variantId 가 갈리면 정책이 유실된다.** 대량등록이 그 경로를 대량으로 만든다(§6).

## 2. 전제 — 판매정책은 의도적으로 버전 관리 대상이 아니다

**사용자 확정(2026-08-06):** 품목 판매정책이 버전에 담기지 않는 것은 설계 의도다. 품목 *자체의 값*이 아니라 **판매라는 맥락에서 상황에 따라 달라지는 값**이기 때문이다. `.env` 를 코드 저장소에 올리지 않는 것과 같은 갈래다 — private 레포라도 안 올리는 이유는 보안만이 아니라 그것이 *코드*가 아니기 때문이다.

이 스펙은 그 결정을 뒤집지 않는다. 정책은 버전 밖에 남고, 발행과 **같은 시점에** 적용될 뿐이다.

여기서 파생되는 규칙이 하나 있고, 사용자가 직접 지목했다: **어떤 상품의 유일한 변화가 판매정책 변경이라면 새 버전을 만들지 않는다.**

이 스펙은 그것을 한 단계 일반화해 **"버전 필드 변경분이 비어 있으면 버전을 만들지 않는다"**로 잡는다. 특수 케이스를 따로 두면 규칙이 둘이 되고, 지금 있는 무의미한 버전 승격(§3.2)이 그대로 남기 때문이다.

## 3. 현재 상태 실측 (2026-08-06, `914c53bed`)

### 3.1 정책은 두 테이블에 쪼개져 있고 읽기 우선순위가 있다

| 테이블 | 키 | 컬럼 |
|---|---|---|
| `sales_variant_policies` | PK `variant_id` | `pre_stock_sellable` · `always_sellable_zero_stock` · `availability_override` · `coming_soon_date` (`inventory.schema.ts:1608-1623`) |
| `product_matchings` | unique `variant_id` | `pre_stock_sellable` · `always_sellable_zero_stock` **중복 보관** (`:1052-1053`) |

- **쓰기**(`product-sku-mapping.service.ts:389` `updateVariantStockPolicy`): 매칭 행이 있으면 두 곳에 다 쓴다. `availabilityOverride`/`comingSoonDate` 는 `sales_variant_policies` 에만 있다.
- **읽기**(`:196-199`): `matching?.x ?? policy?.x ?? 기본값`. 즉 선판매·항상판매는 **`product_matchings` 가 진실의 원천**이고 `sales_variant_policies` 는 폴백이다.

**이 우선순위를 프리필이 다시 구현하면 안 된다**(§4.1). 규칙이 두 벌이 되는 순간 엑셀에 찍힌 값과 화면 체크박스가 어긋나고, 그 어긋남은 작업자가 "엑셀이 틀렸다"고 신고하기 전까지 안 보인다.

### 3.2 변경분이 비어도 버전이 생긴다

`runDraftSlice`(`bulk-session-job.manager.ts:776`)는 `status='pending'` 인 행을 전부 집어가고, `applyUpdate`(`bulk-draft.applier.ts:116`)는 `fields` 가 `{}` 여도 `createDraftVersion` 을 부른다. 빈 diff 를 담은 새 active 버전이 하나 생기고 발행된다.

### 3.3 발행은 `sales_variant_policies` 를 인계하지 않는다

`_reconcileMatchingsAfterPublish`(`product-versions.service.ts:429`)는 새 active 의 variant 중 매칭이 없는 것에 대해 이전 active 의 **같은 옵션조합** variant 에서 `product_matchings` + `product_variant_sku_links` 를 clone 한다. `sales_variant_policies` 는 대상이 아니다 — 레포 전체에서 그 테이블을 쓰는 곳은 `product-sku-mapping.service` · `product-matching.service` · `product-sellable-quantity.service` 셋뿐이고 발행 경로에 없다.

결과가 필드마다 갈린다:

- **선판매 · 항상 판매** → 살아남는다. `product_matchings` 가 clone 되고 읽기가 matching 을 먼저 보므로.
- **수동 품절 · 출시 예정 · 출시예정일** → **조용히 풀린다.** 새 variantId 에는 policy 행이 없고 폴백이 `null` 이다.

CoW 는 draft 편집 시점에 일어난다(`product-variants.service.ts:390-420`) — 그 variantId 가 다른 버전 정션에도 매달려 있으면 `_cloneVariant` 가 새 행을 만들고 draft 정션만 옮긴다. 즉 **품목코드를 바꾼 수정 행**이 정확히 이 경로다.

> 근거 강도: 코드 경로 추적으로 확립. 실 DB 재현은 하지 않았다. 구현 시 §8 의 통합 테스트가 이것을 먼저 증명해야 한다.

### 3.4 `renderMaster` 는 base 와 current 를 둘 다 만든다

`FormExportSnapshotReader.renderMaster`(`form-export.snapshot.reader.ts:167`)는 양식 생성 시 프리필(=충돌의 `base`)을 만들고, 검증 시 `bulk-session-job.manager.ts:681` 이 **같은 함수를 다시 불러** `current` 를 만든다. 한 곳만 고치면 base·current·diff·충돌 결정이 모두 따라온다.

### 3.5 열 추가는 평면화까지 자동으로 흐른다

`flattenBundle`(`bulk-session.fields.ts:57`)은 `VARIANT_COLUMNS` 를 정체성 키만 빼고 전부 훑는다. `fieldLabel`(`:140`)도 `LABEL_BY_KEY` 를 통해 열 정의에서 파생된다. **열만 더하면 payload·diff·충돌·라벨이 공짜로 따라온다** — 그래서 반대로, 따라오면 안 되는 곳을 막는 것이 §5 의 일이다.

### 3.6 NULL `draft_version_id` 는 이미 견디는 경로가 많다

제외(`bulk-session.manager.ts:629`)와 정리(`:733`)는 `if (draftVersionId)` 로 감쌌고, 이미지 청소기(`bulk-image.cleaner.ts:106`)는 `isNotNull` 로 거른다. 손볼 곳은 발행(`publishOne`) 하나다.

### 3.7 마이그레이션이 필요 없다

컬럼도 enum 값도 추가하지 않는다. 새 상태는 기존 `draft_version_id`(이미 nullable)의 NULL 로 표현하고, 정책값은 이미 있는 두 테이블에 쓴다.

## 4. 설계 — 양식과 프리필

### 4.1 조합 시트에 5열 추가

`VARIANT_COLUMNS`(`form-export.sheets.ts:74`)에 붙인다. 전부 optional 이다.

| key | label | 값 | 빈칸의 뜻 |
|---|---|---|---|
| `availabilityOverride` | 판매상태재정의 | `품절` / `출시예정` | 해제 (프리필이 값을 찍었을 때) |
| `comingSoonDate` | 출시예정일 | `YYYY-MM-DD` | 날짜 없음 |
| `preStockSellable` | 선판매 | `Y` / `N` | 변경 없음 |
| `alwaysSellableZeroStock` | 항상판매 | `Y` / `N` | 변경 없음 |

**해제를 위한 별도 센티넬(`없음` 같은 것)을 두지 않는다.** 이 양식의 수정 행 적용분은 `computeChanges(base, mine)` 로 만든 **차분**이다(`bulk-session-job.manager.ts:694`, `bulk-session.diff.ts:9`). 즉 `품절` 이 찍혀 있던 칸을 작업자가 지우면 `'' ≠ '품절'` 이라 **차분에 빈 문자열이 실려** 해제 의도가 그대로 표현된다. 반대로 손대지 않은 칸은 base 와 같아 차분에 아예 없다 — 1,000행 양식에서 30건만 고친 파일이 나머지 970건을 해제하는 일은 구조적으로 일어나지 않는다.

이것은 이 워크북의 기존 규약이기도 하다: 구매제약 시트가 **"해제는 값 칸을 비워서 표현한다"**를 이미 그렇게 못박고 있다(`bulk-upload.assembler.ts:28`). 정책 열만 다른 규칙을 쓰면 작업자가 두 규약을 외워야 한다.

**"빈칸 = 변경 없음"이 걸리는 축은 따로 있고, 그 둘은 이미 다뤄져 있다** — 열을 통째로 지운 경우는 `present`(`bulk-session.fields.ts:20-30`)가, 행을 지운 경우는 행 부재 규약이 막는다.

`선판매`·`항상판매` 만 빈칸이 "변경 없음"인 이유: Y/N 두 상태밖에 없는 칸을 비우는 것은 해제가 아니라 **지시 없음**이다. 비운 칸을 `false` 로 읽으면 작업자가 행을 정리하다 지운 칸이 선판매를 끄는 지시가 된다.

수동 품절과 출시 예정을 **한 열**로 합친 것은 DB(`availability_override`)와 1:1 이기 때문이다. Y/N 열 둘로 쪼개면 "둘 다 Y" 를 검증 오류로 잡는 규칙이 필요하고, 작업자는 그 오류를 실제로 만든다.

### 4.2 프리필은 화면과 같은 우선순위로 읽는다

`renderMaster` 의 `variantsOut.push`(`form-export.snapshot.reader.ts:259`)에 5값을 채운다. 읽기는 **`ProductSkuMappingService.getVariantMatchingBatch` 를 주입해** 쓴다 — 두 테이블을 직접 조회하고 `matching ?? policy ?? 기본값` 을 재구현하지 않는다(§3.1).

- 배치 API 는 최대 500건 제한이 있다(`product-sku-mapping.service.ts:98`). `renderMaster` 는 master 하나당 호출이므로 한 상품의 품목 수가 500 을 넘지 않는 한 문제없고, 넘으면 청크 분할한다.
- 모듈 경계: catalog(PIM) 서비스가 product-matching 서비스를 부른다. ADR-0004 가 `publishVersion` 의 inventory 직접 접근을 이미 같은 근거(core 가 PIM+WMS 통합 앱)로 정당화했다. **테이블 직접 접근이 아니라 서비스 주입**이므로 그때보다 약한 침범이다.

프리필이 채워지면 `base`(양식 생성 시점)와 `current`(검증 시점)가 같은 함수에서 나오므로(§3.4) **충돌 검사는 코드 추가 없이 정책 필드에 적용된다.** 빈칸=변경 없음이므로 작업자가 안 건드린 정책은 payload 에 없고 충돌 대상도 아니다. 충돌은 "내가 값을 적었는데 그 사이 남이 바꾼 경우"만 뜬다 — 입고로 `coming_soon` 이 자동 해제된 경우(ADR-0028)가 대표적이고, 그것이 조용히 되돌아가지 않는 것이 이 설계의 목적이다.

### 4.3 값 검증

`bulk-session.validator.ts` 에 조합 스코프 규칙을 더한다.

- `판매상태재정의` — `품절` · `출시예정` · 빈칸 외의 값은 행 오류.
- `출시예정일` — `YYYY-MM-DD` 파싱 실패는 행 오류. **같은 행의 `판매상태재정의` 가 `출시예정` 이 아닌데 날짜가 있으면 행 오류**다. 서버는 `coming_soon` 이 아니면 날짜를 비우므로(`product-sku-mapping.service.ts:50-56`) 조용히 버려지고, 작업자는 자기가 넣은 날짜가 사라진 것을 모른다. 검증기는 차분이 아니라 **업로드된 시트 행 전체**를 보므로(`bulk-session.validator.ts:343`) 이 교차 검사가 가능하다.
- `선판매` · `항상판매` — `Y`/`N`/빈칸 외는 행 오류. 다른 boolean 열(`해외직구` 등)과 같은 파서를 쓴다.

## 5. 설계 — 버전 기계에서 정책을 떼어내기

§3.5 때문에 정책 경로가 버전 적용기까지 자동으로 흘러든다. 두 곳을 막는다.

1. **`bulk-draft.applier.ts:135` 의 `touchesVariant`** — 지금은 `scope === 'variant'` 인 경로가 하나라도 있으면 참이다. 정책 키를 제외한다. 안 막으면 정책만 채운 행이 `resolveExistingCombos`(품목마다 옵션값 조회 — N+1)를 깨우고, 더 나쁘게는 CoW 경로를 탄다.
2. **`buildVersionData` 계열** — 정책 경로는 버전 데이터가 아니므로 무시한다. 대신 **별도 추출기**가 `fields` 에서 `조합키 → 정책 패치` 를 뽑는다.

정책 키 목록은 한 곳(`VARIANT_POLICY_KEYS`)에만 둔다. 두 벌이 되면 한쪽만 고쳤을 때 정책이 버전 데이터로 새거나 그 반대가 된다.

**추출기는 순수 함수다** — 차분 `FlatFields` 와 업로드된 조합 시트 행들을 받아 `Map<조합키, UpdateVariantStockPolicyDto>` 를 돌려준다. 워크북 문자열(`품절`/`Y`/빈칸)을 DTO 값(`'manual_out_of_stock'`/`true`/`null`)으로 옮기는 판정이 전부 여기 모이고, 그래서 DB 없이 테스트된다.

**`판매상태재정의` 와 `출시예정일` 은 한 단위로 움직인다.** 둘 중 하나라도 차분에 있으면 **둘 다** 시트 행에서 읽어 패치에 싣는다. `upsertSalesVariantPolicy` 가 `comingSoonDate` 를 `availabilityOverride` **키의 존재**로 게이팅하기 때문이다(`product-sku-mapping.service.ts:47-56`) — 날짜만 실어 보내면 조용히 버려진다. 이 게이팅은 화면의 동작과도 일치한다(출시예정 체크박스 하나가 날짜까지 소유한다).

차분은 값이 바뀐 키만 담으므로, 날짜만 고친 행의 차분에는 `availabilityOverride` 가 없다. 그래서 추출기가 **차분만으로는 부족하고** 시트 행이 필요하다. `draftOne` 이 이미 같은 이유로 원본 조합 시트 행(`item.input.bundle.variants`)을 applier 에 넘기고 있다(`bulk-session-job.manager.ts:1089`) — 같은 출처를 쓴다.

`선판매`·`항상판매` 는 빈칸이 "지시 없음"이므로(§4.1) 차분에 빈 문자열로 실려 와도 **패치 키를 만들지 않는다.**

## 6. 설계 — 발행

### 6.1 버전 없는 행

`applyUpdate`(`bulk-draft.applier.ts:99`)가 적용분을 계산한 뒤, **버전 필드 변경분이 비어 있으면 `createDraftVersion` 을 부르지 않고** `status='drafted'` · `draft_version_id=NULL` 로 적는다. 정책만 바뀐 행과 완전 무변경 행이 같은 경로다.

**판정은 `applyDecisions` 뒤에 한다.** 그 함수가 충돌 결정이 `skip` 인 필드를 적용분에서 빼므로(`:111`), 작업자가 충돌 필드를 전부 `skip` 으로 결정한 행은 **결정 후에야** 비게 된다. 앞에서 재면 그 행이 빈 버전을 만든다.

**신규(create) 행은 예외 없이 버전을 만든다** — master 자체가 없으므로 "변경분이 비었다"가 성립하지 않는다. 정책 열을 비워 둔 신규 행은 서버 기본값을 갖는다.

### 6.2 `publishOne` 의 갈래

`publishOne`(`:895`)은 지금 `draftVersionId` 가 없으면 무조건 실패시킨다(`:897`). 갈래로 바꾼다. **관문 ①②의 순서는 계약이므로 건드리지 않는다**(모체 스펙 §10.4).

```
① 세션 행 FOR UPDATE + 취소 재확인      ← 그대로
② 행 상태 재확인                          ← 그대로
   draftVersionId 가 있으면:
     ③ 발행 시점 가드 (active.id === draft.parentVersionId)
     ④ bulk_session_id 선해제 → publishVersion
③′ 정책 패치 적용 (있으면)
   publishStatus = 'published'
```

**③′ 이 발행 뒤인 것이 계약이다.** 신규 행은 발행되어야 variant 가 존재하고, 수정 행은 CoW 로 갈린 variantId 가 §6.3 의 인계를 받은 뒤라야 덮어쓰기가 의미를 갖는다.

**조합 → variantId 해석은 발행 트랜잭션 안에서 한다.** draft 시점에 풀어 저장하지 않는 이유: 정책만 바뀐 행은 발행 시점 가드(③)가 없어 draft 와 publish 사이에 남이 새 버전을 발행할 수 있고, 그러면 저장해 둔 variantId 가 고아를 가리킨다. 해석에 쓰는 버전은 draft 가 있으면 그 버전(발행되어 active 가 된 것), 없으면 `masterId` 의 현재 active 다.

`resolveExistingCombos`/`resolveCreatedCombos`(`bulk-draft.applier.ts:238,361`)는 지금 applier 의 private 이다. 발행 경로도 쓰므로 **공용 모듈로 추출한다**(복제하지 않는다). 수정 행의 조합키는 이미 optionValueId 결합이고 신규 행은 이름 기반이라는 비대칭이 그 두 함수의 존재 이유이므로, 둘 다 그대로 옮긴다.

**해석 실패는 그 행의 실패다.** 조합키가 안 풀리면 조용히 건너뛰지 않고 `failPublish` 로 사유를 남긴다 — 정책이 적용되지 않았는데 "발행됨"으로 보이는 것이 이 기능에서 가장 나쁜 침묵이다.

적용은 `ProductSkuMappingService.updateVariantStockPolicy(variantId, patch, trx)` 를 그대로 부른다. 그 메서드가 두 테이블 쓰기·`coming_soon` 날짜 정리·projection 재계산·이벤트 발행을 이미 한 트랜잭션 안에서 한다. 실패는 던져지고 바깥 catch 가 `classifyPublishError` 로 분류해 그 행만 죽인다 — 발행까지 함께 롤백되어 재시도가 온전한 상태에서 다시 시작한다.

### 6.3 CoW 를 건너 정책을 잇는다

`_reconcileMatchingsAfterPublish`(`product-versions.service.ts:429`)에 `sales_variant_policies` 인계를 더한다. 이미 만들어 둔 `prevByComboKey`(`:461`)를 그대로 쓴다: 새 active 의 variant 중 **policy 행이 없는 것**에 대해, 이전 active 의 같은 옵션조합 variant 의 policy 행을 새 variantId 로 clone 한다.

**매칭 인계와 조건이 독립이어야 한다.** 매칭이 이미 있는 variant 도 policy 행은 없을 수 있으므로, 매칭 인계에서 걸러진 집합을 재사용하면 안 된다.

이것은 §2 의 결정을 뒤집지 않는다. 버전 관리는 "값을 버전에 담는가"의 문제이고, 이 인계는 "**같은 상품의 같은 품목인데 내부 UUID 가 갈렸다**"를 잇는 것이다. `product_matchings` 가 이미 같은 이유로 같은 자리에서 인계된다.

§6.2 의 ③′ 이 이 인계보다 **뒤**에 오므로, 작업자가 양식에 적은 값이 인계된 값을 이긴다.

## 7. 설계 — admin-web

**이 부분은 서버를 건드리지 않는다** — §4~§6 밖에서 추가로 필요한 API·DTO 변경이 없다는 뜻이다. 아이템 DTO 가 이미 `draftVersionId` 와 `changes` 를 내려준다(`bulk-session.reader.ts:322-374`). 세 상태가 그대로 파생된다:

| 조건 | 표시 |
|---|---|
| `draftVersionId != null` | 발행됨 |
| `draftVersionId == null` ∧ `changes.length > 0` | 정책만 적용 |
| `draftVersionId == null` ∧ `changes.length === 0` | 변경 없음 |

판정은 **`lib/` 의 순수 함수**로 뽑는다 — admin-web 은 컴포넌트 테스트가 불가능하므로(`[[admin-web-no-component-tests]]`, 렌더러 없음 + `.tsx` 가 transform 밖) `.ts` 로 뽑지 않으면 검증되지 않는다. `session-labels.ts` 가 선례다.

**요약 카운트는 쪼개지 않는다.** 발행 패널 상단의 집계는 `publish_status` 로 그룹핑한다(`bulk-session.reader.ts:161`). 버전 유무로 쪼개려면 `CASE WHEN` 집계가 하나 늘고, 이 레포에서 그 의미론은 실 DB 통합 테스트만이 방어선이었다(모체 스펙의 `drizzle-row-matcher` 이력). 행마다 라벨이 붙는 것으로 충분하다고 판단한다.

`product-bulk-form` AI 스킬이 읽는 열 문서(`form-export.columns-doc.ts`)에 새 열 4종의 설명과 허용값을 넣는다. **`없음` 과 빈칸의 차이가 그 문서에 명시되어야 한다** — 스킬이 양식을 대신 써 주는 경로가 이미 라이브다.

## 8. 테스트

**유닛 (DB 없음)**

- 정책 추출기: 워크북 문자열 → DTO 값. `없음`→`null`, 빈칸→키 부재, `품절`→`'manual_out_of_stock'`.
- 검증기: 4종 값 검증 + "출시예정이 아닌데 날짜가 있다" 오류.
- `touchesVariant`: 정책 키만 있는 `fields` 에 대해 **거짓**.
- 빈 변경분 판정: 정책 경로만 있는 payload 는 "버전 필드 변경분 없음".
- admin-web 라벨 함수: 세 상태.

**통합 (실 DB — `bulk_stage*_scratch`)**

이 스펙에서 유닛으로는 못 잡는 것이 셋이다.

1. **§3.3 의 유실을 먼저 재현한다.** 품목코드를 바꾼 수정 행을 발행해 `sales_variant_policies` 가 새 variantId 에 없음을 확인하고, §6.3 을 넣은 뒤 초록이 되는지 본다. **역검증**: §6.3 을 되돌리면 이 테스트가 실제로 빨개지는지 확인한다.
2. **버전 없는 행의 발행.** 정책만 채운 행이 새 버전을 만들지 않으면서 정책은 적용되는지. 그리고 무변경 행이 아무것도 만들지 않는지.
3. **조합 해석 실패가 행 실패로 남는지.** 조용히 건너뛰지 않는 것이 §6.2 의 계약이다.

통합 DB 호출법은 모체 스펙과 같다 — 환경변수 접두가 `dotenv -e` 를 이긴다:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/bulk_stage6_scratch npm run test:bulk-session:integration
```

**게이트**: `type-check:scoped` + 범위 jest + 통합 + 변경 파일 기준 lint 차분. 전역 `npm test`·`tsc`·`lint` 는 develop 에서도 red 다(`[[lint-scope-caveat]]`).

## 9. 배포

- **마이그레이션 0건 · 시크릿 0 · env 0 · 이벤트 계약 0.**
- **core 선배포가 필수는 아니다** — admin-web 변경이 라벨 파생뿐이고 새 API 를 부르지 않는다. 옛 core 가 내려준 DTO 로도 `draftVersionId`/`changes` 는 이미 존재하므로 라벨이 잘못 뜨지 않는다.
- 배포 후 첫 양식 생성부터 새 열이 나온다. **그 이전에 만들어진 양식에는 정책 열이 없고**, 업로드 시 열 부재 = "이 필드는 이번에 안 건드림"이므로(`present` 규약) 안전하다.

## 10. 하지 않는 것

- `product_matchings` 와 `sales_variant_policies` 의 정책 컬럼 중복 정리. 읽기 우선순위(§3.1)가 그 중복 위에 서 있어 손대면 화면·프로젝션·채널 전파가 함께 움직인다. 별건이다.
- 정책 열을 상품 시트에 두어 전 품목 일괄 적용. 화면의 헤더 일괄 체크박스와 대응되나, 조합 시트의 행 단위 값과 충돌 규칙이 하나 더 필요해진다. 필요해지면 후속.
- 발행 요약 카운트의 분해(§7).
- 화면에서 정책을 바꿀 때의 감사 로그. 지금도 없고 이 스펙이 늘리지 않는다.
- **`판매상태재정의`·`출시예정일` 쌍의 필드 단위 충돌 해소.** 둘은 한 단위로 움직이므로(§5), 날짜만 고친 행이 발행될 때 그 사이 남이 `판매상태재정의` 를 바꿨다면 그 변경은 충돌로 뜨지 않고 시트 값으로 덮인다 — 차분에 그 키가 없어 `detectConflicts` 의 대상이 아니기 때문이다. 창이 좁고(검증~발행) 영향이 한 품목이라 감수한다. 다른 세 필드는 정상적으로 충돌 검사를 받는다.
