'use client';

import * as React from 'react';

import { cn } from '@/lib/utils/ui';
import { Button } from '@/components/common';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';

const GRID_STYLES = {
  head: 'h-auto border-[0.5px] border-[#757575] px-1 py-2 text-center align-middle text-sm font-bold leading-[18px] text-black whitespace-normal',
  cell: 'h-auto border-[0.5px] border-[#757575] px-1 py-2 text-center align-middle text-sm leading-[18px] whitespace-normal',
  header: 'bg-[#e6e4e3]',
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

    return (
      <div
        ref={ref}
        className={cn(
          'flex w-full items-center justify-between px-2 py-2',
          className
        )}
        {...props}
      >
        <div>
          <p className="text-xs">{`${count} 중 ${from} - ${to}`}</p>
        </div>
        <div className="flex items-center gap-1">
          <GoToPagePopover
            pageCount={pageCount}
            pageIndex={pageIndex}
            goPage={goPage}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={previousPage}
            disabled={!canPreviousPage}
          >
            이전
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={nextPage}
            disabled={!canNextPage}
          >
            다음
          </Button>
        </div>
      </div>
    );
  }
);
Pagination.displayName = 'Table.Pagination';

type GoToPagePopoverProps = {
  pageCount: number;
  pageIndex: number;
  goPage: (page: number) => void;
};
function GoToPagePopover({
  pageCount,
  pageIndex,
  goPage,
}: GoToPagePopoverProps) {
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const page = parseInt(value, 10);
    if (!isNaN(page) && page >= 1 && page <= pageCount) {
      goPage(page - 1);
      setOpen(false);
      setValue('');
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          {`${pageIndex + 1} / ${pageCount}`}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48">
        <form onSubmit={handleSubmit} className="grid gap-3">
          <h4 className="text-sm font-medium leading-none">페이지로 이동</h4>
          <Input
            type="number"
            autoFocus
            min={1}
            max={pageCount}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`1 - ${pageCount}`}
            className="h-8"
          />
          <Button type="submit" size="sm">
            이동
          </Button>
        </form>
      </PopoverContent>
    </Popover>
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
