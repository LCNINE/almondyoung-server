'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ReviewRewardGrantStatus } from '@/lib/types/dto/review-reward';
import { useReviewRewardGrants, useReviewRewardSummary } from '@/lib/services/review-reward';
import { formatDateTime, formatKrw, GRANT_STATUS_LABELS, REWARD_KIND_LABELS, SKIP_REASON_LABELS } from '../shared';

const PAGE_SIZE = 20;
const SUMMARY_DAYS = 30;

const STATUS_TABS: Array<{ value: ReviewRewardGrantStatus | undefined; label: string }> = [
  { value: undefined, label: '전체' },
  { value: 'GRANTED', label: '지급' },
  { value: 'SKIPPED', label: '미지급' },
  { value: 'REVOKED', label: '회수' },
];

export function GrantsPanel() {
  const [status, setStatus] = useState<ReviewRewardGrantStatus | undefined>(undefined);
  const [page, setPage] = useState(1);
  const { data: summary } = useReviewRewardSummary(SUMMARY_DAYS);
  const { data, isLoading } = useReviewRewardGrants({ page, limit: PAGE_SIZE, status });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <section className="space-y-3 rounded-[10px] border border-gray-200 bg-white p-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">지급 내역</h2>
        <p className="mt-1 text-xs text-gray-500">
          최근 {SUMMARY_DAYS}일 기준입니다. 지급되지 않은 건도 <strong>사유와 함께</strong> 남습니다 — 0원 지급과 지급
          대상 아님은 다른 사건입니다.
        </p>
      </div>

      {summary && (
        <div className="flex flex-wrap gap-2">
          <SummaryTile label="지급" value={`${summary.granted.count}건`} sub={formatKrw(summary.granted.amount)} />
          <SummaryTile label="회수" value={`${summary.revoked.count}건`} sub={formatKrw(summary.revoked.amount)} />
          {summary.skipped.length === 0 ? (
            <SummaryTile label="미지급" value="0건" sub="사유 없음" />
          ) : (
            summary.skipped.map((row) => (
              <SummaryTile
                key={row.reason}
                label="미지급"
                value={`${row.count}건`}
                sub={SKIP_REASON_LABELS[row.reason] ?? row.reason}
              />
            ))
          )}
        </div>
      )}

      <div className="flex gap-1.5">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.label}
            type="button"
            onClick={() => {
              setStatus(tab.value);
              setPage(1);
            }}
            className={`rounded px-2.5 py-1 text-xs ${
              status === tab.value ? 'bg-gray-900 text-white' : 'border border-gray-300 text-gray-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-xs text-gray-400">불러오는 중…</p>}

      {data && data.data.length === 0 && (
        <p className="rounded border border-gray-200 bg-gray-50 px-3 py-4 text-xs text-gray-500">
          내역이 없습니다. 활성 규칙이 없으면 판정 자체를 하지 않으므로 아무 행도 쌓이지 않습니다.
        </p>
      )}

      {data && data.data.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th className="px-2 py-1.5">시각</th>
                  <th className="px-2 py-1.5">상태</th>
                  <th className="px-2 py-1.5">보상</th>
                  <th className="px-2 py-1.5 text-right">금액</th>
                  <th className="px-2 py-1.5">만료</th>
                  <th className="px-2 py-1.5">사유</th>
                  <th className="px-2 py-1.5">리뷰</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((grant) => (
                  <tr key={grant.id} className="border-t border-gray-100">
                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-500">{formatDateTime(grant.createdAt)}</td>
                    <td className="px-2 py-1.5">{GRANT_STATUS_LABELS[grant.status] ?? grant.status}</td>
                    <td className="px-2 py-1.5">{REWARD_KIND_LABELS[grant.rewardKind] ?? grant.rewardKind}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatKrw(grant.amount)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-500">
                      {grant.expiresAt ? formatDateTime(grant.expiresAt).slice(0, 12) : '없음'}
                    </td>
                    <td className="px-2 py-1.5 text-gray-500">
                      {grant.skipReason ? (SKIP_REASON_LABELS[grant.skipReason] ?? grant.skipReason) : '-'}
                    </td>
                    <td className="px-2 py-1.5">
                      <Link href={`/cs/reviews/${grant.reviewId}`} className="text-blue-600 hover:underline">
                        보기
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2 text-xs text-gray-500">
            <span>
              {page} / {totalPages} 쪽 · 총 {data.total.toLocaleString('ko-KR')}건
            </span>
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((prev) => prev - 1)}
              className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
            >
              이전
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((prev) => prev + 1)}
              className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
            >
              다음
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function SummaryTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-[128px] rounded border border-gray-200 bg-gray-50 px-3 py-2">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="text-sm font-semibold text-gray-900 tabular-nums">{value}</p>
      <p className="text-[11px] text-gray-500">{sub}</p>
    </div>
  );
}
