import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import dayjs from 'dayjs';
import { Checkbox } from '@/components/ui/checkbox';
import type { SalesOrderRow } from '@/features/order/history/hooks/use-order-rows';

export type OrderHistoryColumnHandlers = {
  onSplit: (row: SalesOrderRow) => void;
  onEdit: (row: SalesOrderRow) => void;
  onSplitQty: (row: SalesOrderRow) => void;
  onAddItem: (row: SalesOrderRow) => void;
  onConfirm: (id: string) => void;
  onDirectInvoiceBlur: (id: string, value: string, prevValue?: string) => void;
  isConfirmPending: boolean;
};

const columnHelper = createColumnHelper<SalesOrderRow>();

const safeLines = (r: SalesOrderRow) => (Array.isArray(r?.lines) ? r.lines : []);

export const useOrderHistoryTableColumns = (handlers: OrderHistoryColumnHandlers) => {
  const { onSplit, onEdit, onSplitQty, onAddItem, onConfirm, onDirectInvoiceBlur, isConfirmPending } = handlers;

  return useMemo(
    () => [
      columnHelper.display({
        id: 'select',
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && 'indeterminate')
            }
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
            aria-label="전체 선택"
            onClick={(e) => e.stopPropagation()}
          />
        ),
        cell: ({ row }) => {
          const canOutbound =
            row.original.isFullyAllocated === true && row.original.status === 'confirmed';
          return (
            <Checkbox
              checked={row.getIsSelected()}
              onCheckedChange={(v) => {
                if (canOutbound) row.toggleSelected(!!v);
              }}
              disabled={!canOutbound}
              aria-label="행 선택"
              title={!canOutbound ? '출고지시가 불가능한 주문입니다.' : '선택'}
              onClick={(e) => e.stopPropagation()}
            />
          );
        },
      }),

      columnHelper.accessor('orderDate', {
        header: '주문일자',
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap text-xs">
            {dayjs(getValue()).format('YYYY-MM-DD HH:mm')}
          </span>
        ),
      }),

      columnHelper.display({
        id: 'orderInfo',
        header: '주문번호 / 판매처',
        cell: ({ row }) => (
          <div>
            <button
              className="text-blue-600 hover:underline text-xs font-medium"
              onClick={(e) => {
                e.stopPropagation();
                window.open(`/cs?orderNo=${encodeURIComponent(row.original.orderNo)}`, '_blank');
              }}
            >
              {row.original.orderNo}
            </button>
            <div className="text-xs text-gray-500">
              {row.original.sellerName ?? row.original.channel ?? '자사몰'}
            </div>
          </div>
        ),
      }),

      columnHelper.display({
        id: 'products',
        header: '상품/옵션',
        cell: ({ row }) => {
          const lines = safeLines(row.original);
          return (
            <ul className="space-y-1.5">
              {lines.map((l) => (
                <li key={l.id} className="flex gap-2 items-start">
                  {l.imageUrl && (
                    <img
                      src={l.imageUrl}
                      alt=""
                      className="w-8 h-8 rounded object-cover border flex-shrink-0"
                    />
                  )}
                  <div>
                    <div className="text-xs font-medium">{l.productName}</div>
                    <div className="text-xs text-gray-500 flex gap-1 flex-wrap">
                      <span>{l.optionName ?? '단일상품'}</span>
                      {!l.isMatched && (
                        <span className="text-red-500 font-medium">미매칭</span>
                      )}
                      {l.isDirect && (
                        <span className="text-indigo-600 font-medium">직배송</span>
                      )}
                      {l.isReadyToShip && (
                        <span className="text-emerald-600 font-medium">출고가능</span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          );
        },
      }),

      columnHelper.display({
        id: 'qty',
        header: '수량',
        cell: ({ row }) => {
          const lines = safeLines(row.original);
          return (
            <span className="font-medium text-xs">
              {lines.reduce((sum, l) => sum + l.quantity, 0)}
            </span>
          );
        },
      }),

      columnHelper.display({
        id: 'customer',
        header: '고객/수령자',
        cell: ({ row }) => {
          const r = row.original;
          const lines = safeLines(r);
          const splitCount = lines.filter((l) => l.isDirect).length;
          return (
            <div>
              <div className="text-xs font-medium">
                {r.receiverName}
                {splitCount > 0 && (
                  <span className="ml-1 text-xs text-red-500">(분리 {splitCount})</span>
                )}
              </div>
              <div className="text-xs text-gray-500">{r.phone}</div>
              <div className="text-xs text-gray-400 max-w-[160px] truncate mt-0.5">
                {r.address}
              </div>
            </div>
          );
        },
      }),

      columnHelper.display({
        id: 'status',
        header: '상태/구분',
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="whitespace-nowrap">
              <div className="text-xs">
                {r.status === 'created' && (
                  <span className="text-orange-600 font-medium">미확정</span>
                )}
                {r.status === 'confirmed' && (
                  <span className="text-blue-600 font-medium">확정</span>
                )}
                {r.status === 'canceled' && (
                  <span className="text-gray-500">취소</span>
                )}
                {r.status === 'shipped' && (
                  <span className="text-green-600 font-medium">발송완료</span>
                )}
              </div>
              {r.isFullyAllocated && (
                <div className="text-emerald-600 text-xs mt-0.5">완전출고</div>
              )}
            </div>
          );
        },
      }),

      columnHelper.display({
        id: 'workLogs',
        header: '작업기록',
        cell: ({ row }) => {
          const logs = row.original.workLogs ?? [];
          return (
            <ul className="text-xs text-gray-600 space-y-0.5">
              {logs.slice(0, 3).map((log, idx) => (
                <li key={idx} className="truncate max-w-[200px]">
                  [{dayjs(log.at).format('MM-DD HH:mm')}] {log.label}
                </li>
              ))}
            </ul>
          );
        },
      }),

      columnHelper.display({
        id: 'actions',
        header: '작업',
        cell: ({ row }) => {
          const r = row.original;
          const lines = safeLines(r);
          const hasDirectShip = lines.some((l) => l.isDirect);
          return (
            <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
              <button
                className="h-7 px-2 rounded border hover:bg-gray-50 text-xs"
                onClick={() => onSplit(r)}
              >
                배송 나누기
              </button>
              <button
                className="h-7 px-2 rounded border hover:bg-gray-50 text-xs"
                onClick={() => onEdit(r)}
              >
                입력확인
              </button>
              <button
                className="h-7 px-2 rounded border hover:bg-gray-50 text-xs"
                onClick={() => onSplitQty(r)}
              >
                수량 나누기
              </button>
              <button
                className="h-7 px-2 rounded border hover:bg-gray-50 text-xs"
                onClick={() => onAddItem(r)}
              >
                주문추가
              </button>
              {r.status === 'created' && (
                <button
                  className="h-7 px-2 rounded bg-blue-600 text-white hover:bg-blue-700 text-xs disabled:opacity-50"
                  disabled={isConfirmPending}
                  onClick={() => onConfirm(r.id)}
                >
                  주문 확정
                </button>
              )}
              {hasDirectShip && (
                <input
                  placeholder="직배송 송장번호"
                  defaultValue={r.directShipInvoiceNo ?? ''}
                  className="h-7 px-2 border rounded text-xs"
                  onBlur={(e) => {
                    if (e.target.value && e.target.value !== r.directShipInvoiceNo) {
                      onDirectInvoiceBlur(r.id, e.target.value, r.directShipInvoiceNo);
                    }
                  }}
                />
              )}
            </div>
          );
        },
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onSplit, onEdit, onSplitQty, onAddItem, onConfirm, onDirectInvoiceBlur, isConfirmPending],
  );
};
