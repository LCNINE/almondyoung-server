'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { usePaymentAbandonment } from '@/lib/services/wallet';
import { StatisticsShell } from '../components/shell';
import { ChartCard, KpiTile } from '../components/widgets';
import { formatCount, formatKrw, formatPercent, SERIES_COLORS, useStatisticsRange } from '../shared';

/** 종료 직전 상태를 관리자 말로 옮긴다. 모르는 값은 원문 그대로 둔다(조용히 감추지 않는다). */
const STAGE_LABELS: Record<string, string> = {
  CREATED: '결제 시작만 하고 이탈',
  PROCESSING: '승인 요청 중 실패·취소',
  REQUIRES_ACTION: '결제창까지 갔다가 이탈',
  AWAITING_DEPOSIT: '무통장 — 입금하지 않음',
  PENDING_SETTLEMENT: 'CMS 출금 결과 대기 중 실패',
  AUTHORIZED: '승인 후 취소',
  PARTIALLY_CAPTURED: '부분 캡처 후 취소',
};

const REASON_LABELS: Record<string, string> = {
  INTENT_EXPIRED: '만료 (그냥 떠남)',
  USER_CANCELED: '고객이 취소',
};

const METHOD_LABELS: Record<string, string> = {
  UNSELECTED: '결제수단 고르기 전 이탈',
  POINTS: '포인트',
  CARD: '카드',
  BANK_TRANSFER: '무통장입금',
  BNPL: 'BNPL',
  TOSS: '토스페이먼츠',
  NICEPAY: '나이스페이',
  TOSS_BILLING: '토스 정기결제',
  NICEPAY_BILLING: '나이스페이 정기결제',
  CMS_BATCH: 'CMS 출금',
};

/** 진행 중인 시도가 왜 진행 중인지. 만료 잡이 회수하는 상태와 아닌 상태를 구분해 적는다. */
const OPEN_STATUS_LABELS: Record<string, string> = {
  CREATED: '결제 시작 (만료되면 자동 정리)',
  PROCESSING: '승인 요청 중 (만료되면 자동 정리)',
  REQUIRES_ACTION: '결제창 열림 (만료되면 자동 정리)',
  AWAITING_DEPOSIT: '입금 대기 (만료되면 자동 정리)',
  AUTHORIZED: '승인됨 · 캡처 대기 — 자동 정리 안 됨',
  PENDING_SETTLEMENT: 'CMS 출금 결과 대기 — 자동 정리 안 됨',
  PARTIALLY_CAPTURED: '부분 캡처 — 자동 정리 안 됨',
};

/** 만료 잡이 손대지 않는 상태 — 오래 쌓이면 사람이 봐야 한다 (jobs/expiration.job.ts). */
const UNRECLAIMED_STATUSES = new Set(['AUTHORIZED', 'PENDING_SETTLEMENT', 'PARTIALLY_CAPTURED']);

const labelOf = (map: Record<string, string>, key: string | null, fallback: string) =>
  key == null ? fallback : (map[key] ?? key);

/** 초를 사람이 읽는 단위로. 0 초도 유효한 값이라 null 과 구분한다. */
function formatDuration(seconds: number | null): string {
  if (seconds == null) return '-';
  if (seconds < 60) return `${Math.round(seconds)}초`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}분`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}시간`;
  return `${(seconds / 86400).toFixed(1)}일`;
}

export default function AbandonmentStatisticsTemplate() {
  const range = useStatisticsRange();
  const { data, isLoading, isError } = usePaymentAbandonment(range.from, range.to);

  const summary = data?.summary;
  const byStage = data?.byStage ?? [];
  const byMethod = data?.byMethod ?? [];
  const daily = data?.daily ?? [];
  const openByStatus = data?.openByStatus ?? [];

  const chartData = daily.map((point) => ({
    bucket: point.bucket.slice(5),
    성공: point.succeededCount,
    이탈: point.abandonedCount,
    '진행 중': point.openCount,
  }));

  return (
    <StatisticsShell filterOptions={{ channel: false, granularity: false }}>
      <div className="mb-4 space-y-1">
        <span className="block text-xs text-gray-400">
          결제까지 온 고객이 어디서 왜 멈췄는지를 결제 원장에서 직접 집계합니다 — 추정이 아니라 실측입니다.
        </span>
        <span className="block text-xs text-gray-400">
          모수는 기간 내 생성된 <b>상품 구매</b> 결제 시도입니다(멤버십 정기결제는 제외).
          아직 결말이 나지 않은 <b>진행 중</b>은 이탈로 세지 않고 이탈률 분모에서도 뺍니다 —
          결제 시도는 만료까지 시간이 걸려서, 조회 기간 끝자락 건은 아직 끝날 시간이 없었습니다.
        </span>
        <span className="block text-xs text-gray-400">
          금액은 <b>결제하려던 금액</b>이지 회수 가능한 매출이 아닙니다. 이탈한 고객이 모두 살 거라는 뜻이 아니라
          규모의 상한으로 읽어주세요.
        </span>
      </div>

      {isError ? (
        <p className="py-10 text-center text-sm text-red-500">
          결제 이탈 집계 조회에 실패했습니다. 잠시 후 다시 시도해주세요.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
            <KpiTile label="결제 시도" value={formatCount(summary?.attemptedCount)} isLoading={isLoading} />
            <KpiTile label="결제 완료" value={formatCount(summary?.succeededCount)} isLoading={isLoading} />
            <KpiTile
              label="이탈"
              value={formatCount(summary?.abandonedCount)}
              hint={summary ? formatKrw(summary.abandonedAmount) : undefined}
              isLoading={isLoading}
            />
            <KpiTile
              label="이탈률"
              value={formatPercent(summary?.abandonRate)}
              hint={summary ? `결말이 난 ${formatCount(summary.settledCount)}건 기준` : undefined}
              isLoading={isLoading}
            />
            <KpiTile
              label="진행 중"
              value={formatCount(summary?.openCount)}
              hint="아직 결말 전 — 이탈에 안 셈"
              isLoading={isLoading}
            />
          </div>

          <ChartCard
            title="어디서 멈췄나 — 단계·사유별 이탈"
            description="결제가 끝난 직전 상태와 종료 사유입니다. 가장 아까운 구간은 결제창까지 갔다가 이탈한 건입니다."
            isLoading={isLoading}
            isEmpty={byStage.length === 0}
            emptyText="조회 기간에 이탈한 결제 시도가 없습니다"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b text-xs text-gray-500">
                    <th className="py-2 text-left font-medium">멈춘 단계</th>
                    <th className="py-2 text-left font-medium">사유</th>
                    <th className="py-2 text-right font-medium">건수</th>
                    <th className="py-2 text-right font-medium">비중</th>
                    <th className="py-2 text-right font-medium">시도 금액</th>
                  </tr>
                </thead>
                <tbody>
                  {byStage.map((row) => (
                    <tr key={`${row.stage ?? 'none'}-${row.reason ?? 'none'}`} className="border-b last:border-0">
                      <td className="py-2 text-gray-900">{labelOf(STAGE_LABELS, row.stage, '단계 미기록')}</td>
                      <td className="py-2 text-gray-600">{labelOf(REASON_LABELS, row.reason, '사유 미기록')}</td>
                      <td className="py-2 text-right tabular-nums text-gray-900">{formatCount(row.count)}</td>
                      <td className="py-2 text-right tabular-nums text-gray-500">
                        {summary && summary.abandonedCount > 0
                          ? formatPercent(row.count / summary.abandonedCount)
                          : '-'}
                      </td>
                      <td className="py-2 text-right tabular-nums text-gray-900">{formatKrw(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>

          <ChartCard
            title="결제수단별 이탈률"
            description="어떤 결제수단이 유독 안 끝나는지 봅니다. 이탈률 분모는 결말이 난 건(완료+이탈)입니다."
            isLoading={isLoading}
            isEmpty={byMethod.length === 0}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b text-xs text-gray-500">
                    <th className="py-2 text-left font-medium">결제수단</th>
                    <th className="py-2 text-right font-medium">시도</th>
                    <th className="py-2 text-right font-medium">완료</th>
                    <th className="py-2 text-right font-medium">이탈</th>
                    <th className="py-2 text-right font-medium">진행 중</th>
                    <th className="py-2 text-right font-medium">이탈률</th>
                    <th className="py-2 text-right font-medium">이탈 금액</th>
                  </tr>
                </thead>
                <tbody>
                  {byMethod.map((row) => (
                    <tr key={row.methodType} className="border-b last:border-0">
                      <td className="py-2 text-gray-900">{METHOD_LABELS[row.methodType] ?? row.methodType}</td>
                      <td className="py-2 text-right tabular-nums text-gray-900">
                        {formatCount(row.attemptedCount)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-gray-600">
                        {formatCount(row.succeededCount)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-gray-600">
                        {formatCount(row.abandonedCount)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-gray-400">{formatCount(row.openCount)}</td>
                      <td className="py-2 text-right tabular-nums text-gray-900">
                        {formatPercent(row.abandonRate)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-gray-900">
                        {formatKrw(row.abandonedAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>

          <ChartCard
            title="일별 결제 시도 결말"
            description="결제 시도가 생성된 날(KST) 기준입니다. 최근 날짜일수록 진행 중 비중이 큰 것이 정상입니다."
            isLoading={isLoading}
            isEmpty={chartData.length === 0}
          >
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip formatter={(value: number) => formatCount(value)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="성공" stackId="a" fill={SERIES_COLORS[2]} />
                <Bar dataKey="이탈" stackId="a" fill={SERIES_COLORS[1]} />
                <Bar dataKey="진행 중" stackId="a" fill={SERIES_COLORS[3]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="진행 중인 결제 시도 — 왜 아직 안 끝났나"
            description="이탈로 세지 않은 건들입니다. 만료되면 자동 정리되는 상태와, 자동 정리되지 않아 사람이 봐야 하는 상태를 나눠 표기합니다."
            isLoading={isLoading}
            isEmpty={openByStatus.length === 0}
            emptyText="진행 중인 결제 시도가 없습니다"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b text-xs text-gray-500">
                    <th className="py-2 text-left font-medium">상태</th>
                    <th className="py-2 text-right font-medium">건수</th>
                    <th className="py-2 text-right font-medium">시도 금액</th>
                  </tr>
                </thead>
                <tbody>
                  {openByStatus.map((row) => (
                    <tr key={row.status} className="border-b last:border-0">
                      <td className="py-2 text-gray-900">
                        {OPEN_STATUS_LABELS[row.status] ?? row.status}
                        {UNRECLAIMED_STATUSES.has(row.status) && (
                          <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
                            확인 필요
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right tabular-nums text-gray-900">{formatCount(row.count)}</td>
                      <td className="py-2 text-right tabular-nums text-gray-900">{formatKrw(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <KpiTile
              label="결제를 끝내기까지 (중앙값)"
              value={formatDuration(data?.duration.succeeded.p50Seconds ?? null)}
              hint={
                data
                  ? `상위 10%는 ${formatDuration(data.duration.succeeded.p90Seconds)} · 표본 ${formatCount(data.duration.succeeded.sampleCount)}건`
                  : undefined
              }
              isLoading={isLoading}
            />
            <KpiTile
              label="포기하기까지 (중앙값)"
              value={formatDuration(data?.duration.abandoned.p50Seconds ?? null)}
              hint={
                data
                  ? `상위 10%는 ${formatDuration(data.duration.abandoned.p90Seconds)} · 표본 ${formatCount(data.duration.abandoned.sampleCount)}건`
                  : undefined
              }
              isLoading={isLoading}
            />
          </div>

          <p className="text-xs text-gray-400">
            결제창을 닫았다가 다시 연 경우는 같은 결제 시도가 재사용되므로 중복으로 세지 않습니다.
            반대로 한 고객이 결제를 여러 번 새로 시작하면 각각 한 건으로 셉니다 — 사람 수가 아니라 시도 수입니다.
          </p>
        </div>
      )}
    </StatisticsShell>
  );
}
