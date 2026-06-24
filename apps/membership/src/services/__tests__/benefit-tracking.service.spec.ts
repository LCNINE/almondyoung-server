import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundError } from '@app/shared';
import { BenefitTrackingService } from '../benefit-tracking.service';
import { SubscriptionService } from '../subscription.service';
import { BenefitReader } from '../benefit/benefit.reader';
import { BenefitManager } from '../benefit/benefit.manager';

/**
 * 활성 구독이 없을 때의 에러 의미론 단위 테스트.
 *
 * 협력 객체(SubscriptionService/BenefitReader/BenefitManager)는 mock 으로 대체해
 * DB 없이 서비스의 에러 계약만 검증한다.
 */
describe('BenefitTrackingService.getCurrentCycleBenefit', () => {
  let service: BenefitTrackingService;
  const getActiveSubscription = jest.fn();
  const findCurrentCycleBenefit = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BenefitTrackingService,
        { provide: SubscriptionService, useValue: { getActiveSubscription } },
        { provide: BenefitReader, useValue: { findCurrentCycleBenefit } },
        { provide: BenefitManager, useValue: {} },
      ],
    }).compile();

    service = module.get(BenefitTrackingService);
  });

  it('활성 구독이 없으면 NotFoundError(404)를 던진다', async () => {
    getActiveSubscription.mockResolvedValue(null);

    await expect(service.getCurrentCycleBenefit('user-without-subscription')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(findCurrentCycleBenefit).not.toHaveBeenCalled();
  });
});
