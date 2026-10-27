'use client';

import { useQuery } from '@tanstack/react-query';
import { skuFieldCaptureClient } from '@/lib/api/domains/inventory/sku-field-capture.client';
import { fieldCaptureKeys, PROGRESS_REFETCH_MS } from './field-capture-model';
import { FieldCapturePhotoGallery } from './photo-gallery';

export default function SkuFieldCaptureProgressTemplate() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: fieldCaptureKeys.progress,
    queryFn: () => skuFieldCaptureClient.getProgress(),
    refetchInterval: PROGRESS_REFETCH_MS,
  });

  // 숫자는 서버 값 그대로 — 클라이언트에서 세지 않는다
  const cards = data
    ? [
        { label: '남은 SKU', value: data.remainingSkus },
        { label: '완료', value: data.completedSkus },
        { label: '스티커 필요', value: data.stickerNeededSkus },
        { label: '바코드 충돌', value: data.barcodeConflictSkus },
      ]
    : [];

  return (
    <div className="flex w-full max-w-[1000px] flex-col gap-y-4 p-3">
      <h1 className="text-lg font-semibold">실측 작업 현황</h1>
      {isLoading && (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      )}
      {isError && (
        <div className="flex items-center gap-3 text-sm text-red-600">
          <span>현황을 불러오지 못했어요</span>
          <button
            type="button"
            className="rounded border px-2 py-1"
            onClick={() => refetch()}
          >
            다시 시도
          </button>
        </div>
      )}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {cards.map((c) => (
              <div key={c.label} className="rounded-lg border p-4">
                <div className="text-sm text-muted-foreground">{c.label}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {c.value.toLocaleString('ko-KR')}
                </div>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">작업자</th>
                  <th className="px-3 py-2 text-right font-medium">오늘</th>
                  <th className="px-3 py-2 text-right font-medium">누적</th>
                </tr>
              </thead>
              <tbody>
                {data.workers.map((w) => (
                  <tr key={w.workerId} className="border-t">
                    <td className="px-3 py-2">{w.workerLabel}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {w.today.toLocaleString('ko-KR')}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {w.total.toLocaleString('ko-KR')}
                    </td>
                  </tr>
                ))}
                {data.workers.length === 0 && (
                  <tr className="border-t">
                    <td
                      colSpan={3}
                      className="px-3 py-4 text-center text-muted-foreground"
                    >
                      아직 작업한 사람이 없어요
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      <FieldCapturePhotoGallery />
    </div>
  );
}
