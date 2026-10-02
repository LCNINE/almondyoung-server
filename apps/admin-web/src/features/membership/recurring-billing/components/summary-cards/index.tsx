'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { AdminRecurringBillingOverview } from '@/lib/types/dto/wallet';

type SummaryCardsProps = {
  overview: AdminRecurringBillingOverview;
};

type CardConfig = {
  label: string;
  hint: string;
  count: number;
  query: string;
};

/**
 * 운영자가 보는 작업함 — 숫자는 전부 «지금 그 상태인 건수»(기간 없음)다.
 * 「처리할 일」은 사람이 손대야 풀리는 것, 「진행 현황」은 기다리면 풀리는 것.
 * 누르면 그 목록으로 간다(링크 주소는 예전 카드와 같다).
 */
export function RecurringBillingSummaryCards({ overview }: SummaryCardsProps) {
  const router = useRouter();
  const pathname = usePathname();

  const todo: CardConfig[] = [
    {
      label: '처리 필요',
      hint: '심사 실패·동의자료 미등록·출금 실패·30분 넘은 결과 대기',
      count: overview.needsAction,
      query: 'view=needs-action&page=1',
    },
    {
      label: '심사 실패',
      hint: '자동이체 계좌 심사가 실패',
      count: overview.memberFailed,
      query: 'view=members&cmsMemberStatus=FAILED&page=1',
    },
    {
      label: '출금 실패',
      hint: '은행 출금이 실패한 건',
      count: overview.withdrawalFailed,
      query: 'view=withdrawals&withdrawalStatus=FAILED&page=1',
    },
    {
      label: '재시도 중',
      hint: '출금이 실패해 다시 시도할 청구',
      count: overview.invoicePastDue,
      query: 'view=invoices&status=PAST_DUE&page=1',
    },
    {
      label: '출금 최종 실패',
      hint: '재시도를 다 써서 미납으로 넘어간 청구',
      count: overview.invoiceUncollectible,
      query: 'view=invoices&status=UNCOLLECTIBLE&page=1',
    },
    {
      label: '계좌 심사 거절',
      hint: '계좌가 거절돼 걷지 못한 청구',
      count: overview.invoiceMandateRejected,
      query: 'view=invoices&status=MANDATE_REJECTED&page=1',
    },
  ];

  const progress: CardConfig[] = [
    {
      label: '결제수단 심사 중',
      hint: '은행 심사 결과 대기',
      count: overview.memberPending,
      query: 'view=members&cmsMemberStatus=PENDING&page=1',
    },
    {
      label: '출금 예약',
      hint: '은행에 출금을 요청해 둔 건',
      count: overview.withdrawalRequested,
      query: 'view=withdrawals&withdrawalStatus=REQUESTED&page=1',
    },
    {
      label: '출금 처리 중',
      hint: '은행이 처리 중인 건',
      count: overview.settlementPending,
      query: 'view=withdrawals&withdrawalStatus=PROCESSING&page=1',
    },
  ];

  const month = useSearchParams().get('month');
  const go = (query: string) => router.replace(`${pathname}?${query}${month ? `&month=${month}` : ''}`);

  return (
    <section aria-label="정기결제 작업함" className="mb-4 space-y-2">
      <h2 className="text-base font-semibold text-gray-900">
        오늘 처리할 일 <span className="text-sm font-normal text-gray-500">— 지금 그 상태인 건수, 누르면 목록</span>
      </h2>
      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {todo.map((card) => (
          <Card key={card.label} card={card} urgent={card.count > 0} onClick={go} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <span className="text-xs text-gray-500">진행 현황</span>
        {progress.map((card) => (
          <button
            key={card.label}
            type="button"
            onClick={() => go(card.query)}
            title={card.hint}
            className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            {card.label} <span className="font-semibold tabular-nums">{card.count.toLocaleString('ko-KR')}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Card({ card, urgent, onClick }: { card: CardConfig; urgent: boolean; onClick: (query: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick(card.query)}
      className={[
        'flex flex-col gap-1 rounded-lg border px-4 py-3 text-left transition-colors',
        urgent
          ? 'border-destructive/30 bg-destructive/5 hover:bg-destructive/10'
          : 'border-gray-200 bg-white hover:bg-gray-50',
      ].join(' ')}
    >
      <span className="text-xs text-gray-500">{card.label}</span>
      <span className={['text-2xl font-bold tabular-nums', urgent ? 'text-destructive' : 'text-gray-900'].join(' ')}>
        {card.count.toLocaleString('ko-KR')}
      </span>
      <span className="text-[11px] leading-snug text-gray-400 break-keep">{card.hint}</span>
    </button>
  );
}
