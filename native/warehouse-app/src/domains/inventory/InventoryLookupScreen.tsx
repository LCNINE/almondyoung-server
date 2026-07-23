import { useEffect, useMemo, useRef, useState } from 'react';
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
  const [scanned, setScanned] = useState<string | null>(null);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const byBarcode = useSkuByBarcode(scanned);

  // 각 화면은 자신이 기대하는 바코드 종류를 안다 — 여기선 상품 바코드다.
  useScanner((e) => {
    setScanNotice(null);
    setScanned(e.code);
  });

  // scanned 를 null 로 되돌리는 시점과 실제 라우트 전환(언마운트) 사이에는 틈이
  // 있다 — 그 틈에 같은 바코드가 한 번 더 들어오면(하드웨어 중복 전송 등)
  // 캐시에 남은 동일 응답으로 scanned 가 되살아나 이 effect가 다시 걸릴 수
  // 있다. dataUpdatedAt(이 응답을 처음 받은 시각)으로 "이미 처리한 응답"인지
  // 표시해 두면, scanned 재설정 타이밍에 기대지 않고도 같은 응답을 두 번
  // 처리(=두 번 navigate)하지 않는다.
  const handledAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!scanned || !byBarcode.isSuccess) return;
    if (handledAtRef.current === byBarcode.dataUpdatedAt) return;
    handledAtRef.current = byBarcode.dataUpdatedAt;

    const hits = byBarcode.data ?? [];
    if (hits.length === 1) {
      setScanned(null);
      void navigate({ to: '/inventory/$sku', params: { sku: hits[0].id } });
    } else if (hits.length === 0) {
      setScanNotice(`등록되지 않은 바코드예요: ${scanned}`);
      setScanned(null);
    }
  }, [scanned, byBarcode.isSuccess, byBarcode.data, byBarcode.dataUpdatedAt, navigate]);

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

      {byBarcode.isSuccess && (byBarcode.data?.length ?? 0) > 1 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">스캔한 바코드의 상품</h2>
          <ul className="space-y-1">
            {(byBarcode.data ?? []).map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  className="w-full rounded-md border border-gray-200 bg-white p-3 text-left active:bg-gray-50"
                  onClick={() => {
                    setScanned(null);
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
