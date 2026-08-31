'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useOperatingCosts } from '@/lib/services/analytics';
import { useCreateOperatingCost, useDeleteOperatingCost } from '@/lib/services/analytics';
import { StatisticsShell } from '../components/shell';
import { formatKrw } from '../shared';

/** 월 고정비가 이 값을 넘으면 원 단위와 만원 단위를 헷갈린 입력일 가능성이 높다. */
const SANITY_MAX = 10_000_000_000;

export default function StatisticsSettingsTemplate() {
  return (
    <StatisticsShell hideFilter>
      <div className="space-y-4">
        <section className="rounded-[10px] border border-gray-200 bg-white p-4">
          <h2 className="text-base font-semibold text-gray-900">경영 설정 — 월 고정비</h2>
          <p className="mt-1 text-xs text-gray-500">
            임대료·인건비·구독료처럼 <strong>매출과 무관하게 매달 나가는 돈</strong>의 합계입니다. 이 값을 넣어야
            종합 탭이 &lsquo;흑자인지 적자인지&rsquo;와 &lsquo;본전이 되려면 얼마를 팔아야 하는지&rsquo;를 계산할 수 있습니다.
          </p>
          <p className="mt-2 rounded border border-gray-200 bg-gray-50 px-2.5 py-2 text-[11px] leading-relaxed text-gray-500">
            지금은 <strong>합계 하나만</strong> 받는 판정용 값입니다 — 회계 장부가 아닙니다. 나중에 어드민에 회계
            모듈이 들어오면 이 입력값 대신 <strong>비용 원장에서 항목별로 읽어 정확하게 계산</strong>하게 되고, 이
            화면은 그때 사라집니다. 그래서 지금 항목별(임대료·인건비·광고비)로 쪼개지 않습니다.
          </p>
          <OperatingCostSettings />
        </section>

        <p className="text-xs text-gray-400">
          결제수단별 수수료율은{' '}
          <Link href="/statistics/profit" className="inline-flex items-center gap-0.5 text-blue-600 hover:underline">
            이익 탭 <ArrowRight className="h-3 w-3" />
          </Link>
          의 &lsquo;수수료율 설정&rsquo;에 있습니다.
        </p>
      </div>
    </StatisticsShell>
  );
}

/** 변경은 기존 행 수정이 아니라 새 적용일 행 추가 — 과거 기간의 손익이 나중 입력으로 바뀌면 안 된다. */
function OperatingCostSettings() {
  const { data, isLoading, isError } = useOperatingCosts();
  const createCost = useCreateOperatingCost();
  const deleteCost = useDeleteOperatingCost();

  const [monthlyFixedCost, setMonthlyFixedCost] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [memo, setMemo] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const submit = () => {
    const amount = Number(monthlyFixedCost);
    if (!monthlyFixedCost || Number.isNaN(amount) || amount < 0) {
      setFormError('월 고정비를 원 단위 숫자로 입력하세요 (예: 6200000)');
      return;
    }
    if (amount > SANITY_MAX) {
      setFormError('입력이 너무 큽니다 — 만원이 아니라 원 단위인지 확인하세요');
      return;
    }
    if (!effectiveFrom) {
      setFormError('적용 시작일을 선택하세요');
      return;
    }
    setFormError(null);
    createCost.mutate(
      { monthlyFixedCost: Math.round(amount), effectiveFrom, memo: memo.trim() || undefined },
      {
        onSuccess: () => {
          setMonthlyFixedCost('');
          setMemo('');
        },
        onError: () => setFormError('등록에 실패했습니다. 같은 적용일의 설정이 이미 있는지 확인하세요.'),
      },
    );
  };

  const preview = Number(monthlyFixedCost);
  const previewText =
    monthlyFixedCost && !Number.isNaN(preview) && preview >= 0 && preview <= SANITY_MAX ? formatKrw(preview) : null;

  return (
    <div className="mt-3 space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-gray-500">월 고정비 (원)</span>
          <input
            type="number"
            min="0"
            step="10000"
            value={monthlyFixedCost}
            onChange={(event) => setMonthlyFixedCost(event.target.value)}
            placeholder="6200000"
            className="w-40 rounded border border-gray-200 bg-white px-2 py-1.5 tabular-nums"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-gray-500">적용 시작일 (KST)</span>
          <input
            type="date"
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
            className="rounded border border-gray-200 bg-white px-2 py-1.5"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-gray-500">메모</span>
          <input
            type="text"
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            placeholder="예: 사무실 이전 반영"
            maxLength={255}
            className="w-44 rounded border border-gray-200 bg-white px-2 py-1.5"
          />
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={createCost.isPending}
          className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
        >
          등록
        </button>
        {previewText ? <span className="pb-1.5 text-gray-500">= {previewText} / 월</span> : null}
      </div>
      {formError ? <p className="text-xs text-red-500">{formError}</p> : null}
      <p className="text-xs text-gray-400">
        고정비가 바뀌면 기존 행을 고치지 말고 <strong>새 적용 시작일로 등록</strong>하세요 — 과거 기간의 손익이
        지금 입력 때문에 바뀌면 안 됩니다. 기간 조회 시에는 그 달의 실제 일수로 나눈 하루치를 날짜만큼 더합니다.
      </p>
      {isError ? (
        <p className="text-xs text-red-500">고정비 설정을 불러오지 못했습니다.</p>
      ) : isLoading ? (
        <p className="text-xs text-gray-400">불러오는 중…</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-gray-500">
              <th className="py-1.5 text-left">적용 시작일 (KST)</th>
              <th className="py-1.5 text-right">월 고정비</th>
              <th className="py-1.5 pl-4 text-left">메모</th>
              <th className="py-1.5 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((cost) => (
              <tr key={cost.id} className="border-b last:border-0">
                <td className="py-1.5 tabular-nums">{cost.effectiveFrom}</td>
                <td className="py-1.5 text-right tabular-nums">{formatKrw(cost.monthlyFixedCost)}</td>
                <td className="py-1.5 pl-4 text-gray-500">{cost.memo ?? ''}</td>
                <td className="py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => deleteCost.mutate(cost.id)}
                    disabled={deleteCost.isPending}
                    className="rounded border border-gray-200 px-2 py-0.5 text-gray-500 hover:bg-white disabled:opacity-40"
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-4 text-center text-gray-400">
                  등록된 고정비가 없습니다 — 위에서 월 고정비를 입력하면 흑자·적자 판정이 시작됩니다
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}
    </div>
  );
}
