'use client';

import { useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import {
  FormField,
  FormInput,
  FormRadioGroup,
  FormDateRangePicker,
} from '@/components/common/form';
import { Button } from '@/components/ui/button';
import { DatePreset, DATE_PRESET_OPTIONS, computeDateRange } from '@/lib/utils/date';

interface FilterState {
  datePreset: DatePreset;
  dateFrom: string;
  dateTo: string;
  userId: string;
  contractId: string;
  eventType: string;
}

const EVENT_TYPE_OPTIONS = [
  { value: '', label: '전체' },
  { value: 'CHARGE_SUCCESS', label: '결제 성공' },
  { value: 'CHARGE_FAIL', label: '결제 실패' },
  { value: 'CHARGE_ATTEMPT', label: '결제 시도' },
];

export function BillingHistoryFilterBox() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<FilterState>({
    datePreset: (searchParams.get('datePreset') as DatePreset) ?? 'all',
    dateFrom: searchParams.get('dateFrom') ?? '',
    dateTo: searchParams.get('dateTo') ?? '',
    userId: searchParams.get('userId') ?? '',
    contractId: searchParams.get('contractId') ?? '',
    eventType: searchParams.get('eventType') ?? '',
  });

  const handleSearch = () => {
    const params = new URLSearchParams();
    params.set('page', '1');
    if (filters.userId) params.set('userId', filters.userId);
    if (filters.contractId) params.set('contractId', filters.contractId);
    if (filters.eventType) params.set('eventType', filters.eventType);

    let from = filters.dateFrom;
    let to = filters.dateTo;
    if (filters.datePreset !== 'all' && filters.datePreset !== 'custom') {
      const range = computeDateRange(filters.datePreset);
      if (range) { from = range.from; to = range.to; }
    }
    if (from) params.set('dateFrom', from);
    if (to) params.set('dateTo', to);
    if (filters.datePreset && filters.datePreset !== 'all') params.set('datePreset', filters.datePreset);

    router.replace(`${pathname}?${params.toString()}`);
  };

  const handleReset = () => {
    setFilters({ datePreset: 'all', dateFrom: '', dateTo: '', userId: '', contractId: '', eventType: '' });
    router.replace(pathname);
  };

  return (
    <div className="mb-4 space-y-3 rounded-[10px] border border-[#D9D9D9] bg-[#F5F5F5] p-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="w-24 shrink-0">
          <FormField label="일자" direction="horizontal">
            <span className="text-sm">결제일</span>
          </FormField>
        </div>
        <div className="flex-1">
          <FormRadioGroup
            value={filters.datePreset}
            onValueChange={(v) => setFilters((p) => ({ ...p, datePreset: v as DatePreset }))}
            options={DATE_PRESET_OPTIONS}
            orientation="horizontal"
          />
        </div>
      </div>

      {filters.datePreset === 'custom' && (
        <div className="ml-28">
          <FormField label="기간">
            <FormDateRangePicker
              value={
                filters.dateFrom
                  ? { from: new Date(filters.dateFrom), to: filters.dateTo ? new Date(filters.dateTo) : undefined }
                  : undefined
              }
              onChange={(range) =>
                setFilters((p) => ({
                  ...p,
                  dateFrom: range?.from ? range.from.toISOString().slice(0, 10) : '',
                  dateTo: range?.to ? range.to.toISOString().slice(0, 10) : '',
                }))
              }
            />
          </FormField>
        </div>
      )}

      <div className="flex items-center gap-4">
        <FormField label="결제 유형" direction="horizontal">
          <FormRadioGroup
            value={filters.eventType}
            onValueChange={(v) => setFilters((p) => ({ ...p, eventType: v }))}
            options={EVENT_TYPE_OPTIONS}
            orientation="horizontal"
          />
        </FormField>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-64">
          <FormField label="자사몰 아이디" direction="horizontal">
            <FormInput
              placeholder="userId 검색"
              value={filters.userId}
              onChange={(e) => setFilters((p) => ({ ...p, userId: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </FormField>
        </div>
        <div className="w-64">
          <FormField label="계약 ID" direction="horizontal">
            <FormInput
              placeholder="contractId 검색"
              value={filters.contractId}
              onChange={(e) => setFilters((p) => ({ ...p, contractId: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </FormField>
        </div>
      </div>

      <div className="flex justify-center gap-2 pt-1">
        <Button onClick={handleSearch} className="h-9 w-28 bg-orange-500 text-white hover:bg-orange-600">
          <Search className="mr-1.5 h-4 w-4" />
          검색
        </Button>
        <Button variant="outline" onClick={handleReset} className="h-9 w-20">
          초기화
        </Button>
      </div>
    </div>
  );
}
