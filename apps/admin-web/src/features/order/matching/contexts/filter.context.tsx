// src/features/order/matching/contexts/filter.context.tsx
// 매칭 필터 컨텍스트
'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';

export interface MatchingFilter {
  // 판매처 필터
  sellerCategory?: string;
  seller?: string;

  // 주문일자 필터
  dateType: 'order' | 'today' | 'custom';
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
  filters: MatchingFilter;
  setFilters: (filters: Partial<MatchingFilter>) => void;
  resetFilters: () => void;
}

const defaultFilters: MatchingFilter = {
  dateType: 'custom',
  keywordType: 'sellerProductName',
  excludeMatched: true, // 기본값: 매칭된 것 제외
  showCanceledOrders: false,
  excludeShipped: false,
};

const MatchingFilterContext = createContext<MatchingFilterContextType | undefined>(undefined);

export function FilterProvider({ children }: { children: ReactNode }) {
  const [filters, setFiltersState] = useState<MatchingFilter>(defaultFilters);

  const setFilters = (newFilters: Partial<MatchingFilter>) => {
    setFiltersState(prev => ({ ...prev, ...newFilters }));
  };

  const resetFilters = () => {
    setFiltersState(defaultFilters);
  };

  return (
    <MatchingFilterContext.Provider value={{ filters, setFilters, resetFilters }}>
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