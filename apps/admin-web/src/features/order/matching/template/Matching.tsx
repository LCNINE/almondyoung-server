/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useMemo } from 'react';
import { useMatchingFilter } from '../contexts/filter.context';
import { useMatchingsWithOrders } from '@/lib/services/orders';
import { useActiveChannels } from '@/lib/services/products';
import { FilterBox } from '../components/filter-box';
import { MatchingTable } from '../components/table';

// PIM 채널 type → 주문메타의 salesChannel 코드 매핑
const TYPE_TO_ORDER_CH: Record<string, string> = {
  naver_smartstore: 'naver',
  coupang: 'coupang',
  medusa: 'medusa', // 자사몰
  other: '3pl',
};

function sameDay(d1: Date, d2: Date) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

export default function MatchingTemplate() {
  const { filters } = useMatchingFilter();
  const { data: channels } = useActiveChannels();

  // 서버에는 매칭 상태만 전달 (나머지는 로컬 필터)
  const { data: matchingsResponse, isLoading, error } = useMatchingsWithOrders({
    status: filters.excludeMatched ? 'pending' : undefined,
  });
  const matchings = matchingsResponse?.data || [];

  const filtered = useMemo(() => {
    const list = matchings || [];
    const kw = (filters.keyword || '').trim().toLowerCase();

    // sellerCategory 또는 seller(채널 id) → type 구해 salesChannel로 변환
    let wantedSalesChannel: string | undefined = undefined;
    if (filters.sellerCategory && filters.sellerCategory !== 'all') {
      wantedSalesChannel = TYPE_TO_ORDER_CH[filters.sellerCategory] ?? filters.sellerCategory;
    }
    if (filters.seller && filters.seller !== 'all') {
      const ch = channels?.find((c: any) => c.id === filters.seller);
      if (ch?.type) wantedSalesChannel = TYPE_TO_ORDER_CH[ch.type] ?? ch.type;
    }

    // 날짜 범위
    const start = filters.startDate ? new Date(filters.startDate) : undefined;
    const end = filters.endDate ? new Date(filters.endDate) : undefined;
    const today = new Date();

    return list.filter((m: any) => {
      const o = m.order;

      // 판매처 필터
      if (wantedSalesChannel && o?.salesChannel && o.salesChannel !== wantedSalesChannel) {
        return false;
      }

      // 날짜 필터
      if (filters.dateType === 'today') {
        if (!o?.orderDate) return false;
        if (!sameDay(new Date(o.orderDate), today)) return false;
      } else if (filters.dateType === 'custom') {
        if (start || end) {
          const od = o?.orderDate ? new Date(o.orderDate) : null;
          if (!od) return false;
          if (start && od < new Date(start.getFullYear(), start.getMonth(), start.getDate())) return false;
          if (end && od > new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999)) return false;
        }
      }
      // dateType === 'order' → 제한 없음

      // 키워드 필터
      if (kw) {
        if (filters.keywordType === 'sellerProductName') {
          if (!o?.productName?.toLowerCase().includes(kw)) return false;
        } else if (filters.keywordType === 'orderNumber') {
          if (!o?.channelOrderId?.toLowerCase().includes(kw)) return false;
        } else if (filters.keywordType === 'customerName') {
          if (!o?.recipient?.toLowerCase().includes(kw)) return false;
        }
      }

      // 취소/발송완료는 현재 메타가 없어 패스
      // (추후 order.status, shippedAt 등 내려오면 여기서 걸러주면 됨)
      if (filters.showCanceledOrders === false) {
        // no-op (정보 없음)
      }
      if (filters.excludeShipped) {
        // no-op (정보 없음)
      }

      return true;
    });
  }, [matchings, filters, channels]);

  const pendingCount = filtered.filter((m: any) => m.status === 'pending').length;

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
        error={error}
      />
    </div>
  );
}
