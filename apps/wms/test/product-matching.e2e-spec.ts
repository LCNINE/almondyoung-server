import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { WmsModule } from '../src/wms.module';
import { ProductMatchingService } from '../src/product-matching/product-matching.service';
import { SkuService } from '../src/sku/sku.service';
import { InjectTypedDb } from '@app/db/decorators';
import { TypedDatabase } from '@app/db';
import { wmsTables } from '../database/schemas/wms-schema';
import { and, eq, like } from 'drizzle-orm';
import { CreateSkuDto } from '../src/sku/dto/create-sku.dto';

describe('ProductMatching (e2e)', () => {
    let app: INestApplication;
    let productMatchingService: ProductMatchingService;
    let skuService: SkuService;
    let db: TypedDatabase<typeof wmsTables>;

    // 테스트 데이터 정리용 함수
    const cleanupDatabase = async () => {
        await db.delete(wmsTables.productVariantSkuLinks);
        await db.delete(wmsTables.productMatchings);
        await db.delete(wmsTables.stockEvents);
        await db.delete(wmsTables.stocks);
        await db.delete(wmsTables.skuBarcodes);
        await db.delete(wmsTables.skus).where(like(wmsTables.skus.name, 'E2E Test %'));
    };

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [WmsModule],
        }).compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe()); // DTO 유효성 검사를 위해 추가
        await app.init();

        // 테스트에 필요한 서비스 및 DB 인스턴스 가져오기
        productMatchingService = moduleFixture.get<ProductMatchingService>(ProductMatchingService);
        skuService = moduleFixture.get<SkuService>(SkuService);
        db = moduleFixture.get<TypedDatabase<typeof wmsTables>>('default'); // 'default'는 DB 주입 토큰

        // 테스트 시작 전 DB 정리
        await cleanupDatabase();
    });

    afterAll(async () => {
        // 모든 테스트 후 DB 정리 및 앱 종료
        await cleanupDatabase();
        await app.close();
    });

    // 각 테스트 케이스 실행 전 DB 상태 초기화
    beforeEach(async () => {
        await cleanupDatabase();
    });

    describe('자동 매칭 시나리오', () => {
        it('재고 관리 대상(inventoryManagement: true)인 번들 상품이 자동 매칭되어야 한다', async () => {
            // 1. 테스트용 PIM 페이로드 (번들 상품: 1 variant, 2 components)
            const pimPayload = {
                productId: 'e2e-product-01',
                name: 'E2E Test 번들 세트',
                variants: [
                    {
                        id: 'e2e-variant-01',
                        name: '선물 세트 A',
                        inventoryManagement: true,
                        components: [
                            { skuName: 'E2E Test SKU - 상자' },
                            { skuName: 'E2E Test SKU - 리본' },
                        ],
                    },
                ],
            };

            // 2. 자동 매칭 서비스 직접 호출 (PIM 이벤트 수신 모방)
            await productMatchingService.handleAutomaticMatchingRequest(pimPayload);

            // 3. DB에서 결과 검증
            // 3-1. product_matchings 테이블 검증
            const matching = await db.query.productMatchings.findFirst({
                where: eq(wmsTables.productMatchings.variantId, 'e2e-variant-01'),
            });

            if (!matching) {
                throw new Error('productMatchings 테이블에서 매칭 결과를 찾을 수 없습니다.');
            }
            expect(matching.status).toBe('matched');
            expect(matching.isResolved).toBe(true);

            // 3-2. skus 테이블 검증
            const boxSku = await db.query.skus.findFirst({ where: eq(wmsTables.skus.name, 'E2E Test SKU - 상자') });
            const ribbonSku = await db.query.skus.findFirst({ where: eq(wmsTables.skus.name, 'E2E Test SKU - 리본') });
            expect(boxSku).toBeDefined();
            expect(ribbonSku).toBeDefined();

            // 3-3. stocks 테이블 검증 (재고 0으로 생성)
            if (!boxSku) {
                throw new Error('boxSku가 정의되어 있지 않습니다.');
            }
            if (!ribbonSku) {
                throw new Error('ribbonSku가 정의되어 있지 않습니다.');
            }
            const boxStock = await db.query.stocks.findFirst({ where: eq(wmsTables.stocks.skuId, boxSku.id) });
            const ribbonStock = await db.query.stocks.findFirst({ where: eq(wmsTables.stocks.skuId, ribbonSku.id) });
            expect(boxStock).toBeDefined();
            expect(boxStock?.realQuantity).toBe(0);
            expect(ribbonStock).toBeDefined();
            expect(ribbonStock?.realQuantity).toBe(0);

            // 3-4. product_variant_sku_links 테이블 검증 (M:N 관계)
            const links = await db.query.productVariantSkuLinks.findMany({
                where: eq(wmsTables.productVariantSkuLinks.productMatchingId, matching.id),
            });
            expect(links.length).toBe(2);
            const linkedSkuIds = links.map(l => l.skuId);
            expect(boxSku).toBeDefined();
            expect(ribbonSku).toBeDefined();
            if (boxSku && ribbonSku) {
                expect(linkedSkuIds).toContain(boxSku.id);
                expect(linkedSkuIds).toContain(ribbonSku.id);
            }
        });
    });

    describe('수동 매칭 시나리오', () => {
        let pendingMatchingId: string;
        let existingSku1: any;
        let existingSku2: any;

        beforeEach(async () => {
            // 1. 테스트용 'pending' 상태 매칭 생성
            const pimPayload = {
                productId: 'e2e-product-manual',
                name: 'E2E Test 수동 매칭 상품',
                variants: [{ id: 'e2e-variant-manual', name: '수동 옵션', inventoryManagement: true, components: [] }],
            };
            await productMatchingService.handleManualMatchingRequest(pimPayload);
            const matching = await db.query.productMatchings.findFirst({ where: eq(wmsTables.productMatchings.variantId, 'e2e-variant-manual') });
            if (!matching) {
                throw new Error('matching이 정의되어 있지 않습니다.');
            }
            pendingMatchingId = matching.id;

            // 2. 미리 연결할 SKU 2개 생성
            existingSku1 = await skuService._createSkuInternal({ name: 'E2E Test 기존 SKU 1', inventoryManagement: true });
            existingSku2 = await skuService._createSkuInternal({ name: 'E2E Test 기존 SKU 2', inventoryManagement: true });
        });

        it('GET /wms/matchings : pending 상태의 매칭 목록을 조회해야 한다', async () => {
            return request(app.getHttpServer())
                .get('/wms/matchings?status=pending')
                .expect(200)
                .then((res) => {
                    expect(res.body).toBeInstanceOf(Array);
                    expect(res.body.length).toBe(1);
                    expect(res.body[0].id).toBe(pendingMatchingId);
                    expect(res.body[0].status).toBe('pending');
                });
        });

        it('PATCH /wms/matchings/:id/resolve : pending 상태의 매칭을 여러 SKU와 연결(해소)해야 한다', async () => {
            const resolveDto = {
                skuIds: [existingSku1.id, existingSku2.id],
            };

            await request(app.getHttpServer())
                .patch(`/wms/matchings/${pendingMatchingId}/resolve`)
                .send(resolveDto)
                .expect(200)
                .then((res) => {
                    expect(res.body.id).toBe(pendingMatchingId);
                    expect(res.body.status).toBe('matched');
                    expect(res.body.isResolved).toBe(true);
                });

            // DB에서 링크 직접 확인
            const links = await db.query.productVariantSkuLinks.findMany({
                where: eq(wmsTables.productVariantSkuLinks.productMatchingId, pendingMatchingId),
            });
            expect(links.length).toBe(2);
        });

        it('PATCH /wms/matchings/:id/resolve : pending 상태의 매칭을 무시(ignore)해야 한다', async () => {
            const resolveDto = {
                ignore: true,
            };

            return request(app.getHttpServer())
                .patch(`/wms/matchings/${pendingMatchingId}/resolve`)
                .send(resolveDto)
                .expect(200)
                .then(async (res) => {
                    expect(res.body.status).toBe('ignored');
                    expect(res.body.isResolved).toBe(true);

                    // DB에서 상태 직접 확인
                    const ignoredMatching = await db.query.productMatchings.findFirst({ where: eq(wmsTables.productMatchings.id, pendingMatchingId) });
                    expect(ignoredMatching).toBeDefined();
                    expect(ignoredMatching?.status).toBe('ignored');
                });
        });
    });
});