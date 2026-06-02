// src/features/order/history/contexts/filter.context.tsx
'use client';

import { createContext, useContext, useMemo, useState } from 'react';
import dayjs from 'dayjs';

export type QuickDateOption = 'today' | 'yesterday' | 'week' | 'month' | '3m' | 'custom';

/** 구분 필터 - 재고/매칭 상태 기반 */
export type OrderTypeFilter =
    | 'pending'     // 주문 미확정 (기본값)
    | 'all'         // 전체
    | 'hold'        // 출고불가
    | 'partial'     // 부분출고
    | 'ready'       // 완전출고
    | 'unmatched'   // 매칭안됨
    | 'direct';     // 직배송

export type KeywordType = '통합검색' | '주문번호' | '수령자' | '연락처' | '상품명';

export interface OrderHistoryFilter {
    type: OrderTypeFilter;
    excludeTerminal: boolean;
    refundIssueOnly: boolean;   // 환불 실패/수동처리 주문만 표시
    channelCategory?: string;   // 판매처 분류
    channel?: string;           // 판매처 (medusa/naver/coupang/3pl)
    quickDate: QuickDateOption;
    dateFrom: string;           // YYYY-MM-DD
    dateTo: string;             // YYYY-MM-DD
    keywordType: KeywordType;
    keyword?: string;
}

type Ctx = {
    filter: OrderHistoryFilter;
    setFilter: (p: Partial<OrderHistoryFilter>) => void;
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
        type: 'pending', // 주문 미확정이 기본값
        excludeTerminal: true,
        refundIssueOnly: false,
        quickDate: 'today',
        dateFrom: today,
        dateTo: today,
        keywordType: '통합검색',
    });

    const [searchToken, setSearchToken] = useState(0);
    const setFilter = (p: Partial<OrderHistoryFilter>) =>
        setFilterState((prev) => ({ ...prev, ...p }));
    const triggerSearch = () => setSearchToken((x) => x + 1);

    const value = useMemo(() => ({ filter, setFilter, searchToken, triggerSearch }), [filter, searchToken]);

    return <FilterCtx.Provider value={value}>{children}</FilterCtx.Provider>;
};
