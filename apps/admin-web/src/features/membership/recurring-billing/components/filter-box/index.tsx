'use client';

import { useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import {
  FormField,
  FormSelect,
  FormInput,
  FormRadioGroup,
  FormDateRangePicker,
} from '@/components/common/form';
import { Button } from '@/components/ui/button';
import { DatePreset, DATE_PRESET_OPTIONS, computeDateRange } from '@/lib/utils/date';
import { AdminRecurringBillingListQuery } from '@/lib/types/dto/wallet';

type View = NonNullable<AdminRecurringBillingListQuery['view']>;
type DateType = NonNullable<AdminRecurringBillingListQuery['dateType']>;
type SearchType = 'userId' | 'contractId' | 'cmsMemberId' | 'transactionId' | 'paymentIntentId';

const TABS: { value: View; label: string }[] = [
  { value: 'needs-action', label: '처리 필요' },
  { value: 'members', label: '결제수단 심사' },
  { value: 'withdrawals', label: '정기 출금' },
  { value: 'contracts', label: '계약 상태' },
];

const DATE_TYPE_OPTIONS_BY_VIEW: Record<View, { value: DateType; label: string }[]> = {
  'needs-action': [{ value: 'updatedAt', label: '최근 갱신일' }],
  members: [
    { value: 'createdAt', label: '신청일' },
    { value: 'updatedAt', label: '최근 갱신일' },
  ],
  withdrawals: [
    { value: 'paymentDate', label: '출금일' },
    { value: 'updatedAt', label: '최근 갱신일' },
  ],
  contracts: [
    { value: 'updatedAt', label: '최근 갱신일' },
    { value: 'nextBillingDate', label: '다음 결제일' },
    { value: 'createdAt', label: '계약 생성일' },
  ],
};

const CMS_MEMBER_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '전체' },
  { value: 'PENDING', label: '심사 중' },
  { value: 'REGISTERED', label: '사용 가능' },
  { value: 'FAILED', label: '심사 실패' },
  { value: 'DELETED', label: '삭제됨' },
];

const WITHDRAWAL_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '전체' },
  { value: 'REQUESTED', label: '출금 예약' },
  { value: 'PROCESSING', label: '출금 처리 중' },
  { value: 'SUCCEEDED', label: '출금 성공' },
  { value: 'FAILED', label: '출금 실패' },
  { value: 'DELETED', label: '출금 취소' },
];

const SEARCH_TYPE_OPTIONS: { value: SearchType; label: string }[] = [
  { value: 'userId', label: '고객 ID' },
  { value: 'contractId', label: '계약 ID' },
  { value: 'cmsMemberId', label: 'CMS 회원 ID' },
  { value: 'transactionId', label: '거래 ID' },
  { value: 'paymentIntentId', label: '결제 의도 ID' },
];

interface FilterState {
  dateType: DateType;
  datePreset: DatePreset;
  dateFrom: string;
  dateTo: string;
  cmsMemberStatus: string;
  withdrawalStatus: string;
  searchType: SearchType;
  searchValue: string;
}

export function RecurringBillingFilterBox() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentView = (searchParams.get('view') as View) ?? 'needs-action';

  const [filters, setFilters] = useState<FilterState>({
    dateType: (searchParams.get('dateType') as DateType) ?? 'updatedAt',
    datePreset: (searchParams.get('datePreset') as DatePreset) ?? 'all',
    dateFrom: searchParams.get('dateFrom') ?? '',
    dateTo: searchParams.get('dateTo') ?? '',
    cmsMemberStatus: searchParams.get('cmsMemberStatus') ?? '',
    withdrawalStatus: searchParams.get('withdrawalStatus') ?? '',
    searchType: (searchParams.get('searchType') as SearchType) ?? 'userId',
    searchValue: searchParams.get('userId') ?? searchParams.get('contractId') ?? searchParams.get('cmsMemberId') ?? searchParams.get('transactionId') ?? searchParams.get('paymentIntentId') ?? '',
  });

  const handleTabChange = (view: View) => {
    const params = new URLSearchParams();
    params.set('view', view);
    params.set('page', '1');
    router.replace(`${pathname}?${params.toString()}`);
    setFilters((prev) => ({
      ...prev,
      dateType: DATE_TYPE_OPTIONS_BY_VIEW[view][0].value,
      cmsMemberStatus: '',
      withdrawalStatus: '',
    }));
  };

  const handleSearch = () => {
    const params = new URLSearchParams();
    params.set('view', currentView);
    params.set('page', '1');

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
    if (filters.datePreset && filters.datePreset !== 'all') {
      params.set('datePreset', filters.datePreset);
    }
    if (filters.dateType) params.set('dateType', filters.dateType);
    if (filters.cmsMemberStatus) params.set('cmsMemberStatus', filters.cmsMemberStatus);
    if (filters.withdrawalStatus) params.set('withdrawalStatus', filters.withdrawalStatus);
    if (filters.searchValue) params.set(filters.searchType, filters.searchValue);

    router.replace(`${pathname}?${params.toString()}`);
  };

  const handleReset = () => {
    const defaultDateType = DATE_TYPE_OPTIONS_BY_VIEW[currentView][0].value;
    setFilters({
      dateType: defaultDateType,
      datePreset: 'all',
      dateFrom: '',
      dateTo: '',
      cmsMemberStatus: '',
      withdrawalStatus: '',
      searchType: 'userId',
      searchValue: '',
    });
    const params = new URLSearchParams();
    params.set('view', currentView);
    router.replace(`${pathname}?${params.toString()}`);
  };

  const dateTypeOptions = DATE_TYPE_OPTIONS_BY_VIEW[currentView];

  return (
    <div className="mb-4 space-y-3 rounded-[10px] border border-[#D9D9D9] bg-[#F5F5F5] p-4">
      <div className="flex gap-1 border-b border-border pb-3">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => handleTabChange(tab.value)}
            className={[
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              currentView === tab.value
                ? 'bg-orange-500 text-white'
                : 'text-muted-foreground hover:bg-muted',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <div className="w-36 shrink-0">
          <FormField label="일자 기준" direction="horizontal">
            <FormSelect
              value={filters.dateType}
              onValueChange={(v) => setFilters((p) => ({ ...p, dateType: v as DateType }))}
              options={dateTypeOptions}
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
        <div className="ml-40">
          <FormField label="기간">
            <FormDateRangePicker
              value={
                filters.dateFrom
                  ? {
                      from: new Date(filters.dateFrom),
                      to: filters.dateTo ? new Date(filters.dateTo) : undefined,
                    }
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

      {currentView === 'members' && (
        <div className="flex items-center gap-4">
          <FormField label="심사 상태" direction="horizontal">
            <FormRadioGroup
              value={filters.cmsMemberStatus}
              onValueChange={(v) => setFilters((p) => ({ ...p, cmsMemberStatus: v }))}
              options={CMS_MEMBER_STATUS_OPTIONS}
              orientation="horizontal"
            />
          </FormField>
        </div>
      )}

      {currentView === 'withdrawals' && (
        <div className="flex items-center gap-4">
          <FormField label="출금 상태" direction="horizontal">
            <FormRadioGroup
              value={filters.withdrawalStatus}
              onValueChange={(v) => setFilters((p) => ({ ...p, withdrawalStatus: v }))}
              options={WITHDRAWAL_STATUS_OPTIONS}
              orientation="horizontal"
            />
          </FormField>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <FormField label="검색 유형" direction="horizontal">
          <FormRadioGroup
            value={filters.searchType}
            onValueChange={(v) =>
              setFilters((p) => ({ ...p, searchType: v as SearchType, searchValue: '' }))
            }
            options={SEARCH_TYPE_OPTIONS}
            orientation="horizontal"
          />
        </FormField>
        <div className="w-72">
          <FormInput
            placeholder="검색어 입력"
            value={filters.searchValue}
            onChange={(e) => setFilters((p) => ({ ...p, searchValue: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
        </div>
      </div>

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
