'use client';

import { useMemo } from 'react';
import { useUpsertKeywordIssue } from '@/lib/services/search';
import { useAdminUsers } from '@/lib/services/users/queries';
import type { KeywordIssueStatus, ZeroHitKeywordRow } from '@/lib/api/domains/search';
import { KEYWORD_ISSUE_STATUSES } from '@/lib/api/domains/search';
import { STATUS_LABELS } from '../labels';
import { IndexEvidence, NeglectBadge } from './badges';

export interface AssigneeOption {
  value: string;
  name: string;
  label: string;
}

/** 담당자 후보를 한 번만 불러 표 전체가 나눠 쓴다 — 행마다 부르면 요청이 행 수만큼 나간다. */
export function useAssigneeOptions(): AssigneeOption[] {
  const { data } = useAdminUsers({ roleName: 'admin,master', limit: 100 });
  return useMemo(
    () =>
      (data?.data ?? []).map((user) => ({
        value: user.id,
        name: user.username,
        label: `${user.username} (${user.loginId})`,
      })),
    [data?.data],
  );
}

/**
 * 0건 검색어 운영 표 — 통계 키워드 탭과 어드민 메인의 소싱 후보 탭이 함께 쓴다.
 * 한쪽만 고치면 두 화면이 갈라지므로 표·배지·인라인 셀렉트를 여기 한 곳에 둔다.
 *
 * `columns` 로 메인처럼 좁은 자리에서는 메모 열을 뺄 수 있게 해 두었다. 나중에 근거 컬럼이
 * 늘어나도 이 목록만 손보면 된다.
 */
export function ZeroHitTable({
  rows,
  startNumber = 1,
  assigneeOptions,
  onSelectKeyword,
  showMemo = true,
  emptyText = '표시할 검색어가 없습니다',
}: {
  rows: ZeroHitKeywordRow[];
  startNumber?: number;
  assigneeOptions: AssigneeOption[];
  onSelectKeyword?: (keyword: string) => void;
  showMemo?: boolean;
  emptyText?: string;
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-xs text-gray-400">{emptyText}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-gray-500">
            <th className="py-1.5 text-left">#</th>
            <th className="py-1.5 text-left">검색어</th>
            <th className="py-1.5 text-left">방치</th>
            <th className="py-1.5 text-right">빈손 검색</th>
            <th className="py-1.5 pl-4 text-left">색인을 다시 뒤져보면</th>
            <th className="py-1.5 text-left">상태</th>
            <th className="py-1.5 text-left">담당자</th>
            {showMemo ? <th className="py-1.5 text-left">메모</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <ZeroHitRow
              key={row.keywordNorm}
              row={row}
              rowNumber={startNumber + index}
              assigneeOptions={assigneeOptions}
              onSelect={onSelectKeyword ? () => onSelectKeyword(row.keyword) : undefined}
              showMemo={showMemo}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ZeroHitRow({
  row,
  rowNumber,
  assigneeOptions,
  onSelect,
  showMemo,
}: {
  row: ZeroHitKeywordRow;
  rowNumber: number;
  assigneeOptions: AssigneeOption[];
  onSelect?: () => void;
  showMemo: boolean;
}) {
  const upsert = useUpsertKeywordIssue();

  // 바꾼 필드만 보낸다 — 서버 upsert 는 미전달 필드(담당·메모)를 그대로 보존한다.
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
    <tr className="border-b last:border-0 align-top">
      <td className="py-1.5 text-gray-400">{rowNumber}</td>
      <td className="py-1.5">
        {onSelect ? (
          <button type="button" onClick={onSelect} className="font-medium text-gray-900 hover:underline">
            {row.keyword}
          </button>
        ) : (
          <span className="font-medium text-gray-900">{row.keyword}</span>
        )}
      </td>
      <td className="py-1.5">
        <NeglectBadge days={row.neglectDays} resolved={row.resolvedByIndex} />
      </td>
      <td className="py-1.5 text-right tabular-nums">{row.zeroCount.toLocaleString('ko-KR')}회</td>
      <td className="py-1.5 pl-4 text-[11px]">
        <IndexEvidence
          matchedProductsCount={row.matchedProductsCount}
          matchedProductNames={row.matchedProductNames}
          similarProductNames={row.similarProductNames}
          correctedQuery={row.correctedQuery}
        />
      </td>
      <td className="py-1.5">
        <select
          aria-label={`${row.keyword} 처리 상태`}
          value={row.issue?.status ?? 'new'}
          onChange={(event) => changeStatus(event.target.value as KeywordIssueStatus)}
          disabled={upsert.isPending}
          className="rounded border border-gray-200 bg-white px-1.5 py-1 text-[11px] disabled:opacity-40"
        >
          {KEYWORD_ISSUE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </td>
      <td className="py-1.5">
        <select
          aria-label={`${row.keyword} 담당자`}
          value={row.issue?.assigneeId ?? ''}
          onChange={(event) => changeAssignee(event.target.value)}
          disabled={upsert.isPending}
          className="min-w-28 rounded border border-gray-200 bg-white px-1.5 py-1 text-[11px] disabled:opacity-40"
        >
          <option value="">미지정</option>
          {assigneeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </td>
      {showMemo ? (
        <td className="max-w-48 truncate py-1.5 text-gray-500" title={row.issue?.memo ?? undefined}>
          {row.issue?.memo ?? ''}
        </td>
      ) : null}
    </tr>
  );
}
