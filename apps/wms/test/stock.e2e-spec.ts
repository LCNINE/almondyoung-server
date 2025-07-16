// apps/wms/test/stock.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { WmsModule } from '../src/wms.module';

describe('재고 관리 E2E 테스트', () => {
    let app: INestApplication;
    let testSkuId: string;
    let testStockId: string;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [WmsModule],
        }).compile();

        app = moduleFixture.createNestApplication();
        await app.init();

        // 테스트용 SKU 생성
        const skuResponse = await request(app.getHttpServer())
            .post('/wms/stocks/entry')
            .send({
                skuName: 'E2E Test SKU',
                inventoryManagement: true,
                warehouseId: '00000000-0000-0000-0000-000000000001',
                quantity: 100,
                stockType: 'physical',
                reason: 'E2E 테스트 초기 재고'
            });

        testSkuId = skuResponse.body.skuId;
        testStockId = skuResponse.body.id;
    });

    afterAll(async () => {
        await app.close();
    });

    describe('재고 입고 API', () => {
        it('국내 거래처 입고를 처리해야 한다', async () => {
            const inboundDto = {
                skuId: testSkuId,
                quantity: 50,
                supplierType: 'domestic',
                reason: '국내 거래처 정기 입고'
            };

            const response = await request(app.getHttpServer())
                .post('/wms/stocks/inbound')
                .send(inboundDto)
                .expect(201);

            expect(response.body).toMatchObject({
                skuId: testSkuId,
                realQuantity: 50,
                availableQuantity: 50,
                warehouseId: '00000000-0000-0000-0000-000000000001'
            });
        });

        it('해외 거래처 입고를 처리해야 한다', async () => {
            const inboundDto = {
                skuId: testSkuId,
                quantity: 100,
                supplierType: 'overseas',
                reason: '해외 거래처 대량 입고',
                expiryDate: '2025-12-31'
            };

            const response = await request(app.getHttpServer())
                .post('/wms/stocks/inbound')
                .send(inboundDto)
                .expect(201);

            expect(response.body.warehouseId).toBe('00000000-0000-0000-0000-000000000002');
        });
    });

    describe('재고 이동 API', () => {
        it('창고 간 재고를 이동해야 한다', async () => {
            const transferDto = {
                fromWarehouseId: '00000000-0000-0000-0000-000000000001',
                toWarehouseId: '00000000-0000-0000-0000-000000000002',
                skuId: testSkuId,
                quantity: 30,
                reason: '재고 균형 조정'
            };

            const response = await request(app.getHttpServer())
                .post('/wms/stocks/transfer/inter-warehouse')
                .send(transferDto)
                .expect(200);

            expect(response.body).toMatchObject({
                skuId: testSkuId,
                quantity: 30,
                fromWarehouseId: '00000000-0000-0000-0000-000000000001',
                toWarehouseId: '00000000-0000-0000-0000-000000000002'
            });
        });

        it('창고 내 위치를 이동해야 한다 (위치가 없으면 404)', async () => {
            // 먼저 위치 생성이 필요 (실제 테스트에서는 setUp에서 처리)
            const moveDto = {
                stockId: testStockId,
                newLocationId: 'test-location-id',
                reason: '재고 정리'
            };

            // 위치가 없으면 404 에러가 날 것임
            await request(app.getHttpServer())
                .post('/wms/stocks/transfer/intra-warehouse')
                .send(moveDto)
                .expect(404);
        });
    });

    describe('재고 출고 API', () => {
        it('주문 출고를 처리해야 한다', async () => {
            const outboundDto = {
                quantity: 20,
                reason: '온라인 주문 출고',
                orderId: 'order-123'
            };

            const response = await request(app.getHttpServer())
                .post(`/wms/stocks/outbound/${testStockId}`)
                .send(outboundDto)
                .expect(200);

            expect(response.body).toMatchObject({
                processedQuantity: 20,
                orderId: 'order-123'
            });
        });
    });

    describe('재고 조회 API', () => {
        it('SKU별 재고를 조회해야 한다', async () => {
            const response = await request(app.getHttpServer())
                .get(`/wms/stocks?skuId=${testSkuId}`)
                .expect(200);

            expect(response.body).toBeInstanceOf(Array);
            expect(response.body.length).toBeGreaterThan(0);
            expect(response.body[0]).toHaveProperty('skuId', testSkuId);
        });

        it('창고별 재고 요약을 조회해야 한다', async () => {
            const response = await request(app.getHttpServer())
                .get('/wms/stocks/warehouse/00000000-0000-0000-0000-000000000001/summary')
                .expect(200);

            expect(response.body).toHaveProperty('warehouseId');
            expect(response.body).toHaveProperty('summary');
            expect(response.body).toHaveProperty('totalSkus');
            expect(response.body).toHaveProperty('totalQuantity');
        });

        it('재고 이력을 조회해야 한다', async () => {
            const response = await request(app.getHttpServer())
                .get(`/wms/stocks/history?skuId=${testSkuId}`)
                .expect(200);

            expect(response.body).toBeInstanceOf(Array);
            response.body.forEach((event: any) => {
                expect(event).toHaveProperty('eventType');
                expect(event).toHaveProperty('quantity');
                expect(event).toHaveProperty('eventTimestamp');
            });
        });
    });

    describe('관리자 조정 API', () => {
        it('재고 수량을 수동으로 조정해야 한다', async () => {
            const adjustDto = {
                stockId: testStockId,
                delta: -5,
                reason: '재고 실사 차이 조정'
            };

            await request(app.getHttpServer())
                .post('/wms/stocks/adjust')
                .send(adjustDto)
                .expect(200);
        });
    });
});