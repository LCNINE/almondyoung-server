'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import { parseDateRangeParam } from '@/hooks/table/query/date-range-param';
import { CLAIM_IN_PROGRESS } from '@/lib/api/domains/return-exchange';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ReturnRequestsTable } from '../components/return-requests-table';
import { ExchangeRequestsTable } from '../components/exchange-requests-table';

const RETURN_STATUSES = [
  { value: '', label: '전체' },
  { value: 'requested', label: '신청' },
  { value: CLAIM_IN_PROGRESS, label: '처리중 (승인~환불 대기)' },
  { value: 'approved', label: '승인' },
  { value: 'rejected', label: '거절' },
  { value: 'collection_pending', label: '수거 대기' },
  { value: 'collected', label: '수거 완료' },
  { value: 'inspected', label: '검수 완료' },
  { value: 'completed', label: '완료' },
];

const EXCHANGE_STATUSES = [
  { value: '', label: '전체' },
  { value: 'requested', label: '신청' },
  { value: CLAIM_IN_PROGRESS, label: '처리중 (승인~환불 대기)' },
  { value: 'approved', label: '승인' },
  { value: 'rejected', label: '거절' },
  { value: 'collected', label: '수거 완료' },
  { value: 'inspected', label: '검수 완료' },
  { value: 'completed', label: '완료' },
];

type Tab = 'returns' | 'exchanges';

const KST_DATE = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' });

function dateRangeLabel(from?: string, to?: string) {
  const start = from ? KST_DATE.format(new Date(from)) : undefined;
  const end = to ? KST_DATE.format(new Date(to)) : undefined;
  if (start && end) return start === end ? start : `${start} ~ ${end}`;
  return start ? `${start} ~` : `~ ${end}`;
}

export default function ReturnExchangeTemplate() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab: Tab = searchParams.get('tab') === 'exchanges' ? 'exchanges' : 'returns';
  const status = searchParams.get('status') ?? '';
  const createdAt = searchParams.get('createdAt') ?? undefined;
  const { from: createdFrom, to: createdTo } = parseDateRangeParam(createdAt);
  const [returnPage, setReturnPage] = useState(1);
  const [exchangePage, setExchangePage] = useState(1);

  const updateParams = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    setReturnPage(1);
    setExchangePage(1);
  };

  const handleStatusChange = (value: string) => updateParams({ status: value === 'all' ? undefined : value });
  const handleTabChange = (value: string) =>
    updateParams({ tab: value === 'exchanges' ? 'exchanges' : undefined, status: undefined });

  const dateChip =
    createdFrom || createdTo ? (
      <span className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700">
        접수일 {dateRangeLabel(createdFrom, createdTo)}
        <button
          type="button"
          aria-label="접수일 조건 지우기"
          onClick={() => updateParams({ createdAt: undefined })}
          className="cursor-pointer text-gray-400 hover:text-gray-700"
        >
          <X className="h-3 w-3" />
        </button>
      </span>
    ) : null;

  const statusSelect = (options: typeof RETURN_STATUSES) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">상태 필터</span>
      <Select value={status || 'all'} onValueChange={handleStatusChange}>
        <SelectTrigger className="w-[200px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((s) => (
            <SelectItem key={s.value || 'all'} value={s.value || 'all'}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {dateChip}
    </div>
  );

  return (
    <Container>
      <Header title="반품/교환 관리" />
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="mb-4">
          <TabsTrigger value="returns">반품 요청</TabsTrigger>
          <TabsTrigger value="exchanges">교환 요청</TabsTrigger>
        </TabsList>

        <TabsContent value="returns" className="space-y-3">
          {statusSelect(RETURN_STATUSES)}
          <ReturnRequestsTable
            statusFilter={status || undefined}
            createdFrom={createdFrom}
            createdTo={createdTo}
            page={returnPage}
            onPageChange={setReturnPage}
          />
        </TabsContent>

        <TabsContent value="exchanges" className="space-y-3">
          {statusSelect(EXCHANGE_STATUSES)}
          <ExchangeRequestsTable
            statusFilter={status || undefined}
            createdFrom={createdFrom}
            createdTo={createdTo}
            page={exchangePage}
            onPageChange={setExchangePage}
          />
        </TabsContent>
      </Tabs>
    </Container>
  );
}
