/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { useMatchingFilter } from '../contexts/filter.context';
import { FilterProvider } from '../contexts/filter.context';
import { useOrderLines } from '@/lib/services/matching';
import { FilterBox } from '../components/filter-box';
import { MatchingTable } from '../components/table';

const CATEGORY_TO_CHANNEL: Record<string, string> = {
  medusa: 'medusa',
  naver: 'naver',
  naver_smartstore: 'naver',
  coupang: 'coupang',
  '3pl': '3pl',
  phone_order: '3pl',
};

const KEYWORD_TYPE_MAP: Record<string, 'productName' | 'orderNumber' | 'customerName'> = {
  sellerProductName: 'productName',
  orderNumber: 'orderNumber',
  customerName: 'customerName',
};

const LIMIT = 50;

function MatchingContent() {
  const { appliedFilters } = useMatchingFilter();
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    setOffset(0);
  }, [appliedFilters]);

  const serverQuery = useMemo(() => {
    const salesChannel =
      appliedFilters.sellerCategory && appliedFilters.sellerCategory !== 'all'
        ? CATEGORY_TO_CHANNEL[appliedFilters.sellerCategory] ?? appliedFilters.sellerCategory
        : undefined;

    let startDate: string | undefined;
    let endDate: string | undefined;

    if (appliedFilters.dateType === 'today') {
      const today = new Date().toISOString().slice(0, 10);
      startDate = today;
      endDate = today;
    } else if (appliedFilters.dateType === 'custom') {
      startDate = appliedFilters.startDate;
      endDate = appliedFilters.endDate;
    }

    return {
      excludeMatched: appliedFilters.excludeMatched || undefined,
      salesChannel,
      startDate,
      endDate,
      keyword: appliedFilters.keyword || undefined,
      keywordType: appliedFilters.keyword
        ? KEYWORD_TYPE_MAP[appliedFilters.keywordType]
        : undefined,
      limit: LIMIT,
      offset,
    };
  }, [appliedFilters, offset]);

  const { data: response, isLoading, error } = useOrderLines(serverQuery);

  const lines = response?.data ?? [];
  const pendingCount = lines.filter(
    (l) => !l.matchingStatus || l.matchingStatus === 'pending',
  ).length;

  return (
    <div>
      <FilterBox />

      <div className="px-4 py-3">
        <p className="text-sm font-semibold text-muted-foreground">
          매칭대기 {response ? pendingCount : '-'}건
        </p>
      </div>

      <MatchingTable data={lines} isLoading={isLoading} error={error as Error | null} />

      {response && response.total > LIMIT && (
        <div className="flex items-center justify-center gap-2 p-4">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
          >
            이전
          </Button>
          <span className="text-sm text-muted-foreground">
            {Math.floor(offset / LIMIT) + 1} / {Math.ceil(response.total / LIMIT)}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={offset + LIMIT >= response.total}
            onClick={() => setOffset(offset + LIMIT)}
          >
            다음
          </Button>
        </div>
      )}
    </div>
  );
}

export default function MatchingTemplate() {
  return (
    <FilterProvider>
      <Container className="divide-y-0">
        <Header
          title="매칭체크"
          right={
            <Button variant="default" size="sm" className="bg-orange-500 hover:bg-orange-600">
              전부 새로 매칭하기
            </Button>
          }
        />
        <MatchingContent />
      </Container>
    </FilterProvider>
  );
}
