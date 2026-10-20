import { ChevronDown, CircleAlert, Clock3, Users } from 'lucide-react';
import type { MonthlyAttendanceStatistics } from '@packages/domain-types/attendance';
import { Skeleton } from '@/components/ui/skeleton';
import { statisticsDuration } from '../lib/statistics-model';

export function StatisticsSummary({
  month,
  totals,
  pending,
}: {
  month: string;
  totals?: MonthlyAttendanceStatistics['totals'];
  pending: boolean;
}) {
  return (
    <section
      aria-label="이 달의 출퇴근 요약"
      className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white"
    >
      <div className="px-5 pt-6 pb-7 sm:px-7 sm:pt-7">
        <p className="flex items-center gap-2 text-sm font-medium text-slate-500">
          <Clock3 className="size-4 text-indigo-500" aria-hidden />
          {Number(month.slice(5))}월 총 기록시간
        </p>
        {pending ? (
          <Skeleton className="mt-4 h-12 w-48 rounded-xl" />
        ) : (
          <p className="mt-3 break-words text-[32px] leading-tight font-bold tracking-tight tabular-nums text-slate-950 sm:text-[38px]">
            {statisticsDuration(totals?.recordedMinutes ?? 0)}
          </p>
        )}
        <p className="mt-3 text-xs leading-6 text-slate-400">
          퇴근 완료 기록 {pending ? '—' : (totals?.completedDays ?? 0)}건을
          합산했어요.
        </p>
      </div>
      <dl className="grid grid-cols-3 border-t border-slate-100 bg-slate-50/60 px-2 py-5 sm:px-4">
        <div className="min-w-0 border-r border-slate-200/70 px-2 text-center">
          <dt className="text-xs text-slate-500">조회 직원</dt>
          <dd className="mt-2 text-xl font-bold tabular-nums text-slate-800 sm:text-2xl">
            {pending ? (
              <Skeleton className="mx-auto h-7 w-10" />
            ) : (
              `${totals?.employeeCount ?? 0}명`
            )}
          </dd>
        </div>
        <div className="min-w-0 border-r border-slate-200/70 px-2 text-center">
          <dt className="text-xs text-slate-500">총 출근일수</dt>
          <dd className="mt-2 text-xl font-bold tabular-nums text-slate-800 sm:text-2xl">
            {pending ? (
              <Skeleton className="mx-auto h-7 w-10" />
            ) : (
              `${totals?.recordedDays ?? 0}일`
            )}
          </dd>
        </div>
        <div className="min-w-0 px-2 text-center">
          <dt className="text-xs text-slate-500">퇴근 미기록</dt>
          <dd
            className={`mt-2 text-xl font-bold tabular-nums sm:text-2xl ${totals?.missingCheckoutDays ? 'text-orange-600' : 'text-slate-800'}`}
          >
            {pending ? (
              <Skeleton className="mx-auto h-7 w-10" />
            ) : (
              `${totals?.missingCheckoutDays ?? 0}건`
            )}
          </dd>
        </div>
      </dl>
      {!pending && !!totals?.missingCheckoutDays && (
        <p className="flex items-start gap-2 border-t border-orange-100/60 bg-orange-50/60 px-5 py-3 text-xs leading-6 text-orange-800 sm:px-7">
          <CircleAlert className="mt-1 size-4 shrink-0" aria-hidden />
          <span>
            퇴근 기록 {totals.missingCheckoutDays}건을 확인해 주세요. 아래 ‘확인
            필요’에서 직원을 찾을 수 있어요.
          </span>
        </p>
      )}
    </section>
  );
}

export function StatisticsBasis() {
  return (
    <details className="group rounded-2xl bg-slate-100/70 px-4 text-xs text-slate-500">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 font-medium [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <Users className="size-4 text-slate-400" aria-hidden />
          통계는 이렇게 계산해요
        </span>
        <ChevronDown
          className="size-4 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="space-y-2 pb-4 leading-6">
        <p>
          현재 등록된 활성 직원의 출퇴근 기록을 집계해요. 출근일수는 직원별 기록
          일수의 합계예요.
        </p>
        <p>
          기록시간은 퇴근을 완료한 출근~퇴근 간격의 합계이며, 휴게시간은
          차감하지 않아요.
        </p>
        <p>
          야간 근무는 출근일이 속한 달에 포함해요. 오늘 진행 중인 근무는 퇴근
          미기록에서 제외해요.
        </p>
        <p>급여 계산이나 지각·결근 판정은 포함하지 않아요.</p>
      </div>
    </details>
  );
}
