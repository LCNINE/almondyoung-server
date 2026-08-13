# 상품 목록 페이지 크기 선택 · 필터 결과 전체 선택

작성일: 2026-08-13
브랜치: `feat/product-list-page-size` (base: `origin/develop` = `6db578644`)

## 배경

MD 팀 요청:

> 국내 제품 브랜드들을 일괄 수정하고 있는데, 상품이 몇 백개다보니 상품 관리에서 페이지 넘겨가며 선택해야하는 불편함이 있습니다. 상품 관리에서 필터를 통해 상품 노출 품목수를 선택할 수 있으면 더 편할 것 같습니다.

요청 문구는 "페이지당 표시 개수"지만, 실제 불편은 **수백 개를 페이지 단위로 나눠 선택하는 일** 자체다. 표시 개수를 100으로 올려도 수백 건이면 여전히 3~5페이지를 넘겨야 한다. 그래서 표시 개수 선택과 함께 **필터 결과 전체 선택**을 같이 만든다.

## 현재 상태

- `apps/admin-web/src/features/mall/products-list/components/table/index.tsx:29` 에 `PAGE_SIZE = 20` 하드코딩. `useProductsListTableQuery`·`useDataTable`·`DataTable`·컬럼 훅에 같은 상수가 흐른다.
- 선택 상태(`rowSelection`)는 컴포넌트 state 이고 페이지 이동은 `router.replace` 라 **페이지를 넘겨도 선택은 이미 유지된다**. 헤더 체크박스는 `toggleAllPageRowsSelected` — 현재 페이지만 전체 선택한다.
- 서버는 `limit` 을 100 으로 클램프한다 (`product-masters.service.ts:346`, `Math.min(filters?.limit ?? 15, 100)`). DTO 에는 `@Min(1)` 만 있고 상한이 없어, 200 을 보내면 100 건만 오고 프론트의 페이지 수 계산이 어긋난다.
- **브랜드 필터 UI 가 없다.** 서버는 `brand` 를 지원하고(`product-masters.service.ts:428`, `ilike %...%`) `useProductsListTableQuery` 도 URL 의 `brand` 를 읽지만, 필터 박스에는 일자·카테고리·공급처·등록자·분류·검색어만 있다. 검색어(`q`)는 상품명+품번코드만 훑고 브랜드는 보지 않는다(`product-masters.service.ts:433`).
- 필터 박스의 `handleSearch` 는 URL 파라미터를 **매번 새로 짓고** `sort`/`order` 만 살려둔다 (`filter-box/index.tsx:147`~`186`).
- 벌크 DTO (`bulk-operations.dto.ts`) 의 `productIds` 에 **배열 상한이 없다**. 양식 다운로드만 5000 으로 막혀 있다 (`create-form-export.dto.ts:5`).

## 결정 사항

| 항목 | 결정 |
|---|---|
| 페이지 크기 선택지 | 20 / 50 / 100, 기본 20. 서버 클램프(100)는 그대로 둔다 — 전체 선택이 있으면 100 초과는 의미가 없다 |
| 전체 선택 규모 | 필터가 하나라도 걸렸을 때만, 최대 5000 건 |
| ID 수집 방식 | 백엔드에 전용 라우트 추가 (아래 §1) |
| 브랜드 필터 | 이번 범위에 포함 |
| 페이지 크기 UI 위치 | 툴바 — "총 N건" 옆 |

### ID 수집 방식을 백엔드로 정한 이유

프론트에서 `limit=100` 으로 끝까지 순회하는 안도 검토했다. 백엔드 무변경이라는 장점이 있지만 실측상 비용이 훨씬 크다. `getMasters` 한 번은 COUNT 1 + 데이터 1 + 배치 집계 6 ≈ 8 쿼리다(`product-masters.service.ts:507` 이하). 5000 건을 100 씩 순회하면 **요청 50 회 ≈ 400 쿼리, 그중 COUNT 만 50 회 반복**이고, COUNT 는 카테고리 recursive CTE 와 `ROW_NUMBER` 서브쿼리를 매번 다시 돈다. 순회에 필요 없는 `variantPreviews`·`priceSummary`·`soldOutState` 도 매 페이지 계산한다.

또 순회 방식은 5000 건의 **진짜** 스냅샷(이름·썸네일)을 확보하므로, 가상화가 없는 선택 목록 모달(`selected-products-modal/index.tsx:44`)이 DOM 5000 행 + 이미지 5000 요청을 만든다. 탭이 멎는다.

전용 라우트는 요청 1 회, COUNT 1 회, 집계 0 회다. 대가는 core 선배포 1 회뿐이다.

## 1. 백엔드 (core)

### 1.1 `GET /masters/selection`

쿼리 DTO 는 `ListProductMastersQueryDto` 를 그대로 재사용한다. 응답:

```ts
{
  items: Array<{
    masterId: string;
    hideMembershipPriceForNonMembers: boolean;
    isVisibleToMembersOnly: boolean;
    isOverseas: boolean;
  }>;
  total: number;
}
```

**ID 만 반환하지 않고 정책 플래그 3 개를 함께 싣는 이유**: `BulkPolicyModal` 은 선택 스냅샷에서 플래그를 세어 "몇 건이 바뀝니다"를 보여준다(`policy-counts.ts:10`). 그런데 `reconcileSelectedSnapshots` 는 모르는 ID 에 모든 플래그가 `false` 인 플레이스홀더를 채운다(`products-list-selection-model.ts:60`). ID 만 받으면 전체 선택분이 전부 플레이스홀더가 되어 정책 모달이 영향 건수를 **틀리게** 보고한다. 세 플래그는 이미 조인된 `product_master_versions` 의 컬럼이므로(`catalog.schema.ts:162`~`164`) 함께 투영해도 쿼리가 늘지 않는다. 5000 건이면 payload 약 450KB.

응답에 이름·썸네일은 넣지 않는다. 그게 §2.4 의 렌더 상한을 구조적으로 강제한다.

라우트를 `GET /masters` 의 플래그가 아니라 별도 경로로 두는 이유는, 같은 엔드포인트의 응답 모양(`PaginatedResponseDto<ProductSummaryDto>`)을 플래그로 뒤트는 것보다 타입과 Swagger 가 깨끗하기 때문이다.

### 1.2 서비스 구현

`getMasters` 안에 `idsOnly` 분기를 더한다. 그 함수는 COUNT 쿼리와 DATA 쿼리가 **이미 조인 체인을 각각 따로 짓고 `whereClause` 하나를 공유**하는 구조다(`product-masters.service.ts:507`, `533`). 여기에 세 번째 형제로, `select({ masterId, hideMembershipPriceForNonMembers, isVisibleToMembersOnly, isOverseas })` 로 투영한 SELECTION 쿼리를 붙인다.

> **2026-08-13 수정**: 이 문단은 원래 "`where` 빌드를 별도 함수로 추출하지 않는다"였다. 계획서를 쓰면서 뒤집었다 — 추출하지 않으면 `getMasters` 가 목록과 선택 두 모양을 union 으로 반환해야 해서 호출부 타입이 더러워진다. 추출이 만드는 위험(두 경로의 필터가 갈라지는 것)은 §3 의 파리티 통합 테스트가 정면으로 막는다. 아래는 수정된 결정이다.

**`where` 빌드와 조인 스코프를 `buildMasterListScope` private 메서드로 뽑고, 목록·선택 두 경로가 그것을 공유한다.** 조인 체인 자체는 COUNT 쿼리가 이미 그렇듯 각 경로가 따로 짓는다. 두 결과가 어긋나지 않는다는 보장은 공유 스코프 + 파리티 테스트 두 겹이다.

`idsOnly` 일 때 건너뛰는 것: `optionGroupNames`, `variantCount`, `variantPreviews`, `thumbnail`, `priceSummary`, `soldOutState` 6 종 전부. `limit`/`offset` 도 걸지 않는다 — 즉 이 라우트는 쿼리에 `page`/`limit` 이 실려 와도 **무시하고 필터 전량**을 반환한다.

### 1.3 상한

`total > 5000` 이면 `BadRequestError('선택 가능한 범위를 넘었습니다. 필터를 좁혀주세요.')`. 화면은 누르기 전에 `total` 을 알아 버튼을 비활성화하므로 이건 이중 방어다.

"필터가 하나라도 걸려야 한다"는 조건은 **화면 규칙이고 서버는 강제하지 않는다.** 서버가 막는 건 5000 건 상한 하나다. 필터 없이 부르는 게 위험한 게 아니라 오조작이 넓어질 뿐이고, 서버에 "필터 있음"을 정의해 두면 필터가 늘 때마다 두 곳이 어긋난다.

### 1.4 벌크 DTO 상한

`bulk-operations.dto.ts` 의 `BulkUpdateDto`·`BulkDeleteDto`·`BulkRestoreDto`·`BulkPolicyDto` 네 개 모두 `productIds` 에 `@ArrayNotEmpty()` + `@ArrayMaxSize(5000)` 을 단다. 양식 다운로드가 쓰는 상한과 같은 값이다.

마이그레이션 0 건.

## 2. 프론트 (admin-web)

### 2.1 페이지 크기

- URL 파라미터 `size` 에 20/50/100. 기본 20, 그 외 값은 20 으로 폴백.
- 변경 시 `page` 를 1 로 되돌린다.
- `handleSearch` 가 파라미터를 매번 새로 지으므로(`filter-box/index.tsx:147`), `sort`/`order` 와 같은 자리에서 `size` 도 명시적으로 보존한다. `handleReset` 에서도 보존한다 — 표시 개수는 필터가 아니라 보기 설정이다.
- `PAGE_SIZE` 상수(`table/index.tsx:29`)는 사라지고, 선택된 값이 `useProductsListTableQuery`·`useDataTable`·`DataTable`·컬럼 훅으로 흐른다.
- 위치: 툴바의 "총 N건" 옆.

### 2.2 브랜드 필터

필터 박스 검색어 행에 텍스트 입력 "브랜드"를 추가하고, `handleSearch` 에서 `brand` 파라미터를 셋한다. 서버가 부분 일치(`ilike %...%`)라 일부만 입력해도 걸린다. `useProductsListTableQuery` 는 이미 `brand` 를 읽고 있어 조회 쪽 변경은 없다.

### 2.3 전체 선택

툴바에 `필터 결과 전체 선택 (N건)` 버튼. 활성 조건:

| 상태 | 동작 |
|---|---|
| 필터 없음 | 비활성 + "필터를 먼저 걸어주세요" |
| `total === 0` | 비활성 |
| `0 < total ≤ 5000` | 활성 |
| `total > 5000` | 비활성 + "5000건을 넘습니다. 필터를 좁혀주세요" |

클릭 시 현재 필터 그대로 `GET /masters/selection` 을 부르고, 받은 `items` 로 `rowSelection` 과 `selectedItems` 스냅샷을 한 번에 채운다. 해제는 기존 "전체 해제" 경로를 그대로 쓴다.

### 2.4 선택 목록 모달

전체 선택분은 이름·썸네일이 없다. 표기를 낮춘다.

- 제목 `선택한 상품 N개` 유지.
- 목록은 **최대 200 행만 렌더**하고, 그 아래 "이 외 K건은 목록에 표시하지 않습니다" 안내.
- 이름이 없는 항목은 `ShortId` 만 보여준다.

200 행 상한은 가상화가 없는 `<ul>`(`selected-products-modal/index.tsx:44`)에 5000 행을 밀어 넣지 않기 위한 것이다.

## 3. 테스트

**admin-web 은 컴포넌트 테스트가 불가능하다** — 렌더러가 없고 `.tsx` 가 transform 대상 밖이다. 판정 가능한 로직을 순수 함수로 뽑아 `.ts` + `.spec.ts` 로 검증한다. 기존 `products-list-selection-model.ts` / `excel-download-model.ts` 와 같은 방식이다.

- `parsePageSize(raw): 20 | 50 | 100` — `null`·`'abc'`·`'999'`·`'0'` 전부 20 폴백
- `hasActiveFilter(params): boolean` — `q`·`brand`·`categoryId`·`supplierId`·`createdBy`·`status`·`stock`·`createdAt` 중 하나라도 있으면 `true`. `page`·`size`·`sort`·`order`·`datePreset` 는 필터로 치지 않는다 (`datePreset` 은 `createdAt` 과 항상 같이 실리는 UI 표시용 값이다)
- `canSelectAll({ hasFilter, total }): { ok: boolean; reason?: string }` — 위 표의 네 경우
- `selectionFromItems(items): { rowSelection, snapshots }`
- `buildSearchParams(filters, preserved)` — `handleSearch` 의 조립부를 뽑아 `size` 보존을 테스트로 고정

core 쪽의 핵심은 **파리티 스펙**이다. 통합 테스트에서 같은 필터로 `GET /masters` 를 끝까지 페이징한 ID 집합과 `GET /masters/selection` 의 `items` 집합이 정확히 일치함을 확인한다. 필터 조건이 갈라지면 바로 잡히도록 각각 한 케이스씩 건다:

- 카테고리 (recursive CTE 하위 포함)
- 공급처 `unassigned` sentinel
- `stock` 필터 (`sold_out` / `partial`)
- `mode=all` (draft 만 있는 상품 포함)

여기에 5000 초과 시 400, 벌크 DTO 상한 4 종 단위 스펙을 더한다.

통합 테스트 실행: 워크트리에서는 `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local`.

## 4. 배포

**core → admin-web 순서. 마이그레이션 0 건.**

admin-web 이 먼저 뜨면 `GET /masters/selection` 이 404 라 전체 선택 버튼만 실패하고 나머지 화면은 멀쩡하다. 그래도 순서는 지킨다.

## 5. 범위에서 뺀 것

- 선택 목록 모달 가상화 — 200 행 상한으로 대체
- 다른 목록 화면의 페이지 크기 선택 — 상품 목록만
- 페이지 크기 localStorage 기억 — URL 로 충분
- 벌크 액션의 서버측 청크 처리 — 5000 건 한 방으로 보내고 기존 동작 유지

## 6. 미확인 위험

**5000 건 벌크 상태변경/삭제가 한 트랜잭션에서 어떻게 도는지 확인하지 않았다.** 상한을 5000 으로 여는 이상 그쪽이 버티는지는 별개 문제다. 다만 현재 코드에는 상한이 **아예 없어** 이 위험은 이미 노출돼 있다. 이번 작업은 상한을 거는 데까지만 한다. 실제 5000 건 처리 성능·타임아웃은 후속에서 측정한다.
