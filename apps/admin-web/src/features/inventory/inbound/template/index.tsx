'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PendingTab } from '../components/pending-tab';
import { PlanCreateTab } from '../components/plan-create-tab';
import { HistoryTab } from '../components/history-tab';

type InboundTab = 'pending' | 'create' | 'history';

export default function InboundTemplate() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const tab = (searchParams.get('tab') as InboundTab) ?? 'pending';

  const handleTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', value);
      params.delete('page');
      router.replace(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname]
  );

  return (
    <Container className="divide-y-0">
      <Header
        title="입고 관리"
        subtitle="입고 계획 등록, 입고 처리, 입고 이력을 관리합니다."
      />

      <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
        <div className="px-4 pt-2">
          <TabsList>
            <TabsTrigger value="pending">입고 대기</TabsTrigger>
            <TabsTrigger value="create">계획 등록</TabsTrigger>
            <TabsTrigger value="history">입고 이력</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="pending">
          <PendingTab />
        </TabsContent>
        <TabsContent value="create">
          <PlanCreateTab />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab />
        </TabsContent>
      </Tabs>
    </Container>
  );
}
