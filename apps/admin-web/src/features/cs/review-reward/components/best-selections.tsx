'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BestSelectionStatus } from '@/lib/types/dto/review-reward';
import {
  useBestSelections,
  useConfirmBestSelection,
  useGenerateBestSelections,
  useRejectBestSelection,
} from '@/lib/services/review-reward';
import { formatDateTime } from '../shared';

const STATUS_TABS: Array<{ value: BestSelectionStatus; label: string }> = [
  { value: 'CANDIDATE', label: '확정 대기' },
  { value: 'CONFIRMED', label: '확정됨' },
  { value: 'REJECTED', label: '제외됨' },
];

export function BestSelections() {
  const [status, setStatus] = useState<BestSelectionStatus>('CANDIDATE');
  const { data, isLoading, isError } = useBestSelections({ status, page: 1, limit: 50 });
  const generate = useGenerateBestSelections();
  const confirm = useConfirmBestSelection();
  const reject = useRejectBestSelection();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <section className="space-y-3 rounded-[10px] border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">주간 베스트 리뷰</h2>
          <p className="mt-1 text-xs text-gray-500">
            매주 월요일 04시(KST)에 지난 주 후보가 자동으로 뽑힙니다. <strong>확정해야 지급됩니다</strong> — 추천수는
            지인 클릭으로 밀 수 있어 마지막 판단은 사람이 합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setMessage(null);
            generate.mutate(undefined, {
              onSuccess: (result) => setMessage(`후보 ${result.created}건을 새로 만들었습니다.`),
              onError: () => setMessage('후보 집계에 실패했습니다.'),
            });
          }}
          disabled={generate.isPending}
          className="shrink-0 rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-700 disabled:opacity-50"
        >
          지금 집계
        </button>
      </div>

      <div className="flex gap-1.5">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setStatus(tab.value)}
            className={`rounded px-2.5 py-1 text-xs ${
              status === tab.value ? 'bg-gray-900 text-white' : 'border border-gray-300 text-gray-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {message && <p className="text-xs text-gray-600">{message}</p>}
      {isLoading && <p className="text-xs text-gray-400">불러오는 중…</p>}

      {isError && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-4 text-xs text-red-600">
          선정 목록을 불러오지 못했습니다. <strong>비어 있는 것이 아니라 조회에 실패한 것입니다.</strong>
        </p>
      )}

      {data && data.data.length === 0 && (
        <p className="rounded border border-gray-200 bg-gray-50 px-3 py-4 text-xs text-gray-500">
          해당 상태의 선정 건이 없습니다. 주간 베스트 규칙이 활성이어야 후보가 만들어집니다.
        </p>
      )}

      {data && data.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-2 py-1.5">회차</th>
                <th className="px-2 py-1.5">순위</th>
                <th className="px-2 py-1.5">추천수</th>
                <th className="px-2 py-1.5">별점</th>
                <th className="px-2 py-1.5">리뷰</th>
                <th className="px-2 py-1.5">처리</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((selection) => (
                <tr key={selection.id} className="border-t border-gray-100">
                  <td className="px-2 py-1.5 whitespace-nowrap text-gray-500">
                    {formatDateTime(selection.periodStart).slice(0, 12)}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">{selection.rank}</td>
                  <td className="px-2 py-1.5 tabular-nums">{selection.helpfulCount}</td>
                  <td className="px-2 py-1.5 tabular-nums">{selection.rating}</td>
                  <td className="max-w-[360px] px-2 py-1.5">
                    <Link
                      href={`/cs/reviews/${selection.reviewId}`}
                      className="line-clamp-2 text-blue-600 hover:underline"
                    >
                      {selection.content}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5">
                    {selection.status === 'CANDIDATE' ? (
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setMessage(null);
                            confirm.mutate(selection.id, {
                              onSuccess: (result) =>
                                setMessage(
                                  result.granted
                                    ? `확정했습니다. 적립 ${result.amount.toLocaleString('ko-KR')}원이 나갑니다.`
                                    : '확정했습니다. 이 규칙은 금전 보상이 없어 뱃지만 부여됩니다.',
                                ),
                              onError: () => setMessage('확정에 실패했습니다.'),
                            });
                          }}
                          className="rounded bg-gray-900 px-2 py-1 text-white"
                        >
                          확정
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMessage(null);
                            reject.mutate(selection.id, { onError: () => setMessage('제외에 실패했습니다.') });
                          }}
                          className="rounded border border-gray-300 px-2 py-1 text-gray-600"
                        >
                          제외
                        </button>
                      </div>
                    ) : (
                      <span className="text-gray-400">{formatDateTime(selection.confirmedAt)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
