'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  KeywordDetail,
  KeywordIssueFilter,
  KeywordIssueStatus,
} from '@/lib/api/domains/search';
import { KEYWORD_ISSUE_STATUSES } from '@/lib/api/domains/search';
import {
  useKeywordDetail,
  useKeywordStatistics,
  useUpsertKeywordIssue,
  useZeroHitKeywords,
} from '@/lib/services/search';
import { useAdminUsers } from '@/lib/services/users/queries';
import { toLocalDateString } from '@/lib/utils/date';
import { IndexEvidence, NeglectBadge } from '@/features/keyword-ops/components/badges';
import {
  AssigneeLoad,
  KeywordOpsHeadline,
  NeglectDistribution,
  StatusFilterChips,
} from '@/features/keyword-ops/components/summary';
import { ZeroHitTable, useAssigneeOptions } from '@/features/keyword-ops/components/ZeroHitTable';
import { buildZeroSearchForecastSentence } from '@/features/keyword-ops/diagnosis';
import { buildKeywordTrendChart } from '@/features/keyword-ops/forecast-chart';
import { STATUS_LABELS, formatTimes } from '@/features/keyword-ops/labels';
import { PaginationBar } from '../components/pagination';
import { StatisticsShell } from '../components/shell';
import { ChartCard, KpiTile } from '../components/widgets';
import { changeRate, formatCount, formatPercent, SERIES_COLORS, useStatisticsRange } from '../shared';

// 인기 검색어는 서버 terms 집계(근사) 상한 100 까지 받아 화면에서 페이지네이션한다.
const TOP_FETCH_LIMIT = 100;
const TOP_PAGE_SIZE = 20;
const ZERO_PAGE_SIZE = 20;

// 예측은 이익 탭과 같은 규칙 — 최근 14일 추세로 7일 앞까지.
const FORECAST_BASIS_DAYS = 14;
const FORECAST_HORIZON_DAYS = 7;

/** 조회 기간 일수 (양끝 포함) — 진단 문장의 "최근 N일" 문구용 */
function rangeDaysOf(from: string, to: string): number {
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  return Math.max(1, days);
}

export default function KeywordStatisticsTemplate() {
  const range = useStatisticsRange();
  const [topPage, setTopPage] = useState(1);
  const [zeroPage, setZeroPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<KeywordIssueFilter | undefined>(undefined);
  const [keywordInput, setKeywordInput] = useState('');
  const [selectedKeyword, setSelectedKeyword] = useState('');

  // 조회 조건이 바뀌면 페이지가 범위를 벗어날 수 있다 — 1페이지로 되돌린다
  useEffect(() => {
    setTopPage(1);
    setZeroPage(1);
  }, [range.from, range.to]);

  useEffect(() => {
    setZeroPage(1);
  }, [statusFilter]);

  const { data, isLoading, isError } = useKeywordStatistics({
    from: range.from,
    to: range.to,
    limit: TOP_FETCH_LIMIT,
  });
  const zeroHit = useZeroHitKeywords({
    from: range.from,
    to: range.to,
    page: zeroPage,
    limit: ZERO_PAGE_SIZE,
    status: statusFilter,
  });
  const detail = useKeywordDetail({ keyword: selectedKeyword, from: range.from, to: range.to }, Boolean(selectedKeyword));
  const assigneeOptions = useAssigneeOptions();

  const topRows = (data?.top ?? []).slice((topPage - 1) * TOP_PAGE_SIZE, topPage * TOP_PAGE_SIZE);
  const summary = zeroHit.data?.summary;
  const rangeDays = rangeDaysOf(range.from, range.to);

  // ─── 빈손 검색 추세 예측 — 추세를 그대로 이은 추정치 (계절성·이벤트 미반영) ───
  const trend = useMemo(
    () =>
      buildKeywordTrendChart(data?.series ?? [], {
        today: toLocalDateString(new Date()),
        basisDays: FORECAST_BASIS_DAYS,
        horizonDays: FORECAST_HORIZON_DAYS,
      }),
    [data?.series],
  );
  const forecastSentence = buildZeroSearchForecastSentence(trend.zero?.total ?? null, FORECAST_HORIZON_DAYS);

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
          <KeywordOpsHeadline
            totalSearches={data?.totalSearches}
            zeroResultSearches={data?.zeroResultSearches}
            summary={summary}
            rangeDays={rangeDays}
            isStatisticsLoading={isLoading}
            isSummaryLoading={zeroHit.isLoading}
          />

          <ChartCard
            title="해야 할 일 — 결과를 못 준 검색어"
            description={
              '찾는 사람은 있는데 상품이 하나도 안 나온 검색어입니다. 방치 배지는 마지막으로 결과가 있었던 날' +
              '(없으면 최초로 0건이 된 날)부터 오늘까지의 일수입니다. 색인을 다시 뒤진 결과는 판단 재료일 뿐 자동 판정이 아닙니다 — ' +
              '검색엔진·노출 문제로 보이면 개발팀, 안 파는 물건이면 MD팀으로 상태를 지정하세요. 검색어를 클릭하면 상세·메모 편집이 열립니다.'
            }
            isLoading={zeroHit.isLoading}
            isEmpty={false}
          >
            {zeroHit.isError ? (
              <p className="py-6 text-center text-xs text-red-500">0건 검색어 목록을 불러오지 못했습니다.</p>
            ) : (
              <div className="space-y-3">
                <NeglectDistribution summary={summary} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <StatusFilterChips value={statusFilter} onChange={setStatusFilter} summary={summary} />
                  <AssigneeLoad summary={summary} />
                </div>
                <ZeroHitTable
                  rows={zeroHit.data?.items ?? []}
                  startNumber={(zeroPage - 1) * ZERO_PAGE_SIZE + 1}
                  assigneeOptions={assigneeOptions}
                  onSelectKeyword={lookupKeyword}
                  emptyText={
                    statusFilter
                      ? '이 상태에 해당하는 검색어가 없습니다'
                      : '조회 기간에 결과를 못 준 검색이 없습니다'
                  }
                />
                <PaginationBar
                  totalItems={zeroHit.data?.totalItems}
                  page={zeroPage}
                  pageSize={ZERO_PAGE_SIZE}
                  onPageChange={setZeroPage}
                  unitLabel="개 검색어"
                />
              </div>
            )}
          </ChartCard>

          <ChartCard
            title="키워드 조회"
            description="특정 검색어의 기간 내 검색량·빈손 여부·방치 상태를 조회하고 담당자·메모를 관리합니다. 위 표의 검색어를 클릭해도 열립니다."
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
            title="검색량 추이와 앞으로 7일"
            description={
              '상품 검색 1페이지 요청 기준 · 자동완성과 2페이지 이후는 집계되지 않습니다. ' +
              '점선과 옅은 띠는 최근 14일 추세를 그대로 이은 추정치이며 계절성·이벤트를 반영하지 않습니다.'
            }
            isLoading={isLoading}
            isEmpty={!data || data.series.length === 0}
          >
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={trend.rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#999" />
                <YAxis tick={{ fontSize: 11 }} stroke="#999" allowDecimals={false} />
                <Tooltip formatter={(value: number) => formatCount(value)} />
                <Legend />
                <Area
                  dataKey="zeroBand"
                  stroke="none"
                  fill={SERIES_COLORS[1]}
                  fillOpacity={0.12}
                  legendType="none"
                  tooltipType="none"
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  name="검색 수(회)"
                  stroke={SERIES_COLORS[0]}
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="zeroCount"
                  name="빈손 검색(회)"
                  stroke={SERIES_COLORS[1]}
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="zeroForecast"
                  name="빈손 검색 추정"
                  stroke={SERIES_COLORS[1]}
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
            {forecastSentence ? (
              <p className="mt-2 text-xs text-gray-600">{forecastSentence}</p>
            ) : (
              <p className="mt-2 text-xs text-gray-400">
                관측일이 3일이 안 돼 추정선을 그리지 않았습니다 — 근거 없는 선은 긋지 않습니다.
              </p>
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
                    <th className="py-1.5 text-right">그중 빈손</th>
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
                        <td className="py-1.5 text-right tabular-nums">{formatTimes(row.count)}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {row.zeroCount > 0 ? (
                            <span className="text-red-600">{formatTimes(row.zeroCount)}</span>
                          ) : (
                            <span className="text-gray-400">0회</span>
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
                      <td className="py-1.5 text-right tabular-nums">{formatTimes(row.count)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatTimes(row.previousCount)}</td>
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

/** 단건 드릴다운 — 지표 + 미니 추이 + 담당·메모 편집 */
function KeywordDetailPanel({ detail }: { detail: KeywordDetail }) {
  const rate = changeRate(detail.count, detail.previousCount);
  return (
    <div className="mt-4 space-y-4 rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-sm font-semibold text-gray-900">{detail.keyword}</span>
        {detail.neglectDays != null ? <NeglectBadge days={detail.neglectDays} resolved={false} /> : null}
      </div>
      <div className="text-xs">
        <IndexEvidence
          matchedProductsCount={detail.matchedProductsCount}
          matchedProductNames={detail.matchedProductNames}
          similarProductNames={detail.similarProductNames}
          correctedQuery={detail.correctedQuery}
        />
      </div>
      {detail.count === 0 ? (
        <p className="text-xs text-gray-500">조회 기간에 이 키워드의 검색 이력이 없습니다.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiTile label="검색 수" value={formatTimes(detail.count)} />
            <KpiTile label="그중 빈손" value={formatTimes(detail.zeroCount)} />
            <KpiTile
              label="전기간 대비"
              value={
                rate == null ? '신규' : `${rate >= 0 ? '▲' : '▼'} ${formatPercent(Math.abs(rate))}`
              }
              hint={`직전 기간 ${formatTimes(detail.previousCount)}`}
            />
            <KpiTile
              label="마지막 결과 있음"
              value={detail.lastPositiveAt ? detail.lastPositiveAt.slice(0, 10) : '없음'}
              hint={detail.firstZeroAt ? `최초 빈손 ${detail.firstZeroAt.slice(0, 10)}` : undefined}
            />
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={detail.series} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#999" />
              <YAxis tick={{ fontSize: 11 }} stroke="#999" allowDecimals={false} />
              <Tooltip formatter={(value: number) => formatCount(value)} />
              <Line type="monotone" dataKey="count" name="검색 수(회)" stroke={SERIES_COLORS[0]} strokeWidth={2} dot={false} />
              <Line
                type="monotone"
                dataKey="zeroCount"
                name="빈손 검색(회)"
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
            {KEYWORD_ISSUE_STATUSES.map((value) => (
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
