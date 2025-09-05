import { Test, TestingModule } from '@nestjs/testing';
import { BnplStrategy } from '../bnpl.strategy';
import { BnplMethodGateway } from '../../interfaces/payment-method-gateways.interface';
import { PaymentGateway } from '../../interfaces/payment-gateway.interface';
import { HMS_BNPL_PAYMENT_ADAPTER } from '../../shared/tokens/gateway.tokens';

describe('BnplStrategy', () => {
  let strategy: BnplStrategy;
  let mockBnplAdapter: jest.Mocked<BnplMethodGateway & PaymentGateway>;

  beforeEach(async () => {
    mockBnplAdapter = {
      // BnplMethodGateway methods
      registerMember: jest.fn(),
      getMemberStatus: jest.fn(),
      submitConsent: jest.fn(),

      // PaymentGateway methods
      processPayment: jest.fn(),
      refundPayment: jest.fn(),
      capturePayment: jest.fn(),
      batchCapture: jest.fn(),
      registerPaymentMethod: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BnplStrategy,
        { provide: HMS_BNPL_PAYMENT_ADAPTER, useValue: mockBnplAdapter },
      ],
    }).compile();

    strategy = module.get<BnplStrategy>(BnplStrategy);
  });

  describe('registerMethod', () => {
    it('HMS BNPL 어댑터를 통해 회원을 등록해야 함', async () => {
      const mockRequest = {
        memberName: 'Test User',
        phone: '01012345678',
        creditLimit: 500000,
      };

      const mockResult = {
        success: true,
        paymentMethodId: 'pm-123',
        hmsMemberId: 'hms-456',
        metadata: { provider: 'hms_bnpl' },
      };

      mockBnplAdapter.registerMember.mockResolvedValue(mockResult);

      const result = await strategy.registerMethod(mockRequest);

      expect(mockBnplAdapter.registerMember).toHaveBeenCalledWith(mockRequest);
      expect(result).toEqual(mockResult);
    });

    it('어댑터에서 실패하면 에러 응답을 반환해야 함', async () => {
      const mockRequest = { memberName: 'Test User' };
      const mockError = { success: false, error: 'Registration failed' };

      mockBnplAdapter.registerMember.mockResolvedValue(mockError);

      const result = await strategy.registerMethod(mockRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Registration failed');
    });

    it('어댑터에서 예외가 발생하면 에러 응답을 반환해야 함', async () => {
      const mockRequest = { memberName: 'Test User' };

      mockBnplAdapter.registerMember.mockRejectedValue(
        new Error('Network error'),
      );

      const result = await strategy.registerMethod(mockRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  describe('processPayment', () => {
    it('BNPL 어댑터를 통해 결제를 처리해야 함', async () => {
      const mockMetadata = {
        userId: 'user-123',
        sessionId: 'session-123',
        bnplAccountId: 'bnpl-456',
      };

      const mockResult = {
        success: true,
        transactionId: 'tx-123',
        authorizationId: 'auth-456',
        metadata: { provider: 'hms_bnpl' },
      };

      mockBnplAdapter.processPayment.mockResolvedValue(mockResult);

      const result = await strategy.processPayment(10000, 'KRW', mockMetadata);

      expect(mockBnplAdapter.processPayment).toHaveBeenCalledWith(
        10000,
        'KRW',
        expect.objectContaining({
          userId: 'user-123',
          sessionId: 'session-123',
          bnplAccountId: 'bnpl-456',
        }),
      );
      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('tx-123');
      expect(result.status).toBe('AUTHORIZED'); // authorizationId가 있으므로
    });

    it('authorizationId가 없으면 CAPTURED 상태를 반환해야 함', async () => {
      const mockResult = {
        success: true,
        transactionId: 'tx-123',
        // authorizationId 없음
        metadata: { provider: 'hms_bnpl' },
      };

      mockBnplAdapter.processPayment.mockResolvedValue(mockResult);

      const result = await strategy.processPayment(10000, 'KRW', {});

      expect(result.status).toBe('CAPTURED');
    });
  });

  describe('refundPayment', () => {
    it('BNPL 어댑터를 통해 환불을 처리해야 함', async () => {
      const mockResult = {
        success: true,
        refundId: 'refund-123',
        refundedAmount: 5000,
        metadata: { provider: 'hms_bnpl' },
      };

      mockBnplAdapter.refundPayment.mockResolvedValue(mockResult);

      const result = await strategy.refundPayment('tx-123', 5000, '고객 요청');

      expect(mockBnplAdapter.refundPayment).toHaveBeenCalledWith(
        'tx-123',
        5000,
        '고객 요청',
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('batchCapture', () => {
    it('BNPL 어댑터를 통해 배치 캡처를 처리해야 함', async () => {
      const authorizationIds = ['auth-1', 'auth-2', 'auth-3'];
      const batchId = 'batch-123';

      const mockResult = {
        success: true,
        captureIds: ['capture-1', 'capture-2', 'capture-3'],
        failedIds: [],
      };

      mockBnplAdapter.batchCapture.mockResolvedValue(mockResult);

      const result = await strategy.batchCapture(authorizationIds, batchId);

      expect(mockBnplAdapter.batchCapture).toHaveBeenCalledWith(
        authorizationIds,
        batchId,
      );
      expect(result).toEqual(mockResult);
    });

    it('배치 캡처 실패 시 모든 ID를 failedIds로 반환해야 함', async () => {
      const authorizationIds = ['auth-1', 'auth-2'];

      mockBnplAdapter.batchCapture.mockRejectedValue(new Error('Batch failed'));

      const result = await strategy.batchCapture(authorizationIds);

      expect(result.success).toBe(false);
      expect(result.failedIds).toEqual(authorizationIds);
      expect(result.error).toBe('BNPL 배치 확정 처리 중 오류가 발생했습니다');
    });
  });

  describe('getMemberStatus', () => {
    it('HMS 상태를 표준 상태로 매핑해야 함', async () => {
      const mockResult = {
        success: true,
        hmsStatus: 'ACTIVE',
        creditLimit: 500000,
      };

      mockBnplAdapter.getMemberStatus.mockResolvedValue(mockResult);

      const result = await strategy.getMemberStatus('member-123');

      expect(mockBnplAdapter.getMemberStatus).toHaveBeenCalledWith(
        'member-123',
      );
      expect(result.success).toBe(true);
      expect(result.status).toBe('ACTIVE');
      expect(result.hmsStatus).toBe('ACTIVE');
    });

    it('HMS 상태 매핑이 올바르게 작동해야 함', () => {
      // private 메서드 테스트
      const testCases = [
        { hmsStatus: 'ACTIVE', expected: 'ACTIVE' },
        { hmsStatus: 'PENDING', expected: 'PENDING' },
        { hmsStatus: 'SUSPENDED', expected: 'INACTIVE' },
        { hmsStatus: 'CLOSED', expected: 'CLOSED' },
        { hmsStatus: 'UNKNOWN_STATUS', expected: 'UNKNOWN' },
        { hmsStatus: undefined, expected: 'UNKNOWN' },
      ];

      testCases.forEach(({ hmsStatus, expected }) => {
        const result = strategy['mapHmsStatusToStandard'](hmsStatus);
        expect(result).toBe(expected);
      });
    });
  });

  describe('submitConsent', () => {
    it('BNPL 어댑터를 통해 동의서를 제출해야 함', async () => {
      const mockConsentData = { memberId: 'member-123', consentType: 'TERMS' };
      const mockFiles = [] as Express.Multer.File[];

      const mockResult = {
        success: true,
        consentId: 'consent-123',
      };

      mockBnplAdapter.submitConsent.mockResolvedValue(mockResult);

      const result = await strategy.submitConsent(mockConsentData, mockFiles);

      expect(mockBnplAdapter.submitConsent).toHaveBeenCalledWith(
        mockConsentData,
        mockFiles,
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('activateAccount & deactivateAccount', () => {
    it('계정 활성화/비활성화는 PaymentMethodService로 이동해야 한다는 경고를 로그해야 함', async () => {
      const logSpy = jest.spyOn(strategy['logger'], 'warn');

      await strategy.activateAccount('pm-123', 500000);
      await strategy.deactivateAccount('pm-123');

      expect(logSpy).toHaveBeenCalledWith(
        'activateAccount는 PaymentMethodService로 이동해야 합니다.',
      );
      expect(logSpy).toHaveBeenCalledWith(
        'deactivateAccount는 PaymentMethodService로 이동해야 합니다.',
      );
    });
  });
});
