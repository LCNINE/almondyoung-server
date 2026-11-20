// src/features/order/matching/contexts/filter.context.tsx
// 매칭 필터 컨텍스트
'use client';

import React, { createContext, useContext, useRef, useState, ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { matchingDateFromParams, matchingDateQuery } from '../lib/matching-url';

export interface MatchingFilter {
  // 판매처 필터
  sellerCategory?: string; // WMS salesChannelEnum: medusa | naver | coupang | 3pl
  seller?: string;

  // 주문일자 필터
  dateType: 'today' | 'custom';
  startDate?: string;
  endDate?: string;

  // 키워드 필터
  keywordType: 'sellerProductName' | 'orderNumber' | 'customerName';
  keyword?: string;

  // 체크박스 옵션
  excludeMatched: boolean;
  showCanceledOrders: boolean;
  excludeShipped: boolean;
}

interface MatchingFilterContextType {
  filters: MatchingFilter;          // draft (UI state)
  appliedFilters: MatchingFilter;   // applied (actual query state)
  setFilters: (filters: Partial<MatchingFilter>) => void;
  applySearch: () => void;
  resetFilters: () => void;
}

const defaultFilters: MatchingFilter = {
  dateType: 'custom',
  keywordType: 'sellerProductName',
  excludeMatched: true,
  showCanceledOrders: false,
  excludeShipped: false,
};

const MatchingFilterContext = createContext<MatchingFilterContextType | undefined>(undefined);

export function FilterProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // 검색한 주문일자는 주소에서 시작한다 — 새로고침·뒤로가기·링크 공유에 같은 기간으로 열리게
  const [initial] = useState<MatchingFilter>(() => ({
    ...defaultFilters,
    ...matchingDateFromParams(searchParams),
  }));
  const [filters, setFiltersState] = useState<MatchingFilter>(initial);
  const [appliedFilters, setAppliedFilters] = useState<MatchingFilter>(initial);

  // 화면이 떠 있는 채로 주소가 바뀌면(메뉴·뒤로가기) 그 기간을 따른다. 이 화면이 쓴 주소는 한 번만 건너뛴다.
  const incoming = searchParams.toString();
  const written = useRef<string[]>([]);
  const [seenQuery, setSeenQuery] = useState(incoming);
  if (seenQuery !== incoming) {
    setSeenQuery(incoming);
    const mine = written.current.lastIndexOf(incoming);
    if (mine >= 0) {
      written.current = written.current.slice(mine + 1);
    } else if (incoming !== matchingDateQuery(appliedFilters)) {
      written.current = [];
      const date = matchingDateFromParams(searchParams);
      setFiltersState(prev => ({ ...prev, ...date }));
      setAppliedFilters(prev => ({ ...prev, ...date }));
    }
  }

  const writeDate = (next: MatchingFilter) => {
    const query = matchingDateQuery(next);
    if (window.location.search.slice(1) === query) return;
    written.current = [...written.current, query];
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const setFilters = (newFilters: Partial<MatchingFilter>) => {
    setFiltersState(prev => ({ ...prev, ...newFilters }));
  };

  const applySearch = () => {
    setAppliedFilters({ ...filters });
    writeDate(filters);
  };

  const resetFilters = () => {
    setFiltersState(defaultFilters);
    setAppliedFilters(defaultFilters);
    writeDate(defaultFilters);
  };

  return (
    <MatchingFilterContext.Provider value={{ filters, appliedFilters, setFilters, applySearch, resetFilters }}>
      {children}
    </MatchingFilterContext.Provider>
  );
}

export function useMatchingFilter() {
  const context = useContext(MatchingFilterContext);
  if (context === undefined) {
    throw new Error('useMatchingFilter must be used within a FilterProvider');
  }
  return context;
}
