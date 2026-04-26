'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { DateCell } from '@/components/table/table-cells/common';
import { Button } from '@/components/ui/button';
import type { SkuResponseDto } from '@/lib/types/dto/inventory';

const columnHelper = createColumnHelper<SkuResponseDto>();

type RowActions = {
  onEdit: (row: SkuResponseDto) => void;
  onChangeGroup: (row: SkuResponseDto) => void;
  onDelete: (row: SkuResponseDto) => void;
};

const STOCK_TYPE_LABELS: Record<string, string> = {
  physical: '사입',
  infinite: '무제한',
  drop_shipped: '직배',
  consignment: '위탁',
};

export const useSkusTableColumns = (actions: RowActions) => {
  return useMemo(
    () => [
      columnHelper.accessor('code', {
        header: 'SKU 코드',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{getValue()}</span>
        ),
      }),
      columnHelper.accessor('name', { header: 'SKU명' }),
      columnHelper.accessor('skuGroup', {
        header: '그룹',
        cell: ({ getValue }) => {
          const group = getValue();
          return group ? (
            <span className="text-xs text-muted-foreground">{group.name}</span>
          ) : (
            <span className="text-xs text-muted-foreground/40">—</span>
          );
        },
      }),
      columnHelper.accessor('suppliers', {
        header: '공급사',
        cell: ({ getValue }) => {
          const suppliers = getValue();
          if (!suppliers?.length) return <span className="text-xs text-muted-foreground/40">—</span>;
          return (
            <span className="text-xs text-muted-foreground">
              {suppliers.map((s) => s.name).join(', ')}
            </span>
          );
        },
      }),
      columnHelper.accessor('barcodes', {
        header: '주 바코드',
        cell: ({ getValue }) => {
          const primary = getValue()?.find((b) => b.isPrimary);
          return primary ? (
            <span className="font-mono text-xs">{primary.barcode}</span>
          ) : (
            <span className="text-xs text-muted-foreground/40">—</span>
          );
        },
      }),
      columnHelper.accessor('stockType', {
        header: '재고유형',
        cell: ({ getValue }) => (
          <span className="text-xs">{STOCK_TYPE_LABELS[getValue()] ?? getValue()}</span>
        ),
      }),
      columnHelper.accessor('safetyStock', {
        header: '안전재고',
        cell: ({ getValue }) => (
          <span className="tabular-nums text-xs">{getValue().toLocaleString('ko-KR')}</span>
        ),
      }),
      columnHelper.accessor('updatedAt', {
        header: '수정일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
      columnHelper.display({
        id: 'actions',
        header: '액션',
        cell: ({ row }) => (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => actions.onEdit(row.original)}
            >
              편집
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => actions.onChangeGroup(row.original)}
            >
              그룹
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-destructive hover:text-destructive"
              onClick={() => actions.onDelete(row.original)}
            >
              삭제
            </Button>
          </div>
        ),
      }),
    ],
    [actions]
  );
};
