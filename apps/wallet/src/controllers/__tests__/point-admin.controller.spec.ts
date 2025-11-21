import { Test, TestingModule } from '@nestjs/testing';
import { DbModule, DbService } from '@app/db';
import { PointService } from '../../services/points/point.service';
import { PointAdminController } from '../point-admin.controller';

import { walletSchema } from '../../shared/database/schema';
import * as schema from '../../shared/database/schema';
import { generateUUIDv7 } from '../../shared/utils/id-generator';

// Mock PointService
const mockPointService = {
    addPoints: jest.fn(),
    grantByAdmin: jest.fn(),
};

describe('PointAdminController Integration Test', () => {
    let controller: PointAdminController;
    let pointService: PointService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [PointAdminController],
            providers: [
                {
                    provide: PointService,
                    useValue: mockPointService,
                },
            ],
        }).compile();

        controller = module.get<PointAdminController>(PointAdminController);
        pointService = module.get<PointService>(PointService);
    });

    it('should call pointService.grantByAdmin with correct arguments', async () => {
        const dto = {
            partnerId: 'test-user-id',
            amount: 1000,
            reason: 'CS Compensation',
            memo: 'User complained about delay',
        };

        await controller.grantPoints(dto);

        expect(pointService.grantByAdmin).toHaveBeenCalledWith({
            partnerId: dto.partnerId,
            amount: dto.amount,
            reason: dto.reason,
            memo: dto.memo,
        });
    });

    it('should call pointService.grantByAdmin without memo if not provided', async () => {
        const dto = {
            partnerId: 'test-user-id',
            amount: 500,
            reason: 'Event Reward',
        };

        await controller.grantPoints(dto);

        expect(pointService.grantByAdmin).toHaveBeenCalledWith({
            partnerId: dto.partnerId,
            amount: dto.amount,
            reason: dto.reason,
            memo: undefined,
        });
    });
});
