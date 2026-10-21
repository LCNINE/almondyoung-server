'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useCan } from '@/hooks/use-permission';
import { blockedReason } from '@/lib/auth/permission-check';
import { skuFieldCaptureClient } from '@/lib/api/domains/inventory/sku-field-capture.client';
import type { MyCaptureItemDto } from '@/lib/types/dto/inventory';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import { MobileTopBar } from '@/features/inventory/sku-field-capture/components/mobile-top-bar';
import { SkuThumb } from '@/features/inventory/sku-field-capture/components/sku-thumb';
import {
  errorMessageOf,
  fieldCaptureKeys,
  HISTORY_PERIODS,
  kstDateOf,
  myItemLine,
  periodRange,
  scanInputValue,
  type HistoryPeriod,
} from '@/features/inventory/sku-field-capture/field-capture-model';

const BASE = '/mobile/sku-field-capture';

const WHO = [
  { value: 'mine', label: '내 기록' },
  { value: 'all', label: '전체 기록' },
] as const;

const PERIOD_LABEL: Record<HistoryPeriod, string> = {
  today: '오늘',
  yesterday: '어제',
  week: '7일',
  all: '전체',
  date: '날짜 선택',
};

export default function CaptureHistoryPage() {
  return (
    <Suspense fallback={null}>
      <CaptureHistory />
    </Suspense>
  );
}

// 작업 기록 — 내 기록·오늘이 먼저 열린다. 검색·기간으로 좁히고, 다시 작업(수정)하거나 삭제(소프트 삭제)한다
function CaptureHistory() {
  const router = useRouter();
  const params = useSearchParams();
  const who = params.get('who') === 'all' ? 'all' : 'mine';
  const period = HISTORY_PERIODS.find((p) => p === params.get('period')) ?? 'today';
  const picked = params.get('date');
  const q = params.get('q') ?? '';
  const today = kstDateOf(new Date().toISOString());
  const { from, to } = periodRange(period, today, picked);

  // 조건은 주소에 둔다 — 수정하러 들어갔다가 뒤로 와도 그대로
  const go = (next: Partial<Record<'who' | 'period' | 'date' | 'q', string | null>>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    router.replace(`${BASE}/mine?${sp.toString()}`);
  };

  const [text, setText] = useState(q);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    go({ q: scanInputValue(text)?.trim() || null });
  };
  const filtered = period !== 'today' || q !== '';
  // 수정하러 들어간 화면이 뒤로 이 조건 그대로 돌아오게
  const here = `${BASE}/mine${params.toString() ? `?${params.toString()}` : ''}`;

  const queryClient = useQueryClient();
  const [target, setTarget] = useState<MyCaptureItemDto | null>(null);
  // 완료 취소는 inventory.stock.operate (core 가 강제한다 — 여기선 버튼만 막는다)
  const canOperate = useCan(['inventory.stock.operate']);
  const writeBlocked = blockedReason(canOperate, [{ permission: ['inventory.stock.operate'] }]);

  const { data, isLoading, error } = useQuery({
    queryKey: fieldCaptureKeys.itemsOf(who, from ?? '', to ?? '', q),
    queryFn: () => skuFieldCaptureClient.getItems({ who, from, to, q: q || undefined }),
    staleTime: 0, // 작업 화면에서 막 끝내고 돌아와도 바로 보이게
  });

  const cancel = useMutation({
    mutationFn: (item: MyCaptureItemDto) => skuFieldCaptureClient.cancel(item.skuId),
    meta: { permission: ['inventory.stock.operate'] },
    onSuccess: async (_, item) => {
      setTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: fieldCaptureKeys.items }),
        queryClient.invalidateQueries({ queryKey: fieldCaptureKeys.myToday }),
        queryClient.invalidateQueries({ queryKey: fieldCaptureKeys.positions }),
        queryClient.invalidateQueries({
          queryKey: fieldCaptureKeys.detail(item.skuId),
        }),
      ]);
      toast.success(`${item.name} 완료를 취소했어요`);
    },
    onError: (e) => toast.error(errorMessageOf(e, '완료를 취소하지 못했어요')),
  });

  // 하루만 보는 중이면 날짜로 묶지 않는다
  const groups = groupByDate(data?.items ?? [], !(from && from === to));

  return (
    <>
      <MobileTopBar title="작업 기록" backHref={BASE} />
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1">
          {WHO.map((w) => (
            <button
              key={w.value}
              type="button"
              onClick={() => go({ who: w.value === 'mine' ? null : w.value })}
              className={
                w.value === who
                  ? 'rounded-md bg-white py-2 text-sm font-semibold text-gray-900 shadow-sm'
                  : 'rounded-md py-2 text-sm text-gray-600'
              }
            >
              {w.label}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="상품명·코드·선반으로 찾기"
            enterKeyHint="search"
            className="h-11 w-full rounded-lg border border-gray-300 bg-white pl-9 pr-10 text-base"
          />
          {text !== '' && (
            <button
              type="button"
              aria-label="검색어 지우기"
              onClick={() => {
                setText('');
                go({ q: null });
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-gray-400"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </form>

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {HISTORY_PERIODS.map((p) =>
            p === 'date' ? (
              // 날짜 칩은 폰 기본 달력을 띄운다 — 투명 date 입력을 칩 위에 겹친다
              <label key={p} className={`relative ${chipClass(period === 'date')}`}>
                {period === 'date' && picked ? picked.slice(5).replace('-', '/') : PERIOD_LABEL.date}
                <input
                  type="date"
                  max={today}
                  value={picked ?? ''}
                  onChange={(e) =>
                    go({
                      period: e.target.value ? 'date' : null,
                      date: e.target.value || null,
                    })
                  }
                  className="absolute inset-0 opacity-0"
                  aria-label="날짜 선택"
                />
              </label>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => go({ period: p === 'today' ? null : p, date: null })}
                className={chipClass(period === p)}
              >
                {PERIOD_LABEL[p]}
              </button>
            ),
          )}
          {filtered && (
            <button
              type="button"
              onClick={() => {
                setText('');
                go({ period: null, date: null, q: null });
              }}
              className="shrink-0 px-2 text-sm text-gray-500 underline underline-offset-2"
            >
              초기화
            </button>
          )}
        </div>

        {data && <p className="text-sm text-gray-600">{data.items.length}개</p>}
        {isLoading && <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" />}
        {error && <p className="text-sm text-red-600">{errorMessageOf(error, '목록을 불러오지 못했어요')}</p>}
        {data && data.items.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-500">
            {q ? `'${q}'에 맞는 기록이 없어요` : '이 기간에 끝낸 상품이 없어요'}
          </p>
        )}
        {writeBlocked && <p className="text-xs text-red-600">{writeBlocked}</p>}

        {groups.map((g) => (
          <section key={g.date} className="space-y-2">
            {g.date && <h2 className="pt-2 text-sm font-semibold text-gray-700">{g.date}</h2>}
            <ul className="space-y-2">
              {g.items.map((item) => (
                <li key={item.skuId} className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="flex items-center gap-3">
                    <SkuThumb src={resolvePublicFileUrl(item.imageUrl)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-gray-900">{item.name}</p>
                      <p className="text-xs text-gray-500">
                        {item.code}
                        {item.positionCode && ` · 선반 ${item.positionCode}`}
                      </p>
                      <p className="mt-1 text-xs text-gray-700">{myItemLine(item)}</p>
                      {who === 'all' && <p className="text-xs text-gray-500">{item.lastWorkerLabel} 님</p>}
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Link
                      href={`${BASE}/${encodeURIComponent(item.skuId)}?back=${encodeURIComponent(here)}`}
                      className="flex h-10 flex-1 items-center justify-center rounded-lg border border-gray-300 text-sm font-medium text-gray-800"
                    >
                      수정
                    </Link>
                    {item.canCancel ? (
                      <button
                        type="button"
                        onClick={() => setTarget(item)}
                        disabled={writeBlocked !== null}
                        className="h-10 flex-1 rounded-lg border border-red-200 text-sm font-medium text-red-600 disabled:opacity-40"
                      >
                        삭제
                      </button>
                    ) : (
                      <p className="flex flex-1 items-center justify-center text-center text-xs text-gray-500">
                        {item.lastWorkerLabel} 님이 마지막으로 작업했어요
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <AlertDialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>작업 기록을 삭제할까요?</AlertDialogTitle>
              <AlertDialogDescription>
                {target?.name} 상품이 미완료로 돌아가요. 입력한 크기·사진은 남아 있어서 다시 작업할 때 그대로 보여요.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>닫기</AlertDialogCancel>
              <AlertDialogAction
                disabled={cancel.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  if (target) cancel.mutate(target);
                }}
              >
                삭제
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </>
  );
}

function chipClass(active: boolean): string {
  return active
    ? 'shrink-0 rounded-full bg-gray-900 px-3.5 py-1.5 text-sm font-medium text-white'
    : 'shrink-0 rounded-full border border-gray-300 bg-white px-3.5 py-1.5 text-sm text-gray-700';
}

function groupByDate(items: MyCaptureItemDto[], byDate: boolean): { date: string; items: MyCaptureItemDto[] }[] {
  if (!byDate) return items.length > 0 ? [{ date: '', items }] : [];
  const out: { date: string; items: MyCaptureItemDto[] }[] = [];
  for (const item of items) {
    const date = kstDateOf(item.completedAt);
    const last = out.at(-1);
    if (last?.date === date) last.items.push(item);
    else out.push({ date, items: [item] });
  }
  return out;
}
