import { Test, TestingModule } from '@nestjs/testing';
import { SimpleMembershipPaymentService } from '../simple-membership-payment.service';
import { HmsCardPaymentAdapter } from '../../adapters/hms-card-payment.adapter';
import { DbService } from '@app/db';

describe('SimpleMembershipPaymentService', () => {
  let service: SimpleMembershipPaymentService;
  let hmsAdapter: HmsCardPaymentAdapter;

  const mockHmsAdapter = {
    processPayment: jest.fn(),
  };

  const mockDbService = {
    db: {
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockResolvedValue(undefined),
      }),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SimpleMembershipPaymentService,
        {
          provide: HmsCardPaymentAdapter,
          useValue: mockHmsAdapter,
        },
        {
          provide: DbService,
          useValue: mockDbService,
        },
      ],
    }).compile();

    service = module.get<SimpleMembershipPaymentService>(
      SimpleMembershipPaymentService,
    );
    hmsAdapter = module.get<HmsCardPaymentAdapter>(HmsCardPaymentAdapter);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processPayment', () => {
    it('HMS 어댑터를 통한 결제가 성공해야 한다', async () => {
      // Given
      const request = {
        hmsMemberId: 'HMS_123456789',
        amount: 9900,
        subscriptionType: 'monthly',
        userId: 'user123',
      };

      const hmsResult = {
        success: true,
        transactionId: 'TXN_123456789',
        captureId: 'TXN_123456789',
        metadata: {
          provider: 'hms_card',
          approvalNumber: 'APPR123456',
        },
      };

      mockHmsAdapter.processPayment.mockResolvedValue(hmsResult);

      // When
      const result = await service.processPayment(request);

      // Then
      expect(result).toEqual({
        success: true,
        transactionId: 'TXN_123456789',
        amount: 9900,
        processedAt: expect.any(String),
      });

      expect(hmsAdapter.processPayment).toHaveBeenCalledWith(
        9900,
        'KRW',
        expect.objectContaining({
          userId: 'user123',
          sessionId: expect.stringContaining('membership_'),
          paymentMethodId: 'HMS_123456789',
          hmsMemberId: 'HMS_123456789',
          subscriptionType: 'monthly',
          isRecurring: true,
        }),
      );
    });

    it('HMS 어댑터에서 실패 시 에러를 던져야 한다', async () => {
      // Given
      const request = {
        hmsMemberId: 'HMS_INVALID',
        amount: 9900,
      };

      const hmsResult = {
        success: false,
        error: 'HMS 결제 처리 실패',
        transactionId: '',
      };

      mockHmsAdapter.processPayment.mockResolvedValue(hmsResult);

      // When & Then
      await expect(service.processPayment(request)).rejects.toThrow(
        '멤버십 결제 실패: HMS 결제 처리 실패',
      );
    });

    it('필수 필드가 누락되어도 기본값으로 처리되어야 한다', async () => {
      // Given
      const request = {
        hmsMemberId: 'HMS_123456789',
        amount: 9900,
        // userId, subscriptionType 누락
      };

      const hmsResult = {
        success: true,
        transactionId: 'TXN_123456789',
        captureId: 'TXN_123456789',
        metadata: {},
      };

      mockHmsAdapter.processPayment.mockResolvedValue(hmsResult);

      // When
      const result = await service.processPayment(request);

      // Then
      expect(result.success).toBe(true);
      expect(hmsAdapter.processPayment).toHaveBeenCalledWith(
        9900,
        'KRW',
        expect.objectContaining({
          userId: '', // 기본값
          hmsMemberId: 'HMS_123456789',
          subscriptionType: undefined,
          isRecurring: true,
        }),
      );
    });
  });
});
