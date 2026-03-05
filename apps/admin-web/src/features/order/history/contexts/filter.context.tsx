// src/features/order/history/contexts/filter.context.tsx
'use client';

import { createContext, useContext, useMemo, useState } from 'react';
import dayjs from 'dayjs';

export type OrderStatus =
    | 'created'          // 미확정(기본)
    | 'confirmed'        // 확정
    | 'canceled'         // 취소
    | 'all';

export type OrderTypeFilter =
    | 'all'
    | 'ready'            // 완전출고 가능
    | 'partial'          // 부분출고
    | 'hold'             // 출고불가
    | 'unmatched'        // 미매칭
    | 'direct';          // 직배송

export interface OrderHistoryFilter {
    status: OrderStatus;
    type: OrderTypeFilter;
    channel?: string;         // 판매 채널
    sellerId?: string;        // 판매처
    keyword?: string;         // 주문번호/수취인/연락처 통합검색
    dateFrom: string;         // YYYY-MM-DD
    dateTo: string;           // YYYY-MM-DD
    includeConfirmedWhenAll?: boolean; // 전체선택 시 확정/발송건 포함 여부
}

type Ctx = {
    filter: OrderHistoryFilter;
    setFilter: (p: Partial<OrderHistoryFilter>) => void;
    // 검색 트리거(“검색” 버튼 눌렀을 때만 쿼리 발사)
    searchToken: number;
    triggerSearch: () => void;
};

const FilterCtx = createContext<Ctx | null>(null);

export const useOrderHistoryFilter = () => {
    const ctx = useContext(FilterCtx);
    if (!ctx) throw new Error('useOrderHistoryFilter must be used within FilterProvider');
    return ctx;
};

export const OrderHistoryFilterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const today = dayjs().format('YYYY-MM-DD');

    const [filter, setFilterState] = useState<OrderHistoryFilter>({
        status: 'created',      // 기본: 주문 미확정
        type: 'all',
        dateFrom: today,
        dateTo: today,
        includeConfirmedWhenAll: false,
    });

    const [searchToken, setSearchToken] = useState(0);
    const setFilter = (p: Partial<OrderHistoryFilter>) =>
        setFilterState((prev) => ({ ...prev, ...p }));
    const triggerSearch = () => setSearchToken((x) => x + 1);

    const value = useMemo(() => ({ filter, setFilter, searchToken, triggerSearch }), [filter, searchToken]);

    return <FilterCtx.Provider value={value}>{children}</FilterCtx.Provider>;
};
