'use client';

import { ChevronRight, Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/ui';
import type { BillingRecoveryOverview } from '@/lib/api/domains/membership/recovery';
import {
  FlowNodeKey,
  NOT_RECORDED_LABEL,
  NOTICE_SKIP_LABEL,
  monthLabel,
  won,
} from '../lib/recovery-view';
import { SectionTitle } from './shared';

type Tone = 'neutral' | 'good' | 'wait' | 'bad' | 'info' | 'muted';

const TONE: Record<Tone, { bar: string; text: string }> = {
  neutral: { bar: 'bg-slate-500', text: 'text-gray-900' },
  good: { bar: 'bg-emerald-500', text: 'text-emerald-700' },
  wait: { bar: 'bg-amber-400', text: 'text-amber-700' },
  bad: { bar: 'bg-red-500', text: 'text-red-700' },
  info: { bar: 'bg-sky-500', text: 'text-sky-700' },
  muted: { bar: 'bg-gray-300', text: 'text-gray-500' },
};

interface NodeSpec {
  key: FlowNodeKey;
  label: string;
  cases: number;
  /** 금액 표기. 없으면 건수만 */
  amount?: string;
  tone: Tone;
  /** 같은 열 안에서 막대 길이를 정하는 몫(0~1) */
  share: number;
  note?: string;
}

function FlowNode({
  node,
  selected,
  onSelect,
}: {
  node: NodeSpec;
  selected: boolean;
  onSelect: (k: FlowNodeKey | null) => void;
}) {
  const tone = TONE[node.tone];
  const empty = node.cases === 0;
  return (
    <button
      type="button"
      disabled={empty}
      aria-pressed={selected}
      onClick={() => onSelect(selected ? null : node.key)}
      className={cn(
        'w-full rounded-lg border bg-white px-3 py-2 text-left transition-colors',
        empty
          ? 'cursor-default border-dashed border-gray-200 opacity-60'
          : 'hover:bg-gray-50',
        selected
          ? 'border-gray-900 ring-1 ring-gray-900'
          : !empty && 'border-gray-200'
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-gray-600">{node.label}</span>
        <span className={cn('text-lg font-bold tabular-nums', tone.text)}>
          {node.cases}건
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={cn('h-full rounded-full', tone.bar)}
          style={{ width: `${Math.round(node.share * 100)}%` }}
        />
      </div>
      {(node.amount || node.note) && (
        <p className="mt-1 text-[11px] leading-snug text-gray-500 break-keep">
          {node.amount}
          {node.amount && node.note ? ' · ' : ''}
          {node.note}
        </p>
      )}
    </button>
  );
}

function Column({
  title,
  hint,
  nodes,
  selected,
  onSelect,
}: {
  title: string;
  hint?: string;
  nodes: NodeSpec[];
  selected: FlowNodeKey | null;
  onSelect: (k: FlowNodeKey | null) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="flex items-center gap-1 text-xs font-semibold text-gray-500">
        {title}
        {hint && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`${title} 설명`}
                className="text-gray-400"
              >
                <Info className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs leading-relaxed">
              {hint}
            </TooltipContent>
          </Tooltip>
        )}
      </p>
      {nodes.map((n) => (
        <FlowNode
          key={n.key}
          node={n}
          selected={selected === n.key}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

const Arrow = () => (
  <div
    className="hidden items-center justify-center text-gray-300 lg:flex"
    aria-hidden
  >
    <ChevronRight className="size-6" />
  </div>
);

const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

/**
 * 돈의 흐름 — 고른 달에 시작된 건이 «지금» 어디까지 갔는지. 칸을 누르면 그 건들이 아래 목록에 뜬다.
 * 모든 칸은 서버 퍼널의 같은 판정에서 나온다(칸끼리 정의가 갈리지 않게).
 */
export function RecoveryFlow({
  data,
  selected,
  onSelect,
}: {
  data: BillingRecoveryOverview;
  selected: FlowNodeKey | null;
  onSelect: (k: FlowNodeKey | null) => void;
}) {
  const f = data.funnel;
  const mandateAfterFailure = data.cohort.cases.filter(
    (c) => c.kind === 'WITHDRAWAL' && c.terminationKind === 'MANDATE_REJECTED'
  ).length;
  const mandateOnly = f.mandateRejected.cases - mandateAfterFailure;
  const startTotal = f.withdrawalFailed.cases + mandateOnly;
  const outcomeTotal =
    f.recovered.cases +
    f.retrying.cases +
    f.awaitingResult.cases +
    f.exhausted.cases +
    f.mandateRejected.cases +
    f.endedOther.cases +
    f.voided.cases;
  const terminated = f.exhausted.cases + f.mandateRejected.cases;
  const notRecordedCases = Object.values(f.debt.notRecorded).reduce(
    (a, b) => a + b,
    0
  );
  const debt = f.debt;
  const notRecordedNote = Object.entries(f.debt.notRecorded)
    .map(([k, n]) => `${NOT_RECORDED_LABEL[k] ?? k} ${n}`)
    .join(' · ');
  const skipped = Object.entries(f.notices.skippedReasons)
    .map(([k, n]) => `${NOTICE_SKIP_LABEL[k] ?? k} ${n}`)
    .join(' · ');

  const start: NodeSpec[] = [
    {
      key: 'failed',
      label: '출금 실패',
      cases: f.withdrawalFailed.cases,
      amount:
        f.withdrawalFailed.cases > 0
          ? `약 ${won(f.withdrawalFailed.amount)}`
          : undefined,
      note:
        f.withdrawalFailed.people > 0
          ? `${f.withdrawalFailed.people}명`
          : undefined,
      tone: 'neutral',
      share: share(f.withdrawalFailed.cases, startTotal),
    },
    {
      key: 'mandateOnly',
      label: '출금 전 계좌 거절',
      cases: mandateOnly,
      tone: 'bad',
      share: share(mandateOnly, startTotal),
      note: '계좌 심사가 거절돼 출금해 보지도 못함',
    },
  ];

  const outcome: NodeSpec[] = [
    {
      key: 'recovered',
      label: '재시도로 받음',
      cases: f.recovered.cases,
      amount: f.recovered.cases > 0 ? won(f.recovered.amount) : undefined,
      note:
        f.recovered.amountUnknownCases > 0
          ? `금액 기록 없는 ${f.recovered.amountUnknownCases}건 별도`
          : undefined,
      tone: 'good',
      share: share(f.recovered.cases, outcomeTotal),
    },
    {
      key: 'retrying',
      label: '아직 재시도 중',
      cases: f.retrying.cases,
      note:
        f.retrying.lastChance > 0
          ? `마지막 기회 ${f.retrying.lastChance}건`
          : undefined,
      tone: 'wait',
      share: share(f.retrying.cases, outcomeTotal),
    },
    {
      key: 'exhausted',
      label: '끝내 실패 → 해지',
      cases: f.exhausted.cases,
      tone: 'bad',
      share: share(f.exhausted.cases, outcomeTotal),
    },
    {
      key: 'mandate',
      label: '계좌 거절 → 해지',
      cases: f.mandateRejected.cases,
      note:
        mandateAfterFailure > 0
          ? `출금 실패 뒤 거절 ${mandateAfterFailure}건 포함`
          : undefined,
      tone: 'bad',
      share: share(f.mandateRejected.cases, outcomeTotal),
    },
  ];
  if (f.awaitingResult.cases > 0)
    outcome.push({
      key: 'awaitingResult',
      label: '결과가 안 옴',
      cases: f.awaitingResult.cases,
      note: '마지막 실패 뒤 일주일 넘게 성공·해지 소식이 없음 — 확인 필요',
      tone: 'wait',
      share: share(f.awaitingResult.cases, outcomeTotal),
    });
  if (f.endedOther.cases + f.voided.cases > 0)
    outcome.push({
      key: 'endedOther',
      label: '계약이 먼저 끝남',
      cases: f.endedOther.cases + f.voided.cases,
      note: '본인 해지·청구 취소 등 — 못 걷은 해지가 아니라 미납 대상이 아님',
      tone: 'muted',
      share: share(f.endedOther.cases + f.voided.cases, outcomeTotal),
    });

  const afterTermination: NodeSpec[] = [
    {
      key: 'debtRecorded',
      label: '미납으로 남김',
      cases: debt.recorded.cases,
      amount: debt.recorded.cases > 0 ? won(debt.recorded.amount) : undefined,
      tone: 'bad',
      share: share(debt.recorded.cases, terminated),
    },
    {
      key: 'notRecorded',
      label: '미납 없이 끝남',
      cases: notRecordedCases,
      note: notRecordedNote || undefined,
      tone: 'muted',
      share: share(notRecordedCases, terminated),
    },
  ];

  const debtTotal = debt.recorded.cases;
  const debtFate: NodeSpec[] = [
    {
      key: 'settled',
      label: '받음',
      cases: debt.settled.cases,
      amount: debt.settled.cases ? won(debt.settled.amount) : undefined,
      tone: 'good',
      share: share(debt.settled.cases, debtTotal),
    },
    {
      key: 'paying',
      label: '입금 대기',
      cases: debt.paying.cases,
      amount: debt.paying.cases ? won(debt.paying.amount) : undefined,
      note: '고객이 납부를 시작함',
      tone: 'info',
      share: share(debt.paying.cases, debtTotal),
    },
    {
      key: 'outstanding',
      label: '아직 남음',
      cases: debt.outstanding.cases,
      amount: debt.outstanding.cases ? won(debt.outstanding.amount) : undefined,
      tone: 'bad',
      share: share(debt.outstanding.cases, debtTotal),
    },
    {
      key: 'waived',
      label: '면제',
      cases: debt.waived.cases,
      amount: debt.waived.cases ? won(debt.waived.amount) : undefined,
      tone: 'muted',
      share: share(debt.waived.cases, debtTotal),
    },
  ];

  return (
    <section aria-label="돈의 흐름">
      <SectionTitle
        title="돈의 흐름"
        sub={`${monthLabel(data.period.month)}에 시작된 건이 지금 어디까지 갔는지 · 칸을 누르면 그 사람들`}
      />
      <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
          <Column
            title="① 시작"
            hint="출금 실패 = 인보이스 하나의 출금이 한 번 이상 실패한 건(같은 청구의 재시도는 한 건). 금액은 요금제 정가로 짐작한 값이다."
            nodes={start}
            selected={selected}
            onSelect={onSelect}
          />
          <Arrow />
          <Column
            title="② 재시도 결과"
            hint="출금은 이틀 간격으로 최대 3번 시도한다. 3번 모두 실패하면 해지된다."
            nodes={outcome}
            selected={selected}
            onSelect={onSelect}
          />
          <Arrow />
          <Column
            title="③ 해지 뒤"
            hint="해지된 건 중 이용권을 쓴 기간은 미납으로 남는다. 청약철회 대상(7일 안·혜택 안 씀)이나 새 약관 동의 전 계약은 남기지 않는다."
            nodes={afterTermination}
            selected={selected}
            onSelect={onSelect}
          />
          <Arrow />
          <Column
            title="④ 미납의 행방"
            hint="미납은 무통장 입금으로만 받는다. 다 갚기 전에는 어떤 결제로도 다시 가입할 수 없다."
            nodes={debtFate}
            selected={selected}
            onSelect={onSelect}
          />
        </div>
        <p className="mt-3 border-t border-gray-200 pt-2 text-xs text-gray-500 break-keep">
          고객 알림 — 출금 실패 안내 보냄 {f.notices.attempt.queued} · 못 보냄{' '}
          {f.notices.attempt.skipped} · 기록 없음 {f.notices.attempt.missing}{' '}
          &nbsp;|&nbsp; 해지 안내 보냄 {f.notices.final.queued} · 못 보냄{' '}
          {f.notices.final.skipped} · 기록 없음 {f.notices.final.missing}
          {skipped && <> &nbsp;|&nbsp; 못 보낸 이유: {skipped}</>}
          {data.cohort.truncated && <> &nbsp;|&nbsp; 목록은 앞의 500건만</>}
        </p>
      </div>
    </section>
  );
}
