'use client';

import { ReactNode } from 'react';
import {
  AlertOctagon,
  BellOff,
  CircleDollarSign,
  Hourglass,
  Landmark,
  Scale,
} from 'lucide-react';
import { cn } from '@/lib/utils/ui';
import type {
  BillingRecoveryOverview,
  RecoveryAlertKey,
} from '@/lib/api/domains/membership/recovery';

const ALERTS: Array<{
  key: RecoveryAlertKey;
  label: string;
  icon: ReactNode;
  tone: 'red' | 'amber' | 'sky';
}> = [
  {
    key: 'lastChance',
    label: '다음 출금이 마지막 기회',
    icon: <AlertOctagon className="size-4" />,
    tone: 'red',
  },
  {
    key: 'noticeSkipped',
    label: '알림을 못 보낸 사람',
    icon: <BellOff className="size-4" />,
    tone: 'red',
  },
  {
    key: 'oldDebt',
    label: '30일 넘은 미납',
    icon: <Landmark className="size-4" />,
    tone: 'amber',
  },
  {
    key: 'awaitingResult',
    label: '출금 결과가 안 옴',
    icon: <Hourglass className="size-4" />,
    tone: 'amber',
  },
  {
    key: 'paying',
    label: '입금 대기 중',
    icon: <CircleDollarSign className="size-4" />,
    tone: 'sky',
  },
  {
    key: 'mismatch',
    label: '납부 금액이 안 맞음',
    icon: <Scale className="size-4" />,
    tone: 'amber',
  },
];

const TONE = {
  red: 'border-red-200 bg-red-50 text-red-800',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  sky: 'border-sky-200 bg-sky-50 text-sky-800',
};

/** 「오늘 볼 것」 — 지금 손이 가야 하는 사람들. 누르면 아래 보드가 그 사람들만 남긴다. */
export function RecoveryAlerts({
  data,
  active,
  onToggle,
}: {
  data: BillingRecoveryOverview;
  active: RecoveryAlertKey | null;
  onToggle: (key: RecoveryAlertKey | null) => void;
}) {
  const visible = ALERTS.filter((a) => data.now.alerts[a.key].people > 0);
  if (visible.length === 0) {
    return (
      <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
        오늘 따로 챙길 사람이 없습니다.
      </p>
    );
  }
  return (
    <section
      aria-label="오늘 볼 것"
      className="flex flex-wrap items-center gap-2"
    >
      <span className="mr-1 text-sm font-semibold text-gray-900">
        오늘 볼 것
      </span>
      {visible.map((a) => {
        const selected = active === a.key;
        return (
          <button
            key={a.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onToggle(selected ? null : a.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-shadow',
              TONE[a.tone],
              selected
                ? 'ring-2 ring-gray-900 ring-offset-1'
                : 'hover:shadow-sm'
            )}
          >
            {a.icon}
            {a.label}
            <span className="tabular-nums font-bold">
              {data.now.alerts[a.key].people}명
            </span>
          </button>
        );
      })}
      {active && (
        <button
          type="button"
          onClick={() => onToggle(null)}
          className="text-xs text-gray-500 underline underline-offset-2"
        >
          보드 필터 해제
        </button>
      )}
    </section>
  );
}
