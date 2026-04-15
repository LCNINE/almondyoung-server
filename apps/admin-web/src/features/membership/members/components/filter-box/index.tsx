'use client';

import { useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import {
  FilterLayout,
  FormField,
  FormSelect,
  FormInput,
  FormRadioGroup,
  FormDateRangePicker,
} from '@/components/common/form';
import { Button } from '@/components/ui/button';
import { startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns';

type DatePreset = 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'quarter' | 'custom';
type StatusOption = '' | 'ACTIVE' | 'EXPIRED' | 'PAUSED' | 'CANCELLED';

interface FilterState {
  dateType: string;
  datePreset: DatePreset;
  dateFrom: string;
  dateTo: string;
  q: string;
  status: StatusOption;
}

const DATE_TYPE_OPTIONS = [
  { value: 'createdAt', label: '가입일' },
];

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

const STATUS_OPTIONS = [
  { value: '', label: '전체' },
  { value: 'ACTIVE', label: '활성화' },
  { value: 'EXPIRED', label: '만료' },
  { value: 'PAUSED', label: '일시정지' },
  { value: 'CANCELLED', label: '해지' },
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

export function MembershipMemberFilterBox() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<FilterState>({
    dateType: 'createdAt',
    datePreset: (searchParams.get('datePreset') as DatePreset) ?? 'all',
    dateFrom: searchParams.get('dateFrom') ?? '',
    dateTo: searchParams.get('dateTo') ?? '',
    q: searchParams.get('q') ?? '',
    status: (searchParams.get('status') as StatusOption) ?? '',
  });

  const handleSearch = () => {
    const params = new URLSearchParams();
    params.set('page', '1');
    if (filters.q) params.set('q', filters.q);
    if (filters.status) params.set('status', filters.status);

    let from = filters.dateFrom;
    let to = filters.dateTo;
    if (filters.datePreset !== 'all' && filters.datePreset !== 'custom') {
      const range = computeDateRange(filters.datePreset);
      if (range) {
        from = range.from;
        to = range.to;
      }
    }
    if (from) params.set('dateFrom', from);
    if (to) params.set('dateTo', to);
    if (filters.datePreset) params.set('datePreset', filters.datePreset);

    router.replace(`${pathname}?${params.toString()}`);
  };

  const handleReset = () => {
    setFilters({ dateType: 'createdAt', datePreset: 'all', dateFrom: '', dateTo: '', q: '', status: '' });
    router.replace(pathname);
  };

  return (
    <div className="mb-4 space-y-3 rounded-[10px] border border-[#D9D9D9] bg-[#F5F5F5] p-4">
      {/* Row 1: 일자 */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="w-32 shrink-0">
          <FormField label="일자" direction="horizontal">
            <FormSelect
              value={filters.dateType}
              onValueChange={(v) => setFilters((p) => ({ ...p, dateType: v }))}
              options={DATE_TYPE_OPTIONS}
            />
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

      {/* Custom date range */}
      {filters.datePreset === 'custom' && (
        <div className="ml-36">
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

      {/* Row 2: 검색어 */}
      <div className="flex flex-wrap gap-4">
        <div className="w-64">
          <FormField label="자사몰 아이디" direction="horizontal">
            <FormInput
              placeholder="아이디 검색"
              value={filters.q}
              onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </FormField>
        </div>
        <div className="w-64">
          <FormField label="고객 성함" direction="horizontal">
            <FormInput placeholder="성함 검색 (미지원)" disabled />
          </FormField>
        </div>
      </div>

      {/* Row 3: 활성화 여부 */}
      <div className="flex items-center gap-4">
        <FormField label="활성화 여부" direction="horizontal">
          <FormRadioGroup
            value={filters.status}
            onValueChange={(v) => setFilters((p) => ({ ...p, status: v as StatusOption }))}
            options={STATUS_OPTIONS}
            orientation="horizontal"
          />
        </FormField>
      </div>

      {/* Search button */}
      <div className="flex justify-center gap-2 pt-1">
        <Button
          onClick={handleSearch}
          className="h-9 w-28 bg-orange-500 text-white hover:bg-orange-600"
        >
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
