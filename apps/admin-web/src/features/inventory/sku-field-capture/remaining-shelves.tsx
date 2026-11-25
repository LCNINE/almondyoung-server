'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { skuFieldCaptureClient } from '@/lib/api/domains/inventory/sku-field-capture.client';
import type { RemainingItemDto } from '@/lib/types/dto/inventory';
import { fieldCaptureKeys, PROGRESS_REFETCH_MS } from './field-capture-model';

const ETC = '기타';

export function RemainingShelves() {
  const [picked, setPicked] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: fieldCaptureKeys.remaining,
    queryFn: () => skuFieldCaptureClient.getRemaining(),
    refetchInterval: PROGRESS_REFETCH_MS,
  });

  const etcCount = data?.items.filter((i) => !i.row).length ?? 0;
  const pickedItems =
    data?.items.filter((i) => (i.row ?? ETC) === picked) ?? [];

  const shelves = new Map<string, RemainingItemDto[]>();
  for (const item of pickedItems) {
    const key = item.shelf ?? ETC;
    shelves.set(key, [...(shelves.get(key) ?? []), item]);
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-base font-semibold">남은 선반</h2>
        {data && data.excludedRows.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {data.excludedRows.join(', ')} 줄은 실측 대상이 아니라 뺐어요
          </span>
        )}
      </div>
      {isLoading && (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      )}
      {isError && (
        <div className="flex items-center gap-3 text-sm text-red-600">
          <span>남은 선반을 불러오지 못했어요</span>
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
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
            {data.rows.map((r) => (
              <RowButton
                key={r.row}
                label={r.row}
                remaining={r.remaining}
                completed={r.completed}
                active={picked === r.row}
                onClick={() => setPicked(picked === r.row ? null : r.row)}
              />
            ))}
            {etcCount > 0 && (
              <RowButton
                label={ETC}
                remaining={etcCount}
                active={picked === ETC}
                onClick={() => setPicked(picked === ETC ? null : ETC)}
              />
            )}
          </div>

          {picked && pickedItems.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {picked} 줄은 다 끝났어요
            </p>
          )}
          {[...shelves].map(([shelf, items]) => (
            <div key={shelf} className="overflow-x-auto rounded-lg border">
              <div className="bg-muted/50 px-3 py-2 text-sm font-semibold">
                {shelf}{' '}
                <span className="font-normal text-muted-foreground">
                  {items.length}개
                </span>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {items.map((i) => (
                    <tr key={i.skuId} className="border-t">
                      <td className="w-24 px-3 py-1.5 font-mono text-xs">
                        {i.positionCode ?? '-'}
                      </td>
                      <td className="w-36 px-3 py-1.5 font-mono text-xs">
                        {i.code}
                      </td>
                      <td className="px-3 py-1.5">{i.name}</td>
                      <td className="w-16 px-3 py-1.5 text-right tabular-nums">
                        {i.qty.toLocaleString('ko-KR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function RowButton({
  label,
  remaining,
  completed,
  active,
  onClick,
}: {
  label: string;
  remaining: number;
  completed?: number;
  active: boolean;
  onClick: () => void;
}) {
  const finished = remaining === 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-2 text-left ${active ? 'border-gray-900 bg-gray-50' : ''} ${finished ? 'text-muted-foreground' : ''}`}
    >
      <div className="font-semibold">{label}</div>
      <div className="text-xs tabular-nums">
        {finished ? '끝' : `남음 ${remaining.toLocaleString('ko-KR')}`}
        {completed !== undefined && (
          <span className="text-muted-foreground">
            {' '}
            · 완료 {completed.toLocaleString('ko-KR')}
          </span>
        )}
      </div>
    </button>
  );
}
