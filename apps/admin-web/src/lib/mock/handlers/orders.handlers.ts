// src/lib/mock/handlers/orders.handlers.ts
// 주문 관련 MSW handlers (기존 WMS handlers에서 주문 관련만 추출)

import { http, HttpResponse } from 'msw';
import {
    mockOrders,
    mockOutboundBatches,
    mockPickings,
    mockFulfillments,
    mockInvoices,
    mockMatchingsResponse,
    mockPendingMatchingsResponse,
    mockVariantMatchings,
    mockVariantSkuLookups,
    mockStockPolicies,
} from '../data/orders';

// 주문 관련 handlers
export const orderHandlers = [
    // 주문 목록 조회
    http.get('/wms/sales-orders', () => {
        return HttpResponse.json(mockOrders);
    }),

    // 특정 주문 조회
    http.get('/wms/sales-orders/:id', ({ params }) => {
        const order = mockOrders.find((o: any) => o.id === params.id);
        if (!order) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(order);
    }),

    // 주문 아이템 조회
    http.get('/wms/sales-orders/:id/items', ({ params }) => {
        return HttpResponse.json([]);
    }),
];

// 출고 배치 관련 handlers
export const outboundBatchHandlers = [
    // 출고 배치 목록 조회
    http.get('/wms/outbound-batches', () => {
        return HttpResponse.json(mockOutboundBatches);
    }),

    // 특정 출고 배치 조회
    http.get('/wms/outbound-batches/:id', ({ params }) => {
        const batch = mockOutboundBatches.find((b: any) => b.id === params.id);
        if (!batch) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(batch);
    }),
];

// 피킹 관련 handlers
export const pickingHandlers = [
    // 피킹 목록 조회
    http.get('/wms/pickings', () => {
        return HttpResponse.json(mockPickings);
    }),

    // 특정 피킹 조회
    http.get('/wms/pickings/:id', ({ params }) => {
        const picking = mockPickings.find((p: any) => p.id === params.id);
        if (!picking) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(picking);
    }),

    // 피킹 리스트 조회
    http.get('/wms/pickings/list/:orderId', ({ params }) => {
        return HttpResponse.json([]);
    }),
];

// 이행 관련 handlers
export const fulfillmentHandlers = [
    // 이행 목록 조회
    http.get('/wms/fulfillments', () => {
        return HttpResponse.json(mockFulfillments);
    }),

    // 특정 이행 조회
    http.get('/wms/fulfillments/:id', ({ params }) => {
        const fulfillment = mockFulfillments.find((f: any) => f.id === params.id);
        if (!fulfillment) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(fulfillment);
    }),

    // 이행 주문 목록 조회
    http.get('/wms/fulfillment-orders', () => {
        return HttpResponse.json([]);
    }),

    // 특정 이행 주문 조회
    http.get('/wms/fulfillment-orders/:id', ({ params }) => {
        return HttpResponse.json({ id: params.id });
    }),
];

// 매칭 관련 handlers (새로운 WMS API 스펙 기반)
export const matchingHandlers = [
    // 매칭 목록 조회
    http.get('http://localhost:3010/wms/matchings', ({ request }) => {
        console.log('🎯 MSW: http://localhost:3010/wms/matchings 요청 가로채기');
        const url = new URL(request.url);
        const status = url.searchParams.get('status');
        const includeOrder = url.searchParams.get('include-order') === 'true';
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = parseInt(url.searchParams.get('limit') || '20');

        let responseData = mockMatchingsResponse.data;

        // 원본 데이터 확인
        console.log('🎯 MSW: 원본 매칭 데이터 확인:', {
            total: mockMatchingsResponse.data.length,
            firstItemHasOrder: !!mockMatchingsResponse.data[0]?.order,
            firstItemOrder: mockMatchingsResponse.data[0]?.order
        });

        // 상태 필터링
        if (status) {
            responseData = mockMatchingsResponse.data.filter(m => m.status === status);
        }

        // 주문 정보는 항상 포함 (매칭 페이지에서 필요)
        // includeOrder 로직을 임시로 비활성화하여 항상 order 정보 포함
        // if (includeOrder === false) {
        //     responseData = responseData.map(matching => ({
        //         ...matching,
        //         order: undefined,
        //     }));
        // }

        // 페이지네이션
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedData = responseData.slice(startIndex, endIndex);

        console.log('🎯 MSW: 매칭 데이터 반환:', {
            total: responseData.length,
            returned: paginatedData.length,
            includeOrderParam: includeOrder,
            firstItem: paginatedData[0] ? {
                id: paginatedData[0].id,
                hasOrder: !!paginatedData[0].order,
                orderInfo: paginatedData[0].order ? {
                    salesOrderId: paginatedData[0].order.salesOrderId,
                    productName: paginatedData[0].order.productName,
                    customerName: paginatedData[0].order.customerName
                } : null,
                fullOrder: paginatedData[0].order
            } : null
        });

        return HttpResponse.json({
            data: paginatedData,
            total: responseData.length,
            page,
            limit,
            totalPages: Math.ceil(responseData.length / limit),
            hasNext: endIndex < responseData.length,
            hasPrev: page > 1,
        });
    }),

    // 매칭 대기 해소
    http.patch('/wms/matchings/:id/resolve', async ({ request, params }) => {
        const { id } = params;
        const body = await request.json() as any;

        const updatedMatching = {
            id: id as string,
            status: body.ignore ? 'ignored' : 'matched',
            message: body.ignore ? '매칭이 무시되었습니다.' : '매칭이 완료되었습니다.',
        };

        return HttpResponse.json(updatedMatching);
    }),

    // 매칭 우선순위 설정
    http.patch('/wms/matchings/:id/priority', async ({ request, params }) => {
        const { id } = params;
        const body = await request.json() as any;

        return HttpResponse.json({
            id: id as string,
            priority: body.priority,
        });
    }),

    // 매칭 전략 변경
    http.patch('/wms/matchings/:id/strategy', async ({ request, params }) => {
        const { id } = params;
        const body = await request.json() as any;

        return HttpResponse.json({
            id: id as string,
            strategy: body.strategy,
        });
    }),

    // 매칭 재고 정책 업데이트
    http.patch('/wms/matchings/:id/stock-policy', async ({ request, params }) => {
        const { id } = params;
        const body = await request.json() as any;

        return HttpResponse.json({
            id: id as string,
            stockPolicy: body,
        });
    }),

    // Variant별 매칭 조회
    http.get('/wms/matchings/:variantId', ({ params }) => {
        const { variantId } = params;
        const matching = mockMatchingsResponse.data.find(m => m.variantId === variantId);

        if (!matching) {
            return HttpResponse.json(
                { error: '매칭을 찾을 수 없습니다.' },
                { status: 404 }
            );
        }

        return HttpResponse.json({
            variantId: matching.variantId,
            status: matching.status,
            stockPolicy: matching.stockPolicy,
            isGift: matching.isGift,
            matchedSkus: matching.matchedSkus,
            createdAt: matching.createdAt,
            updatedAt: matching.updatedAt,
        });
    }),

    // Variant 재고 정책 조회
    http.get('/wms/matchings/variants/:variantId/stock-policy', ({ params }) => {
        const { variantId } = params;
        const matching = mockMatchingsResponse.data.find(m => m.variantId === variantId);

        if (!matching) {
            return HttpResponse.json(
                { error: '재고 정책을 찾을 수 없습니다.' },
                { status: 404 }
            );
        }

        return HttpResponse.json(matching.stockPolicy);
    }),

    // Variant SKU 조회
    http.post('/wms/matchings/variants/:variantId/sku-lookup', async ({ request, params }) => {
        const { variantId } = params;
        const body = await request.json() as any;

        // 간단한 SKU 조회 시뮬레이션
        const skuLookup = [
            {
                skuId: `sku-${variantId}-001`,
                quantity: 1,
            },
        ];

        return HttpResponse.json(skuLookup);
    }),
];

// 구매 주문 관련 handlers
export const purchaseOrderHandlers = [
    // 구매 주문 목록 조회
    http.get('/wms/purchase-orders', () => {
        return HttpResponse.json([]);
    }),

    // 특정 구매 주문 조회
    http.get('/wms/purchase-orders/:id', ({ params }) => {
        return HttpResponse.json({ id: params.id });
    }),
];

// 송장 관련 handlers
export const invoiceHandlers = [
    // 송장 목록 조회
    http.get('/wms/invoices', () => {
        return HttpResponse.json(mockInvoices);
    }),

    // 특정 송장 조회
    http.get('/wms/invoices/:id', ({ params }) => {
        const invoice = mockInvoices.find((i: any) => i.id === params.id);
        if (!invoice) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(invoice);
    }),
];

// 직접 배송 관련 handlers
export const directShipHandlers = [
    // 직접 배송 목록 조회
    http.get('/wms/direct-ships', () => {
        return HttpResponse.json([]);
    }),

    // 특정 직접 배송 조회
    http.get('/wms/direct-ships/:id', ({ params }) => {
        return HttpResponse.json({ id: params.id });
    }),
];

// 메트릭스 관련 handlers
export const metricsHandlers = [
    // 주문 메트릭스 조회
    http.get('/wms/metrics/orders', () => {
        return HttpResponse.json({ total: mockOrders.length, pending: 0, completed: 0 });
    }),

    // 이행 메트릭스 조회
    http.get('/wms/metrics/fulfillments', () => {
        return HttpResponse.json({ total: mockFulfillments.length, pending: 0, completed: 0 });
    }),
];

// 모든 주문 관련 handlers 통합
export const allOrderHandlers = [
    ...orderHandlers,
    ...outboundBatchHandlers,
    ...pickingHandlers,
    ...fulfillmentHandlers,
    ...matchingHandlers,
    ...purchaseOrderHandlers,
    ...invoiceHandlers,
    ...directShipHandlers,
    ...metricsHandlers,
];
