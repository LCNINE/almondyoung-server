# 상품 목록 선택 UX 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** admin-web `mall/products-list`에서 (1) select 셀 아무 곳이나 클릭하면 상세 이동 없이 선택 토글, (2) 페이지·필터·검색을 넘나들어도 선택 누적 유지, (3) 선택 항목을 팝오버·삭제 모달에서 항상 볼/지울 수 있게 한다.

**Architecture:** 테스트 가능한 순수 로직(선택 id 추출 + 스냅샷 재조정)을 `products-list-selection-model.ts`로 분리해 jest로 TDD하고, 나머지 JSX 배선(제네릭 meta 기반 셀 클릭 토글, 스냅샷 effect, 팝오버, 모달 목록)은 타입체크·린트·수동 검증으로 확인한다. 공용 `DataTable`/`useDataTable`은 opt-in meta 플래그만 추가해 기존 사용처에 영향 없음.

**Tech Stack:** Next.js(App Router) · React · TypeScript · @tanstack/react-table · shadcn UI(Checkbox/Popover/Dialog) · Jest(ts-jest, node env, `.spec.ts`만)

## Global Constraints

- 테스트 실행 환경은 `.spec.ts`만 인식(node env, JSX/RTL 없음). 컴포넌트 동작은 jest가 아니라 타입체크+린트+수동 검증으로 확인한다. (`package.json` jest: `testRegex: ".*\\.spec\\.ts$"`, `moduleFileExtensions`에 tsx 없음)
- `any` / `as` 캐스팅 금지(정당한 사유 없이). nullable 정규화: `thumbnail` 은 `?? null`.
- **필터/검색/정렬 변경 시 선택을 초기화하지 않는다** — clearing 로직을 추가하지 않는 것이 곧 유지. (soft nav라 `rowSelection` state가 유지됨)
- select 셀의 `<Checkbox>` 는 반드시 `pointer-events-none`(표시 전용) — 셀 onClick 과 이중 토글을 막는 유일한 장치. 제거 금지.
- admin-web 명령: 타입체크 `cd apps/admin-web && npm run type-check`, 린트 `cd apps/admin-web && npm run lint`, dev 서버 `npm run start:admin-web:dev`(포트 8000, 리포 루트에서).
- 단일 jest 파일 실행(리포 루트): `npx jest --testPathPattern='products-list-selection-model'`.
- 커밋 메시지 끝에 트레일러: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

| 파일 | 책임 |
|---|---|
| `apps/admin-web/src/features/mall/products-list/components/table/products-list-selection-model.ts` (신규) | 순수 로직: 선택 id 추출, 스냅샷 재조정 |
| `apps/admin-web/src/features/mall/products-list/components/table/products-list-selection-model.spec.ts` (신규) | 위 로직 단위 테스트 |
| `apps/admin-web/src/declarations.d.ts` (수정) | `ColumnMeta.clickTogglesRowSelection` 타입 보강 |
| `apps/admin-web/src/components/data-table/data-table-root.tsx` (수정) | body 셀 meta 기반 onClick 토글 |
| `apps/admin-web/src/hooks/table/columns/use-products-list-table-columns.tsx` (수정) | select 컬럼 meta + 체크박스 표시 전용화 |
| `apps/admin-web/src/features/mall/products-list/components/table/index.tsx` (수정) | selectedIds 재계산, 스냅샷 state·effect, 팝오버·모달 배선, 성공 후 정리 |
| `apps/admin-web/src/features/mall/products-list/components/selected-products-popover/index.tsx` (신규) | 선택 목록 팝오버 |
| `apps/admin-web/src/features/mall/bulk/components/bulk-action-modal/index.tsx` (수정) | `selectedItems` prop + delete/restore 목록 표시 |

---

### Task 1: 선택 순수 로직 모델 (TDD)

**Files:**
- Create: `apps/admin-web/src/features/mall/products-list/components/table/products-list-selection-model.ts`
- Test: `apps/admin-web/src/features/mall/products-list/components/table/products-list-selection-model.spec.ts`

**Interfaces:**
- Produces:
  - `type SelectedProductSnapshot = { masterId: string; name: string; thumbnail: string | null }`
  - `selectedIdsFromRowSelection(rowSelection: RowSelectionState): string[]`
  - `reconcileSelectedSnapshots(prev: Record<string, SelectedProductSnapshot>, rowSelection: RowSelectionState, currentRows: SelectedProductSnapshot[]): { changed: boolean; next: Record<string, SelectedProductSnapshot> }`

- [ ] **Step 1: Write the failing test**

Create `apps/admin-web/src/features/mall/products-list/components/table/products-list-selection-model.spec.ts`:

```ts
import {
  selectedIdsFromRowSelection,
  reconcileSelectedSnapshots,
  type SelectedProductSnapshot,
} from './products-list-selection-model';

const snap = (
  masterId: string,
  name = masterId,
  thumbnail: string | null = null,
): SelectedProductSnapshot => ({ masterId, name, thumbnail });

describe('selectedIdsFromRowSelection', () => {
  it('truthy 값을 가진 키만 반환한다', () => {
    expect(selectedIdsFromRowSelection({ a: true, b: false, c: true })).toEqual([
      'a',
      'c',
    ]);
  });

  it('빈 선택은 빈 배열', () => {
    expect(selectedIdsFromRowSelection({})).toEqual([]);
  });
});

describe('reconcileSelectedSnapshots', () => {
  it('현재 페이지에 로드된 선택 행의 스냅샷을 담고 changed=true', () => {
    const { changed, next } = reconcileSelectedSnapshots(
      {},
      { p1: true },
      [snap('p1', '상품1', 'thumb1.jpg'), snap('p2', '상품2')],
    );
    expect(changed).toBe(true);
    expect(next).toEqual({ p1: snap('p1', '상품1', 'thumb1.jpg') });
  });

  it('현재 페이지에 없어도 이전 스냅샷이 있으면 유지한다(교차 페이지)', () => {
    const prev = { p1: snap('p1', '상품1', 'thumb1.jpg') };
    const { changed, next } = reconcileSelectedSnapshots(
      prev,
      { p1: true, p2: true },
      [snap('p2', '상품2')], // p1 은 다른 페이지라 로드 안 됨
    );
    expect(changed).toBe(true);
    expect(next.p1).toEqual(snap('p1', '상품1', 'thumb1.jpg'));
    expect(next.p2).toEqual(snap('p2', '상품2'));
  });

  it('선택 해제된 id 는 스냅샷에서 제거하고 changed=true', () => {
    const prev = { p1: snap('p1'), p2: snap('p2') };
    const { changed, next } = reconcileSelectedSnapshots(
      prev,
      { p1: true, p2: false },
      [],
    );
    expect(changed).toBe(true);
    expect(next).toEqual({ p1: snap('p1') });
  });

  it('변화가 없으면 changed=false (렌더 루프 방지)', () => {
    const prev = { p1: snap('p1', '상품1', 'thumb1.jpg') };
    const { changed } = reconcileSelectedSnapshots(
      prev,
      { p1: true },
      [snap('p1', '상품1', 'thumb1.jpg')],
    );
    expect(changed).toBe(false);
  });

  it('로드도 안 됐고 이전 스냅샷도 없으면 masterId 를 이름 폴백으로 쓴다', () => {
    const { next } = reconcileSelectedSnapshots({}, { orphan: true }, []);
    expect(next.orphan).toEqual({
      masterId: 'orphan',
      name: 'orphan',
      thumbnail: null,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPattern='products-list-selection-model'`
Expected: FAIL — `Cannot find module './products-list-selection-model'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/admin-web/src/features/mall/products-list/components/table/products-list-selection-model.ts`:

```ts
import type { RowSelectionState } from '@tanstack/react-table';

export type SelectedProductSnapshot = {
  masterId: string;
  name: string;
  thumbnail: string | null;
};

/** 유지되는 선택 상태(rowSelection)에서 선택된 masterId 만 뽑는다. */
export function selectedIdsFromRowSelection(
  rowSelection: RowSelectionState,
): string[] {
  return Object.keys(rowSelection).filter((id) => rowSelection[id]);
}

function snapshotsEqual(
  a: SelectedProductSnapshot,
  b: SelectedProductSnapshot,
): boolean {
  return (
    a.masterId === b.masterId && a.name === b.name && a.thumbnail === b.thumbnail
  );
}

function snapshotMapsEqual(
  a: Record<string, SelectedProductSnapshot>,
  b: Record<string, SelectedProductSnapshot>,
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((k) => b[k] !== undefined && snapshotsEqual(a[k], b[k]));
}

/**
 * 선택 스냅샷 레지스트리를 현재 선택 상태 + 현재 화면에 로드된 행에 맞춰 재조정한다.
 * - 선택된 id 중 현재 페이지에 있는 행은 최신 스냅샷으로 갱신
 * - 현재 페이지에 없지만 이전 스냅샷이 있으면 유지 (다른 페이지/필터에서 선택된 항목)
 * - 선택 해제된 id 는 제거
 * changed=false 면 호출부가 setState 를 건너뛰어 렌더 루프를 막는다.
 */
export function reconcileSelectedSnapshots(
  prev: Record<string, SelectedProductSnapshot>,
  rowSelection: RowSelectionState,
  currentRows: SelectedProductSnapshot[],
): { changed: boolean; next: Record<string, SelectedProductSnapshot> } {
  const byId = new Map(currentRows.map((r) => [r.masterId, r]));
  const next: Record<string, SelectedProductSnapshot> = {};

  for (const id of selectedIdsFromRowSelection(rowSelection)) {
    next[id] =
      byId.get(id) ?? prev[id] ?? { masterId: id, name: id, thumbnail: null };
  }

  return { changed: !snapshotMapsEqual(prev, next), next };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --testPathPattern='products-list-selection-model'`
Expected: PASS — 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/features/mall/products-list/components/table/products-list-selection-model.ts \
        apps/admin-web/src/features/mall/products-list/components/table/products-list-selection-model.spec.ts
git commit -m "$(cat <<'EOF'
[admin-web] 상품 목록 선택 스냅샷 순수 로직 추가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 이슈1 — select 셀 전체 클릭 토글 (제네릭 meta)

**Files:**
- Modify: `apps/admin-web/src/declarations.d.ts`
- Modify: `apps/admin-web/src/components/data-table/data-table-root.tsx:92-110`
- Modify: `apps/admin-web/src/hooks/table/columns/use-products-list-table-columns.tsx:58-79`

**Interfaces:**
- Produces: `@tanstack/react-table` 의 `ColumnMeta.clickTogglesRowSelection?: boolean` 플래그. 이 플래그가 설정된 컬럼의 body 셀은 클릭 시 `row.toggleSelected()` + `stopPropagation`.
- Consumes: 없음 (Task 1 과 독립).

- [ ] **Step 1: ColumnMeta 타입 보강**

`apps/admin-web/src/declarations.d.ts` 전체를 다음으로 교체:

```ts
import type { RowData } from '@tanstack/react-table';

declare module '*.css';

declare module '@tanstack/react-table' {
  // 원본 ColumnMeta 제네릭 시그니처와 일치해야 병합된다.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** 셀 아무 곳이나 클릭하면 행 선택을 토글하고, 행 네비게이션은 차단한다. */
    clickTogglesRowSelection?: boolean;
  }
}
```

- [ ] **Step 2: data-table-root 의 body 셀에 meta 기반 onClick 추가**

`apps/admin-web/src/components/data-table/data-table-root.tsx` 의 `rows.map(...)` 내부 셀 렌더(현재 92-110행)를 다음으로 교체:

```tsx
            rows.map((row) => {
              const href = navigateTo ? navigateTo(row) : undefined;
              return (
                <Table.Row
                  key={row.id}
                  className={href ? 'cursor-pointer' : ''}
                  onClick={href ? () => handleRowClick(href) : undefined}
                >
                  {row.getVisibleCells().map((cell) => {
                    const togglesSelection =
                      cell.column.columnDef.meta?.clickTogglesRowSelection;
                    return (
                      <Table.Cell
                        key={cell.id}
                        onClick={
                          togglesSelection
                            ? (e) => {
                                e.stopPropagation();
                                row.toggleSelected();
                              }
                            : undefined
                        }
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </Table.Cell>
                    );
                  })}
                </Table.Row>
              );
            })
```

- [ ] **Step 3: select 컬럼에 meta 추가 + 체크박스 표시 전용화**

`apps/admin-web/src/hooks/table/columns/use-products-list-table-columns.tsx` 의 select 컬럼(현재 58-79행)을 다음으로 교체. **헤더 체크박스는 그대로 두고**, cell 의 체크박스만 표시 전용으로 바꾼다:

```tsx
      columnHelper.display({
        id: 'select',
        meta: { clickTogglesRowSelection: true },
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && 'indeterminate')
            }
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label="전체 선택"
            onClick={(e) => e.stopPropagation()}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            aria-label="행 선택"
            className="pointer-events-none"
          />
        ),
      }),
```

- [ ] **Step 4: 타입체크 + 린트**

Run:
```bash
cd apps/admin-web && npm run type-check && npm run lint
```
Expected: 둘 다 에러 없이 종료(exit 0). 특히 `meta?.clickTogglesRowSelection` 접근이 타입 에러 없이 통과해야 한다(= 보강 성공). 만약 `declare module '*.css'` 관련 에러가 나면, 보강 블록만 별도 파일 `apps/admin-web/src/tanstack-table.d.ts`(위 `declare module '@tanstack/react-table'` 블록 + `import type { RowData }`)로 옮기고 `declarations.d.ts` 는 원복한 뒤 다시 실행한다.

- [ ] **Step 5: 수동 검증**

리포 루트에서 `npm run start:admin-web:dev` 실행 후 `http://localhost:8000/mall/products-list` 접속(로그인 필요).
- select 셀의 **체크박스 바깥 여백**을 클릭 → 상세로 이동하지 않고 해당 행이 선택됨(체크 표시).
- 체크박스 **위**를 클릭 → 정확히 1회 토글(다시 클릭하면 해제).
- 다른 컬럼(상품명 등) 클릭 → 기존대로 상세로 이동.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/src/declarations.d.ts \
        apps/admin-web/src/components/data-table/data-table-root.tsx \
        apps/admin-web/src/hooks/table/columns/use-products-list-table-columns.tsx
git commit -m "$(cat <<'EOF'
[admin-web] 상품 목록 select 셀 전체 클릭으로 선택 토글

셀 여백 클릭이 상세로 이동하던 문제 해결. 컬럼 meta 플래그로
opt-in 하고, 체크박스는 pointer-events-none 표시 전용으로 두어
셀 onClick 과의 이중 토글을 막는다.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 이슈2 — 교차 페이지 선택 유지 + 스냅샷 레지스트리 배선

**Files:**
- Modify: `apps/admin-web/src/features/mall/products-list/components/table/index.tsx`

**Interfaces:**
- Consumes (Task 1): `selectedIdsFromRowSelection`, `reconcileSelectedSnapshots`, `SelectedProductSnapshot`.
- Produces: 컴포넌트 로컬 상태 `selectedItems: Record<string, SelectedProductSnapshot>` 와 `selectedIds: string[]`(교차 페이지 누적). Task 4/5 가 이 값을 소비.

- [ ] **Step 1: import 추가**

`apps/admin-web/src/features/mall/products-list/components/table/index.tsx` 상단 import 블록에 추가:

```tsx
import { useEffect, useState } from 'react';
import {
  selectedIdsFromRowSelection,
  reconcileSelectedSnapshots,
  type SelectedProductSnapshot,
} from './products-list-selection-model';
```

(기존 `import { useState } from 'react';` 는 위 라인으로 대체 — 중복 import 되지 않게 한 줄로 합친다.)

- [ ] **Step 2: selectedIds 재계산 + 스냅샷 state·effect + 성공 후 정리로 교체**

현재 다음 블록:

```tsx
  const selectedIds = table
    .getSelectedRowModel()
    .rows.map((r) => r.original.masterId);

  function handleSuccess() {
    table.resetRowSelection();
  }
```

을 다음으로 교체:

```tsx
  const [selectedItems, setSelectedItems] = useState<
    Record<string, SelectedProductSnapshot>
  >({});

  const rowSelection = table.getState().rowSelection;
  const selectedIds = selectedIdsFromRowSelection(rowSelection);

  // 선택되는 순간 그 행은 반드시 현재 페이지에 로드돼 있으므로,
  // 이름/썸네일 스냅샷을 담아 교차 페이지/필터에서도 목록을 보여줄 수 있게 한다.
  useEffect(() => {
    const currentRows: SelectedProductSnapshot[] = (data?.data ?? []).map(
      (r) => ({
        masterId: r.masterId,
        name: r.name,
        thumbnail: r.thumbnail ?? null,
      })
    );
    setSelectedItems((prev) => {
      const { changed, next } = reconcileSelectedSnapshots(
        prev,
        rowSelection,
        currentRows
      );
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowSelection, data]);

  function handleSuccess() {
    table.resetRowSelection();
    setSelectedItems({});
  }
```

- [ ] **Step 3: 타입체크 + 린트**

Run:
```bash
cd apps/admin-web && npm run type-check && npm run lint
```
Expected: exit 0. (하단 액션 바 JSX 는 아직 그대로 — `selectedIds.length` 카운트만 교차 페이지 누적으로 바뀜.)

- [ ] **Step 4: 수동 검증**

`npm run start:admin-web:dev` → `/mall/products-list`:
- 1페이지에서 2~3개 선택 → 하단 바에 카운트 표시.
- **2페이지로 이동** → 바가 사라지지 않고 카운트 유지. 2페이지에서 추가 선택 시 카운트 누적.
- 검색어를 바꿔도(필터 변경) 기존 카운트 유지, 추가 선택 시 누적.
- 1페이지로 돌아오면 앞서 고른 행 체크가 살아있음.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/features/mall/products-list/components/table/index.tsx
git commit -m "$(cat <<'EOF'
[admin-web] 상품 목록 선택을 페이지·필터 넘어 유지

selectedIds 를 getSelectedRowModel(현재 페이지 한정) 대신 유지되는
rowSelection 상태에서 계산하고, 선택 항목 스냅샷 레지스트리를 둔다.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 이슈3 — 선택 목록 팝오버

**Files:**
- Create: `apps/admin-web/src/features/mall/products-list/components/selected-products-popover/index.tsx`
- Modify: `apps/admin-web/src/features/mall/products-list/components/table/index.tsx`

**Interfaces:**
- Consumes (Task 3): `selectedItems`(→ `Object.values`), `table.setRowSelection`, `table.resetRowSelection`.
- Produces: `SelectedProductsPopover` 컴포넌트 — props `{ items: SelectedProductSnapshot[]; onRemove: (masterId: string) => void; onClearAll: () => void }`.

- [ ] **Step 1: 팝오버 컴포넌트 생성**

Create `apps/admin-web/src/features/mall/products-list/components/selected-products-popover/index.tsx`:

```tsx
'use client';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { X, ImageOff } from 'lucide-react';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import type { SelectedProductSnapshot } from '../table/products-list-selection-model';

type Props = {
  items: SelectedProductSnapshot[];
  onRemove: (masterId: string) => void;
  onClearAll: () => void;
};

export function SelectedProductsPopover({
  items,
  onRemove,
  onClearAll,
}: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="text-sm text-muted-foreground whitespace-nowrap"
        >
          {items.length}개 선택됨
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-sm font-medium">
            선택한 상품 {items.length}개
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-auto p-0 text-xs text-muted-foreground"
            onClick={onClearAll}
          >
            전체 해제
          </Button>
        </div>
        <ul className="p-2 space-y-1 overflow-y-auto max-h-72">
          {items.map((item) => {
            const src = resolvePublicFileUrl(item.thumbnail);
            return (
              <li
                key={item.masterId}
                className="flex items-center gap-2 p-1 rounded hover:bg-muted"
              >
                <div className="w-8 h-8 overflow-hidden rounded shrink-0 bg-muted">
                  {src ? (
                    <img
                      src={src}
                      alt=""
                      className="object-cover w-full h-full"
                    />
                  ) : (
                    <div className="flex items-center justify-center w-full h-full text-muted-foreground">
                      <ImageOff className="w-3 h-3" />
                    </div>
                  )}
                </div>
                <span className="flex-1 text-xs truncate" title={item.name}>
                  {item.name}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-6 h-6 p-0 shrink-0"
                  onClick={() => onRemove(item.masterId)}
                  aria-label="선택 해제"
                >
                  <X className="w-3 h-3" />
                </Button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: 액션 바에 팝오버 배선**

`apps/admin-web/src/features/mall/products-list/components/table/index.tsx`:

(a) import 추가:
```tsx
import { SelectedProductsPopover } from '../selected-products-popover';
```

(b) 하단 액션 바에서 현재 카운트 span 과 "선택 해제" 버튼을 팝오버로 교체. 현재:
```tsx
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {selectedIds.length}개 선택됨
          </span>
```
을 다음으로 교체:
```tsx
          <SelectedProductsPopover
            items={Object.values(selectedItems)}
            onRemove={(masterId) =>
              table.setRowSelection((prev) => {
                const next = { ...prev };
                delete next[masterId];
                return next;
              })
            }
            onClearAll={() => table.resetRowSelection()}
          />
```
그리고 바 맨 끝의 기존 "선택 해제" ghost 버튼(현재 72-78행)을 제거한다(팝오버의 "전체 해제"로 대체됨). 나머지 버튼(엑셀 다운로드/상품상태변경/삭제)은 유지.

- [ ] **Step 3: 타입체크 + 린트**

Run:
```bash
cd apps/admin-web && npm run type-check && npm run lint
```
Expected: exit 0.

- [ ] **Step 4: 수동 검증**

`npm run start:admin-web:dev` → `/mall/products-list`:
- 여러 페이지에 걸쳐 선택 → 하단 "N개 선택됨" 클릭 → 팝오버에 썸네일+이름 목록.
- 항목 × 클릭 → 그 항목만 해제(현재 페이지에 없는 항목도 해제됨), 카운트 감소.
- "전체 해제" → 모두 해제, 바 사라짐.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/features/mall/products-list/components/selected-products-popover/index.tsx \
        apps/admin-web/src/features/mall/products-list/components/table/index.tsx
git commit -m "$(cat <<'EOF'
[admin-web] 상품 목록 선택 내역 팝오버 추가

교차 페이지 선택의 비가시성 완화 — 선택 항목을 썸네일·이름으로
나열하고 개별/전체 해제 제공.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 이슈3 — 삭제/복원 모달에 상품명 목록

**Files:**
- Modify: `apps/admin-web/src/features/mall/bulk/components/bulk-action-modal/index.tsx`
- Modify: `apps/admin-web/src/features/mall/products-list/components/table/index.tsx`

**Interfaces:**
- Consumes (Task 3): `selectedItems`(→ `Object.values`).
- `BulkActionModal` 에 선택적 prop `selectedItems?: { masterId: string; name: string }[]` 추가(하위호환).

- [ ] **Step 1: 모달 prop + 목록 렌더 추가**

`apps/admin-web/src/features/mall/bulk/components/bulk-action-modal/index.tsx`:

(a) `Props` 인터페이스에 추가:
```tsx
  selectedItems?: { masterId: string; name: string }[];
```

(b) 함수 시그니처 구조분해에 `selectedItems` 추가:
```tsx
export function BulkActionModal({
  open,
  onOpenChange,
  action,
  selectedIds,
  selectedItems,
  onSuccess,
}: Props) {
```

(c) delete/restore 안내 블록(현재 212-216행)을 다음으로 교체:
```tsx
          {(action === 'delete' || action === 'restore') && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">
                이 작업은 되돌릴 수 있습니다.
              </p>
              {selectedItems && selectedItems.length > 0 && (
                <ul className="p-2 space-y-1 overflow-y-auto text-xs border rounded-md max-h-40 text-muted-foreground">
                  {selectedItems.map((item) => (
                    <li
                      key={item.masterId}
                      className="truncate text-foreground"
                      title={item.name}
                    >
                      {item.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
```

- [ ] **Step 2: 테이블에서 selectedItems 전달**

`apps/admin-web/src/features/mall/products-list/components/table/index.tsx` 의 `<BulkActionModal ... />` 에 prop 추가:
```tsx
      <BulkActionModal
        open={modalAction !== null}
        onOpenChange={(open) => !open && setModalAction(null)}
        action={modalAction}
        selectedIds={selectedIds}
        selectedItems={Object.values(selectedItems)}
        onSuccess={handleSuccess}
      />
```

- [ ] **Step 3: 타입체크 + 린트**

Run:
```bash
cd apps/admin-web && npm run type-check && npm run lint
```
Expected: exit 0. (`SelectedProductSnapshot[]` 은 `{masterId,name}` 필드를 포함하므로 `{ masterId; name }[]` prop 에 그대로 할당 가능.)

- [ ] **Step 4: 수동 검증**

`npm run start:admin-web:dev` → `/mall/products-list`:
- 여러 페이지 선택 → "선택 삭제" → 모달에 실제 상품명 리스트 표시(현재 페이지에 없는 항목 포함).
- 삭제 실행 후 선택·스냅샷 모두 초기화(바 사라짐).

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/features/mall/bulk/components/bulk-action-modal/index.tsx \
        apps/admin-web/src/features/mall/products-list/components/table/index.tsx
git commit -m "$(cat <<'EOF'
[admin-web] 벌크 삭제/복원 모달에 대상 상품명 목록 표시

파괴적 액션 전 무엇이 선택됐는지 확인 가능하게 함.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## 최종 검증 (전 태스크 완료 후)

- [ ] 리포 루트에서 `npx jest --testPathPattern='products-list-selection-model'` → 통과.
- [ ] `cd apps/admin-web && npm run type-check && npm run lint` → exit 0.
- [ ] 스펙 §6 시나리오 전부 수동 확인(이슈1/2/3 + 회귀: bulk/template 등 다른 DataTable 행 클릭 정상).
- [ ] `git log --oneline` 으로 5개 태스크 커밋 확인.
