'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { IndividualPickingTab } from '../components/individual-picking-tab';
import { BatchPickingTab } from '../components/batch-picking-tab';

type PickingTab = 'individual' | 'batch';

export default function PickingListTemplate() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const tab = (searchParams.get('tab') as PickingTab) ?? 'individual';

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
        title="피킹 관리"
        subtitle="주문처리 단위의 개별 피킹 및 배치 피킹을 진행합니다."
      />

      <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
        <div className="px-4 pt-2">
          <TabsList>
            <TabsTrigger value="individual">개별 피킹</TabsTrigger>
            <TabsTrigger value="batch">배치 피킹</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="individual">
          <IndividualPickingTab />
        </TabsContent>
        <TabsContent value="batch">
          <BatchPickingTab />
        </TabsContent>
      </Tabs>
    </Container>
  );
}
