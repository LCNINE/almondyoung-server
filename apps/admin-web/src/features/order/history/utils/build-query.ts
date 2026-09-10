import type { OrderHistoryFilter } from '../contexts/filter.context';
import type {
  OrderKeywordType,
  OrderTypeGroup,
  SalesOrdersQuery,
} from '@/lib/types/dto/orders';

export const PAGE_SIZE = 50;

const KEYWORD_TYPE_MAP: Record<string, OrderKeywordType> = {
  통합검색: 'all',
  주문번호: 'orderNo',
  수령자: 'receiver',
  연락처: 'phone',
  상품명: 'product',
};

export function buildQuery(
  filter: OrderHistoryFilter,
  page: number,
  pageSize = PAGE_SIZE
): SalesOrdersQuery {
  const keyword = filter.keyword?.trim() || undefined;
  // 환불이슈 모드는 '취소주문 중 환불 실패/수동'이므로 구분(typeGroup)·취소제외와 상충한다.
  // 이 모드에선 구분/취소제외를 무시해 항상 정상 조회되게 한다.
  const refundIssueOnly = filter.refundIssueOnly || undefined;
  // 주문번호는 주문 하나를 «지목»하는 검색이다. 기본 필터가 기간=오늘·구분=주문 미확정이라,
  // 어제 주문번호를 넣으면 그 주문이 멀쩡히 있는데도 0건이 나왔다 — 이게 "검색이 안 된다"의
  // 실제 원인이었다. 지목 검색일 땐 기간·구분·취소제외를 걸지 않는다 (화면에도 그렇게 적는다).
  const isOrderNoLookup = !refundIssueOnly && !!keyword && filter.keywordType === '주문번호';
  return {
    channel: filter.channel as SalesOrdersQuery['channel'] | undefined,
    startDate: isOrderNoLookup ? undefined : filter.dateFrom,
    endDate: isOrderNoLookup ? undefined : filter.dateTo,
    typeGroup:
      refundIssueOnly || isOrderNoLookup ? undefined : (filter.type as OrderTypeGroup),
    // 취소/타임아웃 제외는 '전체' 구분일 때만 의미
    excludeTerminal:
      !refundIssueOnly && !isOrderNoLookup && filter.type === 'all'
        ? filter.excludeTerminal
        : undefined,
    refundIssueOnly,
    keyword,
    keywordType: keyword ? (KEYWORD_TYPE_MAP[filter.keywordType] ?? 'all') : undefined,
    limit: pageSize,
    offset: page * pageSize,
  };
}
