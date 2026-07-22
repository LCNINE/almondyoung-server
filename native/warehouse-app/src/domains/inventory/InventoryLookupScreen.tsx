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
