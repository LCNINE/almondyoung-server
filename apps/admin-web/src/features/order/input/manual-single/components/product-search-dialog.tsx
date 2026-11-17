'use client';

import { useEffect, useState, type PropsWithChildren } from 'react';
import { useDebounced } from '@/hooks/use-debounced';
import {
  useMastersSummary,
  useVariantRowsByMaster,
  useVariantsBatch,
} from '@/lib/services/products';
import type { MasterSummaryDto } from '@/lib/types/dto/products';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/** 상품검색 창이 한 번에 받는 건수. */
const SEARCH_LIMIT = 20;
/** 미리보기에 다 담기지 않은 옵션을 펼칠 때 받는 건수. */
const ALL_OPTIONS_LIMIT = 100;

/** 주문 줄은 판매상품 옵션 기준이다 — 재고상품(SKU)만으로는 주문을 저장할 수 없다. */
export type ProductSearchPick = {
  masterId: string;
  variantId: string;
  name: string;
  optionText: string;
  /** 가격 캐시가 없는 옵션은 null — 단가는 작업자가 입력한다. */
  price: number | null;
};

type OptionChoice = {
  variantId: string;
  name: string;
  price: number | null;
  status: string;
};

const won = (v: number) => `${v.toLocaleString('ko-KR')}원`;

export function ProductSearchDialog({
  onPick,
}: {
  onPick: (pick: ProductSearchPick) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  // 검색은 서버가 한다. 한 쪽(SEARCH_LIMIT)만 받고, 옵션은 요약 응답의 미리보기를 쓴다.
  const keyword = useDebounced(q.trim());
  const masters = useMastersSummary({
    q: keyword || undefined,
    page: 1,
    limit: SEARCH_LIMIT,
  });

  const pick = (p: ProductSearchPick) => {
    onPick(p);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">상품명 검색</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>상품검색</DialogTitle>
        </DialogHeader>

        <div className="my-3 flex gap-2">
          <Input
            placeholder="상품명/코드 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="max-h-[60vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>상품명 · 옵션 선택</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {masters.isError ? (
                <MessageRow colSpan={1}>
                  상품 목록을 불러오지 못했습니다. 입력한 주문 내용은 그대로
                  있습니다.{' '}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => masters.refetch()}
                  >
                    다시 시도
                  </Button>
                </MessageRow>
              ) : masters.isPending ? (
                <MessageRow colSpan={1}>상품을 불러오는 중...</MessageRow>
              ) : (masters.data?.data.length ?? 0) === 0 ? (
                <MessageRow colSpan={1}>
                  {keyword
                    ? `'${keyword}'에 맞는 판매상품이 없습니다.`
                    : '판매상품이 없습니다.'}
                </MessageRow>
              ) : (
                masters.data?.data.map((m) => (
                  <MasterRow
                    key={m.masterId}
                    master={m}
                    onChoose={(o) =>
                      pick({
                        masterId: m.masterId,
                        variantId: o.variantId,
                        name: m.name,
                        optionText: o.name,
                        price: o.price,
                      })
                    }
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MessageRow({
  colSpan,
  children,
}: PropsWithChildren<{ colSpan: number }>) {
  return (
    <TableRow>
      <TableCell
        colSpan={colSpan}
        className="py-6 text-center text-muted-foreground"
      >
        {children}
      </TableCell>
    </TableRow>
  );
}

function MasterRow({
  master,
  onChoose,
}: {
  master: MasterSummaryDto;
  onChoose: (option: OptionChoice) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const previews: OptionChoice[] = master.variantPreviews.map((v) => ({
    variantId: v.variantId,
    name: v.name,
    price: v.basePrice,
    status: v.status,
  }));
  // 미리보기는 상품당 상한이 있다. 넘는 상품만, 펼칠 때 한 번 더 부른다.
  const hasMore = master.variantCount > previews.length;

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{master.name}</div>
        <div className="text-xs text-muted-foreground">
          {master.productCode ? `${master.productCode} · ` : ''}
          {master.variantCount}개 옵션
        </div>
        {showAll ? (
          <AllOptions
            masterId={master.masterId}
            variantCount={master.variantCount}
            previews={previews}
            onChoose={onChoose}
          />
        ) : (
          <OptionButtons options={previews} onChoose={onChoose} />
        )}
        {hasMore && !showAll ? (
          <Button
            variant="link"
            size="sm"
            className="mt-1 h-auto px-0"
            onClick={() => setShowAll(true)}
          >
            옵션 {master.variantCount}개 모두 보기
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

function AllOptions({
  masterId,
  variantCount,
  previews,
  onChoose,
}: {
  masterId: string;
  /** 응답 전에 쓰는 요약의 옵션 수. 응답이 오면 그 total 을 따른다. */
  variantCount: number;
  previews: OptionChoice[];
  onChoose: (option: OptionChoice) => void;
}) {
  const [page, setPage] = useState(1);
  const variants = useVariantRowsByMaster(masterId, {
    page,
    limit: ALL_OPTIONS_LIMIT,
  });
  const rows = variants.data?.data ?? [];
  const known = new Map(previews.map((p) => [p.variantId, p]));
  // 이 목록은 수동 이름만 준다. 이름이 비고 미리보기에도 없는 옵션만 옵션값 표시명을 따로 받는다.
  const unnamedIds = rows
    .filter((v) => !v.variantName && !known.has(v.id))
    .map((v) => v.id);
  const labels = useVariantsBatch(unnamedIds);
  const needsLabels = unnamedIds.length > 0;
  // 다음 페이지를 받는 동안에도 마지막으로 받은 total 을 쓴다. 요약 수는 첫 응답 전에만 쓴다.
  const apiTotal = variants.data?.total;
  const [lastTotal, setLastTotal] = useState<number>();
  useEffect(() => {
    if (apiTotal !== undefined) setLastTotal(apiTotal);
  }, [apiTotal]);
  const total = apiTotal ?? lastTotal ?? variantCount;

  // 펼친 사이 옵션이 줄면 지금 페이지가 범위를 벗어날 수 있다. 응답으로 확인했을 때만 되돌린다.
  useEffect(() => {
    if (apiTotal === undefined) return;
    const lastPage = Math.max(1, Math.ceil(apiTotal / ALL_OPTIONS_LIMIT));
    if (page > lastPage) setPage(lastPage);
  }, [apiTotal, page]);

  const options: OptionChoice[] = rows.map((v) => {
    const preview = known.get(v.id);
    return {
      variantId: v.id,
      name:
        preview?.name ||
        v.variantName ||
        labels.data?.get(v.id)?.optionLabel ||
        '',
      // 이 목록의 price 는 가격이 없을 때도 0 이라 미리보기 가격을 먼저 쓰고, 0 은 «가격 없음»으로 둔다.
      price: preview
        ? preview.price
        : typeof v.price === 'number' && v.price > 0
          ? v.price
          : null,
      status: v.status ?? 'active',
    };
  });
  const from = (page - 1) * ALL_OPTIONS_LIMIT + 1;
  const to = Math.min(page * ALL_OPTIONS_LIMIT, total);

  return (
    <>
      {variants.isError ? (
        <Notice onRetry={() => variants.refetch()}>
          옵션을 불러오지 못했습니다.
        </Notice>
      ) : variants.isPending ? (
        <Notice>옵션 불러오는 중...</Notice>
      ) : needsLabels && labels.isError ? (
        // 이름을 모르는 옵션을 고르면 주문에 빈 옵션명이 남는다. 이름을 받기 전에는 고르지 못하게 한다.
        <Notice onRetry={() => labels.refetch()}>
          옵션 이름을 불러오지 못했습니다.
        </Notice>
      ) : needsLabels && labels.isPending ? (
        <Notice>옵션 이름 불러오는 중...</Notice>
      ) : (
        <OptionButtons options={options} onChoose={onChoose} />
      )}
      {total > ALL_OPTIONS_LIMIT ? (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            이전 옵션
          </Button>
          <span>
            {from}–{to} / {total}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={to >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            다음 옵션
          </Button>
        </div>
      ) : null}
    </>
  );
}

function Notice({
  onRetry,
  children,
}: PropsWithChildren<{ onRetry?: () => void }>) {
  return (
    <div className="mt-3 text-xs text-muted-foreground">
      {children}
      {onRetry ? (
        <>
          {' '}
          <Button size="sm" variant="outline" onClick={onRetry}>
            다시 시도
          </Button>
        </>
      ) : null}
    </div>
  );
}

function OptionButtons({
  options,
  onChoose,
}: {
  options: OptionChoice[];
  onChoose: (option: OptionChoice) => void;
}) {
  return (
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
      {options.map((o) => {
        const label = o.name || '이름 없음';
        return (
          <Button
            key={o.variantId}
            variant="secondary"
            size="sm"
            onClick={() => onChoose(o)}
            className="justify-between gap-2"
            title={label}
          >
            <span className="truncate">
              {label}
              {o.status !== 'active' ? ' (판매중지)' : ''}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {o.price == null ? '가격 없음' : won(o.price)}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
