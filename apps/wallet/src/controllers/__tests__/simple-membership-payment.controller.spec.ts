import { Test, TestingModule } from '@nestjs/testing';
import { SimpleMembershipPaymentController } from '../simple-membership-payment.controller';
import { SimpleMembershipPaymentService } from '../../services/simple-membership-payment.service';

describe('SimpleMembershipPaymentController', () => {
  let controller: SimpleMembershipPaymentController;
  let service: SimpleMembershipPaymentService;

  const mockService = {
    processPayment: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SimpleMembershipPaymentController],
      providers: [
        {
          provide: SimpleMembershipPaymentService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<SimpleMembershipPaymentController>(
      SimpleMembershipPaymentController,
    );
    service = module.get<SimpleMembershipPaymentService>(
      SimpleMembershipPaymentService,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('processPayment', () => {
    it('정상적인 멤버십 결제 요청이 성공해야 한다', async () => {
      // Given
      const request = {
        hmsMemberId: 'HMS_123456789',
        amount: 9900,
        subscriptionType: 'monthly',
        userId: 'user123',
      };

      const expectedResult = {
        success: true,
        transactionId: 'TXN_123456789',
        amount: 9900,
        processedAt: '2025-01-15T10:30:00.000Z',
      };

      mockService.processPayment.mockResolvedValue(expectedResult);

      // When
      const result = await controller.processPayment(request);

      // Then
      expect(result).toEqual(expectedResult);
      expect(service.processPayment).toHaveBeenCalledWith(request);
    });

    it('서비스에서 에러 발생 시 HTTP 에러로 변환되어야 한다', async () => {
      // Given
      const request = {
        hmsMemberId: 'HMS_INVALID',
        amount: 9900,
      };

      mockService.processPayment.mockRejectedValue(new Error('HMS 결제 실패'));

      // When & Then
      await expect(controller.processPayment(request)).rejects.toThrow();
    });
  });
});
