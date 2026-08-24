'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { DateCell } from '@/components/table/table-cells/common';
import type { SupplierDto } from '@/lib/types/dto/inventory';
import { Button } from '@/components/ui/button';
import { useWarehouses } from '@/lib/services/inventory';

const columnHelper = createColumnHelper<SupplierDto>();

type RowActions = {
  onDetail: (row: SupplierDto) => void;
};

export const useSuppliersTableColumns = (actions: RowActions) => {
  // 공급사 행은 창고 id 만 들고 있어 이름을 붙이려면 창고 목록이 필요하다.
  const { data: warehouses } = useWarehouses();
  const warehouseNameById = useMemo(
    () => new Map((warehouses ?? []).map((w) => [w.id, w.name])),
    [warehouses],
  );

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
      columnHelper.accessor('defaultWarehouseId', {
        header: '입고 창고',
        cell: ({ getValue }) => {
          const id = getValue();
          // 미지정이면 그 공급처로는 발주가 400 이다. 19곳 중 어디가 비었는지
          // 목록에서 바로 보여야 사람이 채울 수 있다.
          if (!id) {
            return <span className="text-destructive text-xs">⚠ 미지정 — 발주 불가</span>;
          }
          return <span className="text-sm">{warehouseNameById.get(id) ?? id}</span>;
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
    // warehouseNameById 를 빼면 셀이 첫 렌더의 빈 map 을 잡은 채 굳어, 창고 목록이
    // 도착해도 이름이 영원히 안 뜬다.
    [actions, warehouseNameById]
  );
};
