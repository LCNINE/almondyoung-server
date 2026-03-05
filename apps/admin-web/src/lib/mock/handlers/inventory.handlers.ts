// src/lib/mock/handlers/inventory.handlers.ts
// 재고 관련 MSW handlers (기존 WMS handlers에서 재고 관련만 추출)

import { http, HttpResponse } from 'msw';
import {
    mockStocks,
    mockSkus,
    mockWarehouses,
    mockInbounds,
    mockInspections,
    mockMovements,
    mockConsolidations,
    mockStockSummaries,
    mockSkuTotalStocks,
    mockSkuWarehouseStocks,
    mockStockHistories,
    mockWarehouseStockSummaries,
    mockMatchings,
    mockMatchingHistories,
    mockMatchingStats,
    mockInventoryMatchingStats
} from '../data/inventory';
import {
    mockWarehouses as mockInventoryMatchingWarehouses,
    mockSuppliers,
    mockHolders,
    mockInventoryMatchings,
    searchSuppliers,
    searchHolders,
    paginateResults,
} from '../data/inventory';

// 재고 관련 handlers
export const stockHandlers = [
    // 재고 목록 조회
    http.get('/wms/inventory/stocks', () => {
        return HttpResponse.json(mockStocks);
    }),

    // 재고 요약 조회 (백엔드 스펙에 맞게 구현)
    http.get('/wms/inventory/stocks/summary', ({ request }) => {
        const url = new URL(request.url);
        const skuId = url.searchParams.get('skuId');
        const warehouseId = url.searchParams.get('warehouseId');

        let filteredSummaries = [...mockStockSummaries];

        if (skuId) {
            filteredSummaries = filteredSummaries.filter(s => s.skuId === skuId);
        }

        if (warehouseId) {
            filteredSummaries = filteredSummaries.filter(s => s.warehouseId === warehouseId);
        }

        return HttpResponse.json(filteredSummaries);
    }),

    // SKU별 총 재고 조회 (백엔드 스펙에 맞게 구현)
    http.get('/wms/inventory/stocks/sku/:skuId/total', ({ params }) => {
        const skuTotalStock = mockSkuTotalStocks.find(s => s.skuId === params.skuId);
        if (!skuTotalStock) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(skuTotalStock);
    }),

    // SKU별 창고 재고 상세 조회 (백엔드 스펙에 맞게 구현)
    http.get('/wms/inventory/stocks/sku/:skuId/warehouse/:warehouseId', ({ params }) => {
        const skuWarehouseStock = mockSkuWarehouseStocks.find(s =>
            s.summary.skuId === params.skuId && s.summary.warehouseId === params.warehouseId
        );
        if (!skuWarehouseStock) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(skuWarehouseStock);
    }),

    // 재고 이력 조회 (백엔드 스펙에 맞게 구현)
    http.get('/wms/inventory/stocks/history', ({ request }) => {
        const url = new URL(request.url);
        const skuId = url.searchParams.get('skuId');
        const warehouseId = url.searchParams.get('warehouseId');
        const startDate = url.searchParams.get('startDate');
        const endDate = url.searchParams.get('endDate');

        let filteredHistories = [...mockStockHistories];

        // 실제 구현에서는 더 정교한 필터링이 필요하지만, 목업에서는 간단히 처리
        return HttpResponse.json(filteredHistories);
    }),

    // 재고 조정
    http.post('/wms/inventory/stocks/adjust', async ({ request }) => {
        const adjustment = await request.json();
        return HttpResponse.json({ success: true, adjustment });
    }),

    // 재고 요약 재구성
    http.post('/wms/inventory/stocks/rebuild-summary', () => {
        return HttpResponse.json({ success: true });
    }),

    // 재고 이벤트 취소
    http.delete('/wms/inventory/stocks/events/:eventId', ({ params }) => {
        return HttpResponse.json({ success: true, eventId: params.eventId });
    }),
];

// SKU 관련 handlers
export const skuHandlers = [
    // SKU 검색 (백엔드 스펙에 맞게 구현)
    http.get('/wms/inventory/skus', ({ request }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get('id');
        const code = url.searchParams.get('code');
        const barcode = url.searchParams.get('barcode');
        const name = url.searchParams.get('name');
        const supplierName = url.searchParams.get('supplierName');
        const masterId = url.searchParams.get('masterId');

        let filteredSkus = [...mockSkus];

        // ID로 정확히 일치하는 경우
        if (id) {
            filteredSkus = filteredSkus.filter(sku => sku.id === id);
        }

        // 코드로 정확히 일치하는 경우
        if (code) {
            filteredSkus = filteredSkus.filter(sku => sku.code === code);
        }

        // 바코드로 검색 (기본 바코드 또는 서브 바코드)
        if (barcode) {
            filteredSkus = filteredSkus.filter(sku =>
                sku.defaultBarcode === barcode ||
                sku.barcodes?.some((b: any) => b.barcode === barcode)
            );
        }

        // 이름으로 부분 일치 검색
        if (name) {
            filteredSkus = filteredSkus.filter(sku =>
                sku.name.toLowerCase().includes(name.toLowerCase())
            );
        }

        // 공급사 이름으로 부분 일치 검색
        if (supplierName) {
            filteredSkus = filteredSkus.filter(sku =>
                sku.supplierNames?.some((supplier: string) =>
                    supplier.toLowerCase().includes(supplierName.toLowerCase())
                )
            );
        }

        // 마스터 ID로 정확히 일치하는 경우
        if (masterId) {
            filteredSkus = filteredSkus.filter(sku => sku.masterId === masterId);
        }

        return HttpResponse.json(filteredSkus);
    }),

    // 특정 SKU 조회
    http.get('/wms/inventory/skus/:id', ({ params }) => {
        const sku = mockSkus.find(s => s.id === params.id);
        if (!sku) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(sku);
    }),

    // SKU 재고 요약 조회
    http.get('/wms/inventory/skus/:sku/stock-summary', ({ params }) => {
        const skuStocks = mockStocks.filter(s => s.skuId === params.sku);
        return HttpResponse.json({ sku: params.sku, summary: skuStocks });
    }),

    // SKU 생성
    http.post('/wms/inventory/skus', async ({ request }) => {
        const newSku = await request.json() as Record<string, any>;
        return HttpResponse.json({ id: 'new-sku-id', ...newSku }, { status: 201 });
    }),

    // SKU 수정
    http.put('/wms/inventory/skus/:id', async ({ params, request }) => {
        const updatedData = await request.json() as Record<string, any>;
        return HttpResponse.json({ id: params.id, ...updatedData });
    }),

    // SKU 삭제
    http.delete('/wms/inventory/skus/:id', () => {
        return new HttpResponse(null, { status: 204 });
    }),

    // 바코드 추가
    http.post('/wms/inventory/skus/:id/barcodes', async ({ params, request }) => {
        const { barcode } = await request.json() as { barcode: string };
        return HttpResponse.json({ skuId: params.id, barcode });
    }),

    // 바코드 제거
    http.delete('/wms/inventory/skus/:id/barcodes/:barcode', ({ params }) => {
        return HttpResponse.json({ skuId: params.id, barcode: params.barcode });
    }),
];

// 창고 관련 handlers
export const warehouseHandlers = [
    // 창고 목록 조회
    http.get('/wms/inventory/warehouses', () => {
        return HttpResponse.json(mockWarehouses);
    }),

    // 자동재고매칭용 창고 목록 조회
    http.get('http://localhost:3010/warehouses', () => {
        console.log('🎯 MSW: 자동재고매칭용 창고 목록 조회');
        return HttpResponse.json(mockInventoryMatchingWarehouses);
    }),

    // 특정 창고 조회
    http.get('/wms/inventory/warehouses/:id', ({ params }) => {
        const warehouse = mockWarehouses.find((w: any) => w.id === params.id);
        if (!warehouse) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(warehouse);
    }),

    // 창고별 재고 요약 조회 (백엔드 스펙에 맞게 구현)
    http.get('/wms/inventory/warehouses/:id/stocks/summary', ({ params }) => {
        const warehouseSummary = mockWarehouseStockSummaries.find(w => w.warehouseId === params.id);
        if (!warehouseSummary) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(warehouseSummary);
    }),

    // 창고별 재고 목록 조회 (백엔드 스펙에 맞게 구현)
    http.get('/wms/inventory/warehouses/:id/stocks', ({ params }) => {
        const warehouseStocks = mockStockSummaries.filter(s => s.warehouseId === params.id);
        return HttpResponse.json(warehouseStocks);
    }),

    // 창고 생성
    http.post('/wms/inventory/warehouses', async ({ request }) => {
        const newWarehouse = await request.json() as Record<string, any>;
        return HttpResponse.json({ id: 'new-warehouse-id', ...newWarehouse }, { status: 201 });
    }),

    // 창고 수정
    http.patch('/wms/inventory/warehouses/:id', async ({ params, request }) => {
        const updatedData = await request.json() as Record<string, any>;
        return HttpResponse.json({ id: params.id, ...updatedData });
    }),

    // 창고 삭제
    http.delete('/wms/inventory/warehouses/:id', () => {
        return new HttpResponse(null, { status: 204 });
    }),
];

// 입고 관련 handlers
export const inboundHandlers = [
    // 입고 목록 조회
    http.get('/wms/inventory/inbounds', () => {
        return HttpResponse.json(mockInbounds);
    }),

    // 특정 입고 조회
    http.get('/wms/inventory/inbounds/:id', ({ params }) => {
        const inbound = mockInbounds.find((i: any) => i.id === params.id);
        if (!inbound) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(inbound);
    }),

    // 입고 아이템 조회
    http.get('/wms/inventory/inbounds/:id/items', ({ params }) => {
        return HttpResponse.json([]);
    }),
];

// 검수 관련 handlers
export const inspectionHandlers = [
    // 검수 목록 조회
    http.get('/wms/inventory/inspections', () => {
        return HttpResponse.json(mockInspections);
    }),

    // 특정 검수 조회
    http.get('/wms/inventory/inspections/:id', ({ params }) => {
        const inspection = mockInspections.find((i: any) => i.id === params.id);
        if (!inspection) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(inspection);
    }),
];

// 이동 관련 handlers
export const movementHandlers = [
    // 이동 목록 조회
    http.get('/wms/inventory/movements', () => {
        return HttpResponse.json(mockMovements);
    }),

    // 특정 이동 조회
    http.get('/wms/inventory/movements/:id', ({ params }) => {
        const movement = mockMovements.find((m: any) => m.id === params.id);
        if (!movement) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(movement);
    }),
];

// 통합 관련 handlers
export const consolidationHandlers = [
    // 통합 목록 조회
    http.get('/wms/inventory/consolidations', () => {
        return HttpResponse.json(mockConsolidations);
    }),

    // 특정 통합 조회
    http.get('/wms/inventory/consolidations/:id', ({ params }) => {
        const consolidation = mockConsolidations.find((c: any) => c.id === params.id);
        if (!consolidation) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(consolidation);
    }),
];

// 매칭 관련 handlers (백엔드 스펙에 맞게 구현)
export const matchingHandlers = [
    // 매칭 목록 조회
    http.get('/wms/inventory/matchings', ({ request }) => {
        const url = new URL(request.url);
        const sellingProductId = url.searchParams.get('sellingProductId');
        const sellingProductName = url.searchParams.get('sellingProductName');
        const skuId = url.searchParams.get('skuId');
        const skuName = url.searchParams.get('skuName');
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = parseInt(url.searchParams.get('limit') || '10');

        let filteredMatchings = [...mockMatchings];

        if (sellingProductId) {
            filteredMatchings = filteredMatchings.filter(m => m.sellingProductId === sellingProductId);
        }

        if (sellingProductName) {
            filteredMatchings = filteredMatchings.filter(m =>
                m.sellingProductName.toLowerCase().includes(sellingProductName.toLowerCase())
            );
        }

        if (skuId) {
            filteredMatchings = filteredMatchings.filter(m =>
                m.linkedSkus.some(sku => sku.skuId === skuId)
            );
        }

        if (skuName) {
            filteredMatchings = filteredMatchings.filter(m =>
                m.linkedSkus.some(sku => sku.skuName.toLowerCase().includes(skuName.toLowerCase()))
            );
        }

        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedMatchings = filteredMatchings.slice(startIndex, endIndex);

        return HttpResponse.json({
            data: paginatedMatchings,
            pagination: {
                page,
                limit,
                total: filteredMatchings.length,
                totalPages: Math.ceil(filteredMatchings.length / limit),
            },
        });
    }),

    // 특정 매칭 조회
    http.get('/wms/inventory/matchings/:id', ({ params }) => {
        const matching = mockMatchings.find(m => m.id === params.id);
        if (!matching) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(matching);
    }),

    // 매칭 생성
    http.post('/wms/inventory/matchings', async ({ request }) => {
        const newMatching = await request.json();
        const createdMatching = {
            id: `matching-${Date.now()}`,
            ...(newMatching as any),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        return HttpResponse.json(createdMatching, { status: 201 });
    }),

    // 매칭 수정
    http.patch('/wms/inventory/matchings/:id', async ({ params, request }) => {
        const updatedData = await request.json();
        const existingMatching = mockMatchings.find(m => m.id === params.id);
        if (!existingMatching) {
            return new HttpResponse(null, { status: 404 });
        }
        const updatedMatching = {
            ...existingMatching,
            ...(updatedData as any),
            updatedAt: new Date().toISOString(),
        };
        return HttpResponse.json(updatedMatching);
    }),

    // 매칭 삭제
    http.delete('/wms/inventory/matchings/:id', ({ params }) => {
        const matching = mockMatchings.find(m => m.id === params.id);
        if (!matching) {
            return new HttpResponse(null, { status: 404 });
        }
        return new HttpResponse(null, { status: 204 });
    }),

    // 매칭 이력 조회
    http.get('/wms/inventory/matchings/:id/history', ({ params }) => {
        const histories = mockMatchingHistories.filter(h => h.matchingId === params.id);
        return HttpResponse.json(histories);
    }),

    // 매칭 통계 조회
    http.get('/wms/inventory/matchings/stats', () => {
        return HttpResponse.json(mockMatchingStats);
    }),
];

// 자동재고매칭 관련 handlers (기존 inventory-matching에서 통합)
export const inventoryMatchingHandlers = [
    // 자동재고매칭 생성
    http.post('http://localhost:3010/inventory-matching', async ({ request }) => {
        console.log('🎯 MSW: 자동재고매칭 생성');
        const data = await request.json() as any;

        // 공급처, 재고소유, 창고 정보 조회
        const supplier = mockSuppliers.find(s => s.id === data.supplierId);
        const holder = mockHolders.find(h => h.id === data.stockOwnerId);
        const warehouse = mockInventoryMatchingWarehouses.find(w => w.id === data.warehouseId);

        if (!supplier || !holder || !warehouse) {
            return new HttpResponse(
                { error: 'Invalid supplier, holder, or warehouse ID' },
                { status: 400 }
            );
        }

        const newMatching = {
            id: `matching-${Date.now()}`,
            ...data,
            supplier,
            stockOwner: holder,
            warehouse,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        } as any;

        mockInventoryMatchings.push(newMatching);
        return HttpResponse.json(newMatching, { status: 201 });
    }),

    // 자동재고매칭 목록 조회 (백엔드 스펙에 맞게 구현)
    http.get('http://localhost:3010/inventory-matching', ({ request }) => {
        console.log('🎯 MSW: 자동재고매칭 목록 조회');
        const url = new URL(request.url);
        const sellingProductId = url.searchParams.get('sellingProductId');
        const sellingProductName = url.searchParams.get('sellingProductName');
        const productType = url.searchParams.get('productType');
        const supplierId = url.searchParams.get('supplierId');
        const stockOwnerId = url.searchParams.get('stockOwnerId');
        const warehouseId = url.searchParams.get('warehouseId');
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = parseInt(url.searchParams.get('limit') || '10');

        let filteredMatchings = [...mockInventoryMatchings];

        if (sellingProductId) {
            filteredMatchings = filteredMatchings.filter(m => m.sellingProductId === sellingProductId);
        }

        if (sellingProductName) {
            filteredMatchings = filteredMatchings.filter(m =>
                m.sellingProductName.toLowerCase().includes(sellingProductName.toLowerCase())
            );
        }

        if (productType) {
            filteredMatchings = filteredMatchings.filter(m => m.productType === productType);
        }

        if (supplierId) {
            filteredMatchings = filteredMatchings.filter(m => m.supplierId === supplierId);
        }

        if (stockOwnerId) {
            filteredMatchings = filteredMatchings.filter(m => m.stockOwnerId === stockOwnerId);
        }

        if (warehouseId) {
            filteredMatchings = filteredMatchings.filter(m => m.warehouseId === warehouseId);
        }

        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedMatchings = filteredMatchings.slice(startIndex, endIndex);

        return HttpResponse.json({
            data: paginatedMatchings,
            pagination: {
                page,
                limit,
                total: filteredMatchings.length,
                totalPages: Math.ceil(filteredMatchings.length / limit),
            },
        });
    }),

    // 자동재고매칭 통계 조회 (백엔드 스펙에 맞게 구현)
    http.get('http://localhost:3010/inventory-matching/stats', () => {
        console.log('🎯 MSW: 자동재고매칭 통계 조회');
        return HttpResponse.json(mockInventoryMatchingStats);
    }),

    // 자동재고매칭 수정 (백엔드 스펙에 맞게 구현)
    http.patch('http://localhost:3010/inventory-matching/:id', async ({ params, request }) => {
        console.log('🎯 MSW: 자동재고매칭 수정', params.id);
        const updatedData = await request.json();
        const existingMatching = mockInventoryMatchings.find(m => m.id === params.id);
        if (!existingMatching) {
            return new HttpResponse(null, { status: 404 });
        }
        const updatedMatching = {
            ...existingMatching,
            ...updatedData,
            updatedAt: new Date().toISOString(),
        } as any;
        return HttpResponse.json(updatedMatching);
    }),

    // 자동재고매칭 삭제 (백엔드 스펙에 맞게 구현)
    http.delete('http://localhost:3010/inventory-matching/:id', ({ params }) => {
        console.log('🎯 MSW: 자동재고매칭 삭제', params.id);
        const matching = mockInventoryMatchings.find(m => m.id === params.id);
        if (!matching) {
            return new HttpResponse(null, { status: 404 });
        }
        return new HttpResponse(null, { status: 204 });
    }),

    // 특정 자동재고매칭 조회
    http.get('http://localhost:3010/inventory-matching/:id', ({ params }) => {
        console.log('🎯 MSW: 자동재고매칭 상세 조회', params.id);
        const matching = mockInventoryMatchings.find(m => m.id === params.id);
        if (!matching) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(matching);
    }),
];

// 공급처 관련 handlers (자동재고매칭용)
export const supplierHandlers = [
    // 공급처 목록 조회
    http.get('http://localhost:3010/suppliers', ({ request }) => {
        console.log('🎯 MSW: 공급처 목록 조회');
        const url = new URL(request.url);
        const search = url.searchParams.get('search');
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = parseInt(url.searchParams.get('limit') || '10');

        const filteredSuppliers = search ? searchSuppliers(search) : mockSuppliers;
        const result = paginateResults(filteredSuppliers, page, limit);

        return HttpResponse.json(result);
    }),

    // 공급처 검색
    http.get('http://localhost:3010/suppliers/search', ({ request }) => {
        console.log('🎯 MSW: 공급처 검색');
        const url = new URL(request.url);
        const query = url.searchParams.get('q') || '';
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = parseInt(url.searchParams.get('limit') || '10');

        const filteredSuppliers = searchSuppliers(query);
        const result = paginateResults(filteredSuppliers, page, limit);

        return HttpResponse.json(result);
    }),

    // 특정 공급처 조회
    http.get('http://localhost:3010/suppliers/:id', ({ params }) => {
        console.log('🎯 MSW: 공급처 상세 조회', params.id);
        const supplier = mockSuppliers.find(s => s.id === params.id);
        if (!supplier) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(supplier);
    }),

    // 공급처 생성
    http.post('http://localhost:3010/suppliers', async ({ request }) => {
        console.log('🎯 MSW: 공급처 생성');
        const data = await request.json() as any;
        const newSupplier = {
            id: `supplier-${Date.now()}`,
            ...data,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        mockSuppliers.push(newSupplier);
        return HttpResponse.json(newSupplier, { status: 201 });
    }),
];

// 재고소유 관련 handlers (자동재고매칭용)
export const holderHandlers = [
    // 재고소유 목록 조회
    http.get('http://localhost:3010/holders', ({ request }) => {
        console.log('🎯 MSW: 재고소유 목록 조회');
        const url = new URL(request.url);
        const search = url.searchParams.get('search');
        const isOurAsset = url.searchParams.get('isOurAsset');
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = parseInt(url.searchParams.get('limit') || '10');

        const filteredHolders = searchHolders(
            search || '',
            isOurAsset ? isOurAsset === 'true' : undefined
        );
        const result = paginateResults(filteredHolders, page, limit);

        return HttpResponse.json(result);
    }),

    // 재고소유 검색
    http.get('http://localhost:3010/holders/search', ({ request }) => {
        console.log('🎯 MSW: 재고소유 검색');
        const url = new URL(request.url);
        const query = url.searchParams.get('q') || '';
        const isOurAsset = url.searchParams.get('isOurAsset');
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = parseInt(url.searchParams.get('limit') || '10');

        const filteredHolders = searchHolders(
            query,
            isOurAsset ? isOurAsset === 'true' : undefined
        );
        const result = paginateResults(filteredHolders, page, limit);

        return HttpResponse.json(result);
    }),

    // 특정 재고소유 조회
    http.get('http://localhost:3010/holders/:id', ({ params }) => {
        console.log('🎯 MSW: 재고소유 상세 조회', params.id);
        const holder = mockHolders.find(h => h.id === params.id);
        if (!holder) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(holder);
    }),

    // 재고소유 생성
    http.post('http://localhost:3010/holders', async ({ request }) => {
        console.log('🎯 MSW: 재고소유 생성');
        const data = await request.json() as any;
        const newHolder = {
            id: `holder-${Date.now()}`,
            ...data,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        mockHolders.push(newHolder);
        return HttpResponse.json(newHolder, { status: 201 });
    }),
];

// 모든 재고 관련 handlers 통합
export const inventoryHandlers = [
    ...stockHandlers,
    ...skuHandlers,
    ...warehouseHandlers,
    ...inboundHandlers,
    ...inspectionHandlers,
    ...movementHandlers,
    ...consolidationHandlers,
    ...matchingHandlers,
    ...inventoryMatchingHandlers,
    ...supplierHandlers,
    ...holderHandlers,
];
