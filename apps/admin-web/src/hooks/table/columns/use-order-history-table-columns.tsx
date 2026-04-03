// src/hooks/table/columns/use-order-history-table-columns.tsx
'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import dayjs from 'dayjs';
import { Checkbox } from '@/components/ui/checkbox';
import type { OrderLineRow } from '@/features/order/history/hooks/use-order-rows';

export type OrderHistoryColumnHandlers = {
    onEdit: (row: OrderLineRow) => void;
    onSplitQty: (row: OrderLineRow) => void;
    onAddItem: (row: OrderLineRow) => void;
    onSplit: (row: OrderLineRow) => void;
    onConfirm: (orderId: string) => void;
    isConfirmPending: boolean;
};

const columnHelper = createColumnHelper<OrderLineRow>();

/** 상태 배지 */
function StatusBadge({ row }: { row: OrderLineRow }) {
    const { orderStatus, isMatched, lineStatus } = row;

    if (orderStatus === 'shipped' || orderStatus === 'delivered') {
        return (
            <span className="inline-flex items-center rounded-full bg-green-100 text-green-700 text-[11px] font-medium px-2 py-0.5 whitespace-nowrap">
                출고완료
            </span>
        );
    }
    if (lineStatus === 'stock_deducted') {
        return (
            <span className="inline-flex items-center rounded-full bg-blue-100 text-blue-700 text-[11px] font-medium px-2 py-0.5 whitespace-nowrap">
                출고가능
            </span>
        );
    }
    if (lineStatus === 'stock_unavailable') {
        return (
            <span className="inline-flex items-center rounded-full bg-red-100 text-red-600 text-[11px] font-medium px-2 py-0.5 whitespace-nowrap">
                출고불가
            </span>
        );
    }
    if (!isMatched) {
        return (
            <span className="inline-flex items-center rounded-full bg-gray-100 text-gray-500 text-[11px] font-medium px-2 py-0.5 whitespace-nowrap">
                매칭 없음
            </span>
        );
    }
    // matched but not yet allocated
    return (
        <span className="inline-flex items-center rounded-full bg-orange-100 text-orange-600 text-[11px] font-medium px-2 py-0.5 whitespace-nowrap">
            매칭 안됨
        </span>
    );
}

/** 채널 로고/배지 */
function ChannelBadge({ channel }: { channel: string }) {
    if (channel === 'naver') {
        return (
            <div className="flex flex-col items-start gap-0.5">
                <span className="inline-flex items-center rounded bg-green-500 text-white text-[10px] font-bold px-1.5 py-0.5">N 스마트스토어</span>
                <span className="text-[10px] text-gray-500">아몬드영</span>
            </div>
        );
    }
    if (channel === 'coupang') {
        return (
            <span className="inline-flex items-center rounded bg-yellow-400 text-black text-[10px] font-bold px-1.5 py-0.5">쿠팡</span>
        );
    }
    if (channel === '3pl') {
        return (
            <span className="inline-flex items-center rounded bg-gray-200 text-gray-700 text-[10px] font-medium px-1.5 py-0.5">3PL</span>
        );
    }
    // medusa / default = ALMOND YOUNG 로고 텍스트
    return (
        <div className="flex items-center justify-center border rounded px-2 py-1 bg-white min-w-[80px]">
            <span className="text-[10px] font-bold tracking-tight text-gray-800 text-center leading-tight">ALMOND<br/>YOUNG</span>
        </div>
    );
}

export const useOrderHistoryTableColumns = (handlers: OrderHistoryColumnHandlers) => {
    const { onEdit, onSplitQty, onAddItem, onSplit, onConfirm, isConfirmPending } = handlers;

    return useMemo(
        () => [
            // 체크박스 + 순번
            columnHelper.display({
                id: 'select',
                size: 48,
                header: ({ table }) => (
                    <Checkbox
                        checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')}
                        onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
                        aria-label="전체 선택"
                        onClick={(e) => e.stopPropagation()}
                    />
                ),
                cell: ({ row }) => {
                    const canOutbound = row.original.isOrderFullyAllocated && row.original.orderStatus === 'confirmed';
                    return (
                        <div className="flex flex-col items-center gap-0.5">
                            <Checkbox
                                checked={row.getIsSelected()}
                                onCheckedChange={(v) => { if (canOutbound) row.toggleSelected(!!v); }}
                                disabled={!canOutbound}
                                aria-label="행 선택"
                                onClick={(e) => e.stopPropagation()}
                            />
                            <span className="text-[10px] text-gray-400">{row.original.rowSeq}</span>
                        </div>
                    );
                },
            }),

            // 주문일자
            columnHelper.accessor('orderDate', {
                header: '주문일자',
                size: 80,
                cell: ({ getValue }) => (
                    <span className="text-xs whitespace-nowrap">
                        {dayjs(getValue()).format('YYYY-MM-DD')}
                    </span>
                ),
            }),

            // 판매처
            columnHelper.accessor('channel', {
                header: '판매처',
                size: 90,
                cell: ({ getValue }) => <ChannelBadge channel={getValue()} />,
            }),

            // 주문번호 / 연락처
            columnHelper.display({
                id: 'orderInfo',
                header: '주문번호\n연락처',
                size: 130,
                cell: ({ row }) => {
                    const r = row.original;
                    return (
                        <div>
                            <button
                                className="text-blue-600 hover:underline text-xs font-medium block text-left"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    window.open(`/cs?orderNo=${encodeURIComponent(r.orderNo)}`, '_blank');
                                }}
                            >
                                {r.orderNo}
                            </button>
                            {r.phone && (
                                <div className="text-xs text-blue-500 mt-0.5">{r.phone}</div>
                            )}
                        </div>
                    );
                },
            }),

            // 상품
            columnHelper.display({
                id: 'product',
                header: '상품',
                cell: ({ row }) => {
                    const r = row.original;
                    return (
                        <div className="space-y-1 min-w-[180px]">
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <StatusBadge row={r} />
                                <span className="text-xs font-medium">{r.productName}</span>
                            </div>
                            {r.optionName && (
                                <div className="text-xs text-gray-500">{r.optionName}</div>
                            )}
                        </div>
                    );
                },
            }),

            // 이미지
            columnHelper.display({
                id: 'image',
                header: '이미지',
                size: 56,
                cell: ({ row }) => {
                    const { imageUrl, productName } = row.original;
                    return imageUrl ? (
                        <img src={imageUrl} alt={productName} className="w-10 h-10 object-cover rounded border" />
                    ) : (
                        <div className="w-10 h-10 rounded border bg-gray-50" />
                    );
                },
            }),

            // 수량
            columnHelper.accessor('quantity', {
                header: '수량',
                size: 48,
                cell: ({ getValue }) => (
                    <span className="text-xs font-medium">{getValue()}</span>
                ),
            }),

            // 기능
            columnHelper.display({
                id: 'actions',
                header: '기능',
                size: 80,
                cell: ({ row }) => {
                    const r = row.original;
                    return (
                        <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
                            <button
                                className="h-7 px-2 rounded border hover:bg-gray-50 text-xs whitespace-nowrap"
                                onClick={() => onEdit(r)}
                            >
                                입력확인
                            </button>
                            <button
                                className="h-7 px-2 rounded border hover:bg-gray-50 text-xs whitespace-nowrap"
                                onClick={() => onAddItem(r)}
                            >
                                주문추가
                            </button>
                            <button
                                className="h-7 px-2 rounded border hover:bg-gray-50 text-xs whitespace-nowrap"
                                onClick={() => onSplitQty(r)}
                            >
                                수량나누기
                            </button>
                            {r.orderStatus === 'pending' && (
                                <button
                                    className="h-7 px-2 rounded bg-blue-600 text-white hover:bg-blue-700 text-xs disabled:opacity-50 whitespace-nowrap"
                                    disabled={isConfirmPending}
                                    onClick={() => onConfirm(r.orderId)}
                                >
                                    주문확정
                                </button>
                            )}
                        </div>
                    );
                },
            }),

            // 금액
            columnHelper.display({
                id: 'amount',
                header: '금액',
                size: 80,
                cell: ({ row }) => {
                    const r = row.original;
                    const amount = r.totalPrice ?? r.unitPrice;
                    return (
                        <span className="text-xs whitespace-nowrap">
                            {amount != null ? `${amount.toLocaleString()}원` : '-'}
                        </span>
                    );
                },
            }),

            // 주문자/수령자
            columnHelper.display({
                id: 'receiver',
                header: '주문자/수령자',
                size: 150,
                cell: ({ row }) => {
                    const r = row.original;
                    const totalAmt = r.totalAmount;
                    return (
                        <div className="space-y-0.5">
                            {(r.customerName || r.receiverName) && (
                                <div className="text-xs font-medium">
                                    {r.customerName ?? '-'} / {r.receiverName ?? '-'}
                                </div>
                            )}
                            {totalAmt != null && (
                                <div className="text-xs text-gray-500">합계: {totalAmt.toLocaleString()}</div>
                            )}
                            {r.address && (
                                <div className="text-xs text-blue-500 hover:underline cursor-pointer truncate max-w-[140px]">
                                    배송추적
                                </div>
                            )}
                        </div>
                    );
                },
            }),

            // 배송방법
            columnHelper.display({
                id: 'shipping',
                header: '배송방법',
                size: 90,
                cell: ({ row }) => {
                    const r = row.original;
                    return (
                        <div className="flex flex-col gap-1 items-start" onClick={(e) => e.stopPropagation()}>
                            <span className="text-xs">
                                {r.shippingFee === 0 ? '선불' : `${(r.shippingFee ?? 0).toLocaleString()}원`}
                            </span>
                            <button
                                className="h-6 px-2 rounded border border-red-400 text-red-500 hover:bg-red-50 text-[11px]"
                                onClick={() => onSplit(r)}
                            >
                                나누기
                            </button>
                        </div>
                    );
                },
            }),

            // C/S 상태
            columnHelper.display({
                id: 'cs',
                header: 'C/S 상태',
                size: 80,
                cell: ({ row }) => {
                    const r = row.original;
                    if (r.lineStatus === 'stock_unavailable') {
                        return <span className="text-xs text-gray-500">입고 후 발송</span>;
                    }
                    return (
                        <button
                            className="h-7 px-2 rounded border hover:bg-gray-50 text-xs whitespace-nowrap"
                            onClick={(e) => { e.stopPropagation(); console.log('메모추가', r.orderId); }}
                        >
                            메모추가
                        </button>
                    );
                },
            }),
        ],
        [onEdit, onSplitQty, onAddItem, onSplit, onConfirm, isConfirmPending],
    );
};
