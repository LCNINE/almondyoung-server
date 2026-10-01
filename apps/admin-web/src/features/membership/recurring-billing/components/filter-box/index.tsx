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
import { DatePreset, DATE_PRESET_OPTIONS, computeDateRange, toLocalDateString } from '@/lib/utils/date';
import { AdminRecurringBillingListQuery } from '@/lib/types/dto/wallet';

type View = NonNullable<AdminRecurringBillingListQuery['view']>;
type DateType = NonNullable<AdminRecurringBillingListQuery['dateType']>;
type SearchType = 'userId' | 'contractId' | 'cmsMemberId' | 'transactionId' | 'paymentIntentId';

const TABS: { value: View; label: string }[] = [
  { value: 'needs-action', label: '처리 필요' },
  { value: 'members', label: '결제수단 심사' },
  { value: 'withdrawals', label: '정기 출금' },
  { value: 'contracts', label: '계약 상태' },
  { value: 'stuck', label: '선점 고착' },
  { value: 'dunning', label: '재시도 대기' },
  { value: 'invoices', label: '인보이스' },
  { value: 'agreement-cleanup', label: '약정 정리' },
];

const isView = (value: string | null): value is View => TABS.some((tab) => tab.value === value);

/** 탭 8개를 일의 성격으로 묶는다. 주소(`view`)는 예전 그대로라 즐겨찾기 링크가 깨지지 않는다. */
const TAB_GROUPS: { label: string; views: View[] }[] = [
  { label: '손볼 것', views: ['needs-action', 'stuck', 'agreement-cleanup'] },
  { label: '심사·출금', views: ['members', 'withdrawals'] },
  { label: '청구서', views: ['invoices', 'dunning'] },
  { label: '계약', views: ['contracts'] },
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
  // stuck/dunning/invoices/agreement-cleanup 뷰는 자체 엔드포인트라 date/search 필터를 쓰지 않음(타입 충족용 최소값)
  stuck: [{ value: 'updatedAt', label: '최근 갱신일' }],
  dunning: [{ value: 'updatedAt', label: '최근 갱신일' }],
  invoices: [{ value: 'updatedAt', label: '최근 갱신일' }],
  'agreement-cleanup': [{ value: 'updatedAt', label: '최근 갱신일' }],
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

  const requestedView = searchParams.get('view');
  const currentView: View = isView(requestedView) ? requestedView : 'needs-action';
  const currentGroup = TAB_GROUPS.find((group) => group.views.includes(currentView)) ?? TAB_GROUPS[0];

  const requestedSearchType = searchParams.get('searchType');
  const urlSearchType: SearchType =
    SEARCH_TYPE_OPTIONS.find((option) => option.value === requestedSearchType)?.value ?? 'userId';

  const [filters, setFilters] = useState<FilterState>({
    dateType: (searchParams.get('dateType') as DateType) ?? 'updatedAt',
    datePreset: (searchParams.get('datePreset') as DatePreset) ?? 'all',
    dateFrom: searchParams.get('dateFrom') ?? '',
    dateTo: searchParams.get('dateTo') ?? '',
    cmsMemberStatus: searchParams.get('cmsMemberStatus') ?? '',
    withdrawalStatus: searchParams.get('withdrawalStatus') ?? '',
    searchType: urlSearchType,
    searchValue:
      searchParams.get(urlSearchType) ??
      searchParams.get('userId') ??
      searchParams.get('contractId') ??
      searchParams.get('cmsMemberId') ??
      searchParams.get('transactionId') ??
      searchParams.get('paymentIntentId') ??
      '',
  });

  // 위의 «돈» 영역에서 고른 달은 목록 필터와 무관하니 탭·검색·초기화에도 남긴다.
  const keepMonth = (params: URLSearchParams) => {
    const month = searchParams.get('month');
    if (month) params.set('month', month);
  };

  const handleTabChange = (view: View) => {
    const params = new URLSearchParams();
    params.set('view', view);
    params.set('page', '1');
    keepMonth(params);
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
    keepMonth(params);

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
    if (filters.searchValue) {
      params.set(filters.searchType, filters.searchValue);
      // 새로고침해도 라디오가 값과 같은 종류를 가리키게 종류도 남긴다.
      params.set('searchType', filters.searchType);
    }

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
    keepMonth(params);
    router.replace(`${pathname}?${params.toString()}`);
  };

  const dateTypeOptions = DATE_TYPE_OPTIONS_BY_VIEW[currentView];

  return (
    <div className="mb-4 space-y-3 rounded-[10px] border border-[#D9D9D9] bg-[#F5F5F5] p-4">
      <div className="space-y-2 border-b border-border pb-3">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="목록 묶음">
          {TAB_GROUPS.map((group) => (
            <button
              key={group.label}
              type="button"
              role="tab"
              aria-selected={group.views.includes(currentView)}
              onClick={() => handleTabChange(group.views[0])}
              className={[
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                group.views.includes(currentView)
                  ? 'bg-orange-500 text-white'
                  : 'text-muted-foreground hover:bg-muted',
              ].join(' ')}
            >
              {group.label}
            </button>
          ))}
        </div>
        {currentGroup.views.length > 1 && (
          <div className="flex flex-wrap gap-1" role="tablist" aria-label={`${currentGroup.label} 목록`}>
            {currentGroup.views.map((view) => (
              <button
                key={view}
                type="button"
                role="tab"
                aria-selected={currentView === view}
                onClick={() => handleTabChange(view)}
                className={[
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  currentView === view
                    ? 'border-orange-500 bg-white font-semibold text-orange-600'
                    : 'border-transparent text-muted-foreground hover:bg-muted',
                ].join(' ')}
              >
                {TABS.find((tab) => tab.value === view)?.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {currentView === 'needs-action' ||
      currentView === 'stuck' ||
      currentView === 'dunning' ||
      currentView === 'invoices' ||
      currentView === 'agreement-cleanup' ? (
        <p className="text-sm text-muted-foreground">
          {currentView === 'needs-action'
            ? '지금 손봐야 하는 결제수단·출금 전체입니다(심사 실패·동의자료 미등록·출금 실패·30분 넘은 결과 대기). 날짜·검색 필터는 적용되지 않습니다.'
            : currentView === 'stuck'
            ? '48시간 이상 선점(billingInProgress) 고착된 전체 계약입니다. 별도 필터는 적용되지 않습니다.'
            : currentView === 'dunning'
              ? '결제 실패로 자동 재시도 대기 중인 전체 계약입니다. 별도 필터는 적용되지 않습니다.'
              : currentView === 'agreement-cleanup'
                ? '해지 후 은행에 자동이체 약정이 남아 있는 전체 계약입니다. 별도 필터는 적용되지 않습니다.'
                : '인보이스(청구 권위 상태) 목록입니다. 상태 필터는 표 상단에서 선택합니다.'}
        </p>
      ) : (
      <>
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
                  dateFrom: range?.from ? toLocalDateString(range.from) : '',
                  dateTo: range?.to ? toLocalDateString(range.to) : '',
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
      </>
      )}
    </div>
  );
}
