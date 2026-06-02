import { filterRefundIssueRows } from './refund-filter.utils';

// filterRefundIssueRows가 실제로 사용하는 필드만 포함한 최소 타입
type OrderLineRow = {
    rowId: string; rowSeq: number; orderId: string; lineId: string;
    lineIndex: number; orderLineCount: number; isFirstOfOrder: boolean;
    orderNo: string; orderDate: string; channel: string; orderStatus: string;
    variantId: string; productName: string; quantity: number;
    isMatched: boolean; lineStatus: string; isReadyToShip: boolean;
    isUnavailable: boolean; isDirect: boolean; isOrderFullyAllocated: boolean;
    lines: unknown[]; refundStatus?: string;
    phone?: string; customerName?: string; receiverName?: string;
    address?: string; totalAmount?: number; shippingFee?: number;
    memo?: string; workLogs?: unknown[];
    optionName?: string; unitPrice?: number; totalPrice?: number;
    imageUrl?: string; skuId?: string;
};

function makeRow(overrides: Partial<OrderLineRow> & { orderId: string }): OrderLineRow {
    return {
        rowId: `${overrides.orderId}-line-1`,
        rowSeq: 1,
        lineId: `${overrides.orderId}-line-1`,
        lineIndex: 1,
        orderLineCount: 1,
        isFirstOfOrder: true,
        orderNo: overrides.orderId,
        orderDate: '2026-06-02',
        channel: 'medusa',
        orderStatus: 'confirmed',
        variantId: 'var-1',
        productName: '상품',
        quantity: 1,
        isMatched: true,
        lineStatus: 'stock_deducted',
        isReadyToShip: true,
        isUnavailable: false,
        isDirect: false,
        isOrderFullyAllocated: true,
        lines: [],
        ...overrides,
    } as OrderLineRow;
}

describe('filterRefundIssueRows', () => {
    it('failed 상태 주문의 모든 라인을 포함', () => {
        const rows = [
            makeRow({ orderId: 'o1', isFirstOfOrder: true,  lineIndex: 1, orderStatus: 'cancelled', refundStatus: 'failed' }),
            makeRow({ orderId: 'o1', isFirstOfOrder: false, lineIndex: 2, orderStatus: 'cancelled', refundStatus: undefined }),
            makeRow({ orderId: 'o2', isFirstOfOrder: true,  lineIndex: 1, orderStatus: 'cancelled', refundStatus: 'succeeded' }),
        ];
        const result = filterRefundIssueRows(rows);
        expect(result).toHaveLength(2);
        expect(result.every((r) => r.orderId === 'o1')).toBe(true);
    });

    it('manual_pending 상태 주문의 모든 라인을 포함', () => {
        const rows = [
            makeRow({ orderId: 'o1', isFirstOfOrder: true,  lineIndex: 1, orderStatus: 'cancelled', refundStatus: 'manual_pending' }),
            makeRow({ orderId: 'o1', isFirstOfOrder: false, lineIndex: 2, orderStatus: 'cancelled', refundStatus: undefined }),
            makeRow({ orderId: 'o2', isFirstOfOrder: true,  lineIndex: 1, orderStatus: 'cancelled', refundStatus: 'manual_pending' }),
        ];
        const result = filterRefundIssueRows(rows);
        expect(result).toHaveLength(3);
    });

    it('succeeded/pending 주문은 제외', () => {
        const rows = [
            makeRow({ orderId: 'o1', orderStatus: 'cancelled', refundStatus: 'succeeded' }),
            makeRow({ orderId: 'o2', orderStatus: 'cancelled', refundStatus: 'pending' }),
            makeRow({ orderId: 'o3', orderStatus: 'cancelled', refundStatus: 'failed' }),
        ];
        const result = filterRefundIssueRows(rows);
        expect(result).toHaveLength(1);
        expect(result[0].orderId).toBe('o3');
    });

    it('비취소 주문은 refundStatus 무관하게 제외', () => {
        const rows = [
            makeRow({ orderId: 'o1', orderStatus: 'confirmed', refundStatus: 'failed' }),
            makeRow({ orderId: 'o2', orderStatus: 'cancelled', refundStatus: 'failed' }),
        ];
        const result = filterRefundIssueRows(rows);
        expect(result).toHaveLength(1);
        expect(result[0].orderId).toBe('o2');
    });

    it('이슈 없으면 빈 배열 반환', () => {
        const rows = [
            makeRow({ orderId: 'o1', orderStatus: 'cancelled', refundStatus: 'succeeded' }),
            makeRow({ orderId: 'o2', orderStatus: 'confirmed' }),
        ];
        expect(filterRefundIssueRows(rows)).toHaveLength(0);
    });

    it('빈 배열 입력 → 빈 배열 반환', () => {
        expect(filterRefundIssueRows([])).toHaveLength(0);
    });

    it('3라인 주문에서 첫 라인만 failed여도 3라인 모두 포함', () => {
        const rows = [
            makeRow({ orderId: 'o1', rowId: 'o1-l1', isFirstOfOrder: true,  lineIndex: 1, orderStatus: 'cancelled', refundStatus: 'failed' }),
            makeRow({ orderId: 'o1', rowId: 'o1-l2', isFirstOfOrder: false, lineIndex: 2, orderStatus: 'cancelled', refundStatus: undefined }),
            makeRow({ orderId: 'o1', rowId: 'o1-l3', isFirstOfOrder: false, lineIndex: 3, orderStatus: 'cancelled', refundStatus: undefined }),
        ];
        const result = filterRefundIssueRows(rows);
        expect(result).toHaveLength(3);
        expect(result.map((r) => r.lineIndex)).toEqual([1, 2, 3]);
    });
});
