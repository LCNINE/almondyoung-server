'use client';

import { type ReactNode, useCallback, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePermissionCheck } from '@/hooks/use-permission';
import { useSuppliers } from '@/lib/services/inventory/queries';
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
import { resolveTab, supplierPickerView } from '../lib/supplier-picker';

// 직배 운영(N12) — 입점사 고르기는 탭 위 한 줄이고 알릴 취소를 뺀 네 탭이 같이 쓴다.
// 칩은 열린 상자 요약 + 직배 입점사 목록이라 다 발송한 입점사도 남는다. 알릴 취소는 자기 행으로 입점사를 고른다.
export default function DirectShipTemplate() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { canRun } = usePermissionCheck();
  const { data: summaries, isLoading: summariesLoading } = useSupplierQueue();
  const { data: directSuppliers, isLoading: directSuppliersLoading } = useSuppliers({
    isDirectDelivery: true,
    limit: 100,
  });
  const { data: notices } = useDirectShipCancelNotices();
  const noticeCount = notices?.length ?? 0;

  const canUpload = canRun(usePreviewSupplierUpload);
  const tab = resolveTab(searchParams.get('tab'), canUpload);
  const picker = supplierPickerView({
    summaries,
    summariesReady: !summariesLoading,
    directSuppliers: directSuppliers?.data,
    requested: searchParams.get('supplier'),
  });
  const supplierId = picker.selectedId;

  const setParam = useCallback(
    (key: 'tab' | 'supplier', value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(key, value);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname]
  );

  // 기본 입점사를 URL 에 적는다 — 적용 뒤 요약이 바뀌어도 그 입점사·그 결과에 머물게
  useEffect(() => {
    if (picker.writeToUrl && supplierId) setParam('supplier', supplierId);
  }, [picker.writeToUrl, supplierId, setParam]);

  // 입점사가 바뀌면 패널 상태(넘김 결과·올리기 미리보기)를 버린다 — 다른 입점사의 토큰으로 적용하지 않게
  const supplierPanel = (render: (id: string) => ReactNode) =>
    supplierId ? <div key={supplierId}>{render(supplierId)}</div> : null;

  return (
    <Container>
      <Header title="직배 운영" />
      {!summariesLoading && !directSuppliersLoading && tab !== 'cancel-notices' && (
        <SupplierPicker
          chips={picker.chips}
          selectedId={supplierId}
          onSelect={(id) => setParam('supplier', id)}
        />
      )}
      <Tabs value={tab} onValueChange={(v) => setParam('tab', v)} className="w-full">
        <div className="px-4 pt-2">
          <TabsList>
            <TabsTrigger value="pending">대기</TabsTrigger>
            <TabsTrigger value="handoffs">넘긴 것</TabsTrigger>
            {canUpload && <TabsTrigger value="upload">올리기</TabsTrigger>}
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
