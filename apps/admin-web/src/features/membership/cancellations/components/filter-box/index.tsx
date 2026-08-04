'use client';

import { useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import {
  FormField,
  FormInput,
  FormRadioGroup,
  FormDateRangePicker,
  FormSelect,
} from '@/components/common/form';
import { Button } from '@/components/ui/button';
import { DatePreset, DATE_PRESET_OPTIONS, computeDateRange, toLocalDateString } from '@/lib/utils/date';

type SearchType = 'userId' | 'member';
type DateCriteria = 'createdAt' | 'cancelledAt';
/** 해지 유형 — 즉시 종료된 건과 잔여기간을 쓰고 있는 예약 건은 CS 대응이 다르다. */
type CancelKind = 'ALL' | 'IMMEDIATE' | 'SCHEDULED';

interface FilterState {
  dateCriteria: DateCriteria;
  datePreset: DatePreset;
  dateFrom: string;
  dateTo: string;
  searchType: SearchType;
  q: string;
  memberQ: string;
  cancelKind: CancelKind;
  /** 환불 요청은 있는데 아직 돈이 안 나간 건만 */
  refundPending: boolean;
}

export function CancellationsFilterBox() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<FilterState>({
    dateCriteria: (searchParams.get('dateCriteria') as DateCriteria) ?? 'createdAt',
    datePreset: (searchParams.get('datePreset') as DatePreset) ?? 'all',
    dateFrom: searchParams.get('dateFrom') ?? '',
    dateTo: searchParams.get('dateTo') ?? '',
    searchType: searchParams.get('memberQ') ? 'member' : 'userId',
    q: searchParams.get('q') ?? '',
    memberQ: searchParams.get('memberQ') ?? '',
    cancelKind: (searchParams.get('cancelKind') as CancelKind) ?? 'ALL',
    refundPending: searchParams.get('refundPending') === 'true',
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
    if (filters.datePreset && filters.datePreset !== 'all') params.set('datePreset', filters.datePreset);
    if (filters.dateCriteria !== 'createdAt') params.set('dateCriteria', filters.dateCriteria);
    if (filters.cancelKind !== 'ALL') params.set('cancelKind', filters.cancelKind);
    if (filters.refundPending) params.set('refundPending', 'true');

    router.replace(`${pathname}?${params.toString()}`);
  };

  const handleReset = () => {
    setFilters({
      dateCriteria: 'createdAt',
      datePreset: 'all',
      dateFrom: '',
      dateTo: '',
      searchType: 'userId',
      q: '',
      memberQ: '',
      cancelKind: 'ALL',
      refundPending: false,
    });
    router.replace(pathname);
  };

  return (
    <div className="mb-4 space-y-3 rounded-[10px] border border-[#D9D9D9] bg-[#F5F5F5] p-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="w-24 shrink-0">
          <FormField label="일자" direction="horizontal">
            <FormSelect
              value={filters.dateCriteria}
              onValueChange={(v) => setFilters((p) => ({ ...p, dateCriteria: v as DateCriteria }))}
              options={[
                { value: 'createdAt', label: '가입일' },
                { value: 'cancelledAt', label: '해지일' },
              ]}
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
                  dateFrom: range?.from ? toLocalDateString(range.from) : '',
                  dateTo: range?.to ? toLocalDateString(range.to) : '',
                }))
              }
            />
          </FormField>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <FormField label="해지 유형" direction="horizontal">
          <FormRadioGroup
            value={filters.cancelKind}
            onValueChange={(v) => setFilters((p) => ({ ...p, cancelKind: v as CancelKind }))}
            options={[
              { value: 'ALL', label: '전체' },
              { value: 'IMMEDIATE', label: '즉시 해지' },
              { value: 'SCHEDULED', label: '해지 예약' },
            ]}
            orientation="horizontal"
          />
        </FormField>
        <label className="flex cursor-pointer items-center gap-1.5 text-sm" htmlFor="refund-pending">
          <input
            id="refund-pending"
            type="checkbox"
            className="size-4"
            checked={filters.refundPending}
            onChange={(e) => setFilters((p) => ({ ...p, refundPending: e.target.checked }))}
          />
          환불 미완료만
        </label>
      </div>

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
