'use client';

import { ReactNode } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils/ui';
import type { MembershipNoticeStatus } from '@/lib/api/domains/alimtalk';
import type {
  BillingRecoveryOverview,
  OutstandingDebtCard,
  RecoveryCase,
  ResolvedCard,
} from '@/lib/api/domains/membership/recovery';
import {
  attemptRef,
  daysBetween,
  failureReason,
  kstDay,
  latestAttemptNotice,
  noNoticeBecauseBeforePolicy,
  noticeBadge,
  terminatedRef,
  won,
} from '../lib/recovery-view';
import { AttemptDots, NoticeChip, PersonName, SectionTitle } from './shared';

const MAX_ATTEMPTS = 3;

function Lane({
  title,
  hint,
  total,
  shown,
  accent,
  moreHref,
  children,
}: {
  title: string;
  hint: string;
  total: number;
  shown: number;
  accent: string;
  /** 넘친 사람을 전부 볼 수 있는 기존 명단 */
  moreHref?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-gray-200 bg-gray-50/70">
      <div className={cn('rounded-t-xl border-t-4 px-3 pb-2 pt-2.5', accent)}>
        <p className="flex items-baseline justify-between text-sm font-semibold text-gray-900">
          {title}
          <span className="text-lg tabular-nums">{total}</span>
        </p>
        <p className="text-[11px] text-gray-500 break-keep">{hint}</p>
      </div>
      <div className="flex max-h-[520px] flex-col gap-2 overflow-y-auto px-2 pb-2">
        {shown === 0 ? (
          <p className="py-6 text-center text-xs text-gray-400">없음</p>
        ) : (
          children
        )}
        {total > shown &&
          (moreHref ? (
            <Link
              href={moreHref}
              className="px-1 text-center text-[11px] text-gray-500 underline underline-offset-2"
            >
              {total - shown}명 더 — 회원 조회 명단에서 전부 보기
            </Link>
          ) : (
            <p className="px-1 text-center text-[11px] text-gray-400">
              {total - shown}명 더 있음
            </p>
          ))}
      </div>
    </div>
  );
}

function CardShell({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col gap-1.5 rounded-lg border border-gray-200 bg-white p-3 text-left shadow-sm transition hover:-translate-y-px hover:border-gray-300 hover:shadow"
    >
      {children}
    </button>
  );
}

function RetryCard({
  c,
  statuses,
  onOpen,
}: {
  c: RecoveryCase;
  statuses?: Map<string, MembershipNoticeStatus>;
  onOpen: (userId: string) => void;
}) {
  const notice = latestAttemptNotice(c);
  return (
    <CardShell onClick={() => onOpen(c.userId)}>
      <div className="flex items-center justify-between gap-2">
        <PersonName userId={c.userId} className="text-sm" />
        <span className="shrink-0 text-xs font-semibold tabular-nums text-gray-700">
          약 {won(c.planPrice)}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-600">
        <AttemptDots failed={c.attempts} max={MAX_ATTEMPTS} />
        <span>
          {c.attempts}번 실패 ·{' '}
          <b className={c.remainingAttempts <= 1 ? 'text-red-600' : ''}>
            남은 기회 {c.remainingAttempts}
          </b>
        </span>
      </div>
      <p className="truncate text-xs text-gray-500">{failureReason(c)}</p>
      {c.nextAttempt && (
        <p className="text-xs font-medium text-gray-800">
          다음 출금 {kstDay(c.nextAttempt.at)}
          {c.nextAttempt.estimated && (
            <span className="font-normal text-gray-400"> (짐작)</span>
          )}
        </p>
      )}
      <NoticeChip
        badge={noticeBadge(
          notice,
          c.invoiceId && notice
            ? attemptRef(c.invoiceId, notice.attemptNo)
            : null,
          statuses,
          noNoticeBecauseBeforePolicy(c)
        )}
      />
    </CardShell>
  );
}

const CAUSE: Record<string, string> = {
  UNCOLLECTIBLE: '출금 실패',
  MANDATE_REJECTED: '계좌 거절',
};

function DebtCard({
  d,
  statuses,
  now,
  onOpen,
}: {
  d: OutstandingDebtCard;
  statuses?: Map<string, MembershipNoticeStatus>;
  now: string;
  onOpen: (userId: string) => void;
}) {
  const days = daysBetween(d.oldestAt, now);
  return (
    <CardShell onClick={() => onOpen(d.userId)}>
      <div className="flex items-center justify-between gap-2">
        <PersonName userId={d.userId} className="text-sm" />
        <span className="shrink-0 text-sm font-bold tabular-nums text-red-600">
          {won(d.amount)}
        </span>
      </div>
      <p className="text-xs text-gray-600">
        {d.causes.map((c) => CAUSE[c] ?? c).join(' · ')}로 해지 ·{' '}
        <b className={days >= 30 ? 'text-red-600' : ''}>{days}일째</b>
        {d.lines > 1 && ` · ${d.lines}건`}
      </p>
      {d.paying && (
        <span className="w-fit rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
          고객이 납부 시작 · 입금 대기
        </span>
      )}
      <NoticeChip
        prefix="해지 안내"
        badge={noticeBadge(
          d.finalNotice,
          terminatedRef(d.contractId),
          statuses
        )}
      />
    </CardShell>
  );
}

const HOW: Record<ResolvedCard['how'], string> = {
  RETRY: '재시도로 받음',
  SETTLED: '미납을 고객이 냄',
  WAIVED: '면제함',
};

function ResolvedCardView({
  r,
  onOpen,
}: {
  r: ResolvedCard;
  onOpen: (userId: string) => void;
}) {
  const days = daysBetween(r.since, r.at);
  return (
    <CardShell onClick={() => onOpen(r.userId)}>
      <div className="flex items-center justify-between gap-2">
        <PersonName userId={r.userId} className="text-sm" />
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums',
            r.how === 'WAIVED' ? 'text-gray-500' : 'text-emerald-700'
          )}
        >
          <CheckCircle2 className="size-3.5" aria-hidden />
          {r.amount != null ? won(r.amount) : '금액 기록 없음'}
        </span>
      </div>
      <p className="text-xs text-gray-600">
        {HOW[r.how]} · {kstDay(r.at)} · {days === 0 ? '당일' : `${days}일 만에`}
      </p>
    </CardShell>
  );
}

/**
 * 지금 상태 보드(기간과 무관). 칸은 «무엇을 해야 하는가» 순서다 — 1번 실패 → 마지막 기회 → 해지·미납 → 해결.
 * filter 가 있으면 그 사람들만 남긴다(「오늘 볼 것」을 눌렀을 때).
 */
export function RecoveryBoard({
  data,
  statuses,
  filter,
  onOpen,
}: {
  data: BillingRecoveryOverview;
  statuses?: Map<string, MembershipNoticeStatus>;
  filter: Set<string> | null;
  onOpen: (userId: string) => void;
}) {
  const lanes = data.now.lanes;
  const keep = <T extends { userId: string }>(xs: T[]) =>
    filter ? xs.filter((x) => filter.has(x.userId)) : xs;
  const first = keep(lanes.firstFailure.cards);
  const last = keep(lanes.lastChance.cards);
  const debts = keep(lanes.outstanding.cards);
  const resolved = keep(lanes.resolved.cards);
  const onBoard = new Set(
    [...first, ...last, ...debts, ...resolved].map((x) => x.userId)
  );
  const offBoard = filter ? [...filter].filter((id) => !onBoard.has(id)) : [];

  return (
    <section aria-label="지금 상태 보드">
      <SectionTitle
        title="지금 누가 어디에"
        sub="기간과 무관한 지금 상태 · 카드를 누르면 그 사람의 이야기"
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Lane
          title="1번 실패"
          hint="이틀 뒤 다시 출금합니다"
          total={filter ? first.length : lanes.firstFailure.total}
          shown={first.length}
          accent="border-amber-300"
          moreHref="/membership/members?axis=past_due&page=1"
        >
          {first.map((c) => (
            <RetryCard
              key={`${c.contractId}:${c.invoiceId}`}
              c={c}
              statuses={statuses}
              onOpen={onOpen}
            />
          ))}
        </Lane>
        <Lane
          title="마지막 기회"
          hint="2번 실패 — 다음도 실패하면 해지됩니다"
          total={filter ? last.length : lanes.lastChance.total}
          shown={last.length}
          accent="border-red-400"
          moreHref="/membership/members?axis=past_due&page=1"
        >
          {last.map((c) => (
            <RetryCard
              key={`${c.contractId}:${c.invoiceId}`}
              c={c}
              statuses={statuses}
              onOpen={onOpen}
            />
          ))}
        </Lane>
        <Lane
          title="해지 · 미납 남음"
          hint="무통장으로 갚기 전엔 재가입이 막힙니다"
          total={filter ? debts.length : lanes.outstanding.total}
          shown={debts.length}
          accent="border-red-600"
          moreHref="/membership/members?axis=arrears&page=1"
        >
          {debts.map((d) => (
            <DebtCard
              key={d.userId}
              d={d}
              statuses={statuses}
              now={data.asOf}
              onOpen={onOpen}
            />
          ))}
        </Lane>
        <Lane
          title="해결 (최근 30일)"
          hint="재시도로 받음 · 미납 납부 · 면제"
          total={filter ? resolved.length : lanes.resolved.total}
          shown={resolved.length}
          accent="border-emerald-500"
        >
          {resolved.map((r, i) => (
            <ResolvedCardView
              key={`${r.userId}:${r.at}:${i}`}
              r={r}
              onOpen={onOpen}
            />
          ))}
        </Lane>
      </div>
      {offBoard.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-white px-3 py-2 text-xs text-gray-600">
          <span>보드 칸 밖에 있는 사람:</span>
          {offBoard.slice(0, 30).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onOpen(id)}
              className="rounded-full border border-gray-200 px-2 py-0.5 hover:bg-gray-50"
            >
              <PersonName userId={id} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
