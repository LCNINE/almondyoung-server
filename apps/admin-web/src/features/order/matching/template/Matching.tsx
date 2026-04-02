/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useMemo, useState } from 'react';
import { useMatchingFilter } from '../contexts/filter.context';
import { useOrderLines } from '@/lib/services/orders';
import { useActiveChannels } from '@/lib/services/products';
import { FilterBox } from '../components/filter-box';
import { MatchingTable } from '../components/table';
import type { MatchingStatus } from '@/lib/types/dto/orders';

export default function MatchingTemplate() {
  const { filters } = useMatchingFilter();
  const { data: channels } = useActiveChannels();
  const [offset, setOffset] = useState(0);
  const limit = 50;

  // 매칭 상태 필터 변환
  const matchingStatus = useMemo((): MatchingStatus | 'unregistered' | undefined => {
    if (filters.excludeMatched) return 'pending';
    return undefined;
  }, [filters.excludeMatched]);

  const { data: response, isLoading, error } = useOrderLines({
    matchingStatus,
    limit,
    offset,
  });

  const allLines = response?.data ?? [];

  // 클라이언트 사이드 필터 (채널, 날짜, 키워드)
  const filtered = useMemo(() => {
    const kw = (filters.keyword || '').trim().toLowerCase();

    let wantedChannel: string | undefined;
    if (filters.sellerCategory && filters.sellerCategory !== 'all') {
      wantedChannel = filters.sellerCategory;
    }
    if (filters.seller && filters.seller !== 'all') {
      const ch = (channels as any[])?.find((c: any) => c.id === filters.seller);
      if (ch?.type) wantedChannel = ch.type;
    }

    const start = filters.startDate ? new Date(filters.startDate) : undefined;
    const end = filters.endDate ? new Date(filters.endDate) : undefined;
    const today = new Date();

    return allLines.filter((line) => {
      // 판매처 필터
      if (wantedChannel && line.salesChannel !== wantedChannel) return false;

      // 날짜 필터
      if (filters.dateType === 'today') {
        const od = new Date(line.orderDate);
        if (
          od.getFullYear() !== today.getFullYear() ||
          od.getMonth() !== today.getMonth() ||
          od.getDate() !== today.getDate()
        ) return false;
      } else if (filters.dateType === 'custom' && (start || end)) {
        const od = new Date(line.orderDate);
        if (start && od < new Date(start.getFullYear(), start.getMonth(), start.getDate())) return false;
        if (end && od > new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59)) return false;
      }

      // 키워드 필터
      if (kw) {
        if (filters.keywordType === 'sellerProductName') {
          if (!line.productName?.toLowerCase().includes(kw)) return false;
        } else if (filters.keywordType === 'orderNumber') {
          if (!line.channelOrderId?.toLowerCase().includes(kw)) return false;
        } else if (filters.keywordType === 'customerName') {
          if (!line.customerName?.toLowerCase().includes(kw)) return false;
        }
      }

      return true;
    });
  }, [allLines, filters, channels]);

  const pendingCount = filtered.filter((l) => !l.matchingStatus || l.matchingStatus === 'pending').length;

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
        <h2 className="text-lg font-semibold">매칭대기 {pendingCount}건</h2>
      </div>

      <MatchingTable
        data={filtered}
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
