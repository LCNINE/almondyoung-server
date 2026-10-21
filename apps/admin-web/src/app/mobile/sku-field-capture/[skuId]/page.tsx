'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useCan } from '@/hooks/use-permission';
import { blockedReason } from '@/lib/auth/permission-check';
import { skuFieldCaptureClient } from '@/lib/api/domains/inventory/sku-field-capture.client';
import type { FieldCaptureBarcodeStatus, FieldCaptureDetailDto } from '@/lib/types/dto/inventory';
import { BarcodeScanInput } from '@/features/inventory/sku-field-capture/components/barcode-scan-input';
import { MobileTopBar } from '@/features/inventory/sku-field-capture/components/mobile-top-bar';
import { ReferencePhotoField } from '@/features/inventory/sku-field-capture/components/reference-photo-field';
import {
  barcodeConflictWarning,
  completedByText,
  draftFromDetail,
  draftStorageKey,
  errorMessageOf,
  isConflict,
  fieldCaptureKeys,
  MANUFACTURER_BARCODE_FORMATS,
  missingRequirements,
  restoreDraft,
  savedDraftJson,
  toCompleteRequest,
  type CaptureDraft,
} from '@/features/inventory/sku-field-capture/field-capture-model';

const BASE = '/mobile/sku-field-capture';

const NO_SCAN_OPTIONS: { value: FieldCaptureBarcodeStatus; label: string }[] = [
  { value: 'no_manufacturer', label: '제조사 바코드 없음 · 자체 스티커 있음' },
  { value: 'none', label: '바코드 아예 없음 (스티커 필요)' },
];

const DIMENSIONS: {
  key: 'widthMm' | 'lengthMm' | 'heightMm';
  label: string;
}[] = [
  { key: 'widthMm', label: '가로(좌우)' },
  { key: 'lengthMm', label: '세로(앞뒤)' },
  { key: 'heightMm', label: '높이(위아래)' },
];

export default function SkuFieldCaptureWorkPage() {
  return (
    <Suspense fallback={null}>
      <WorkPage />
    </Suspense>
  );
}

function WorkPage() {
  const { skuId } = useParams<{ skuId: string }>();
  const {
    data: detail,
    isFetchedAfterMount,
    error,
  } = useQuery({
    queryKey: fieldCaptureKeys.detail(skuId),
    queryFn: () => skuFieldCaptureClient.getDetail(skuId),
    staleTime: 0, // 다른 작업자가 방금 바꾼 실측·사진을 옛 캐시로 보여 주지 않게
  });

  // 초안은 상세가 처음 왔을 때 한 번만 만든다 — 캐시에 옛 상세가 있어도 이번 방문에 받은 값으로 만들게 기다린다
  if (!isFetchedAfterMount) return <Loader2 className="mx-auto mt-10 h-6 w-6 animate-spin text-gray-400" />;
  if (error || !detail) {
    return (
      <>
        <MobileTopBar title="상품 작업" backHref={BASE} />
        <p className="p-4 text-sm text-red-600">{errorMessageOf(error, '상품을 불러오지 못했어요')}</p>
      </>
    );
  }
  return <CaptureForm key={detail.skuId} detail={detail} />;
}

function readDraft(skuId: string): CaptureDraft | null {
  try {
    return restoreDraft(localStorage.getItem(draftStorageKey(skuId)), Date.now());
  } catch {
    return null;
  }
}

// ③ 상품 작업 — 바코드·크기·사진을 한 화면에서
function CaptureForm({ detail }: { detail: FieldCaptureDetailDto }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const skuId = detail.skuId;
  // 초안은 상세가 처음 왔을 때 한 번만 만든다 — 사진 응답마다 상세가 바뀌어도 입력을 덮지 않는다
  // 적어 둔 초안이 무게 칸이 생기기 전 것이어도 빈 칸은 서버 값으로 채운다
  const [draft, setDraft] = useState<CaptureDraft>(() => ({ ...draftFromDetail(detail), ...readDraft(skuId) }));
  useEffect(() => {
    try {
      localStorage.setItem(draftStorageKey(skuId), savedDraftJson(draft, Date.now()));
    } catch {
      // 저장소를 못 쓰면(사생활 보호 모드 등) 예전처럼 화면에만 둔다
    }
  }, [skuId, draft]);
  // 사진 연결·완료는 inventory.stock.operate (core 가 강제한다 — 여기선 버튼만 막는다)
  const canOperate = useCan(['inventory.stock.operate']);
  const writeBlocked = blockedReason(canOperate, [{ permission: ['inventory.stock.operate'] }]);
  const set = (patch: Partial<CaptureDraft>) => setDraft((d) => ({ ...d, ...patch }));

  // 사진 수는 언제나 지금 서버 상세의 수
  const fullDraft: CaptureDraft = {
    ...draft,
    photoCount: detail.photos.length,
  };
  const missing = missingRequirements(fullDraft);

  const scanned = draft.barcodeStatus === 'scanned' ? draft.scannedBarcode : '';
  const { data: ownerData } = useQuery({
    queryKey: fieldCaptureKeys.barcodeOwner(scanned),
    queryFn: () => skuFieldCaptureClient.getBarcodeOwner(scanned),
    enabled: scanned !== '',
    staleTime: 0, // 방금 다른 SKU 에 붙은 바코드를 옛 «주인 없음»으로 보여 주지 않게
  });
  const conflict = barcodeConflictWarning(ownerData?.owner ?? null, skuId);

  // 화면을 열 때 본 완료 시각 — 그사이 다른 작업자가 저장했으면 core 가 409 로 막는다
  const [openedAt, setOpenedAt] = useState(() => detail.completion?.lastCompletedAt ?? null);
  // 이미 완료된 상품을 연 것 = 수정. 저장 후엔 들어온 곳(작업 기록·선반)으로 돌아간다
  const [editing] = useState(() => detail.completion !== null);

  const setDetail = (d: FieldCaptureDetailDto) => queryClient.setQueryData(fieldCaptureKeys.detail(skuId), d);

  const complete = useMutation({
    mutationFn: () =>
      skuFieldCaptureClient.complete(skuId, {
        ...toCompleteRequest(fullDraft),
        expectedLastCompletedAt: openedAt,
      }),
    meta: { permission: ['inventory.stock.operate'] },
    onSuccess: async (d) => {
      setDetail(d);
      try {
        localStorage.removeItem(draftStorageKey(skuId));
      } catch {
        // 못 지워도 하루 뒤엔 버려진다
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: fieldCaptureKeys.positions }),
        queryClient.invalidateQueries({
          queryKey: fieldCaptureKeys.barcodeOwners,
        }),
        queryClient.invalidateQueries({ queryKey: fieldCaptureKeys.myToday }),
        queryClient.invalidateQueries({ queryKey: fieldCaptureKeys.items }),
      ]);
      toast.success(editing ? `${d.name} 수정했어요` : `${d.name} 완료`);
      if (editing) router.back();
      else router.push(BASE);
    },
    onError: async (e) => {
      toast.error(errorMessageOf(e, '완료하지 못했어요'));
      if (!isConflict(e)) return;
      // 다른 작업자가 먼저 저장했다 — 그 값을 보여 주고, 확인했으면 다시 누를 수 있게 기준 시각을 새로 잡는다
      const fresh = await queryClient.fetchQuery({
        queryKey: fieldCaptureKeys.detail(skuId),
        queryFn: () => skuFieldCaptureClient.getDetail(skuId),
      });
      setOpenedAt(fresh.completion?.lastCompletedAt ?? null);
    },
  });

  // 작업 기록에서 «수정»으로 왔으면 그 목록으로, 아니면 선반으로. 실측 화면 안의 주소만 받는다
  const back = useSearchParams().get('back');
  const shelfHref = detail.positionCode ? `${BASE}?position=${encodeURIComponent(detail.positionCode)}` : BASE;
  const backHref = back?.startsWith(`${BASE}/`) ? back : shelfHref;

  return (
    <>
      <MobileTopBar title={editing ? '수정' : '상품 작업'} backHref={backHref} />
      <div className="space-y-4 p-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{detail.name}</h2>
          <p className="text-xs text-gray-500">{detail.code}</p>
          {detail.completion && (
            <p className="mt-1 text-sm font-semibold text-green-700">{completedByText(detail.completion)}</p>
          )}
        </div>

        <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-800">
            바코드 <span className="font-normal text-gray-500">(하나 고르기)</span>
          </h2>
          <BarcodeScanInput
            label="제조사 바코드 찍기"
            placeholder="바코드 직접 입력"
            formats={MANUFACTURER_BARCODE_FORMATS}
            onScan={(value) => set({ barcodeStatus: 'scanned', scannedBarcode: value })}
          />
          {scanned !== '' && (
            <label className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm">
              <input type="radio" name="barcode" checked readOnly className="h-4 w-4" />
              <span className="font-mono">{scanned}</span>
            </label>
          )}
          {conflict && (
            <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {conflict}
            </p>
          )}
          {NO_SCAN_OPTIONS.map((o) => (
            <label key={o.value} className="flex items-center gap-2 py-1.5 text-sm text-gray-800">
              <input
                type="radio"
                name="barcode"
                checked={draft.barcodeStatus === o.value}
                onChange={() => set({ barcodeStatus: o.value, scannedBarcode: '' })}
                className="h-4 w-4"
              />
              {o.label}
            </label>
          ))}
        </section>

        <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-800">포장째 크기 (mm)</h2>
          <p className="text-xs text-gray-500">바닥에 세워 두고 앞에서 봤을 때 좌우·앞뒤(깊이)·위아래 길이예요</p>
          <div className="flex gap-2">
            {DIMENSIONS.map((dim) => (
              <input
                key={dim.key}
                value={draft[dim.key]}
                onChange={(e) => set({ [dim.key]: e.target.value })}
                placeholder={dim.label}
                aria-label={`${dim.label} (mm)`}
                inputMode="numeric"
                pattern="[0-9]*"
                className="h-11 w-full min-w-0 rounded-lg border border-gray-300 text-center text-base placeholder:text-xs"
              />
            ))}
          </div>
          <h2 className="pt-1 text-sm font-semibold text-gray-800">포장째 무게 (g)</h2>
          <input
            value={draft.weightG}
            onChange={(e) => set({ weightG: e.target.value })}
            placeholder="무게"
            aria-label="무게 (g)"
            inputMode="numeric"
            pattern="[0-9]*"
            className="h-11 w-full min-w-0 rounded-lg border border-gray-300 text-center text-base"
          />
        </section>

        <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-800">사진 (3장 이상)</h2>
          <ReferencePhotoField
            skuId={skuId}
            photos={detail.photos}
            onDetail={setDetail}
            disabled={writeBlocked !== null}
          />
          <label className="flex items-center gap-2 pt-1 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={draft.allFacesConfirmed}
              onChange={(e) => set({ allFacesConfirmed: e.target.checked })}
              className="h-4 w-4"
            />
            여섯 면이 모두 한 장 이상에 나왔어요
          </label>
        </section>

        {writeBlocked && <p className="text-xs text-red-600">{writeBlocked}</p>}
        {missing.length > 0 && (
          <ul className="space-y-0.5 text-xs text-gray-500">
            {missing.map((m) => (
              <li key={m}>· {m}</li>
            ))}
          </ul>
        )}
        <button
          type="button"
          disabled={missing.length > 0 || writeBlocked !== null || complete.isPending}
          onClick={() => complete.mutate()}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-4 text-base font-bold text-white disabled:bg-gray-300"
        >
          {complete.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
          {editing ? '수정 저장' : '완료 → 다음 선반'}
        </button>
      </div>
    </>
  );
}
