# warehouse-app 재고조회 표 전환 + 재사용 DataTable 프리미티브

- 날짜: 2026-07-22
- 브랜치: docs/warehouse-app-page-structure
- 대상: `native/warehouse-app` (Vite + TanStack Router memory history + react-query + Tauri)

## 배경 / 문제

재고조회 화면(`domains/inventory/InventoryLookupScreen.tsx`)이 현재 SKU를 `<ul>` 카드로 나열한다. 카드에 **재고량이 없어** 조회 화면으로서 핵심 정보가 빠져 있다. 표로 바꾸면서 재고량 컬럼을 넣는 게 목표.

표를 쓸 거면 warehouse-app 안에 재사용 가능한 표 컴포넌트를 두는 게 낫다. admin-web에 성숙한 datatable이 있지만 그대로는 못 가져온다:

- admin-web의 `use-data-table.ts`는 `next/navigation`(`useRouter/usePathname/useSearchParams`)에 하드코딩돼 page/sort/search 상태를 **URL 쿼리**에 싣는다. warehouse-app은 Next.js가 아니라 Vite + TanStack Router **memory history** 라서 `next/navigation`이 존재하지 않고 URL 상태도 안 쓴다.
- 실제로 재사용 가능한 알짜 레이어는 admin-web이 감싸고 있는 헤드리스 lib **`@tanstack/react-table`** 이다. 컬럼 정의·표 구조 패턴은 이식 가능, Next 전용 URL 배선은 불가.

결론: admin-web 컴포넌트를 통째 이식하지 않고, warehouse-app 로컬에 얇은 **controlled DataTable 프리미티브**를 새로 만든다(첫 소비자 = 재고조회). 상태는 URL 대신 **화면 로컬 `useState`** 가 소유한다.

## 백엔드 사실 (확인됨)

동일 컨트롤러 `@Controller('inventory/skus')` (컨트롤러 레벨 가드 없음 → 기존 기본 search를 호출하는 앱이면 advanced도 동일 접근).

- `GET /inventory/skus?name=` (기본 `search`) — `SkuResponseDto[]` 를 주지만 **`currentStock`을 채우지 않는다**(undefined). `safetyStock`은 포함. → 재고 표에 부적합. 이 화면에서 더 이상 쓰지 않는다.
- `GET /inventory/skus/search/advanced` (`searchAdvanced`) — 재고 표의 데이터 소스.
  - 응답: `{ items: SkuResponseDto[], total, limit, offset }`. 각 item에 `currentStock` = `SUM(stockSummary.onHandQty)` (warehouseId 미지정 시 전 창고 합산), `safetyStock` 포함.
  - 쿼리 파라미터(`AdvancedInventoryFiltersDto`):
    - `search` — 이름 **OR** 코드 LIKE 매칭
    - `limit` 기본 50 / 최대 200, `offset` 기본 0
    - `sortBy` ∈ `name | code | createdAt | updatedAt | safetyStock` — **`currentStock` 없음**(쿼리 후 계산되므로 서버 정렬 불가)
    - `sortOrder` ∈ `asc | desc`
    - 그 외(warehouseId, displayMode, supplierId 등)는 v1에서 미사용.

## 설계

### 데이터 흐름 (URL 없이 서버 페이지네이션)

화면이 로컬 `useState`로 `{ offset, sortBy, sortOrder }`를 소유하고, 이를 react-query queryKey에 넣어 서버 페이지네이션/정렬을 그대로 구동한다.

```
InventoryLookupScreen (owns: term, offset, sortBy, sortOrder)
  └─ useSkuSearch({ search, limit=20, offset, sortBy, sortOrder })  → { items, total }
       └─ GET /inventory/skus/search/advanced?...
  └─ DataTable (controlled: sorting/pagination props + onChange 콜백)
```

- page size = **20** (핸드헬드 화면에 맞춤).
- 정렬이 바뀌면 `offset`을 0으로 리셋.
- 서버가 `total`을 주므로 pageCount가 정확 — "상위 N건 절단" 같은 안내 불필요.

### DataTable 프리미티브 — `src/core/design/DataTable.tsx`

`@tanstack/react-table`(신규 의존성) 위의 얇은 프레젠테이션 래퍼. **controlled** — 내부에서 자르지도 정렬하지도 않고(`manualPagination:true`, `manualSorting:true`) 렌더 + 상태 이벤트만 emit. `next/navigation`·URL·search param 없음.

```ts
DataTable<T>({
  columns: ColumnDef<T>[];          // @tanstack/react-table 표준
  data: T[];
  isLoading?: boolean;              // colSpan 로딩 행
  emptyMessage?: string;            // colSpan 빈 행
  sorting: SortingState;            // 부모 소유
  onSortingChange: OnChangeFn<SortingState>;
  pagination: { pageIndex: number; pageSize: number };
  onPaginationChange: OnChangeFn<PaginationState>;
  rowCount: number;                 // 서버 total → pageCount 파생
  getRowId?: (row: T) => string;
})
```

- 내부: `useReactTable` + `getCoreRowModel`, `manualPagination:true`, `manualSorting:true`, `pageCount = ceil(rowCount / pageSize)`.
- 렌더: `<div className="overflow-x-auto">` 로 감싼 `<table>`. 소형 화면에서 레이아웃이 안 깨지고 옆으로 스크롤(handheld 대응). 정렬 가능 헤더는 클릭 → ▲/▼. 하단에 이전/다음 + `page X / Y`.
- 스타일: Tailwind + 기존 `core/design/cn.ts`, `core/design` 톤에 맞춤.
- 에러는 프리미티브 밖 — 화면에서 기존 `role="alert"` 패턴으로 표 위에 표시(일관성).
- 재사용성: 앞으로 페이지네이션 엔드포인트를 쓰는 다른 창고 화면이 그대로 소비.

### 정렬 정책 (서버가 지원하는 것만)

- 상품명(`name`) · 코드(`code`) → **서버 정렬** (`enableSorting: true`). `SortingState[0].id → sortBy`, `desc → sortOrder`.
- 옵션 · **재고** → **비정렬** (`enableSorting: false`). 재고는 서버 `sortBy` enum에 없음 — 지원 안 되는 정렬을 UI로 노출하면 "현재 페이지만 정렬"되는 오해를 낳으므로 아예 뺀다.
- (향후) 재고 정렬이 필요하면 백엔드 `AdvancedInventoryFiltersDto.sortBy`에 `currentStock` 추가 + 집계 정렬 구현이라는 별도 작업.

### 재고조회 화면 컬럼

| 컬럼 | 필드 | 비고 |
|------|------|------|
| 상품명 | `name` | truncate, min-width, 서버 정렬 |
| 코드 | `code` | 서버 정렬 |
| 옵션 | `optionKey ?? '—'` | 비정렬 |
| 재고 | `currentStock ?? 0` | 우측정렬, 비정렬, **부족 3-상태** |

**부족 표시 (3-상태):**
- `currentStock === 0` → **품절** (red)
- `safetyStock > 0 && currentStock <= safetyStock` → **부족** (amber)
- 그 외 → 정상

`safetyStock === 0`이고 재고 > 0이면 오탐이 안 나도록 `safetyStock > 0` 가드를 둔다.

### 타입 / 훅 변경

- `domains/inventory/types.ts` — `SkuSearchItem`에 `currentStock: number`, `safetyStock: number` 추가.
- `domains/inventory/useSkuSearch.ts` — `search/advanced`로 재배선. 시그니처 `useSkuSearch({ search, limit, offset, sortBy, sortOrder })`, 반환 `{ items, total }`. queryKey에 정렬/페이지 파라미터 포함. `search`가 빈 문자열이면 `enabled:false` 유지.

### 창고 스코프 (v1 한계)

앱 세션에 warehouse 컨텍스트가 없다(`core/auth/session.ts`는 auth 전용). 따라서 v1은 `warehouseId` 미전달 = **전 창고 합산 on-hand**. 유일 선택지이며, 나중에 창고 선택 UI가 생기면 `useSkuSearch`에 `warehouseId`를 넘겨 창고별로 좁힐 수 있는 자리를 남긴다.

## 테스트

- `core/design/DataTable.test.tsx` (신규, RTL — 프레임워크 무관):
  - 행 렌더 / `emptyMessage` / `isLoading`
  - 정렬 가능 헤더 클릭 → `onSortingChange` 호출, 비정렬 헤더는 미호출
  - 이전/다음 → `onPaginationChange` 호출, `rowCount` 기반 page X/Y 표시
- `domains/inventory/useSkuSearch.test.ts` — 새 엔드포인트/파라미터/`{items,total}` shape로 갱신.
- `domains/inventory/InventoryLookupScreen.test.tsx` — 표 헤더 + 재고값 렌더, 부족/품절 상태, 빈결과·에러 케이스.

## 의존성

- `native/warehouse-app/package.json`에 `@tanstack/react-table` 추가 (react-query·react-router는 이미 있음).

## 범위 밖 (Non-goals)

- admin-web data-table 컴포넌트 통째 이식.
- URL/search-param 기반 상태.
- 필터(공급처·displayMode·창고), 컬럼 표시 토글, 행 선택, 행 클릭 상세 이동.
- 재고량 서버 정렬(백엔드 변경 필요).
- handheld 전용 카드 폴백(overflow 스크롤로 대응).
