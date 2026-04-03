// src/features/order/history/components/table/index.tsx
'use client';

import { useCallback, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { toast } from 'sonner';
import { useOrderHistoryFilter } from '../../contexts/filter.context';
import type { SalesOrdersQuery } from '@/lib/types/dto/orders';
import { useConfirmSalesOrder } from '@/lib/services/orders';
import { useSalesOrderRows, useCreatePickingLists } from '../../hooks/use-order-rows';
import type { OrderLineRow } from '../../hooks/use-order-rows';
import { MergedDataTable } from '@/components/common/merged-data-table';
import type { MergedTableColumn } from '@/components/common/merged-data-table';

import SplitOrderModal from '../modals/split-order-modal';
import { EditOrderModal } from '../modals/edit-order-modal';
import { SplitQuantityModal } from '../modals/split-quantity-modal';
import { AddOrderItemModal } from '../modals/add-order-item-modal';

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
    if (orderStatus === 'shipped' || orderStatus === 'delivered')
        return <span className="inline-flex rounded-full bg-green-100 text-green-700 text-[11px] font-medium px-2 py-0.5 whitespace-nowrap">출고완료</span>;
    if (lineStatus === 'stock_deducted')
        return <span className="inline-flex rounded-full bg-blue-100 text-blue-700 text-[11px] font-medium px-2 py-0.5 whitespace-nowrap">출고가능</span>;
    if (lineStatus === 'stock_unavailable')
        return <span className="inline-flex rounded-full bg-red-100 text-red-600 text-[11px] font-medium px-2 py-0.5 whitespace-nowrap">출고불가</span>;
    if (!isMatched)
        return <span className="inline-flex rounded-full bg-gray-100 text-gray-500 text-[11px] font-medium px-2 py-0.5 whitespace-nowrap">매칭 없음</span>;
    return <span className="inline-flex rounded-full bg-orange-100 text-orange-600 text-[11px] font-medium px-2 py-0.5 whitespace-nowrap">매칭 안됨</span>;
}

/* ── 판매처 배지 ───────────────────────────────────────────── */
function ChannelBadge({ channel }: { channel: string }) {
    if (channel === 'naver') return (
        <div className="flex flex-col gap-0.5">
            <span className="inline-flex rounded bg-green-500 text-white text-[10px] font-bold px-1.5 py-0.5">N 스마트스토어</span>
            <span className="text-[10px] text-gray-500">아몬드영</span>
        </div>
    );
    if (channel === 'coupang') return <span className="inline-flex rounded bg-yellow-400 text-black text-[10px] font-bold px-1.5 py-0.5">쿠팡</span>;
    if (channel === '3pl') return <span className="inline-flex rounded bg-gray-200 text-gray-700 text-[10px] font-medium px-1.5 py-0.5">3PL</span>;
    return (
        <div className="flex items-center justify-center border rounded px-2 py-1 bg-white min-w-[72px]">
            <span className="text-[9px] font-bold tracking-tight text-gray-800 text-center leading-tight">ALMOND<br />YOUNG</span>
        </div>
    );
}

/* ─────────────────────────────────────────────────────────── */

export default function OrderTable() {
    const { filter, searchToken } = useOrderHistoryFilter();
    const queryObj = useMemo(
        () => ({ ...buildQuery(filter), _t: searchToken }),
        [filter, searchToken],
    );

    const { data, isLoading, isFetching } = useSalesOrderRows(queryObj);

    /* 클라이언트 사이드 필터 */
    const rows: OrderLineRow[] = useMemo(() => {
        let items = data?.items ?? [];

        if (filter.type !== 'all') {
            items = items.filter((r) => {
                switch (filter.type) {
                    case 'hold':      return r.isUnavailable;
                    case 'partial':   return r.isReadyToShip && !r.isOrderFullyAllocated;
                    case 'ready':     return r.isOrderFullyAllocated;
                    case 'unmatched': return !r.isMatched;
                    case 'direct':    return r.isDirect;
                    default:          return true;
                }
            });
        } else {
            items = items.filter((r) => r.orderStatus !== 'cancelled' && r.orderStatus !== 'timeout');
        }

        if (filter.keyword) {
            const kw = filter.keyword.toLowerCase();
            items = items.filter((r) => {
                switch (filter.keywordType) {
                    case '주문번호': return r.orderNo.toLowerCase().includes(kw);
                    case '수령자':   return (r.receiverName ?? '').toLowerCase().includes(kw);
                    case '연락처':   return (r.phone ?? '').includes(kw);
                    case '상품명':   return r.productName.toLowerCase().includes(kw);
                    default: return (
                        r.orderNo.toLowerCase().includes(kw) ||
                        (r.receiverName ?? '').toLowerCase().includes(kw) ||
                        (r.customerName ?? '').toLowerCase().includes(kw) ||
                        (r.phone ?? '').includes(kw) ||
                        r.productName.toLowerCase().includes(kw)
                    );
                }
            });
        }

        return items;
    }, [data?.items, filter.type, filter.keyword, filter.keywordType]);

    /* 선택 상태 (groupKey = orderId 기준) */
    const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());

    const isOrderSelectable = useCallback(
        (r: OrderLineRow) => r.isOrderFullyAllocated && r.orderStatus === 'confirmed',
        [],
    );

    /* 모달 상태 */
    const [showSplitModal, setShowSplitModal] = useState<null | OrderLineRow>(null);
    const [showEditModal, setShowEditModal] = useState<null | OrderLineRow>(null);
    const [showQuantityModal, setShowQuantityModal] = useState<null | OrderLineRow>(null);
    const [showAddModal, setShowAddModal] = useState<null | OrderLineRow>(null);

    /* 액션 */
    const confirmMut = useConfirmSalesOrder();
    const createPickingLists = useCreatePickingLists();

    const handleConfirm = useCallback(async (orderId: string) => {
        try {
            await confirmMut.mutateAsync(orderId);
            toast.success('주문이 확정되었습니다.');
        } catch {
            toast.error('주문 확정 중 오류가 발생했습니다.');
        }
    }, [confirmMut]);

    const handleSelectedOutbound = async () => {
        if (!selectedOrderIds.size) return;
        try {
            const batches = await createPickingLists.mutateAsync([...selectedOrderIds]);
            toast.success(`${selectedOrderIds.size}건 → ${batches.length}개 피킹리스트 생성`);
            setSelectedOrderIds(new Set());
        } catch {
            toast.error('출고지시 처리 중 오류가 발생했습니다.');
        }
    };

    const handleBulkOutbound = async () => {
        const readyIds = [...new Set(
            rows.filter(isOrderSelectable).map((r) => r.orderId),
        )];
        if (!readyIds.length) { toast.info('출고 가능한 주문이 없습니다.'); return; }
        try {
            const batches = await createPickingLists.mutateAsync(readyIds);
            toast.success(`${readyIds.length}건 → ${batches.length}개 피킹리스트 생성`);
        } catch {
            toast.error('일괄 출고지시 처리 중 오류가 발생했습니다.');
        }
    };

    /* 페이지네이션 */
    const [page, setPage] = useState(1);
    const totalPages = Math.ceil(rows.length / PAGE_SIZE);
    const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    /* 컬럼 정의 */
    const columns: MergedTableColumn<OrderLineRow>[] = useMemo(() => [
        {
            key: 'rowSeq',
            label: '#',
            width: '36px',
            merged: true,
            align: 'center',
            render: (_, r) => (
                <span className="text-[10px] text-gray-400">{r.rowSeq}</span>
            ),
        },
        {
            key: 'orderDate',
            label: '주문일자',
            merged: true,
            render: (_, r) => (
                <span className="whitespace-nowrap">
                    {dayjs(r.orderDate).format('YYYY-MM-DD')}
                </span>
            ),
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
                    <button
                        className="text-blue-600 hover:underline font-medium block text-left"
                        onClick={() => window.open(`/cs?orderNo=${encodeURIComponent(r.orderNo)}`, '_blank')}
                    >
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
            render: (_, r) =>
                r.imageUrl
                    ? <img src={r.imageUrl} alt={r.productName} className="w-10 h-10 object-cover rounded border" />
                    : <div className="w-10 h-10 rounded border bg-gray-50" />,
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
            width: '88px',
            render: (_, r) => (
                <div className="flex flex-col gap-1">
                    <button className="h-7 px-2 rounded border hover:bg-gray-50 whitespace-nowrap text-xs" onClick={() => setShowEditModal(r)}>입력확인</button>
                    <button className="h-7 px-2 rounded border hover:bg-gray-50 whitespace-nowrap text-xs" onClick={() => setShowAddModal(r)}>주문추가</button>
                    <button className="h-7 px-2 rounded border hover:bg-gray-50 whitespace-nowrap text-xs" onClick={() => setShowQuantityModal(r)}>수량나누기</button>
                    {r.orderStatus === 'pending' && (
                        <button
                            className="h-7 px-2 rounded bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap text-xs disabled:opacity-50"
                            disabled={confirmMut.isPending}
                            onClick={() => handleConfirm(r.orderId)}
                        >
                            주문확정
                        </button>
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
                return amount != null
                    ? <span className="whitespace-nowrap">{amount.toLocaleString()}원</span>
                    : '-';
            },
        },
        {
            key: 'customerName',
            label: '주문자/수령자',
            merged: true,
            render: (_, r) => (
                <div>
                    {(r.customerName || r.receiverName) && (
                        <div className="font-medium">{r.customerName ?? '-'} / {r.receiverName ?? '-'}</div>
                    )}
                    {r.totalAmount != null && (
                        <div className="text-gray-500 mt-0.5">합계: {r.totalAmount.toLocaleString()}</div>
                    )}
                    {r.address && (
                        <div className="text-blue-500 mt-0.5 cursor-pointer hover:underline">배송추적</div>
                    )}
                </div>
            ),
        },
        {
            key: 'shippingFee',
            label: '배송방법',
            render: (_, r) => (
                <div className="flex flex-col gap-1">
                    <span className="text-gray-700">
                        {r.shippingFee === 0 ? '선불' : `${(r.shippingFee ?? 0).toLocaleString()}원`}
                    </span>
                    <button
                        className="h-6 px-2 rounded border border-red-400 text-red-500 hover:bg-red-50 text-[11px] w-fit"
                        onClick={() => setShowSplitModal(r)}
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
                r.lineStatus === 'stock_unavailable'
                    ? <span className="text-gray-500">입고 후 발송</span>
                    : (
                        <button
                            className="h-7 px-2 rounded border hover:bg-gray-50 whitespace-nowrap text-xs"
                            onClick={() => console.log('메모추가', r.orderId)}
                        >
                            메모추가
                        </button>
                    ),
        },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [confirmMut.isPending, handleConfirm]);

    return (
        <>
            <div className="rounded-xl border bg-white">
                {/* 헤더 액션 바 */}
                <div className="flex items-center justify-between p-3 border-b gap-2 flex-wrap">
                    <div className="text-sm font-medium">
                        총 <b>{rows.length}</b>건
                        {isFetching && <span className="text-xs text-gray-400 ml-2">(갱신 중)</span>}
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        <button
                            className="px-3 h-9 rounded border text-sm hover:bg-gray-50"
                            onClick={() => { /* TODO: 엑셀 다운로드 */ }}
                        >
                            엑셀 다운로드
                        </button>
                        <button
                            disabled={!selectedOrderIds.size}
                            className="px-3 h-9 rounded bg-orange-500 text-white text-sm disabled:opacity-50 hover:bg-orange-600"
                            onClick={handleSelectedOutbound}
                        >
                            선택된 주문 출고 지시 ({selectedOrderIds.size})
                        </button>
                        <button
                            className="px-3 h-9 rounded bg-orange-400 text-white text-sm hover:bg-orange-500"
                            onClick={handleBulkOutbound}
                        >
                            일괄 출고 지시
                        </button>
                    </div>
                </div>

                {/* 테이블 */}
                {isLoading ? (
                    <div className="p-8 text-center text-gray-400">불러오는 중...</div>
                ) : (
                    <MergedDataTable<OrderLineRow>
                        data={pageRows}
                        columns={columns as MergedTableColumn<OrderLineRow>[]}
                        rowKey="rowId"
                        groupKey="orderId"
                        selectable
                        mergeCheckbox
                        selectedRowKeys={selectedOrderIds}
                        onSelectedRowKeysChange={setSelectedOrderIds}
                        isRowSelectable={isOrderSelectable}
                        selectedRowClassName="bg-orange-50"
                        emptyMessage={'조회된 주문이 없습니다. "검색" 버튼을 눌러 조회하세요.'}
                        className="p-0"
                        getRowClassName={(r) =>
                            r.orderStatus === 'cancelled' ? 'opacity-50' : ''
                        }
                    />
                )}

                {/* 페이지네이션 */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 p-3 border-t text-sm">
                        <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-2 py-1 rounded border disabled:opacity-40">◀</button>
                        <span>{page} / {totalPages}</span>
                        <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-2 py-1 rounded border disabled:opacity-40">▶</button>
                    </div>
                )}
            </div>

            {showSplitModal && <SplitOrderModal order={showSplitModal as any} onClose={() => setShowSplitModal(null)} />}
            {showEditModal && <EditOrderModal order={showEditModal as any} onClose={() => setShowEditModal(null)} />}
            {showQuantityModal && <SplitQuantityModal order={showQuantityModal as any} onClose={() => setShowQuantityModal(null)} />}
            {showAddModal && <AddOrderItemModal order={showAddModal as any} onClose={() => setShowAddModal(null)} />}
        </>
    );
}
