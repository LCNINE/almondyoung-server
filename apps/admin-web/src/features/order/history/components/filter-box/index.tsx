// src/features/order/history/components/filter-box/index.tsx
'use client';

import { useState } from 'react';
import dayjs from 'dayjs';
import { useOrderHistoryFilter } from '../../contexts/filter.context';
import type { QuickDateOption, KeywordType, OrderTypeFilter } from '../../contexts/filter.context';

const QUICK_DATE_OPTIONS: { key: QuickDateOption; label: string; fromDays: number; toDays: number }[] = [
    { key: 'today',     label: '오늘',     fromDays: 0,  toDays: 0 },
    { key: 'yesterday', label: '어제',     fromDays: 1,  toDays: 1 },
    { key: 'week',      label: '일주일',   fromDays: 6,  toDays: 0 },
    { key: 'month',     label: '한달',     fromDays: 29, toDays: 0 },
    { key: '3m',        label: '3개월',    fromDays: 89, toDays: 0 },
    { key: 'custom',    label: '임의기간', fromDays: 0,  toDays: 0 },
];

const CHANNEL_CATEGORIES = ['판매처 분류 전체', '자사몰', '외부채널'];
const CHANNELS: { label: string; value: string }[] = [
    { label: '판매처 전체', value: '' },
    { label: '자사몰 (Medusa)', value: 'medusa' },
    { label: '네이버 스마트스토어', value: 'naver' },
    { label: '쿠팡', value: 'coupang' },
    { label: '3PL', value: '3pl' },
];

const KEYWORD_TYPES: KeywordType[] = ['통합검색', '주문번호', '수령자', '연락처', '상품명'];

const TYPE_OPTIONS: { value: OrderTypeFilter; label: string }[] = [
    { value: 'pending',   label: '주문 미확정' },
    { value: 'ready',     label: '완전출고' },
    { value: 'partial',   label: '부분출고' },
    { value: 'hold',      label: '출고불가' },
    { value: 'unmatched', label: '매칭안됨' },
    { value: 'direct',    label: '직배송' },
    { value: 'all',       label: '전체' },
];

export default function FilterBox() {
    const { filter, setFilter, triggerSearch } = useOrderHistoryFilter();
    const [local, setLocal] = useState(filter);

    const applyQuickDate = (opt: (typeof QUICK_DATE_OPTIONS)[number]) => {
        if (opt.key === 'custom') {
            setLocal((prev) => ({ ...prev, quickDate: 'custom' }));
            return;
        }
        const to = dayjs().subtract(opt.toDays, 'day').format('YYYY-MM-DD');
        const from = dayjs().subtract(opt.fromDays, 'day').format('YYYY-MM-DD');
        setLocal((prev) => ({ ...prev, quickDate: opt.key, dateFrom: from, dateTo: to }));
    };

    const onSearch = () => {
        setFilter(local);
        triggerSearch();
    };

    return (
        <div className="rounded-xl border bg-white p-4 mb-4 space-y-3">
            {/* 판매처 */}
            <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-700 w-14 shrink-0">판매처</span>
                <select
                    className="border rounded h-9 px-2 text-sm min-w-[140px]"
                    value={local.channelCategory ?? ''}
                    onChange={(e) => setLocal({ ...local, channelCategory: e.target.value || undefined })}
                >
                    {CHANNEL_CATEGORIES.map((c) => (
                        <option key={c} value={c === '판매처 분류 전체' ? '' : c}>{c}</option>
                    ))}
                </select>
                <select
                    className="border rounded h-9 px-2 text-sm min-w-[160px]"
                    value={local.channel ?? ''}
                    onChange={(e) => setLocal({ ...local, channel: e.target.value || undefined })}
                >
                    {CHANNELS.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                </select>
            </div>

            {/* 일자 */}
            <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium text-gray-700 w-14 shrink-0">일자</span>
                <select className="border rounded h-9 px-2 text-sm min-w-[100px]">
                    <option>주문일자</option>
                </select>
                <div className="flex items-center gap-2 flex-wrap">
                    {QUICK_DATE_OPTIONS.map((opt) => (
                        <label key={opt.key} className="flex items-center gap-1 text-sm cursor-pointer">
                            <input
                                type="radio"
                                name="quickDate"
                                checked={local.quickDate === opt.key}
                                onChange={() => applyQuickDate(opt)}
                                className="accent-blue-600"
                            />
                            {opt.label}
                        </label>
                    ))}
                    <div className="flex items-center gap-1 ml-2">
                        <div className="relative flex items-center">
                            <input
                                type="date"
                                className="border rounded h-9 px-2 text-sm w-36"
                                value={local.dateFrom}
                                onChange={(e) => setLocal({ ...local, dateFrom: e.target.value, quickDate: 'custom' })}
                            />
                        </div>
                        <span className="text-gray-500">~</span>
                        <div className="relative flex items-center">
                            <input
                                type="date"
                                className="border rounded h-9 px-2 text-sm w-36"
                                value={local.dateTo}
                                onChange={(e) => setLocal({ ...local, dateTo: e.target.value, quickDate: 'custom' })}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* 키워드 */}
            <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-700 w-14 shrink-0">키워드</span>
                <select
                    className="border rounded h-9 px-2 text-sm min-w-[100px]"
                    value={local.keywordType}
                    onChange={(e) => setLocal({ ...local, keywordType: e.target.value as KeywordType })}
                >
                    {KEYWORD_TYPES.map((k) => (
                        <option key={k} value={k}>{k}</option>
                    ))}
                </select>
                <input
                    type="text"
                    className="border rounded h-9 px-3 text-sm flex-1 min-w-[200px]"
                    placeholder="검색어를 입력하세요"
                    value={local.keyword ?? ''}
                    onChange={(e) => setLocal({ ...local, keyword: e.target.value || undefined })}
                    onKeyDown={(e) => e.key === 'Enter' && onSearch()}
                />
            </div>

            {/* 구분 */}
            <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium text-gray-700 w-14 shrink-0">구분</span>
                <div className="flex items-center gap-4 flex-wrap">
                    {TYPE_OPTIONS.map((opt) => (
                        <label key={opt.value} className="flex items-center gap-1 text-sm cursor-pointer">
                            <input
                                type="radio"
                                name="type"
                                checked={local.type === opt.value}
                                onChange={() => setLocal({ ...local, type: opt.value })}
                                className="accent-blue-600"
                            />
                            {opt.label}
                        </label>
                    ))}
                </div>
                <label className="flex items-center gap-1 text-sm text-gray-700 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={local.excludeTerminal}
                        onChange={(e) => setLocal({ ...local, excludeTerminal: e.target.checked })}
                        className="accent-blue-600"
                    />
                    취소/타임아웃 제외
                </label>
                <label className="flex items-center gap-1 text-sm text-orange-700 font-medium cursor-pointer">
                    <input
                        type="checkbox"
                        checked={local.refundIssueOnly}
                        onChange={(e) => setLocal({ ...local, refundIssueOnly: e.target.checked, excludeTerminal: e.target.checked ? false : local.excludeTerminal })}
                        className="accent-orange-600"
                    />
                    환불 실패/수동처리만
                </label>
            </div>

            {/* 검색 버튼 */}
            <div className="flex justify-center pt-2">
                <button
                    onClick={onSearch}
                    className="h-11 px-12 rounded-md bg-orange-500 hover:bg-orange-600 text-white font-medium text-base transition-colors"
                >
                    검색
                </button>
            </div>
        </div>
    );
}
