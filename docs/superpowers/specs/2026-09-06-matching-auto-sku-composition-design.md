# 매칭 「자동 SKU 구성 매칭」 복구 — resolve 를 깊게 (#791)

- 이슈: [#791](https://github.com/LCNINE/almondyoung-server/issues/791) (bug · p2)
- 발견 경위: 2026-09-06 로컬 E2E 전 구간 검증 · `docs/local-e2e-environment.md` §8-D 벽 ②
- 브랜치: `fix/matching-auto-sku-composition` (base `f5afc8166`)
- **DB 마이그레이션: 0건** · 배포 순서 제약: 없음 (권장 `core → admin-web`)

## 한 문장

어드민 매칭 다이얼로그의 auto 탭이 `POST /inventory-matching` 을 부르는데 **core 에 그 라우트가
한 번도 없었다.** 새 엔드포인트를 만드는 대신, 기존 `resolve`/`upsert` 의 링크 항목을 «기존 SKU
참조 **또는** 새로 만들 SKU 정의»로 넓혀 SKU 생성·링크·상태전이를 **한 트랜잭션**에 넣는다.

## 이슈 본문에서 보강·정정된 전제 5건

착수 전 실측에서 나온 것들이다. 설계는 정정된 사실 위에 선다.

### 1. 🔴 뒷단은 하나가 아니라 «둘» 이다 — resolve 만 넓히면 절반만 고쳐진다

이슈는 auto/manual 이 「뒷단이 이미 같다」고 적었지만, `saveSkuComposition`
(`InventoryMatchingDialog.tsx:423`) 은 매칭 상태를 보고 **다른 엔드포인트로 갈라진다**:

| 조건 | 호출 | 링크 필드 |
|---|---|---|
| `matchingStatus === 'pending'` | `PATCH /matchings/:id/resolve` | `skuMappings[]` |
| 그 외 (`matched` 등) | `PUT /matchings/:variantId` | `links[]` |

`ResolveMatchingDto` 만 넓히면 **이미 matched 인 판매상품에서 auto 탭은 여전히 동작하지 않는다.**
두 DTO 의 링크 항목을 같은 타입으로 넓혀야 기능이 완성된다.

### 2. 🔴 `validate()` 가 트랜잭션 밖을 읽는다 — 이걸 안 고치면 무조건 400

`VariantMatchingStrategy.validate()` 는 `this.db` 로 SKU 존재를 확인한다
(`variant-matching.strategy.ts:50`, `:56`). 이 메서드는 `resolveMatchingPending` 의
`dbService.run` **안에서** 불리지만(`product-matching.service.ts:911`), 읽기는 트랜잭션 밖으로
나간다.

즉 **같은 tx 에서 방금 만든 SKU 는 커밋 전이라 `validate` 에게 보이지 않는다** →
`Invalid SKU mappings for the selected strategy` 400. 기능이 조용히 죽는 게 아니라 100% 실패한다.

`MatchingStrategy.validate` 시그니처에 `tx?` 를 뚫는 것은 **선택이 아니라 전제조건**이다.

### 3. 🔴 `matchings/*` 는 스코프 사각지대 — 그냥 얹으면 권한 우회가 된다

| 라우트 | 지금 요구하는 것 |
|---|---|
| `POST /inventory/skus` (SKU 생성) | `AdminRealmGuard` + **`inventory.manage`** (`sku-catalog.controller.ts:34`) |
| `PATCH /matchings/:id/resolve` | `AdminRealmGuard` 만 — **`@RequireScopes` 없음** |
| `PUT /matchings/:variantId` | 같음 |

[#716](https://github.com/LCNINE/almondyoung-server/pull/716)(#551, MERGED)이 부여한 스코프는
`apps/core/src/modules/inventory/**` 만 훑는다. `modules/product-matching` 은 그 커버리지
스펙(`inventory-scope-coverage.spec.ts`)의 스캔 범위 밖이라 **표에도, 검사에도 없다.**

따라서 resolve 에 SKU 생성 능력을 조건 없이 얹으면 `inventory.manage` 없는 계정이
`matchings` 경유로 SKU 를 만들 수 있게 된다 — 그 스코프를 만든 이유를 무력화한다.

### 4. `createNewSkuForMatching()` 은 호출자 0곳 — 지금 필요한 것의 반쯤 만든 조상

`product-matching.service.ts:1167`. 전 저장소 grep 결과 호출자가 없다. 매칭용 SKU 생성을
`SkuCatalogService.create` 로 위임하는 모양까지는 맞는데, 추가로 기본 창고에 수량 0
`stock_events` 를 심는다(`getDefaultId` → `createStockEntryBySkuId`). 이 설계는 그 부분을
계승하지 않는다 — 근거는 §「안 하기로 한 것」 3.

### 5. 문서 §8-D 의 「prompt 라 자동화가 못 지난다」는 오진

`handleCreateSupplier`(`:326`) · `handleCreateHolder`(`:343`) 는 `prompt()`/`confirm()` 을 쓰지만
**어디서도 참조되지 않는다.** 「신규 등록」 버튼의 실제 핸들러는 `setShowSupplierSearch(true)` 이고,
생성은 `SearchDialog` 의 `onCreate` (`:1255`, `:1266`) 로 간다.

자동화를 실제로 막는 것은 그 파일의 **`alert()` 14곳**이다 — 그중 4곳(`:334`·`:337`·`:355`·`:358`)은
죽은 핸들러 안에 있으므로 함께 사라지고, **10곳이 교체 대상**이다. 정리 대상이 바뀐다:
죽은 prompt 핸들러 둘은 **삭제**, 남은 `alert()` 는 **toast 로 교체**.

## 결정된 사항

| # | 결정 | 근거 |
|---|---|---|
| 1 | **공유 link 타입으로 `resolve` 와 `upsert` 를 둘 다 넓힌다** | 전제 1. 별도 `POST /matchings/:id/skus` 는 인터페이스가 둘로 남고 호출자가 순서를 알아야 해 이슈 본문 스스로 열등하다고 판정 |
| 2 | **`newSku` 타입은 core 의 `CreateSkuDto` 를 그대로 재사용** | 새 타입을 만들면 필드 대응표를 두 벌 유지해야 한다. 옛 `CreateInventoryMatchingDto` 는 도메인 계약이 아니라 그 시절 폼 스펙이므로 되살리지 않는다 |
| 3 | **갈 곳 없는 필드는 화면에서 뺀다 — core 모델을 넓히지 않는다** | 원가는 발주 도메인 소유(`purchase_order_lines.unit_price`), 나머지 다섯은 core 에 대응 컬럼 0건. 지금 받으면 전부 write-only 로 버려진다. 필요해지면 그때 별도 모델링 결정 |
| 4 | **「물류처」 필드를 삭제한다** | `skus` 에 창고 컬럼이 없다. 창고가 정해지는 시점은 매칭이 아니라 입고다. 드롭다운은 `useWarehouses()`(창고)인데 core 의 유사 필드 `skus.logisticsPartnerId` 는 `suppliers.id` 참조(`inventory.schema.ts:614`) — 축이 다르므로 조용히 이어붙이지 않는다 |
| 5 | **`newSku` 가 payload 에 있을 때만 `inventory.manage` 를 요구한다** | 전제 3. 라우트 전체에 `@RequireScopes` 를 붙이면 (a) 지금 매칭만 하던 계정이 403 (b) `AdminRealmGuard` 가 비켜서서(`admin-realm.guard.ts:47`) 오히려 직원 역할 검사가 사라진다. 단조 안전하지 않다 |
| 6 | **`links[].quantity` 를 요청에서 받는다** | 반환된 SKU 들은 한 variant 의 구성품으로 링크된다(`product_variant_sku_links.quantity`) — 사실상 세트 구성인데 지금 화면은 수량을 못 받는다 |
| 7 | **옵션행 이미지 칼럼을 뺀다** | 지금 `URL.createObjectURL()` 의 blob URL 이라 저장돼도 죽은 링크다. admin-web 의 어느 SKU 화면도 이미지를 올리지 않는다. 배관(`upload.client.ts`·`image-compress.ts`)은 있으므로 필요해지면 별도 작업 |

## 계약 — 공유 link 타입 하나

신규 `apps/core/src/modules/product-matching/dto/matching-link-input.dto.ts`:

```ts
export class MatchingLinkInputDto {
  @IsOptional() @IsUUID()
  skuId?: string;

  @IsOptional() @ValidateNested() @Type(() => CreateSkuDto)
  newSku?: CreateSkuDto;

  @IsOptional() @IsInt() @Min(1)
  quantity?: number = 1;
}
```

`skuId` 와 `newSku` 는 **정확히 하나**여야 한다. 같은 파일에 커스텀 class-validator
constraint 를 두어 **DTO 경계에서 400** 을 낸다 — 서비스까지 내려가지 않는다. 둘 다 없거나
둘 다 있으면 거부.

두 DTO 의 변경:

| DTO | 변경 | 호환성 |
|---|---|---|
| `ResolveMatchingDto` | `links?: MatchingLinkInputDto[]` **추가**. `skuIds`·`skuMappings` 는 남기고 `deprecated` 표시 | 순수 추가 — 기존 호출자 무영향 |
| `UpsertMatchingDto.links` | 항목 타입을 `MatchingLinkInputDto` 로 교체 (`skuId` 가 required → optional) | 순수 완화 — 기존 payload 그대로 통과 |

요청 예시:

```jsonc
// PATCH /matchings/:id/resolve
{
  "strategy": "variant",
  "stockPolicy": { "preStockSellable": true },
  "links": [
    { "skuId": "0192…", "quantity": 2 },
    { "newSku": { "name": "S / 검정", "holderId": "…", "supplierIds": ["…"] }, "quantity": 1 }
  ]
}

// PUT /matchings/:variantId  — 이미 matched 인 판매상품, 같은 모양
{ "links": [ … ] }
```

**우선순위**: `links` 가 오면 그것만 본다. 없으면 기존 `skuMappings` → `skuIds` 순으로 폴백
(현행 동작 유지).

## 실행 — 리졸버 하나, 트랜잭션 하나

신규 `apps/core/src/modules/product-matching/services/matching-link-resolver.ts`:

```
resolve(links: MatchingLinkInputDto[], trx: DbTx): Promise<SkuQuantityMapping[]>
  · newSku 가 있으면 skuCatalogService.create({ ...newSku, source: AUTO_MATCHING }, trx)
  · skuId 가 있으면 그대로 통과
  · 입력 순서 보존, quantity ?? 1
  · source 는 호출자 지정을 무시하고 강제 — 다만 SkuCatalogManager.create 가 구조분해로
    source 를 버리고 skus 테이블에 대응 컬럼이 없어 **현재는 저장되지 않는다**. 계약상
    의도를 남겨두는 값이며, 감사가 필요해지면 컬럼 추가가 선행돼야 한다
```

`SkuCatalogModule` 은 이미 `ProductMatchingModule` 이 import 하고 있으므로 배선 추가는 없다.

호출 지점 둘 — **각자 자기 `dbService.run` 안에서** 부른다:

```
ProductMatchingService.resolveMatchingPending      (product-matching.service.ts:856)
  dbService.run(trx =>
    mappings = linkResolver.resolve(links, trx)     ← SKU 생성이 여기 들어온다
    strategy.validate(context, mappings, trx)       ← tx 를 넘긴다 (전제 2)
    strategy.create(context, mappings, trx)
    productMatchings 상태전이 + 정책 upsert
    productSellableQuantity.recalculate… / fulfillmentBacklog.wake…
  )

ProductSkuMappingService.upsert                    (product-sku-mapping.service.ts:294)
  dbService.run(trx =>
    mappings = linkResolver.resolve(dto.links, trx)
    기존 링크 delete → insert
    … 이하 현행 그대로
  )
```

`ProductSkuMappingService` 는 ADR-0025 cross-BC seam 이라 `DbService<MergedSchema>` / `AnyTx` 로
선언돼 있다. 이미 같은 파일에서 `MergedTx` 를 `DbTx` 파라미터에 그대로 넘기고 있으므로
(`upsertSalesVariantPolicy(trx, …)`) **추가 캐스팅은 두지 않는다.** `asTx(tx as unknown)` 류
탈출구는 금지(CLAUDE.md).

### `validate` 시그니처 확장

```
MatchingStrategy.validate(context, mappings, tx?: DbTx)   // 추상
  VariantMatchingStrategy — (tx ?? this.db) 로 읽는다
  VoidMatchingStrategy    — mappings.length === 0 만 보므로 tx 무시
```

`VariantMatchingStrategy.validate` 의 존재 확인 한 문장은 `db.query.skus.findFirst` →
`trx.select().from(skus).where(inArray(...))` 로 바꾼다. **CLAUDE.md 의 inventory 쿼리 규칙
(`db.query.*` 금지)** 을 따르는 김에 N번 왕복도 1번으로 줄어든다.

## 인가 — 새 능력에만 새 요구

신규 `apps/core/src/modules/product-matching/guards/new-sku-scope.guard.ts`:

```
NewSkuScopeGuard
  · request.body.links 에 newSku 가 하나도 없으면 → true (통과, 현행 동작 그대로)
  · 하나라도 있으면 → AuthorizationService.getScopesByRoles(user.roles) 로
      inventory.manage 보유 확인. 없으면 ForbiddenException
  · master 역할은 ScopeGuard 와 같은 규칙으로 통과
```

`@UseGuards(NewSkuScopeGuard)` 를 `PATCH /matchings/:id/resolve` 와 `PUT /matchings/:variantId`
두 핸들러에 붙인다.

**왜 `@RequireScopes` 를 안 쓰는가**: 그 데코레이터를 붙이면 `AdminRealmGuard` 가
「정책이 이미 명시됨」으로 보고 직원 역할 검사를 **건너뛴다**(`admin-realm.guard.ts:47`).
스코프를 부여하면서 역할 검사를 잃는 교환이 된다. 커스텀 가드는 데코레이터를 남기지 않으므로
`AdminRealmGuard` 가 그대로 지킨다. `scope-guard-binding.spec.ts`(`@RequireScopes` ↔ `ScopeGuard`
짝 검사)도 건드리지 않는다.

`AuthorizationModule` 은 `@Global()` 이므로 `AuthorizationService` 주입에 모듈 import 추가는 없다.

## 화면 — 탭 분기가 사라진다

```
onSave()
  auto   ─┐
  manual ─┴─→ saveSkuComposition(links)      links[i] = { skuId } | { newSku }
  none   ───→ resolve(strategy: 'void')
```

auto 탭은 더 이상 「① SKU 만들고 → ② 매칭한다」가 아니라 **한 번 부른다.** 실패해도 고아 SKU 가
남지 않는다.

### 필드 매핑

| 화면 (남음) | `CreateSkuDto` | 필수 |
|---|---|---|
| 사입상품명 | `businessProductName` | |
| 공급처(발주처) | `supplierIds: [id]` | ✔ |
| 재고소유 | `holderId` | ✔ |
| 수입신고필증 | `importDeclarationNumber` | |
| 옵션상세명칭 | `optionKey` | |
| 상품설명 · MOQ · 메모2 · 메모3 | 동명 | |
| 옵션행 「옵션상세명칭」 | `name` | ✔ (행당) |
| 옵션행 **「수량」(신설)** | `links[].quantity` | |

| 사라지는 것 | 왜 |
|---|---|
| 원가 · 「대표원가 적용」 버튼 · 옵션행 원가 칼럼 | `grep costPrice apps/core/src` → 0건. 원가는 발주 도메인 |
| 물류처 (창고 드롭다운) | 결정 4 |
| 상품 구분 · 용도 · 수입상고필증 · 메모1 · 메모4 | core 대응 0건 |
| 옵션행 이미지 칼럼 | 결정 7 |

### 판정 로직은 순수 모듈로

**admin-web 은 컴포넌트 테스트가 구조적으로 불가하다** — `package.json:154` 의 `test:admin-web` 은
`^.+\.(t|j)s$` 만 transform 하므로 `.tsx` 는 아예 변환되지 않는다. 따라서 **판정은 `.tsx` 밖으로 뺀다.**

신규 `apps/admin-web/src/features/order/matching/lib/build-matching-links.ts`
+ `build-matching-links.spec.ts`:

```
buildMatchingLinks(input: AutoTabState): { ok: true; links } | { ok: false; reason }
  · 옵션행 중 name 이 빈 행은 버린다
  · 남은 행이 0개면 reason: 'no-options'
  · holderId / supplierId 미선택이면 reason: 'missing-required'
  · quantity 는 1 이상 정수로 정규화
```

컴포넌트는 이 함수의 결과를 toast 로 옮기기만 한다.

## 삭제 목록

| 위치 | 대상 | 근거 |
|---|---|---|
| core | `modules/inventory/core/dto/product-matching/` **5 파일** | import 0건. 실사용은 `product-matching/dto/` 쪽 |
| core | `ProductMatchingService.createNewSkuForMatching` (`:1167`) | 호출자 0곳 · 이 설계가 그 자리를 대체 |
| admin-web | `inventoryMatchingApi.{create,list,get}` (`api/domains/inventory/index.ts:52-72`) | 백엔드 없음 |
| admin-web | `useCreateInventoryMatching` · `useInventoryMatchings` · `useInventoryMatching` | 위 클라이언트 전용 |
| admin-web | `inventoryQueryKeys.inventoryMatching(s)` | 위 훅 전용 |
| admin-web | `CreateInventoryMatchingDto` · `InventoryMatchingResponseDto` · `InventoryOptionDto` | 위 전용 |
| admin-web | `handleCreateSupplier`(`:326`) · `handleCreateHolder`(`:343`) · `showSupplierCreate` · `showHolderCreate` | 참조 0곳 (전제 5) |
| admin-web | `alert()` 14곳 중 남는 10곳 → `sonner` toast | 브라우저 모달이 자동화를 막는다. `sonner` 는 저장소가 이미 쓴다(`sku-form-dialog`) |

## 안 하기로 한 것 (YAGNI)

1. **`skus` 컬럼 추가** — 결정 3. 마이그레이션 0건인 이유.
2. **옵션 이미지 업로드 배선** — 결정 7. 배관은 있으나 이번 목적에 필요 없다.
3. **새 SKU 에 수량 0 원장 심기** — 폐기되는 `createNewSkuForMatching` 이 하던 일.
   현재 SKU 생성 정본인 `sku-form-dialog` → `POST /inventory/skus` 도 원장을 심지 않는다.
   여기서만 심으면 «어떻게 만들었느냐»에 따라 원장이 달라진다. 게다가
   `WarehouseService.getDefaultId` 는 라이브 창고 id 가 상수와 어긋나 있어 실패 여지가 있다.
   재고를 여는 것은 입고다(ADR-0028).
4. **`product-matching` 라우트를 스코프 커버리지 표에 편입** — `inventory-scope-coverage.spec.ts`
   는 `modules/inventory` 전용이다. 범위를 넓히면 `matchings` 15개 라우트 전부에 스코프 판정이
   필요해져 이 PR 의 범위를 벗어난다. **후속 이슈로 남긴다** (전제 3 이 그 근거 자료).
5. **`skuMappings`/`skuIds` 제거** — deprecated 표시만. 실제 제거는 호출자 정리 후 별도 contract
   단계(ADR-0005 §5).

## 검증

```bash
npm run type-check                        # 0 (spec 포함)
npx jest --maxWorkers=2                   # 0 실패 (OOM 회피)
cd apps/admin-web && npx tsc --noEmit     # 루트 게이트가 안 보는 곳
```

신규 스펙:

| 파일 | 무엇을 지키나 |
|---|---|
| `matching-link-input.dto.spec.ts` | `skuId`/`newSku` 배타 — 둘 다 · 둘 다 없음 · 각각 하나 |
| `matching-link-resolver.spec.ts` | 순서 보존 · `source` 강제 · `quantity` 기본값 · 기존/신규 혼합 |
| `new-sku-scope.guard.spec.ts` | `newSku` 없으면 통과 · 있고 스코프 없으면 403 · `master` 통과 |
| `product-matching.service.spec.ts` (확장) | `links` 경로 · 폴백 우선순위 · **한 tx 안에서 만든 SKU 를 `validate` 가 본다** |
| `product-sku-mapping.service.spec.ts` (확장) | `upsert` 의 `newSku` 경로 |
| `build-matching-links.spec.ts` (admin-web) | 빈 행 제거 · 필수 누락 · 수량 정규화 |

전제 2 를 지키는 스펙(`validate` 가 tx 를 본다)이 이 PR 의 회귀 방지 핵심이다 — 없으면
누군가 `validate` 에서 `tx` 를 다시 떨어뜨려도 아무도 모른다.

## 배포

- **마이그레이션 0건** → `migrate`/`deploy` 순서 제약 없음.
- DTO 는 «추가»와 «완화»만 하므로 core 를 먼저 배포해도 옛 admin-web 이 안 깨진다.
- admin-web 이 `links`+`newSku` 를 보내려면 core 가 먼저 떠 있어야 한다 → 권장 순서 **`core → admin-web`**.
- SST 단일 스택이라 「core 먼저」를 배포 도구로 강제할 수 없다 — `--target` 도 쓸 수 없다.
  같은 `sst deploy` 안에서 순서가 섞이면 **최악의 경우 admin-web 이 400 을 받는 짧은 창**이 생긴다.
  기능이 지금 100% 404 이므로 회귀가 아니라 개선 구간이다 — 별도 완화 조치는 두지 않는다.

## 남은 위험

| 위험 | 완화 |
|---|---|
| 새 DB 에 `suppliers` 0행이라 auto 탭 필수값을 못 채운다 (`docs/local-e2e-environment.md` §8-D 벽 ①) | 이 PR 범위 밖. `seed-core-local.ts` 에 공급처·재고소유 시드 추가는 별도 항목 |
| `matchings` 15개 라우트의 나머지 스코프 공백 | 후속 이슈 (안 하기로 한 것 4) |
| `MergedTx` → `DbTx` 암묵 대입이 타입 좁힘 없이 통과하는지 | 구현 첫 단계에서 `npm run type-check` 로 확인. 안 되면 seam 규칙대로 `TxFor<MergedSchema>` 한 지점 좁힘 |
