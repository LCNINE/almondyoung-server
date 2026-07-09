# mall/products-list 상품 선택 UX 개선 설계

- 작성일: 2026-07-06
- 목적: admin-web `mall/products-list` 페이지의 상품 선택 기능 두 가지 불편을 해소한다 — (1) 체크박스 히트 영역이 좁고 셀 여백을 누르면 상세로 이동, (2) 페이지·필터·검색을 넘나들면 선택이 사라진 것처럼 보임.
- 상태: 설계 승인됨. 구현은 별도 세션에서 진행 (이 문서만 보고 구현 가능하도록 작성).

## 1. 목표와 범위

**대상 화면**: `apps/admin-web/src/features/mall/products-list/**` (상품 목록 테이블 + 하단 벌크 액션 바)

**해결할 문제 3가지**:

1. **셀 여백 클릭이 상세로 이동** — select 컬럼의 체크박스가 작아, 셀의 빈 영역을 누르면 행 클릭이 버블링돼 상세 페이지로 넘어간다.
2. **교차 페이지/필터 선택 유실(처럼 보임)** — 다음 페이지로 넘기거나 필터·검색을 바꾸면 하단 액션 바가 사라져 선택이 초기화된 것처럼 보인다.
3. **선택 항목 비가시성** — (2)를 유지 방식으로 고치면, 현재 필터 결과에 없는 선택 항목이 화면에 안 보이는데 카운트만 뜨는 혼란이 생긴다. 이를 완화해야 한다.

**범위 밖 (이번에 안 건드림)**:

- 벌크 액션의 서버/API 계약 — `selectedIds: string[]`만 넘기면 되므로 변경 없음.
- 헤더 "전체 선택" 체크박스의 동작 — 현재의 "현재 페이지 전체 선택"(page-scoped) 유지. 셀 클릭 토글은 body 행에만 적용.
- 다른 화면의 `DataTable` 사용처 — 공용 컴포넌트 변경은 opt-in(meta 플래그)이라 기존 사용처 영향 없음.

## 2. 현재 상태 (2026-07-06 확인)

### 관련 파일

| 파일 | 역할 |
|---|---|
| `apps/admin-web/src/features/mall/products-list/components/table/index.tsx` | 테이블 조립, 하단 액션 바, `selectedIds` 계산, `BulkActionModal` 배선 |
| `apps/admin-web/src/hooks/table/columns/use-products-list-table-columns.tsx` | 컬럼 정의. select 컬럼의 `<Checkbox>` 포함 |
| `apps/admin-web/src/hooks/use-data-table.ts` | 공용 훅. `rowSelection` state 소유, `router.replace`로 페이지네이션 |
| `apps/admin-web/src/components/data-table/data-table-root.tsx` | 실제 테이블 렌더. `<Table.Row onClick={navigate}>`, 셀 제네릭 렌더 |
| `apps/admin-web/src/features/mall/bulk/components/bulk-action-modal/index.tsx` | 벌크 액션 확인 모달. `selectedIds` 소비 |

### 문제별 원인

**문제 1 — 셀 여백 클릭이 상세로:**
`data-table-root.tsx`에서 행 전체가 네비게이션 핸들러를 가진다.
```tsx
<Table.Row className={href ? 'cursor-pointer' : ''}
           onClick={href ? () => handleRowClick(href) : undefined}>
```
select 컬럼의 체크박스는 `onClick={(e) => e.stopPropagation()}`로 정확히 눌렀을 땐 이동을 막지만, 셀(`<Table.Cell>`)의 여백을 누르면 클릭이 행으로 버블링돼 상세로 이동한다.

**문제 2 — "선택 초기화"는 SSR 한계가 아니다:**
- 페이지네이션은 `use-data-table.ts`에서 `router.replace(\`${pathname}?${params}\`, { scroll: false })` — App Router의 **soft navigation**이다. `ProductsListTable`은 언마운트되지 않고, `rowSelection` state(`useState<RowSelectionState>({})`)는 **그대로 유지된다**. (2페이지 갔다 1페이지로 돌아오면 체크가 살아있음.)
- 초기화처럼 보이는 실제 원인: `table/index.tsx`가 `selectedIds`를 `table.getSelectedRowModel().rows`로 계산한다. 이 API는 **현재 페이지에 로드된 행 중 선택된 것만** 반환한다. 다음 페이지엔 이전 페이지의 masterId가 로드돼 있지 않으므로 빈 배열 → 카운트 0 → 바가 사라진다.
- `getRowId: (row) => row.masterId`라서, 유지되는 `rowSelection`의 키가 곧 masterId다.

**문제 3 — 비가시성:**
선택은 유지되지만, 선택된 상품이 현재 필터/검색/페이지 결과에 없으면 화면에서 보이지 않는다. 카운트만으로는 "무엇이" 선택됐는지 알 수 없어, 특히 삭제 같은 파괴적 액션에서 안 보이는 항목까지 처리돼 사고가 날 수 있다.

## 3. 설계

### 3.1 이슈1 — select 셀 전체가 토글 (제네릭 meta 방식)

`DataTable`은 공용이므로 select 컬럼을 하드코딩하지 않고 **컬럼 `meta` 플래그**로 opt-in 처리한다.

**(a) 타입 보강** — `@tanstack/react-table`의 `ColumnMeta`에 플래그 추가. 기존 `apps/admin-web/src/declarations.d.ts`에 병합(신규 파일 만들지 않음):
```ts
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** 셀 아무 곳이나 클릭하면 행 선택을 토글하고, 행 네비게이션은 차단한다. */
    clickTogglesRowSelection?: boolean;
  }
}
```
(`RowData`/`TValue` 제네릭 시그니처는 `@tanstack/react-table`의 원본 `ColumnMeta` 선언과 정확히 일치해야 병합된다 — 구현 시 설치된 버전의 시그니처를 확인. 미사용 제네릭 파라미터 lint는 파일 컨벤션에 맞게 처리.)

**(b) 컬럼 정의** — `use-products-list-table-columns.tsx`의 select 컬럼:
- `meta: { clickTogglesRowSelection: true }` 추가.
- 셀의 `<Checkbox>`는 **표시 전용**으로: `checked={row.getIsSelected()}` 유지, `className`에 `pointer-events-none` 추가, 기존 `onCheckedChange` / `onClick` 제거. (헤더 체크박스는 현행 유지.)

**(c) 렌더** — `data-table-root.tsx`의 body 셀 렌더에서 meta 확인:
```tsx
{row.getVisibleCells().map((cell) => {
  const togglesSelection = cell.column.columnDef.meta?.clickTogglesRowSelection;
  return (
    <Table.Cell
      key={cell.id}
      onClick={togglesSelection
        ? (e) => { e.stopPropagation(); row.toggleSelected(); }
        : undefined}
    >
      {flexRender(cell.column.columnDef.cell, cell.getContext())}
    </Table.Cell>
  );
})}
```
- `pointer-events-none` 덕분에 체크박스 위를 눌러도 클릭이 셀로 가서 **이중 토글이 발생하지 않는다**(셀 onClick 1회만).
- `e.stopPropagation()`로 행 네비게이션을 차단한다.

**a11y 트레이드오프 (결정: 실용 버전):** 체크박스를 표시 전용으로 만들면 키보드 포커스/스페이스 토글은 사라진다. 마우스 위주의 내부 관리자 도구라 실용상 무방하다고 판단. 추후 키보드 패리티가 필요하면 셀에 `role="checkbox"` + `aria-checked` + `tabIndex=0` + `onKeyDown`(Space/Enter) 추가로 확장 가능하다 — 이번 범위에는 넣지 않는다.

### 3.2 이슈2 — 교차 페이지/필터 선택 유지

**읽는 위치만 바꾼다.** `table/index.tsx`:
```ts
const rowSelection = table.getState().rowSelection;
const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);
```
- `getSelectedRowModel()`(현재 페이지 한정) 대신 유지되는 선택 상태 전체를 사용. 키가 곧 masterId.
- **필터/검색/정렬 변경 시 초기화하지 않는다.** soft nav라 state가 이미 유지되고, 별도 clearing 로직을 추가하지 않는 것이 곧 "유지"다. 공용 `useDataTable`은 `data`가 바뀌어도 `rowSelection`을 리셋하지 않으므로 추가 조치 불필요.
- 하단 액션 바의 표시 조건·카운트(`selectedIds.length`)는 이 값을 그대로 쓰면 전 페이지 누적을 반영한다.

**근거 (워크플로우):** 관리자가 이름이 복잡한 여러 상품을 서로 다른 키워드로 검색해가며 하나씩 골라 담는 사용 방식을 지원하려면 필터 변경 시 유지가 필수다.

### 3.3 이슈3 완화 — 선택 스냅샷 레지스트리 + 팝오버 + 모달 목록

**(a) 스냅샷 레지스트리** (products-list 피처 내, 공용 훅 미변경):
- `table/index.tsx`에 `const [selectedItems, setSelectedItems] = useState<Record<string, SelectedProductSnapshot>>({})`.
  - `SelectedProductSnapshot = { masterId: string; name: string; thumbnail: string | null }` (필요한 최소 필드만).
- 동기화 effect: `rowSelection` 또는 `data`가 바뀔 때
  - 현재 `data`에 있는 **선택된** id는 스냅샷 upsert (행이 선택되는 순간 반드시 현재 페이지에 로드돼 있으므로 이름/썸네일 확보 가능).
  - `rowSelection`에서 빠진(=선택 해제된) id는 스냅샷에서 제거.
  - **변경이 있을 때만 `setSelectedItems`** 호출(다음 맵을 계산해 얕은 비교 후 다르면 교체) → 렌더 루프 방지.
- 정확한 표현: 스냅샷은 "현재 선택된 id들의 상위집합이 아니라 정확히 선택된 id 집합"을 유지한다(해제 시 즉시 제거).

**(b) 하단 액션 바 팝오버** — 신규 컴포넌트 `features/mall/products-list/components/selected-products-popover/index.tsx`:
- 트리거: 바의 "N개 선택됨" 영역(클릭 가능하게).
- 내용: `selectedItems` 목록을 썸네일 + 이름으로 나열, 각 항목에 × 버튼.
  - × 클릭 시 개별 해제: `table.setRowSelection((prev) => { const next = { ...prev }; delete next[id]; return next; })`. (해당 상품이 현재 페이지에 없어도 동작 — `getRow` 대신 `setRowSelection` 사용.)
- 하단에 "전체 해제" → 기존 `table.resetRowSelection()`.
- `@/components/ui/popover`(shadcn, `apps/admin-web/src/components/ui/popover.tsx`에 존재 확인됨) 사용.
- 목록이 길 때를 대비해 `max-h` + `overflow-y-auto`.

**(c) 삭제/복원 모달 목록** — `bulk-action-modal/index.tsx`:
- 선택적 prop 추가: `selectedItems?: { masterId: string; name: string }[]` (하위호환 — 없으면 현행처럼 개수만).
- `action === 'delete' || action === 'restore'`일 때 실제 상품명 리스트를 `max-h` 스크롤 영역에 표시.
- `table/index.tsx`에서 `Object.values(selectedItems)`를 넘긴다.

**(d) 성공 후 정리** — `handleSuccess`(벌크 성공 콜백)에서 `table.resetRowSelection()` + `setSelectedItems({})`로 스냅샷도 함께 비운다.

## 4. 손대는 파일 요약

| 파일 | 변경 |
|---|---|
| `apps/admin-web/src/declarations.d.ts` (기존 파일에 병합) | `ColumnMeta.clickTogglesRowSelection` 보강 |
| `apps/admin-web/src/hooks/table/columns/use-products-list-table-columns.tsx` | select 컬럼에 meta 추가, 체크박스 표시 전용화 |
| `apps/admin-web/src/components/data-table/data-table-root.tsx` | body 셀 meta 기반 onClick 토글 |
| `apps/admin-web/src/features/mall/products-list/components/table/index.tsx` | `selectedIds` 재계산, 스냅샷 레지스트리, 팝오버·모달 배선, 성공 후 정리 |
| `apps/admin-web/src/features/mall/products-list/components/selected-products-popover/index.tsx` (신규) | 선택 목록 팝오버 |
| `apps/admin-web/src/features/mall/bulk/components/bulk-action-modal/index.tsx` | `selectedItems` prop + delete/restore 목록 표시 |

## 5. 엣지 케이스 / 리스크

- **이중 토글**: 체크박스 `pointer-events-none`로 방지(셀 onClick만 1회). 제거하면 회귀하므로 유지 필수.
- **렌더 루프**: 스냅샷 effect는 반드시 "변경 있을 때만 setState". 얕은 비교로 no-op 판정.
- **고아 선택(orphan)**: 선택 후 그 상품이 어떤 필터로도 다시 로드되지 않아도 스냅샷과 masterId는 남는다 — 팝오버에서 항상 보이고 × 로 제거 가능하므로 수용 가능. 벌크 액션은 masterId만 필요해 정상 동작.
- **부분 실패(벌크)**: 기존 `failed` 목록 처리 로직은 그대로. 성공 항목만 선택 해제하는 정교한 처리는 이번 범위 밖(현행처럼 전체 `resetRowSelection`).
- **다른 DataTable 사용처**: meta 플래그 미설정 시 셀 onClick은 `undefined` — 기존 동작 완전 동일.
- **헤더 전체선택 + 교차 페이지**: 헤더는 현재 페이지 20개만 토글(page-scoped). 누적 카운트는 바가 정확히 표시. 의도된 동작.

## 6. 검증 방법

- **이슈1**: 목록에서 select 셀의 여백(체크박스 바깥)을 클릭 → 상세로 이동하지 않고 선택 토글. 체크박스 위 클릭도 1회 토글.
- **이슈2**: 1페이지에서 몇 개 선택 → 2페이지 이동 시 하단 바 유지 + 카운트 누적. 검색어를 바꿔 추가 선택 → 카운트 누적. 되돌아오면 체크 유지.
- **이슈3**: 하단 바 펼치면 선택 목록(썸네일·이름) 표시, × 로 개별 해제, "전체 해제" 동작. 삭제 모달에 실제 상품명 리스트 표시.
- 회귀: 다른 화면의 `DataTable`(예: bulk/template) 행 클릭 네비게이션 정상 동작.
