/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useMatchingFilter } from '../contexts/filter.context';
import { useOrderLines } from '@/lib/services/orders';
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

// keywordType 매핑 (filter context → server param)
const KEYWORD_TYPE_MAP: Record<string, 'productName' | 'orderNumber' | 'customerName'> = {
  sellerProductName: 'productName',
  orderNumber: 'orderNumber',
  customerName: 'customerName',
};

export default function MatchingTemplate() {
  const { appliedFilters } = useMatchingFilter();
  const [offset, setOffset] = useState(0);
  const limit = 50;

  // appliedFilters가 바뀌면 페이지 초기화
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
      limit,
      offset,
    };
  }, [appliedFilters, offset]);

  const { data: response, isLoading, error } = useOrderLines(serverQuery);

  const lines = response?.data ?? [];

  const pendingCount = lines.filter(
    (l) => !l.matchingStatus || l.matchingStatus === 'pending',
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">매칭체크</h1>
        <button className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-md">
          전부 새로 매칭하기
        </button>
      </div>

      <FilterBox />

      <div className="bg-gray-50 p-4 rounded-lg">
        <h2 className="text-lg font-semibold">
          매칭대기 {response ? pendingCount : '-'}건
        </h2>
      </div>

      <MatchingTable
        data={lines}
        isLoading={isLoading}
        error={error as Error | null}
      />

      {/* 페이지네이션 */}
      {response && response.total > limit && (
        <div className="flex justify-center gap-2">
          <button
            className="px-4 py-2 border rounded disabled:opacity-40"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - limit))}
          >
            이전
          </button>
          <span className="px-4 py-2 text-sm text-gray-600">
            {Math.floor(offset / limit) + 1} / {Math.ceil(response.total / limit)}
          </span>
          <button
            className="px-4 py-2 border rounded disabled:opacity-40"
            disabled={offset + limit >= response.total}
            onClick={() => setOffset(offset + limit)}
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}
