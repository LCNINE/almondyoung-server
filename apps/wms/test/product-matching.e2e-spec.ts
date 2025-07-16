// apps/wms/test/product-matching.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { WmsModule } from '../src/wms.module';
import { TypedDatabase } from '@app/db';
import { wmsTables } from '../database/schemas/wms-schema';

describe('ProductMatching E2E 테스트', () => {
    let app: INestApplication;
    let db: TypedDatabase<typeof wmsTables>;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [WmsModule],
        }).compile();

        app = moduleFixture.createNestApplication();
        await app.init();

        // 데이터베이스 연결 가져오기
        db = app.get<TypedDatabase<typeof wmsTables>>('TypedDatabase');
    });

    afterAll(async () => {
        await app.close();
    });

    describe('PIM 이벤트 테스트 API', () => {
        it('자동 매칭 이벤트를 처리해야 한다', async () => {
            const payload = {
                productId: 'test-product-1',
                name: '테스트 상품',
                variants: [
                    {
                        id: 'test-variant-1',
                        name: '노란우비 세트',
                        inventoryManagement: true,
                        components: [
                            { skuName: '노란우비' },
                            { skuName: '노란우산' }
                        ]
                    }
                ]
            };

            const response = await request(app.getHttpServer())
                .post('/wms/test/pim-events/auto-matching')
                .send(payload)
                .expect(201);

            expect(response.body).toEqual({
                message: '자동 매칭 이벤트 처리 완료'
            });

            // 데이터베이스에 실제로 생성되었는지 확인
            const matching = await db.query.productMatchings.findFirst({
                where: (m, { eq }) => eq(m.variantId, 'test-variant-1')
            });
            expect(matching).toBeTruthy();
            expect(matching?.status).toBe('matched');
        });

        it('수동 매칭을 위한 pending 상태를 생성해야 한다', async () => {
            const payload = {
                productId: 'test-product-2',
                name: '수동 매칭 상품',
                variants: [
                    {
                        id: 'test-variant-2',
                        name: '빨간우비 세트',
                        inventoryManagement: true,
                        components: [
                            { skuName: '빨간우비' }
                        ]
                    }
                ]
            };

            await request(app.getHttpServer())
                .post('/wms/test/pim-events/manual-matching')
                .send(payload)
                .expect(201);

            // GET으로 pending 상태 확인
            const pendingResponse = await request(app.getHttpServer())
                .get('/wms/matchings?status=pending')
                .expect(200);

            const pendingItems = pendingResponse.body;
            const foundItem = pendingItems.find((item: any) => item.variantId === 'test-variant-2');

            expect(foundItem).toBeTruthy();
            expect(foundItem.status).toBe('pending');
            expect(foundItem.priority).toBe('high');
        });
    });

    describe('매칭 관리 API', () => {
        let matchingId: string;

        beforeEach(async () => {
            // 테스트용 pending 매칭 생성
            const [result] = await db.insert(wmsTables.productMatchings).values({
                variantId: 'test-variant-resolve',
                status: 'pending',
                priority: 'high',
                isResolved: false,
            }).returning();
            matchingId = result.id;
        });

        it('SKU와 매칭을 해결해야 한다', async () => {
            // 먼저 SKU 생성
            const [skuResult] = await db.insert(wmsTables.skus).values({
                name: 'Test SKU',
                code: 'TEST-SKU-001',
                inventoryManagement: true,
            }).returning();
            const skuId = skuResult.id;

            const resolveDto = {
                skuIds: [skuId],
                ignore: false
            };

            await request(app.getHttpServer())
                .patch(`/wms/matchings/${matchingId}/resolve`)
                .send(resolveDto)
                .expect(200);

            // 매칭이 resolved 되었는지 확인
            const matching = await db.query.productMatchings.findFirst({
                where: (m, { eq }) => eq(m.id, matchingId)
            });

            expect(matching?.status).toBe('matched');
            expect(matching?.isResolved).toBe(true);
        });

        it('매칭을 무시 처리해야 한다', async () => {
            const resolveDto = {
                ignore: true
            };

            await request(app.getHttpServer())
                .patch(`/wms/matchings/${matchingId}/resolve`)
                .send(resolveDto)
                .expect(200);

            const matching = await db.query.productMatchings.findFirst({
                where: (m, { eq }) => eq(m.id, matchingId)
            });

            expect(matching?.status).toBe('ignored');
            expect(matching?.isResolved).toBe(true);
        });

        it('매칭 우선순위를 변경해야 한다', async () => {
            await request(app.getHttpServer())
                .patch(`/wms/matchings/${matchingId}/priority`)
                .send({ priority: 'normal' })
                .expect(200);

            const matching = await db.query.productMatchings.findFirst({
                where: (m, { eq }) => eq(m.id, matchingId)
            });

            expect(matching?.priority).toBe('normal');
        });
    });

    // 테스트 후 정리 (선택사항)
    afterEach(async () => {
        // 테스트 데이터 정리가 필요한 경우
        // await db.delete(wmsTables.productMatchings).where(...);
    });
});