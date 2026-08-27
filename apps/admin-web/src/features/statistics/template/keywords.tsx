'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  KeywordAutoCause,
  KeywordDetail,
  KeywordIssueStatus,
  ZeroHitKeywordRow,
} from '@/lib/api/domains/search';
import {
  useKeywordDetail,
  useKeywordStatistics,
  useUpsertKeywordIssue,
  useZeroHitKeywords,
} from '@/lib/services/search';
import { useAdminUsers } from '@/lib/services/users/queries';
import { cn } from '@/lib/utils/ui';
import { PaginationBar } from '../components/pagination';
import { StatisticsShell } from '../components/shell';
import { ChartCard, KpiTile } from '../components/widgets';
import { changeRate, formatCount, formatPercent, SERIES_COLORS, useStatisticsRange } from '../shared';

// 인기 검색어는 서버 terms 집계(근사) 상한 100 까지 받아 화면에서 페이지네이션한다.
const TOP_FETCH_LIMIT = 100;
const TOP_PAGE_SIZE = 20;
const ZERO_PAGE_SIZE = 20;

const STATUS_LABELS: Record<KeywordIssueStatus, string> = {
  new: '신규',
  dev: '개발팀',
  md: 'MD팀',
  in_progress: '처리중',
  resolved: '해소',
  ignored: '무시',
};

const CAUSE_LABELS: Record<KeywordAutoCause, string> = {
  engine: '검색엔진(개발)',
  sourcing: '소싱 부재(MD)',
  unclassified: '미분류',
};

function causeBadgeClass(cause: KeywordAutoCause): string {
  if (cause === 'engine') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (cause === 'sourcing') return 'bg-purple-50 text-purple-700 border-purple-200';
  return 'bg-gray-50 text-gray-500 border-gray-200';
}

/** "N일 지연" 배지 — 방치가 길수록 진한 경고색 */
function NeglectBadge({ days, resolved }: { days: number; resolved: boolean }) {
  if (resolved) {
    return (
      <span className="inline-block rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">
        해소됨
      </span>
    );
  }
  const cls =
    days >= 30
      ? 'border-red-200 bg-red-50 text-red-700'
      : days >= 7
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-gray-200 bg-gray-50 text-gray-600';
  return (
    <span className={cn('inline-block rounded border px-1.5 py-0.5 text-[11px] font-medium tabular-nums', cls)}>
      {days}일 지연
    </span>
  );
}

export default function KeywordStatisticsTemplate() {
  const range = useStatisticsRange();
  const [topPage, setTopPage] = useState(1);
  const [zeroPage, setZeroPage] = useState(1);
  const [keywordInput, setKeywordInput] = useState('');
  const [selectedKeyword, setSelectedKeyword] = useState('');

  // 조회 조건이 바뀌면 페이지가 범위를 벗어날 수 있다 — 1페이지로 되돌린다
  useEffect(() => {
    setTopPage(1);
    setZeroPage(1);
  }, [range.from, range.to]);

  const { data, isLoading, isError } = useKeywordStatistics({
    from: range.from,
    to: range.to,
    limit: TOP_FETCH_LIMIT,
  });
  const zeroHit = useZeroHitKeywords({ from: range.from, to: range.to, page: zeroPage, limit: ZERO_PAGE_SIZE });
  const detail = useKeywordDetail({ keyword: selectedKeyword, from: range.from, to: range.to }, Boolean(selectedKeyword));

  const zeroRate = data && data.totalSearches > 0 ? data.zeroResultSearches / data.totalSearches : null;
  const topRows = (data?.top ?? []).slice((topPage - 1) * TOP_PAGE_SIZE, topPage * TOP_PAGE_SIZE);
  const summary = zeroHit.data?.summary;

  const lookupKeyword = (keyword: string) => {
    setKeywordInput(keyword);
    setSelectedKeyword(keyword);
  };

  return (
    <StatisticsShell filterOptions={{ channel: false, granularity: false }}>
      {isError ? (
        <p className="py-10 text-center text-sm text-red-500">
          통계를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <KpiTile label="총 검색 수" value={formatCount(data?.totalSearches)} isLoading={isLoading} />
            <KpiTile
              label="결과 0건 검색 수"
              value={formatCount(data?.zeroResultSearches)}
              hint={`결과 0건 비율 ${formatPercent(zeroRate)}`}
              isLoading={isLoading}
            />
            <KpiTile
              label="7일 이상 방치"
              value={`${formatCount(summary?.neglectedOver7Days)}건`}
              hint="0건인데 결과가 나오기 시작하지 않은 검색어"
              isLoading={zeroHit.isLoading}
            />
            <KpiTile
              label="최장 방치"
              value={summary ? `${formatCount(summary.maxNeglectDays)}일` : '—'}
              hint={`0건 검색어 ${formatCount(summary?.zeroKeywordCount)}개 중 최장`}
              isLoading={zeroHit.isLoading}
            />
          </div>

          <ChartCard
            title="키워드 조회"
            description="특정 검색어의 기간 내 검색량·0건 여부·방치 상태를 조회하고 담당자·메모를 관리합니다. 아래 표의 검색어를 클릭해도 열립니다."
            isLoading={false}
            isEmpty={false}
          >
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setSelectedKeyword(keywordInput.trim());
              }}
            >
              <input
                type="text"
                value={keywordInput}
                onChange={(event) => setKeywordInput(event.target.value)}
                placeholder="검색어 입력 (예: 경이로운)"
                className="w-64 rounded border border-gray-200 px-3 py-1.5 text-xs"
              />
              <button
                type="submit"
                disabled={!keywordInput.trim()}
                className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                조회
              </button>
              {selectedKeyword ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedKeyword('');
                    setKeywordInput('');
                  }}
                  className="rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-600"
                >
                  닫기
                </button>
              ) : null}
            </form>
            {selectedKeyword ? (
              detail.isLoading ? (
                <p className="py-6 text-center text-xs text-gray-400">조회 중…</p>
              ) : detail.isError ? (
                <p className="py-6 text-center text-xs text-red-500">키워드 조회에 실패했습니다.</p>
              ) : detail.data ? (
                <KeywordDetailPanel detail={detail.data} />
              ) : null
            ) : null}
          </ChartCard>

          <ChartCard
            title="검색량 추이"
            description="상품 검색 1페이지 요청 기준 · 자동완성과 2페이지 이후는 집계되지 않습니다."
            isLoading={isLoading}
            isEmpty={!data || data.series.length === 0}
          >
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={data?.series ?? []} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#999" />
                <YAxis tick={{ fontSize: 11 }} stroke="#999" allowDecimals={false} />
                <Tooltip formatter={(value: number) => formatCount(value)} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="count"
                  name="검색 수"
                  stroke={SERIES_COLORS[0]}
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="zeroCount"
                  name="결과 0건"
                  stroke={SERIES_COLORS[1]}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="결과 0건 검색어 운영"
            description="찾는 사람은 있는데 결과가 없던 키워드입니다. 지연 배지는 마지막으로 결과가 있었던 날(없으면 최초 0건일)부터의 일수 — 검색엔진 문제는 개발팀, 소싱 부재는 MD팀이 해결하도록 담당을 지정하세요. 검색어를 클릭하면 상세·담당·메모 편집이 열립니다."
            isLoading={zeroHit.isLoading}
            isEmpty={!zeroHit.data || zeroHit.data.totalItems === 0}
            emptyText="조회 기간에 결과 0건 검색이 없습니다"
          >
            {zeroHit.isError ? (
              <p className="py-6 text-center text-xs text-red-500">0건 검색어 목록을 불러오지 못했습니다.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-gray-500">
                        <th className="py-1.5 text-left">#</th>
                        <th className="py-1.5 text-left">검색어</th>
                        <th className="py-1.5 text-left">지연</th>
                        <th className="py-1.5 text-right">0건 검색</th>
                        <th className="py-1.5 text-left pl-4">자동 분류</th>
                        <th className="py-1.5 text-left">상태</th>
                        <th className="py-1.5 text-left">담당자</th>
                        <th className="py-1.5 text-left">메모</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(zeroHit.data?.items ?? []).map((row, index) => (
                        <ZeroHitRow
                          key={row.keywordNorm}
                          row={row}
                          rowNumber={(zeroPage - 1) * ZERO_PAGE_SIZE + index + 1}
                          onSelect={() => lookupKeyword(row.keyword)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                <PaginationBar
                  totalItems={zeroHit.data?.totalItems}
                  page={zeroPage}
                  pageSize={ZERO_PAGE_SIZE}
                  onPageChange={setZeroPage}
                  unitLabel="개 검색어"
                />
              </>
            )}
          </ChartCard>

          <ChartCard
            title="인기 검색어"
            description="증감은 직전 동일 길이 기간의 검색 수 대비입니다 · 서버 집계 상한 상위 100개까지."
            isLoading={isLoading}
            isEmpty={!data || data.top.length === 0}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="py-1.5 text-left">#</th>
                    <th className="py-1.5 text-left">검색어</th>
                    <th className="py-1.5 text-right">검색 수</th>
                    <th className="py-1.5 text-right">결과 0건</th>
                    <th className="py-1.5 text-right">전기간 대비</th>
                  </tr>
                </thead>
                <tbody>
                  {topRows.map((row, index) => {
                    const rate = changeRate(row.count, row.previousCount);
                    return (
                      <tr key={row.keywordNorm} className="border-b last:border-0">
                        <td className="py-1.5 text-gray-400">{(topPage - 1) * TOP_PAGE_SIZE + index + 1}</td>
                        <td className="py-1.5">
                          <button
                            type="button"
                            onClick={() => lookupKeyword(row.keyword)}
                            className="font-medium text-gray-900 hover:underline"
                          >
                            {row.keyword}
                          </button>
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{formatCount(row.count)}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {row.zeroCount > 0 ? (
                            <span className="text-red-600">{formatCount(row.zeroCount)}</span>
                          ) : (
                            <span className="text-gray-400">0</span>
                          )}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {rate == null ? (
                            <span className="text-gray-400">신규</span>
                          ) : (
                            <span className={rate >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                              {rate >= 0 ? '▲' : '▼'} {formatPercent(Math.abs(rate))}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <PaginationBar
              totalItems={data?.top.length}
              page={topPage}
              pageSize={TOP_PAGE_SIZE}
              onPageChange={setTopPage}
              unitLabel="개 검색어"
            />
          </ChartCard>

          <ChartCard
            title="급상승 검색어"
            description="직전 동일 길이 기간 대비 검색 수가 늘어난 키워드 · 3회 이상 검색된 것만"
            isLoading={isLoading}
            isEmpty={!data || data.rising.length === 0}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="py-1.5 text-left">검색어</th>
                    <th className="py-1.5 text-right">검색 수</th>
                    <th className="py-1.5 text-right">직전 기간</th>
                    <th className="py-1.5 text-right">증가</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.rising ?? []).map((row) => (
                    <tr key={row.keywordNorm} className="border-b last:border-0">
                      <td className="py-1.5">
                        <button
                          type="button"
                          onClick={() => lookupKeyword(row.keyword)}
                          className="font-medium text-gray-900 hover:underline"
                        >
                          {row.keyword}
                        </button>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{formatCount(row.count)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatCount(row.previousCount)}</td>
                      <td className="py-1.5 text-right tabular-nums text-emerald-600">
                        {row.previousCount === 0 ? '신규' : `×${(row.count / row.previousCount).toFixed(1)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </div>
      )}
    </StatisticsShell>
  );
}

function ZeroHitRow({
  row,
  rowNumber,
  onSelect,
}: {
  row: ZeroHitKeywordRow;
  rowNumber: number;
  onSelect: () => void;
}) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-1.5 text-gray-400">{rowNumber}</td>
      <td className="py-1.5">
        <button type="button" onClick={onSelect} className="font-medium text-gray-900 hover:underline">
          {row.keyword}
        </button>
        {row.correctedQuery ? (
          <span className="ml-1 text-[11px] text-gray-400">→ {row.correctedQuery}</span>
        ) : null}
      </td>
      <td className="py-1.5">
        <NeglectBadge days={row.neglectDays} resolved={row.resolvedByIndex} />
      </td>
      <td className="py-1.5 text-right tabular-nums">{formatCount(row.zeroCount)}</td>
      <td className="py-1.5 pl-4">
        <span className={cn('inline-block rounded border px-1.5 py-0.5 text-[11px]', causeBadgeClass(row.autoCause))}>
          {CAUSE_LABELS[row.autoCause]}
        </span>
        {row.matchedProductsCount > 0 ? (
          <span className="ml-1 text-[11px] text-gray-400">색인 {formatCount(row.matchedProductsCount)}개</span>
        ) : null}
      </td>
      <td className="py-1.5">
        {row.issue ? STATUS_LABELS[row.issue.status] : <span className="text-gray-400">신규</span>}
      </td>
      <td className="py-1.5">
        {row.issue?.assigneeName ?? <span className="text-gray-400">미지정</span>}
      </td>
      <td className="max-w-48 truncate py-1.5 text-gray-500" title={row.issue?.memo ?? undefined}>
        {row.issue?.memo ?? ''}
      </td>
    </tr>
  );
}

/** 단건 드릴다운 — 지표 + 미니 추이 + 담당·메모 편집 */
function KeywordDetailPanel({ detail }: { detail: KeywordDetail }) {
  const rate = changeRate(detail.count, detail.previousCount);
  return (
    <div className="mt-4 space-y-4 rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-sm font-semibold text-gray-900">{detail.keyword}</span>
        {detail.neglectDays != null ? <NeglectBadge days={detail.neglectDays} resolved={false} /> : null}
        <span
          className={cn('inline-block rounded border px-1.5 py-0.5 text-[11px]', causeBadgeClass(detail.autoCause))}
        >
          {CAUSE_LABELS[detail.autoCause]}
        </span>
        {detail.correctedQuery ? (
          <span className="text-gray-500">영타 교정: {detail.correctedQuery}</span>
        ) : null}
        {detail.matchedProductsCount > 0 ? (
          <span className="text-gray-500">색인 일치 상품 {formatCount(detail.matchedProductsCount)}개</span>
        ) : null}
      </div>
      {detail.count === 0 ? (
        <p className="text-xs text-gray-500">조회 기간에 이 키워드의 검색 이력이 없습니다.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiTile label="검색 수" value={formatCount(detail.count)} />
            <KpiTile label="결과 0건" value={formatCount(detail.zeroCount)} />
            <KpiTile
              label="전기간 대비"
              value={
                rate == null ? '신규' : `${rate >= 0 ? '▲' : '▼'} ${formatPercent(Math.abs(rate))}`
              }
              hint={`직전 기간 ${formatCount(detail.previousCount)}회`}
            />
            <KpiTile
              label="마지막 결과 있음"
              value={detail.lastPositiveAt ? detail.lastPositiveAt.slice(0, 10) : '없음'}
              hint={detail.firstZeroAt ? `최초 0건 ${detail.firstZeroAt.slice(0, 10)}` : undefined}
            />
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={detail.series} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#999" />
              <YAxis tick={{ fontSize: 11 }} stroke="#999" allowDecimals={false} />
              <Tooltip formatter={(value: number) => formatCount(value)} />
              <Line type="monotone" dataKey="count" name="검색 수" stroke={SERIES_COLORS[0]} strokeWidth={2} dot={false} />
              <Line
                type="monotone"
                dataKey="zeroCount"
                name="결과 0건"
                stroke={SERIES_COLORS[1]}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
      <KeywordIssueEditor detail={detail} />
    </div>
  );
}

/** 담당자·메모·처리 상태 편집 — 저장은 keyword_norm 단위 upsert */
function KeywordIssueEditor({ detail }: { detail: KeywordDetail }) {
  const upsert = useUpsertKeywordIssue();
  const { data: adminUsers } = useAdminUsers({ roleName: 'admin,master', limit: 100 });

  const [status, setStatus] = useState<KeywordIssueStatus>(detail.issue?.status ?? 'new');
  const [assigneeId, setAssigneeId] = useState(detail.issue?.assigneeId ?? '');
  const [memo, setMemo] = useState(detail.issue?.memo ?? '');

  // 다른 키워드를 조회하면 편집 폼을 그 키워드의 저장값으로 리셋한다
  useEffect(() => {
    setStatus(detail.issue?.status ?? 'new');
    setAssigneeId(detail.issue?.assigneeId ?? '');
    setMemo(detail.issue?.memo ?? '');
  }, [detail.keywordNorm, detail.issue]);

  const assigneeOptions = useMemo(
    () =>
      (adminUsers?.data ?? []).map((user) => ({
        value: user.id,
        name: user.username,
        label: `${user.username} (${user.loginId})`,
      })),
    [adminUsers?.data],
  );

  const save = () => {
    const selected = assigneeOptions.find((option) => option.value === assigneeId);
    upsert.mutate({
      keywordNorm: detail.keywordNorm,
      keyword: detail.keyword,
      status,
      assigneeId: assigneeId || null,
      assigneeName: selected ? selected.name : null,
      memo: memo.trim() || null,
    });
  };

  return (
    <div className="space-y-2 border-t border-gray-200 pt-3">
      <p className="text-xs font-medium text-gray-600">운영 상태 — 담당자를 지정하고 메모를 남기세요</p>
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-gray-500">상태</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as KeywordIssueStatus)}
            className="rounded border border-gray-200 bg-white px-2 py-1.5"
          >
            {(Object.keys(STATUS_LABELS) as KeywordIssueStatus[]).map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-gray-500">담당자</span>
          <select
            value={assigneeId}
            onChange={(event) => setAssigneeId(event.target.value)}
            className="min-w-40 rounded border border-gray-200 bg-white px-2 py-1.5"
          >
            <option value="">미지정</option>
            {assigneeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-64 flex-1 flex-col gap-1">
          <span className="text-gray-500">메모 (예: &ldquo;경이로운 = 브랜드명&rdquo;)</span>
          <input
            type="text"
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            maxLength={2000}
            className="rounded border border-gray-200 bg-white px-2 py-1.5"
          />
        </label>
        <button
          type="button"
          onClick={save}
          disabled={upsert.isPending}
          className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
        >
          저장
        </button>
      </div>
      {upsert.isError ? <p className="text-xs text-red-500">저장에 실패했습니다. 다시 시도해주세요.</p> : null}
      {upsert.isSuccess && !upsert.isPending ? <p className="text-xs text-emerald-600">저장했습니다.</p> : null}
      {detail.issue ? (
        <p className="text-[11px] text-gray-400">
          마지막 수정{' '}
          {new Date(detail.issue.updatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
        </p>
      ) : null}
    </div>
  );
}
