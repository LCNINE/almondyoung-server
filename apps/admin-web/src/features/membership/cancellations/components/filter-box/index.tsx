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
import { startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns';

type DatePreset = 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'quarter' | 'custom';
type SearchType = 'userId' | 'member';

interface FilterState {
  datePreset: DatePreset;
  dateFrom: string;
  dateTo: string;
  searchType: SearchType;
  q: string;
  memberQ: string;
}

const DATE_PRESET_OPTIONS = [
  { value: 'all', label: '전체' },
  { value: 'today', label: '오늘' },
  { value: 'yesterday', label: '어제' },
  { value: 'week', label: '일주일' },
  { value: 'month', label: '당월' },
  { value: 'lastMonth', label: '전월' },
  { value: 'quarter', label: '3개월' },
  { value: 'custom', label: '임의기간' },
];

function computeDateRange(preset: DatePreset): { from: string; to: string } | null {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  switch (preset) {
    case 'today':
      return { from: fmt(startOfDay(now)), to: fmt(endOfDay(now)) };
    case 'yesterday': {
      const y = subDays(now, 1);
      return { from: fmt(startOfDay(y)), to: fmt(endOfDay(y)) };
    }
    case 'week':
      return { from: fmt(startOfDay(subDays(now, 6))), to: fmt(endOfDay(now)) };
    case 'month':
      return { from: fmt(startOfMonth(now)), to: fmt(endOfMonth(now)) };
    case 'lastMonth': {
      const lm = subMonths(now, 1);
      return { from: fmt(startOfMonth(lm)), to: fmt(endOfMonth(lm)) };
    }
    case 'quarter':
      return { from: fmt(startOfDay(subMonths(now, 3))), to: fmt(endOfDay(now)) };
    default:
      return null;
  }
}

export function CancellationsFilterBox() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<FilterState>({
    datePreset: (searchParams.get('datePreset') as DatePreset) ?? 'all',
    dateFrom: searchParams.get('dateFrom') ?? '',
    dateTo: searchParams.get('dateTo') ?? '',
    searchType: searchParams.get('memberQ') ? 'member' : 'userId',
    q: searchParams.get('q') ?? '',
    memberQ: searchParams.get('memberQ') ?? '',
  });

  const handleSearch = () => {
    const params = new URLSearchParams();
    params.set('page', '1');
    if (filters.searchType === 'userId' && filters.q) params.set('q', filters.q);
    if (filters.searchType === 'member' && filters.memberQ) params.set('memberQ', filters.memberQ);

    let from = filters.dateFrom;
    let to = filters.dateTo;
    if (filters.datePreset !== 'all' && filters.datePreset !== 'custom') {
      const range = computeDateRange(filters.datePreset);
      if (range) { from = range.from; to = range.to; }
    }
    if (from) params.set('dateFrom', from);
    if (to) params.set('dateTo', to);
    if (filters.datePreset) params.set('datePreset', filters.datePreset);

    router.replace(`${pathname}?${params.toString()}`);
  };

  const handleReset = () => {
    setFilters({ datePreset: 'all', dateFrom: '', dateTo: '', searchType: 'userId', q: '', memberQ: '' });
    router.replace(pathname);
  };

  return (
    <div className="mb-4 space-y-3 rounded-[10px] border border-[#D9D9D9] bg-[#F5F5F5] p-4">
      {/* 일자 */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="w-24 shrink-0">
          <FormField label="일자" direction="horizontal">
            <span className="text-sm">가입일</span>
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

      {/* 검색어 */}
      <div className="flex flex-wrap items-end gap-4">
        <FormField label="검색 유형" direction="horizontal">
          <FormRadioGroup
            value={filters.searchType}
            onValueChange={(v) => setFilters((p) => ({ ...p, searchType: v as SearchType, q: '', memberQ: '' }))}
            options={[
              { value: 'userId', label: '자사몰 아이디' },
              { value: 'member', label: '고객 정보' },
            ]}
            orientation="horizontal"
          />
        </FormField>

        {filters.searchType === 'userId' ? (
          <div className="w-72">
            <FormInput
              placeholder="자사몰 UUID 검색"
              value={filters.q}
              onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
        ) : (
          <div className="w-72">
            <FormInput
              placeholder="성함 · 이메일 · 로그인 ID 검색"
              value={filters.memberQ}
              onChange={(e) => setFilters((p) => ({ ...p, memberQ: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
        )}
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
