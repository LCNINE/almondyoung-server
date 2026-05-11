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
import { DatePreset, DATE_PRESET_OPTIONS, computeDateRange } from '@/lib/utils/date';

type StatusOption = '' | 'ACTIVE' | 'PAUSED' | 'RECURRING_CANCELLED' | 'EXPIRED' | 'CANCELLED';
type SearchType = 'userId' | 'member';

interface FilterState {
  dateType: string;
  datePreset: DatePreset;
  dateFrom: string;
  dateTo: string;
  searchType: SearchType;
  q: string;
  memberQ: string;
  status: StatusOption;
}

const DATE_TYPE_OPTIONS = [
  { value: 'createdAt', label: '가입일' },
];

const STATUS_OPTIONS = [
  { value: '', label: '전체' },
  { value: 'ACTIVE', label: '활성화' },
  { value: 'PAUSED', label: '일시정지' },
  { value: 'RECURRING_CANCELLED', label: '자동결제 취소' },
  { value: 'EXPIRED', label: '만료' },
  { value: 'CANCELLED', label: '해지' },
];

export function MembershipMemberFilterBox() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<FilterState>({
    dateType: 'createdAt',
    datePreset: (searchParams.get('datePreset') as DatePreset) ?? 'all',
    dateFrom: searchParams.get('dateFrom') ?? '',
    dateTo: searchParams.get('dateTo') ?? '',
    searchType: searchParams.get('memberQ') ? 'member' : 'userId',
    q: searchParams.get('q') ?? '',
    memberQ: searchParams.get('memberQ') ?? '',
    status: (searchParams.get('status') as StatusOption) ?? '',
  });

  const handleSearch = () => {
    const params = new URLSearchParams();
    params.set('page', '1');
    if (filters.searchType === 'userId' && filters.q) params.set('q', filters.q);
    if (filters.searchType === 'member' && filters.memberQ) params.set('memberQ', filters.memberQ);
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
    if (filters.datePreset && filters.datePreset !== 'all') params.set('datePreset', filters.datePreset);

    router.replace(`${pathname}?${params.toString()}`);
  };

  const handleReset = () => {
    setFilters({ dateType: 'createdAt', datePreset: 'all', dateFrom: '', dateTo: '', searchType: 'userId', q: '', memberQ: '', status: '' });
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
