'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { LocationDto } from '@/lib/types/dto/inventory';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const columnHelper = createColumnHelper<LocationDto>();

type RowActions = {
  onDetail: (row: LocationDto) => void;
};

export const useLocationsTableColumns = (actions: RowActions) => {
  return useMemo(
    () => [
      columnHelper.accessor('code', {
        header: '코드',
        cell: ({ getValue }) => <span className="font-mono text-sm">{getValue()}</span>,
      }),
      columnHelper.accessor('displayName', {
        header: '표시명',
        cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
      }),
      columnHelper.accessor('locationType', {
        header: '타입',
        cell: ({ getValue }) =>
          getValue() === 'standard' ? (
            <Badge variant="outline">표준</Badge>
          ) : (
            <Badge variant="secondary">구역</Badge>
          ),
      }),
      columnHelper.display({
        id: 'columnName',
        header: '열',
        cell: ({ row }) => {
          const loc = row.original;
          if (loc.locationType !== 'standard') return <span className="text-xs text-muted-foreground/40">—</span>;
          return <span className="text-sm">{loc.columnName ?? '—'}</span>;
        },
      }),
      columnHelper.display({
        id: 'rackNumber',
        header: '랙',
        cell: ({ row }) => {
          const loc = row.original;
          if (loc.locationType !== 'standard') return <span className="text-xs text-muted-foreground/40">—</span>;
          return <span className="text-sm">{loc.rackNumber !== undefined ? `R${loc.rackNumber}` : '—'}</span>;
        },
      }),
      columnHelper.display({
        id: 'binIdentifier',
        header: '빈',
        cell: ({ row }) => {
          const loc = row.original;
          if (loc.locationType !== 'standard') return <span className="text-xs text-muted-foreground/40">—</span>;
          return <span className="text-sm">{loc.binIdentifier ?? '—'}</span>;
        },
      }),
      columnHelper.accessor('capacityLimit', {
        header: '용량',
        cell: ({ getValue }) => {
          const v = getValue();
          return v !== null ? <span className="text-sm">{v}</span> : <span className="text-xs text-muted-foreground/40">—</span>;
        },
      }),
      columnHelper.accessor('isActive', {
        header: '상태',
        cell: ({ getValue }) =>
          getValue() ? (
            <Badge variant="default">활성</Badge>
          ) : (
            <Badge variant="destructive">비활성</Badge>
          ),
      }),
      columnHelper.display({
        id: 'actions',
        header: '관리',
        cell: ({ row }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Button variant="outline" size="sm" onClick={() => actions.onDetail(row.original)}>
              상세
            </Button>
          </div>
        ),
      }),
    ],
    [actions]
  );
};
