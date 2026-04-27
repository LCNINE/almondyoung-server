'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { DateCell } from '@/components/table/table-cells/common';
import type { SupplierDto } from '@/lib/types/dto/inventory';
import { Button } from '@/components/ui/button';

const columnHelper = createColumnHelper<SupplierDto>();

type RowActions = {
  onDetail: (row: SupplierDto) => void;
};

export const useSuppliersTableColumns = (actions: RowActions) => {
  return useMemo(
    () => [
      columnHelper.accessor('name', {
        header: '공급처명',
        cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
      }),
      columnHelper.accessor('categories', {
        header: '분류',
        cell: ({ getValue }) => {
          const cats = getValue();
          if (!cats?.length) return <span className="text-xs text-muted-foreground/40">—</span>;
          return <span className="text-sm">{cats.map((c) => c.name).join(', ')}</span>;
        },
      }),
      columnHelper.accessor('contact', {
        header: '연락처',
        cell: ({ getValue }) => {
          const c = getValue();
          if (!c) return <span className="text-xs text-muted-foreground/40">—</span>;
          return (
            <span className="text-sm">
              {c.phone ?? c.email ?? '—'}
            </span>
          );
        },
      }),
      columnHelper.accessor('address', {
        header: '주소',
        cell: ({ getValue }) => {
          const a = getValue();
          if (!a?.address1) return <span className="text-xs text-muted-foreground/40">—</span>;
          return <span className="text-sm">{a.address1}</span>;
        },
      }),
      columnHelper.accessor('createdAt', {
        header: '등록일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
      columnHelper.display({
        id: 'actions',
        header: '관리',
        cell: ({ row }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => actions.onDetail(row.original)}
            >
              상세
            </Button>
          </div>
        ),
      }),
    ],
    [actions]
  );
};
