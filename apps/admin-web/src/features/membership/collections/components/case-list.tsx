'use client';

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RecoveryCase } from '@/lib/api/domains/membership/recovery';
import { caseNowLabel, failureReason, kstDay, won } from '../lib/recovery-view';
import { PersonName } from './shared';

const SHOW = 50;

/** 퍼널 칸을 눌렀을 때 — 그 칸에 해당하는 건들. 줄을 누르면 그 사람의 이야기가 열린다. */
export function RecoveryCaseList({
  title,
  cases,
  onOpen,
  onClose,
}: {
  title: string;
  cases: RecoveryCase[];
  onOpen: (userId: string) => void;
  onClose: () => void;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-xl border border-gray-900 bg-white shadow-sm"
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <p className="text-sm font-semibold text-gray-900">
          {title}{' '}
          <span className="font-normal text-gray-500">{cases.length}건</span>
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label="목록 닫기"
        >
          <X className="size-4" />
        </Button>
      </div>
      <ul className="divide-y divide-gray-100">
        {cases.slice(0, SHOW).map((c) => (
          <li key={`${c.contractId}:${c.invoiceId ?? c.startedAt}`}>
            <button
              type="button"
              onClick={() => onOpen(c.userId)}
              className="grid w-full grid-cols-[minmax(0,1.2fr)_auto_minmax(0,1.4fr)_auto] items-center gap-3 px-4 py-2 text-left text-sm hover:bg-gray-50"
            >
              <PersonName userId={c.userId} />
              <span className="text-xs tabular-nums text-gray-500">
                {kstDay(c.startedAt)} 시작
              </span>
              <span className="truncate text-xs text-gray-600">
                {caseNowLabel(c)}
                {c.kind === 'WITHDRAWAL' && ` · ${failureReason(c)}`}
              </span>
              <span className="text-right text-xs font-medium tabular-nums text-gray-900">
                {c.arrears
                  ? won(c.arrears.amount)
                  : c.recoveredAmount != null
                    ? won(c.recoveredAmount)
                    : `약 ${won(c.planPrice)}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {cases.length > SHOW && (
        <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
          앞의 {SHOW}건만 보입니다.
        </p>
      )}
    </section>
  );
}
