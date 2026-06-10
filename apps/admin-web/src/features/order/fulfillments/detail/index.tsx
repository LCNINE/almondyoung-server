'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { useFulfillment } from '@/lib/services/orders';
import { FoStatusBadge } from '../components/fo-status-badge';
import { OverviewTab } from './overview-tab';
import { ItemsTab } from './items-tab';
import { InventoryTab } from './inventory-tab';
import { SplitTab } from './split-tab';
import { ShipmentTab } from './shipment-tab';
import { DirectShipTab } from './direct-ship-tab';
import { HistoryTab } from './history-tab';

type Tab = 'overview' | 'items' | 'inventory' | 'split' | 'shipment' | 'direct-ship' | 'history';

function FulfillmentDetailContent({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = (searchParams.get('tab') as Tab) ?? 'overview';

  const { data: fo, isLoading, isError } = useFulfillment(id);

  const handleTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', value);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname]
  );

  if (isLoading) {
    return <p className="py-12 text-center text-sm text-muted-foreground">로딩 중...</p>;
  }

  if (isError || !fo) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm font-medium">풀필먼트 오더를 찾을 수 없습니다.</p>
        <Button asChild variant="link" className="h-auto p-0">
          <Link href="/order/fulfillments">목록으로 돌아가기</Link>
        </Button>
      </div>
    );
  }

  const safeFo = {
    ...fo,
    items: fo.items ?? [],
    adminAvailableActions: fo.adminAvailableActions ?? [],
    blockedReasons: fo.blockedReasons ?? [],
    reservations: fo.reservations ?? [],
  };

  return (
    <Container className="divide-y-0">
      <div className="flex items-center gap-3 px-4 py-4">
        <FoStatusBadge status={safeFo.status} />
        <div>
          <p className="font-mono text-sm text-muted-foreground">{safeFo.id}</p>
          {safeFo.salesOrderId && (
            <p className="text-xs text-muted-foreground">판매주문: {safeFo.salesOrderId}</p>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
        <div className="px-4 pt-2">
          <TabsList>
            <TabsTrigger value="overview">개요</TabsTrigger>
            <TabsTrigger value="items">
              아이템/재고
              {safeFo.items.length > 0 && (
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs">
                  {safeFo.items.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="inventory">재고 액션</TabsTrigger>
            <TabsTrigger value="split">분할</TabsTrigger>
            <TabsTrigger value="shipment">배송</TabsTrigger>
            {safeFo.fulfillmentMode === 'drop_ship' && (
              <TabsTrigger value="direct-ship">직배</TabsTrigger>
            )}
            <TabsTrigger value="history">이력</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="px-4">
          <OverviewTab fo={safeFo} />
        </TabsContent>

        <TabsContent value="items" className="px-4">
          <ItemsTab fo={safeFo} />
        </TabsContent>

        <TabsContent value="inventory" className="px-4">
          <InventoryTab fo={safeFo} />
        </TabsContent>

        <TabsContent value="split" className="px-4">
          <SplitTab fo={safeFo} />
        </TabsContent>

        <TabsContent value="shipment" className="px-4">
          <ShipmentTab fo={safeFo} />
        </TabsContent>

        <TabsContent value="direct-ship" className="px-4">
          <DirectShipTab fo={safeFo} />
        </TabsContent>

        <TabsContent value="history" className="px-4">
          <HistoryTab fo={safeFo} />
        </TabsContent>
      </Tabs>
    </Container>
  );
}

export function FulfillmentDetail({ id }: { id: string }) {
  return (
    <div className="flex flex-col gap-3">
      <Link
        href="/order/fulfillments"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        FO 목록
      </Link>
      <Suspense fallback={<p className="py-12 text-center text-sm text-muted-foreground">로딩 중...</p>}>
        <FulfillmentDetailContent id={id} />
      </Suspense>
    </div>
  );
}
