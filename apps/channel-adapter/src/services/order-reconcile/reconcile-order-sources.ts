/**
 * 대사 가능한 채널 source 목록 (#1016 45번). `fetchOrders(since)` 가 «since 이후 갱신된 전부»를 주는 열린 질의여야 한다.
 * 네이버(닫힌 24시간 창)는 개통 때 따로 붙인다.
 */
export const RECONCILE_ORDER_SOURCES = Symbol('RECONCILE_ORDER_SOURCES');
