'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DirectShipDashboard } from '../components/dashboard';
import { DirectShipOrdersTable } from '../components/orders-table';

type Tab = 'dashboard' | 'orders';

export default function DirectShipTemplate() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = (searchParams.get('tab') as Tab) ?? (searchParams.get('foId') ? 'orders' : 'dashboard');

  const handleTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', value);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname]
  );

  return (
    <Container className="divide-y-0">
      <Header
        title="직배송 운영"
        subtitle="드롭십(직배송) 모드 풀필먼트 오더의 발송 및 완료 처리를 관리합니다."
      />
      <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
        <div className="px-4 pt-2">
          <TabsList>
            <TabsTrigger value="dashboard">대시보드</TabsTrigger>
            <TabsTrigger value="orders">주문 목록</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="dashboard">
          <DirectShipDashboard />
        </TabsContent>
        <TabsContent value="orders">
          <DirectShipOrdersTable />
        </TabsContent>
      </Tabs>
    </Container>
  );
}
