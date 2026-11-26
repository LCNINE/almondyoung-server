'use client';

import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useCan } from '@/hooks/use-permission';
import { sku3dWorkshopClient } from '@/lib/api/domains/inventory/sku-3d-workshop.client';
import { MobileTopBar } from '@/features/inventory/sku-field-capture/components/mobile-top-bar';
import { errorMessageOf } from '@/features/inventory/sku-field-capture/field-capture-model';
import { workshopKeys } from '@/features/inventory/sku-3d-workshop/workshop-model';
import { WorkshopView } from '@/features/inventory/sku-3d-workshop/workshop-view';

const CAPTURE_BASE = '/mobile/sku-field-capture';

export default function Sku3dWorkshopPage() {
  return (
    <Suspense fallback={null}>
      <WorkshopPage />
    </Suspense>
  );
}

function WorkshopPage() {
  const { skuId } = useParams<{ skuId: string }>();
  const back = useSearchParams().get('back');
  const backHref =
    back?.startsWith('/') && !back.startsWith('//')
      ? back
      : `${CAPTURE_BASE}/${skuId}`;
  const canOpen = useCan(['inventory.model_workshop.write']);
  const allowed = canOpen.status === 'ready' && canOpen.allowed;

  // 처음이면 서버가 작업실을 만들고, 있으면 그대로 연다 — 새로고침·연타해도 하나다
  const { data, error } = useQuery({
    queryKey: workshopKeys.detail(skuId),
    queryFn: async () =>
      sku3dWorkshopClient.detail((await sku3dWorkshopClient.open(skuId)).id),
    enabled: allowed,
    refetchInterval: (query) => (query.state.data?.activeJob ? 5_000 : 15_000),
  });

  return (
    <>
      <MobileTopBar title="3D 작업실" backHref={backHref} />
      {canOpen.status === 'ready' && !allowed && (
        <p className="p-4 text-sm text-gray-700">
          3D 작업실을 쓸 권한이 없어요. 관리자에게 3D 작업실 사용 권한을 요청해
          주세요
        </p>
      )}
      {error && (
        <p className="p-4 text-sm text-red-600">
          {errorMessageOf(error, '작업실을 열지 못했어요')}
        </p>
      )}
      {allowed && !data && !error && (
        <Loader2 className="mx-auto mt-10 h-6 w-6 animate-spin text-gray-400" />
      )}
      {data && <WorkshopView detail={data} skuId={skuId} />}
    </>
  );
}
