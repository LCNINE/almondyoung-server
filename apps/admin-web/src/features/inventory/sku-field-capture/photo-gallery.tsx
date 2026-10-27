'use client';

import { useState, type FormEvent } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { skuFieldCaptureClient } from '@/lib/api/domains/inventory/sku-field-capture.client';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import {
  fieldCaptureKeys,
  groupPhotosBySku,
  kstDateOf,
  kstShortTime,
  periodRange,
  type HistoryPeriod,
} from './field-capture-model';

const PERIODS: { value: HistoryPeriod; label: string }[] = [
  { value: 'today', label: '오늘' },
  { value: 'yesterday', label: '어제' },
  { value: 'week', label: '7일' },
  { value: 'all', label: '전체' },
];

export function FieldCapturePhotoGallery() {
  const [period, setPeriod] = useState<HistoryPeriod>('today');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const { from, to } = periodRange(period, kstDateOf(new Date().toISOString()), null);

  const { data, isLoading, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: fieldCaptureKeys.photos(from ?? '', to ?? '', q),
      queryFn: ({ pageParam }) =>
        skuFieldCaptureClient.getPhotos({ from, to, q: q || undefined, before: pageParam }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQ(text.trim());
  };

  const photos = data?.pages.flatMap((p) => p.photos) ?? [];
  const groups = groupPhotosBySku(photos);
  // 좌우 이동은 화면에 보이는 순서(상품 카드 순)를 따른다
  const ordered = groups.flat();
  const idx = ordered.findIndex((p) => p.id === openId);
  const open = idx >= 0 ? ordered[idx]! : null;
  const hasPrev = idx > 0;
  const hasNext = idx >= 0 && (idx < ordered.length - 1 || hasNextPage);
  const go = async (step: -1 | 1) => {
    if (idx < 0) return;
    const target = ordered[idx + step];
    if (target) return setOpenId(target.id);
    // 불러온 마지막 사진이면 다음 묶음을 불러와 이어 간다
    if (step === 1 && hasNextPage && !isFetchingNextPage) {
      const res = await fetchNextPage();
      const next = groupPhotosBySku(res.data?.pages.flatMap((p) => p.photos) ?? []).flat()[idx + 1];
      if (next) setOpenId(next.id);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-base font-semibold">
          찍은 사진
          {data && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {groups.length.toLocaleString('ko-KR')}개 상품 · {photos.length.toLocaleString('ko-KR')}장
              {hasNextPage && ' 이상'}
            </span>
          )}
        </h2>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPeriod(p.value)}
              className={
                p.value === period
                  ? 'rounded-md bg-background px-3 py-1 text-sm font-semibold shadow-sm'
                  : 'rounded-md px-3 py-1 text-sm text-muted-foreground'
              }
            >
              {p.label}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="flex items-center gap-1 rounded-lg border px-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="선반·상품·찍은 사람"
            className="h-8 w-48 bg-transparent text-sm outline-none"
          />
        </form>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">불러오는 중…</p>}
      {isError && (
        <div className="flex items-center gap-3 text-sm text-red-600">
          <span>사진을 불러오지 못했어요</span>
          <button type="button" className="rounded border px-2 py-1" onClick={() => refetch()}>
            다시 시도
          </button>
        </div>
      )}
      {data && groups.length === 0 && (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          이 기간에 찍은 사진이 없어요
        </p>
      )}

      <div className="flex flex-col gap-3">
        {groups.map((g) => {
          const head = g[0]!;
          return (
            <div key={head.skuId} className="rounded-lg border p-3">
              <div className="mb-2 flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold">
                  {head.positionCode ?? '선반 없음'}
                </span>
                <span className="font-medium">{head.name}</span>
                <span className="text-xs text-muted-foreground">{head.code}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {g.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setOpenId(p.id)}
                    className="flex w-28 flex-col gap-1 text-left"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- file-service 공개 경로, next/image 도메인 설정 밖 */}
                    <img
                      src={resolvePublicFileUrl(p.fileId) ?? ''}
                      alt={`${head.name} 사진`}
                      loading="lazy"
                      className="h-28 w-28 rounded-md border object-cover hover:opacity-80"
                    />
                    <span className="truncate text-xs">{p.takenByLabel}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {kstShortTime(p.createdAt)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {hasNextPage && (
        <button
          type="button"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
          className="self-center rounded-lg border px-6 py-2 text-sm disabled:opacity-50"
        >
          {isFetchingNextPage ? '불러오는 중…' : '더 보기'}
        </button>
      )}

      <Dialog open={open !== null} onOpenChange={(v) => !v && setOpenId(null)}>
        <DialogContent
          className="max-w-[calc(100%-2rem)] gap-3 p-4 sm:max-w-4xl"
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') void go(-1);
            if (e.key === 'ArrowRight') void go(1);
          }}
        >
          {open && (
            <>
              <DialogTitle className="pr-8 text-sm font-medium">
                <span className="mr-2 font-mono">{open.positionCode ?? '선반 없음'}</span>
                {open.name}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {open.takenByLabel} · {kstShortTime(open.createdAt)}
                </span>
              </DialogTitle>
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- file-service 공개 경로, next/image 도메인 설정 밖 */}
                <img
                  src={resolvePublicFileUrl(open.fileId) ?? ''}
                  alt={`${open.name} 사진`}
                  className="max-h-[80vh] w-full rounded-md object-contain"
                />
                <button
                  type="button"
                  aria-label="이전 사진"
                  disabled={!hasPrev}
                  onClick={() => void go(-1)}
                  className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 disabled:invisible"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button
                  type="button"
                  aria-label="다음 사진"
                  disabled={!hasNext || isFetchingNextPage}
                  onClick={() => void go(1)}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 disabled:invisible"
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
              </div>
              <p className="text-center text-xs text-muted-foreground tabular-nums">
                {idx + 1} / {ordered.length}
                {hasNextPage && '+'}
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
