interface RefundFilterableRow {
    orderId: string;
    orderStatus: string;
    refundStatus?: string;
}

/**
 * refundIssueOnly 필터: order 단위로 동작.
 *
 * row 단위로 필터하면 multi-line 주문에서 refundStatus가 있는 첫 번째 행만 남고
 * 나머지 행이 사라져 테이블 레이아웃이 깨지는 문제가 있다.
 * 따라서 이슈가 있는 orderId를 먼저 수집한 뒤 해당 orderId의 모든 row를 포함한다.
 */
export function filterRefundIssueRows<T extends RefundFilterableRow>(items: T[]): T[] {
    const issueOrderIds = new Set(
        items
            .filter(
                (r) =>
                    r.orderStatus === 'cancelled' &&
                    (r.refundStatus === 'failed' || r.refundStatus === 'manual_pending'),
            )
            .map((r) => r.orderId),
    );
    return items.filter((r) => issueOrderIds.has(r.orderId));
}
