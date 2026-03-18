import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { PointsEventDto } from '@/lib/types/dto/wallet';
import { IdCell, DateCell } from '@/components/table/table-cells/common';
import { Badge } from '@/components/ui/badge';

const columnHelper = createColumnHelper<PointsEventDto>();

const eventTypeConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  EARN: { label: '적립', variant: 'default' },
  REDEEM: { label: '사용', variant: 'destructive' },
  EARN_CANCEL: { label: '적립취소', variant: 'secondary' },
  REDEEM_CANCEL: { label: '사용취소', variant: 'outline' },
};

export const usePointsEventTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor('id', {
        header: 'ID',
        cell: ({ getValue }) => <IdCell value={getValue()} />,
      }),
      columnHelper.accessor('eventType', {
        header: '유형',
        cell: ({ getValue }) => {
          const type = getValue();
          const config = eventTypeConfig[type];
          return <Badge variant={config?.variant ?? 'outline'}>{config?.label ?? type}</Badge>;
        },
      }),
      columnHelper.accessor('amount', {
        header: '금액',
        cell: ({ getValue }) => {
          const amount = getValue();
          const formatted = Math.abs(amount).toLocaleString('ko-KR');
          return (
            <span className={`font-mono font-medium ${amount > 0 ? 'text-green-600' : 'text-red-500'}`}>
              {amount >= 0 ? `+${formatted}` : `-${formatted}`}
            </span>
          );
        },
      }),
      columnHelper.accessor('reasonCode', {
        header: '사유',
        cell: ({ getValue }) => <span className="text-sm">{getValue() ?? '-'}</span>,
      }),
      columnHelper.accessor('createdAt', {
        header: '일시',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
    ],
    [],
  );
};
