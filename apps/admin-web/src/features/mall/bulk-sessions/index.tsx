'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import BulkSessionListTemplate from './session-list';
import FormExportListTemplate from './form-export-list';
import { parseBulkSessionsTab } from './lib/tab-param';

export default function BulkSessionsTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = parseBulkSessionsTab(searchParams.get('tab') ?? undefined);

  return (
    <Tabs
      value={tab}
      onValueChange={(next) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('tab', next);
        // 탭 전환은 히스토리를 쌓지 않는다 — 뒤로가기가 탭 토글이 되면 이 화면을
        // 벗어나기 어려워진다.
        router.replace(`/mall/bulk-sessions?${params.toString()}`);
      }}
    >
      <TabsList>
        <TabsTrigger value="forms">양식 생성</TabsTrigger>
        <TabsTrigger value="sessions">업로드 세션</TabsTrigger>
      </TabsList>
      <TabsContent value="forms">
        <FormExportListTemplate />
      </TabsContent>
      <TabsContent value="sessions">
        <BulkSessionListTemplate />
      </TabsContent>
    </Tabs>
  );
}
