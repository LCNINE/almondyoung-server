# warehouse-app 재고조회 표 전환 + 재사용 DataTable 프리미티브 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** warehouse-app 재고조회 화면을 카드 목록에서 재고량이 보이는 서버 페이지네이션 표로 바꾸고, 그 과정에서 재사용 가능한 controlled DataTable 프리미티브를 만든다.

**Architecture:** `@tanstack/react-table`(헤드리스) 위의 얇은 프레젠테이션 래퍼 `DataTable`을 `core/design`에 둔다. 이 래퍼는 `manualPagination`/`manualSorting`으로 동작해 자르지도 정렬하지도 않고 렌더 + 상태 이벤트만 emit한다. 페이지/정렬 상태는 URL이 아니라 화면 로컬 `useState`가 소유하고 react-query queryKey에 실려 서버(`/inventory/skus/search/advanced`)를 구동한다.

**Tech Stack:** React 19, Vite, TanStack Router(memory history), TanStack Query v5, TanStack Table v8(신규), Tailwind v4, Vitest 4 + Testing Library, oxlint, Tauri.

## Global Constraints

- 작업 디렉터리: 모든 명령은 `native/warehouse-app`에서 실행한다(아래 명령은 `cd native/warehouse-app && …` 형태로 명시).
- 데이터 소스는 `GET /inventory/skus/search/advanced` 하나. 기본 `GET /inventory/skus?name=`은 `currentStock`을 채우지 않으므로 이 화면에서 쓰지 않는다.
- 페이지 크기 = **20**. 페이지네이션·정렬은 서버 위임(`limit`/`offset`/`sortBy`/`sortOrder`).
- 서버 정렬 가능 필드는 `name | code`뿐. **옵션·재고 컬럼은 `enableSorting: false`** (재고는 서버 `sortBy` enum에 없음).
- 부족 표시 3-상태: `currentStock === 0` → 품절(red), `safetyStock > 0 && currentStock <= safetyStock` → 부족(amber), 그 외 정상.
- 창고 스코프: v1은 `warehouseId` 미전달 = 전 창고 합산 on-hand.
- 타입 안전: `any` 금지, 정당한 사유 없는 `as` 금지. react-table 컬럼은 `ColumnDef<T>`(value generic = unknown)로 표기한다. ApiClient mock 캐스트는 기존 관용구를 따르고 사유 주석을 단다.
- 테스트: Vitest + Testing Library. 단일 파일 실행은 `npx vitest run <path>`.
- 각 Task 끝에서 커밋한다.

---

### Task 1: 의존성 추가 + 재고 필드 타입 확장

**Files:**
- Modify: `native/warehouse-app/package.json`
- Modify: `native/warehouse-app/src/domains/inventory/types.ts`

**Interfaces:**
- Produces: `SkuSearchItem`에 `currentStock: number`, `safetyStock: number` 추가 (이후 모든 Task가 소비).
- Produces: `@tanstack/react-table` v8 설치 (Task 3·5가 import).

- [ ] **Step 1: `@tanstack/react-table` 설치**

Run:
```bash
cd native/warehouse-app && npm install @tanstack/react-table@^8
```
Expected: `package.json` dependencies에 `@tanstack/react-table` 추가, 설치 성공.

- [ ] **Step 2: `types.ts`에 재고 필드 추가**

`native/warehouse-app/src/domains/inventory/types.ts` 전체를 아래로 교체:

```ts
/** 재고조회 목록 표시용 최소 필드. 백엔드 SkuResponseDto의 부분집합. */
export interface SkuSearchItem {
  id: string;
  code: string;
  name: string;
  optionKey?: string | null;
  /** search/advanced 응답에서 계산되는 현재고(전 창고 합산 또는 warehouseId 한정). */
  currentStock: number;
  /** 안전재고. 0이면 부족 판정 제외. */
  safetyStock: number;
}
```

- [ ] **Step 3: 타입체크로 회귀 없음 확인**

Run:
```bash
cd native/warehouse-app && npx tsc -b
```
Expected: 에러 없이 통과. (기존 `InventoryLookupScreen.tsx`/`useSkuSearch.ts`는 아직 새 필드를 참조하지 않으므로 깨지지 않는다.)

- [ ] **Step 4: 커밋**

```bash
cd native/warehouse-app && git add package.json package-lock.json src/domains/inventory/types.ts && \
git commit -m "chore(warehouse-app): @tanstack/react-table 추가 + SkuSearchItem 재고 필드"
```

---

### Task 2: StockCell — 재고 3-상태 셀

**Files:**
- Create: `native/warehouse-app/src/domains/inventory/StockCell.tsx`
- Test: `native/warehouse-app/src/domains/inventory/StockCell.test.tsx`

**Interfaces:**
- Consumes: `SkuSearchItem`(Task 1).
- Produces: `StockCell({ item }: { item: SkuSearchItem })` — Task 5의 재고 컬럼 `cell`이 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `native/warehouse-app/src/domains/inventory/StockCell.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StockCell } from './StockCell';
import type { SkuSearchItem } from './types';

function item(over: Partial<SkuSearchItem>): SkuSearchItem {
  return { id: '1', code: 'C', name: 'N', currentStock: 0, safetyStock: 0, ...over };
}

describe('StockCell', () => {
  it('shows 품절 when stock is 0', () => {
    render(<StockCell item={item({ currentStock: 0, safetyStock: 10 })} />);
    expect(screen.getByText('품절')).toBeInTheDocument();
  });

  it('shows 부족 when stock is at or below safety stock', () => {
    render(<StockCell item={item({ currentStock: 5, safetyStock: 10 })} />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('부족')).toBeInTheDocument();
  });

  it('shows no label when stock is healthy', () => {
    render(<StockCell item={item({ currentStock: 20, safetyStock: 10 })} />);
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.queryByText('부족')).toBeNull();
    expect(screen.queryByText('품절')).toBeNull();
  });

  it('does not flag 부족 when safety stock is 0', () => {
    render(<StockCell item={item({ currentStock: 5, safetyStock: 0 })} />);
    expect(screen.queryByText('부족')).toBeNull();
    expect(screen.queryByText('품절')).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run:
```bash
cd native/warehouse-app && npx vitest run src/domains/inventory/StockCell.test.tsx
```
Expected: FAIL — `Cannot find module './StockCell'`.

- [ ] **Step 3: 최소 구현**

Create `native/warehouse-app/src/domains/inventory/StockCell.tsx`:

```tsx
import { cn } from '../../core/design/cn';
import type { SkuSearchItem } from './types';

/** 재고 3-상태: 품절(0) / 부족(≤안전재고, 안전재고>0) / 정상. */
export function StockCell({ item }: { item: SkuSearchItem }) {
  const stock = item.currentStock;
  const isOut = stock === 0;
  const isLow = !isOut && item.safetyStock > 0 && stock <= item.safetyStock;

  return (
    <div className="text-right tabular-nums">
      <span
        className={cn(
          'font-medium',
          isOut ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-gray-800'
        )}
      >
        {stock}
      </span>
      {isOut && <span className="ml-1 text-xs text-red-600">품절</span>}
      {isLow && <span className="ml-1 text-xs text-amber-600">부족</span>}
    </div>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run:
```bash
cd native/warehouse-app && npx vitest run src/domains/inventory/StockCell.test.tsx
```
Expected: PASS (4 tests).

- [ ] **Step 5: 커밋**

```bash
cd native/warehouse-app && git add src/domains/inventory/StockCell.tsx src/domains/inventory/StockCell.test.tsx && \
git commit -m "feat(warehouse-app): 재고 3-상태 StockCell"
```

---

### Task 3: DataTable — controlled 서버 페이지네이션 표 프리미티브

**Files:**
- Create: `native/warehouse-app/src/core/design/DataTable.tsx`
- Test: `native/warehouse-app/src/core/design/DataTable.test.tsx`

**Interfaces:**
- Consumes: `@tanstack/react-table`(Task 1), `cn`(기존).
- Produces: `DataTable<TData>(props: DataTableProps<TData>)` — controlled. props:
  - `columns: ColumnDef<TData>[]`, `data: TData[]`, `rowCount: number`
  - `sorting: SortingState`, `onSortingChange: OnChangeFn<SortingState>`
  - `pagination: PaginationState`, `onPaginationChange: OnChangeFn<PaginationState>`
  - `isLoading?: boolean`, `emptyMessage?: string`, `getRowId?: (row: TData) => string`
  - Task 5가 소비.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `native/warehouse-app/src/core/design/DataTable.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnDef, PaginationState, SortingState } from '@tanstack/react-table';
import { DataTable } from './DataTable';

type Row = { id: string; name: string };

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: '이름' }, // accessor → 정렬 가능(기본)
  { id: 'note', header: '비고', enableSorting: false, cell: () => '—' },
];

const twoRows: Row[] = [
  { id: '1', name: '가' },
  { id: '2', name: '나' },
];
const firstPage: PaginationState = { pageIndex: 0, pageSize: 20 };
const noSort: SortingState = [];

describe('DataTable', () => {
  it('renders rows', () => {
    render(
      <DataTable<Row>
        columns={columns}
        data={twoRows}
        rowCount={2}
        sorting={noSort}
        onSortingChange={vi.fn()}
        pagination={firstPage}
        onPaginationChange={vi.fn()}
      />
    );
    expect(screen.getByText('가')).toBeInTheDocument();
    expect(screen.getByText('나')).toBeInTheDocument();
  });

  it('shows the empty message when there is no data', () => {
    render(
      <DataTable<Row>
        columns={columns}
        data={[]}
        rowCount={0}
        sorting={noSort}
        onSortingChange={vi.fn()}
        pagination={firstPage}
        onPaginationChange={vi.fn()}
        emptyMessage="없어요"
      />
    );
    expect(screen.getByText('없어요')).toBeInTheDocument();
  });

  it('shows a loading row when isLoading', () => {
    render(
      <DataTable<Row>
        columns={columns}
        data={[]}
        rowCount={0}
        sorting={noSort}
        onSortingChange={vi.fn()}
        pagination={firstPage}
        onPaginationChange={vi.fn()}
        isLoading
      />
    );
    expect(screen.getByText('조회 중…')).toBeInTheDocument();
  });

  it('calls onSortingChange for a sortable header, and renders no button for a non-sortable one', async () => {
    const onSortingChange = vi.fn();
    render(
      <DataTable<Row>
        columns={columns}
        data={twoRows}
        rowCount={2}
        sorting={noSort}
        onSortingChange={onSortingChange}
        pagination={firstPage}
        onPaginationChange={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: '이름' }));
    expect(onSortingChange).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '비고' })).toBeNull();
  });

  it('derives page count from rowCount and pages via callbacks', async () => {
    const onPaginationChange = vi.fn();
    render(
      <DataTable<Row>
        columns={columns}
        data={twoRows}
        rowCount={40} // 40 / 20 = 2 pages
        sorting={noSort}
        onSortingChange={vi.fn()}
        pagination={firstPage}
        onPaginationChange={onPaginationChange}
      />
    );
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '이전' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(onPaginationChange).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run:
```bash
cd native/warehouse-app && npx vitest run src/core/design/DataTable.test.tsx
```
Expected: FAIL — `Cannot find module './DataTable'`.

- [ ] **Step 3: 최소 구현**

Create `native/warehouse-app/src/core/design/DataTable.tsx`:

```tsx
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type PaginationState,
  type RowData,
  type SortingState,
} from '@tanstack/react-table';

export type DataTableProps<TData extends RowData> = {
  columns: ColumnDef<TData>[];
  data: TData[];
  /** 서버가 알려준 전체 행 수. pageCount 파생에 사용. */
  rowCount: number;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  pagination: PaginationState;
  onPaginationChange: OnChangeFn<PaginationState>;
  isLoading?: boolean;
  emptyMessage?: string;
  getRowId?: (row: TData) => string;
};

export function DataTable<TData extends RowData>({
  columns,
  data,
  rowCount,
  sorting,
  onSortingChange,
  pagination,
  onPaginationChange,
  isLoading,
  emptyMessage = '결과가 없어요.',
  getRowId,
}: DataTableProps<TData>) {
  const table = useReactTable({
    data,
    columns,
    state: { sorting, pagination },
    onSortingChange,
    onPaginationChange,
    rowCount,
    manualPagination: true,
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
  });

  const pageCount = table.getPageCount();
  const colSpan = columns.length;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <th key={header.id} className="whitespace-nowrap px-3 py-2 font-medium">
                      {canSort ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <span aria-hidden>
                            {sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : ''}
                          </span>
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={colSpan} className="px-3 py-6 text-center text-gray-500">
                  조회 중…
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-3 py-6 text-center text-gray-500">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-t border-gray-100">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            {pagination.pageIndex + 1} / {pageCount}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-40"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              이전
            </button>
            <button
              type="button"
              className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-40"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              다음
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run:
```bash
cd native/warehouse-app && npx vitest run src/core/design/DataTable.test.tsx
```
Expected: PASS (5 tests).

- [ ] **Step 5: 커밋**

```bash
cd native/warehouse-app && git add src/core/design/DataTable.tsx src/core/design/DataTable.test.tsx && \
git commit -m "feat(warehouse-app): controlled DataTable 프리미티브(@tanstack/react-table)"
```

---

### Task 4: useSkuSearch — advanced 엔드포인트로 재배선

**Files:**
- Modify: `native/warehouse-app/src/domains/inventory/useSkuSearch.ts`
- Test: `native/warehouse-app/src/domains/inventory/useSkuSearch.test.ts` (신규)

**Interfaces:**
- Consumes: `SkuSearchItem`(Task 1), `useApiClient`(기존).
- Produces:
  - `interface SkuSearchParams { search: string; limit: number; offset: number; sortBy?: 'name' | 'code'; sortOrder?: 'asc' | 'desc' }`
  - `interface SkuSearchResult { items: SkuSearchItem[]; total: number }`
  - `useSkuSearch(params: SkuSearchParams)` → react-query 결과(`data?: SkuSearchResult`). Task 5가 소비.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `native/warehouse-app/src/domains/inventory/useSkuSearch.test.ts`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { useSkuSearch } from './useSkuSearch';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function wrapperFor(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}

describe('useSkuSearch', () => {
  it('requests advanced search with pagination + sort params', async () => {
    // 선언된 파라미터로 mock.calls[0][0] 타입을 얻는다.
    const request = vi.fn(async (_opts: { path: string }) => ({ items: [], total: 0 }));
    // vi.fn 반환 타입은 ApiClient.request의 제네릭 <T>를 만족 못 하므로 캐스트(httpClient.test.ts의 `doFetch as never`와 같은 패턴).
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };

    const { result } = renderHook(
      () => useSkuSearch({ search: '코튼', limit: 20, offset: 20, sortBy: 'name', sortOrder: 'asc' }),
      { wrapper: wrapperFor(client) }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const path = request.mock.calls[0][0].path;
    expect(path).toContain('/inventory/skus/search/advanced?');
    expect(path).toContain('limit=20');
    expect(path).toContain('offset=20');
    expect(path).toContain('sortBy=name');
    expect(path).toContain('sortOrder=asc');
  });

  it('is disabled for an empty search term', () => {
    const request = vi.fn(async (_opts: { path: string }) => ({ items: [], total: 0 }));
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };

    const { result } = renderHook(
      () => useSkuSearch({ search: '   ', limit: 20, offset: 0 }),
      { wrapper: wrapperFor(client) }
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(request).not.toHaveBeenCalled();
  });
});
```

Note: 이 테스트 파일은 JSX(`wrapperFor`)를 쓰므로 확장자를 `.tsx`로 만들어야 한다. 파일명을 `useSkuSearch.test.tsx`로 생성한다.

- [ ] **Step 2: 테스트 실패 확인**

Run:
```bash
cd native/warehouse-app && npx vitest run src/domains/inventory/useSkuSearch.test.tsx
```
Expected: FAIL — `useSkuSearch`가 아직 옛 시그니처(`query: string`)라 타입/런타임 불일치.

- [ ] **Step 3: 훅 재작성**

`native/warehouse-app/src/domains/inventory/useSkuSearch.ts` 전체를 아래로 교체:

```ts
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { SkuSearchItem } from './types';

export interface SkuSearchParams {
  search: string;
  limit: number;
  offset: number;
  sortBy?: 'name' | 'code';
  sortOrder?: 'asc' | 'desc';
}

export interface SkuSearchResult {
  items: SkuSearchItem[];
  total: number;
}

/**
 * GET /inventory/skus/search/advanced → { items, total }.
 * currentStock/safetyStock 은 advanced 응답에만 존재. 페이지/정렬은 서버 위임.
 */
export function useSkuSearch(params: SkuSearchParams) {
  const api = useApiClient();
  const search = params.search.trim();
  return useQuery({
    queryKey: ['sku-search', search, params.limit, params.offset, params.sortBy, params.sortOrder],
    enabled: search.length > 0,
    placeholderData: keepPreviousData,
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set('search', search);
      qs.set('limit', String(params.limit));
      qs.set('offset', String(params.offset));
      if (params.sortBy) qs.set('sortBy', params.sortBy);
      if (params.sortOrder) qs.set('sortOrder', params.sortOrder);
      return api.request<SkuSearchResult>({
        path: `/inventory/skus/search/advanced?${qs.toString()}`,
      });
    },
  });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run:
```bash
cd native/warehouse-app && npx vitest run src/domains/inventory/useSkuSearch.test.tsx
```
Expected: PASS (2 tests).

- [ ] **Step 5: 커밋**

```bash
cd native/warehouse-app && git add src/domains/inventory/useSkuSearch.ts src/domains/inventory/useSkuSearch.test.tsx && \
git commit -m "feat(warehouse-app): useSkuSearch 를 advanced 엔드포인트+서버 페이지네이션으로 재배선"
```

---

### Task 5: InventoryLookupScreen — 표 배선 + 통합

**Files:**
- Modify: `native/warehouse-app/src/domains/inventory/InventoryLookupScreen.tsx`
- Test: `native/warehouse-app/src/domains/inventory/InventoryLookupScreen.test.tsx`

**Interfaces:**
- Consumes: `DataTable`(Task 3), `StockCell`(Task 2), `useSkuSearch`/`SkuSearchParams`(Task 4), `SkuSearchItem`(Task 1), `Button`/`errorMessage`(기존).

- [ ] **Step 1: 테스트를 새 shape/표 기준으로 갱신**

`native/warehouse-app/src/domains/inventory/InventoryLookupScreen.test.tsx` 전체를 아래로 교체:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { InventoryLookupScreen } from './InventoryLookupScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function renderWith(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>
          <InventoryLookupScreen />
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}

describe('InventoryLookupScreen', () => {
  it('searches and shows results with stock in a table', async () => {
    const client: ApiClient = {
      // vi.fn 반환 타입은 ApiClient.request의 제네릭 <T>를 만족 못 하므로 캐스트(httpClient.test.ts의 `doFetch as never`와 같은 패턴).
      request: vi.fn(async () => ({
        items: [
          { id: '1', code: 'SKU-8891', name: '코튼 티', optionKey: '흰색 / M', currentStock: 5, safetyStock: 10 },
        ],
        total: 1,
      })) as ApiClient['request'],
    };
    const user = userEvent.setup();
    renderWith(client);
    await user.type(screen.getByPlaceholderText(/검색/), '코튼');
    await user.click(screen.getByRole('button', { name: '검색' }));

    expect(await screen.findByText('코튼 티')).toBeInTheDocument();
    expect(screen.getByText('SKU-8891')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('부족')).toBeInTheDocument(); // 5 <= safetyStock 10
  });

  it('shows the empty message when there are no results', async () => {
    const client: ApiClient = {
      request: vi.fn(async () => ({ items: [], total: 0 })) as ApiClient['request'],
    };
    const user = userEvent.setup();
    renderWith(client);
    await user.type(screen.getByPlaceholderText(/검색/), '없는상품');
    await user.click(screen.getByRole('button', { name: '검색' }));

    expect(await screen.findByText('결과가 없어요.')).toBeInTheDocument();
  });

  it('shows a friendly message on error', async () => {
    const client: ApiClient = {
      request: vi.fn(async () => {
        throw new Error('GET /inventory/skus/search/advanced → 500');
      }) as ApiClient['request'],
    };
    const user = userEvent.setup();
    renderWith(client);
    await user.type(screen.getByPlaceholderText(/검색/), '코튼');
    await user.click(screen.getByRole('button', { name: '검색' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/서버/);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run:
```bash
cd native/warehouse-app && npx vitest run src/domains/inventory/InventoryLookupScreen.test.tsx
```
Expected: FAIL — 화면이 아직 카드/옛 훅 시그니처라 표 텍스트('부족', '결과가 없어요.')를 못 찾음.

- [ ] **Step 3: 화면 재작성**

`native/warehouse-app/src/domains/inventory/InventoryLookupScreen.tsx` 전체를 아래로 교체:

```tsx
import { useMemo, useState } from 'react';
import type {
  ColumnDef,
  OnChangeFn,
  PaginationState,
  SortingState,
} from '@tanstack/react-table';
import { Button } from '../../core/design/Button';
import { DataTable } from '../../core/design/DataTable';
import { errorMessage } from '../../core/data/errorMessage';
import { useSkuSearch } from './useSkuSearch';
import { StockCell } from './StockCell';
import type { SkuSearchItem } from './types';

const PAGE_SIZE = 20;

/** 서버 sortBy enum에 있는 컬럼만 정렬 파라미터로 매핑한다. */
function toServerSortBy(id: string | undefined): 'name' | 'code' | undefined {
  return id === 'name' || id === 'code' ? id : undefined;
}

export function InventoryLookupScreen() {
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  });

  const sort = sorting[0];
  const { data, isLoading, isError, error } = useSkuSearch({
    search: query,
    limit: PAGE_SIZE,
    offset: pagination.pageIndex * PAGE_SIZE,
    sortBy: toServerSortBy(sort?.id),
    sortOrder: sort ? (sort.desc ? 'desc' : 'asc') : undefined,
  });

  // 정렬이 바뀌면 첫 페이지로.
  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    setSorting(updater);
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  };

  const columns = useMemo<ColumnDef<SkuSearchItem>[]>(
    () => [
      {
        accessorKey: 'name',
        header: '상품명',
        cell: ({ row }) => (
          <span className="font-medium text-gray-800">{row.original.name}</span>
        ),
      },
      {
        accessorKey: 'code',
        header: '코드',
        cell: ({ row }) => <span className="text-gray-500">{row.original.code}</span>,
      },
      {
        id: 'optionKey',
        header: '옵션',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-gray-500">{row.original.optionKey ?? '—'}</span>
        ),
      },
      {
        id: 'currentStock',
        header: '재고',
        enableSorting: false,
        cell: ({ row }) => <StockCell item={row.original} />,
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-800">재고조회</h1>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPagination((p) => ({ ...p, pageIndex: 0 }));
          setQuery(term);
        }}
      >
        <input
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="상품명·코드 검색"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <Button type="submit">검색</Button>
      </form>

      {isError && (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(error)}
        </p>
      )}

      {query.trim().length > 0 && (
        <DataTable<SkuSearchItem>
          columns={columns}
          data={data?.items ?? []}
          rowCount={data?.total ?? 0}
          sorting={sorting}
          onSortingChange={handleSortingChange}
          pagination={pagination}
          onPaginationChange={setPagination}
          isLoading={isLoading}
          emptyMessage="결과가 없어요."
          getRowId={(row) => row.id}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: 화면 테스트 통과 확인**

Run:
```bash
cd native/warehouse-app && npx vitest run src/domains/inventory/InventoryLookupScreen.test.tsx
```
Expected: PASS (3 tests).

- [ ] **Step 5: 전체 테스트 + 타입체크 + 린트 회귀 확인**

Run:
```bash
cd native/warehouse-app && npm test && npx tsc -b && npm run lint
```
Expected: 모든 테스트 PASS, 타입체크 통과, oxlint 신규 에러 없음.

- [ ] **Step 6: 커밋**

```bash
cd native/warehouse-app && git add src/domains/inventory/InventoryLookupScreen.tsx src/domains/inventory/InventoryLookupScreen.test.tsx && \
git commit -m "feat(warehouse-app): 재고조회를 DataTable 표 + 재고량으로 전환"
```

---

## Self-Review

**Spec coverage:**
- 카드→표 전환 → Task 5. ✅
- currentStock 컬럼 + 부족 3-상태 → Task 2(StockCell) + Task 5(컬럼). ✅
- 데이터 소스 advanced 전환 → Task 4. ✅
- 서버 페이지네이션 + name/code 서버 정렬, 옵션·재고 비정렬 → Task 3(controlled DataTable) + Task 5(enableSorting). ✅
- URL 없이 로컬 useState 소유 → Task 5(useState + queryKey). ✅
- 창고 스코프 v1(warehouseId 미전달) → Task 4(파라미터에 warehouseId 없음). ✅
- 타입 확장 → Task 1. ✅
- 의존성 추가 → Task 1. ✅
- 테스트(DataTable/useSkuSearch/InventoryLookupScreen) → Task 2·3·4·5. ✅

**Placeholder scan:** TBD/TODO/"적절히 처리" 없음. 모든 코드 스텝에 실제 코드 포함. ✅

**Type consistency:** `SkuSearchItem`(id/code/name/optionKey/currentStock/safetyStock) 은 Task 1 정의를 Task 2·4·5가 동일하게 사용. `SkuSearchParams`/`SkuSearchResult`(Task 4)를 Task 5가 동일 시그니처로 소비. `DataTableProps`(Task 3)의 prop 이름(columns/data/rowCount/sorting/onSortingChange/pagination/onPaginationChange/isLoading/emptyMessage/getRowId)을 Task 5가 그대로 전달. ✅

**주의 메모:** Task 4의 훅 테스트는 JSX를 쓰므로 파일 확장자를 `.test.tsx`로 생성한다(Step 1 노트 참조).
