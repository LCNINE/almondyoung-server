import { Test, TestingModule } from '@nestjs/testing';
import { DbModule, DbService } from '@app/db';
import { generateUUIDv7 } from '../../shared/utils/id-generator';


// 테스트 대상 모듈 및 서비스
import { PointService } from '../points/point.service';
import { PointReader } from '../points/point.reader';
import { PointManager } from '../points/point.manager';
import { PointRepository } from '../points/point.repository';

import { walletSchema } from '../../shared/database/schema';
import * as schema from '../../shared/database/schema';
import { eq } from 'drizzle-orm';

describe('포인트 시스템 통합 테스트', () => {
    let module: TestingModule;
    let dbService: DbService<typeof walletSchema>;

    let pointService: PointService;
    let pointRepository: PointRepository;

    beforeAll(async () => {
        module = await Test.createTestingModule({
            imports: [
                DbModule.forRoot({
                    config: {
                        connectionString:
                            process.env.DATABASE_URL ||
                            'postgresql://neondb_owner:npg_UdDYLFvO5Tq2@ep-young-pine-a149ey1z-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
                    },
                    schema: walletSchema,
                }),
            ],
            providers: [
                PointService,
                PointReader,
                PointManager,
                PointRepository,
            ],
        }).compile();

        dbService = module.get<DbService<typeof walletSchema>>(DbService);
        pointService = module.get<PointService>(PointService);
        pointRepository = module.get<PointRepository>(PointRepository);
    });

    beforeEach(async () => {
        // 개별 테스트 전 데이터 클린업은 하지 않음 (테스트 간 독립성 보장을 위해 랜덤 ID 사용)
        // 필요시 cleanupDatabase() 호출
    });

    afterAll(async () => {
        await module.close();
    });

    /**
     * 테스트 헬퍼: 파트너 생성
     * (Locking을 위해 partners 테이블에 레코드가 있어야 함)
     */
    async function createPartner(memberId: string) {
        await dbService.db.insert(schema.partners).values({
            mallId: 'test-mall',
            memberId: memberId,
            name: '테스트유저',
            referralCode: `REF-${memberId}`, // Use full UUID to ensure uniqueness
        });
    }

    describe('🎯 포인트 적립 및 사용 기본 플로우', () => {
        it('🎯 [성공] 포인트 적립 -> 조회 -> 사용 -> 잔액 확인', async () => {
            // 1. Given
            const partnerId = generateUUIDv7();
            await createPartner(partnerId);

            // 2. When: 1000원 적립
            await pointService.addPoints({
                partnerId,
                amount: 1000,
                reason: '테스트 적립 1',
            });

            // 3. Then: 잔액 1000원 확인
            let balance = await pointService.getBalance(partnerId);
            expect(balance).toBe(1000);

            // 4. When: 500원 추가 적립
            await pointService.addPoints({
                partnerId,
                amount: 500,
                reason: '테스트 적립 2',
            });

            // 5. Then: 잔액 1500원 확인
            balance = await pointService.getBalance(partnerId);
            expect(balance).toBe(1500);

            // 6. When: 300원 사용
            await pointService.redeem({
                partnerId,
                amount: 300,
                reason: '테스트 사용',
            });

            // 7. Then: 잔액 1200원 확인
            balance = await pointService.getBalance(partnerId);
            expect(balance).toBe(1200);

            // 8. History 확인
            const history = await pointService.getHistory(partnerId, 10, 0);
            expect(history.total).toBe(3); // 적립, 적립, 사용
            expect(Number(history.items[0].balance)).toBe(1200); // 최신 내역의 잔액

            expect(history.items[0].eventType).toBe('REDEEM');
        }, 30000); // Increase timeout

        it('🎯 [실패] 잔액 부족 시 사용 실패', async () => {
            const partnerId = generateUUIDv7();
            await createPartner(partnerId);

            await pointService.addPoints({
                partnerId,
                amount: 100,
            });

            await expect(
                pointService.redeem({
                    partnerId,
                    amount: 200, // 잔액보다 큰 금액
                }),
            ).rejects.toThrow('포인트가 부족합니다');
        }, 30000);
    });

    describe('🎯 동시성 제어 테스트', () => {
        it('🎯 [성공] 동시에 여러 사용 요청이 들어와도 잔액이 정확해야 함', async () => {
            const partnerId = generateUUIDv7();
            await createPartner(partnerId);

            // 초기 잔액 10,000원
            await pointService.addPoints({
                partnerId,
                amount: 10000,
            });

            // 100원씩 10번 동시에 사용 요청
            const requests = Array(10).fill(null).map((_, i) =>
                pointService.redeem({
                    partnerId,
                    amount: 100,
                    reason: `동시 사용 ${i}`,
                })
            );

            await Promise.all(requests);

            // 최종 잔액 확인: 10000 - (100 * 10) = 9000
            const balance = await pointService.getBalance(partnerId);
            expect(balance).toBe(9000);

            // 히스토리 확인
            const history = await pointService.getHistory(partnerId, 20, 0);
            expect(history.total).toBe(11); // 초기적립 1 + 사용 10
        }, 30000);
    });
});
