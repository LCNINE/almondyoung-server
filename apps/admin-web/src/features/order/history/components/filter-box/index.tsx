// src/features/order/history/components/filter-box/index.tsx
'use client';

import { useState } from 'react';
import { useOrderHistoryFilter } from '../../contexts/filter.context';
import dayjs from 'dayjs';

const quickRanges = [
    { key: 'today', label: '오늘', from: 0, to: 0 },
    { key: 'yesterday', label: '어제', from: 1, to: 1 },
    { key: 'week', label: '일주일', from: 6, to: 0 },
    { key: 'month', label: '한달', from: 29, to: 0 },
    { key: '3m', label: '3개월', from: 89, to: 0 },
];

export default function FilterBox() {
    const { filter, setFilter, triggerSearch } = useOrderHistoryFilter();
    const [local, setLocal] = useState(filter);

    const applyQuick = (r: (typeof quickRanges)[number]) => {
        const to = dayjs().subtract(r.to, 'day').format('YYYY-MM-DD');
        const from = dayjs().subtract(r.from, 'day').format('YYYY-MM-DD');
        const v = { ...local, dateFrom: from, dateTo: to };
        setLocal(v);
        setFilter(v);
    };

    const onSearch = () => {
        setFilter(local);
        triggerSearch();
    };

    return (
        <div className="rounded-xl border p-4 bg-white mb-4">
            {/* 상단: 숫자 카드(요약) 자리 - 필요 시 별도 구현 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="flex flex-col">
                    <label className="text-sm mb-1">판매 채널</label>
                    <select
                        className="border rounded-md h-9 px-2"
                        value={local.channel ?? ''}
                        onChange={(e) => setLocal({ ...local, channel: e.target.value || undefined })}
                    >
                        <option value="">전체</option>
                        <option value="medusa">자사몰</option>
                        <option value="naver" disabled>네이버 스마트스토어 (준비중)</option>
                        <option value="coupang" disabled>쿠팡 (준비중)</option>
                        <option value="3pl" disabled>3PL (준비중)</option>
                    </select>
                </div>

                <div className="flex flex-col">
                    <label className="text-sm mb-1">판매처</label>
                    <input
                        placeholder="판매처 ID/명"
                        className="border rounded-md h-9 px-2"
                        value={local.sellerId ?? ''}
                        onChange={(e) => setLocal({ ...local, sellerId: e.target.value || undefined })}
                    />
                </div>

                <div className="flex flex-col">
                    <label className="text-sm mb-1">일자</label>
                    <div className="flex items-center gap-2">
                        <input
                            type="date"
                            className="border rounded-md h-9 px-2 w-full"
                            value={local.dateFrom}
                            onChange={(e) => setLocal({ ...local, dateFrom: e.target.value })}
                        />
                        <span>~</span>
                        <input
                            type="date"
                            className="border rounded-md h-9 px-2 w-full"
                            value={local.dateTo}
                            onChange={(e) => setLocal({ ...local, dateTo: e.target.value })}
                        />
                    </div>
                    <div className="flex gap-1 mt-2 flex-wrap">
                        {quickRanges.map((r) => (
                            <button
                                key={r.key}
                                className="text-xs border rounded px-2 py-1 hover:bg-gray-50"
                                onClick={() => applyQuick(r)}
                            >
                                {r.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex flex-col">
                    <label className="text-sm mb-1">키워드</label>
                    <input
                        placeholder="주문번호/수령자/연락처/상품명"
                        className="border rounded-md h-9 px-2"
                        value={local.keyword ?? ''}
                        onChange={(e) => setLocal({ ...local, keyword: e.target.value || undefined })}
                    />
                </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                    <div className="text-sm font-medium mb-1">주문선택(상태)</div>
                    <div className="flex gap-3 flex-wrap">
                        {[
                            { v: 'pending', l: '주문 미확정(기본)' },
                            { v: 'confirmed', l: '주문 확정' },
                            { v: 'cancelled', l: '취소' },
                            { v: 'all', l: '전체' },
                        ].map((o) => (
                            <label key={o.v} className="flex items-center gap-1 text-sm">
                                <input
                                    type="radio"
                                    name="status"
                                    checked={local.status === (o.v as any)}
                                    onChange={() => setLocal({ ...local, status: o.v as any })}
                                />
                                {o.l}
                            </label>
                        ))}
                    </div>
                    {local.status === 'all' && (
                        <label className="mt-2 flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={local.includeConfirmedWhenAll ?? false}
                                onChange={(e) => setLocal({ ...local, includeConfirmedWhenAll: e.target.checked })}
                            />
                            전체선택 시 주문확정/발송완료 포함
                        </label>
                    )}
                </div>

                <div>
                    <div className="text-sm font-medium mb-1">구분</div>
                    <div className="flex gap-3 flex-wrap">
                        {[
                            { v: 'all', l: '전체' },
                            { v: 'hold', l: '출고불가' },
                            { v: 'partial', l: '부분출고' },
                            { v: 'ready', l: '완전출고' },
                            { v: 'unmatched', l: '미매칭' },
                            { v: 'direct', l: '직배송' },
                        ].map((o) => (
                            <label key={o.v} className="flex items-center gap-1 text-sm">
                                <input
                                    type="radio"
                                    name="type"
                                    checked={local.type === (o.v as any)}
                                    onChange={() => setLocal({ ...local, type: o.v as any })}
                                />
                                {o.l}
                            </label>
                        ))}
                    </div>
                </div>

                <div className="flex items-end justify-end">
                    <button
                        onClick={onSearch}
                        className="h-10 px-6 rounded-md bg-orange-500 text-white font-medium"
                    >
                        검색
                    </button>
                </div>
            </div>

            <p className="text-xs text-gray-500 mt-3">
                이 페이지는 “검색” 클릭 시 오늘 들어온 주문을 기본 조회하며, 최근 등록순(내림차순)으로 표시합니다.
                미매칭은 아직 재고확인이 불가한 상품이며, 다음 단계에서 매칭 처리할 수 있습니다.
            </p>
        </div>
    );
}
