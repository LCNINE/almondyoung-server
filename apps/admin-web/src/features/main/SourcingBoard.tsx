'use client';

import { useAssigneeOptions } from '@/features/keyword-ops/components/ZeroHitTable';
import { STATUS_LABELS } from '@/features/keyword-ops/labels';
import { BoardHeader } from '@/features/main/BoardHeader';
import { SkeletonRows } from '@/features/main/DailyBoards';
import { Skeleton } from '@/components/ui/skeleton';
import type { KeywordIssueStatus, ZeroHitKeywordRow } from '@/lib/api/domains/search';
import { KEYWORD_ISSUE_STATUSES } from '@/lib/api/domains/search';
import { useUpsertKeywordIssue, useZeroHitKeywords } from '@/lib/services/search';
import { cn } from '@/lib/utils/ui';

const ROWS = 10;
const SELECT_CLASS =
  'h-7 cursor-pointer rounded border border-[#BDBDBD] bg-white px-2 text-[13px] text-[#2B2B2B] disabled:cursor-default disabled:opacity-40';

export function SourcingBoard({ range, rangeDays }: { range: { from: string; to: string }; rangeDays: number }) {
  const zeroHit = useZeroHitKeywords({ from: range.from, to: range.to, page: 1, limit: ROWS, status: 'open' });
  const assigneeOptions = useAssigneeOptions();

  if (zeroHit.isError) {
    return <p className="py-6 text-center text-xs text-[#D71952]">0건 검색어를 불러오지 못했습니다.</p>;
  }

  const summary = zeroHit.data?.summary;
  const rows = zeroHit.data?.items ?? [];
  const count = (value: number | undefined) => (summary ? (value ?? 0) : null);
  const openCount = summary ? summary.zeroKeywordCount - summary.byStatus.resolved - summary.byStatus.ignored : null;
  const inProgressCount = summary ? summary.byStatus.dev + summary.byStatus.md + summary.byStatus.in_progress : null;

  return (
    <div className="space-y-3">
      <BoardHeader
        label={`최근 ${rangeDays}일`}
        help={[
          '고객이 검색했는데 결과가 0건이었던 검색어 중 아직 처리하지 않은 것만 보여줍니다.',
          '해소·무시로 바꾼 검색어는 목록과 처리 대기 수에서 빠집니다.',
          '처리 중은 상태가 개발팀·MD팀·처리중인 검색어를 합친 수입니다.',
          '자동 해소는 0건이었다가 이후 검색에서 결과가 나오기 시작한 검색어입니다. 찾던 상품이 맞는지는 따로 확인해야 합니다.',
          '방치 일수는 마지막으로 결과가 나온 날(없으면 처음 0건이 된 날)부터 오늘까지입니다.',
          `방치가 오래된 순으로 ${ROWS}개까지 보여주고, 나머지는 전체 보기에서 볼 수 있습니다.`,
          '결과 없음은 기간 동안 그 검색어로 검색해 상품이 하나도 안 나온 횟수입니다.',
          '상태와 담당자는 여기서 바로 바꿀 수 있습니다.',
        ]}
        href="/statistics/keywords"
        linkLabel={
          openCount != null && openCount > ROWS ? `전체 ${openCount.toLocaleString('ko-KR')}종 보기` : '전체 보기'
        }
      />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatTile label="처리 대기" value={openCount} tone="blue" isLoading={zeroHit.isLoading} />
        <StatTile
          label="7일 이상 방치"
          value={count(summary?.openNeglectedOver7Days)}
          tone="red"
          isLoading={zeroHit.isLoading}
        />
        <StatTile label="처리 중" value={inProgressCount} tone="blue" isLoading={zeroHit.isLoading} />
        <StatTile
          label="자동 해소"
          value={count(summary?.resolvedByIndexCount)}
          tone="blue"
          isLoading={zeroHit.isLoading}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#CCCCCC] bg-[#FAFAFA] text-[#616161]">
              <th className="h-[41px] px-3 text-left font-medium">검색어</th>
              <th className="h-[41px] px-3 text-right font-medium">결과 없음</th>
              <th className="h-[41px] px-3 text-right font-medium">방치 기간</th>
              <th className="h-[41px] px-3 text-left font-medium">상품 대조</th>
              <th className="h-[41px] px-3 text-left font-medium">상태</th>
              <th className="h-[41px] px-3 text-left font-medium">담당자</th>
            </tr>
          </thead>
          <tbody>
            {zeroHit.isLoading ? <SkeletonRows rows={ROWS} cols={5} /> : null}
            {!zeroHit.isLoading && rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-[#9E9E9E]">
                  처리를 기다리는 0건 검색어가 없습니다
                </td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <SourcingRow key={row.keywordNorm} row={row} assigneeOptions={assigneeOptions} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SourcingRow({
  row,
  assigneeOptions,
}: {
  row: ZeroHitKeywordRow;
  assigneeOptions: ReturnType<typeof useAssigneeOptions>;
}) {
  const upsert = useUpsertKeywordIssue();

  const changeStatus = (status: KeywordIssueStatus) => {
    upsert.mutate({ keywordNorm: row.keywordNorm, keyword: row.keyword, status });
  };
  const changeAssignee = (assigneeId: string) => {
    const selected = assigneeOptions.find((option) => option.value === assigneeId);
    upsert.mutate({
      keywordNorm: row.keywordNorm,
      keyword: row.keyword,
      assigneeId: assigneeId || null,
      assigneeName: selected ? selected.name : null,
    });
  };

  return (
    <tr className="border-b border-[#EBEBEB]">
      <td className="px-3 py-2 text-sm font-medium text-[#1C1C1C]">{row.keyword}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right text-sm tabular-nums">
        <span className="font-bold text-[#2B2B2B]">{row.zeroCount.toLocaleString('ko-KR')}</span>
        <span className="ml-0.5 text-[#757575]">회</span>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right text-sm tabular-nums">
        {row.resolvedByIndex ? (
          <span className="text-[#1779BA]">풀림</span>
        ) : (
          <span className={cn('font-bold', neglectColor(row.neglectDays))}>{row.neglectDays}일</span>
        )}
      </td>
      <td className="max-w-64 truncate px-3 py-2 text-[#616161]" title={evidenceTitle(row)}>
        {evidenceText(row)}
      </td>
      <td className="px-3 py-2">
        <select
          aria-label={`${row.keyword} 처리 상태`}
          value={row.issue?.status ?? 'new'}
          onChange={(event) => changeStatus(event.target.value as KeywordIssueStatus)}
          disabled={upsert.isPending}
          className={SELECT_CLASS}
        >
          {KEYWORD_ISSUE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <select
          aria-label={`${row.keyword} 담당자`}
          value={row.issue?.assigneeId ?? ''}
          onChange={(event) => changeAssignee(event.target.value)}
          disabled={upsert.isPending}
          className={cn(SELECT_CLASS, 'min-w-32')}
        >
          <option value="">미지정</option>
          {assigneeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.name}
            </option>
          ))}
        </select>
      </td>
    </tr>
  );
}

function neglectColor(days: number) {
  if (days >= 30) return 'text-[#D71952]';
  if (days >= 14) return 'text-[#E8590C]';
  if (days >= 7) return 'text-[#F08C00]';
  return 'text-[#2B2B2B]';
}

function evidenceText(row: ZeroHitKeywordRow) {
  if (row.matchedProductsCount > 0) return `색인에 ${row.matchedProductsCount.toLocaleString('ko-KR')}개 있음`;
  if (row.similarProductNames.length > 0) return `비슷한 상품 ${row.similarProductNames[0]}`;
  if (row.correctedQuery) return `영타 → ${row.correctedQuery}`;
  return '일치 상품 없음';
}

function evidenceTitle(row: ZeroHitKeywordRow) {
  return [...row.matchedProductNames, ...row.similarProductNames].join(' · ') || undefined;
}

function StatTile({
  label,
  value,
  tone,
  isLoading,
}: {
  label: string;
  value: number | null;
  tone: 'blue' | 'red';
  isLoading: boolean;
}) {
  const active = value != null && value > 0;
  return (
    <div className="flex h-12 items-center justify-between gap-2 rounded-lg bg-[#FAFAFA] px-4">
      <span className="truncate text-sm font-medium text-[#1C1C1C]">{label}</span>
      {isLoading ? (
        <Skeleton className="h-5 w-10" />
      ) : value == null ? (
        <span className="text-xs text-gray-400">불러오지 못함</span>
      ) : (
        <span className="shrink-0 whitespace-nowrap text-sm tabular-nums">
          <span
            className={cn(
              'font-bold',
              !active ? 'text-[#9E9E9E]' : tone === 'red' ? 'text-[#D71952]' : 'text-[#1779BA]',
            )}
          >
            {value.toLocaleString('ko-KR')}
          </span>
          <span className="ml-0.5 text-[#757575]">종</span>
        </span>
      )}
    </div>
  );
}
