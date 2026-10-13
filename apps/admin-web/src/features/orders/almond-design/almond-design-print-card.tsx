'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  almondDesignsClient,
  type AlmondPrintFormat,
} from '@/lib/api/domains/products/almond-templates.client';

type Guide = { format: AlmondPrintFormat; dpi?: number; note: string };

const GUIDES: Record<string, Guide> = {
  card: { format: 'pdf', note: '명함류: PDF(앞 1쪽·뒤 2쪽)로 접수' },
  nail: { format: 'pdf', note: '명함류: PDF(앞 1쪽·뒤 2쪽)로 접수' },
  pet: { format: 'jpg', dpi: 350, note: 'PET배너: PDF 불가 · JPG 350dpi' },
  mini: { format: 'jpg', dpi: 350, note: '미니배너: PDF 불가 · JPG 350dpi' },
  window: { format: 'jpg', dpi: 700, note: '현수막: 1/10 축소 파일 · 700dpi' },
  menu: { format: 'jpg', dpi: 300, note: '포스터류: JPG 300dpi' },
  diploma: { format: 'jpg', dpi: 300, note: '포스터류: JPG 300dpi' },
};

const FORMATS: { format: AlmondPrintFormat; label: string }[] = [
  { format: 'pdf', label: 'PDF' },
  { format: 'eps', label: 'EPS' },
  { format: 'jpg', label: 'JPG' },
];

export function AlmondDesignPrintCard({ designId }: { designId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['almond-design', designId],
    queryFn: () => almondDesignsClient.get(designId),
  });
  const [preparing, setPreparing] = useState<AlmondPrintFormat | null>(null);
  const kind = typeof data?.design.kind === 'string' ? data.design.kind : '';
  const guide = GUIDES[kind];
  const hasBack = data?.hasBack ?? false;

  const download = async (format: AlmondPrintFormat, dpi?: number) => {
    setPreparing(format);
    try {
      const { url } = await almondDesignsClient.printLink(
        designId,
        format,
        dpi
      );
      window.location.assign(url);
    } catch (error) {
      toast.error(
        isAxiosError(error) &&
          (error.response?.status === 504 || error.code === 'ECONNABORTED')
          ? '인쇄 파일을 아직 만드는 중입니다. 1분쯤 뒤 다시 눌러 주세요.'
          : '인쇄 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.'
      );
    } finally {
      setPreparing(null);
    }
  };

  if (isLoading)
    return <p className="text-xs text-gray-400">고객 시안 불러오는 중…</p>;
  if (isError || !data)
    return (
      <p className="text-xs text-red-500">
        고객 시안을 불러오지 못했습니다. (ID {designId})
      </p>
    );

  return (
    <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-2.5">
      <div className="mb-2 text-xs font-semibold text-gray-700">
        고객 시안 (아몬드템플릿)
      </div>
      <div className="flex gap-2">
        {(hasBack ? (['front', 'back'] as const) : (['front'] as const)).map(
          (side) => (
            <a
              key={side}
              href={almondDesignsClient.previewUrl(designId, side)}
              target="_blank"
              rel="noreferrer"
              className="flex-1"
              title="새 창에서 크게 보기"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={almondDesignsClient.previewUrl(designId, side)}
                alt={side === 'front' ? '앞면' : '뒷면'}
                className="max-h-40 w-full rounded border bg-white object-contain"
              />
              <span className="mt-0.5 block text-center text-[11px] text-gray-500">
                {side === 'front' ? '앞면' : '뒷면'}
              </span>
            </a>
          )
        )}
      </div>
      {guide && (
        <p className="mt-2 text-[11px] text-gray-500">권장 · {guide.note}</p>
      )}
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {FORMATS.map(({ format, label }) => {
          const recommended = guide?.format === format;
          const dpi = format === 'jpg' ? (guide?.dpi ?? 300) : undefined;
          return (
            <button
              key={format}
              type="button"
              disabled={preparing !== null}
              onClick={() => void download(format, dpi)}
              className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs disabled:opacity-60 ${recommended ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700'}`}
            >
              {preparing === format ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Download className="size-3" />
              )}
              {label}
              {dpi ? ` ${dpi}dpi` : ''}
              {recommended && ' (권장)'}
            </button>
          );
        })}
      </div>
    </div>
  );
}
