'use client';

import { ReactNode } from 'react';
import {
  AlertTriangle,
  Clock,
  HeartHandshake,
  Info,
  LogOut,
  Wallet,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/ui';
import { useMembershipInsights } from '@/lib/services/membership';
import type {
  MemberAxis,
  MembershipInsights,
} from '@/lib/api/domains/membership/people';
import { daysSince, percent, won } from './format';

type Tone = 'danger' | 'warning' | 'muted';

function Note({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <p
      className={cn(
        'flex items-start gap-1 text-xs leading-snug break-keep',
        tone === 'danger' && 'font-medium text-red-600',
        tone === 'warning' && 'font-medium text-amber-700',
        tone === 'muted' && 'text-gray-500'
      )}
    >
      {tone !== 'muted' && (
        <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
      )}
      <span>{children}</span>
    </p>
  );
}

function InsightCard({
  axis,
  selected,
  onSelect,
  icon,
  label,
  value,
  sub,
  children,
  extra,
}: {
  axis: MemberAxis;
  selected: boolean;
  onSelect: (axis: MemberAxis | null) => void;
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  children?: ReactNode;
  /** 버튼 바깥에 둘 것(툴팁 등). 누를 수 있는 요소를 버튼 안에 겹치지 않는다. */
  extra?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex h-full flex-col rounded-lg border bg-white shadow-sm transition-colors',
        selected ? 'border-gray-900 ring-1 ring-gray-900' : 'border-gray-200'
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(selected ? null : axis)}
        className={cn(
          'flex flex-1 flex-col gap-2 rounded-lg p-4 text-left',
          'hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900'
        )}
      >
        <span className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
          {icon}
          {label}
        </span>
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-bold tabular-nums text-gray-900">
            {value}
          </span>
          {sub && (
            <span className="text-sm tabular-nums text-gray-500">{sub}</span>
          )}
        </span>
        <span className="flex flex-col gap-1">{children}</span>
        <span className="mt-auto pt-1 text-xs font-medium text-gray-400">
          {selected ? '선택됨 · 다시 누르면 전체 회원' : '눌러서 명단 보기 →'}
        </span>
      </button>
      {extra && (
        <div className="border-t border-gray-100 px-4 py-2">{extra}</div>
      )}
    </div>
  );
}

function ArrearsCard({
  data,
  ...rest
}: {
  data: MembershipInsights['arrears'];
  selected: boolean;
  onSelect: (a: MemberAxis | null) => void;
}) {
  const { lifetime, thisMonth } = data;
  const oldestDays = data.oldestOutstandingAt
    ? daysSince(data.oldestOutstandingAt)
    : null;
  const everCreated =
    lifetime.settledAmount + lifetime.waivedAmount + lifetime.outstandingAmount;
  return (
    <InsightCard
      axis="arrears"
      {...rest}
      icon={<Wallet className="size-3.5" aria-hidden />}
      label="받을 돈 · 미납 요금"
      value={won(data.outstandingAmount)}
      sub={
        data.outstandingPeople > 0 ? `${data.outstandingPeople}명` : undefined
      }
    >
      {data.outstandingPeople === 0 ? (
        <Note tone="muted">지금 남아 있는 미납 요금이 없습니다.</Note>
      ) : (
        <>
          {oldestDays !== null && (
            <Note tone={oldestDays >= 30 ? 'danger' : 'muted'}>
              가장 오래된 미납이 {oldestDays}일째 남아 있습니다
            </Note>
          )}
          <Note tone="muted">
            이번 달 {won(thisMonth.createdAmount)} 생김 ·{' '}
            {won(thisMonth.settledAmount)} 받음 · {won(thisMonth.waivedAmount)}{' '}
            면제
          </Note>
        </>
      )}
      {everCreated > 0 && (
        <Note tone="muted">
          지금까지 생긴 미납 중 {percent(lifetime.settledAmount, everCreated)}를
          받았습니다
        </Note>
      )}
      {data.recentMismatches > 0 && (
        <Note tone="warning">
          최근 30일 납부 금액이 청구와 맞지 않은 일 {data.recentMismatches}건 —
          확인 필요
        </Note>
      )}
    </InsightCard>
  );
}

function PastDueCard({
  data,
  ...rest
}: {
  data: MembershipInsights['pastDue'];
  selected: boolean;
  onSelect: (a: MemberAxis | null) => void;
}) {
  return (
    <InsightCard
      axis="past_due"
      {...rest}
      icon={<Clock className="size-3.5" aria-hidden />}
      label="놓칠 위험 · 출금 재시도 중"
      value={`${data.people.toLocaleString('ko-KR')}명`}
      sub={data.people > 0 ? `한 달 요금 ${won(data.amountAtRisk)}` : undefined}
    >
      {data.people === 0 ? (
        <Note tone="muted">
          출금이 실패해 다시 시도를 기다리는 회원이 없습니다.
        </Note>
      ) : data.lastChance > 0 ? (
        <Note tone="danger">
          {data.lastChance}명은 다음 출금이 실패하면 이용이 끝납니다
        </Note>
      ) : (
        <Note tone="muted">모두 출금 기회가 2번 이상 남아 있습니다</Note>
      )}
      {data.people > 0 && (
        <Note tone="muted">
          끝까지 실패하면 선지급한 기간이 미납 요금으로 남을 수 있습니다
        </Note>
      )}
    </InsightCard>
  );
}

function GoodCard({
  data,
  ...rest
}: {
  data: MembershipInsights['good'];
  selected: boolean;
  onSelect: (a: MemberAxis | null) => void;
}) {
  const c = data.criteria;
  const determined = data.activePeople - data.undeterminedPeople;
  return (
    <InsightCard
      axis="good"
      {...rest}
      icon={<HeartHandshake className="size-3.5" aria-hidden />}
      label="좋은 손님"
      value={`${data.people.toLocaleString('ko-KR')}명`}
      extra={
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex w-fit items-center gap-1 text-xs text-gray-500 underline decoration-dotted underline-offset-2"
            >
              <Info className="size-3.5" aria-hidden />
              판정 기준 보기
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs leading-relaxed">
            지금 이용 중(해지 예약 포함)이면서 ① 첫 결제가 {c.minTenureDays}일
            이전 ② 결제로 산 이용 기간
            {` ${c.minPaidDays}`}일 이상 ③ 최근 {c.failureLookbackMonths}개월
            출금 실패 0번 ④ 미납 기록 없음(갚은 것 포함). 결제액은 환불을 뺀
            멤버십 요금이고, 상위 {Math.round(c.topShare * 100)}%에 「결제액
            상위」 표시를 붙입니다.
          </TooltipContent>
        </Tooltip>
      }
      sub={
        determined > 0
          ? `판정 가능한 이용 회원의 ${percent(data.people, determined)}`
          : undefined
      }
    >
      {data.allPaidAmount > 0 && (
        <Note tone="muted">
          지금까지 받은 멤버십 요금의{' '}
          {percent(data.paidAmount, data.allPaidAmount)}를 이분들이 냈습니다
        </Note>
      )}
      {data.undeterminedPeople > 0 && (
        <Note tone="muted">
          결제 기록이 없어 판정 못 한 이용 회원{' '}
          {data.undeterminedPeople.toLocaleString('ko-KR')}명(관리자 지급·이관
          등)
        </Note>
      )}
    </InsightCard>
  );
}

function EndingCard({
  data,
  ...rest
}: {
  data: MembershipInsights['ending'];
  selected: boolean;
  onSelect: (a: MemberAxis | null) => void;
}) {
  return (
    <InsightCard
      axis="ending"
      {...rest}
      icon={<LogOut className="size-3.5" aria-hidden />}
      label="떠날 사람 · 해지 예약"
      value={`${data.people.toLocaleString('ko-KR')}명`}
    >
      {data.people === 0 ? (
        <Note tone="muted">해지를 예약한 회원이 없습니다.</Note>
      ) : (
        <Note tone={data.endingWithin7Days > 0 ? 'warning' : 'muted'}>
          7일 안에 이용이 끝나는 사람 {data.endingWithin7Days}명
        </Note>
      )}
      {data.people > 0 && (
        <Note tone="muted">끝나기 전에 붙잡을 수 있는 사람들입니다</Note>
      )}
    </InsightCard>
  );
}

/**
 * 회원 화면 맨 위 «지금 상황». 숫자마다 뜻을 붙이고, 누르면 그 사람들 명단으로 바뀐다.
 * 요약이 실패해도 회원 목록은 계속 써야 하므로 조용히 숨긴다.
 */
export function MemberInsightPanel({
  axis,
  onSelect,
}: {
  axis: MemberAxis | null;
  onSelect: (axis: MemberAxis | null) => void;
}) {
  const { data, isLoading, isError } = useMembershipInsights();

  if (isError) return null;
  if (isLoading || !data) {
    return (
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-lg bg-gray-100" />
        ))}
      </div>
    );
  }

  return (
    <section
      aria-label="멤버십 지금 상황"
      className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      <ArrearsCard
        data={data.arrears}
        selected={axis === 'arrears'}
        onSelect={onSelect}
      />
      <PastDueCard
        data={data.pastDue}
        selected={axis === 'past_due'}
        onSelect={onSelect}
      />
      <GoodCard
        data={data.good}
        selected={axis === 'good'}
        onSelect={onSelect}
      />
      <EndingCard
        data={data.ending}
        selected={axis === 'ending'}
        onSelect={onSelect}
      />
    </section>
  );
}
