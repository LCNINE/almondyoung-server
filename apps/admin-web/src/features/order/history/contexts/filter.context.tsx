// src/features/order/history/contexts/filter.context.tsx
'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { historyParams, historyStateFromParams } from '../utils/history-url';

export type QuickDateOption = 'today' | 'yesterday' | 'week' | 'month' | '3m' | 'custom';

/** 구분 필터 - 매칭 상태 기반 (완전출고·부분출고·출고불가는 라인 상태가 죽으며 없어졌다 — #1016 15번) */
export type OrderTypeFilter =
    | 'pending'     // 주문 미확정 (기본값)
    | 'all'         // 전체
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
    /** 화면이 떠 있는 채로 주소가 바뀌어 조건을 다시 정할 때마다 오른다 — 입력칸이 그때만 조건을 따라간다. */
    urlVersion: number;
    /** 지금 쪽(0부터). 검색하면 첫 쪽으로 돌아간다. */
    page: number;
    setPage: (page: number | ((prev: number) => number)) => void;
};

const FilterCtx = createContext<Ctx | null>(null);

export const useOrderHistoryFilter = () => {
    const ctx = useContext(FilterCtx);
    if (!ctx) throw new Error('useOrderHistoryFilter must be used within FilterProvider');
    return ctx;
};

export const OrderHistoryFilterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    // 검색 조건과 쪽은 주소에서 시작한다 — 새로고침·뒤로가기·링크 공유에 같은 목록이 나오게
    const readParams = () =>
        historyStateFromParams(
            searchParams,
            dayjs().format('YYYY-MM-DD'),
            process.env.NEXT_PUBLIC_APP_STAGE === 'demo',
        );
    const [initial] = useState(readParams);

    const [filter, setFilterState] = useState<OrderHistoryFilter>(initial.filter);
    const [page, setPage] = useState(initial.page);
    const [searchToken, setSearchToken] = useState(0);
    const setFilter = (p: Partial<OrderHistoryFilter>) =>
        setFilterState((prev) => ({ ...prev, ...p }));
    const triggerSearch = () => {
        setSearchToken((x) => x + 1);
        setPage(0);
    };

    const query = historyParams(filter, page).toString();

    // 화면이 떠 있는 채로 주소가 바뀌면(메뉴·다른 화면의 주문 지목 링크) 그 주소를 따른다.
    // 이 화면이 써서 아직 반영되지 않은 주소는 한 번만 건너뛴다 — 반영이 늦게 와도(그사이 쪽을 또 옮겨도)
    // 되돌리지 않고, 나중에 같은 주소로 들어오는 링크는 다시 따른다.
    const incoming = searchParams.toString();
    const pending = useRef<string[]>([]);
    const [seenQuery, setSeenQuery] = useState(incoming);
    const [urlVersion, setUrlVersion] = useState(0);
    if (seenQuery !== incoming) {
        setSeenQuery(incoming);
        // 앞선 쓰기는 버려졌을 수 있어 같은 주소 중 마지막 것까지 지운다
        const mine = pending.current.lastIndexOf(incoming);
        if (mine >= 0) {
            pending.current = pending.current.slice(mine + 1);
        } else if (incoming !== query) {
            const next = readParams();
            pending.current = [];
            setFilterState(next.filter);
            setPage(next.page);
            setSearchToken((x) => x + 1);
            setUrlVersion((x) => x + 1);
        }
    }

    useEffect(() => {
        if (window.location.search.slice(1) !== query) {
            pending.current = [...pending.current, query];
            router.replace(`${pathname}?${query}`, { scroll: false });
        }
    }, [query, pathname, router]);

    const value = useMemo(
        () => ({ filter, setFilter, searchToken, triggerSearch, urlVersion, page, setPage }),
        [filter, searchToken, urlVersion, page],
    );

    return <FilterCtx.Provider value={value}>{children}</FilterCtx.Provider>;
};
