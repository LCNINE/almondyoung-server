'use client';

import { ReactNode, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import {
  FormField,
  FormInput,
  FormRadioGroup,
  FormDateRangePicker,
} from '@/components/common/form';
import { cn } from '@/lib/utils/ui';
import { DatePreset, DATE_PRESET_OPTIONS, computeDateRange, toLocalDateString } from '@/lib/utils/date';
import { defaultRange, useStatisticsRange } from '../shared';

const TABS = [
  { href: '/statistics/sales', label: '매출' },
  { href: '/statistics/profit', label: '이익' },
  { href: '/statistics/products', label: '상품' },
  { href: '/statistics/customers', label: '고객·멤버십' },
  { href: '/statistics/keywords', label: '검색 키워드' },
  { href: '/statistics/traffic', label: '유입' },
  { href: '/statistics/insights', label: '고객 분석' },
  { href: '/statistics/behavior', label: '행동 분석' },
  { href: '/statistics/reviews', label: '리뷰' },
];

/** 탭별로 의미 없는 필터를 숨긴다 — 검색 키워드 통계는 채널·집계 단위가 없다. */
export interface StatisticsFilterOptions {
  channel?: boolean;
  granularity?: boolean;
}

const GRANULARITY_OPTIONS = [
  { value: 'day', label: '일별' },
  { value: 'month', label: '월별' },
  { value: 'year', label: '연별' },
];

// '전체' 는 기간 필수인 통계에선 의미가 없어 뺀다.
const PRESET_OPTIONS = DATE_PRESET_OPTIONS.filter((option) => option.value !== 'all');

function StatisticsFilter({ options }: { options: Required<StatisticsFilterOptions> }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const range = useStatisticsRange();

  const [preset, setPreset] = useState<DatePreset>((searchParams.get('preset') as DatePreset) ?? 'custom');
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [channel, setChannel] = useState(range.channel ?? '');
  const [granularity, setGranularity] = useState(range.granularity ?? 'day');

  const apply = () => {
    let nextFrom = from;
    let nextTo = to;
    if (preset !== 'custom') {
      const computed = computeDateRange(preset);
      if (computed) {
        nextFrom = computed.from;
        nextTo = computed.to;
        setFrom(computed.from);
        setTo(computed.to);
      }
    }
    const params = new URLSearchParams();
    params.set('from', nextFrom);
    params.set('to', nextTo);
    if (options.granularity) params.set('granularity', granularity);
    if (preset !== 'custom') params.set('preset', preset);
    if (options.channel && channel.trim()) params.set('channel', channel.trim());
    router.replace(`${pathname}?${params.toString()}`);
  };

  const reset = () => {
    const fallback = defaultRange();
    setPreset('custom');
    setFrom(fallback.from);
    setTo(fallback.to);
    setChannel('');
    setGranularity('day');
    router.replace(pathname);
  };

  return (
    <div className="mb-4 space-y-3 rounded-[10px] border border-[#D9D9D9] bg-[#F5F5F5] p-4">
      <div className="flex flex-wrap items-start gap-4">
        <FormField label="기간" direction="horizontal">
          <FormRadioGroup
            value={preset}
            onValueChange={(v) => setPreset(v as DatePreset)}
            options={PRESET_OPTIONS}
            orientation="horizontal"
          />
        </FormField>
      </div>

      {preset === 'custom' && (
        <FormField label="조회 구간" direction="horizontal">
          <FormDateRangePicker
            value={from ? { from: new Date(from), to: to ? new Date(to) : undefined } : undefined}
            onChange={(dateRange) => {
              setFrom(dateRange?.from ? toLocalDateString(dateRange.from) : '');
              setTo(dateRange?.to ? toLocalDateString(dateRange.to) : '');
            }}
          />
        </FormField>
      )}

      {(options.granularity || options.channel) && (
        <div className="flex flex-wrap items-end gap-4">
          {options.granularity && (
            <FormField label="단위" direction="horizontal">
              <FormRadioGroup
                value={granularity}
                onValueChange={(v) => setGranularity(v as typeof granularity)}
                options={GRANULARITY_OPTIONS}
                orientation="horizontal"
              />
            </FormField>
          )}
          {options.channel && (
            <FormField label="채널" direction="horizontal">
              <div className="w-52">
                <FormInput
                  placeholder="예: medusa (생략 시 전체)"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && apply()}
                />
              </div>
            </FormField>
          )}
        </div>
      )}

      <div className="flex justify-center gap-2 pt-1">
        <Button onClick={apply} className="h-9 w-28 bg-orange-500 text-white hover:bg-orange-600">
          <Search className="mr-1.5 h-4 w-4" />
          조회
        </Button>
        <Button variant="outline" onClick={reset} className="h-9 w-20">
          초기화
        </Button>
      </div>
    </div>
  );
}

export function StatisticsShell({
  children,
  filterOptions,
}: {
  children: ReactNode;
  filterOptions?: StatisticsFilterOptions;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const options = { channel: true, granularity: true, ...filterOptions };

  return (
    <Container>
      <Header
        title="판매 통계"
        subtitle="매출·상품·고객 지표를 기간별로 조회합니다. 집계 가동 시점 이전(백필 전) 데이터는 표시되지 않습니다."
      />
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {TABS.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={qs ? `${tab.href}?${qs}` : tab.href}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                active
                  ? 'border-orange-500 text-orange-600'
                  : 'border-transparent text-gray-500 hover:text-gray-800',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      <StatisticsFilter options={options} />
      {children}
    </Container>
  );
}
