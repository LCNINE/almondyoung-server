'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils/ui';
import type { KeywordIssueFilter, ZeroHitSummary } from '@/lib/api/domains/search';
import { buildKeywordDiagnosis, type DiagnosisSentence } from '../diagnosis';
import { FILTER_LABELS, FILTER_ORDER, formatDays, formatKinds, formatTimes } from '../labels';

/** 숫자를 문장으로 읽어주는 줄 — 이 화면에서 가장 먼저 읽히는 자리다. */
export function DiagnosisLines({
  sentences,
  isLoading,
}: {
  sentences: DiagnosisSentence[];
  isLoading?: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  if (sentences.length === 0) return null;
  return (
    <div className="space-y-1 rounded-lg border border-gray-200 bg-white p-4">
      {sentences.map((sentence) => (
        <p
          key={sentence.id}
          className={cn('text-sm', sentence.tone === 'alert' ? 'font-medium text-red-700' : 'text-gray-700')}
        >
          {sentence.text}
        </p>
      ))}
    </div>
  );
}

/**
 * 경보 1 + 보조 3 의 위계.
 * 네 타일을 똑같이 놓으면 무엇이 경보인지 안 보인다 — 이 화면의 메시지는
 * "0건이 나쁘다"가 아니라 "방치된 0건이 나쁘다"다.
 *
 * 모든 값에 단위(회/종/일)를 붙인다. 단위 없는 숫자가 이 화면 오독의 원인이었다.
 */
export function KeywordOpsHeadline({
  totalSearches,
  zeroResultSearches,
  summary,
  rangeDays,
  isStatisticsLoading,
  isSummaryLoading,
}: {
  totalSearches: number | undefined;
  zeroResultSearches: number | undefined;
  summary: ZeroHitSummary | undefined;
  rangeDays: number;
  isStatisticsLoading?: boolean;
  isSummaryLoading?: boolean;
}) {
  const sentences = buildKeywordDiagnosis({ totalSearches, zeroResultSearches, summary, rangeDays });
  const rate =
    totalSearches != null && zeroResultSearches != null && totalSearches > 0
      ? `${((zeroResultSearches / totalSearches) * 100).toFixed(1)}%`
      : null;
  const neglected = summary?.neglectedOver7Days ?? 0;

  return (
    <div className="space-y-4">
      <DiagnosisLines sentences={sentences} isLoading={isStatisticsLoading && isSummaryLoading} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card
          className={cn(
            'shadow-sm lg:col-span-1',
            neglected > 0 ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white',
          )}
        >
          <CardContent className="p-5">
            <p className={cn('text-xs font-medium', neglected > 0 ? 'text-red-700' : 'text-gray-500')}>
              7일 넘게 방치된 검색어
            </p>
            {isSummaryLoading ? (
              <Skeleton className="mt-1 h-9 w-28" />
            ) : (
              <p
                className={cn(
                  'mt-1 text-3xl font-bold tabular-nums',
                  neglected > 0 ? 'text-red-700' : 'text-gray-900',
                )}
              >
                {formatKinds(summary?.neglectedOver7Days)}
              </p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              {summary
                ? `최장 ${formatDays(summary.maxNeglectDays)} · 미해결 ${formatKinds(summary.zeroKeywordCount)} 중`
                : ' '}
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-2">
          <MiniTile
            label="전체 검색"
            value={formatTimes(totalSearches)}
            hint="고객이 검색창을 쓴 횟수"
            isLoading={isStatisticsLoading}
          />
          <MiniTile
            label="빈손으로 끝난 검색"
            value={formatTimes(zeroResultSearches)}
            hint={rate ? `전체 검색의 ${rate}` : '상품이 하나도 안 나온 검색 횟수'}
            isLoading={isStatisticsLoading}
          />
          <MiniTile
            label="결과를 못 준 검색어"
            value={formatKinds(summary?.zeroKeywordCount)}
            hint={
              summary && summary.resolvedByIndexCount > 0
                ? `저절로 풀린 ${formatKinds(summary.resolvedByIndexCount)} 제외`
                : '서로 다른 검색어 가짓수'
            }
            isLoading={isSummaryLoading}
          />
        </div>
      </div>
    </div>
  );
}

function MiniTile({
  label,
  value,
  hint,
  isLoading,
}: {
  label: string;
  value: string;
  hint: string;
  isLoading?: boolean;
}) {
  return (
    <Card className="border border-gray-200 bg-white shadow-sm">
      <CardContent className="p-4">
        <p className="text-xs font-medium text-gray-500">{label}</p>
        {isLoading ? (
          <Skeleton className="mt-1 h-7 w-20" />
        ) : (
          <p className="mt-1 text-xl font-bold tabular-nums text-gray-900">{value}</p>
        )}
        <p className="mt-1 text-[11px] text-gray-400">{hint}</p>
      </CardContent>
    </Card>
  );
}

/** 방치 일수 분포 — 어디에 몰려 있는지 한눈에. 자동 해소분은 모수에서 빠져 있다. */
export function NeglectDistribution({ summary }: { summary: ZeroHitSummary | undefined }) {
  if (!summary) return null;
  const buckets = [
    { label: '7일 미만', value: summary.neglectBuckets.under7, cls: 'bg-gray-300' },
    { label: '7~13일', value: summary.neglectBuckets.from7to13, cls: 'bg-amber-400' },
    { label: '14~29일', value: summary.neglectBuckets.from14to29, cls: 'bg-orange-500' },
    { label: '30일 이상', value: summary.neglectBuckets.over30, cls: 'bg-red-500' },
  ];
  const total = buckets.reduce((sum, bucket) => sum + bucket.value, 0);
  if (total === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
        {buckets.map((bucket) =>
          bucket.value > 0 ? (
            <div
              key={bucket.label}
              className={bucket.cls}
              style={{ width: `${(bucket.value / total) * 100}%` }}
              title={`${bucket.label} ${formatKinds(bucket.value)}`}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-600">
        {buckets.map((bucket) => (
          <span key={bucket.label} className="inline-flex items-center gap-1">
            <span className={cn('inline-block h-2 w-2 rounded-sm', bucket.cls)} />
            {bucket.label} <span className="tabular-nums font-medium">{formatKinds(bucket.value)}</span>
          </span>
        ))}
      </div>
      <p className="text-[11px] text-gray-400">
        저절로 풀린 검색어는 이 분포에서 빠져 있습니다 · 단위는 검색어 가짓수(종)입니다
      </p>
    </div>
  );
}

/** 상태 필터 칩 — 서버가 필터링하므로 페이지네이션과 어긋나지 않는다. */
export function StatusFilterChips({
  value,
  onChange,
  summary,
}: {
  value: KeywordIssueFilter | undefined;
  onChange: (next: KeywordIssueFilter | undefined) => void;
  summary: ZeroHitSummary | undefined;
}) {
  const countOf = (filter: KeywordIssueFilter): number | undefined => {
    if (!summary) return undefined;
    if (filter === 'open') {
      return summary.zeroKeywordCount - summary.byStatus.resolved - summary.byStatus.ignored;
    }
    return summary.byStatus[filter];
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip label="전체" isActive={value === undefined} onClick={() => onChange(undefined)} />
      {FILTER_ORDER.map((filter) => (
        <Chip
          key={filter}
          label={FILTER_LABELS[filter]}
          count={countOf(filter)}
          isActive={value === filter}
          onClick={() => onChange(filter)}
        />
      ))}
    </div>
  );
}

function Chip({
  label,
  count,
  isActive,
  onClick,
}: {
  label: string;
  count?: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={cn(
        'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
        isActive
          ? 'border-gray-800 bg-gray-800 text-white'
          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300',
      )}
    >
      {label}
      {count != null ? <span className="ml-1 tabular-nums opacity-70">{count.toLocaleString('ko-KR')}</span> : null}
    </button>
  );
}

/** 담당자별 부하 — 누가 몇 종을 맡고 있는지. 미지정은 별도로 앞에 세운다. */
export function AssigneeLoad({ summary }: { summary: ZeroHitSummary | undefined }) {
  if (!summary) return null;
  if (summary.unassignedCount === 0 && summary.byAssignee.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-600">
      <span className="font-medium text-gray-500">담당</span>
      {summary.unassignedCount > 0 ? (
        <span className="inline-flex items-center gap-1 text-amber-700">
          미지정 <span className="font-medium tabular-nums">{formatKinds(summary.unassignedCount)}</span>
        </span>
      ) : null}
      {summary.byAssignee.map((row) => (
        <span key={row.assigneeId} className="inline-flex items-center gap-1">
          {row.assigneeName ?? '이름 없음'}{' '}
          <span className="font-medium tabular-nums">{formatKinds(row.count)}</span>
        </span>
      ))}
    </div>
  );
}
