import type {
  KeywordType,
  OrderHistoryFilter,
  OrderTypeFilter,
  QuickDateOption,
} from '../contexts/filter.context';
import { pointedOrderNo } from './pointed-order';

// 주문내역 검색 조건과 쪽을 주소에 남긴다 — 새로고침·뒤로가기·링크 공유에 같은 목록이 나오게.

const QUICK_DATE_DAYS: Record<
  Exclude<QuickDateOption, 'custom'>,
  [from: number, to: number]
> = {
  today: [0, 0],
  yesterday: [1, 1],
  week: [6, 0],
  month: [29, 0],
  '3m': [89, 0],
};

// 달력일끼리의 계산이라 UTC 로 해도 날이 밀리지 않는다
function daysBefore(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/** 빠른 일자 선택이 오늘 기준으로 덮는 기간. */
export function quickDateRange(
  key: Exclude<QuickDateOption, 'custom'>,
  today: string
): { dateFrom: string; dateTo: string } {
  const [from, to] = QUICK_DATE_DAYS[key];
  return { dateFrom: daysBefore(today, from), dateTo: daysBefore(today, to) };
}

const TYPES: readonly OrderTypeFilter[] = [
  'pending',
  'all',
  'unmatched',
  'direct',
];
const KEYWORD_TYPES: readonly KeywordType[] = [
  '통합검색',
  '주문번호',
  '수령자',
  '연락처',
  '상품명',
];
const QUICK_DATES: readonly QuickDateOption[] = [
  'today',
  'yesterday',
  'week',
  'month',
  '3m',
  'custom',
];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const oneOf = <T extends string>(
  values: readonly T[],
  raw: string | null
): T | undefined =>
  raw !== null && (values as readonly string[]).includes(raw)
    ? (raw as T)
    : undefined;

export function defaultHistoryFilter(today: string): OrderHistoryFilter {
  return {
    type: 'pending',
    excludeTerminal: true,
    refundIssueOnly: false,
    channels: [],
    quickDate: 'today',
    dateFrom: today,
    dateTo: today,
    keywordType: '통합검색',
    keyword: undefined,
  };
}

type Params = { get(name: string): string | null };

/** 주소 → 검색 조건·쪽(0부터). 모르는 값은 기본값으로 둔다. */
export function historyStateFromParams(
  params: Params,
  today: string,
  isDemo: boolean
): { filter: OrderHistoryFilter; page: number } {
  const base = defaultHistoryFilter(today);
  // 다른 화면이 주문 하나를 지목해 보낸 주소(?orderNo=)는 그 주문번호 검색으로 연다
  const pointed = pointedOrderNo(params, isDemo);
  if (pointed) {
    return {
      filter: { ...base, keywordType: '주문번호', keyword: pointed },
      page: 0,
    };
  }

  const from = params.get('from');
  const to = params.get('to');
  const hasRange = !!from && !!to && DATE.test(from) && DATE.test(to);
  const quick = oneOf(QUICK_DATES, params.get('range'));
  let quickDate: QuickDateOption = base.quickDate;
  let dateFrom = base.dateFrom;
  let dateTo = base.dateTo;
  if (hasRange) {
    dateFrom = from;
    dateTo = to;
    // 공유받은 날이 달라 빠른 선택의 기간과 어긋나면 임의기간으로 보인다
    const range =
      quick && quick !== 'custom' ? quickDateRange(quick, today) : null;
    quickDate =
      quick && range && range.dateFrom === from && range.dateTo === to
        ? quick
        : 'custom';
  } else if (quick && quick !== 'custom') {
    quickDate = quick;
    ({ dateFrom, dateTo } = quickDateRange(quick, today));
  }

  const keyword = params.get('q')?.trim() || undefined;
  const page = Number(params.get('page'));

  return {
    filter: {
      type: oneOf(TYPES, params.get('type')) ?? base.type,
      excludeTerminal: params.get('terminal') !== 'include',
      refundIssueOnly: params.get('refund') === '1',
      channels: (params.get('channels') ?? params.get('channel') ?? '')
        .split(',')
        .map((channel) => channel.trim())
        .filter(Boolean),
      quickDate,
      dateFrom,
      dateTo,
      keywordType: oneOf(KEYWORD_TYPES, params.get('kt')) ?? base.keywordType,
      keyword,
    },
    page: Number.isInteger(page) && page > 1 ? page - 1 : 0,
  };
}

/** 검색 조건·쪽(0부터) → 주소. 기본값과 같은 항목은 적지 않는다. */
export function historyParams(
  filter: OrderHistoryFilter,
  page: number
): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.quickDate !== 'custom') params.set('range', filter.quickDate);
  params.set('from', filter.dateFrom);
  params.set('to', filter.dateTo);
  if (filter.type !== 'pending') params.set('type', filter.type);
  if (!filter.excludeTerminal) params.set('terminal', 'include');
  if (filter.refundIssueOnly) params.set('refund', '1');
  if (filter.channels.length > 0)
    params.set('channels', filter.channels.join(','));
  if (filter.keyword) {
    params.set('kt', filter.keywordType);
    params.set('q', filter.keyword);
  }
  if (page > 0) params.set('page', String(page + 1));
  return params;
}
