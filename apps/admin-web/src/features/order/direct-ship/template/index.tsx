'use client';

import { type ReactNode, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePermissionCheck } from '@/hooks/use-permission';
import {
  useDirectShipCancelNotices,
  usePreviewSupplierUpload,
  useSupplierQueue,
} from '@/lib/services/orders';
import { CancelNoticesPanel } from '../components/cancel-notices';
import { HandoffsPanel } from '../components/handoffs-panel';
import { PendingPanel } from '../components/pending-panel';
import { SupplierPicker } from '../components/supplier-picker';
import { UnfulfillablePanel } from '../components/unfulfillable-panel';
import { UploadPanel } from '../components/upload-panel';
import { resolveSupplierId } from '../lib/supplier-picker';

const TABS = ['pending', 'handoffs', 'upload', 'unfulfillable', 'cancel-notices'] as const;
type DirectShipTab = (typeof TABS)[number];

const isTab = (value: string | null): value is DirectShipTab =>
  value !== null && (TABS as readonly string[]).includes(value);

// 직배 운영(N12) — 입점사 고르기는 탭 위 한 줄이고 알릴 취소를 뺀 네 탭이 같이 쓴다.
// 알릴 취소는 요약(열린 상자가 있는 입점사만)이 아니라 자기 행으로 입점사를 고른다.
export default function DirectShipTemplate() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { canRun } = usePermissionCheck();
  const { data: summaries, isLoading: summariesLoading } = useSupplierQueue();
  const { data: notices } = useDirectShipCancelNotices();
  const noticeCount = notices?.length ?? 0;

  const tabParam = searchParams.get('tab');
  const tab: DirectShipTab = isTab(tabParam) ? tabParam : 'pending';
  const supplierId = resolveSupplierId(summaries, searchParams.get('supplier'));

  const setParam = useCallback(
    (key: 'tab' | 'supplier', value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(key, value);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname]
  );

  // 입점사가 바뀌면 패널 상태(넘김 결과·올리기 미리보기)를 버린다 — 다른 입점사의 토큰으로 적용하지 않게
  const supplierPanel = (render: (id: string) => ReactNode) =>
    supplierId ? <div key={supplierId}>{render(supplierId)}</div> : null;

  return (
    <Container>
      <Header title="직배 운영" />
      {!summariesLoading && tab !== 'cancel-notices' && (
        <SupplierPicker
          summaries={summaries ?? []}
          selectedId={supplierId}
          onSelect={(id) => setParam('supplier', id)}
        />
      )}
      <Tabs value={tab} onValueChange={(v) => setParam('tab', v)} className="w-full">
        <div className="px-4 pt-2">
          <TabsList>
            <TabsTrigger value="pending">대기</TabsTrigger>
            <TabsTrigger value="handoffs">넘긴 것</TabsTrigger>
            {canRun(usePreviewSupplierUpload) && <TabsTrigger value="upload">올리기</TabsTrigger>}
            <TabsTrigger value="unfulfillable">못 보냄</TabsTrigger>
            <TabsTrigger value="cancel-notices">
              알릴 취소{noticeCount > 0 ? ` ${noticeCount}` : ''}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="pending">{supplierPanel((id) => <PendingPanel supplierId={id} />)}</TabsContent>
        <TabsContent value="handoffs">{supplierPanel((id) => <HandoffsPanel supplierId={id} />)}</TabsContent>
        <TabsContent value="upload">{supplierPanel((id) => <UploadPanel supplierId={id} />)}</TabsContent>
        <TabsContent value="unfulfillable">
          {supplierPanel((id) => <UnfulfillablePanel supplierId={id} />)}
        </TabsContent>
        <TabsContent value="cancel-notices">
          <CancelNoticesPanel />
        </TabsContent>
      </Tabs>
    </Container>
  );
}
