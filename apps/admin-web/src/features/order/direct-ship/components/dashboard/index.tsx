'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Package, Truck, CheckCircle, List } from 'lucide-react';
import { useDirectShipDashboard } from '@/lib/services/orders';

export function DirectShipDashboard() {
  const { data, isLoading } = useDirectShipDashboard();

  const kpis = data
    ? [
        { label: '대기 중', value: data.pendingOrders, icon: Package },
        { label: '발송 중', value: data.forwardedOrders, icon: Truck },
        { label: '완료', value: data.completedOrders, icon: CheckCircle },
        { label: '전체', value: data.totalOrders, icon: List },
      ]
    : [];

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="pt-6">
                  <div className="h-8 w-16 animate-pulse rounded bg-muted" />
                </CardContent>
              </Card>
            ))
          : kpis.map(({ label, value, icon: Icon }) => (
              <Card key={label}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {label}
                  </CardTitle>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{value}</p>
                </CardContent>
              </Card>
            ))}
      </div>

      {data?.recentActivity && data.recentActivity.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium">최근 활동</p>
          <div className="rounded border divide-y text-sm">
            {data.recentActivity.slice(0, 8).map((act, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2">
                <span className="font-medium">{act.companyName}</span>
                <span className="text-muted-foreground">
                  {act.action === 'created'
                    ? '생성'
                    : act.action === 'forwarded'
                      ? '발송'
                      : '완료'}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(act.timestamp).toLocaleString('ko-KR')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
