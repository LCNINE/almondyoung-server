'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useUserNames } from '@/hooks/use-user-names';
import type { RecoveryAlertKey } from '@/lib/api/domains/membership/recovery';
import {
  useBillingRecovery,
  useMembershipNoticeStatuses,
} from '@/lib/services/membership';
import {
  currentKstMonth,
  monthOptions,
} from '@/features/membership/recurring-billing/lib/finance-view';
import { RecoveryAlerts } from '../components/alerts';
import { RecoveryBoard } from '../components/board';
import { RecoveryBriefing } from '../components/briefing';
import { RecoveryCaseList } from '../components/case-list';
import { RecoveryFlow } from '../components/flow';
import { RecoveryJourneySheet } from '../components/journey-sheet';
import { UserNamesContext } from '../components/shared';
import { RecoveryTrend } from '../components/trend';
import {
  FlowNodeKey,
  PolicyScope,
  inFlowNode,
  kstDayTime,
  noticeLookupFor,
  policyDayLabel,
  scopedOverview,
} from '../lib/recovery-view';

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

const NODE_TITLE: Record<FlowNodeKey, string> = {
  failed: '출금이 실패한 건',
  mandateOnly: '출금 전 계좌 거절로 해지된 건',
  recovered: '재시도로 받은 건',
  retrying: '아직 재시도 중인 건',
  awaitingResult: '결과가 오지 않은 건',
  endedOther: '계약이 먼저 끝난 건',
  exhausted: '끝내 실패해 해지된 건',
  mandate: '계좌 거절로 해지된 건',
  debtRecorded: '미납으로 남긴 건',
  notRecorded: '미납 없이 끝난 건',
  settled: '미납을 받은 건',
  paying: '입금을 기다리는 건',
  outstanding: '미납이 남은 건',
  waived: '미납을 면제한 건',
};

/**
 * 출금 실패·미납 처리 현황 — 관리자·경영자가 한눈에. 위에서 아래로 «얼마나(브리핑·지표) → 어디로(흐름) →
 * 누구를(오늘 볼 것·보드) → 추세(12주)» 순서다. 숫자와 카드는 서버의 같은 건 판정에서 나온다.
 */
export default function RecoveryTemplate() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const thisMonth = currentKstMonth();
  const requested = searchParams.get('month');
  const month = requested && MONTH_KEY.test(requested) ? requested : thisMonth;

  const overview = useBillingRecovery(month);
  const [scope, setScope] = useState<PolicyScope>('UNDER');
  const raw = overview.data;
  // 퍼널·브리핑은 고른 범위(정책 시행 후/전)로, 보드·경보·추이는 «지금»이라 그대로 쓴다
  const data = useMemo(
    () => (raw ? scopedOverview(raw, scope) : undefined),
    [raw, scope]
  );
  const [node, setNode] = useState<FlowNodeKey | null>(null);
  const [alertKey, setAlertKey] = useState<RecoveryAlertKey | null>(null);
  const [openUser, setOpenUser] = useState<string | null>(null);

  const changeMonth = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === thisMonth) params.delete('month');
    else params.set('month', value);
    setNode(null);
    setScope('UNDER');
    router.replace(`${pathname}?${params.toString()}`);
  };

  const nodeCases = useMemo(
    () =>
      data && node ? data.cohort.cases.filter((c) => inFlowNode(c, node)) : [],
    [data, node]
  );
  const filter = useMemo(
    () =>
      data && alertKey ? new Set(data.now.alerts[alertKey].userIds) : null,
    [data, alertKey]
  );

  const boardCases = useMemo(
    () =>
      data
        ? [
            ...data.now.lanes.firstFailure.cards,
            ...data.now.lanes.lastChance.cards,
          ]
        : [],
    [data]
  );
  const statuses = useMembershipNoticeStatuses(
    noticeLookupFor(boardCases, data?.now.lanes.outstanding.cards ?? [])
  );

  const visibleIds = useMemo(() => {
    if (!data) return [];
    const lanes = data.now.lanes;
    const ids = [
      ...lanes.firstFailure.cards,
      ...lanes.lastChance.cards,
      ...lanes.outstanding.cards,
      ...lanes.resolved.cards,
      ...nodeCases.slice(0, 50),
    ].map((x) => x.userId);
    if (filter) ids.push(...[...filter].slice(0, 30));
    if (openUser) ids.push(openUser);
    return [...new Set(ids)];
  }, [data, nodeCases, filter, openUser]);
  const names = useUserNames(visibleIds);

  return (
    <Container>
      <Header
        title="출금 실패·미납 현황"
        subtitle="출금이 실패한 순간부터 돈을 받을 때까지 — 누가 어디에 있고, 알림이 갔는지, 얼마를 받았는지 한 화면에서 봅니다."
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Select value={month} onValueChange={changeMonth}>
            <SelectTrigger
              className="h-9 w-[150px] bg-white"
              aria-label="시작된 달"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthOptions(thisMonth).map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => overview.refetch()}
            disabled={overview.isFetching}
          >
            <RefreshCw
              className={
                overview.isFetching
                  ? 'mr-1 size-3.5 animate-spin'
                  : 'mr-1 size-3.5'
              }
            />
            새로고침
          </Button>
          {data && (
            <span className="text-xs text-gray-500">
              {kstDayTime(data.asOf)} 기준
            </span>
          )}
        </div>
        <Link
          href="/membership/recurring-billing"
          className="text-xs text-gray-500 underline underline-offset-2"
        >
          청구·수금 전체는 정기결제 관리에서 →
        </Link>
      </div>

      {overview.isError ? (
        <div className="flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <span className="text-destructive">현황을 불러오지 못했습니다.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => overview.refetch()}
          >
            다시 시도
          </Button>
        </div>
      ) : !data ? (
        <div className="space-y-3">
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      ) : (
        <UserNamesContext.Provider value={names}>
          <div className="flex flex-col gap-6">
            {raw?.beforePolicy && (
              <PolicyScopeSwitch
                day={policyDayLabel(raw)}
                underCount={
                  raw.cohort.cases.filter((c) => c.era === 'UNDER_POLICY')
                    .length
                }
                beforeCount={
                  raw.cohort.cases.filter((c) => c.era === 'BEFORE_POLICY')
                    .length
                }
                scope={scope}
                onChange={(next) => {
                  setScope(next);
                  setNode(null);
                }}
              />
            )}
            <RecoveryBriefing data={data} scope={scope} />
            <div className="flex flex-col gap-3">
              <RecoveryFlow data={data} selected={node} onSelect={setNode} />
              {node && (
                <RecoveryCaseList
                  title={NODE_TITLE[node]}
                  cases={nodeCases}
                  onOpen={setOpenUser}
                  onClose={() => setNode(null)}
                />
              )}
            </div>
            <div className="flex flex-col gap-3">
              <RecoveryAlerts
                data={data}
                active={alertKey}
                onToggle={setAlertKey}
              />
              <RecoveryBoard
                data={data}
                statuses={statuses.data}
                filter={filter}
                onOpen={setOpenUser}
              />
              {statuses.isError && (
                <p className="text-[11px] text-gray-400">
                  알림 서비스에 물어보지 못해 카드의 알림은 «보냄»까지만
                  보입니다.
                </p>
              )}
              {data.now.legacyRetrying > 0 && (
                <p className="text-xs text-gray-500">
                  옛 결제 경로로 재시도 중인 계약 {data.now.legacyRetrying}건은
                  이 보드에 없습니다 — 정기결제 관리의 재시도 목록에서 보세요.
                </p>
              )}
            </div>
            <RecoveryTrend
              points={data.trend}
              policyAt={data.policy.effectiveAt}
            />
          </div>
          <RecoveryJourneySheet
            userId={openUser}
            onClose={() => setOpenUser(null)}
          />
        </UserNamesContext.Provider>
      )}
    </Container>
  );
}

/**
 * 미납 정책·고객 알림 시행일이 낀 달 — 시행 전 시작분은 알림·미납 대상이 아니었으므로 숫자를 섞지 않고 골라 본다.
 */
function PolicyScopeSwitch({
  day,
  underCount,
  beforeCount,
  scope,
  onChange,
}: {
  day: string | null;
  underCount: number;
  beforeCount: number;
  scope: PolicyScope;
  onChange: (scope: PolicyScope) => void;
}) {
  const option = (value: PolicyScope, text: string) => (
    <button
      type="button"
      aria-pressed={scope === value}
      onClick={() => onChange(value)}
      className={
        scope === value
          ? 'rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white'
          : 'rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100'
      }
    >
      {text}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-2.5">
      <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
        {option('UNDER', `정책 시행 후 시작 ${underCount}건`)}
        {option('BEFORE', `시행 전 시작 ${beforeCount}건`)}
      </div>
      <p className="text-xs text-amber-900 break-keep">
        {day ? `${day}부터` : '시행일부터'} 미납 요금·출금 실패 알림이
        시작됐습니다. 그 전에 시작된 건은 알림·미납 대상이 아니었으므로 숫자를
        따로 봅니다. 아래 «지금 누가 어디에»와 12주 흐름은 둘 다 포함합니다.
      </p>
    </div>
  );
}
