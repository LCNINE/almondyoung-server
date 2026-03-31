// src/features/order/history/components/table/index.tsx
'use client';

import { useCallback, useMemo, useState } from 'react';
import { useOrderHistoryFilter } from '../../contexts/filter.context';
import type { SalesOrdersQuery } from '@/lib/types/dto/orders';
import { useConfirmSalesOrder } from '@/lib/services/orders';
import { useSalesOrderRows, useCreatePickingLists } from '../../hooks/use-order-rows';
import { useDataTable } from '@/hooks/use-data-table';
import { DataTable } from '@/components/data-table';
import { useOrderHistoryTableColumns } from '@/hooks/table/columns/use-order-history-table-columns';
import { toast } from 'sonner';
import type { SalesOrderRow } from '../../hooks/use-order-rows';

import SplitOrderModal from '../modals/split-order-modal';
import { EditOrderModal } from '../modals/edit-order-modal';
import { SplitQuantityModal } from '../modals/split-quantity-modal';
import { AddOrderItemModal } from '../modals/add-order-item-modal';

const PAGE_SIZE = 50;

const safeLines = (r: SalesOrderRow) => (Array.isArray(r?.lines) ? r.lines : []);

function buildQueryFromFilter(filter: ReturnType<typeof useOrderHistoryFilter>['filter']): SalesOrdersQuery {
    return {
        status: filter.status === 'all' ? undefined : filter.status,
        channel: filter.channel as SalesOrdersQuery['channel'] | undefined,
        startDate: filter.dateFrom,
        endDate: filter.dateTo,
        limit: 100,
        offset: 0,
    };
}

export default function OrderTable() {
    const { filter, searchToken } = useOrderHistoryFilter();
    const queryObj = useMemo(
        () => ({ ...buildQueryFromFilter(filter), _t: searchToken }),
        [filter, searchToken],
    );

    const { data, isLoading, isFetching } = useSalesOrderRows(queryObj);

    const rows: SalesOrderRow[] = useMemo(() => {
        let items = data?.items ?? [];

        if (filter.status === 'all' && !filter.includeConfirmedWhenAll) {
            items = items.filter((r) => r.status !== 'confirmed' && r.status !== 'shipped' && r.status !== 'processing');
        }

        if (filter.type !== 'all') {
            items = items.filter((row) => {
                const lines = safeLines(row);
                switch (filter.type) {
                    case 'ready':
                        return row.isFullyAllocated;
                    case 'partial':
                        return lines.some((l) => l.isReadyToShip) && !row.isFullyAllocated;
                    case 'hold':
                        return lines.every((l) => !l.isReadyToShip);
                    case 'unmatched':
                        return lines.some((l) => !l.isMatched);
                    case 'direct':
                        return lines.some((l) => l.isDirect);
                    default:
                        return true;
                }
            });
        }

        return items;
    }, [data?.items, filter.status, filter.includeConfirmedWhenAll, filter.type]);

    const [showSplitModal, setShowSplitModal] = useState<null | SalesOrderRow>(null);
    const [showEditModal, setShowEditModal] = useState<null | SalesOrderRow>(null);
    const [showQuantityModal, setShowQuantityModal] = useState<null | SalesOrderRow>(null);
    const [showAddModal, setShowAddModal] = useState<null | SalesOrderRow>(null);

    const confirmMut = useConfirmSalesOrder();
    const createPickingLists = useCreatePickingLists();

    const handleConfirmOrder = useCallback(
        async (orderId: string) => {
            try {
                await confirmMut.mutateAsync(orderId);
                toast.success('주문이 확정되었습니다.');
            } catch {
                toast.error('주문 확정 중 오류가 발생했습니다.');
            }
        },
        [confirmMut],
    );

    const handleDirectInvoiceBlur = useCallback(
        async (orderId: string, invoiceNo: string) => {
            // TODO: API 연동
            console.log('Update direct ship invoice:', orderId, invoiceNo);
            toast.success('직배송 송장번호가 저장되었습니다.');
        },
        [],
    );

    const columns = useOrderHistoryTableColumns({
        onSplit: setShowSplitModal,
        onEdit: setShowEditModal,
        onSplitQty: setShowQuantityModal,
        onAddItem: setShowAddModal,
        onConfirm: handleConfirmOrder,
        onDirectInvoiceBlur: handleDirectInvoiceBlur,
        isConfirmPending: confirmMut.isPending,
    });

    const { table } = useDataTable({
        data: rows,
        columns,
        count: rows.length,
        pageSize: PAGE_SIZE,
        getRowId: (r) => r.id,
        enableRowSelection: true,
    });

    const selectableForOutbound = (r: SalesOrderRow) =>
        r.isFullyAllocated === true && r.status === 'confirmed';

    const selectedForOutbound = table
        .getSelectedRowModel()
        .rows.map((r) => r.original)
        .filter(selectableForOutbound);

    const handleSelectedOutbound = async () => {
        if (selectedForOutbound.length === 0) return;
        try {
            const orderIds = selectedForOutbound.map((r) => r.id);
            const batches = await createPickingLists.mutateAsync(orderIds);
            toast.success(
                `${selectedForOutbound.length}건의 주문이 ${batches.length}개의 피킹리스트로 생성되었습니다.`,
            );
            table.resetRowSelection();
        } catch {
            toast.error('출고지시 처리 중 오류가 발생했습니다.');
        }
    };

    const handleBulkOutbound = async () => {
        const readyOrders = rows.filter(selectableForOutbound);
        if (readyOrders.length === 0) {
            toast.info('출고 가능한 주문이 없습니다.');
            return;
        }
        try {
            const orderIds = readyOrders.map((r) => r.id);
            const batches = await createPickingLists.mutateAsync(orderIds);
            toast.success(
                `${readyOrders.length}건의 주문이 ${batches.length}개의 피킹리스트로 생성되었습니다.`,
            );
        } catch {
            toast.error('일괄 출고지시 처리 중 오류가 발생했습니다.');
        }
    };

    return (
        <>
            <div className="rounded-xl border bg-white">
                <div className="flex items-center justify-between p-3 border-b">
                    <div className="text-sm font-medium">
                        총 <b>{rows.length}</b>건
                        {isFetching && (
                            <span className="text-xs text-gray-500 ml-2">(갱신 중)</span>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <button
                            disabled={selectedForOutbound.length === 0}
                            className="px-3 h-9 rounded-md border text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
                            onClick={handleSelectedOutbound}
                        >
                            선택된 주문 출고지시 ({selectedForOutbound.length})
                        </button>
                        <button
                            className="px-3 h-9 rounded-md bg-black text-white text-sm hover:bg-gray-800 transition-colors"
                            onClick={handleBulkOutbound}
                        >
                            일괄 출고지시
                        </button>
                    </div>
                </div>

                <DataTable
                    table={table}
                    isLoading={isLoading}
                    isFetching={isFetching}
                    count={rows.length}
                    pageSize={PAGE_SIZE}
                    noRecords={{ message: '조회된 주문이 없습니다.' }}
                />
            </div>

            {showSplitModal && (
                <SplitOrderModal order={showSplitModal} onClose={() => setShowSplitModal(null)} />
            )}
            {showEditModal && (
                <EditOrderModal order={showEditModal} onClose={() => setShowEditModal(null)} />
            )}
            {showQuantityModal && (
                <SplitQuantityModal
                    order={showQuantityModal}
                    onClose={() => setShowQuantityModal(null)}
                />
            )}
            {showAddModal && (
                <AddOrderItemModal order={showAddModal} onClose={() => setShowAddModal(null)} />
            )}
        </>
    );
}
