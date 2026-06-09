import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { FulfillmentOrderListItem } from '@/lib/types/dto/fulfillment';
import { IdCell, DateCell } from '@/components/table/table-cells/common';
import {
  FoStatusCell,
  FoPriorityCell,
  FoModeCell,
} from '@/components/table/table-cells/fulfillment';

const columnHelper = createColumnHelper<FulfillmentOrderListItem>();

export const useFulfillmentsTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor('id', {
        header: '주문번호',
        cell: ({ getValue }) => <IdCell value={getValue()} />,
      }),
      columnHelper.accessor('status', {
        header: '상태',
        cell: ({ getValue }) => <FoStatusCell value={getValue()} />,
      }),
      columnHelper.accessor('warehouseId', {
        header: '창고',
        cell: ({ getValue }) => <IdCell value={getValue()} />,
      }),
      columnHelper.accessor('fulfillmentMode', {
        header: '모드',
        cell: ({ getValue }) => <FoModeCell value={getValue()} />,
      }),
      columnHelper.accessor('priority', {
        header: '우선순위',
        cell: ({ getValue }) => <FoPriorityCell value={getValue()} />,
      }),
      columnHelper.accessor('totalItems', {
        header: '아이템수',
      }),
      columnHelper.accessor('createdAt', {
        header: '생성일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
    ],
    []
  );
};
