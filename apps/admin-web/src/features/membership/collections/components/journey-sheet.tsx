'use client';

import { ReactNode, useContext, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils/ui';
import type { MembershipNoticeStatus } from '@/lib/api/domains/alimtalk';
import type { RecoveryCase } from '@/lib/api/domains/membership/recovery';
import {
  useBillingRecoveryJourney,
  useMembershipNoticeStatuses,
} from '@/lib/services/membership';
import { useAlimtalkAutoSendResult } from '@/lib/services/alimtalk/queries';
import { autoSendOutcomeLabel } from '@/features/messages/alimtalk/lib/alimtalk';
import { MembershipDetailPanel } from '@/features/membership/members/components/detail-dialog';
import {
  NOT_RECORDED_LABEL,
  attemptRef,
  caseNowLabel,
  daysBetween,
  failureReason,
  kstDay,
  kstDayTime,
  noticeBadge,
  noticeLookupFor,
  terminatedRef,
  terminationLabel,
  won,
} from '../lib/recovery-view';
import { NoticeChip, UserNamesContext } from './shared';

type Dot = 'bad' | 'good' | 'wait' | 'info' | 'muted';

const DOT: Record<Dot, string> = {
  bad: 'bg-red-500',
  good: 'bg-emerald-500',
  wait: 'bg-amber-400',
  info: 'bg-sky-500',
  muted: 'bg-gray-300',
};

function Step({
  dot,
  title,
  when,
  children,
}: {
  dot: Dot;
  title: string;
  when?: string;
  children?: ReactNode;
}) {
  return (
    <li className="relative pb-4 pl-5 last:pb-0">
      <span
        className={cn(
          'absolute -left-[7px] top-1 size-3 rounded-full ring-2 ring-white',
          DOT[dot]
        )}
        aria-hidden
      />
      <p className="text-sm font-medium text-gray-900">
        {title}
        {when && (
          <span className="ml-2 text-xs font-normal tabular-nums text-gray-500">
            {when}
          </span>
        )}
      </p>
      {children && (
        <div className="mt-1 flex flex-col items-start gap-1">{children}</div>
      )}
    </li>
  );
}

/** 접수된 안내가 고객에게 실제로 닿았는지 — 열었을 때 그 사람 몫만 NHN 에 묻는다 */
function Delivery({ status }: { status: MembershipNoticeStatus | undefined }) {
  const notificationId =
    status?.found && status.status === 'SENT' ? status.notificationId : null;
  const result = useAlimtalkAutoSendResult(notificationId);
  if (!notificationId) return null;
  if (result.isLoading)
    return <span className="text-[11px] text-gray-400">받았는지 확인 중…</span>;
  if (result.isError || !result.data)
    return (
      <span className="text-[11px] text-gray-400">
        받았는지 확인하지 못했습니다
      </span>
    );
  const good = result.data.outcome === 'kakao' || result.data.outcome === 'sms';
  return (
    <span
      className={cn(
        'text-[11px] font-medium',
        good ? 'text-emerald-700' : 'text-gray-600'
      )}
    >
      → {autoSendOutcomeLabel(result.data)}
    </span>
  );
}

function CaseStory({
  c,
  statuses,
}: {
  c: RecoveryCase;
  statuses?: Map<string, MembershipNoticeStatus>;
}) {
  const noticeOf = (attemptNo: number) =>
    c.attemptNotices.find((n) => n.attemptNo === attemptNo) ?? null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900">
          {c.kind === 'WITHDRAWAL'
            ? `${kstDay(c.startedAt)} 청구`
            : '계좌 등록'}
        </p>
        <span className="flex items-center gap-1">
          {c.era === 'BEFORE_POLICY' && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              미납 정책 시행 전
            </span>
          )}
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
            {caseNowLabel(c)}
          </span>
        </span>
      </div>
      <ol className="ml-1.5 border-l border-gray-200">
        {c.failures.map((f, i) => {
          const notice = noticeOf(f.attemptNo);
          const ref = c.invoiceId ? attemptRef(c.invoiceId, f.attemptNo) : null;
          const last = i === c.failures.length - 1;
          return (
            <Step
              key={f.attemptNo}
              dot="bad"
              title={`${f.attemptNo}번째 출금 실패`}
              when={kstDayTime(f.at)}
            >
              {last && (
                <span className="text-xs text-gray-600">
                  {failureReason(c)}
                </span>
              )}
              {f.attemptNo < 3 ? (
                <>
                  <NoticeChip
                    badge={noticeBadge(
                      notice,
                      ref,
                      statuses,
                      c.attemptNoticesBeforePolicy.includes(f.attemptNo)
                    )}
                  />
                  {notice?.state === 'QUEUED' && ref && (
                    <Delivery status={statuses?.get(ref)} />
                  )}
                </>
              ) : (
                <span className="text-[11px] text-gray-400">
                  마지막 실패는 해지 안내가 대신합니다
                </span>
              )}
            </Step>
          );
        })}

        {c.stage === 'RETRYING' && c.nextAttempt && (
          <Step
            dot="wait"
            title={`${c.attempts + 1}번째 출금 예정`}
            when={`${kstDay(c.nextAttempt.at)}${c.nextAttempt.estimated ? ' (짐작)' : ''}`}
          >
            <span className="text-xs text-gray-600">
              {c.remainingAttempts <= 1
                ? '이번이 마지막 기회 — 실패하면 해지됩니다'
                : `남은 기회 ${c.remainingAttempts}번`}
            </span>
          </Step>
        )}
        {c.stage === 'AWAITING_RESULT' && (
          <Step dot="wait" title="결과가 오지 않음">
            <span className="text-xs text-gray-600">
              마지막 실패 뒤 일주일 넘게 성공·해지 소식이 없습니다. 정기결제
              관리에서 청구 상태를 확인하세요.
            </span>
          </Step>
        )}
        {c.stage === 'RECOVERED' && c.recoveredAt && (
          <Step
            dot="good"
            title="재시도로 받음"
            when={kstDayTime(c.recoveredAt)}
          >
            <span className="text-xs text-gray-600">
              {c.recoveredAmount != null
                ? won(c.recoveredAmount)
                : '금액 기록 없음'}{' '}
              · 첫 실패부터 {daysBetween(c.startedAt, c.recoveredAt)}일 만에
            </span>
          </Step>
        )}
        {c.stage === 'ENDED_OTHER' && (
          <Step dot="muted" title="결과 전에 계약이 끝남">
            <span className="text-xs text-gray-600">
              본인 해지 등 다른 이유로 끝나 미납 대상이 아닙니다.
            </span>
          </Step>
        )}
        {c.terminatedAt && (
          <Step
            dot={c.finalNoticeExpected ? 'bad' : 'muted'}
            title={terminationLabel(c)}
            when={kstDayTime(c.terminatedAt)}
          >
            {c.kind === 'MANDATE' && (
              <span className="text-xs text-gray-600">{failureReason(c)}</span>
            )}
            {!c.finalNoticeExpected &&
              (c.terminationKind === 'EXHAUSTED' ||
                c.terminationKind === 'MANDATE_REJECTED') && (
                <NoticeChip
                  prefix="해지 안내"
                  badge={{
                    tone: 'muted',
                    text: '시행 전 해지라 알림 대상 아님',
                  }}
                />
              )}
            {c.finalNoticeExpected && (
              <>
                <NoticeChip
                  prefix="해지 안내"
                  badge={noticeBadge(
                    c.finalNotice,
                    terminatedRef(c.contractId),
                    statuses
                  )}
                />
                {c.finalNotice?.state === 'QUEUED' && (
                  <Delivery
                    status={statuses?.get(terminatedRef(c.contractId))}
                  />
                )}
              </>
            )}
          </Step>
        )}
        {c.debtState === 'NOT_RECORDED' && (
          <Step dot="muted" title="미납으로 남기지 않음">
            <span className="text-xs text-gray-600">
              {NOT_RECORDED_LABEL[c.arrearsSkippedReason ?? 'UNRECORDED'] ??
                c.arrearsSkippedReason}
            </span>
          </Step>
        )}
        {c.arrears && (
          <Step
            dot="bad"
            title={`미납 ${won(c.arrears.amount)} 생김`}
            when={kstDayTime(c.arrears.createdAt)}
          />
        )}
        {c.debtState === 'PAYING' && (
          <Step dot="info" title="고객이 납부를 시작함 · 입금 대기">
            <span className="text-xs text-gray-600">
              무통장 입금이 확인되면 자동으로 정리됩니다.
            </span>
          </Step>
        )}
        {c.debtState === 'OUTSTANDING' && c.arrears && (
          <Step
            dot="bad"
            title="아직 남음"
            when={`${daysBetween(c.arrears.createdAt, new Date().toISOString())}일째`}
          />
        )}
        {c.debtState === 'SETTLED' && c.arrears?.settledAt && (
          <Step
            dot="good"
            title="미납을 받음"
            when={kstDayTime(c.arrears.settledAt)}
          >
            <span className="text-xs text-gray-600">
              {daysBetween(c.arrears.createdAt, c.arrears.settledAt)}일 만에
            </span>
          </Step>
        )}
        {c.debtState === 'WAIVED' && (
          <Step
            dot="muted"
            title="면제함"
            when={
              c.arrears?.settledAt ? kstDayTime(c.arrears.settledAt) : undefined
            }
          />
        )}
      </ol>
    </div>
  );
}

/** 카드를 눌렀을 때 — 그 사람의 출금 실패·미납 이야기 전부. 면제·금액 조정은 회원 상세 미납 탭에서 한다. */
export function RecoveryJourneySheet({
  userId,
  onClose,
}: {
  userId: string | null;
  onClose: () => void;
}) {
  const names = useContext(UserNamesContext);
  const journey = useBillingRecoveryJourney(userId);
  const cases = journey.data?.cases ?? [];
  const statuses = useMembershipNoticeStatuses(noticeLookupFor(cases, []));
  const [showDetail, setShowDetail] = useState(false);
  const user = userId ? names[userId] : undefined;
  const owed = cases
    .filter((c) => c.debtState === 'OUTSTANDING' || c.debtState === 'PAYING')
    .reduce((sum, c) => sum + (c.arrears?.amount ?? 0), 0);

  return (
    <Sheet
      open={!!userId}
      onOpenChange={(open) => {
        if (!open) {
          setShowDetail(false);
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>
            {user?.username || user?.loginId || '회원'}의 출금·미납 이야기
          </SheetTitle>
          <SheetDescription>
            {owed > 0 ? `지금 받을 돈 ${won(owed)}` : '지금 남은 미납 없음'}
            {user?.loginId ? ` · ${user.loginId}` : ''}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-6">
          {journey.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : journey.isError ? (
            <p className="text-sm text-destructive">
              이야기를 불러오지 못했습니다.
            </p>
          ) : cases.length === 0 ? (
            <p className="text-sm text-gray-500">
              출금 실패나 계좌 거절 기록이 없습니다.
            </p>
          ) : (
            cases.map((c) => (
              <CaseStory
                key={`${c.contractId}:${c.invoiceId ?? c.startedAt}`}
                c={c}
                statuses={statuses.data}
              />
            ))
          )}
          {statuses.isError && (
            <p className="text-[11px] text-gray-400">
              알림 서비스에 물어보지 못해 «보냄»까지만 보입니다.
            </p>
          )}
          {userId && (
            <div className="border-t border-gray-100 pt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDetail((v) => !v)}
              >
                <ExternalLink className="mr-1 size-3.5" />
                {showDetail ? '회원 상세 접기' : '회원 상세 · 미납 면제/조정'}
              </Button>
              {showDetail && (
                <div className="mt-3">
                  <MembershipDetailPanel userId={userId} initialTab="arrears" />
                </div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
