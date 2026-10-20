'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useCan } from '@/hooks/use-permission';
import { blockedReason } from '@/lib/auth/permission-check';
import { skuFieldCaptureClient } from '@/lib/api/domains/inventory/sku-field-capture.client';
import type { FieldCaptureBarcodeStatus, FieldCaptureDetailDto } from '@/lib/types/dto/inventory';
import { BarcodeScanInput } from '@/features/inventory/sku-field-capture/components/barcode-scan-input';
import { ReferencePhotoField } from '@/features/inventory/sku-field-capture/components/reference-photo-field';
import {
  barcodeConflictWarning,
  completedByText,
  errorMessageOf,
  fieldCaptureKeys,
  missingRequirements,
  toCompleteRequest,
  type CaptureDraft,
} from '@/features/inventory/sku-field-capture/field-capture-model';

const BASE = '/mobile/sku-field-capture';

type DraftFields = Omit<CaptureDraft, 'photoCount'>;

const EMPTY_DRAFT: DraftFields = {
  widthMm: '',
  lengthMm: '',
  heightMm: '',
  barcodeStatus: null,
  scannedBarcode: '',
  allFacesConfirmed: false,
};

const NO_SCAN_OPTIONS: { value: FieldCaptureBarcodeStatus; label: string }[] = [
  { value: 'no_manufacturer', label: '제조사 바코드 없음 · 자체 스티커 있음' },
  { value: 'none', label: '바코드 아예 없음 (스티커 필요)' },
];

const DIMENSIONS: { key: 'widthMm' | 'lengthMm' | 'heightMm'; label: string }[] = [
  { key: 'widthMm', label: '가로' },
  { key: 'lengthMm', label: '세로' },
  { key: 'heightMm', label: '높이' },
];

export default function SkuFieldCaptureWorkPage() {
  const { skuId } = useParams<{ skuId: string }>();
  const { data: detail, isLoading, error } = useQuery({
    queryKey: fieldCaptureKeys.detail(skuId),
    queryFn: () => skuFieldCaptureClient.getDetail(skuId),
  });

  if (isLoading) return <Loader2 className="mx-auto mt-10 h-6 w-6 animate-spin text-gray-400" />;
  if (error || !detail) {
    return (
      <div className="space-y-3 p-4">
        <Link href={BASE} className="flex items-center gap-1 text-sm text-gray-600">
          <ChevronLeft className="h-4 w-4" />
          처음으로
        </Link>
        <p className="text-sm text-red-600">{errorMessageOf(error, '상품을 불러오지 못했어요')}</p>
      </div>
    );
  }
  return <CaptureForm detail={detail} />;
}

// ③ 상품 작업 — 바코드·크기·사진을 한 화면에서
function CaptureForm({ detail }: { detail: FieldCaptureDetailDto }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const skuId = detail.skuId;
  const [draft, setDraft] = useState<DraftFields>(EMPTY_DRAFT);
  // 사진 연결·완료는 inventory.stock.operate (core 가 강제한다 — 여기선 버튼만 막는다)
  const canOperate = useCan(['inventory.stock.operate']);
  const writeBlocked = blockedReason(canOperate, [{ permission: ['inventory.stock.operate'] }]);
  const set = (patch: Partial<DraftFields>) => setDraft((d) => ({ ...d, ...patch }));

  const fullDraft: CaptureDraft = { ...draft, photoCount: detail.photos.length };
  const missing = missingRequirements(fullDraft);

  const scanned = draft.barcodeStatus === 'scanned' ? draft.scannedBarcode : '';
  const { data: ownerData } = useQuery({
    queryKey: fieldCaptureKeys.barcodeOwner(scanned),
    queryFn: () => skuFieldCaptureClient.getBarcodeOwner(scanned),
    enabled: scanned !== '',
  });
  const conflict = barcodeConflictWarning(ownerData?.owner ?? null, skuId);

  const setDetail = (d: FieldCaptureDetailDto) => queryClient.setQueryData(fieldCaptureKeys.detail(skuId), d);

  const complete = useMutation({
    mutationFn: () => skuFieldCaptureClient.complete(skuId, toCompleteRequest(fullDraft)),
    meta: { permission: ['inventory.stock.operate'] },
    onSuccess: async (d) => {
      setDetail(d);
      await queryClient.invalidateQueries({ queryKey: fieldCaptureKeys.positions });
      toast.success(`${d.name} 완료`);
      router.push(BASE);
    },
    onError: (e) => toast.error(errorMessageOf(e, '완료하지 못했어요')),
  });

  const backHref = detail.positionCode ? `${BASE}?position=${encodeURIComponent(detail.positionCode)}` : BASE;

  return (
    <div className="space-y-4 p-4">
      <Link href={backHref} className="flex items-center gap-1 text-sm text-gray-600">
        <ChevronLeft className="h-4 w-4" />
        {detail.positionCode ? `선반 ${detail.positionCode}` : '처음으로'}
      </Link>
      <div>
        <h1 className="text-lg font-bold text-gray-900">{detail.name}</h1>
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
              className="h-11 w-full min-w-0 rounded-lg border border-gray-300 text-center text-base"
            />
          ))}
        </div>
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
        완료 → 다음 선반
      </button>
    </div>
  );
}
