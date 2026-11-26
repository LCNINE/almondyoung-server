import { useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Printer, Search } from 'lucide-react';
import { isStationDevice } from '../../app/station';
import { Button } from '../../core/design/Button';
import { cn } from '../../core/design/cn';
import { loadFailed } from '../../core/data/loadFailed';
import { LoadFailure } from '../../core/design/LoadFailure';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { remembered, useRememberedState } from '../../core/design/rememberedState';
import { useSkuSearch } from './useSkuSearch';
import { useSkuByBarcode } from './useSkuByBarcode';
import { StockCell } from './StockCell';
import { SkuThumbnail } from './SkuInfoSheet';
import { SECONDARY_BUTTON, SkuStockCard } from './SkuStockCard';
import type { SkuSearchItem } from './types';

const PAGE_SIZE = 20;

type SortKey = 'name' | 'code';

interface Sort {
  key: SortKey;
  desc: boolean;
}

const PANEL = 'flex min-w-0 flex-col overflow-hidden rounded-xl border border-[#e4e4e7] bg-white';

const HEAD_CELL = 'px-5 py-3 font-medium whitespace-nowrap max-[1000px]:p-3';

const CELL = 'px-5 py-[11px] align-middle max-[1000px]:p-3';

const lookupMemory = {
  term: remembered(''),
  query: remembered(''),
  sort: remembered<Sort | null>(null),
  pageIndex: remembered(0),
  selected: remembered<SkuSearchItem | null>(null),
  labelOpen: remembered(false),
};

function nextSort(current: Sort | null, key: SortKey): Sort | null {
  if (current?.key !== key) {
    return { key, desc: false };
  }

  return current.desc ? null : { key, desc: true };
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: Sort | null;
  onSort: (key: SortKey) => void;
}) {
  const active = sort?.key === sortKey;

  return (
    <button type="button" className="inline-flex items-center gap-1" onClick={() => onSort(sortKey)}>
      {label}
      <span aria-hidden>{active ? (sort.desc ? '▼' : '▲') : ''}</span>
    </button>
  );
}

export function InventoryLookupScreen() {
  const [term, setTerm] = useRememberedState(lookupMemory.term, '');
  const [query, setQuery] = useRememberedState(lookupMemory.query, '');
  const [sort, setSort] = useRememberedState<Sort | null>(lookupMemory.sort, null);
  const [pageIndex, setPageIndex] = useRememberedState(lookupMemory.pageIndex, 0);
  const [selected, setSelected] = useRememberedState<SkuSearchItem | null>(lookupMemory.selected, null);
  const [labelOpen, setLabelOpen] = useRememberedState(lookupMemory.labelOpen, false);
  const station = isStationDevice();

  const navigate = useNavigate();
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [scanHits, setScanHits] = useState<SkuSearchItem[]>([]);
  // 조회 실패는 0건과 다르다 — 미등록으로 안내하거나 이름 검색으로 넘기지 않고, 같은 조회를 다시 할 수 있게 둔다
  const [lookupFailure, setLookupFailure] = useState<{
    message: string;
    error: unknown;
    retry(): void;
  } | null>(null);
  // 오프라인에서 조회를 멈춰 두면 아무 안내 없이 기다리다 연결된 뒤 화면이 저절로 넘어간다
  const byBarcode = useSkuByBarcode('always');

  // 각 화면은 자신이 기대하는 바코드 종류를 안다 — 여기선 상품 바코드다. 스캔은
  // "상태"가 아니라 "이벤트"다 — mutate 호출마다 독립적으로 요청하고, 그 결과는
  // 이 호출의 onSuccess 에서만 정확히 한 번 소비한다. 캐시 신선도(staleTime)나
  // effect 의 재진입에 기대지 않는다 — 그 설계는 두 방향의 버그(응답 누락, 중복
  // 처리)를 모두 냈다.
  // 마지막 조회만 결과를 쓴다 — 늦게 온 앞 조회가 화면을 덮거나 다른 상품으로 이동시키지 않게
  const lookupSeq = useRef(0);

  // 한 건이면 상세로, 여러 건이면 고르게 한다. 0건이면 onMiss 가 정한다.
  const lookupBarcode = (code: string, onMiss: () => void, failureMessage: string) => {
    const seq = ++lookupSeq.current;
    const latest = () => seq === lookupSeq.current;
    setScanNotice(null);
    setScanHits([]);
    setLookupFailure(null);
    byBarcode.mutate(code, {
      onSuccess: (hits) => {
        if (!latest()) return;
        if (hits.length === 1) {
          void navigate({ to: '/inventory/$sku', params: { sku: hits[0].id } });
        } else if (hits.length === 0) {
          onMiss();
        } else {
          setScanHits(hits);
        }
      },
      onError: (error) => {
        if (!latest()) return;
        setLookupFailure({
          message: failureMessage,
          error,
          retry: () => lookupBarcode(code, onMiss, failureMessage),
        });
      },
    });
  };

  useScanner((e) => {
    if (byBarcode.isPending) return; // 응답을 기다리는 동안 겹치는 스캔은 무시한다
    lookupBarcode(
      e.code,
      () => setScanNotice(`등록되지 않은 바코드예요: ${e.code}`),
      `바코드를 확인하지 못했어요: ${e.code}.`
    );
  });

  // 검색칸에 찍힌(친) 바코드는 스캔 버스로 오지 않는다 — 바코드로 먼저 찾고, 없으면 상품명·코드 검색
  const search = (value: string) => {
    const searchByName = () => {
      setPageIndex(0);
      setSelected(null);
      setQuery(value);
    };
    const code = value.trim();
    if (code === '') {
      lookupSeq.current += 1; // 진행 중인 조회는 버린다
      setLookupFailure(null);
      searchByName();
    } else lookupBarcode(code, searchByName, `검색하지 못했어요: ${code}.`);
  };

  const results = useSkuSearch({
    search: query,
    limit: PAGE_SIZE,
    offset: pageIndex * PAGE_SIZE,
    sortBy: sort?.key,
    sortOrder: sort ? (sort.desc ? 'desc' : 'asc') : undefined,
  });

  // 실패한 페이지를 다시 확인하는 동안 끼워 넣는 앞 페이지 결과는 이 페이지의 결과가 아니다
  const searchFailed = loadFailed(results);
  const shown = searchFailed && results.isPlaceholderData ? undefined : results.data;
  const items = shown?.items ?? [];
  const total = shown?.total ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);
  const hasQuery = query.trim().length > 0;

  const handleSort = (key: SortKey) => {
    setSort((current) => nextSort(current, key));
    setPageIndex(0);
  };

  return (
    <div className="space-y-5">
      <ScreenHeader
        title="재고 조회"
        description="상품을 찾고, 위치와 수량을 확인하세요."
        right={
          station ? (
            <Button
              type="button"
              className={cn('gap-2', SECONDARY_BUTTON)}
              disabled={!selected}
              onClick={() => setLabelOpen(true)}
            >
              <Printer className="h-5 w-5" aria-hidden />
              라벨 출력
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-[minmax(480px,1.6fr)_minmax(290px,0.9fr)] gap-[22px] max-[961px]:grid-cols-[1.2fr_1fr] max-[701px]:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-4">
          <form
            className="flex items-center gap-2 rounded-[10px] border border-[#e4e4e7] bg-white px-[15px] py-3 max-[900px]:p-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              search(term);
            }}
          >
            <Search className="h-[23px] w-[23px] shrink-0 text-[#2563eb]" aria-hidden />
            <input
              aria-label="상품명 · 코드 · 바코드 검색"
              autoComplete="off"
              className="min-w-0 flex-1 border-0 bg-transparent p-[5px] text-sm outline-0 max-[900px]:text-xs"
              placeholder="상품명 · 코드 · 바코드 검색"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
            <Button type="submit" className={cn('px-3 py-[7px]', SECONDARY_BUTTON)}>
              검색
            </Button>
          </form>

          {scanNotice ? (
            <p role="status" className="text-sm text-[#9a681c]">
              {scanNotice}
            </p>
          ) : null}

          {scanHits.length > 1 ? (
            <section className={PANEL}>
              <div className="border-b border-[#e4e4e7] px-[22px] py-4">
                <h2 className="text-base font-bold tracking-[-0.2px] text-[#27272a]">스캔한 바코드의 상품</h2>
              </div>
              <ul className="divide-y divide-[#e4e4e7]">
                {scanHits.map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-[13px] px-5 py-3 text-left hover:bg-[#eff6ff]"
                      onClick={() => {
                        setScanHits([]);
                        void navigate({ to: '/inventory/$sku', params: { sku: hit.id } });
                      }}
                    >
                      <SkuThumbnail fileIds={hit.imageFileIds} className="h-[40px] w-[34px] flex-none rounded-[7px]" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-[#27272a]">{hit.name}</span>
                        <span className="block font-mono text-[11px] text-[#71717a]">{hit.code}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {lookupFailure ? (
            <LoadFailure
              message={lookupFailure.message}
              error={lookupFailure.error}
              retrying={byBarcode.isPending}
              onRetry={lookupFailure.retry}
            />
          ) : null}

          {searchFailed && (
            <LoadFailure
              message="검색 결과를 불러오지 못했어요."
              error={results.error}
              stale={shown !== undefined}
              retrying={results.isFetching}
              onRetry={() => void results.refetch()}
            />
          )}

          {hasQuery && (!searchFailed || shown) && (
            <section aria-label="상품 목록" className={PANEL}>
              <div className="flex items-center justify-between gap-2.5 border-b border-[#e4e4e7] px-[22px] py-[19px]">
                <h3 className="text-base font-bold tracking-[-0.2px] text-[#27272a]">상품 목록</h3>
                <small className="text-xs text-[#71717a]">{`${total}개 결과`}</small>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-[#fafafa] text-left text-[11px] text-[#71717a]">
                      <th className={HEAD_CELL}>
                        <SortHeader label="상품 / 옵션" sortKey="name" sort={sort} onSort={handleSort} />
                      </th>
                      <th className={cn(HEAD_CELL, 'max-[700px]:hidden')}>
                        <SortHeader label="코드" sortKey="code" sort={sort} onSort={handleSort} />
                      </th>
                      <th className={cn(HEAD_CELL, 'text-right')}>재고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.isLoading ? (
                      <tr className="border-t border-[#e4e4e7]">
                        <td colSpan={3} className="p-[30px] text-center text-[13px] text-[#71717a]">
                          조회 중…
                        </td>
                      </tr>
                    ) : (
                      items.map((item) => {
                        const isSelected = selected?.id === item.id;

                        return (
                          <tr
                            key={item.id}
                            className={cn(
                              'cursor-pointer border-t border-[#e4e4e7] hover:bg-[#eff6ff]',
                              isSelected && 'bg-[#eff6ff]'
                            )}
                            onClick={() => setSelected(item)}
                          >
                            <td className={CELL}>
                              <button
                                type="button"
                                aria-label={`${item.name} 재고 상세`}
                                aria-pressed={isSelected}
                                className="flex items-center gap-[13px] text-left max-[900px]:gap-2"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelected(item);
                                }}
                              >
                                <SkuThumbnail
                                  fileIds={item.imageFileIds}
                                  className="h-[40px] w-[34px] flex-none rounded-[7px]"
                                />
                                <span className="min-w-0">
                                  <strong className="block text-sm leading-normal font-semibold text-[#27272a] max-[900px]:text-xs">
                                    {item.name}
                                  </strong>
                                  {item.optionKey ? (
                                    <small className="mt-1 block text-[11px] text-[#71717a] max-[900px]:text-[10px]">
                                      {item.optionKey}
                                    </small>
                                  ) : null}
                                </span>
                              </button>
                            </td>
                            <td className={cn(CELL, 'font-mono text-[13px] text-[#52525b] max-[700px]:hidden')}>
                              {item.code}
                            </td>
                            <td className={CELL}>
                              <StockCell item={item} />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {!results.isLoading && items.length === 0 ? (
                <div className="p-[30px] text-center text-[13px] text-[#71717a]">일치하는 상품이 없어요.</div>
              ) : null}
              {pageCount > 1 && (
                <div className="flex items-center justify-between gap-2 border-t border-[#e4e4e7] px-[22px] py-3 text-[13px] text-[#71717a]">
                  <span className="tabular-nums">
                    {pageIndex + 1} / {pageCount}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      className={cn('px-3 py-1.5 text-xs', SECONDARY_BUTTON)}
                      disabled={pageIndex === 0}
                      onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                    >
                      이전
                    </Button>
                    <Button
                      type="button"
                      className={cn('px-3 py-1.5 text-xs', SECONDARY_BUTTON)}
                      disabled={pageIndex + 1 >= pageCount}
                      onClick={() => setPageIndex((p) => p + 1)}
                    >
                      다음
                    </Button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        {selected ? (
          <SkuStockCard
            key={selected.id}
            skuId={selected.id}
            item={selected}
            labelOpen={labelOpen}
            onToggleLabel={() => setLabelOpen((open) => !open)}
          />
        ) : hasQuery && items.length > 0 ? (
          <aside className="flex items-center justify-center rounded-xl border border-dashed border-[#e4e4e7] bg-white p-[30px] text-center text-[13px] text-[#71717a]">
            목록에서 상품을 고르면 위치와 수량을 보여 드려요.
          </aside>
        ) : null}
      </div>
    </div>
  );
}
