'use client';

import * as React from 'react';

import { cn } from '@/lib/utils/ui';
import { Input } from '@/components/ui/input';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getPageRange } from './page-range';

// Container 안 헤더(px-6)·필터 줄·페이지 이동과 같은 시작선
const EDGE_GUTTER = 'first:pl-6 last:pr-6';

const GRID_STYLES = {
  head: 'h-auto border-[0.5px] border-[#D9D9D9] px-1 py-2 text-center align-middle text-sm font-bold leading-[18px] text-black whitespace-normal',
  cell: 'h-auto border-[0.5px] border-[#D9D9D9] px-1 py-2 text-center align-middle text-sm leading-[18px] whitespace-normal',
  header: 'bg-[#F5F5F5]',
  row: 'border-b-0 hover:bg-black/[0.02]',
} as const;

type TableVariant = 'plain' | 'grid';

const VariantContext = React.createContext<TableVariant>('plain');

function Root({
  className,
  variant = 'plain',
  ...props
}: React.ComponentProps<'table'> & { variant?: TableVariant }) {
  return (
    <VariantContext.Provider value={variant}>
      <div
        data-slot="table-container"
        className="relative w-full overflow-x-auto"
      >
        <table
          data-slot="table"
          data-variant={variant}
          className={cn(
            'w-full caption-bottom text-sm',
            variant === 'grid' && 'table-fixed border-collapse',
            className
          )}
          {...props}
        />
      </div>
    </VariantContext.Provider>
  );
}

function Header({ className, ...props }: React.ComponentProps<'thead'>) {
  const variant = React.useContext(VariantContext);
  return (
    <thead
      data-slot="table-header"
      className={cn(
        '[&_tr]:border-b bg-muted',
        variant === 'grid' && GRID_STYLES.header,
        className
      )}
      {...props}
    />
  );
}

function Body({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
}

function Footer({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        'bg-muted/50 border-t font-medium [&>tr]:last:border-b-0',
        className
      )}
      {...props}
    />
  );
}

function Row({ className, ...props }: React.ComponentProps<'tr'>) {
  const variant = React.useContext(VariantContext);
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors',
        variant === 'grid' && GRID_STYLES.row,
        className
      )}
      {...props}
    />
  );
}

function Head({ className, ...props }: React.ComponentProps<'th'>) {
  const variant = React.useContext(VariantContext);
  return (
    <th
      data-slot="table-head"
      className={cn(
        'text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        variant !== 'grid' && EDGE_GUTTER,
        variant === 'grid' && GRID_STYLES.head,
        className
      )}
      {...props}
    />
  );
}

function Cell({ className, ...props }: React.ComponentProps<'td'>) {
  const variant = React.useContext(VariantContext);
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'h-10 px-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        variant !== 'grid' && EDGE_GUTTER,
        variant === 'grid' && GRID_STYLES.cell,
        className
      )}
      {...props}
    />
  );
}

function Caption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('text-muted-foreground mt-4 text-sm', className)}
      {...props}
    />
  );
}

interface TablePaginationProps extends React.HTMLAttributes<HTMLDivElement> {
  count: number;
  pageSize: number;
  pageIndex: number;
  pageCount: number;
  canPreviousPage: boolean;
  canNextPage: boolean;
  previousPage: () => void;
  nextPage: () => void;
  goPage: (page: number) => void;
}

const Pagination = React.forwardRef<HTMLDivElement, TablePaginationProps>(
  (
    {
      className,
      count,
      pageSize,
      pageIndex,
      pageCount,
      canPreviousPage,
      canNextPage,
      previousPage,
      nextPage,
      goPage,
      ...props
    }: TablePaginationProps,
    ref
  ) => {
    const { from, to } = React.useMemo(() => {
      const from = count === 0 ? count : pageIndex * pageSize + 1;
      const to = Math.min(count, (pageIndex + 1) * pageSize);

      return { from, to };
    }, [count, pageIndex, pageSize]);

    const range = pageCount > 1 ? getPageRange(pageIndex + 1, pageCount) : [];

    return (
      <div
        ref={ref}
        className={cn(
          'sticky bottom-0 z-10 flex w-full items-center justify-between gap-4 border-t bg-white px-6 py-3',
          className
        )}
        {...props}
      >
        <p className="text-muted-foreground text-[13px] tabular-nums">
          전체 <span className="text-foreground font-bold">{count.toLocaleString()}</span>건
          {count > 0 && ` · ${from.toLocaleString()}–${to.toLocaleString()}`}
        </p>
        {pageCount > 1 && (
          <nav aria-label="페이지 이동" className="flex items-center gap-1">
            <PageButton
              onClick={previousPage}
              disabled={!canPreviousPage}
              aria-label="이전 페이지"
            >
              <ChevronLeft className="size-4" />
            </PageButton>
            {range.map((page, i) =>
              page === '...' ? (
                <span
                  key={`gap-${i}`}
                  className="text-muted-foreground w-6 text-center text-xs"
                >
                  …
                </span>
              ) : (
                <PageButton
                  key={page}
                  onClick={() => goPage(page - 1)}
                  aria-current={page === pageIndex + 1 ? 'page' : undefined}
                >
                  {page}
                </PageButton>
              )
            )}
            <PageButton
              onClick={nextPage}
              disabled={!canNextPage}
              aria-label="다음 페이지"
            >
              <ChevronRight className="size-4" />
            </PageButton>
            {/* 번호가 다 보이면 누르면 되니, 생략(…)이 생길 때부터 직접 입력을 둔다 */}
            {range.includes('...') && (
              <GoToPageInput
                key={pageIndex}
                pageCount={pageCount}
                pageIndex={pageIndex}
                goPage={goPage}
              />
            )}
          </nav>
        )}
      </div>
    );
  }
);
Pagination.displayName = 'Table.Pagination';

function PageButton({
  className,
  ...props
}: React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'text-muted-foreground hover:bg-muted hover:text-foreground flex h-8 cursor-pointer min-w-8 items-center justify-center rounded-md px-2 text-[13px] font-medium tabular-nums transition-colors disabled:pointer-events-none disabled:opacity-30',
        'aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground',
        className
      )}
      {...props}
    />
  );
}

function GoToPageInput({
  pageCount,
  pageIndex,
  goPage,
}: {
  pageCount: number;
  pageIndex: number;
  goPage: (page: number) => void;
}) {
  const [value, setValue] = React.useState(String(pageIndex + 1));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const page = parseInt(value, 10);
    if (!isNaN(page) && page >= 1 && page <= pageCount) goPage(page - 1);
    else setValue(String(pageIndex + 1));
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="text-muted-foreground ml-3 flex items-center gap-1.5 border-l pl-4 text-[13px] tabular-nums"
    >
      <Input
        type="number"
        min={1}
        max={pageCount}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => setValue(String(pageIndex + 1))}
        aria-label={`이동할 페이지 (1-${pageCount})`}
        className="h-8 w-14 px-2 text-center text-[13px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span>/ {pageCount}페이지</span>
    </form>
  );
}

const Table = Object.assign(Root, {
  Header,
  Body,
  Footer,
  Head,
  Row,
  Cell,
  Caption,
  Pagination,
});

export { Table };
