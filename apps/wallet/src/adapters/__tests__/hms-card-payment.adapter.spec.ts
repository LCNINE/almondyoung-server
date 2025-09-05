// adapters/__tests__/hms-card-payment.adapter.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { HmsCardPaymentAdapter } from '../hms-card-payment.adapter';
import { HmsApiFactory } from '../../shared/utils/hms-api.factory';
import { PaymentTransactionRequest } from 'hms-api-wrapper';

// HMS API Factory Mock
jest.mock('../../shared/utils/hms-api.factory');
const mockHmsApiFactory = HmsApiFactory as jest.Mocked<typeof HmsApiFactory>;

describe('HmsCardPaymentAdapter', () => {
  let adapter: HmsCardPaymentAdapter;
  let mockHmsApi: any;

  beforeEach(async () => {
    // Mock HMS API 설정
    mockHmsApi = {
      paymentProfiles: {
        create: jest.fn(),
        get: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      paymentTransactions: {
        requestTransaction: jest.fn(),
        cancelTransaction: jest.fn(),
        cancelPartialTransaction: jest.fn(),
        getTransaction: jest.fn(),
      },
    };

    mockHmsApiFactory.createForCard.mockReturnValue(mockHmsApi);

    const module: TestingModule = await Test.createTestingModule({
      providers: [HmsCardPaymentAdapter],
    }).compile();

    adapter = module.get<HmsCardPaymentAdapter>(HmsCardPaymentAdapter);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('processPayment', () => {
    describe('성공 시나리오', () => {
      it('HMS API 정확한 데이터 타입으로 결제 처리', async () => {
        // Given
        const amount = 100000;
        const currency = 'KRW';
        const metadata = {
          hmsMemberId: 'HMS_MEMBER_123',
          paymentMethodId: 'pm_card_123',
          userId: 'user_123',
          sessionId: 'session_123',
        };

        const mockHmsResponse = {
          payment: {
            result: { flag: 'SUCCESS', message: '결제 성공' },
            transactionId: 'txn_hms_123',
            approvalNumber: 'APPROVAL_123',
            paymentDate: '2024-01-16T10:00:00Z',
            actualAmount: 100000,
            fee: 1000,
            status: 'CAPTURED',
          },
        };

        mockHmsApi.paymentTransactions.requestTransaction.mockResolvedValue(mockHmsResponse);

        // When
        const result = await adapter.processPayment(amount, currency, metadata);

        // Then - HMS API PaymentTransactionRequest 타입에 정확히 맞는 데이터 전달 확인
        expect(mockHmsApi.paymentTransactions.requestTransaction).toHaveBeenCalledWith(
          expect.objectContaining({
            transactionId: expect.any(String), // TSID 형식
            memberId: 'HMS_MEMBER_123',
            callAmount: 100000,
            cardPointFlag: 'N',
            vatAmount: 10000, // 10% 부가세
          } as PaymentTransactionRequest)
        );

        expect(result).toEqual({
          success: true,
          transactionId: 'txn_hms_123',
          captureId: 'txn_hms_123',
          metadata: {
            provider: 'hms_card',
            method: 'recurring',
            approvalNumber: 'APPROVAL_123',
            paymentDate: '2024-01-16T10:00:00Z',
            actualAmount: 100000,
            fee: 1000,
            rawResponse: mockHmsResponse,
          },
        });
      });

      it('Mock 환경에서 시뮬레이션 응답', async () => {
        // Given - Mock 환경 설정
        const mockHmsApiMock = {} as any;
        mockHmsApiFactory.createForCard.mockReturnValue(mockHmsApiMock);

        // 새로운 어댑터 인스턴스 생성 (Mock 환경)
        const mockAdapter = new HmsCardPaymentAdapter();

        const amount = 50000;
        const metadata = {
          hmsMemberId: 'HMS_MOCK_123',
          userId: 'user_mock_123',
          sessionId: 'session_mock_123',
          paymentMethodId: 'pm_mock_123',
        };

        // When
        const result = await mockAdapter.processPayment(amount, 'KRW', metadata);

        // Then
        expect(result.success).toBe(true);
        expect(result.transactionId).toMatch(/^MOCK_CARD_/);
        expect(result.captureId).toBe(result.transactionId);
        expect(result.metadata?.provider).toBe('hms_card');
        expect(result.metadata?.method).toBe('recurring_mock');
      });
    });

    describe('에러 처리', () => {
      it('HMS API 결제 실패 응답 처리', async () => {
        // Given
        const amount = 100000;
        const metadata = { 
          hmsMemberId: 'HMS_INVALID_123',
          userId: 'user_invalid_123',
          sessionId: 'session_invalid_123',
          paymentMethodId: 'pm_invalid_123',
        };

        const mockHmsErrorResponse = {
          payment: {
            result: { flag: 'FAIL', message: '유효하지 않은 회원 ID' },
            transactionId: '',
          },
        };

        mockHmsApi.paymentTransactions.requestTransaction.mockResolvedValue(mockHmsErrorResponse);

        // When
        const result = await adapter.processPayment(amount, 'KRW', metadata);

        // Then
        expect(result).toEqual({
          success: false,
          transactionId: '',
          error: 'HMS 정기결제 실패: 유효하지 않은 회원 ID',
        });
      });

      it('HMS API 연결 실패 시 에러 처리', async () => {
        // Given
        const amount = 100000;
        const metadata = { 
          hmsMemberId: 'HMS_MEMBER_123',
          userId: 'user_connection_123',
          sessionId: 'session_connection_123',
          paymentMethodId: 'pm_connection_123',
        };

        mockHmsApi.paymentTransactions.requestTransaction.mockRejectedValue(
          new Error('HMS API 서버 연결 실패')
        );

        // When
        const result = await adapter.processPayment(amount, 'KRW', metadata);

        // Then
        expect(result).toEqual({
          success: false,
          transactionId: '',
          error: 'HMS 신용카드 결제 처리 중 오류: HMS API 서버 연결 실패',
        });
      });

      it('잘못된 금액 시 Money 유틸리티 검증', async () => {
        // Given
        const invalidAmount = -1000; // 음수 금액
        const metadata = { 
          hmsMemberId: 'HMS_MEMBER_123',
          userId: 'user_invalid_amount',
          sessionId: 'session_invalid_amount',
          paymentMethodId: 'pm_invalid_amount',
        };

        // When & Then
        await expect(adapter.processPayment(invalidAmount, 'KRW', metadata))
          .rejects
          .toThrow(); // Money.validate에서 에러 발생 예상
      });
    });

    describe('데이터 변환 검증', () => {
      it('부가세 계산 정확성 확인', async () => {
        // Given
        const amount = 110000; // 11만원
        const metadata = { 
          hmsMemberId: 'HMS_MEMBER_123',
          userId: 'user_vat_test',
          sessionId: 'session_vat_test',
          paymentMethodId: 'pm_vat_test',
        };

        const mockHmsResponse = {
          payment: {
            result: { flag: 'SUCCESS', message: '결제 성공' },
            transactionId: 'txn_vat_test',
            actualAmount: 110000,
            fee: 0,
          },
        };

        mockHmsApi.paymentTransactions.requestTransaction.mockResolvedValue(mockHmsResponse);

        // When
        await adapter.processPayment(amount, 'KRW', metadata);

        // Then - 부가세 10% 계산 확인
        expect(mockHmsApi.paymentTransactions.requestTransaction).toHaveBeenCalledWith(
          expect.objectContaining({
            callAmount: 110000,
            vatAmount: 11000, // 10% 부가세
          })
        );
      });

      it('TSID 형식의 transactionId 생성 확인', async () => {
        // Given
        const amount = 100000;
        const metadata = { 
          hmsMemberId: 'HMS_MEMBER_123',
          userId: 'user_tsid_test',
          sessionId: 'session_tsid_test',
          paymentMethodId: 'pm_tsid_test',
        };

        const mockHmsResponse = {
          payment: {
            result: { flag: 'SUCCESS', message: '결제 성공' },
            transactionId: 'txn_tsid_test',
            actualAmount: 100000,
            fee: 0,
          },
        };

        mockHmsApi.paymentTransactions.requestTransaction.mockResolvedValue(mockHmsResponse);

        // When
        await adapter.processPayment(amount, 'KRW', metadata);

        // Then - TSID 형식 확인 (문자열 형태)
        const callArgs = mockHmsApi.paymentTransactions.requestTransaction.mock.calls[0][0];
        expect(callArgs.transactionId).toBeDefined();
        expect(typeof callArgs.transactionId).toBe('string');
        expect(callArgs.transactionId.length).toBeGreaterThan(5); // TSID는 보통 긴 문자열
      });
    });
  });

  describe('refundPayment', () => {
    describe('성공 시나리오', () => {
      it('전체 환불 처리 성공', async () => {
        // Given
        const transactionId = 'txn_refund_123';
        const amount = 0; // 전체 환불
        const reason = '고객 요청';

        const mockHmsResponse = {
          payment: {
            result: { flag: 'SUCCESS', message: '환불 성공' },
            transactionId: 'txn_refund_123',
            cancelAmount: 100000,
            cancelDate: '2024-01-16T11:00:00Z',
            cancelRemainAmount: 0,
          },
        };

        mockHmsApi.paymentTransactions.cancelTransaction.mockResolvedValue(mockHmsResponse);

        // When
        const result = await adapter.refundPayment(transactionId, amount, reason);

        // Then
        expect(mockHmsApi.paymentTransactions.cancelTransaction).toHaveBeenCalledWith(transactionId);
        expect(result).toEqual({
          success: true,
          refundId: 'txn_refund_123',
          refundedAmount: 100000,
          metadata: {
            provider: 'hms_card',
            cancelDate: '2024-01-16T11:00:00Z',
            remainAmount: 0,
            rawResponse: mockHmsResponse,
          },
        });
      });

      it('부분 환불 처리 성공', async () => {
        // Given
        const transactionId = 'txn_partial_refund_123';
        const amount = 30000; // 부분 환불
        const reason = '부분 취소';

        const mockHmsResponse = {
          payment: {
            result: { flag: 'SUCCESS', message: '부분 환불 성공' },
            transactionId: 'txn_partial_refund_123',
            cancelAmount: 30000,
            cancelDate: '2024-01-16T11:30:00Z',
            cancelRemainAmount: 70000,
          },
        };

        mockHmsApi.paymentTransactions.cancelPartialTransaction.mockResolvedValue(mockHmsResponse);

        // When
        const result = await adapter.refundPayment(transactionId, amount, reason);

        // Then
        expect(mockHmsApi.paymentTransactions.cancelPartialTransaction).toHaveBeenCalledWith(
          transactionId,
          30000
        );
        expect(result.refundedAmount).toBe(30000);
        expect(result.metadata?.remainAmount).toBe(70000);
      });
    });

    describe('에러 처리', () => {
      it('HMS API 환불 실패 응답 처리', async () => {
        // Given
        const transactionId = 'txn_invalid_refund';
        const amount = 0;

        const mockHmsErrorResponse = {
          payment: {
            result: { flag: 'FAIL', message: '환불 불가능한 거래' },
            transactionId: '',
          },
        };

        mockHmsApi.paymentTransactions.cancelTransaction.mockResolvedValue(mockHmsErrorResponse);

        // When
        const result = await adapter.refundPayment(transactionId, amount);

        // Then
        expect(result).toEqual({
          success: false,
          refundId: '',
          refundedAmount: 0,
          error: 'HMS 환불 실패: 환불 불가능한 거래',
        });
      });

      it('HMS API 미지원 환경에서 에러 처리', async () => {
        // Given - paymentTransactions가 없는 Mock 환경
        const mockHmsApiWithoutTransactions = {} as any;
        mockHmsApiFactory.createForCard.mockReturnValue(mockHmsApiWithoutTransactions);

        const noTransactionAdapter = new HmsCardPaymentAdapter();
        const transactionId = 'txn_no_support';
        const amount = 0;

        // When
        const result = await noTransactionAdapter.refundPayment(transactionId, amount);

        // Then
        expect(result.success).toBe(false);
        expect(result.error).toContain('HMS PaymentTransaction API가 지원되지 않습니다');
      });
    });
  });

  describe('registerRecurringMember', () => {
    describe('성공 시나리오', () => {
      it('HMS API 정확한 데이터 타입으로 회원 등록', async () => {
        // Given
        const request = {
          userId: 'user_register_test',
          memberName: '테스트사용자',
          phone: '01012345678',
          paymentNumber: '1234567890123456',
          payerName: '테스트사용자',
          payerNumber: '0101234567',
          validYear: '25',
          validMonth: '12',
          billingCycleDay: 15,
        };

        const mockHmsResponse = {
          member: {
            result: { flag: 'SUCCESS', message: '회원 등록 성공' },
            memberId: 'HMS_MEMBER_NEW_123',
            status: 'ACTIVE',
          },
        };

        mockHmsApi.paymentProfiles.create.mockResolvedValue(mockHmsResponse);

        // When
        const result = await adapter.registerRecurringMember(request);

        // Then - HMS API CreatePaymentProfileDto 타입에 정확히 맞는 데이터 전달 확인
        expect(mockHmsApi.paymentProfiles.create).toHaveBeenCalledWith(
          expect.objectContaining({
            memberId: expect.any(String), // TSID 형식
            memberName: '테스트사용자',
            phone: '01012345678',
            paymentKind: 'CARD',
            paymentNumber: '1234567890123456',
            payerName: '테스트사용자',
            payerNumber: '0101234567',
            validYear: '25',
            validMonth: '12',
            paymentDay: '15',
            password: '00',
          })
        );

        expect(result).toEqual({
          success: true,
          paymentMethodId: 'HMS_MEMBER_NEW_123',
          hmsMemberId: 'HMS_MEMBER_NEW_123',
          metadata: {
            provider: 'hms_card',
            hmsStatus: 'ACTIVE',
            maskedCardNumber: expect.stringMatching(/^\d{4}\*+\d{4}$/),
            cardInfo: {
              validYear: '25',
              validMonth: '12',
              payerName: '테스트사용자',
            },
            rawResponse: mockHmsResponse,
          },
        });
      });

      it('Mock 환경에서 시뮬레이션 회원 등록', async () => {
        // Given - Mock 환경 설정
        const mockHmsApiMock = {} as any;
        mockHmsApiFactory.createForCard.mockReturnValue(mockHmsApiMock);

        const mockAdapter = new HmsCardPaymentAdapter();
        const request = {
          userId: 'user_mock_register',
          memberName: 'Mock사용자',
          phone: '01098765432',
          paymentNumber: '9876543210987654',
          validYear: '26',
          validMonth: '06',
        };

        // When
        const result = await mockAdapter.registerRecurringMember(request);

        // Then
        expect(result.success).toBe(true);
        expect(result.hmsMemberId).toMatch(/^HMS_CARD_/);
        expect(result.metadata?.maskedCardNumber).toBe('9876****7654');
        expect(result.metadata?.cardCompany).toBe('HMS_CARD');
      });
    });

    describe('에러 처리', () => {
      it('HMS API 회원 등록 실패 응답 처리', async () => {
        // Given
        const request = {
          userId: 'user_fail_test',
          memberName: '실패사용자',
          phone: '01011111111',
          paymentNumber: 'invalid_card',
        };

        const mockHmsErrorResponse = {
          member: {
            result: { flag: 'FAIL', message: '유효하지 않은 카드 번호' },
            memberId: '',
          },
        };

        mockHmsApi.paymentProfiles.create.mockResolvedValue(mockHmsErrorResponse);

        // When
        const result = await adapter.registerRecurringMember(request);

        // Then
        expect(result).toEqual({
          success: false,
          paymentMethodId: '',
          error: 'HMS 회원 등록 실패: 유효하지 않은 카드 번호',
        });
      });
    });

    describe('데이터 변환 검증', () => {
      it('카드 번호 마스킹 처리 확인', async () => {
        // Given
        const request = {
          userId: 'user_mask_test',
          memberName: '마스킹테스트',
          phone: '01022222222',
          paymentNumber: '1111222233334444',
        };

        const mockHmsResponse = {
          member: {
            result: { flag: 'SUCCESS', message: '성공' },
            memberId: 'HMS_MASK_TEST',
            status: 'ACTIVE',
          },
        };

        mockHmsApi.paymentProfiles.create.mockResolvedValue(mockHmsResponse);

        // When
        const result = await adapter.registerRecurringMember(request);

        // Then
        expect(result.metadata?.maskedCardNumber).toBe('1111****4444');
      });

      it('payerNumber 추출 로직 확인', async () => {
        // Given
        const request = {
          userId: 'user_payer_test',
          memberName: '납부자번호테스트',
          paymentNumber: '1234567890123456',
          phone: '01087654321',
        };

        const mockHmsResponse = {
          member: {
            result: { flag: 'SUCCESS', message: '성공' },
            memberId: 'HMS_PAYER_TEST',
            status: 'ACTIVE',
          },
        };

        mockHmsApi.paymentProfiles.create.mockResolvedValue(mockHmsResponse);

        // When
        await adapter.registerRecurringMember(request);

        // Then - extractPayerNumber 로직 확인
        const callArgs = mockHmsApi.paymentProfiles.create.mock.calls[0][0];
        expect(callArgs.payerNumber).toBe('0108765432'); // 전화번호 앞 10자리
      });
    });
  });
});