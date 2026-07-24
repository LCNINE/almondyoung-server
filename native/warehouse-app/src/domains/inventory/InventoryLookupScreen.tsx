import { useMemo, useState } from 'react';
import type {
  ColumnDef,
  OnChangeFn,
  PaginationState,
  SortingState,
} from '@tanstack/react-table';
import { Link, useNavigate } from '@tanstack/react-router';
import { Button } from '../../core/design/Button';
import { DataTable } from '../../core/design/DataTable';
import { errorMessage } from '../../core/data/errorMessage';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { useSkuSearch } from './useSkuSearch';
import { useSkuByBarcode } from './useSkuByBarcode';
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

  const navigate = useNavigate();
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [scanHits, setScanHits] = useState<SkuSearchItem[]>([]);
  const byBarcode = useSkuByBarcode();

  // 각 화면은 자신이 기대하는 바코드 종류를 안다 — 여기선 상품 바코드다. 스캔은
  // "상태"가 아니라 "이벤트"다 — mutate 호출마다 독립적으로 요청하고, 그 결과는
  // 이 호출의 onSuccess 에서만 정확히 한 번 소비한다. 캐시 신선도(staleTime)나
  // effect 의 재진입에 기대지 않는다 — 그 설계는 두 방향의 버그(응답 누락, 중복
  // 처리)를 모두 냈다.
  useScanner((e) => {
    if (byBarcode.isPending) return; // 응답을 기다리는 동안 겹치는 스캔은 무시한다
    setScanNotice(null);
    setScanHits([]);
    byBarcode.mutate(e.code, {
      onSuccess: (hits) => {
        if (hits.length === 1) {
          void navigate({ to: '/inventory/$sku', params: { sku: hits[0].id } });
        } else if (hits.length === 0) {
          setScanNotice(`등록되지 않은 바코드예요: ${e.code}`);
        } else {
          setScanHits(hits);
        }
      },
    });
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
          <Link
            to="/inventory/$sku"
            params={{ sku: row.original.id }}
            className="font-medium text-blue-700 underline"
          >
            {row.original.name}
          </Link>
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

      {scanNotice ? (
        <p role="status" className="text-sm text-amber-700">
          {scanNotice}
        </p>
      ) : null}

      {scanHits.length > 1 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">스캔한 바코드의 상품</h2>
          <ul className="space-y-1">
            {scanHits.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  className="w-full rounded-md border border-gray-200 bg-white p-3 text-left active:bg-gray-50"
                  onClick={() => {
                    setScanHits([]);
                    void navigate({ to: '/inventory/$sku', params: { sku: hit.id } });
                  }}
                >
                  <span className="block font-medium text-gray-800">{hit.name}</span>
                  <span className="block font-mono text-xs text-gray-500">{hit.code}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {isError && (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(error)}
        </p>
      )}

      {!isError && query.trim().length > 0 && (
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
