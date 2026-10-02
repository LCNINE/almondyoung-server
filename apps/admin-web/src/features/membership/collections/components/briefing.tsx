'use client';

import { Sparkles } from 'lucide-react';
import { KpiTile } from '@/features/statistics/components/widgets';
import type { BillingRecoveryOverview } from '@/lib/api/domains/membership/recovery';
import {
  PolicyScope,
  briefing,
  monthLabel,
  rate,
  won,
} from '../lib/recovery-view';

/** 맨 위 — 숫자를 문장으로 푼 브리핑과 경영 지표 네 칸 */
export function RecoveryBriefing({
  data,
  scope,
}: {
  data: BillingRecoveryOverview;
  scope: PolicyScope;
}) {
  const { kpis, funnel, now } = data;
  // 시행 전 건이 섞인 달이면 지표도 어느 쪽 숫자인지 밝힌다
  const m = data.beforePolicy
    ? `${monthLabel(data.period.month)} ${scope === 'BEFORE' ? '정책 시행 전' : '정책 시행 후'} 시작분`
    : monthLabel(data.period.month);
  const notices = funnel.notices;
  const noticeExpected =
    notices.attempt.queued +
    notices.attempt.skipped +
    notices.attempt.missing +
    notices.final.queued +
    notices.final.skipped +
    notices.final.missing;
  const noticeQueued = notices.attempt.queued + notices.final.queued;
  const noticeSkipped = notices.attempt.skipped + notices.final.skipped;
  const noticeMissing = notices.attempt.missing + notices.final.missing;

  return (
    <section aria-label="요약" className="space-y-3">
      <div className="rounded-xl border border-gray-200 bg-gradient-to-br from-slate-900 to-slate-800 p-5 text-white shadow-sm">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-300">
          <Sparkles className="size-3.5" aria-hidden />
          {m} 한눈에 보기
        </p>
        <ul className="space-y-1 text-[15px] leading-relaxed break-keep">
          {briefing(data, scope).map((line, i) => (
            <li
              key={i}
              className={i === 0 ? 'font-semibold' : 'text-slate-100'}
            >
              {line}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="재시도로 받은 비율"
          value={rate(kpis.retryRecoveryRate)}
          hint={
            kpis.retryRecoveryRate == null
              ? `${m}에 결과가 난 출금 실패가 없습니다`
              : `결과 난 ${kpis.retryResolved}건 중 받은 ${funnel.recovered.cases}건${kpis.retryUnresolved > 0 ? ` · 진행 중 ${kpis.retryUnresolved}건은 빼고 셈` : ''}${kpis.avgDaysToRecover != null ? ` · 평균 ${kpis.avgDaysToRecover}일 만에` : ''}`
          }
        />
        <KpiTile
          label="미납 회수율"
          value={rate(kpis.debtCollectionRate)}
          hint={
            kpis.debtCollectionRate == null
              ? `${m}에 시작된 건에서 생긴 미납이 없습니다`
              : `생긴 미납 ${won(funnel.debt.recorded.amount)} 중 받은 금액 기준${funnel.debt.waived.amount > 0 ? ` · 면제 ${won(funnel.debt.waived.amount)}은 받은 돈에 넣지 않음` : ''}${kpis.avgDaysToSettle != null ? ` · 평균 ${kpis.avgDaysToSettle}일 만에` : ''}`
          }
        />
        <KpiTile
          label="지금 받을 돈"
          value={won(now.outstanding.amount)}
          hint={
            now.outstanding.people > 0
              ? `${now.outstanding.people}명 · 기간과 무관한 지금 잔액 · 갚기 전엔 재가입이 막힘`
              : '남아 있는 미납이 없습니다'
          }
        />
        <KpiTile
          label="고객 알림"
          value={
            noticeExpected > 0 ? `${noticeQueued} / ${noticeExpected}` : '-'
          }
          hint={
            noticeExpected === 0
              ? scope === 'BEFORE'
                ? '미납 정책·알림 시행 전이라 알림 대상이 아니었습니다'
                : '보낼 안내가 없었습니다'
              : `보낸 안내 / 보냈어야 할 안내${noticeSkipped > 0 ? ` · 못 보냄 ${noticeSkipped}` : ''}${noticeMissing > 0 ? ` · 기록 없음 ${noticeMissing} — 확인 필요` : ''}`
          }
        />
      </div>
    </section>
  );
}
