'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Table } from '@/components/admin-ui-experimental/common/table/table';
import { DataTable, DataTableSearch } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { EntryActions } from '@/features/logo-contest/components/entry-actions';
import { EntryAuthor } from '@/features/logo-contest/components/entry-author';
import { EntryMediaPreview } from '@/features/logo-contest/components/entry-media-preview';
import { useDataTable } from '@/hooks/use-data-table';
import { useLogoContestTableColumns } from '@/hooks/table/columns/use-logo-contest-table-columns';
import { useLogoContestTableQuery } from '@/hooks/table/query/use-logo-contest-table-query';
import { useLogoContestEntries } from '@/lib/services/logo-contest';
import { LOGO_CONTEST_STATUS_LABELS } from '@/lib/types/dto/logo-contest';

const PAGE_SIZE = 20;

export function LogoContestEntryTable() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { searchParams: query } = useLogoContestTableQuery({
    pageSize: PAGE_SIZE,
  });
  const { data, isLoading, isFetching } = useLogoContestEntries(query);

  const columns = useLogoContestTableColumns();

  const { table } = useDataTable({
    data: data?.data ?? [],
    columns,
    count: data?.total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
  });

  const setFilter = (key: 'status' | 'sort', value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete('page');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const pageIndex = table.getState().pagination.pageIndex;
  const segmentClass = (selected: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
    }`;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-4 pb-4 sm:px-6">
        <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-1" role="group" aria-label="출품작 상태 필터">
          {[
            { value: '', label: '전체' },
            ...Object.entries(LOGO_CONTEST_STATUS_LABELS).map(([value, label]) => ({ value, label })),
          ].map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={segmentClass((query.status ?? '') === value)}
              aria-pressed={(query.status ?? '') === value}
              onClick={() => setFilter('status', value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex w-full flex-wrap items-center gap-3 sm:ml-auto sm:w-auto">
          <div className="w-full sm:w-64">
            <DataTableSearch placeholder="작품명·설명·출품자명 검색" />
          </div>
          <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-1" role="group" aria-label="출품작 정렬">
            {([
              { value: 'popular', label: '인기순' },
              { value: 'latest', label: '최신순' },
            ] as const).map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={segmentClass(query.sort === value)}
                aria-pressed={query.sort === value}
                onClick={() => setFilter('sort', value)}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="ml-auto text-sm text-muted-foreground tabular-nums sm:ml-0" aria-live="polite">
            {data ? `${data.total.toLocaleString('ko-KR')}건` : ''}
          </span>
        </div>
      </div>

      <div className="hidden md:block">
        <DataTable
          table={table}
          isLoading={isLoading}
          isFetching={isFetching}
          count={data?.total ?? 0}
          pageSize={PAGE_SIZE}
          noRecords={{ message: '출품작이 없습니다.' }}
        />
      </div>

      <div className="md:hidden">
        <div className="space-y-3 px-3 pb-4">
          {isLoading || isFetching ? (
            <p className="py-8 text-center text-sm text-muted-foreground">불러오는 중...</p>
          ) : !data?.data.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">출품작이 없습니다.</p>
          ) : (
            data.data.map((entry) => (
              <article key={entry.id} className="space-y-3 rounded-lg border p-3">
                <div className="flex gap-3">
                  <EntryMediaPreview title={entry.title} mediaFileIds={entry.mediaFileIds} />
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-semibold">{entry.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant={entry.status === 'active' ? 'default' : 'secondary'}>
                        {LOGO_CONTEST_STATUS_LABELS[entry.status]}
                      </Badge>
                      {entry.isWinner && <Badge>대상</Badge>}
                      <span className="tabular-nums text-muted-foreground">{entry.voteCount.toLocaleString('ko-KR')}표</span>
                    </div>
                  </div>
                </div>
                {entry.description && <p className="line-clamp-2 break-words text-sm text-muted-foreground">{entry.description}</p>}
                <div className="flex flex-wrap items-end justify-between gap-2 border-t pt-3">
                  <EntryAuthor userId={entry.userId} maskedName={entry.authorName} />
                  <EntryActions entry={entry} />
                </div>
              </article>
            ))
          )}
        </div>
        <Table.Pagination
          count={data?.total ?? 0}
          pageSize={PAGE_SIZE}
          pageIndex={pageIndex}
          pageCount={table.getPageCount()}
          canPreviousPage={table.getCanPreviousPage()}
          canNextPage={table.getCanNextPage()}
          previousPage={() => table.previousPage()}
          nextPage={() => table.nextPage()}
          goPage={(index) => table.setPageIndex(index)}
        />
      </div>
    </div>
  );
}
