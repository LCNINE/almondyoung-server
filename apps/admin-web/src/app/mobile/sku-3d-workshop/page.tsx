'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Box, ChevronRight, Loader2 } from 'lucide-react';
import { useCan } from '@/hooks/use-permission';
import { sku3dWorkshopClient } from '@/lib/api/domains/inventory/sku-3d-workshop.client';
import type { MyWorkshopDto, MyWorkshopStatus } from '@/lib/types/dto/inventory';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import { MobileTopBar } from '@/features/inventory/sku-field-capture/components/mobile-top-bar';
import { PhotoImg } from '@/features/inventory/sku-field-capture/components/photo-zoom-dialog';
import { errorMessageOf, kstShortTime } from '@/features/inventory/sku-field-capture/field-capture-model';
import {
  MY_WORKSHOP_STATUS_LABEL,
  MY_WORKSHOP_TABS,
  myWorkshopsOf,
  myWorkshopSummary,
  workshopKeys,
  type MyWorkshopTab,
} from '@/features/inventory/sku-3d-workshop/workshop-model';

const HERE = '/mobile/sku-3d-workshop';

const CHIP: Record<MyWorkshopStatus, string> = {
  making: 'bg-gray-900 text-white',
  review: 'bg-gray-200 text-gray-900',
  failed: 'bg-red-100 text-red-800',
  public: 'border border-gray-300 bg-gray-100 text-gray-700',
  waiting: 'border border-gray-300 bg-white text-gray-600',
};

export default function MyWorkshopsPage() {
  const [tab, setTab] = useState<MyWorkshopTab>('all');
  const canRead = useCan(['inventory.model_workshop.read']);
  const allowed = canRead.status === 'ready' && canRead.allowed;
  const { data, error, isLoading } = useQuery({
    queryKey: workshopKeys.mine,
    queryFn: () => sku3dWorkshopClient.mine(),
    enabled: allowed,
    // 만드는 중인 게 있으면 자주 다시 본다
    refetchInterval: (query) => (query.state.data?.some((w) => w.status === 'making') ? 10_000 : false),
    staleTime: 0,
  });
  const list = data ?? [];
  const rows = myWorkshopsOf(list, tab);
  const { review } = myWorkshopSummary(list);

  return (
    <>
      <MobileTopBar title="내 3D 작업실" backHref="/mobile/sku-field-capture" />
      <div className="space-y-3 p-4">
        {canRead.status === 'ready' && !allowed && (
          <p className="text-sm text-gray-700">3D 작업실을 볼 권한이 없어요. 관리자에게 3D 작업실 사용 권한을 요청해 주세요</p>
        )}
        {allowed && (
          <div className="grid grid-cols-4 gap-1 rounded-lg bg-gray-100 p-1">
            {MY_WORKSHOP_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={
                  t.id === tab
                    ? 'min-h-11 rounded-md bg-white text-sm font-semibold text-gray-900 shadow-sm'
                    : 'min-h-11 rounded-md text-sm text-gray-600'
                }
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        {data && (
          <p className="text-sm text-gray-600">
            작업실 {list.length}개{review > 0 && ` · 내가 확인할 것 ${review}개`}
          </p>
        )}
        {isLoading && allowed && <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" />}
        {error && <p className="text-sm text-red-600">{errorMessageOf(error, '작업실 목록을 불러오지 못했어요')}</p>}
        {data && rows.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-500">
            {list.length === 0 ? '작업 기록에서 상품의 3D 작업실을 열면 여기에 모여요' : '이 상태인 작업실이 없어요'}
          </p>
        )}
        <ul className="space-y-2">
          {rows.map((w) => (
            <li key={w.id}>
              <WorkshopRow workshop={w} />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function WorkshopRow({ workshop: w }: { workshop: MyWorkshopDto }) {
  const photo = resolvePublicFileUrl(w.photoFileId);

  return (
    <Link
      href={`${HERE}/${encodeURIComponent(w.skuId)}?back=${encodeURIComponent(HERE)}`}
      className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-2.5"
    >
      <div className="flex h-18 w-18 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-200">
        {photo ? <PhotoImg src={photo} /> : <Box className="h-7 w-7 text-gray-500" aria-hidden />}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${CHIP[w.status]}`}>
            {MY_WORKSHOP_STATUS_LABEL[w.status]}
          </span>
          {w.latestRevisionNumber !== null && <span className="text-xs text-gray-600">v{w.latestRevisionNumber}</span>}
          {w.activeJobKind === 'revise' && <span className="text-xs text-gray-600">수정 요청</span>}
        </div>
        <p className="truncate font-semibold text-gray-900">{w.skuName}</p>
        <p className="truncate text-xs text-gray-600">{w.skuCode}</p>
        <p className="truncate text-xs text-gray-500">
          {kstShortTime(w.updatedAt)}
          {w.failedError && ` · ${w.failedError}`}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
    </Link>
  );
}
