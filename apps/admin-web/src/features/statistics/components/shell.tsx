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

/** 탭마다 "이 탭이 답하는 질문"을 함께 둔다 — 탭 아래 안내줄과 종합 탭의 길잡이가 같이 쓴다. */
export const TABS = [
  { href: '/statistics/overview', label: '종합', question: '오늘 뭘 해야 하나 — 핵심 지표와 처리할 일을 한눈에' },
  { href: '/statistics/sales', label: '매출', question: '얼마나 팔리고 있나' },
  { href: '/statistics/profit', label: '이익', question: '팔아서 실제로 남고 있나 (원가·수수료 반영)' },
  { href: '/statistics/inventory', label: '재고', question: '재고가 돈을 얼마나 묶고 있나 — 뭘 털어야 하나' },
  { href: '/statistics/products', label: '상품', question: '뭐가 팔리고 뭐가 안 팔리나' },
  { href: '/statistics/customers', label: '고객·멤버십', question: '누가 사고 있나 (등급별)' },
  { href: '/statistics/keywords', label: '검색 키워드', question: '고객이 뭘 찾나 — 찾는데 없는 건 뭔가' },
  { href: '/statistics/traffic', label: '유입', question: '어떻게 들어오고 있나 (검색·랜딩·기기)' },
  { href: '/statistics/insights', label: '고객 분석', question: '한 번 산 고객이 다시 사고 있나' },
  { href: '/statistics/behavior', label: '행동 분석', question: '보다가 어디서 이탈하나' },
  { href: '/statistics/reviews', label: '리뷰', question: '산 뒤에 만족했나' },
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
  hideFilter,
}: {
  children: ReactNode;
  filterOptions?: StatisticsFilterOptions;
  /** 종합 탭처럼 고정 기준(오늘·최근 7일·최근 30일)으로 보는 화면은 기간 필터를 숨긴다 */
  hideFilter?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const options = { channel: true, granularity: true, ...filterOptions };
  const activeTab = TABS.find((tab) => pathname.startsWith(tab.href));

  return (
    <Container>
      <Header
        title="판매 통계"
        subtitle="매출·상품·고객 지표를 기간별로 조회합니다. 집계 가동 시점 이전(백필 전) 데이터는 표시되지 않습니다."
      />
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={qs ? `${tab.href}?${qs}` : tab.href}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
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
      {activeTab ? (
        <p className="mb-4 mt-2 text-xs text-gray-500">
          {activeTab.label} — {activeTab.question}
        </p>
      ) : (
        <div className="mb-4" />
      )}
      {hideFilter ? null : <StatisticsFilter options={options} />}
      {children}
    </Container>
  );
}
