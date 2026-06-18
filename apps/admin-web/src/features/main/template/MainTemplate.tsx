'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { QuickActionsCard } from '@/features/main/quick-actions/QuickActionsCard';
import { useOrderStats, useSalesOrders, usePendingMatchings } from '@/lib/services/orders';
import { useQuestions } from '@/lib/services/qna';
import { useAllUserCount } from '@/lib/services/users';
import { usePendingBankTransfers } from '@/lib/services/wallet';
import type { SalesOrderStatus } from '@/lib/types/dto/orders';
import {
  Banknote,
  Boxes,
  CheckCircle,
  ChevronRight,
  Headphones,
  Package,
  ShoppingBag,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const STATUS_LABEL: Record<SalesOrderStatus, string> = {
  pending: '대기',
  confirmed: '확인',
  processing: '처리중',
  shipped: '배송중',
  delivered: '완료',
  cancelled: '취소',
  timeout: '타임아웃',
};

const STATUS_COLOR: Record<SalesOrderStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  confirmed: 'bg-blue-100 text-blue-700',
  processing: 'bg-blue-100 text-blue-700',
  shipped: 'bg-violet-100 text-violet-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
  timeout: 'bg-gray-100 text-gray-600',
};

export default function MainTemplate() {
  const router = useRouter();

  const { data: orderStats, isLoading: isOrderStatsLoading } = useOrderStats();
  const { data: pendingMatchings, isLoading: isMatchingsLoading } = usePendingMatchings({ limit: 1 });
  const { data: userCount, isLoading: isUserCountLoading } = useAllUserCount();
  const { data: qnaData, isLoading: isQnaLoading } = useQuestions({ limit: 1, status: 'active' });
  const { data: bankTransfers, isLoading: isBankTransfersLoading } = usePendingBankTransfers(1, 1);
  const { data: recentOrdersData, isLoading: isOrdersLoading } = useSalesOrders({ limit: 5 });

  const stats = [
    {
      label: '오늘 주문',
      value: orderStats?.todayCount,
      isLoading: isOrderStatsLoading,
      icon: ShoppingBag,
      iconBg: 'bg-blue-50',
      iconColor: 'text-blue-600',
      path: '/order/history',
    },
    {
      label: '매칭 대기',
      value: pendingMatchings?.total,
      isLoading: isMatchingsLoading,
      icon: Boxes,
      iconBg: 'bg-orange-50',
      iconColor: 'text-orange-600',
      path: '/order/matching',
      highlight: (v: number) => v > 0,
    },
    {
      label: '회원 수',
      value: userCount,
      isLoading: isUserCountLoading,
      icon: Users,
      iconBg: 'bg-green-50',
      iconColor: 'text-green-600',
      path: '/account/customer',
    },
    {
      label: '미답변 문의',
      value: qnaData?.total,
      isLoading: isQnaLoading,
      icon: Headphones,
      iconBg: 'bg-red-50',
      iconColor: 'text-red-500',
      path: '/cs/qna',
      highlight: (v: number) => v > 0,
    },
    {
      label: '무통장입금 대기',
      value: bankTransfers?.total,
      isLoading: isBankTransfersLoading,
      icon: Banknote,
      iconBg: 'bg-purple-50',
      iconColor: 'text-purple-600',
      path: '/payments/bank-transfers',
      highlight: (v: number) => v > 0,
    },
  ];

  const recentOrders = recentOrdersData?.data ?? [];

  return (
    <div className="space-y-6 px-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">대시보드</h1>
          <p className="text-gray-500 mt-1 text-sm">LCNINE 관리자 시스템</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-green-600 border border-green-200 bg-green-50 px-3 py-1.5 rounded-full">
          <CheckCircle className="w-4 h-4" />
          시스템 정상
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          const isHighlighted = stat.value != null && stat.highlight?.(stat.value);
          return (
            <Card
              key={stat.label}
              className="bg-white border border-gray-200 shadow-sm cursor-pointer hover:shadow-md hover:border-gray-300 transition-all"
              onClick={() => router.push(stat.path)}
            >
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                      {stat.label}
                    </p>
                    {stat.isLoading ? (
                      <Skeleton className="h-8 w-16 mt-1" />
                    ) : (
                      <p
                        className={`text-2xl font-bold mt-1 ${
                          isHighlighted ? 'text-red-600' : 'text-gray-900'
                        }`}
                      >
                        {stat.value ?? '-'}
                      </p>
                    )}
                  </div>
                  <div className={`p-3 rounded-full ${stat.iconBg}`}>
                    <Icon className={`w-5 h-5 ${stat.iconColor}`} />
                  </div>
                </div>
                <div className="flex items-center mt-3 text-xs text-gray-400">
                  <span>바로가기</span>
                  <ChevronRight className="w-3 h-3 ml-0.5" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-white border border-gray-200 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-gray-900 text-base">최근 주문</CardTitle>
                <CardDescription className="text-gray-500 text-xs mt-0.5">
                  최근 접수된 주문 현황
                </CardDescription>
              </div>
              <Link
                href="/order/history"
                className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"
              >
                전체보기 <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {isOrdersLoading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : recentOrders.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">주문이 없습니다</p>
            ) : (
              <div className="space-y-2">
                {recentOrders.map((order) => (
                  <div
                    key={order.id}
                    className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-1.5 bg-blue-50 rounded-md shrink-0">
                        <Package className="w-3.5 h-3.5 text-blue-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {order.channelOrderId}
                        </p>
                        <p className="text-xs text-gray-400 truncate">
                          {order.customerName ?? '-'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <p className="text-sm font-medium text-gray-900 tabular-nums">
                        {order.totalAmount != null
                          ? `₩${order.totalAmount.toLocaleString('ko-KR')}`
                          : '-'}
                      </p>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[order.status]}`}
                      >
                        {STATUS_LABEL[order.status]}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <QuickActionsCard />
      </div>
    </div>
  );
}
