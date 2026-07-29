'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  FormDateRangePicker,
  FormInput,
  FormRadioGroup,
  FormSelect,
} from '@/components/common/form';
import {
  FilterRow,
  SearchFilterPanel,
} from '@/components/common/form/search-filter-panel';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/ui';
import { useCategoryTree } from '@/lib/services/products/queries';
import { useAdminUsers } from '@/lib/services/users/queries';
import { flattenCategoryTree } from '@/features/mall/products-detail/components/general/basic-information-model';
import { toCategoryFilterOptions } from '@/hooks/table/filters/category-filter-options';
import { parseDateRangeParam } from '@/hooks/table/query/date-range-param';
import {
  DATE_PRESET_OPTIONS,
  computeDateRange,
  toLocalDateString,
  type DatePreset,
} from '@/lib/utils/date';
import {
  CLASSIFICATION_OPTIONS,
  classificationFromParams,
  classificationToParams,
  type Classification,
} from './products-list-filter-model';

const ALL = 'all';

type FilterState = {
  datePreset: DatePreset;
  dateFrom: string;
  dateTo: string;
  categoryId: string;
  createdBy: string;
  classification: Classification;
  q: string;
};

export function ProductsListFilterBox() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { data: categoryTree } = useCategoryTree({ includeInactive: true });
  const { data: adminUsers } = useAdminUsers({
    roleName: 'admin,master',
    limit: 100,
  });

  const registrantOptions = useMemo(
    () => [
      { value: ALL, label: '전체 등록자' },
      ...(adminUsers?.data ?? []).map((user) => ({
        value: user.id,
        label: `${user.loginId} (${user.username})`,
      })),
    ],
    [adminUsers?.data]
  );
  const categoryOptions = useMemo(
    () => [
      { value: ALL, label: '전체 분류' },
      ...toCategoryFilterOptions(
        flattenCategoryTree(categoryTree?.categories ?? [])
      ),
    ],
    [categoryTree?.categories]
  );

  const [filters, setFilters] = useState<FilterState>(() => {
    const range = parseDateRangeParam(searchParams.get('createdAt') ?? undefined);
    return {
      datePreset: (searchParams.get('datePreset') as DatePreset) ?? 'all',
      dateFrom: range.from ?? '',
      dateTo: range.to ?? '',
      categoryId: searchParams.get('categoryId') ?? ALL,
      createdBy: searchParams.get('createdBy') ?? ALL,
      classification: classificationFromParams(
        searchParams.get('status'),
        searchParams.get('stock')
      ),
      q: searchParams.get('q') ?? '',
    };
  });

  const patch = (next: Partial<FilterState>) =>
    setFilters((prev) => ({ ...prev, ...next }));

  const handleSearch = () => {
    const params = new URLSearchParams();
    params.set('page', '1');

    if (filters.q.trim()) params.set('q', filters.q.trim());
    if (filters.categoryId !== ALL) params.set('categoryId', filters.categoryId);
    if (filters.createdBy !== ALL) params.set('createdBy', filters.createdBy);

    const { status, stock } = classificationToParams(filters.classification);
    if (status) params.set('status', status);
    if (stock) params.set('stock', stock);

    let from = filters.dateFrom;
    let to = filters.dateTo;
    if (filters.datePreset !== 'all' && filters.datePreset !== 'custom') {
      const range = computeDateRange(filters.datePreset);
      if (range) {
        from = range.from;
        to = range.to;
      }
    }
    if (from || to) {
      params.set(
        'createdAt',
        JSON.stringify({
          ...(from ? { $gte: from } : {}),
          ...(to ? { $lte: to } : {}),
        })
      );
    }
    if (filters.datePreset !== 'all') params.set('datePreset', filters.datePreset);

    // 정렬은 필터와 독립이므로 검색해도 유지한다.
    const sort = searchParams.get('sort');
    const order = searchParams.get('order');
    if (sort) params.set('sort', sort);
    if (order) params.set('order', order);

    router.replace(`${pathname}?${params.toString()}`);
  };

  const handleReset = () => {
    setFilters({
      datePreset: 'all',
      dateFrom: '',
      dateTo: '',
      categoryId: ALL,
      createdBy: ALL,
      classification: 'all',
      q: '',
    });
    router.replace(pathname);
  };

  return (
    <SearchFilterPanel onSearch={handleSearch} onReset={handleReset}>
      <FilterRow label="일자">
        {/* ponytail: 서버가 등록일 범위만 받는다. 수정일 필터가 생기면 select 로 바꾼다. */}
        <span className="text-sm text-muted-foreground">상품등록일</span>
        <FormRadioGroup
          value={filters.datePreset}
          onValueChange={(v) => patch({ datePreset: v as DatePreset })}
          options={DATE_PRESET_OPTIONS}
          orientation="horizontal"
        />
        {filters.datePreset === 'custom' && (
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
              patch({
                dateFrom: range?.from ? toLocalDateString(range.from) : '',
                dateTo: range?.to ? toLocalDateString(range.to) : '',
              })
            }
          />
        )}
      </FilterRow>

      <FilterRow label="선택사항">
        <div className="w-80">
          <FormSelect
            options={categoryOptions}
            value={filters.categoryId}
            onValueChange={(v) => patch({ categoryId: v })}
            placeholder="분류 선택"
          />
        </div>
        <div className="w-56">
          <FormSelect
            options={registrantOptions}
            value={filters.createdBy}
            onValueChange={(v) => patch({ createdBy: v })}
            placeholder="등록자"
          />
        </div>
      </FilterRow>

      <FilterRow label="분류">
        {CLASSIFICATION_OPTIONS.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant="outline"
            className={cn(
              'h-8 min-w-[68px] text-xs transition-colors',
              filters.classification === option.value &&
                'border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
            )}
            onClick={() => patch({ classification: option.value })}
          >
            {option.label}
          </Button>
        ))}
      </FilterRow>

      <FilterRow label="검색항목">
        <div className="w-[520px] max-w-full">
          <FormInput
            placeholder="상품명 / 품번코드 검색"
            value={filters.q}
            onChange={(e) => patch({ q: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
        </div>
      </FilterRow>
    </SearchFilterPanel>
  );
}
