'use client';

import { useMemo, useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePurchaseSatisfactions } from '@/lib/services/purchase-satisfaction';
import type {
  PurchaseSatisfactionListQuery,
  PurchaseSatisfactionReason,
  PurchaseSatisfactionScoreFilter,
} from '@/lib/types/dto/purchase-satisfaction';
import { DetailPanel } from '../components/detail-panel';
import { DistributionBars, KpiRow, ReasonBars } from '../components/summary-panels';
import { Stars } from '../components/stars';
import { PERIOD_OPTIONS, formatKstTime, periodRange, type SatisfactionPeriod } from '../period';
import { PURCHASE_SATISFACTION_REASON_LABELS } from '../reason-labels';

const PAGE_SIZE = 20;

const SCORE_OPTIONS: { value: PurchaseSatisfactionScoreFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'low', label: '3점 이하' },
  { value: 'high', label: '4점 이상' },
];

export default function PurchaseSatisfactionTemplate() {
  const [period, setPeriod] = useState<SatisfactionPeriod>('month');
  const [score, setScore] = useState<PurchaseSatisfactionScoreFilter>('low');
  const [reason, setReason] = useState<PurchaseSatisfactionReason | undefined>();
  const [hasMemo, setHasMemo] = useState(false);
  const [unchecked, setUnchecked] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query = useMemo<PurchaseSatisfactionListQuery>(
    () => ({
      ...periodRange(period),
      score,
      reason,
      hasMemo: hasMemo || undefined,
      unchecked: unchecked || undefined,
      page,
      limit: PAGE_SIZE,
    }),
    [period, score, reason, hasMemo, unchecked, page]
  );
  const { data, isLoading, isError } = usePurchaseSatisfactions(query);

  const change = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  const selected = data?.data.find((row) => row.id === selectedId) ?? null;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <Container>
      <Header
        title="구매 만족도"
        right={
          <div className="flex gap-1">
            {PERIOD_OPTIONS.map((option) => (
              <Button
                key={option.value}
                size="sm"
                variant={period === option.value ? 'default' : 'outline'}
                aria-pressed={period === option.value}
                onClick={() => change(setPeriod)(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        }
      />
      <div className="flex flex-col gap-4 px-4 pb-6">
        {isError && <p className="text-sm text-destructive">만족도를 불러오지 못했어요.</p>}
        {data && (
          <>
            <KpiRow
              summary={data.summary}
              uncheckedActive={score === 'low' && unchecked}
              onUncheckedLow={() => {
                setScore('low');
                setUnchecked(true);
                setPage(1);
              }}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <DistributionBars summary={data.summary} />
              <ReasonBars summary={data.summary} selected={reason} onSelect={change(setReason)} />
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {SCORE_OPTIONS.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={score === option.value ? 'default' : 'outline'}
              aria-pressed={score === option.value}
              onClick={() => change(setScore)(option.value)}
            >
              {option.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant={hasMemo ? 'default' : 'outline'}
            aria-pressed={hasMemo}
            onClick={() => change(setHasMemo)(!hasMemo)}
          >
            메모 있음
          </Button>
          <Button
            size="sm"
            variant={unchecked ? 'default' : 'outline'}
            aria-pressed={unchecked}
            onClick={() => change(setUnchecked)(!unchecked)}
          >
            확인 안 한 것만
          </Button>
        </div>

        <div className={selected ? 'grid gap-3 lg:grid-cols-[1fr_360px]' : ''}>
          <div className="flex flex-col gap-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>응답 시각</TableHead>
                  <TableHead>주문번호</TableHead>
                  <TableHead>별점</TableHead>
                  <TableHead>사유</TableHead>
                  <TableHead>메모</TableHead>
                  <TableHead>확인</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.data.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.id === selectedId ? 'selected' : undefined}
                    className="cursor-pointer"
                    onClick={() => setSelectedId(row.id)}
                  >
                    <TableCell className="whitespace-nowrap">{formatKstTime(row.updatedAt)}</TableCell>
                    <TableCell>
                      <button
                        type="button"
                        aria-pressed={row.id === selectedId}
                        aria-label={`주문 #${row.orderDisplayId} 응답 상세 열기`}
                        className="rounded underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(row.id);
                        }}
                      >
                        #{row.orderDisplayId}
                      </button>
                    </TableCell>
                    <TableCell>
                      <Stars rating={row.rating} />
                    </TableCell>
                    <TableCell>{row.reasons.map((r) => PURCHASE_SATISFACTION_REASON_LABELS[r]).join(', ') || '-'}</TableCell>
                    <TableCell className="max-w-[240px] truncate">{row.memo ?? '-'}</TableCell>
                    <TableCell>{row.rating > 3 ? '-' : row.checkedAt ? '확인함' : '확인 전'}</TableCell>
                  </TableRow>
                ))}
                {data && data.data.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      조건에 맞는 응답이 없어요.
                    </TableCell>
                  </TableRow>
                )}
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      불러오는 중이에요.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                이전
              </Button>
              <span className="text-sm tabular-nums">
                {page} / {totalPages}
              </span>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                다음
              </Button>
            </div>
          </div>
          {selected && <DetailPanel item={selected} onClose={() => setSelectedId(null)} />}
        </div>
      </div>
    </Container>
  );
}
