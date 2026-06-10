import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import Link from 'next/link';
import { MoreHorizontal } from 'lucide-react';
import type { FulfillmentOrderListItem } from '@/lib/types/dto/fulfillment';
import { IdCell, DateCell } from '@/components/table/table-cells/common';
import {
  FoStatusCell,
  FoPriorityCell,
  FoModeCell,
} from '@/components/table/table-cells/fulfillment';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: ({ row }) => {
          const fo = row.original;
          const base = `/order/fulfillments/${fo.id}`;
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link href={base}>상세 보기</Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href={`${base}?tab=inventory`}>재고 액션</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={`${base}?tab=split`}>분할</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={`${base}?tab=shipment`}>배송</Link>
                  </DropdownMenuItem>
                  {fo.fulfillmentMode === 'drop_ship' && (
                    <DropdownMenuItem asChild>
                      <Link href={`${base}?tab=direct-ship`}>직배</Link>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      }),
    ],
    []
  );
};
