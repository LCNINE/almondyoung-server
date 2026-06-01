// src/features/order/history/components/table/index.tsx
'use client';

import { useCallback, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { toast } from 'sonner';
import { useOrderHistoryFilter } from '../../contexts/filter.context';
import type { SalesOrderBusinessTimelineItemDto, SalesOrdersQuery } from '@/lib/types/dto/orders';
import { useSalesOrderRows, useCreatePickingLists } from '../../hooks/use-order-rows';
import type { OrderLineRow } from '../../hooks/use-order-rows';
import { useSalesOrder } from '@/lib/services/orders';
import { MergedDataTable } from '@/components/common/merged-data-table';
import type { MergedTableColumn } from '@/components/common/merged-data-table';
import { Table } from '@/components/admin-ui-experimental/common/table/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import SplitOrderModal from '../modals/split-order-modal';
import { EditOrderModal } from '../modals/edit-order-modal';
import { SplitQuantityModal } from '../modals/split-quantity-modal';
import { AddOrderItemModal } from '../modals/add-order-item-modal';
import { MemoModal } from '../modals/memo-modal';
import { CancelOrderModal } from '../modals/cancel-order-modal';

const PAGE_SIZE = 50;

function buildQuery(filter: ReturnType<typeof useOrderHistoryFilter>['filter']): SalesOrdersQuery {
    return {
        channel: filter.channel as SalesOrdersQuery['channel'] | undefined,
        startDate: filter.dateFrom,
        endDate: filter.dateTo,
        limit: 200,
        offset: 0,
    };
}

/* ── 상태 배지 ────────────────────────────────────────────── */
function StatusBadge({ row }: { row: OrderLineRow }) {
    const { orderStatus, isMatched, lineStatus } = row;
    if (orderStatus === 'shipped' || orderStatus === 'delivered') return <span className="inline-flex rounded-full bg-green-100 text-green-700 text-[11px] font-medium px-2 py-0.5 whitespace-nowrap">출고완료</span>;
    if (lineStatus === 'stock_deducted') return <span className="inline-flex rounded-full bg-blue-100 text-blue-700 text-[11px] font-medium px-2 py-0.5 whitespace-nowrap">출고가능</span>;
    if (lineStatus === 'stock_unavailable') return <span className="inline-flex rounded-full bg-red-100 text-red-600 text-[11px] font-medium px-2 py-0.5 whitespace-nowrap">출고불가</span>;
    if (!isMatched) return <span className="inline-flex rounded-full bg-gray-100 text-gray-500 text-[11px] font-medium px-2 py-0.5 whitespace-nowrap">매칭 없음</span>;
    return <span className="inline-flex rounded-full bg-orange-100 text-orange-600 text-[11px] font-medium px-2 py-0.5 whitespace-nowrap">매칭 안됨</span>;
}

/* ── 판매처 배지 ───────────────────────────────────────────── */
function ChannelBadge({ channel }: { channel: string }) {
    if (channel === 'naver')
        return (
            <div className="flex flex-col gap-0.5">
                <span className="inline-flex rounded bg-green-500 text-white text-[10px] font-bold px-1.5 py-0.5">N 스마트스토어</span>
                <span className="text-[10px] text-gray-500">아몬드영</span>
            </div>
        );
    if (channel === 'coupang') return <span className="inline-flex rounded bg-yellow-400 text-black text-[10px] font-bold px-1.5 py-0.5">쿠팡</span>;
    if (channel === '3pl') return <span className="inline-flex rounded bg-gray-200 text-gray-700 text-[10px] font-medium px-1.5 py-0.5">3PL</span>;
    return (
        <div className="flex items-center justify-center border rounded px-2 py-1 bg-white min-w-[72px]">
            <span className="text-[9px] font-bold tracking-tight text-gray-800 text-center leading-tight">
                ALMOND
                <br />
                YOUNG
            </span>
        </div>
    );
}

function formatBusinessRef(ref: SalesOrderBusinessTimelineItemDto['linkedEntity']) {
    return ref.id ?? ref.externalRef ?? '-';
}

function BusinessTimelineModal({ order, open, onOpenChange }: { order: OrderLineRow | null; open: boolean; onOpenChange: (open: boolean) => void }) {
    const { data, isLoading } = useSalesOrder(open && order ? order.orderId : '');
    const timeline = data?.businessTimeline ?? [];

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>업무 연결</DialogTitle>
                    <p className="mt-1 text-xs text-muted-foreground">주문번호: {order?.orderNo ?? '-'}</p>
                </DialogHeader>

                <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
                    {isLoading ? (
                        <div className="rounded border p-4 text-sm text-muted-foreground">불러오는 중...</div>
                    ) : timeline.length === 0 ? (
                        <div className="rounded border p-4 text-sm text-muted-foreground">연결된 업무가 없습니다.</div>
                    ) : (
                        timeline.map((item) => (
                            <div key={item.id} className="rounded border p-3">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <Badge variant="secondary">{item.relationName}</Badge>
                                        <span className="text-sm font-medium">{item.linkedEntity.type}</span>
                                    </div>
                                    <span className="text-xs text-muted-foreground">{dayjs(item.occurredAt).format('YYYY-MM-DD HH:mm')}</span>
                                </div>
                                <div className="mt-2 break-all text-xs text-muted-foreground">{formatBusinessRef(item.linkedEntity)}</div>
                                {Object.keys(item.metadata ?? {}).length > 0 && <pre className="mt-2 max-h-28 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(item.metadata, null, 2)}</pre>}
                            </div>
                        ))
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

/* ─────────────────────────────────────────────────────────── */

export default function OrderTable() {
    const { filter, searchToken } = useOrderHistoryFilter();
    const queryObj = useMemo(() => ({ ...buildQuery(filter), _t: searchToken }), [filter, searchToken]);

    const { data, isLoading, isFetching } = useSalesOrderRows(queryObj);

    /* 클라이언트 사이드 필터 */
    const rows: OrderLineRow[] = useMemo(() => {
        let items = data?.items ?? [];

        if (filter.type !== 'all') {
            items = items.filter((r) => {
                switch (filter.type) {
                    case 'pending':
                        return r.orderStatus === 'pending';
                    case 'hold':
                        return r.isUnavailable;
                    case 'partial':
                        return r.isReadyToShip && !r.isOrderFullyAllocated;
                    case 'ready':
                        return r.isOrderFullyAllocated;
                    case 'unmatched':
                        return !r.isMatched;
                    case 'direct':
                        return r.isDirect;
                    default:
                        return true;
                }
            });
        } else {
            items = items.filter((r) => r.orderStatus !== 'cancelled' && r.orderStatus !== 'timeout');
        }

        if (filter.keyword) {
            const kw = filter.keyword.toLowerCase();
            items = items.filter((r) => {
                switch (filter.keywordType) {
                    case '주문번호':
                        return r.orderNo.toLowerCase().includes(kw);
                    case '수령자':
                        return (r.receiverName ?? '').toLowerCase().includes(kw);
                    case '연락처':
                        return (r.phone ?? '').includes(kw);
                    case '상품명':
                        return r.productName.toLowerCase().includes(kw);
                    default:
                        return r.orderNo.toLowerCase().includes(kw) || (r.receiverName ?? '').toLowerCase().includes(kw) || (r.customerName ?? '').toLowerCase().includes(kw) || (r.phone ?? '').includes(kw) || r.productName.toLowerCase().includes(kw);
                }
            });
        }

        return items;
    }, [data?.items, filter.type, filter.keyword, filter.keywordType]);

    /* 선택 상태 (groupKey = orderId 기준) */
    const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());

    const isOrderSelectable = (r: OrderLineRow) => r.isOrderFullyAllocated && r.orderStatus === 'confirmed';

    /* 모달 상태 */
    const [showSplitModal, setShowSplitModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showQuantityModal, setShowQuantityModal] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showMemoModal, setShowMemoModal] = useState(false);
    const [showTimelineModal, setShowTimelineModal] = useState(false);
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState<OrderLineRow | null>(null);

    /* 액션 */
    const createPickingLists = useCreatePickingLists();

    const handleSelectedOutbound = useCallback(async () => {
        if (!selectedOrderIds.size) return;

        // 3PL 주문 필터링 (피킹리스트 불필요)
        const orderIdsToProcess = [...selectedOrderIds].filter((orderId) => {
            const order = rows.find((r) => r.orderId === orderId);
            return order && order.channel !== '3pl';
        });

        const excludedCount = selectedOrderIds.size - orderIdsToProcess.length;

        if (orderIdsToProcess.length === 0) {
            toast.info('출고 가능한 주문이 없습니다. (3PL 주문은 제외됩니다)');
            return;
        }

        try {
            const batches = await createPickingLists.mutateAsync(orderIdsToProcess);
            const msg = excludedCount > 0 ? `${orderIdsToProcess.length}건 → ${batches.length}개 피킹리스트 생성 (3PL ${excludedCount}건 제외)` : `${orderIdsToProcess.length}건 → ${batches.length}개 피킹리스트 생성`;
            toast.success(msg);
            setSelectedOrderIds(new Set());
        } catch {
            toast.error('출고지시 처리 중 오류가 발생했습니다.');
        }
    }, [selectedOrderIds, rows, createPickingLists]);

    const handleBulkOutbound = useCallback(async () => {
        // 완전출고 가능하고 confirmed 상태인 주문만 (3PL 제외)
        const readyIds = [...new Set(rows.filter((r) => isOrderSelectable(r) && r.channel !== '3pl').map((r) => r.orderId))];

        if (!readyIds.length) {
            toast.info('출고 가능한 주문이 없습니다. (3PL 주문은 제외됩니다)');
            return;
        }

        try {
            const batches = await createPickingLists.mutateAsync(readyIds);
            toast.success(`${readyIds.length}건 → ${batches.length}개 피킹리스트 생성 (각 최대 20개)`);
        } catch {
            toast.error('일괄 출고지시 처리 중 오류가 발생했습니다.');
        }
    }, [rows, createPickingLists]);

    /* 페이지네이션 */
    const [page, setPage] = useState(0); // 0-based index (DataTable 방식)
    const totalPages = useMemo(() => Math.ceil(rows.length / PAGE_SIZE), [rows.length]);
    const pageRows = useMemo(() => rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [rows, page]);

    /* 컬럼 정의 */
    const columns: MergedTableColumn<OrderLineRow>[] = useMemo(
        () => [
            {
                key: 'rowSeq',
                label: '#',
                width: '36px',
                merged: true,
                align: 'center',
                render: (_, r) => <span className="text-[10px] text-gray-400">{r.rowSeq}</span>,
            },
            {
                key: 'orderDate',
                label: '주문일자',
                merged: true,
                render: (_, r) => <span className="whitespace-nowrap">{dayjs(r.orderDate).format('YYYY-MM-DD')}</span>,
            },
            {
                key: 'channel',
                label: '판매처',
                merged: true,
                render: (_, r) => <ChannelBadge channel={r.channel} />,
            },
            {
                key: 'orderNo',
                label: '주문번호\n연락처',
                merged: true,
                render: (_, r) => (
                    <div>
                        <button className="text-blue-600 hover:underline font-medium block text-left" onClick={() => window.open(`/cs?orderNo=${encodeURIComponent(r.orderNo)}`, '_blank')}>
                            {r.orderNo}
                        </button>
                        {r.phone && <div className="text-blue-500 mt-0.5">{r.phone}</div>}
                    </div>
                ),
            },
            {
                key: 'productName',
                label: '상품',
                render: (_, r) => (
                    <div className="space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <StatusBadge row={r} />
                            <span className="font-medium">{r.productName}</span>
                        </div>
                        {r.optionName && <div className="text-gray-500">{r.optionName}</div>}
                    </div>
                ),
            },
            {
                key: 'imageUrl',
                label: '이미지',
                width: '52px',
                render: (_, r) => (r.imageUrl ? <img src={r.imageUrl} alt={r.productName} className="w-10 h-10 object-cover rounded border" /> : <div className="w-10 h-10 rounded border bg-gray-50" />),
            },
            {
                key: 'quantity',
                label: '수량',
                width: '48px',
                align: 'center',
                render: (val) => <span className="font-medium">{val as number}</span>,
            },
            {
                key: '_actions',
                label: '기능',
                width: '96px',
                render: (_, r) => (
                    <div className="flex flex-col gap-1">
                        <button
                            className="h-7 px-2 rounded border hover:bg-gray-50 whitespace-nowrap text-xs"
                            onClick={(e) => {
                                e.stopPropagation();
                                setSelectedOrder(r);
                                setShowEditModal(true);
                            }}
                        >
                            입력확인
                        </button>
                        <button
                            className="h-7 px-2 rounded border hover:bg-gray-50 whitespace-nowrap text-xs"
                            onClick={(e) => {
                                e.stopPropagation();
                                setSelectedOrder(r);
                                setShowAddModal(true);
                            }}
                        >
                            주문추가
                        </button>
                        <button
                            className="h-7 px-2 rounded border hover:bg-gray-50 whitespace-nowrap text-xs"
                            onClick={(e) => {
                                e.stopPropagation();
                                setSelectedOrder(r);
                                setShowQuantityModal(true);
                            }}
                        >
                            수량나누기
                        </button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={(e) => {
                                e.stopPropagation();
                                setSelectedOrder(r);
                                setShowTimelineModal(true);
                            }}
                        >
                            업무연결
                        </Button>
                        {r.orderStatus !== 'cancelled' && (
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-xs text-red-600 border-red-300 hover:bg-red-50"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedOrder(r);
                                    setShowCancelModal(true);
                                }}
                            >
                                취소
                            </Button>
                        )}
                    </div>
                ),
            },
            {
                key: 'totalPrice',
                label: '금액',
                align: 'right',
                render: (_, r) => {
                    const amount = r.totalPrice ?? r.unitPrice;
                    return amount != null ? <span className="whitespace-nowrap">{amount.toLocaleString()}원</span> : '-';
                },
            },
            {
                key: 'customerName',
                label: '주문자/수령자',
                merged: true,
                render: (_, r) => (
                    <div>
                        {(r.customerName || r.receiverName) && (
                            <div className="font-medium">
                                {r.customerName ?? '-'} / {r.receiverName ?? '-'}
                            </div>
                        )}
                        {r.totalAmount != null && <div className="text-gray-500 mt-0.5">합계: {r.totalAmount.toLocaleString()}</div>}
                        {r.address && <div className="text-blue-500 mt-0.5 cursor-pointer hover:underline">배송추적</div>}
                    </div>
                ),
            },
            {
                key: 'shippingFee',
                label: '배송방법',
                render: (_, r) => (
                    <div className="flex flex-col gap-1">
                        <span className="text-gray-700">{r.shippingFee === 0 ? '선불' : `${(r.shippingFee ?? 0).toLocaleString()}원`}</span>
                        <button
                            className="h-6 px-2 rounded border border-red-400 text-red-500 hover:bg-red-50 text-[11px] w-fit"
                            onClick={(e) => {
                                e.stopPropagation();
                                setSelectedOrder(r);
                                setShowSplitModal(true);
                            }}
                        >
                            나누기
                        </button>
                    </div>
                ),
            },
            {
                key: 'lineStatus',
                label: 'C/S 상태',
                render: (_, r) =>
                    r.lineStatus === 'stock_unavailable' ? (
                        <span className="text-gray-500">입고 후 발송</span>
                    ) : (
                        <button
                            className="h-7 px-2 rounded border hover:bg-gray-50 whitespace-nowrap text-xs"
                            onClick={(e) => {
                                e.stopPropagation();
                                setSelectedOrder(r);
                                setShowMemoModal(true);
                            }}
                        >
                            메모추가
                        </button>
                    ),
            },
        ],
        []
    );

    return (
        <>
            <div className="rounded-xl border bg-white">
                {/* 헤더 액션 바 */}
                <div className="flex items-center justify-between p-3 border-b gap-2 flex-wrap">
                    <div className="flex items-center gap-4">
                        <div className="text-sm font-medium">
                            총 <b className="text-blue-600">{rows.length}</b>건
                        </div>
                        {isFetching && <span className="text-xs text-gray-400">(갱신 중)</span>}
                        {filter.type === 'pending' && <span className="text-xs text-amber-600 font-medium">미확정 주문만 표시 중</span>}
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        <button
                            className="px-3 h-9 rounded border text-sm hover:bg-gray-50"
                            onClick={() => {
                                /* TODO: 엑셀 다운로드 */
                            }}
                        >
                            엑셀 다운로드
                        </button>
                        <button disabled={!selectedOrderIds.size} className="px-3 h-9 rounded bg-orange-500 text-white text-sm disabled:opacity-50 hover:bg-orange-600" onClick={handleSelectedOutbound}>
                            선택된 주문 출고 지시 ({selectedOrderIds.size})
                        </button>
                        <button className="px-3 h-9 rounded bg-orange-400 text-white text-sm hover:bg-orange-500" onClick={handleBulkOutbound}>
                            일괄 출고 지시
                        </button>
                    </div>
                </div>

                {/* 테이블 */}
                <MergedDataTable<OrderLineRow> data={pageRows} columns={columns as MergedTableColumn<OrderLineRow>[]} rowKey="rowId" groupKey="orderId" selectable mergeCheckbox selectedRowKeys={selectedOrderIds} onSelectedRowKeysChange={setSelectedOrderIds} isRowSelectable={isOrderSelectable} selectedRowClassName="bg-orange-50" emptyMessage={'조회된 주문이 없습니다. "검색" 버튼을 눌러 조회하세요.'} className="p-0" loading={isLoading} isFetching={isFetching} getRowClassName={(r) => (r.orderStatus === 'cancelled' ? 'opacity-50' : '')} />

                {/* 페이지네이션 - DataTable과 동일한 방식 */}
                <Table.Pagination count={rows.length} pageSize={PAGE_SIZE} pageIndex={page} pageCount={totalPages} canPreviousPage={page > 0} canNextPage={page < totalPages - 1} previousPage={() => setPage((p) => Math.max(0, p - 1))} nextPage={() => setPage((p) => Math.min(totalPages - 1, p + 1))} goPage={(idx) => setPage(idx)} />
            </div>

            {selectedOrder && <SplitOrderModal order={selectedOrder} open={showSplitModal} onOpenChange={setShowSplitModal} />}
            {selectedOrder && <EditOrderModal order={selectedOrder} open={showEditModal} onOpenChange={setShowEditModal} />}
            {selectedOrder && <SplitQuantityModal order={selectedOrder} open={showQuantityModal} onOpenChange={setShowQuantityModal} />}
            {selectedOrder && <AddOrderItemModal order={selectedOrder} open={showAddModal} onOpenChange={setShowAddModal} />}
            {selectedOrder && <MemoModal order={selectedOrder} open={showMemoModal} onOpenChange={setShowMemoModal} />}
            <BusinessTimelineModal order={selectedOrder} open={showTimelineModal} onOpenChange={setShowTimelineModal} />
            <CancelOrderModal order={selectedOrder} open={showCancelModal} onOpenChange={setShowCancelModal} />
        </>
    );
}
