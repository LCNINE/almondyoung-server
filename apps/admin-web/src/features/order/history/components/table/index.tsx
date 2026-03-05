// src/features/order/history/components/table/index.tsx
'use client';

import { useMemo, useState } from 'react';
import { useOrderHistoryFilter } from '../../contexts/filter.context';
import { useTableRowSelection } from '@/features/order/hooks/use-table-row-selection';
import { useConfirmSalesOrder } from '@/lib/services/orders';
import { useSalesOrderRows, useCreatePickingLists } from '../../hooks/use-order-rows';
import { useCreateOutboundBatch } from '@/lib/services/orders';
import dayjs from 'dayjs';
import { toast } from 'sonner';
import type { SalesOrderRow } from '../../hooks/use-order-rows';

import SplitOrderModal from '../modals/split-order-modal';
import { EditOrderModal } from '../modals/edit-order-modal';
import { SplitQuantityModal } from '../modals/split-quantity-modal';
import { AddOrderItemModal } from '../modals/add-order-item-modal';

const safeLines = (r: SalesOrderRow) => (Array.isArray(r?.lines) ? r.lines : []);

function buildQueryFromFilter(filter: ReturnType<typeof useOrderHistoryFilter>['filter']) {
    const q: any = {
        status: filter.status === 'all' ? undefined : filter.status,
        channel: filter.channel || undefined,
        sellerId: filter.sellerId || undefined,
        keyword: filter.keyword || undefined,
        dateFrom: filter.dateFrom,
        dateTo: filter.dateTo,
        sort: '-createdAt',
    };
    return q;
}

export default function OrderTable() {
    const { filter, searchToken } = useOrderHistoryFilter();
    const queryObj = useMemo(
        () => ({ ...buildQueryFromFilter(filter), _t: searchToken }),
        [filter, searchToken]
    );

    const { data, isLoading, isFetching } = useSalesOrderRows(queryObj);

    const rows: SalesOrderRow[] = useMemo(() => {
        let items = data?.items ?? [];

        // 상태==all에서 확정/발송 제외 옵션
        if (filter.status === 'all' && !filter.includeConfirmedWhenAll) {
            items = items.filter((r) => r.status !== 'confirmed' && r.status !== 'shipped');
        }

        if (filter.type !== 'all') {
            items = items.filter((row) => {
                const lines = safeLines(row);
                switch (filter.type) {
                    case 'ready': return row.isFullyAllocated;
                    case 'partial': return lines.some((l) => l.isReadyToShip) && !row.isFullyAllocated;
                    case 'hold': return lines.every((l) => !l.isReadyToShip);
                    case 'unmatched': return lines.some((l) => !l.isMatched);
                    case 'direct': return lines.some((l) => l.isDirect);
                    default: return true;
                }
            });
        }

        return items;
    }, [data?.items, filter.status, filter.includeConfirmedWhenAll, filter.type]);

    const total = rows.length;

    const {
        selectedRows,
        isIndeterminate,
        isAllSelected,
        handleSelectAll,
        handleSelectRow,
        getSelectedRowsData,
        clearSelection
    } = useTableRowSelection<SalesOrderRow>({ rows, getRowId: (r) => r.id });

    const selectableForOutbound = (r: SalesOrderRow) => r.isFullyAllocated === true && r.status === 'confirmed';
    const selectedForOutbound = getSelectedRowsData(rows, (r) => r.id).filter(selectableForOutbound);

    const [showSplitModal, setShowSplitModal] = useState<null | SalesOrderRow>(null);
    const [showEditModal, setShowEditModal] = useState<null | SalesOrderRow>(null);
    const [showQuantityModal, setShowQuantityModal] = useState<null | SalesOrderRow>(null);
    const [showAddModal, setShowAddModal] = useState<null | SalesOrderRow>(null);

    const confirmMut = useConfirmSalesOrder();
    const createPickingLists = useCreatePickingLists();
    const createBatch = useCreateOutboundBatch();

    const handleSelectedOutbound = async () => {
        if (selectedForOutbound.length === 0) return;
        try {
            const orderIds = selectedForOutbound.map((r) => r.id);
            await createPickingLists.mutateAsync(orderIds);
            toast.success(`${selectedForOutbound.length}건의 주문이 피킹리스트로 생성되었습니다.`);
            clearSelection();
        } catch {
            toast.error('출고지시 처리 중 오류가 발생했습니다.');
        }
    };

    const handleBulkOutbound = async () => {
        const readyOrders = rows.filter((r) => selectableForOutbound(r));
        if (readyOrders.length === 0) {
            toast.info('출고 가능한 주문이 없습니다.');
            return;
        }
        try {
            const orderIds = readyOrders.map((r) => r.id);
            const batches = await createPickingLists.mutateAsync(orderIds);
            toast.success(`${readyOrders.length}건의 주문이 ${batches.length}개의 피킹리스트로 생성되었습니다.`);
        } catch {
            toast.error('일괄 출고지시 처리 중 오류가 발생했습니다.');
        }
    };

    const handleConfirmOrder = async (orderId: string) => {
        try {
            await confirmMut.mutateAsync(orderId);
            toast.success('주문이 확정되었습니다.');
        } catch {
            toast.error('주문 확정 중 오류가 발생했습니다.');
        }
    };

    const handleDirectShipInvoiceUpdate = async (orderId: string, invoiceNo: string) => {
        // TODO: API 연동
        console.log('Update direct ship invoice:', orderId, invoiceNo);
        toast.success('직배송 송장번호가 저장되었습니다.');
    };

    return (
        <>
            <div className="rounded-xl border bg-white">
                <div className="flex items-center justify-between p-3 border-b">
                    <div className="font-medium">
                        총 <b>{total}</b>건
                        {isFetching && <span className="text-xs text-gray-500 ml-2">(갱신 중)</span>}
                    </div>
                    <div className="flex gap-2">
                        <button
                            disabled={selectedForOutbound.length === 0}
                            className="px-3 h-9 rounded-md border disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
                            onClick={handleSelectedOutbound}
                        >
                            선택된 주문 출고지시 ({selectedForOutbound.length})
                        </button>
                        <button
                            className="px-3 h-9 rounded-md bg-black text-white hover:bg-gray-800 transition-colors"
                            onClick={handleBulkOutbound}
                        >
                            일괄 출고지시
                        </button>
                    </div>
                </div>

                <div className="overflow-auto">
                    <table className="min-w-[1200px] w-full text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="w-10 p-3 text-left">
                                    <input
                                        type="checkbox"
                                        checked={isAllSelected}
                                        ref={(el) => { if (el) el.indeterminate = isIndeterminate; }}
                                        onChange={(e) => handleSelectAll(e.target.checked)}
                                        className="w-4 h-4"
                                    />
                                </th>
                                <th className="p-3 text-left whitespace-nowrap">주문일자</th>
                                <th className="p-3 text-left whitespace-nowrap">주문번호 / 판매처</th>
                                <th className="p-3 text-left">상품/옵션</th>
                                <th className="p-3 text-center whitespace-nowrap">수량</th>
                                <th className="p-3 text-left">고객/수령자</th>
                                <th className="p-3 text-left whitespace-nowrap">상태/구분</th>
                                <th className="p-3 text-left">작업기록</th>
                                <th className="p-3 text-left">작업</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading && (
                                <tr>
                                    <td className="p-6 text-center text-gray-500" colSpan={9}>
                                        불러오는 중...
                                    </td>
                                </tr>
                            )}

                            {!isLoading && rows.length === 0 && (
                                <tr>
                                    <td className="p-6 text-center text-gray-500" colSpan={9}>
                                        조회된 주문이 없습니다.
                                    </td>
                                </tr>
                            )}

                            {rows.map((r) => {
                                const lines = safeLines(r);
                                const canOutbound = selectableForOutbound(r);
                                const hasDirectShip = lines.some((l) => l.isDirect);
                                const splitCount = lines.filter((l) => l.isDirect).length;

                                return (
                                    <tr key={r.id} className="border-t hover:bg-gray-50 transition-colors">
                                        <td className="p-3">
                                            <input
                                                type="checkbox"
                                                checked={selectedRows.has(r.id)}
                                                onChange={(e) => handleSelectRow(r.id, e.target.checked)}
                                                disabled={!canOutbound}
                                                title={!canOutbound ? '출고지시가 불가능한 주문입니다.' : '선택'}
                                                className="w-4 h-4"
                                            />
                                        </td>

                                        <td className="p-3 whitespace-nowrap">
                                            {dayjs(r.orderDate).format('YYYY-MM-DD HH:mm')}
                                        </td>

                                        <td className="p-3">
                                            <div className="font-medium">
                                                <button
                                                    className="text-blue-600 hover:underline"
                                                    onClick={() => window.open(`/cs?orderNo=${encodeURIComponent(r.orderNo)}`, '_blank')}
                                                >
                                                    {r.orderNo}
                                                </button>
                                            </div>
                                            <div className="text-xs text-gray-500">
                                                {r.sellerName ?? r.channel ?? '자사몰'}
                                            </div>
                                        </td>

                                        <td className="p-3">
                                            <ul className="space-y-2">
                                                {lines.map((l) => (
                                                    <li key={l.id} className="flex gap-2">
                                                        {l.imageUrl && (
                                                            <img src={l.imageUrl} alt="" className="w-10 h-10 rounded object-cover border" />
                                                        )}
                                                        <div className="flex-1">
                                                            <div className="font-medium">{l.productName}</div>
                                                            <div className="text-xs text-gray-500 space-x-2">
                                                                <span>{l.optionName ?? '단일상품'}</span>
                                                                {!l.isMatched && <span className="text-red-500 font-medium">미매칭</span>}
                                                                {l.isDirect && <span className="text-indigo-600 font-medium">직배송</span>}
                                                                {l.isReadyToShip && <span className="text-emerald-600 font-medium">출고가능</span>}
                                                            </div>
                                                        </div>
                                                    </li>
                                                ))}
                                            </ul>
                                        </td>

                                        <td className="p-3 text-center font-medium">
                                            {lines.reduce((sum, l) => sum + l.quantity, 0)}
                                        </td>

                                        <td className="p-3">
                                            <div className="font-medium">
                                                {r.receiverName}
                                                {splitCount > 0 && (
                                                    <span className="ml-1 text-xs text-red-500">(분리 {splitCount})</span>
                                                )}
                                            </div>
                                            <div className="text-xs text-gray-500">{r.phone}</div>
                                            <div className="text-xs text-gray-400 line-clamp-2 mt-1">{r.address}</div>
                                            {/* 고객명도 별도로 보고 싶다면: */}
                                            {/* <div className="text-xs text-gray-500 mt-1">
                        고객: {r.customerName}
                        {r.customerName && r.receiverName && r.customerName !== r.receiverName
                          ? ` / 수령자: ${r.receiverName}`
                          : ''}
                      </div> */}
                                        </td>

                                        <td className="p-3 whitespace-nowrap">
                                            <div>
                                                {r.status === 'created' && <span className="text-orange-600 font-medium">미확정</span>}
                                                {r.status === 'confirmed' && <span className="text-blue-600 font-medium">확정</span>}
                                                {r.status === 'canceled' && <span className="text-gray-500">취소</span>}
                                                {r.status === 'shipped' && <span className="text-green-600 font-medium">발송완료</span>}
                                            </div>
                                            {r.isFullyAllocated && (
                                                <div className="text-emerald-600 text-xs mt-1">완전출고</div>
                                            )}
                                        </td>

                                        <td className="p-3">
                                            <ul className="text-xs text-gray-600 space-y-1 max-w-[240px]">
                                                {(r.workLogs ?? []).slice(0, 3).map((log, idx) => (
                                                    <li key={idx} className="truncate">
                                                        [{dayjs(log.at).format('MM-DD HH:mm')}] {log.label}
                                                    </li>
                                                ))}
                                            </ul>
                                        </td>

                                        <td className="p-3">
                                            <div className="flex flex-col gap-2">
                                                <button
                                                    className="h-8 px-3 rounded border hover:bg-gray-50 text-xs"
                                                    onClick={() => setShowSplitModal(r)}
                                                >
                                                    배송 나누기
                                                </button>

                                                <button
                                                    className="h-8 px-3 rounded border hover:bg-gray-50 text-xs"
                                                    onClick={() => setShowEditModal(r)}
                                                >
                                                    입력확인
                                                </button>

                                                <button
                                                    className="h-8 px-3 rounded border hover:bg-gray-50 text-xs"
                                                    onClick={() => setShowQuantityModal(r)}
                                                >
                                                    수량 나누기
                                                </button>

                                                <button
                                                    className="h-8 px-3 rounded border hover:bg-gray-50 text-xs"
                                                    onClick={() => setShowAddModal(r)}
                                                >
                                                    주문추가
                                                </button>

                                                {r.status === 'created' && (
                                                    <button
                                                        className="h-8 px-3 rounded bg-blue-600 text-white hover:bg-blue-700 text-xs"
                                                        onClick={() => handleConfirmOrder(r.id)}
                                                        disabled={confirmMut.isPending}
                                                    >
                                                        주문 확정
                                                    </button>
                                                )}

                                                {hasDirectShip && (
                                                    <input
                                                        placeholder="직배송 송장번호"
                                                        defaultValue={r.directShipInvoiceNo ?? ''}
                                                        className="h-8 px-2 border rounded text-xs"
                                                        onBlur={(e) => {
                                                            if (e.target.value && e.target.value !== r.directShipInvoiceNo) {
                                                                handleDirectShipInvoiceUpdate(r.id, e.target.value);
                                                            }
                                                        }}
                                                    />
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {showSplitModal && (
                <SplitOrderModal order={showSplitModal} onClose={() => setShowSplitModal(null)} />
            )}
            {showEditModal && (
                <EditOrderModal order={showEditModal} onClose={() => setShowEditModal(null)} />
            )}
            {showQuantityModal && (
                <SplitQuantityModal order={showQuantityModal} onClose={() => setShowQuantityModal(null)} />
            )}
            {showAddModal && (
                <AddOrderItemModal order={showAddModal} onClose={() => setShowAddModal(null)} />
            )}
        </>
    );
}
