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
